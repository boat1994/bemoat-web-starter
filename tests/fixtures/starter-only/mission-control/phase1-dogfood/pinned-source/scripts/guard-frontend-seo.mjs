#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const FRONTEND_LAYOUT_PATH = 'src/app/(frontend)/layout.tsx'

/** Known App Router SEO entry points when a project adds them. */
export const OPTIONAL_SEO_PATHS = ['src/app/sitemap.ts', 'src/app/robots.ts']

export function scanFrontendLayoutMetadata(content, file = FRONTEND_LAYOUT_PATH) {
  const violations = []

  const hasMetadataExport = /export\s+const\s+metadata\b/.test(content)
  const hasGenerateMetadata = /export\s+(?:async\s+)?function\s+generateMetadata\b/.test(content)

  if (!hasMetadataExport && !hasGenerateMetadata) {
    violations.push({
      type: 'frontend-seo',
      file,
      rule: 'missing-metadata-export',
      message: 'Frontend root layout must export metadata or generateMetadata for site title and description',
    })
    return violations
  }

  if (hasMetadataExport) {
    if (!/\btitle\s*:/.test(content)) {
      violations.push({
        type: 'frontend-seo',
        file,
        rule: 'missing-metadata-title',
        message: 'metadata export must include a title field',
      })
    }

    if (!/\bdescription\s*:/.test(content)) {
      violations.push({
        type: 'frontend-seo',
        file,
        rule: 'missing-metadata-description',
        message: 'metadata export must include a description field',
      })
    }
  }

  return violations
}

export function scanOptionalSeoFile(relativePath, content) {
  const violations = []

  if (relativePath.endsWith('sitemap.ts')) {
    const hasSitemapExport =
      /export\s+default\s+function\s+sitemap\b/.test(content) ||
      /export\s+default\s+async\s+function\s+sitemap\b/.test(content)

    if (!hasSitemapExport) {
      violations.push({
        type: 'frontend-seo',
        file: relativePath,
        rule: 'invalid-sitemap-export',
        message: 'sitemap.ts must default-export a sitemap() function',
      })
    }
  }

  if (relativePath.endsWith('robots.ts')) {
    const hasRobotsExport =
      /export\s+default\s+function\s+robots\b/.test(content) ||
      /export\s+default\s+async\s+function\s+robots\b/.test(content)

    if (!hasRobotsExport) {
      violations.push({
        type: 'frontend-seo',
        file: relativePath,
        rule: 'invalid-robots-export',
        message: 'robots.ts must default-export a robots() function',
      })
    }
  }

  return violations
}

export function runFrontendSeoGuard({
  root = process.cwd(),
  readFile = (filePath) => readFileSync(filePath, 'utf8'),
  exists = (filePath) => existsSync(filePath),
  frontendLayoutPath = FRONTEND_LAYOUT_PATH,
  optionalSeoPaths = OPTIONAL_SEO_PATHS,
} = {}) {
  const violations = []
  const layoutAbsolutePath = resolve(root, frontendLayoutPath)

  if (!exists(layoutAbsolutePath)) {
    // Payload-only or custom app structures may omit the starter frontend route group.
    return violations
  }

  try {
    const layoutContent = readFile(layoutAbsolutePath)
    violations.push(...scanFrontendLayoutMetadata(layoutContent, frontendLayoutPath))
  } catch {
    violations.push({
      type: 'frontend-seo',
      file: frontendLayoutPath,
      rule: 'unreadable-layout',
      message: 'Could not read frontend root layout for metadata checks',
    })
  }

  for (const relativePath of optionalSeoPaths) {
    const absolutePath = resolve(root, relativePath)
    if (!exists(absolutePath)) continue

    try {
      const content = readFile(absolutePath)
      violations.push(...scanOptionalSeoFile(relativePath, content))
    } catch {
      violations.push({
        type: 'frontend-seo',
        file: relativePath,
        rule: 'unreadable-seo-file',
        message: 'Could not read SEO route file',
      })
    }
  }

  return violations
}

export function getFrontendSeoGuardExitCode(violations) {
  return violations.length > 0 ? 1 : 0
}

export function formatFrontendSeoViolations(violations) {
  if (violations.length === 0) {
    return ['Frontend SEO guard passed.']
  }

  const lines = [
    'Frontend SEO guard failed:',
    '',
    'When the starter frontend route group exists, root metadata is required.',
    'sitemap.ts and robots.ts are validated only when present.',
    'See docs/guard-pack.md.',
    '',
  ]

  for (const violation of violations) {
    lines.push(`- [${violation.rule}] ${violation.file}: ${violation.message}`)
  }

  return lines
}

export function isDirectExecution() {
  const entrypoint = process.argv[1]
  if (!entrypoint) return false
  return import.meta.url === pathToFileURL(resolve(entrypoint)).href
}

function main() {
  const violations = runFrontendSeoGuard()
  const lines = formatFrontendSeoViolations(violations)

  for (const line of lines) console.log(line)

  process.exit(getFrontendSeoGuardExitCode(violations))
}

if (isDirectExecution()) main()
