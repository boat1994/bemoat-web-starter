#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const SYNC_MODES = {
  HARNESS_ONLY: 'harness-only',
  FULL: 'full',
}

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
  'docs/cloudflare-environments.md',
  'docs/schema-evolution.md',
  'docs/dev-boilerplate.md',
  'docs/boilerplate-sync-command.md',
  'docs/harness-sync-contract.md',
  'docs/guard-pack.md',
  'docs/starter-acceptance-tests.md',

  // GitHub workflow rails
  '.github/workflows/ci.yml',
  '.github/pull_request_template.md',
  '.github/ISSUE_TEMPLATE/agent-task.yml',

  // Harness scripts (sync, drift, guard, hooks, smoke)
  'scripts/sync-boilerplate.mjs',
  'scripts/check-boilerplate-drift.mjs',
  'scripts/deploy-smoke-test.mjs',
  'scripts/guard-repo-safety.mjs',
  'scripts/guard-harness-contract.mjs',
  'scripts/guard-build-script-contract.mjs',
  'scripts/guard-cloudflare-env.mjs',
  'scripts/guard-pack.mjs',
  'scripts/guard-package-manager.mjs',
  'scripts/guard-env-placeholder.mjs',
  'scripts/guard-frontend-seo.mjs',
  'scripts/install-git-hooks.mjs',

  // Local harness hooks and integration tests
  '.githooks',
  'vitest.config.mts',
  'vitest.setup.ts',
  'tests/int/api.int.spec.ts',
  'tests/int/repo-safety-guard.int.spec.ts',
  'tests/int/cloudflare-env-guard.int.spec.ts',
  'tests/int/boilerplate-sync.int.spec.ts',
  'tests/int/harness-contract-guard.int.spec.ts',
  'tests/int/build-script-contract-guard.int.spec.ts',
  'tests/int/guard-pack.int.spec.ts',
  'tests/int/starter-acceptance.int.spec.ts',
  'tests/int/open-next-config.int.spec.ts',
  'tests/fixtures/guard',
  'tests/fixtures/acceptance',
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

/** Paths merged during sync: child content is kept and missing starter entries are appended. */
export const mergeKeepPaths = ['.gitignore']

export const packageSyncProposalPath = '.bemoat/package-sync-proposal.md'

/** Namespaced scripts safe to add when missing during sync. Never overwrite existing entries. */
export const managedPackageScripts = [
  'bemoat:guard:safety',
  'bemoat:guard:pack',
  'bemoat:guard:harness-contract',
  'bemoat:guard:cloudflare-env',
  'bemoat:test:int',
  'bemoat:check',
  'bemoat:boilerplate:sync',
  'bemoat:boilerplate:check',
  'bemoat:hooks:install',
]

/** Non-namespaced scripts surfaced in the package sync proposal only — never auto-applied. */
export const suggestedPackageScripts = [
  'build',
  'cf:build',
  'deploy',
  'deploy:app',
  'deploy:database',
  'deploy:dev',
  'preview',
  'check',
  'check:full',
  'lint',
  'typecheck',
  'test',
  'test:int',
  'dev',
  'start',
]

/** Recommended package.json sections surfaced in the proposal only. */
export const suggestedPackageSections = ['dependencies', 'devDependencies']

export const syncCommitPaths = [...managedPaths, syncMetadataPath, packageSyncProposalPath]

export function parseSyncMode(argv = process.argv.slice(2), env = process.env) {
  const fromEnv = env.BEMOAT_SYNC_MODE
  let fromArgs = null

  if (argv.includes('--harness-only')) fromArgs = SYNC_MODES.HARNESS_ONLY
  if (argv.includes('--full')) fromArgs = SYNC_MODES.FULL

  if (fromArgs && fromEnv && fromArgs !== fromEnv) {
    console.warn(
      `[sync] BEMOAT_SYNC_MODE=${fromEnv} ignored because CLI flag sets mode to ${fromArgs}`,
    )
  }

  const mode = fromArgs || fromEnv || SYNC_MODES.HARNESS_ONLY

  if (mode !== SYNC_MODES.HARNESS_ONLY && mode !== SYNC_MODES.FULL) {
    throw new Error(`Invalid sync mode "${mode}". Use harness-only or full.`)
  }

  return mode
}

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

export function normalizeGitignoreLine(line) {
  return line.trim()
}

