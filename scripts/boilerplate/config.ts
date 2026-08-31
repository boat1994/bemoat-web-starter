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
} from './inventory.ts'

import type { SyncConfig, SyncConfigOverrides, SyncMode } from './types.ts'

export const SYNC_MODES = { HARNESS_ONLY: 'harness-only', FULL: 'full' } as const

export function getDefaultSyncConfig(): SyncConfig {
  return { managedPaths, seedOnlyPaths, mergeKeepPaths, managedPackageScripts, suggestedPackageScripts, buildContractPackageScripts, buildContractFilePaths, suggestedPackageSections }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readStringArray(manifest: Record<string, unknown>, key: keyof SyncConfig): string[] | undefined {
  const value = manifest[key]
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) return undefined
  return value
}

export function readSourceSyncManifest(sourceRootPath: string): SyncConfigOverrides | null {
  const manifestFile = join(sourceRootPath, syncManifestPath)
  if (!existsSync(manifestFile)) return null
  const parsed: unknown = JSON.parse(readFileSync(manifestFile, 'utf8'))
  if (!isRecord(parsed)) return null

  const manifest: SyncConfigOverrides = {}
  const keys: Array<keyof SyncConfig> = [
    'managedPaths',
    'seedOnlyPaths',
    'mergeKeepPaths',
    'managedPackageScripts',
    'suggestedPackageScripts',
    'buildContractPackageScripts',
    'buildContractFilePaths',
    'suggestedPackageSections',
  ]
  for (const key of keys) {
    const values = readStringArray(parsed, key)
    if (values !== undefined) manifest[key] = values
  }
  return manifest
}

export function getSourceSyncConfig(sourceRootPath: string): SyncConfig {
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

function hasSyncModeFlag(
  values: readonly string[] | Record<string, unknown>,
  name: string,
  syntax: string,
): boolean {
  if (isStringArray(values)) return values.includes(syntax)
  if (isRecord(values)) {
    return values[name] === true
  }
  return false
}

function isStringArray(value: readonly string[] | Record<string, unknown>): value is readonly string[] {
  return Array.isArray(value)
}

/**
 * @param {string[] | Record<string, unknown>} [argv]
 * @param {NodeJS.ProcessEnv} [env]
 */
export function parseSyncMode(
  argv: readonly string[] | Record<string, unknown> = process.argv.slice(2),
  env: Record<string, string | undefined> = process.env,
): SyncMode {
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

export function parseApplyBuildContract(
  argv: readonly string[] | Record<string, unknown> = process.argv.slice(2),
  env: Record<string, string | undefined> = process.env,
): boolean {
  const fromEnv = env.BEMOAT_APPLY_BUILD_CONTRACT === '1' || env.BEMOAT_APPLY_BUILD_CONTRACT === 'true'
  const fromArgs = hasSyncModeFlag(argv, 'apply_build_contract', '--apply-build-contract')
  if (fromArgs && env.BEMOAT_APPLY_BUILD_CONTRACT === '0') console.warn('[sync] BEMOAT_APPLY_BUILD_CONTRACT=0 ignored because --apply-build-contract was passed')
  return fromArgs || fromEnv
}
