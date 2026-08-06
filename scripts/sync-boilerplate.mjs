#!/usr/bin/env node
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { createHelpEnvelopeV1, formatTextHelp } from './cli/command-help.mjs'
import {
  CliInvocationError,
  parseCommandInvocation,
  resolveCommandIdentity,
} from './cli/command-invocation.mjs'
import {
  CLI_EXIT_CODES,
  classificationExitCode,
  createResultEnvelopeV1,
} from './cli/command-result.mjs'
import { assertManagedRuntimeDeliveryClosure } from './guard-harness-contract.mjs'
import { resolveChildSyncCommandGate } from './mission-control-reconcile.mjs'
import { parseApplyBuildContract, parseSyncMode } from './boilerplate/config.mjs'
import {
  createBoilerplateSyncWorkflow,
  getSuggestedNextCommands,
} from './boilerplate/workflow.mjs'

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
} from './boilerplate/filesystem.mjs'
export {
  commitSyncedChanges,
  commitValidatedSyncChanges,
  getSyncCommitPaths,
  restoreStashIfNeeded,
  stashWorkingTreeIfNeeded,
  syncCommitPaths,
} from './boilerplate/git.mjs'
export { getSuggestedNextCommands }

const repo = process.env.BEMOAT_BOILERPLATE_REPO || 'boat1994/bemoat-web-starter'
const ref = process.env.BEMOAT_BOILERPLATE_REF || 'main'
const targetRoot = process.cwd()
const tempRoot = resolve(targetRoot, '.bemoat-sync-tmp')
const sourceRoot = resolve(tempRoot, 'source')

export function isDirectExecution() {
  const entrypoint = process.argv[1]

  if (!entrypoint) return false

  return import.meta.url === pathToFileURL(resolve(entrypoint)).href
}

function renderHelp(invocation) {
  if (invocation.format === 'json') {
    process.stdout.write(`${JSON.stringify(createHelpEnvelopeV1(invocation.contract))}\n`)
    return
  }

  process.stdout.write(formatTextHelp(invocation.contract))
}

function handleInvocationError(error, { command, format }) {
  if (!(error instanceof CliInvocationError)) return false

  renderRuntimeError({ command, format, error })
  return true
}

function resolveSyncCommand() {
  const lifecycleEvent = process.env.npm_lifecycle_event
  const isRawAlias = lifecycleEvent === 'boilerplate:sync'
  const isUnrelatedLifecycle =
    lifecycleEvent &&
    !lifecycleEvent.startsWith('bemoat:') &&
    !isRawAlias
  const env = isRawAlias || isUnrelatedLifecycle
    ? { ...process.env, npm_lifecycle_event: undefined }
    : process.env

  return resolveCommandIdentity({
    fallback: 'bemoat:boilerplate:sync',
    env,
    entrypoint: 'scripts/sync-boilerplate.mjs',
  })
}

function runtimeClassification(error) {
  if (
    error &&
    typeof error === 'object' &&
    typeof error.classification === 'string' &&
    Object.hasOwn(CLI_EXIT_CODES, error.classification)
  ) {
    return error.classification
  }

  const reason = error instanceof Error ? error.message : String(error)
  if (reason.startsWith('child-sync gate blocked:')) return 'BLOCKED_EXTERNAL'

  const prefix = reason.match(/^([A-Z_]+):/)
  if (prefix && Object.hasOwn(CLI_EXIT_CODES, prefix[1])) return prefix[1]

  return 'INTERNAL_ERROR'
}

function runtimeDetails(error) {
  const details = error instanceof CliInvocationError
    ? {
      argument: error.details.argument,
      reason: error.details.reason,
    }
    : {
      argument: null,
      reason: error instanceof Error ? error.message : String(error),
    }

  if (error && typeof error === 'object') {
    if (Array.isArray(error.legacyOutput)) {
      details.legacy_output = error.legacyOutput
    }
    if (typeof error.cleanupError === 'string') {
      details.cleanup_error = error.cleanupError
    }
  }

  return details
}

