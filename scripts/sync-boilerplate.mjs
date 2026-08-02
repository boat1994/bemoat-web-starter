#!/usr/bin/env node
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { assertManagedRuntimeDeliveryClosure } from './guard-harness-contract.mjs'
import { resolveChildSyncCommandGate } from './mission-control-reconcile.mjs'
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
const workflow = createBoilerplateSyncWorkflow()

export function isDirectExecution() {
  const entrypoint = process.argv[1]

  if (!entrypoint) return false

  return import.meta.url === pathToFileURL(resolve(entrypoint)).href
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
  return workflow.run({
    repo,
    ref,
    targetRoot,
    tempRoot,
    sourceRoot,
    enforceChildSyncGate: enforceMcTransitionChildSyncGate,
    assertManagedRuntimeDeliveryClosure,
  })
}

if (isDirectExecution()) main()
