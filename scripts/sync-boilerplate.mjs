#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

  // GitHub workflow rails
  '.github/workflows/ci.yml',
  '.github/pull_request_template.md',
  '.github/ISSUE_TEMPLATE/agent-task.yml',

  // Sync docs and scripts
  'scripts/sync-boilerplate.mjs',
  'scripts/check-boilerplate-drift.mjs',
  'docs/dev-boilerplate.md',

  // Frontend starter pages
  'src/app/(frontend)/page.tsx',
  'src/app/(frontend)/layout.tsx',
  'src/app/(frontend)/styles.css',
  'src/app/(frontend)/projects/page.tsx',
  'src/app/(frontend)/projects/[slug]/page.tsx',
  'src/app/(frontend)/blog/page.tsx',
  'src/app/(frontend)/blog/[slug]/page.tsx',
  'src/app/(frontend)/how-to-custom-order/page.tsx',

  // Payload shared schema
  'src/collections/BlogCategories.ts',
  'src/collections/BlogMedia.ts',
  'src/collections/Categories.ts',
  'src/collections/Projects.ts',
  'src/collections/Posts.ts',
  'src/collections/Tags.ts',
  'src/components/AiGenerateButton/index.tsx',
  'src/components/BlogAiWorkflow.tsx',
  'src/components/BlogBlockAiGenerate.tsx',
  'src/components/ViewProjectButton/index.tsx',
  'src/globals/CustomOrderPage.ts',
  'src/globals/SiteSettings.ts',

  // Shared utilities
  'src/lib/payloadText.ts',
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

function run(command, args, options = {}) {
  execFileSync(command, args, {
    stdio: 'inherit',
    ...options,
  })
}

function copyPath(relativePath) {
  const source = join(sourceRoot, relativePath)
  const destination = join(targetRoot, relativePath)

  if (!existsSync(source)) {
    console.warn(`[skip] ${relativePath} not found in ${repo}#${ref}`)
    return
  }

  mkdirSync(dirname(destination), { recursive: true })
  cpSync(source, destination, { recursive: true, force: true })
  console.log(`[sync] ${relativePath}`)
  return true
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

function main() {
  console.log(`Syncing Bemoat boilerplate from ${repo}#${ref}`)
  const git = createGitClient()
  const stashCreated = stashWorkingTreeIfNeeded(targetRoot, git)
  const syncedPaths = []

  try {
    rmSync(tempRoot, { recursive: true, force: true })
    mkdirSync(tempRoot, { recursive: true })

    run('git', ['clone', '--depth', '1', '--branch', ref, `https://github.com/${repo}.git`, sourceRoot], {
      cwd: targetRoot,
    })

    for (const path of managedPaths) {
      if (copyPath(path)) syncedPaths.push(path)
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
        },
        null,
        2,
      )}\n`,
    )

    rmSync(tempRoot, { recursive: true, force: true })

    if (commitSyncedChanges({ repo, ref, targetRoot, syncedPaths }, git)) {
      console.log('[sync] committed sync changes')
    } else {
      console.log('[sync] no sync changes to commit')
    }

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
