import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

import { SYNC_MODES, getSourceSyncConfig, parseApplyBuildContract, parseSyncMode } from './config.mjs'
import {
  applyBuildContractFiles,
  assertExactManagedPackageScripts,
  assertToolchainContract,
  buildSyncMetadata,
  readJSON,
  runToolchainPreflight,
  syncMetadataPath,
  syncPackageManifest,
  syncPathsFromSource,
} from './filesystem.mjs'
import {
  commitValidatedSyncChanges,
  createGitClient,
  restoreStashIfNeeded,
  stashWorkingTreeIfNeeded,
} from './git.mjs'

function run(command, args, options = {}) {
  execFileSync(command, args, {
    stdio: 'inherit',
    ...options,
  })
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
  log,
}) {
  log(`\nSync mode: ${syncMode}`)
  if (seedOnlyPathsSkipped) {
    log('Seed-only starter modules skipped in harness-only mode')
  }

  log('\nSynced managed paths:')
  if (syncedManaged.length === 0) {
    log('- (none)')
  } else {
    for (const path of syncedManaged) log(`- ${path}`)
  }

  log('\nSeeded missing starter files:')
  if (seededFiles.length === 0) {
    log('- (none)')
  } else {
    for (const path of seededFiles) log(`- ${path}`)
  }

  log('\nSkipped existing seed files:')
  if (skippedSeedFiles.length === 0) {
    log('- (none)')
  } else {
    for (const path of skippedSeedFiles) log(`- ${path}`)
  }

  log('\nMerged keep-child-content paths:')
  if (mergedFiles.length === 0) {
    log('- (none)')
  } else {
    for (const path of mergedFiles) log(`- ${path}`)
  }

  log('\nPackage manifest (child-owned):')
  if (packageSync?.addedScripts?.length > 0) {
    log(`- added missing bemoat:* scripts: ${packageSync.addedScripts.join(', ')}`)
  } else {
    log('- no missing bemoat:* scripts added')
  }

  const appliedBuildContract = [
    ...(packageSync?.appliedBuildContractScripts ?? []),
    ...(packageSync?.updatedBuildContractScripts ?? []),
  ]

  if (appliedBuildContract.length > 0) {
    log(`- applied build contract scripts: ${appliedBuildContract.join(', ')}`)
  }

  const appliedBuildContractFiles = [
    ...(buildContractFiles?.applied ?? []),
    ...(buildContractFiles?.updated ?? []),
  ]

  if (appliedBuildContractFiles.length > 0) {
    log(`- applied build contract files: ${appliedBuildContractFiles.join(', ')}`)
  }

  if (packageSync?.proposalPath) {
    log(`- review suggested script/dependency changes in ${packageSync.proposalPath}`)
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

function printSuggestedNextCommands(syncMode, packageSync, applyBuildContract, log) {
  log('\nDone. Suggested next commands:')
  for (const line of getSuggestedNextCommands(syncMode, {
    proposalPath: packageSync?.proposalPath,
    applyBuildContract,
  })) {
    log(line)
  }
}

const defaultDependencies = {
  rmSync,
  mkdirSync,
  writeFileSync,
  join,
  run,
  parseSyncMode,
  parseApplyBuildContract,
  createGitClient,
  getSourceSyncConfig,
  readJSON,
  assertExactManagedPackageScripts,
  runToolchainPreflight,
  stashWorkingTreeIfNeeded,
  syncPathsFromSource,
  syncPackageManifest,
  applyBuildContractFiles,
  buildSyncMetadata,
  commitValidatedSyncChanges,
  assertToolchainContract,
  restoreStashIfNeeded,
  log: () => {},
}

/**
 * Runs the boilerplate sync lifecycle through explicit side-effect interfaces.
 * The root facade injects the public child gate and managed-runtime guard.
 */
export function createBoilerplateSyncWorkflow(overrides = {}) {
  const dependencies = { ...defaultDependencies, ...overrides }

  return {
    run({
      repo,
      ref,
      targetRoot,
      tempRoot,
      sourceRoot,
      enforceChildSyncGate,
      assertManagedRuntimeDeliveryClosure = dependencies.assertManagedRuntimeDeliveryClosure,
      syncMode: providedSyncMode = undefined,
      applyBuildContract: providedApplyBuildContract = undefined,
      invocationValues = undefined,
    }) {
      enforceChildSyncGate()
      const syncMode = providedSyncMode ?? dependencies.parseSyncMode(invocationValues)
      const applyBuildContract =
        providedApplyBuildContract ?? dependencies.parseApplyBuildContract(invocationValues)
      const logs = []
      const log = (message) => {
        logs.push(message)
        dependencies.log(message)
      }
      log(`Syncing Bemoat boilerplate from ${repo}#${ref} (${syncMode} mode)`)
      const git = dependencies.createGitClient()
      let stashCreated = false

      try {
        dependencies.rmSync(tempRoot, { recursive: true, force: true })
        dependencies.mkdirSync(tempRoot, { recursive: true })

        dependencies.run(
          'git',
          ['clone', '--depth', '1', '--branch', ref, `https://github.com/${repo}.git`, sourceRoot],
          { cwd: targetRoot },
        )

        const syncConfig = dependencies.getSourceSyncConfig(sourceRoot)
        const sourcePackage = dependencies.readJSON(dependencies.join(sourceRoot, 'package.json'))
        const targetPackage = dependencies.readJSON(dependencies.join(targetRoot, 'package.json'))
        dependencies.assertExactManagedPackageScripts(sourcePackage, targetPackage)
        dependencies.runToolchainPreflight({ targetRootPath: targetRoot, contractRootPath: sourceRoot })

        stashCreated = dependencies.stashWorkingTreeIfNeeded(targetRoot, git)

        if (applyBuildContract) {
          log(
            `Applying build contract scripts: ${syncConfig.buildContractPackageScripts.join(', ')}`,
          )
          log(`Applying build contract files: ${syncConfig.buildContractFilePaths.join(', ')}`)
        }

        const {
          syncedManaged,
          seededFiles,
          skippedSeedFiles,
          mergedFiles,
          seedOnlyPathsSkipped,
        } = dependencies.syncPathsFromSource({
          sourceRootPath: sourceRoot,
          targetRootPath: targetRoot,
          mode: syncMode,
          syncConfig,
          assertManagedRuntimeDeliveryClosure,
        })

        const packageSync = dependencies.syncPackageManifest({
          sourceRootPath: sourceRoot,
          targetRootPath: targetRoot,
          repo,
          ref,
          applyBuildContract,
          syncConfig,
        })

        const buildContractFiles = applyBuildContract
          ? dependencies.applyBuildContractFiles(sourceRoot, targetRoot, syncConfig.buildContractFilePaths)
          : { applied: [], updated: [], skipped: [] }

        if (buildContractFiles.applied.length > 0) {
          log(`[sync] applied build contract files: ${buildContractFiles.applied.join(', ')}`)
        }
        if (buildContractFiles.updated.length > 0) {
          log(`[sync] updated build contract files: ${buildContractFiles.updated.join(', ')}`)
        }

        if (packageSync.packageChanged) {
          if (packageSync.addedScripts.length > 0) {
            log(`[sync] added missing bemoat:* scripts: ${packageSync.addedScripts.join(', ')}`)
          }
          if (packageSync.appliedBuildContractScripts?.length > 0) {
            log(
              `[sync] added build contract scripts: ${packageSync.appliedBuildContractScripts.join(', ')}`,
            )
          }
          if (packageSync.updatedBuildContractScripts?.length > 0) {
            log(
              `[sync] updated build contract scripts: ${packageSync.updatedBuildContractScripts.join(', ')}`,
            )
          }
        }

        if (packageSync.proposalPath) {
          log(`[sync] package sync proposal written to ${packageSync.proposalPath}`)
        }

        dependencies.writeFileSync(
          dependencies.join(targetRoot, syncMetadataPath),
          `${JSON.stringify(
            dependencies.buildSyncMetadata({
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

        dependencies.rmSync(tempRoot, { recursive: true, force: true })

        const pathsToCommit = [
          ...syncedManaged,
          ...seededFiles,
          ...mergedFiles,
          ...buildContractFiles.applied,
          ...buildContractFiles.updated,
        ]
        const committed = dependencies.commitValidatedSyncChanges(
          {
            repo,
            ref,
            targetRoot,
            syncedPaths: pathsToCommit,
            includePackageJson: packageSync.packageChanged,
          }, {
            git,
            validate: () => dependencies.assertToolchainContract({ targetRootPath: targetRoot }),
          },
        )
        if (committed) {
          log('[sync] committed sync changes')
        } else {
          log('[sync] no sync changes to commit')
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
          log,
        })

        printSuggestedNextCommands(syncMode, packageSync, applyBuildContract, log)

        return {
          repo,
          ref,
          syncMode,
          applyBuildContract,
          seedOnlyPathsSkipped,
          syncedManaged,
          seededFiles,
          skippedSeedFiles,
          mergedFiles,
          packageSync,
          buildContractFiles,
          mutationPerformed: committed,
          legacyClassification: committed ? 'SYNCED' : 'NO_OP',
          legacyOutput: logs,
        }
      } finally {
        dependencies.rmSync(tempRoot, { recursive: true, force: true })
        dependencies.restoreStashIfNeeded(targetRoot, stashCreated, git)
      }
    },
  }
}
