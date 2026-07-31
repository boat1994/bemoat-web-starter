#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

import {
  buildPackageSyncProposal,
  expandSeedOnlyFiles,
  formatPackageSyncProposal,
  listPathFiles,
  managedPaths,
  mergeGitignoreKeepTarget,
  mergeKeepPaths,
  parseSyncMode,
  seedOnlyPaths,
  SYNC_MODES,
} from './sync-boilerplate.mjs'

export { SYNC_MODES }

const repo = process.env.BEMOAT_BOILERPLATE_REPO || 'boat1994/bemoat-web-starter'
const ref = process.env.BEMOAT_BOILERPLATE_REF || 'main'
const targetRoot = process.cwd()
const tempRoot = resolve(targetRoot, '.bemoat-check-tmp')
const sourceRoot = join(tempRoot, 'source')

function isGitRepositoryRoot(cwd) {
  try {
    const topLevel = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()

    return resolve(topLevel) === resolve(cwd)
  } catch {
    return false
  }
}

function getGitOriginRepo(cwd) {
  const remote = execFileSync('git', ['remote', 'get-url', 'origin'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()

  return remote
    .replace(/\.git$/, '')
    .replace(/^git@github.com:/, 'https://github.com/')
    .replace(/^https:\/\/github.com\//, '')
    .toLowerCase()
}

export function isBoilerplateSourceRepository(cwd = process.cwd(), boilerplateRepo = repo) {
  const packagePath = join(cwd, 'package.json')
  if (!existsSync(packagePath)) return false

  try {
    const pkg = readJSON(packagePath)
    if (pkg.name !== 'bemoat-web-starter') return false
  } catch {
    return false
  }

  if (!isGitRepositoryRoot(cwd)) {
    return true
  }

  try {
    const originRepo = getGitOriginRepo(cwd)
    return originRepo.endsWith(boilerplateRepo.toLowerCase())
  } catch {
    return true
  }
}

function run(command, args, options = {}) {
  execFileSync(command, args, {
    stdio: 'inherit',
    ...options,
  })
}

function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/**
 * Strip JSONC comments and trailing commas for deterministic JSON.parse.
 * Comment markers are recognized only outside quoted strings.
 * Structural trailing commas are removed only outside quoted strings.
 */
export function stripJsoncComments(content) {
  let output = ''
  let index = 0
  let inString = false
  let escaped = false

  const isJsonWhitespace = (char) =>
    char === ' ' || char === '\t' || char === '\n' || char === '\r'

  const skipCommentAt = (startIndex) => {
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

  const nextStructuralIndex = (fromIndex) => {
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
      index = skipCommentAt(index)
      continue
    }

    if (char === '/' && next === '*') {
      index = skipCommentAt(index)
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

function parseJsonc(content) {
  return JSON.parse(stripJsoncComments(content))
}

function digestFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function digestPath(root, relativePath) {
  const fullPath = join(root, relativePath)
  if (!existsSync(fullPath)) return null

  const stat = statSync(fullPath)
  if (!stat.isDirectory()) return digestFile(fullPath)

  return listPathFiles(root, relativePath)
    .map((filePath) => `${filePath}:${digestFile(join(root, filePath))}`)
    .join('\n')
}

function getPackageProposalReport(source, target) {
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
}) {
  const missing = []
  const changed = []
  const identical = []

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

export function comparePackageProposalDrift({ sourceRoot: source, targetRoot: target }) {
  return getPackageProposalReport(source, target)
}

export function compareToolchainContractDrift({ sourceRoot: source, targetRoot: target }) {
  const contractPath = join(source, '.bemoat/toolchain-contract.json')
  const targetPackagePath = join(target, 'package.json')
  const targetConfigPath = join(target, 'tsconfig.json')
  if (!existsSync(contractPath) || !existsSync(targetPackagePath) || !existsSync(targetConfigPath)) return []

  const contract = readJSON(contractPath)
  const targetPackage = readJSON(targetPackagePath)
  const targetConfig = parseJsonc(readFileSync(targetConfigPath, 'utf8'))
  const drift = []

  if (targetPackage.devDependencies?.typescript !== contract.typescript) {
    drift.push(`package.json TypeScript must pin ${contract.typescript}`)
  }
  if (targetPackage.scripts?.['bemoat:typecheck'] !== 'node scripts/bemoat-typecheck.mjs') {
    drift.push('package.json bemoat:typecheck must match the managed toolchain contract')
  }
  if (targetConfig.compilerOptions?.strict !== true || targetConfig.compilerOptions?.strictNullChecks === false) {
    drift.push('tsconfig.json must preserve strict mode and effective strictNullChecks')
  }
  return drift
}

export function compareSeedOnlyDrift({
  sourceRoot: source,
  targetRoot: target,
  paths = seedOnlyPaths,
}) {
  const missingSeed = []
  const customized = []
  const identical = []

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
}) {
  const missing = []
  const changed = []
  const identical = []

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
}) {
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

export function compareFullBoilerplateDrift({ sourceRoot: source, targetRoot: target, mode = SYNC_MODES.FULL }) {
  return compareBoilerplateDriftByMode({ sourceRoot: source, targetRoot: target, mode })
}

export function getDriftExitCode(report) {
  const hasManagedDrift = report.managed.missing.length > 0 || report.managed.changed.length > 0
  const hasMissingSeed = !report.seedOnlyPathsSkipped && report.seed.missingSeed.length > 0
  const hasMergeKeepDrift = report.mergeKeep.missing.length > 0 || report.mergeKeep.changed.length > 0
  const hasToolchainDrift = report.toolchain?.length > 0

  if (hasManagedDrift || hasMissingSeed || hasMergeKeepDrift || hasToolchainDrift) return 1
  return 0
}

function printReport(report) {
  const hasManagedDrift = report.managed.missing.length > 0 || report.managed.changed.length > 0
  const hasMissingSeed = !report.seedOnlyPathsSkipped && report.seed.missingSeed.length > 0
  const hasCustomizedSeed = !report.seedOnlyPathsSkipped && report.seed.customized.length > 0
  const hasMergeKeepDrift = report.mergeKeep.missing.length > 0 || report.mergeKeep.changed.length > 0

  console.log(`Checking boilerplate drift against ${repo}#${ref}`)
  console.log(`Sync mode: ${report.syncMode}`)
  if (report.seedOnlyPathsSkipped) {
    console.log('Seed-only starter modules skipped in harness-only mode')
  }
  console.log('')

  if (!hasManagedDrift && !hasMissingSeed && !hasCustomizedSeed && !hasMergeKeepDrift && !report.packageProposal) {
    console.log('No drift found.')
    console.log(`Identical managed paths: ${report.managed.identical.length}`)
    if (!report.seedOnlyPathsSkipped) {
      console.log(`Identical seed files: ${report.seed.identical.length}`)
    }
    return
  }

  const managedDrift = [...report.managed.missing, ...report.managed.changed]

  if (managedDrift.length > 0) {
    console.log('Managed drift:')
    for (const path of managedDrift) console.log(`- ${path}`)
    console.log('')
  }

  if (hasMissingSeed) {
    console.log('Missing seed files:')
    for (const path of report.seed.missingSeed) console.log(`- ${path}`)
    console.log('')
  }

  if (hasCustomizedSeed) {
    console.log('Customized seed files ignored:')
    for (const path of report.seed.customized) console.log(`- ${path}`)
    console.log('')
  }

  if (hasMergeKeepDrift) {
    console.log('Merge-keep drift (child content preserved; starter adds missing entries):')
    for (const path of [...report.mergeKeep.missing, ...report.mergeKeep.changed]) console.log(`- ${path}`)
    console.log('')
  }

  if (report.packageProposal) {
    console.log('Package sync proposal (informational; package.json is child-owned):')
    console.log('Review script and dependency drift in .bemoat/package-sync-proposal.md (human review only)')
    console.log('')
  }

  if (hasManagedDrift || hasMissingSeed || hasMergeKeepDrift) {
    console.log('Suggested next command:')
    console.log(`pnpm run boilerplate:sync -- --${report.syncMode}`)
    console.log('\nAfter sync, run:')
    console.log('pnpm install')
  }
}

export function isDirectExecution() {
  const entrypoint = process.argv[1]

  if (!entrypoint) return false

  return import.meta.url === pathToFileURL(resolve(entrypoint)).href
}

function main() {
  if (isBoilerplateSourceRepository(targetRoot, repo)) {
    console.log('Skipping boilerplate drift check in bemoat-web-starter (source repository).')
    console.log('This command compares child projects against upstream boilerplate.')
    console.log('In the starter repo, use git diff and CI instead of boilerplate:check.')
    process.exit(0)
  }

  const syncMode = parseSyncMode()

  try {
    rmSync(tempRoot, { recursive: true, force: true })
    mkdirSync(tempRoot, { recursive: true })

    run('git', ['clone', '--depth', '1', '--branch', ref, `https://github.com/${repo}.git`, sourceRoot], {
      cwd: targetRoot,
    })

    const report = compareBoilerplateDriftByMode({ sourceRoot, targetRoot, mode: syncMode })
    printReport(report)

    process.exit(getDriftExitCode(report))
  } catch (error) {
    console.error('Unable to fetch or compare boilerplate source.')
    if (error instanceof Error) console.error(error.message)
    process.exit(2)
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
}

if (isDirectExecution()) main()