export function mergeGitignoreKeepTarget(sourceContent, targetContent) {
  const targetLines = targetContent.split('\n')
  const sourceLines = sourceContent.split('\n')

  const existing = new Set(
    targetLines.map(normalizeGitignoreLine).filter((line) => line.length > 0),
  )

  const addedLines = []
  for (const line of sourceLines) {
    const normalized = normalizeGitignoreLine(line)
    if (normalized.length === 0) continue
    if (existing.has(normalized)) continue

    addedLines.push(line.replace(/\r$/, ''))
    existing.add(normalized)
  }

  if (addedLines.length === 0) {
    return { content: targetContent, addedLines, changed: false }
  }

  const base = targetContent.replace(/\s*$/, '')
  const mergeBlock = ['', '# Added by bemoat boilerplate sync', ...addedLines].join('\n')

  return {
    content: `${base}${mergeBlock}\n`,
    addedLines,
    changed: true,
  }
}

export function mergeKeepPath(sourceRootPath, targetRootPath, relativePath) {
  const source = join(sourceRootPath, relativePath)
  const destination = join(targetRootPath, relativePath)

  if (!existsSync(source)) {
    return { merged: false, reason: 'missing-source', addedLines: [], changed: false, created: false }
  }

  const sourceContent = readFileSync(source, 'utf8')

  if (!existsSync(destination)) {
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, sourceContent.endsWith('\n') ? sourceContent : `${sourceContent}\n`)
    return { merged: true, addedLines: [], changed: false, created: true }
  }

  if (relativePath !== '.gitignore') {
    return { merged: false, reason: 'unsupported-path', addedLines: [], changed: false, created: false }
  }

  const targetContent = readFileSync(destination, 'utf8')
  const mergeResult = mergeGitignoreKeepTarget(sourceContent, targetContent)

  if (!mergeResult.changed) {
    return { merged: false, addedLines: [], changed: false, created: false }
  }

  writeFileSync(destination, mergeResult.content)
  return {
    merged: true,
    addedLines: mergeResult.addedLines,
    changed: true,
    created: false,
  }
}

function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function applyManagedPackageScripts(sourcePackage, targetPackage) {
  const nextPackage = structuredClone(targetPackage)
  nextPackage.scripts = nextPackage.scripts || {}
  const addedScripts = []

  for (const scriptName of managedPackageScripts) {
    const sourceValue = sourcePackage.scripts?.[scriptName]
    if (!sourceValue || scriptName in nextPackage.scripts) continue

    nextPackage.scripts[scriptName] = sourceValue
    addedScripts.push(scriptName)
  }

  return { packageJSON: nextPackage, addedScripts }
}

export function buildPackageSyncProposal(sourcePackage, targetPackage) {
  const missingScripts = []
  const differentScripts = []
  const differentBemoatScripts = []
  const missingSectionEntries = {}
  const differentSectionEntries = {}

  for (const scriptName of managedPackageScripts) {
    const sourceValue = sourcePackage.scripts?.[scriptName]
    const targetValue = targetPackage.scripts?.[scriptName]
    if (!sourceValue || targetValue === undefined) continue

    if (targetValue !== sourceValue) {
      differentBemoatScripts.push({ name: scriptName, source: sourceValue, target: targetValue })
    }
  }

  for (const scriptName of suggestedPackageScripts) {
    const sourceValue = sourcePackage.scripts?.[scriptName]
    if (!sourceValue) continue

    const targetValue = targetPackage.scripts?.[scriptName]
    if (targetValue === undefined) {
      missingScripts.push({ name: scriptName, value: sourceValue })
      continue
    }

    if (targetValue !== sourceValue) {
      differentScripts.push({ name: scriptName, source: sourceValue, target: targetValue })
    }
  }

  for (const section of suggestedPackageSections) {
    const sourceSection = sourcePackage[section] || {}
    const targetSection = targetPackage[section] || {}
    const missing = []
    const different = []

    for (const [name, sourceValue] of Object.entries(sourceSection)) {
      const targetValue = targetSection[name]
      if (targetValue === undefined) {
        missing.push({ name, value: sourceValue })
        continue
      }

      if (targetValue !== sourceValue) {
        different.push({ name, source: sourceValue, target: targetValue })
      }
    }

    if (missing.length > 0) missingSectionEntries[section] = missing
    if (different.length > 0) differentSectionEntries[section] = different
  }

  return {
    missingScripts,
    differentScripts,
    differentBemoatScripts,
    missingSectionEntries,
    differentSectionEntries,
  }
}

