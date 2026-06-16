#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Synced harness files that execute pnpm scripts in CI or git hooks.
 * Human-facing templates (PR/issue checklists) are intentionally excluded.
 */
export const CHILD_FACING_HARNESS_PATHS = [
  '.github/workflows/ci.yml',
  '.githooks/pre-push',
]

/**
 * Non-namespaced scripts that synced CI and pre-push must not call directly.
 * Child projects add these locally when ready; harness automation uses bemoat:* only.
 */
export const FORBIDDEN_RAW_SCRIPTS = [
  'guard:safety',
  'guard:cloudflare-env',
  'check',
  'check:full',
  'typecheck',
  'lint',
  'build',
  'deploy',
  'deploy:app',
  'deploy:database',
  'deploy:dev',
  'preview',
  'test:int',
  'test',
  'generate:importmap',
  'generate:types',
]

const PNPM_RUN_RE = /pnpm run ([a-zA-Z0-9:_-]+)/g

export function extractPnpmRunScripts(content) {
  return [...content.matchAll(PNPM_RUN_RE)].map((match) => match[1])
}

export function findForbiddenRawScriptCalls(content, forbidden = FORBIDDEN_RAW_SCRIPTS) {
  const forbiddenSet = new Set(forbidden)
  return extractPnpmRunScripts(content).filter((script) => forbiddenSet.has(script))
}

export function scanChildFacingHarnessFile(relativePath, content) {
  const forbidden = findForbiddenRawScriptCalls(content)

  return forbidden.map((script) => ({
    type: 'forbidden-raw-script',
    file: relativePath,
    rule: script,
    message: `Child-facing harness must not call non-namespaced script "${script}" — use bemoat:* instead`,
  }))
}

export function runHarnessContractGuard({
  root = process.cwd(),
  paths = CHILD_FACING_HARNESS_PATHS,
  readFile = (filePath) => readFileSync(filePath, 'utf8'),
} = {}) {
  const violations = []

  for (const relativePath of paths) {
    const absolutePath = resolve(root, relativePath)
    let content

    try {
      content = readFile(absolutePath)
    } catch {
      violations.push({
        type: 'missing-child-facing-file',
        file: relativePath,
        rule: 'required-path',
        message: 'Child-facing harness file is missing',
      })
      continue
    }

    violations.push(...scanChildFacingHarnessFile(relativePath, content))
  }

  return violations
}

export function getHarnessContractExitCode(violations) {
  return violations.length > 0 ? 1 : 0
}

export function formatHarnessContractViolations(violations) {
  if (violations.length === 0) {
    return ['Harness contract guard passed.']
  }

  const lines = [
    'Harness contract guard failed:',
    '',
    'Synced CI and pre-push must call only bemoat:* scripts.',
    'See docs/harness-sync-contract.md.',
    '',
  ]

  for (const violation of violations) {
    lines.push(`- [${violation.type}] ${violation.file}: ${violation.message}`)
  }

  return lines
}

export function isDirectExecution() {
  const entrypoint = process.argv[1]
  if (!entrypoint) return false
  return import.meta.url === pathToFileURL(resolve(entrypoint)).href
}

function main() {
  const violations = runHarnessContractGuard()
  const lines = formatHarnessContractViolations(violations)

  for (const line of lines) console.log(line)

  process.exit(getHarnessContractExitCode(violations))
}

if (isDirectExecution()) main()
