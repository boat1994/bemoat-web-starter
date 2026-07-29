#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, posix, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Synced harness files that execute pnpm scripts in CI or git hooks.
 * Human-facing templates (PR/issue checklists) are intentionally excluded.
 */
export const CHILD_FACING_HARNESS_PATHS = [
  '.github/workflows/ci.yml',
  '.githooks/pre-commit',
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

export const MANAGED_RUNTIME_ROOT_PREFIX = 'scripts'

const PNPM_RUN_RE = /pnpm run ([a-zA-Z0-9:_-]+)/g
const STATIC_IMPORT_FROM_RE =
  /\bimport\s+(?:type\s+)?(?:[^;]*?\sfrom\s+)?['"]([^'"]+)['"]/g
const EXPORT_FROM_RE =
  /\bexport\s+(?:\{[^}]*\}|\*(?:\s+as\s+[\w$]+)?)\s+from\s+['"]([^'"]+)['"]/g
const DYNAMIC_IMPORT_START_RE = /\bimport\s*\(/g

export class ManagedRuntimeDeliveryClosureError extends Error {
  constructor(violations) {
    super('Managed runtime delivery closure validation failed')
    this.name = 'ManagedRuntimeDeliveryClosureError'
    this.violations = violations
  }
}

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

/**
 * @param {string} relativePath
 * @param {string[]} managedPaths
 */
export function isManagedPath(relativePath, managedPaths) {
  for (const managedPath of managedPaths) {
    if (relativePath === managedPath) return true
    if (relativePath.startsWith(`${managedPath}/`)) return true
  }

  return false
}

export function isBuiltinOrPackageSpecifier(specifier) {
  if (!specifier) return true
  if (specifier.startsWith('node:')) return true
  if (specifier.startsWith('#')) return true
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) return true

  return false
}

export function resolveRelativeRuntimeCallee(importerPath, specifier) {
  if (!specifier.startsWith('.')) {
    return { kind: 'external', callee: null }
  }

  const importerDir = dirname(importerPath)
  const joined = posix.normalize(posix.join(importerDir.split(/[/\\]/).join('/'), specifier))

  if (joined.startsWith('../') || joined === '..') {
    return { kind: 'escaped', callee: joined }
  }

  return { kind: 'relative', callee: joined }
}

function normalizeDynamicImportSourceExpression(sourceExpression) {
  return sourceExpression.replace(/\s+/g, ' ').trim()
}

function findDynamicImportInvocations(content) {
  const invocations = []

  for (const match of content.matchAll(DYNAMIC_IMPORT_START_RE)) {
    if (match.index == null) continue

    const start = match.index
    const openParen = start + match[0].lastIndexOf('(')
    let quote = null
    let escaped = false
    let depth = 1
    let end = content.length

    for (let index = openParen + 1; index < content.length; index += 1) {
      const character = content[index]

      if (quote) {
        if (escaped) {
          escaped = false
        } else if (character === '\\') {
          escaped = true
        } else if (character === quote) {
          quote = null
        }
        continue
      }

      if (character === "'" || character === '"' || character === '`') {
        quote = character
        continue
      }

      if (character === '(') {
        depth += 1
        continue
      }

      if (character === ')') {
        depth -= 1
        if (depth === 0) {
          end = index + 1
          break
        }
      }
    }

    const sourceExpression = normalizeDynamicImportSourceExpression(content.slice(start, end))
    invocations.push({
      sourceExpression,
      argumentExpression: content.slice(openParen + 1, end - 1).trim(),
    })
  }

  return invocations
}

