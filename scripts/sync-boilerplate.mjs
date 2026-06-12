#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const repo = process.env.BEMOAT_BOILERPLATE_REPO || 'boat1994/bemoat-web-starter'
const ref = process.env.BEMOAT_BOILERPLATE_REF || 'main'
const targetRoot = process.cwd()
const tempRoot = resolve(targetRoot, '.bemoat-sync-tmp')
const sourceRoot = join(tempRoot, 'source')
const syncMetadataPath = '.bemoat-boilerplate-sync.json'
const stashMessage = 'bemoat-boilerplate-sync: pre-sync stash'

export const managedPaths = [
  // Agent and workflow rails
  'AGENTS.md',
  '.cursor/rules',
  'docs/agent-loop',
  'docs/hardening.md',
  'docs/releases.md',
  'docs/deploy-smoke-test.md',

  // GitHub workflow rails
  '.github/workflows/ci.yml',
  '.github/pull_request_template.md',
  '.github/ISSUE_TEMPLATE/agent-task.yml',

  // Sync docs and scripts
  'scripts/sync-boilerplate.mjs',
  'scripts/check-boilerplate-drift.mjs',
  'scripts/deploy-smoke-test.mjs',
  'docs/dev-boilerplate.md',
]

export const seedOnlyPaths = [
  'src/app/(frontend)',
  'src/components',
  'src/collections',
  'src/globals',
  'src/hooks',
  'src/access',
  'src/lib',
  'src/payload.config.ts',
]

export const packageSections = ['dependencies', 'devDependencies']
export const packageScripts = [
  // Validation rails
  'check',
  'check:full',
  'typecheck',
  'lint',
  'test',
  'test:int',
  // Payload and sync
  'generate:importmap',
  'generate:types',
  'generate:types:cloudflare',
  'generate:types:payload',
  'payload',
  'boilerplate:sync',
  'boilerplate:check',
]

export const syncCommitPaths = [...managedPaths, 'package.json', syncMetadataPath]

