import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import {
  expandSeedOnlyFiles,
  listPathFiles,
  managedPaths,
  mergeKeepPaths,
  seedOnlyPaths,
} from '../inventory.ts'
import { SYNC_MODES } from '../config.ts'
import { mergeGitignoreKeepTarget } from '../filesystem.ts'
import { buildPackageSyncProposal, formatPackageSyncProposal } from '../package.ts'
import type {
  JsonObject,
  PackageJson,
  PackageSyncProposal,
  SyncMode,
} from '../types.ts'

const repo = process.env.BEMOAT_BOILERPLATE_REPO || 'boat1994/bemoat-web-starter'
const ref = process.env.BEMOAT_BOILERPLATE_REF || 'main'
function readJSON(path: string): PackageJson {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!isJsonObject(parsed)) {
    throw new TypeError(`Expected a JSON object in ${path}`)
  }
  return parsed
}
function isJsonObject(value: unknown): value is PackageJson {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Strip JSONC comments and trailing commas for deterministic JSON.parse.
 * Comment markers are recognized only outside quoted strings.
 * Structural trailing commas are removed only outside quoted strings.
 */
export function stripJsoncComments(content: string): string {
  let output = ''
  let index = 0
  let inString = false
  let escaped = false

  const isJsonWhitespace = (char: string): boolean =>
    char === ' ' || char === '\t' || char === '\n' || char === '\r'
  const skipCommentAt = (startIndex: number): number | null => {
    if (content[startIndex] !== '/') return null
    const next = content[startIndex + 1]
    if (next === '/') {
      let cursor = startIndex + 2
      while (cursor < content.length && content[cursor] !== '\n' && content[cursor] !== '\r') {
        cursor += 1
      }
      return cursor
    }
    if (next === '*') {
      let cursor = startIndex + 2
      while (cursor < content.length) {
        if (content[cursor] === '*' && content[cursor + 1] === '/') {
          return cursor + 2
        }
        cursor += 1
      }
      throw new SyntaxError(`Unterminated block comment starting at offset ${startIndex}`)
    }
    return null
  }
  const nextStructuralIndex = (fromIndex: number): number => {
    let cursor = fromIndex
    while (cursor < content.length) {
      const char = content[cursor]
      if (isJsonWhitespace(char)) {
        cursor += 1
        continue
      }
      const afterComment = skipCommentAt(cursor)
      if (afterComment !== null) {
        cursor = afterComment
        continue
      }
      return cursor
    }
    return cursor
  }
  while (index < content.length) {
    const char = content[index]
    const next = content[index + 1]

    if (inString) {
      output += char
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      index += 1
      continue
    }
    if (char === '"') {
      inString = true
      output += char
      index += 1
      continue
    }
    if (char === '/' && next === '/') {
      const commentEnd = skipCommentAt(index)
      if (commentEnd === null) throw new SyntaxError(`Invalid line comment at offset ${index}`)
      index = commentEnd
      continue
    }
    if (char === '/' && next === '*') {
      const commentEnd = skipCommentAt(index)
      if (commentEnd === null) throw new SyntaxError(`Invalid block comment at offset ${index}`)
      index = commentEnd
      continue
    }
    if (char === ',') {
      const structuralIndex = nextStructuralIndex(index + 1)
      const structural = content[structuralIndex]
      if (structural === '}' || structural === ']') {
        index += 1
        continue
      }
      output += char
      index += 1
      continue
    }

    output += char
    index += 1
  }
  return output
}

function parseJsonc(content: string): JsonObject {
  const parsed: unknown = JSON.parse(stripJsoncComments(content))
  if (!isJsonObject(parsed)) {
    throw new TypeError('Expected a JSON object')
  }
  return parsed
}
function digestFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function digestPath(root: string, relativePath: string): string | null {
  const fullPath = join(root, relativePath)
  if (!existsSync(fullPath)) return null
  const stat = statSync(fullPath)
  if (!stat.isDirectory()) return digestFile(fullPath)

  return listPathFiles(root, relativePath)
    .map((filePath) => `${filePath}:${digestFile(join(root, filePath))}`)
    .join('\n')
}

function getPackageProposalReport(source: string, target: string): {
  proposal: PackageSyncProposal
  markdown: string
} | null {
  const sourcePackagePath = join(source, 'package.json')
  const targetPackagePath = join(target, 'package.json')
  if (!existsSync(sourcePackagePath) || !existsSync(targetPackagePath)) return null

  const sourcePackage = readJSON(sourcePackagePath)
  const targetPackage = readJSON(targetPackagePath)
  const proposal = buildPackageSyncProposal(sourcePackage, targetPackage)

  const hasProposal =
    proposal.missingScripts.length > 0 ||
    proposal.differentScripts.length > 0 ||
    proposal.differentBemoatScripts.length > 0 ||
    Object.keys(proposal.missingSectionEntries).length > 0 ||
    Object.keys(proposal.differentSectionEntries).length > 0

  if (!hasProposal) return null

  return { proposal, markdown: formatPackageSyncProposal({ repo, ref, proposal }) }
}

export function compareBoilerplateDrift({
  sourceRoot: source,
  targetRoot: target,
  paths = managedPaths,
}: {
  sourceRoot: string
  targetRoot: string
  paths?: string[]
}): {
  missing: string[]
  changed: string[]
  identical: string[]
} {
  const missing: string[] = []
  const changed: string[] = []
  const identical: string[] = []

  for (const relativePath of paths) {
    const sourcePath = join(source, relativePath)
    const targetPath = join(target, relativePath)

    if (!existsSync(sourcePath)) continue
    if (!existsSync(targetPath)) {
      missing.push(relativePath)
      continue
    }

    const sourceDigest = digestPath(source, relativePath)
    const targetDigest = digestPath(target, relativePath)
    if (sourceDigest === targetDigest) {
      identical.push(relativePath)
    } else {
      changed.push(relativePath)
    }
  }

  return { missing, changed, identical }
}

export function comparePackageProposalDrift({ sourceRoot: source, targetRoot: target }: {
  sourceRoot: string
  targetRoot: string
}): { proposal: PackageSyncProposal; markdown: string } | null {
  return getPackageProposalReport(source, target)
}

export function compareToolchainContractDrift({ sourceRoot: source, targetRoot: target }: {
  sourceRoot: string
  targetRoot: string
}): string[] {
  const contractPath = join(source, '.bemoat/toolchain-contract.json')
  const targetPackagePath = join(target, 'package.json')
  const targetConfigPath = join(target, 'tsconfig.json')
  if (!existsSync(contractPath) || !existsSync(targetPackagePath) || !existsSync(targetConfigPath)) return []
  const contract = readJSON(contractPath)
  const targetPackage = readJSON(targetPackagePath)
  const targetConfig = parseJsonc(readFileSync(targetConfigPath, 'utf8'))
  const drift: string[] = []

  const contractTypeScript = contract['typescript']
  if (typeof contractTypeScript !== 'string') {
    throw new TypeError('Toolchain contract must define a TypeScript version')
  }
  if (targetPackage.devDependencies?.typescript !== contractTypeScript) {
    drift.push(`package.json TypeScript must pin ${contractTypeScript}`)
  }
  if (targetPackage.scripts?.['bemoat:typecheck'] !== 'node scripts/bemoat-typecheck.ts') {
    drift.push('package.json bemoat:typecheck must match the managed toolchain contract')
  }
  const compilerOptions = isJsonObject(targetConfig['compilerOptions'])
    ? targetConfig['compilerOptions']
    : {}
  if (compilerOptions['strict'] !== true || compilerOptions['strictNullChecks'] === false) {
    drift.push('tsconfig.json must preserve strict mode and effective strictNullChecks')
  }
  return drift
}

export function compareSeedOnlyDrift({
  sourceRoot: source,
  targetRoot: target,
  paths = seedOnlyPaths,
}: {
  sourceRoot: string
  targetRoot: string
  paths?: string[]
}): {
  missingSeed: string[]
  customized: string[]
  identical: string[]
} {
  const missingSeed: string[] = []
  const customized: string[] = []
  const identical: string[] = []

  for (const filePath of expandSeedOnlyFiles(source, paths)) {
    const sourceFile = join(source, filePath)
    const targetFile = join(target, filePath)
    if (!existsSync(sourceFile)) continue

    if (!existsSync(targetFile)) {
      missingSeed.push(filePath)
      continue
    }

    if (digestFile(sourceFile) === digestFile(targetFile)) {
      identical.push(filePath)
    } else {
      customized.push(filePath)
    }
  }

  return { missingSeed, customized, identical }
}

export function compareMergeKeepDrift({
  sourceRoot: source,
  targetRoot: target,
  paths = mergeKeepPaths,
}: {
  sourceRoot: string
  targetRoot: string
  paths?: string[]
}): {
  missing: string[]
  changed: string[]
  identical: string[]
} {
  const missing: string[] = []
  const changed: string[] = []
  const identical: string[] = []

  for (const relativePath of paths) {
    const sourcePath = join(source, relativePath)
    if (!existsSync(sourcePath)) continue

    const targetPath = join(target, relativePath)
    if (!existsSync(targetPath)) {
      missing.push(relativePath)
      continue
    }

    const sourceContent = readFileSync(sourcePath, 'utf8')
    const targetContent = readFileSync(targetPath, 'utf8')
    const { changed: wouldChange } = mergeGitignoreKeepTarget(sourceContent, targetContent)

    if (wouldChange) {
      changed.push(relativePath)
    } else {
      identical.push(relativePath)
    }
  }

  return { missing, changed, identical }
}

export function compareBoilerplateDriftByMode({
  sourceRoot: source,
  targetRoot: target,
  mode = SYNC_MODES.HARNESS_ONLY,
}: {
  sourceRoot: string
  targetRoot: string
  mode?: SyncMode
}): DriftReport {
  const managed = compareBoilerplateDrift({ sourceRoot: source, targetRoot: target, paths: managedPaths })
  const mergeKeep = compareMergeKeepDrift({ sourceRoot: source, targetRoot: target, paths: mergeKeepPaths })
  const packageProposal = comparePackageProposalDrift({ sourceRoot: source, targetRoot: target })
  const toolchain = compareToolchainContractDrift({ sourceRoot: source, targetRoot: target })
  const seedOnlyPathsSkipped = mode === SYNC_MODES.HARNESS_ONLY
  const seed = seedOnlyPathsSkipped
    ? { missingSeed: [], customized: [], identical: [], skipped: true }
    : { ...compareSeedOnlyDrift({ sourceRoot: source, targetRoot: target, paths: seedOnlyPaths }), skipped: false }

  return { managed, seed, mergeKeep, packageProposal, toolchain, syncMode: mode, seedOnlyPathsSkipped }
}

export function compareFullBoilerplateDrift({
  sourceRoot: source,
  targetRoot: target,
  mode = SYNC_MODES.FULL,
}: {
  sourceRoot: string
  targetRoot: string
  mode?: SyncMode
}): DriftReport {
  return compareBoilerplateDriftByMode({ sourceRoot: source, targetRoot: target, mode })
}

interface DriftReport {
  managed: { missing: string[]; changed: string[]; identical: string[] }
  seed: { missingSeed: string[]; customized: string[]; identical: string[]; skipped: boolean }
  mergeKeep: { missing: string[]; changed: string[]; identical: string[] }
  packageProposal: { proposal: PackageSyncProposal; markdown: string } | null
  toolchain: string[]
  syncMode: SyncMode
  seedOnlyPathsSkipped: boolean
}

export function getDriftExitCode(report: {
  managed: { missing: string[]; changed: string[]; identical?: string[] }
  seed: { missingSeed: string[]; customized?: string[]; identical?: string[]; skipped?: boolean }
  mergeKeep: { missing: string[]; changed: string[]; identical?: string[] }
  packageProposal?: unknown
  toolchain?: string[]
  seedOnlyPathsSkipped?: boolean
}): number {
  const hasManagedDrift = report.managed.missing.length > 0 || report.managed.changed.length > 0
  const hasMissingSeed = !report.seedOnlyPathsSkipped && report.seed.missingSeed.length > 0
  const hasMergeKeepDrift = report.mergeKeep.missing.length > 0 || report.mergeKeep.changed.length > 0
  const hasToolchainDrift = (report.toolchain?.length ?? 0) > 0

  if (hasManagedDrift || hasMissingSeed || hasMergeKeepDrift || hasToolchainDrift) return 1
  return 0
}
