import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import type { ExecFileSyncOptions } from 'node:child_process'
import { join } from 'node:path'

import { SYNC_MODES, getSourceSyncConfig, parseApplyBuildContract, parseSyncMode } from './config.ts'
import {
  applyBuildContractFiles,
  assertToolchainContract,
  buildSyncMetadata,
  runToolchainPreflight,
  syncMetadataPath,
  syncPathsFromSource,
} from './filesystem.ts'
import { assertExactManagedPackageScripts, readJSON, syncPackageManifest } from './package.ts'
import {
  commitValidatedSyncChanges,
  createGitClient,
  restoreStashIfNeeded,
  stashWorkingTreeIfNeeded,
} from './git.ts'
import type {
  BuildContractFileResult,
  PackageSyncResult,
  SyncMode,
  SyncResult,
} from './types.ts'

type WorkflowRunOptions = ExecFileSyncOptions & { suppressStdout?: boolean }

function run(command: string, args: string[], { suppressStdout = false, ...options }: WorkflowRunOptions = {}): void {
  execFileSync(command, args, {
    stdio: suppressStdout ? ['ignore', 2, 'inherit'] : 'inherit',
    ...options,
  })
}

function printList(log: (message: string) => void, title: string, values: string[]): void {
  log(`\n${title}:`)
  for (const value of values.length > 0 ? values : ['(none)']) log(`- ${value}`)
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
}: {
  syncMode: SyncMode
  seedOnlyPathsSkipped: boolean
  syncedManaged: string[]
  seededFiles: string[]
  skippedSeedFiles: string[]
  mergedFiles: string[]
  packageSync: Partial<PackageSyncResult>
  buildContractFiles: Partial<BuildContractFileResult>
  log: (message: string) => void
}): void {
  log(`\nSync mode: ${syncMode}`)
  if (seedOnlyPathsSkipped) log('Seed-only starter modules skipped in harness-only mode')
  printList(log, 'Synced managed paths', syncedManaged)
  printList(log, 'Seeded missing starter files', seededFiles)
  printList(log, 'Skipped existing seed files', skippedSeedFiles)
  printList(log, 'Merged keep-child-content paths', mergedFiles)
  log('\nPackage manifest (child-owned):')
  const addedScripts = packageSync.addedScripts ?? []
  if (addedScripts.length > 0) {
    log(`- added missing bemoat:* scripts: ${addedScripts.join(', ')}`)
  } else {
    log('- no missing bemoat:* scripts added')
  }
  const appliedBuildContract = [...(packageSync?.appliedBuildContractScripts ?? []), ...(packageSync?.updatedBuildContractScripts ?? [])]
  if (appliedBuildContract.length > 0) {
    log(`- applied build contract scripts: ${appliedBuildContract.join(', ')}`)
  }
  const appliedBuildContractFiles = [...(buildContractFiles?.applied ?? []), ...(buildContractFiles?.updated ?? [])]
  if (appliedBuildContractFiles.length > 0) {
    log(`- applied build contract files: ${appliedBuildContractFiles.join(', ')}`)
  }
  if (packageSync?.proposalPath) {
    log(`- review suggested script/dependency changes in ${packageSync.proposalPath}`)
  }
}

export function getSuggestedNextCommands(
  syncMode: SyncMode,
  { proposalPath = undefined, applyBuildContract = false }: {
    proposalPath?: string | null
    applyBuildContract?: boolean
  } = {},
): string[] {
  const lines: string[] = []
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

function printSuggestedNextCommands(
  syncMode: SyncMode,
  packageSync: Partial<PackageSyncResult>,
  applyBuildContract: boolean,
  log: (message: string) => void,
): void {
  log('\nDone. Suggested next commands:')
  for (const line of getSuggestedNextCommands(syncMode, {
    proposalPath: packageSync?.proposalPath,
    applyBuildContract,
  })) {
    log(line)
  }
}
function annotateSyncFailure(
  error: unknown,
  {
    logs,
    mutationPerformed,
    cleanupError = null,
  }: {
    logs: string[]
    mutationPerformed: boolean
    cleanupError?: unknown
  },
): Error & {
  mutationPerformed: boolean
  classification?: 'AMBIGUOUS_RESULT'
  legacyOutput: string[]
  cleanupError?: string
} {
  const failure = error instanceof Error ? error : new Error(String(error))
  const mayHaveMutated =
    mutationPerformed ||
    (typeof failure === 'object' && 'mutationPerformed' in failure && failure.mutationPerformed === true)
  const details: {
    mutationPerformed: boolean
    classification?: 'AMBIGUOUS_RESULT'
    legacyOutput: string[]
    cleanupError?: string
  } = {
    mutationPerformed: mayHaveMutated,
    ...(mayHaveMutated ? { classification: 'AMBIGUOUS_RESULT' as const } : {}),
    legacyOutput: [...logs],
  }
  if (cleanupError) {
    details.cleanupError =
      cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
  }
  return Object.assign(failure, details)
}
const noManagedRuntimeDeliveryClosure: ((input: {
  root: string
  managedPaths: string[]
}) => void) | undefined = undefined
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
  assertManagedRuntimeDeliveryClosure: noManagedRuntimeDeliveryClosure,
  log: (_message: string): void => {},
}

