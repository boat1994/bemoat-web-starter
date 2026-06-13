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
  seedOnlyPaths,
} from './sync-boilerplate.mjs'

const repo = process.env.BEMOAT_BOILERPLATE_REPO || 'boat1994/bemoat-web-starter'
const ref = process.env.BEMOAT_BOILERPLATE_REF || 'main'
const targetRoot = process.cwd()
const tempRoot = resolve(targetRoot, '.bemoat-check-tmp')
const sourceRoot = join(tempRoot, 'source')

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

export function compareFullBoilerplateDrift({ sourceRoot: source, targetRoot: target }) {
  const managed = compareBoilerplateDrift({ sourceRoot: source, targetRoot: target, paths: managedPaths })
  const seed = compareSeedOnlyDrift({ sourceRoot: source, targetRoot: target, paths: seedOnlyPaths })
  const mergeKeep = compareMergeKeepDrift({ sourceRoot: source, targetRoot: target, paths: mergeKeepPaths })
  const packageProposal = comparePackageProposalDrift({ sourceRoot: source, targetRoot: target })

  return { managed, seed, mergeKeep, packageProposal }
}

export function getDriftExitCode(report) {
  const hasManagedDrift = report.managed.missing.length > 0 || report.managed.changed.length > 0
  const hasMissingSeed = report.seed.missingSeed.length > 0
  const hasMergeKeepDrift = report.mergeKeep.missing.length > 0 || report.mergeKeep.changed.length > 0

  if (hasManagedDrift || hasMissingSeed || hasMergeKeepDrift) return 1
  return 0
}

function printReport(report) {
  const hasManagedDrift = report.managed.missing.length > 0 || report.managed.changed.length > 0
  const hasMissingSeed = report.seed.missingSeed.length > 0
  const hasCustomizedSeed = report.seed.customized.length > 0
  const hasMergeKeepDrift = report.mergeKeep.missing.length > 0 || report.mergeKeep.changed.length > 0

  console.log(`Checking boilerplate drift against ${repo}#${ref}\n`)

  if (!hasManagedDrift && !hasMissingSeed && !hasCustomizedSeed && !hasMergeKeepDrift && !report.packageProposal) {
    console.log('No drift found.')
    console.log(`Identical managed paths: ${report.managed.identical.length}`)
    console.log(`Identical seed files: ${report.seed.identical.length}`)
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
    console.log('Review suggested script and dependency changes after sync in .bemoat/package-sync-proposal.md')
    console.log('')
  }

  if (hasManagedDrift || hasMissingSeed || hasMergeKeepDrift) {
    console.log('Suggested next command:')
    console.log('pnpm run boilerplate:sync')
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

  try {
    rmSync(tempRoot, { recursive: true, force: true })
    mkdirSync(tempRoot, { recursive: true })

    run('git', ['clone', '--depth', '1', '--branch', ref, `https://github.com/${repo}.git`, sourceRoot], {
      cwd: targetRoot,
    })

    const report = compareFullBoilerplateDrift({ sourceRoot, targetRoot })
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
