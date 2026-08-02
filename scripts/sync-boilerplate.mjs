#!/usr/bin/env node
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { assertManagedRuntimeDeliveryClosure } from './guard-harness-contract.mjs'
import { resolveChildSyncCommandGate } from './mission-control-reconcile.mjs'
import {
  SYNC_MODES,
  getSourceSyncConfig,
  parseApplyBuildContract,
  parseSyncMode,
} from './boilerplate/config.mjs'
import {
  managedPaths,
  packageSyncProposalPath,
} from './boilerplate/inventory.mjs'
import {
  applyBuildContractFiles,
  applyBuildContractScripts,
  applyManagedPackageScripts,
  assertExactManagedPackageScripts,
  assertToolchainContract,
  buildPackageSyncProposal,
  buildSyncMetadata,
  copyManagedPath,
  copySeedOnlyPath,
  formatPackageSyncProposal,
  isFirstToolchainBootstrap,
  mergeGitignoreKeepTarget,
  mergeKeepPath,
  normalizeGitignoreLine,
  readJSON,
  runToolchainPreflight,
  syncMetadataPath,
  syncPackageManifest,
  syncPathsFromSource,
} from './boilerplate/filesystem.mjs'

export {
  SYNC_MODES,
  getDefaultSyncConfig,
  getSourceSyncConfig,
  parseApplyBuildContract,
  parseSyncMode,
  readSourceSyncManifest,
} from './boilerplate/config.mjs'
export {
  buildContractFilePaths,
  buildContractPackageScripts,
  exactManagedPackageScripts,
  expandSeedOnlyFiles,
  listPathFiles,
  managedPackageScripts,
  managedPaths,
  mergeKeepPaths,
  packageSyncProposalPath,
  seedOnlyPaths,
  suggestedPackageScripts,
  suggestedPackageSections,
  syncManifestPath,
} from './boilerplate/inventory.mjs'

export {
  applyBuildContractFiles,
  applyBuildContractScripts,
  applyManagedPackageScripts,
  assertExactManagedPackageScripts,
  assertToolchainContract,
  buildPackageSyncProposal,
  buildSyncMetadata,
  copyManagedPath,
  copySeedOnlyPath,
  formatPackageSyncProposal,
  isFirstToolchainBootstrap,
  mergeGitignoreKeepTarget,
  mergeKeepPath,
  normalizeGitignoreLine,
  runToolchainPreflight,
  syncPackageManifest,
  syncPathsFromSource,
}

const repo = process.env.BEMOAT_BOILERPLATE_REPO || 'boat1994/bemoat-web-starter'
const ref = process.env.BEMOAT_BOILERPLATE_REF || 'main'
const targetRoot = process.cwd()
const tempRoot = resolve(targetRoot, '.bemoat-sync-tmp')
const sourceRoot = join(tempRoot, 'source')
const stashMessage = 'bemoat-boilerplate-sync: pre-sync stash'

export const syncCommitPaths = [...managedPaths, syncMetadataPath, packageSyncProposalPath]