/**
 * Runs the boilerplate sync lifecycle through explicit side-effect interfaces.
 * The root facade injects the managed-runtime guard.
 */
export function createBoilerplateSyncWorkflow(overrides: Record<string, unknown> = {}) {
  const dependencies = { ...defaultDependencies, ...overrides }

  return {
    run({
      repo,
      ref,
      targetRoot,
      tempRoot,
      sourceRoot,
      assertManagedRuntimeDeliveryClosure = dependencies.assertManagedRuntimeDeliveryClosure,
      syncMode: providedSyncMode = undefined,
      applyBuildContract: providedApplyBuildContract = undefined,
      invocationValues = undefined,
      suppressToolOutput = false,
    }: {
      repo: string
      ref: string
      targetRoot: string
      tempRoot: string
      sourceRoot: string
      assertManagedRuntimeDeliveryClosure?: (input: { root: string; managedPaths: string[] }) => void
      syncMode?: SyncMode
      applyBuildContract?: boolean
      invocationValues?: readonly string[] | Record<string, unknown>
      suppressToolOutput?: boolean
    }): SyncResult {
      const syncMode = providedSyncMode ?? dependencies.parseSyncMode(invocationValues)
      const applyBuildContract =
        providedApplyBuildContract ?? dependencies.parseApplyBuildContract(invocationValues)
      const logs: string[] = []
      const log = (message: string): void => {
        logs.push(message)
        dependencies.log(message)
      }
      log(`Syncing Bemoat boilerplate from ${repo}#${ref} (${syncMode} mode)`)
      const git = dependencies.createGitClient({ suppressStdout: suppressToolOutput })
      let stashCreated = false
      let mutationPerformed = false
      let result: SyncResult | null = null
      let failure: unknown = null
      const markMutation = (): void => {
        mutationPerformed = true
      }
      try {
        dependencies.rmSync(tempRoot, { recursive: true, force: true })
        dependencies.mkdirSync(tempRoot, { recursive: true })
        dependencies.run(
          'git',
          ['clone', '--depth', '1', '--branch', ref, `https://github.com/${repo}.git`, sourceRoot],
          { cwd: targetRoot, suppressStdout: suppressToolOutput },
        )
        const syncConfig = dependencies.getSourceSyncConfig(sourceRoot)
        const sourcePackage = dependencies.readJSON(dependencies.join(sourceRoot, 'package.json'))
        const targetPackage = dependencies.readJSON(dependencies.join(targetRoot, 'package.json'))
        dependencies.assertExactManagedPackageScripts(sourcePackage, targetPackage)
        dependencies.runToolchainPreflight({
          targetRootPath: targetRoot,
          contractRootPath: sourceRoot,
          log,
        })
        stashCreated = dependencies.stashWorkingTreeIfNeeded(
          targetRoot,
          git,
          { onMutation: markMutation },
        )
        if (stashCreated) markMutation()
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
          onLog: log,
          assertManagedRuntimeDeliveryClosure,
          onMutation: markMutation,
        })
        if (
          syncedManaged.length > 0 ||
          seededFiles.length > 0 ||
          mergedFiles.length > 0
        ) {
          markMutation()
        }

        const packageSync = dependencies.syncPackageManifest({
          sourceRootPath: sourceRoot,
          targetRootPath: targetRoot,
          repo,
          ref,
          applyBuildContract,
          syncConfig,
          onMutation: markMutation,
        })
        if (packageSync.packageChanged || packageSync.proposalPath) markMutation()

        const buildContractFiles = applyBuildContract
          ? dependencies.applyBuildContractFiles(
            sourceRoot,
            targetRoot,
            syncConfig.buildContractFilePaths,
            { onMutation: markMutation },
          )
          : { applied: [], updated: [], skipped: [] }
        if (
          buildContractFiles.applied.length > 0 ||
          buildContractFiles.updated.length > 0
        ) {
          markMutation()
        }

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

        const metadataPath = dependencies.join(targetRoot, syncMetadataPath)
        const metadata = `${JSON.stringify(
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
        )}\n`
        markMutation()
        dependencies.writeFileSync(metadataPath, metadata)

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

        result = {
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
      } catch (error) {
        failure = error
      } finally {
        try {
          dependencies.rmSync(tempRoot, { recursive: true, force: true })
          dependencies.restoreStashIfNeeded(targetRoot, stashCreated, git)
        } catch (cleanupError) {
          if (failure) {
            failure = annotateSyncFailure(failure, {
              logs,
              mutationPerformed,
              cleanupError,
            })
          } else {
            failure = cleanupError
          }
        }
      }

      if (failure) {
        throw annotateSyncFailure(failure, { logs, mutationPerformed })
      }

      if (result === null) throw new Error('Boilerplate sync did not produce a result')
      return result
    },
  }
}