function renderRuntimeError({ command, format, error }) {
  const classification = runtimeClassification(error)
  const details = runtimeDetails(error)
  const mutationPerformed = Boolean(
    error &&
    typeof error === 'object' &&
    error.mutationPerformed === true,
  )

  if (format === 'json' && command) {
    process.stdout.write(`${JSON.stringify(createResultEnvelopeV1({
      command,
      outcome: 'ERROR',
      classification,
      mutation_performed: mutationPerformed,
      next_action: {
        type: 'STOP',
        command: null,
        reason: details.reason,
      },
      details,
    }))}\n`)
  } else {
    process.stderr.write(`${classification}: ${details.reason}\n`)
    for (const line of details.legacy_output ?? []) {
      process.stderr.write(`${line}\n`)
    }
  }

  process.exitCode = classificationExitCode(classification)
}

function renderSyncResult({ command, format, result }) {
  const classification = result.mutationPerformed
    ? 'SUCCESS'
    : 'NO_OP_IDENTICAL_RETRY'
  const outcome = result.mutationPerformed ? 'SUCCESS' : 'NO_OP'
  const nextAction = result.mutationPerformed
    ? {
      type: 'COMPLETE',
      command: null,
      reason: 'The selected boilerplate projection was synchronized.',
    }
    : {
      type: 'COMPLETE',
      command: null,
      reason: 'The selected boilerplate projection is already synchronized.',
    }
  const envelope = createResultEnvelopeV1({
    command,
    outcome,
    classification,
    mutation_performed: result.mutationPerformed,
    resulting_state: 'SYNCED',
    repository: result.repo,
    next_action: nextAction,
    details: {
      ref: result.ref,
      sync_mode: result.syncMode,
      apply_build_contract: result.applyBuildContract,
      seed_only_paths_skipped: result.seedOnlyPathsSkipped,
      synced_managed: result.syncedManaged,
      seeded_files: result.seededFiles,
      skipped_seed_files: result.skippedSeedFiles,
      merged_files: result.mergedFiles,
      package_sync: result.packageSync,
      build_contract_files: result.buildContractFiles,
      legacy_classification: result.legacyClassification,
      legacy_output: result.legacyOutput,
    },
  })

  if (format === 'json') {
    process.stdout.write(`${JSON.stringify(envelope)}\n`)
    return
  }

  const [firstLine = 'Boilerplate sync completed.', ...remainingLines] = result.legacyOutput
  process.stdout.write(`${classification}: ${firstLine}\n`)
  for (const line of remainingLines) process.stdout.write(`${line}\n`)
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
  values,
} = {}) {
  const skip =
    values?.skip_mc_transition_gate === true ||
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
  let command
  let invocation

  try {
    command = resolveSyncCommand()
    invocation = parseCommandInvocation(command, process.argv.slice(2))

    if (invocation.mode === 'help') {
      renderHelp(invocation)
      return
    }

    const syncMode = parseSyncMode(invocation.values, process.env)
    const applyBuildContract = parseApplyBuildContract(invocation.values, process.env)
    const workflow = createBoilerplateSyncWorkflow()
    const result = workflow.run({
      repo,
      ref,
      targetRoot,
      tempRoot,
      sourceRoot,
      syncMode,
      applyBuildContract,
      invocationValues: invocation.values,
      suppressToolOutput: invocation.format === 'json',
      enforceChildSyncGate: () => enforceMcTransitionChildSyncGate({
        values: invocation.values,
        env: process.env,
      }),
      assertManagedRuntimeDeliveryClosure,
    })

    renderSyncResult({
      command,
      format: invocation.format,
      result,
    })
  } catch (error) {
    const format = invocation?.format ?? (process.argv.includes('--json') ? 'json' : 'text')
    const outputCommand = command ?? 'bemoat:boilerplate:sync'
    if (handleInvocationError(error, { command: outputCommand, format })) return
    renderRuntimeError({
      command: outputCommand,
      format,
      error,
    })
  }
}

if (isDirectExecution()) main()
