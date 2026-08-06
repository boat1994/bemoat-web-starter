import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildContractFilePaths,
  buildContractPackageScripts,
  managedPackageScripts,
  managedPaths,
  mergeKeepPaths,
  seedOnlyPaths,
  suggestedPackageScripts,
  suggestedPackageSections,
  syncManifestPath,
} from './inventory.mjs'

export const SYNC_MODES = { HARNESS_ONLY: 'harness-only', FULL: 'full' }

export function getDefaultSyncConfig() {
  return { managedPaths, seedOnlyPaths, mergeKeepPaths, managedPackageScripts, suggestedPackageScripts, buildContractPackageScripts, buildContractFilePaths, suggestedPackageSections }
}

export function readSourceSyncManifest(sourceRootPath) {
  const manifestFile = join(sourceRootPath, syncManifestPath)
  if (!existsSync(manifestFile)) return null
  return JSON.parse(readFileSync(manifestFile, 'utf8'))
}

export function getSourceSyncConfig(sourceRootPath) {
  const manifest = readSourceSyncManifest(sourceRootPath)
  const defaults = getDefaultSyncConfig()
  return {
    managedPaths: manifest?.managedPaths ?? defaults.managedPaths,
    seedOnlyPaths: manifest?.seedOnlyPaths ?? defaults.seedOnlyPaths,
    mergeKeepPaths: manifest?.mergeKeepPaths ?? defaults.mergeKeepPaths,
    managedPackageScripts: manifest?.managedPackageScripts ?? defaults.managedPackageScripts,
    suggestedPackageScripts: manifest?.suggestedPackageScripts ?? defaults.suggestedPackageScripts,
    buildContractPackageScripts: manifest?.buildContractPackageScripts ?? defaults.buildContractPackageScripts,
    buildContractFilePaths: manifest?.buildContractFilePaths ?? defaults.buildContractFilePaths,
    suggestedPackageSections: manifest?.suggestedPackageSections ?? defaults.suggestedPackageSections,
  }
}

function hasSyncModeFlag(values, name, syntax) {
  if (Array.isArray(values)) return values.includes(syntax)
  return values !== null && typeof values === 'object' && values[name] === true
}

/**
 * @param {string[] | Record<string, unknown>} [argv]
 * @param {NodeJS.ProcessEnv} [env]
 */
export function parseSyncMode(argv = process.argv.slice(2), env = process.env) {
  const fromEnv = env.BEMOAT_SYNC_MODE
  const harnessOnly = hasSyncModeFlag(argv, 'harness_only', '--harness-only')
  const full = hasSyncModeFlag(argv, 'full', '--full')
  if (harnessOnly && full) {
    throw new Error('--harness-only and --full are mutually exclusive.')
  }

  const fromArgs = harnessOnly
    ? SYNC_MODES.HARNESS_ONLY
    : full
      ? SYNC_MODES.FULL
      : null
  if (fromArgs && fromEnv && fromArgs !== fromEnv) {
    console.warn(`[sync] BEMOAT_SYNC_MODE=${fromEnv} ignored because CLI flag sets mode to ${fromArgs}`)
  }
  const mode = fromArgs || fromEnv || SYNC_MODES.HARNESS_ONLY
  if (mode !== SYNC_MODES.HARNESS_ONLY && mode !== SYNC_MODES.FULL) throw new Error(`Invalid sync mode "${mode}". Use harness-only or full.`)
  return mode
}

export function parseApplyBuildContract(argv = process.argv.slice(2), env = /** @type {NodeJS.ProcessEnv} */ (process.env)) {
  const fromEnv = env.BEMOAT_APPLY_BUILD_CONTRACT === '1' || env.BEMOAT_APPLY_BUILD_CONTRACT === 'true'
  const fromArgs = argv.includes('--apply-build-contract')
  if (fromArgs && env.BEMOAT_APPLY_BUILD_CONTRACT === '0') console.warn('[sync] BEMOAT_APPLY_BUILD_CONTRACT=0 ignored because --apply-build-contract was passed')
  return fromArgs || fromEnv
}