export function formatPackageSyncProposal({ repo, ref, proposal }) {
  const lines = [
    '# Bemoat package sync proposal',
    '',
    `Generated from \`${repo}#${ref}\`.`,
    '',
    'This report is informational only. `package.json` is child-owned. Do not apply these changes automatically. Review manually before changing scripts or dependencies.',
    '',
    '## Managed `bemoat:*` scripts',
    '',
    'Sync adds missing namespaced scripts only. Existing `bemoat:*` entries are never overwritten.',
    '',
    '## Script drift report (human review only)',
    '',
  ]

  const hasScriptDrift =
    proposal.missingScripts.length > 0 ||
    proposal.differentScripts.length > 0 ||
    proposal.differentBemoatScripts.length > 0

  if (!hasScriptDrift) {
    lines.push('- No missing or differing scripts to report.')
  } else {
    if (proposal.differentBemoatScripts.length > 0) {
      lines.push('### Existing `bemoat:*` scripts differ from starter')
      lines.push('')
      for (const script of proposal.differentBemoatScripts) {
        lines.push(`- \`${script.name}\``)
        lines.push(`  - starter: \`${script.source}\``)
        lines.push(`  - child: \`${script.target}\``)
      }
      lines.push('')
    }

    if (proposal.missingScripts.length > 0) {
      lines.push('### Missing non-namespaced scripts in child project')
      lines.push('')
      for (const script of proposal.missingScripts) {
        lines.push(`- \`${script.name}\`: \`${script.value}\``)
      }
      lines.push('')
    }

    if (proposal.differentScripts.length > 0) {
      lines.push('### Non-namespaced scripts differ from starter')
      lines.push('')
      for (const script of proposal.differentScripts) {
        lines.push(`- \`${script.name}\``)
        lines.push(`  - starter: \`${script.source}\``)
        lines.push(`  - child: \`${script.target}\``)
      }
      lines.push('')
    }
  }

  lines.push('## Dependency drift report (human review only)', '')

  const hasSectionDrift =
    Object.keys(proposal.missingSectionEntries).length > 0 ||
    Object.keys(proposal.differentSectionEntries).length > 0

  if (!hasSectionDrift) {
    lines.push('- No missing or differing dependencies to report.')
  } else {
    for (const section of suggestedPackageSections) {
      const missing = proposal.missingSectionEntries[section] || []
      const different = proposal.differentSectionEntries[section] || []

      if (missing.length === 0 && different.length === 0) continue

      lines.push(`### ${section}`, '')

      if (missing.length > 0) {
        lines.push('Missing in child project:')
        for (const entry of missing) {
          lines.push(`- \`${entry.name}\`: \`${entry.value}\``)
        }
        lines.push('')
      }

      if (different.length > 0) {
        lines.push('Differs from starter:')
        for (const entry of different) {
          lines.push(`- \`${entry.name}\`: starter \`${entry.source}\`, child \`${entry.target}\``)
        }
        lines.push('')
      }
    }
  }

  lines.push('`pnpm-lock.yaml` is never synced.')

  return `${lines.join('\n')}\n`
}