export function listPathFiles(root, relativePath = '') {
  const fullPath = join(root, relativePath)
  if (!existsSync(fullPath)) return []

  const stat = statSync(fullPath)
  if (!stat.isDirectory()) return [relativePath]

  const files = []
  for (const entry of readdirSync(fullPath, { withFileTypes: true })) {
    const childPath = relativePath ? `${relativePath}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      files.push(...listPathFiles(root, childPath))
    } else {
      files.push(childPath)
    }
  }

  return files.sort()
}

export function expandSeedOnlyFiles(root, paths = seedOnlyPaths) {
  const files = new Set()

  for (const relativePath of paths) {
    for (const filePath of listPathFiles(root, relativePath)) {
      files.add(filePath)
    }
  }

  return [...files].sort()
}

function run(command, args, options = {}) {
  execFileSync(command, args, {
    stdio: 'inherit',
    ...options,
  })
}

export function copyManagedPath(sourceRootPath, targetRootPath, relativePath) {
  const source = join(sourceRootPath, relativePath)
  const destination = join(targetRootPath, relativePath)

  if (!existsSync(source)) {
    return { copied: false, reason: 'missing-source' }
  }

  mkdirSync(dirname(destination), { recursive: true })
  cpSync(source, destination, { recursive: true, force: true })
  return { copied: true }
}

export function copySeedOnlyPath(sourceRootPath, targetRootPath, relativePath) {
  const source = join(sourceRootPath, relativePath)

  if (!existsSync(source)) {
    return { seeded: [], skipped: [], reason: 'missing-source' }
  }

  const seeded = []
  const skipped = []
  const sourceFiles = listPathFiles(sourceRootPath, relativePath)

  for (const filePath of sourceFiles) {
    const sourceFile = join(sourceRootPath, filePath)
    const destinationFile = join(targetRootPath, filePath)

    if (existsSync(destinationFile)) {
      skipped.push(filePath)
      continue
    }

    mkdirSync(dirname(destinationFile), { recursive: true })
    cpSync(sourceFile, destinationFile)
    seeded.push(filePath)
  }

  return { seeded, skipped }
}

function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function mergePackageJSON() {
  const sourcePackagePath = join(sourceRoot, 'package.json')
  const targetPackagePath = join(targetRoot, 'package.json')

  if (!existsSync(sourcePackagePath) || !existsSync(targetPackagePath)) return

  const sourcePackage = readJSON(sourcePackagePath)
  const targetPackage = readJSON(targetPackagePath)

  targetPackage.scripts = targetPackage.scripts || {}
  for (const scriptName of packageScripts) {
    if (sourcePackage.scripts?.[scriptName]) {
      targetPackage.scripts[scriptName] = sourcePackage.scripts[scriptName]
    }
  }

  for (const section of packageSections) {
    targetPackage[section] = targetPackage[section] || {}
    Object.assign(targetPackage[section], sourcePackage[section] || {})
  }

  writeFileSync(targetPackagePath, `${JSON.stringify(targetPackage, null, 2)}\n`)
  console.log('[sync] package.json scripts and dependencies')
}

function getCommandOutput(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: targetRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  })
}

function getCommandStatus(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: targetRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  })

  if (result.error) throw result.error
  return result.status ?? 1
}

function getScopedGitPathArgs(paths) {
  return ['--', '.', ...paths.map((path) => `:(exclude)${path}`)]
}

function createGitClient() {
  return {
    hasWorkingTreeChanges(cwd, excludedPaths = []) {
      return getCommandOutput('git', ['status', '--short', ...getScopedGitPathArgs(excludedPaths)], { cwd }).trim().length > 0
    },
    stashPush(cwd, excludedPaths = []) {
      run('git', ['stash', 'push', '--include-untracked', '-m', stashMessage, ...getScopedGitPathArgs(excludedPaths)], { cwd })
    },
    addPaths(cwd, paths) {
      run('git', ['add', '--', ...paths], { cwd })
    },
    hasStagedChanges(cwd, paths) {
      const status = getCommandStatus('git', ['diff', '--cached', '--quiet', '--', ...paths], { cwd })

      if (status === 0) return false
      if (status === 1) return true

      throw new Error('Unable to determine staged sync changes')
    },
    commit(cwd, message) {
      run('git', ['commit', '-m', message], { cwd })
    },
    stashPop(cwd) {
      run('git', ['stash', 'pop'], { cwd })
    },
  }
}

export function getSyncCommitPaths(pathsSynced = managedPaths) {
  return [...pathsSynced, 'package.json', syncMetadataPath]
}

export function stashWorkingTreeIfNeeded(cwd, git = createGitClient()) {
  const excludedPaths = getSyncCommitPaths()

  if (!git.hasWorkingTreeChanges(cwd, excludedPaths)) return false

  git.stashPush(cwd, excludedPaths)
  return true
}

export function commitSyncedChanges({ repo, ref, targetRoot, syncedPaths = managedPaths }, git = createGitClient()) {
  const pathsToCommit = getSyncCommitPaths(syncedPaths)

  git.addPaths(targetRoot, pathsToCommit)

  if (!git.hasStagedChanges(targetRoot, pathsToCommit)) return false

  git.commit(targetRoot, `sync boilerplate from ${repo}#${ref}`)
  return true
}

export function restoreStashIfNeeded(cwd, stashCreated, git = createGitClient()) {
  if (!stashCreated) return

  git.stashPop(cwd)
}

export function isDirectExecution() {
  const entrypoint = process.argv[1]

  if (!entrypoint) return false

  return import.meta.url === pathToFileURL(resolve(entrypoint)).href
}

function printSyncReport({ syncedManaged, seededFiles, skippedSeedFiles }) {
  console.log('\nSynced managed paths:')
  if (syncedManaged.length === 0) {
    console.log('- (none)')
  } else {
    for (const path of syncedManaged) console.log(`- ${path}`)
  }

  console.log('\nSeeded missing starter files:')
  if (seededFiles.length === 0) {
    console.log('- (none)')
  } else {
    for (const path of seededFiles) console.log(`- ${path}`)
  }

  console.log('\nSkipped existing seed files:')
  if (skippedSeedFiles.length === 0) {
    console.log('- (none)')
  } else {
    for (const path of skippedSeedFiles) console.log(`- ${path}`)
  }
}

function main() {
  console.log(`Syncing Bemoat boilerplate from ${repo}#${ref}`)
  const git = createGitClient()
  const stashCreated = stashWorkingTreeIfNeeded(targetRoot, git)
  const syncedManaged = []
  const seededFiles = []
  const skippedSeedFiles = []

  try {
    rmSync(tempRoot, { recursive: true, force: true })
    mkdirSync(tempRoot, { recursive: true })

    run('git', ['clone', '--depth', '1', '--branch', ref, `https://github.com/${repo}.git`, sourceRoot], {
      cwd: targetRoot,
    })

    for (const path of managedPaths) {
      const result = copyManagedPath(sourceRoot, targetRoot, path)
      if (result.copied) syncedManaged.push(path)
    }

    for (const path of seedOnlyPaths) {
      const result = copySeedOnlyPath(sourceRoot, targetRoot, path)
      if (result.reason === 'missing-source') {
        console.warn(`[skip] ${path} not found in ${repo}#${ref}`)
        continue
      }

      seededFiles.push(...result.seeded)
      skippedSeedFiles.push(...result.skipped)
    }

    mergePackageJSON()

    writeFileSync(
      join(targetRoot, syncMetadataPath),
      `${JSON.stringify(
        {
          repo,
          ref,
          syncedAt: new Date().toISOString(),
          managedPaths,
          seedOnlyPaths,
          lastSyncedManagedPaths: syncedManaged,
          seededFiles,
          skippedSeedFiles,
        },
        null,
        2,
      )}\n`,
    )

    rmSync(tempRoot, { recursive: true, force: true })

    const pathsToCommit = [...syncedManaged, ...seededFiles]
    if (commitSyncedChanges({ repo, ref, targetRoot, syncedPaths: pathsToCommit }, git)) {
      console.log('[sync] committed sync changes')
    } else {
      console.log('[sync] no sync changes to commit')
    }

    printSyncReport({ syncedManaged, seededFiles, skippedSeedFiles })

    console.log('\nDone. Suggested next commands:')
    console.log('pnpm install')
    console.log('pnpm run generate:importmap')
    console.log('pnpm run generate:types')
    console.log('pnpm payload migrate:create')
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
    restoreStashIfNeeded(targetRoot, stashCreated, git)
  }
}

if (isDirectExecution()) main()