function parseExactDynamicImportSpecifier(argumentExpression) {
  const singleQuoted = argumentExpression.match(/^'([^'\\\r\n]*)'$/)
  if (singleQuoted) return singleQuoted[1]

  const doubleQuoted = argumentExpression.match(/^"([^"\\\r\n]*)"$/)
  if (doubleQuoted) return doubleQuoted[1]

  const templateLiteral = argumentExpression.match(/^`([^`$\\]*)`$/)
  if (templateLiteral) return templateLiteral[1]

  return null
}

export function parseRuntimeImportSpecifiers(content) {
  const specifiers = []
  const unverifiable = []

  for (const match of content.matchAll(STATIC_IMPORT_FROM_RE)) {
    specifiers.push({ specifier: match[1], sourceExpression: match[1] })
  }

  for (const match of content.matchAll(EXPORT_FROM_RE)) {
    specifiers.push({ specifier: match[1], sourceExpression: match[1] })
  }

  for (const invocation of findDynamicImportInvocations(content)) {
    const specifier = parseExactDynamicImportSpecifier(invocation.argumentExpression)
    if (specifier == null) {
      unverifiable.push({
        specifier: invocation.sourceExpression,
        sourceExpression: invocation.sourceExpression,
      })
      continue
    }

    specifiers.push({ specifier, sourceExpression: invocation.sourceExpression })
  }

  return { specifiers, unverifiable }
}

function listRegularFiles(root, relativePath = '') {
  const absolutePath = join(root, relativePath)
  if (!existsSync(absolutePath)) return []

  const stat = statSync(absolutePath)
  if (!stat.isDirectory()) return [relativePath.replace(/\\/g, '/')]

  const files = []
  for (const entry of readdirSync(absolutePath, { withFileTypes: true })) {
    const childPath = relativePath ? `${relativePath}/${entry.name}` : entry.name
    files.push(...listRegularFiles(root, childPath))
  }

  return files
}

/**
 * @param {string} root
 * @param {string[]} managedPaths
 */
export function collectManagedRuntimeScriptRoots(root, managedPaths) {
  const files = listRegularFiles(root, MANAGED_RUNTIME_ROOT_PREFIX)
  return files
    .filter((filePath) => filePath.endsWith('.mjs'))
    .filter((filePath) => isManagedPath(filePath, managedPaths))
    .sort()
}

/**
 * @param {string[]} managedPaths
 */
export function collectExplicitManagedRuntimeScriptPaths(managedPaths) {
  return managedPaths
    .filter((managedPath) => managedPath.startsWith(MANAGED_RUNTIME_ROOT_PREFIX))
    .filter((managedPath) => managedPath.endsWith('.mjs'))
    .sort()
}

function compareViolations(left, right) {
  return (
    left.importer.localeCompare(right.importer) ||
    left.type.localeCompare(right.type) ||
    left.callee.localeCompare(right.callee) ||
    left.specifier.localeCompare(right.specifier)
  )
}

/**
 * @param {{
 *   root?: string,
 *   managedPaths?: string[],
 *   readFile?: (filePath: string) => string,
 *   exists?: (filePath: string) => boolean,
 *   isFile?: (filePath: string) => boolean,
 * }} [options]
 */
export function scanManagedRuntimeDeliveryClosure({
  root = process.cwd(),
  managedPaths = [],
  readFile = (filePath) => readFileSync(filePath, 'utf8'),
  exists = (filePath) => existsSync(filePath),
  isFile = (filePath) => {
    if (!existsSync(filePath)) return false
    return statSync(filePath).isFile()
  },
} = {}) {
  const violations = []

  for (const managedPath of collectExplicitManagedRuntimeScriptPaths(managedPaths)) {
    const absolutePath = join(root, managedPath)
    if (!exists(absolutePath) || !isFile(absolutePath)) {
      violations.push({
        type: 'missing-managed-runtime-source',
        importer: 'managedPaths',
        callee: managedPath,
        specifier: managedPath,
      })
    }
  }

  const queue = collectManagedRuntimeScriptRoots(root, managedPaths)
  const visited = new Set()

  while (queue.length > 0) {
    const importer = queue.shift()
    if (visited.has(importer)) continue
    visited.add(importer)

    const absoluteImporter = join(root, importer)
    if (!exists(absoluteImporter) || !isFile(absoluteImporter)) {
      violations.push({
        type: 'missing-relative-runtime-dependency',
        importer,
        callee: importer,
        specifier: importer,
      })
      continue
    }

    const content = readFile(absoluteImporter)
    const { specifiers, unverifiable } = parseRuntimeImportSpecifiers(content)

    for (const entry of unverifiable) {
      violations.push({
        type: 'unverifiable-dynamic-runtime-import',
        importer,
        callee: '<unresolved>',
        specifier: entry.sourceExpression,
      })
    }

    for (const entry of specifiers) {
      const { specifier, sourceExpression } = entry
      if (isBuiltinOrPackageSpecifier(specifier)) continue

      const resolved = resolveRelativeRuntimeCallee(importer, specifier)
      if (resolved.kind === 'external') continue

      if (resolved.kind === 'escaped') {
        violations.push({
          type: 'unverifiable-dynamic-runtime-import',
          importer,
          callee: '<unresolved>',
          specifier: sourceExpression,
        })
        continue
      }

      const callee = resolved.callee
      const absoluteCallee = join(root, callee)

      if (!exists(absoluteCallee) || !isFile(absoluteCallee)) {
        violations.push({
          type: 'missing-relative-runtime-dependency',
          importer,
          callee,
          specifier,
        })
        continue
      }

      if (!isManagedPath(callee, managedPaths)) {
        violations.push({
          type: 'unmanaged-relative-runtime-dependency',
          importer,
          callee,
          specifier,
        })
        continue
      }

      if (callee.endsWith('.mjs') && isManagedPath(callee, managedPaths) && !visited.has(callee)) {
        queue.push(callee)
      }
    }
  }

  return violations.sort(compareViolations)
}

export function formatManagedRuntimeDeliveryViolations(violations) {
  if (violations.length === 0) {
    return ['Harness contract guard passed.']
  }

  const lines = [
    'Harness contract guard failed:',
    '',
    'Managed runtime delivery closure must resolve only managed local dependencies.',
    'See docs/harness-sync-contract.md.',
    '',
  ]

  for (const violation of violations) {
    lines.push(
      `- [${violation.type}] importer="${violation.importer}" -> callee="${violation.callee}" specifier="${violation.specifier}"`,
    )
  }

  return lines
}

/**
 * @param {Parameters<typeof scanManagedRuntimeDeliveryClosure>[0]} [options]
 */
export function assertManagedRuntimeDeliveryClosure(options = {}) {
  const violations = scanManagedRuntimeDeliveryClosure(options)
  if (violations.length === 0) return violations

  const error = new ManagedRuntimeDeliveryClosureError(violations)
  error.formatted = formatManagedRuntimeDeliveryViolations(violations)
  throw error
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

export function loadManagedPathsFromManifest(root = process.cwd()) {
  const manifestPath = join(root, '.bemoat/boilerplate-sync-manifest.json')
  if (!existsSync(manifestPath)) return null

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  return Array.isArray(manifest.managedPaths) ? manifest.managedPaths : null
}

export function isDirectExecution() {
  const entrypoint = process.argv[1]
  if (!entrypoint) return false
  return import.meta.url === pathToFileURL(resolve(entrypoint)).href
}

function main() {
  const root = process.cwd()
  const childFacingViolations = runHarnessContractGuard({ root })
  const managedPaths = loadManagedPathsFromManifest(root)
  const runtimeViolations = managedPaths
    ? scanManagedRuntimeDeliveryClosure({ root, managedPaths })
    : []

  const lines =
    runtimeViolations.length > 0
      ? formatManagedRuntimeDeliveryViolations(runtimeViolations)
      : formatHarnessContractViolations(childFacingViolations)

  for (const line of lines) console.log(line)

  const exitCode =
    runtimeViolations.length > 0
      ? 1
      : getHarnessContractExitCode(childFacingViolations)

  process.exit(exitCode)
}

if (isDirectExecution()) main()
