import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'

import { parseRuntimeImportSpecifiers } from './runtime-import-parser.mjs'

export const MANAGED_RUNTIME_ROOT_PREFIX = 'scripts'

export class ManagedRuntimeDeliveryClosureError extends Error {
  constructor(violations) {
    super('Managed runtime delivery closure validation failed')
    this.name = 'ManagedRuntimeDeliveryClosureError'
    this.violations = violations
  }
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