function run(command, args, options = {}) {
  execFileSync(command, args, {
    stdio: 'inherit',
    ...options,
  })
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

export function commitValidatedSyncChanges(options, { validate = () => {}, git = createGitClient() } = {}) {
  validate()
  return commitSyncedChanges(options, git)
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

function printSyncReport({
  syncMode,
  seedOnlyPathsSkipped,
  syncedManaged,
  seededFiles,
  skippedSeedFiles,
  mergedFiles,
  packageSync,
  buildContractFiles,
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

  const appliedBuildContract = [
    ...(packageSync?.appliedBuildContractScripts ?? []),
    ...(packageSync?.updatedBuildContractScripts ?? []),
  ]

  if (appliedBuildContract.length > 0) {
    console.log(`- applied build contract scripts: ${appliedBuildContract.join(', ')}`)
  }

  const appliedBuildContractFiles = [
    ...(buildContractFiles?.applied ?? []),
    ...(buildContractFiles?.updated ?? []),
  ]

  if (appliedBuildContractFiles.length > 0) {
    console.log(`- applied build contract files: ${appliedBuildContractFiles.join(', ')}`)
  }

  if (packageSync?.proposalPath) {
    console.log(`- review suggested script/dependency changes in ${packageSync.proposalPath}`)
  }
}

export function getSuggestedNextCommands(
  syncMode,
  { proposalPath = undefined, applyBuildContract = false } = {},
) {
  const lines = []

  if (proposalPath) {
    if (applyBuildContract) {
      lines.push(
        `Review remaining drift in ${proposalPath} (build contract scripts and files were applied automatically)`,
      )
    } else {
      lines.push(`Review ${proposalPath} and apply any package.json changes manually`)
    }
  }

  if (applyBuildContract) {
    lines.push(
      'Review src/payload.config.ts for build context detection (child-owned; see docs/boilerplate-sync-command.md)',
    )
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

function printSuggestedNextCommands(syncMode, packageSync, applyBuildContract = false) {
  console.log('\nDone. Suggested next commands:')
  for (const line of getSuggestedNextCommands(syncMode, {
    proposalPath: packageSync?.proposalPath,
    applyBuildContract,
  })) {
    console.log(line)
  }
}

/**
 * Mission Control transition child-sync gate.
 *
 * Default: enforced for every `boilerplate:sync` / `bemoat:boilerplate:sync`
 * invocation (including bare `node scripts/sync-boilerplate.mjs`). Sync is
 * blocked until #182/#184 are merged/green, live child state is reconstructed,
 * and a fresh child-sync HANDOFF exists.
 *
 * Explicit bypass (escape hatch only):
 *   --skip-mc-transition-gate
 *   BEMOAT_SKIP_MC_TRANSITION_CHILD_SYNC_GATE=1
 *
 * Legacy `--require-mc-transition-gate` /
 * `BEMOAT_REQUIRE_MC_TRANSITION_CHILD_SYNC_GATE=1` remain accepted no-ops
 * because enforcement is now the default.
 */
export function enforceMcTransitionChildSyncGate({
  argv = process.argv.slice(2),
  env = process.env,
} = {}) {
  const skip =
    argv.includes('--skip-mc-transition-gate') ||
    env.BEMOAT_SKIP_MC_TRANSITION_CHILD_SYNC_GATE === '1'
  const enforce = !skip
  return resolveChildSyncCommandGate({
    enforce,
    issues182Merged: env.BEMOAT_CHILD_SYNC_182_MERGED === '1',
    issues184Merged: env.BEMOAT_CHILD_SYNC_184_MERGED === '1',
    liveChildReconstructed: env.BEMOAT_CHILD_SYNC_LIVE_RECONSTRUCTED === '1',
    freshHandoffIssued: env.BEMOAT_CHILD_SYNC_FRESH_HANDOFF === '1',
  })
}

function main() {
  enforceMcTransitionChildSyncGate()
  const syncMode = parseSyncMode()
  const applyBuildContract = parseApplyBuildContract()
  console.log(`Syncing Bemoat boilerplate from ${repo}#${ref} (${syncMode} mode)`)
  const git = createGitClient()
  let stashCreated = false

  try {
    rmSync(tempRoot, { recursive: true, force: true })
    mkdirSync(tempRoot, { recursive: true })

    run('git', ['clone', '--depth', '1', '--branch', ref, `https://github.com/${repo}.git`, sourceRoot], {
      cwd: targetRoot,
    })

    const syncConfig = getSourceSyncConfig(sourceRoot)
    const sourcePackage = readJSON(join(sourceRoot, 'package.json'))
    const targetPackage = readJSON(join(targetRoot, 'package.json'))
    // Existing public typecheck scripts are a bootstrap gate, not a mutable rail.
    assertExactManagedPackageScripts(sourcePackage, targetPackage)
    // A pre-contract child cannot satisfy rails that have not been copied yet.
    // Only a completely absent rail set is allowed to bootstrap; partial rails fail closed.
    runToolchainPreflight({ targetRootPath: targetRoot, contractRootPath: sourceRoot })

    stashCreated = stashWorkingTreeIfNeeded(targetRoot, git)

    if (applyBuildContract) {
      console.log(
        `Applying build contract scripts: ${syncConfig.buildContractPackageScripts.join(', ')}`,
      )
      console.log(`Applying build contract files: ${syncConfig.buildContractFilePaths.join(', ')}`)
    }

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
      syncConfig,
      assertManagedRuntimeDeliveryClosure,
    })

    const packageSync = syncPackageManifest({
      sourceRootPath: sourceRoot,
      targetRootPath: targetRoot,
      repo,
      ref,
      applyBuildContract,
      syncConfig,
    })

    const buildContractFiles = applyBuildContract
      ? applyBuildContractFiles(sourceRoot, targetRoot, syncConfig.buildContractFilePaths)
      : { applied: [], updated: [], skipped: [] }

    if (buildContractFiles.applied.length > 0) {
      console.log(`[sync] applied build contract files: ${buildContractFiles.applied.join(', ')}`)
    }
    if (buildContractFiles.updated.length > 0) {
      console.log(`[sync] updated build contract files: ${buildContractFiles.updated.join(', ')}`)
    }

    if (packageSync.packageChanged) {
      if (packageSync.addedScripts.length > 0) {
        console.log(`[sync] added missing bemoat:* scripts: ${packageSync.addedScripts.join(', ')}`)
      }
      if (packageSync.appliedBuildContractScripts?.length > 0) {
        console.log(
          `[sync] added build contract scripts: ${packageSync.appliedBuildContractScripts.join(', ')}`,
        )
      }
      if (packageSync.updatedBuildContractScripts?.length > 0) {
        console.log(
          `[sync] updated build contract scripts: ${packageSync.updatedBuildContractScripts.join(', ')}`,
        )
      }
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
          buildContractFiles,
          syncConfig,
        }),
        null,
        2,
      )}\n`,
    )

    rmSync(tempRoot, { recursive: true, force: true })

    const pathsToCommit = [
      ...syncedManaged,
      ...seededFiles,
      ...mergedFiles,
      ...buildContractFiles.applied,
      ...buildContractFiles.updated,
    ]
    if (commitValidatedSyncChanges(
      {
        repo,
        ref,
        targetRoot,
        syncedPaths: pathsToCommit,
        includePackageJson: packageSync.packageChanged,
      }, {
        git,
        // The copied rails must still satisfy the contract before they can be committed or reported.
        validate: () => assertToolchainContract({ targetRootPath: targetRoot }),
      },
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
      buildContractFiles,
    })

    printSuggestedNextCommands(syncMode, packageSync, applyBuildContract)
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
    restoreStashIfNeeded(targetRoot, stashCreated, git)
  }
}

if (isDirectExecution()) main()