export function syncPackageManifest({
  sourceRootPath,
  targetRootPath,
  repo: sourceRepo = repo,
  ref: sourceRef = ref,
}) {
  const sourcePackagePath = join(sourceRootPath, 'package.json')
  const targetPackagePath = join(targetRootPath, 'package.json')

  if (!existsSync(sourcePackagePath) || !existsSync(targetPackagePath)) {
    return {
      addedScripts: [],
      proposalPath: null,
      proposal: null,
      packageChanged: false,
    }
  }

  const sourcePackage = readJSON(sourcePackagePath)
  const targetPackage = readJSON(targetPackagePath)
  const { packageJSON, addedScripts } = applyManagedPackageScripts(sourcePackage, targetPackage)
  const proposal = buildPackageSyncProposal(sourcePackage, targetPackage)
  const proposalMarkdown = formatPackageSyncProposal({ repo: sourceRepo, ref: sourceRef, proposal })
  const proposalPath = join(targetRootPath, packageSyncProposalPath)

  mkdirSync(dirname(proposalPath), { recursive: true })
  writeFileSync(proposalPath, proposalMarkdown)

  if (addedScripts.length > 0) {
    writeFileSync(targetPackagePath, `${JSON.stringify(packageJSON, null, 2)}\n`)
  }

  return {
    addedScripts,
    proposalPath: packageSyncProposalPath,
    proposal,
    packageChanged: addedScripts.length > 0,
  }
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

export function getSyncCommitPaths(pathsSynced = managedPaths, { includePackageJson = false } = {}) {
  const paths = [...pathsSynced, syncMetadataPath, packageSyncProposalPath]
  if (includePackageJson) paths.push('package.json')
  return paths
}

export function stashWorkingTreeIfNeeded(cwd, git = createGitClient()) {
  const excludedPaths = getSyncCommitPaths()

  if (!git.hasWorkingTreeChanges(cwd, excludedPaths)) return false

  git.stashPush(cwd, excludedPaths)
  return true
}

export function commitSyncedChanges(
  { repo, ref, targetRoot, syncedPaths = managedPaths, includePackageJson = false },
  git = createGitClient(),
) {
  const pathsToCommit = getSyncCommitPaths(syncedPaths, { includePackageJson })

  git.addPaths(targetRoot, pathsToCommit)

  if (!git.hasStagedChanges(targetRoot, pathsToCommit)) return false

  git.commit(targetRoot, `sync boilerplate from ${repo}#${ref}`)
  return true
}

export function restoreStashIfNeeded(cwd, stashCreated, git = createGitClient()) {
  if (!stashCreated) return

  git.stashPop(cwd)
}

export function buildSyncMetadata({
  repo: sourceRepo = repo,
  ref: sourceRef = ref,
  syncMode,
  seedOnlyPathsSkipped,
  syncedManaged = [],
  seededFiles = [],
  skippedSeedFiles = [],
  mergedFiles = [],
  packageSync = { addedScripts: [], proposalPath: null },
  syncedAt = new Date().toISOString(),
}) {
  return {
    repo: sourceRepo,
    ref: sourceRef,
    syncMode,
    seedOnlyPathsSkipped,
    syncedAt,
    managedPaths,
    seedOnlyPaths,
    mergeKeepPaths,
    managedPackageScripts,
    suggestedPackageScripts,
    suggestedPackageSections,
    lastSyncedManagedPaths: syncedManaged,
    seededFiles,
    skippedSeedFiles,
    mergedFiles,
    packageSync: {
      addedScripts: packageSync.addedScripts,
      proposalPath: packageSync.proposalPath,
    },
  }
}

export function isDirectExecution() {
  const entrypoint = process.argv[1]

  if (!entrypoint) return false

  return import.meta.url === pathToFileURL(resolve(entrypoint)).href
}

export function syncPathsFromSource({
  sourceRootPath,
  targetRootPath,
  mode = SYNC_MODES.HARNESS_ONLY,
  onWarn = console.warn,
  onLog = console.log,
}) {
  const syncedManaged = []
  const seededFiles = []
  const skippedSeedFiles = []
  const mergedFiles = []
  const seedOnlyPathsSkipped = mode === SYNC_MODES.HARNESS_ONLY

  for (const path of managedPaths) {
    const result = copyManagedPath(sourceRootPath, targetRootPath, path)
    if (result.copied) syncedManaged.push(path)
  }

  if (!seedOnlyPathsSkipped) {
    for (const path of seedOnlyPaths) {
      const result = copySeedOnlyPath(sourceRootPath, targetRootPath, path)
      if (result.reason === 'missing-source') {
        onWarn(`[skip] ${path} not found in ${repo}#${ref}`)
        continue
      }

      seededFiles.push(...result.seeded)
      skippedSeedFiles.push(...result.skipped)
    }
  }

  for (const path of mergeKeepPaths) {
    const result = mergeKeepPath(sourceRootPath, targetRootPath, path)
    if (result.reason === 'missing-source') {
      onWarn(`[skip] ${path} not found in ${repo}#${ref}`)
      continue
    }

    if (result.merged && (result.created || result.changed)) {
      mergedFiles.push(path)
      if (result.created) {
        onLog(`[sync] created ${path} from starter`)
      } else if (result.addedLines.length > 0) {
        onLog(`[sync] merged ${path}; added ${result.addedLines.length} starter ignore rule(s)`)
      }
    }
  }

  return {
    syncedManaged,
    seededFiles,
    skippedSeedFiles,
    mergedFiles,
    seedOnlyPathsSkipped,
    syncMode: mode,
  }
}

function printSyncReport({
  syncMode,
  seedOnlyPathsSkipped,
  syncedManaged,
  seededFiles,
  skippedSeedFiles,
  mergedFiles,
  packageSync,
}) {
  console.log(`\nSync mode: ${syncMode}`)
  if (seedOnlyPathsSkipped) {
    console.log('Seed-only starter modules skipped in harness-only mode')
  }

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

  console.log('\nMerged keep-child-content paths:')
  if (mergedFiles.length === 0) {
    console.log('- (none)')
  } else {
    for (const path of mergedFiles) console.log(`- ${path}`)
  }

  console.log('\nPackage manifest (child-owned):')
  if (packageSync?.addedScripts?.length > 0) {
    console.log(`- added missing bemoat:* scripts: ${packageSync.addedScripts.join(', ')}`)
  } else {
    console.log('- no missing bemoat:* scripts added')
  }

  if (packageSync?.proposalPath) {
    console.log(`- review suggested script/dependency changes in ${packageSync.proposalPath}`)
  }
}

export function getSuggestedNextCommands(syncMode, { proposalPath } = {}) {
  const lines = []

  if (proposalPath) {
    lines.push(`Review ${proposalPath} and apply any package.json changes manually`)
  }

  lines.push('pnpm install')

  if (syncMode === SYNC_MODES.FULL) {
    lines.push('pnpm run generate:importmap')
    lines.push('pnpm run generate:types')
    lines.push('pnpm payload migrate:create')
  } else {
    lines.push('pnpm run check')
    lines.push('(or pnpm run bemoat:check if check is not defined yet)')
  }

  return lines
}

function printSuggestedNextCommands(syncMode, packageSync) {
  console.log('\nDone. Suggested next commands:')
  for (const line of getSuggestedNextCommands(syncMode, { proposalPath: packageSync?.proposalPath })) {
    console.log(line)
  }
}

function main() {
  const syncMode = parseSyncMode()
  console.log(`Syncing Bemoat boilerplate from ${repo}#${ref} (${syncMode} mode)`)
  const git = createGitClient()
  const stashCreated = stashWorkingTreeIfNeeded(targetRoot, git)

  try {
    rmSync(tempRoot, { recursive: true, force: true })
    mkdirSync(tempRoot, { recursive: true })

    run('git', ['clone', '--depth', '1', '--branch', ref, `https://github.com/${repo}.git`, sourceRoot], {
      cwd: targetRoot,
    })

    const {
      syncedManaged,
      seededFiles,
      skippedSeedFiles,
      mergedFiles,
      seedOnlyPathsSkipped,
    } = syncPathsFromSource({
      sourceRootPath: sourceRoot,
      targetRootPath: targetRoot,
      mode: syncMode,
    })

    const packageSync = syncPackageManifest({
      sourceRootPath: sourceRoot,
      targetRootPath: targetRoot,
      repo,
      ref,
    })

    if (packageSync.packageChanged) {
      console.log(`[sync] added missing bemoat:* scripts: ${packageSync.addedScripts.join(', ')}`)
    }

    if (packageSync.proposalPath) {
      console.log(`[sync] package sync proposal written to ${packageSync.proposalPath}`)
    }

    writeFileSync(
      join(targetRoot, syncMetadataPath),
      `${JSON.stringify(
        buildSyncMetadata({
          repo,
          ref,
          syncMode,
          seedOnlyPathsSkipped,
          syncedManaged,
          seededFiles,
          skippedSeedFiles,
          mergedFiles,
          packageSync,
        }),
        null,
        2,
      )}\n`,
    )

    rmSync(tempRoot, { recursive: true, force: true })

    const pathsToCommit = [...syncedManaged, ...seededFiles, ...mergedFiles]
    if (commitSyncedChanges(
      {
        repo,
        ref,
        targetRoot,
        syncedPaths: pathsToCommit,
        includePackageJson: packageSync.packageChanged,
      },
      git,
    )) {
      console.log('[sync] committed sync changes')
    } else {
      console.log('[sync] no sync changes to commit')
    }

    printSyncReport({
      syncMode,
      seedOnlyPathsSkipped,
      syncedManaged,
      seededFiles,
      skippedSeedFiles,
      mergedFiles,
      packageSync,
    })

    printSuggestedNextCommands(syncMode, packageSync)
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
    restoreStashIfNeeded(targetRoot, stashCreated, git)
  }
}

if (isDirectExecution()) main()
