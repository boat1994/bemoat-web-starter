export type JsonPrimitive = string | number | boolean | null

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]

export interface JsonObject {
  [key: string]: JsonValue | undefined
}

export type PackageScripts = Record<string, string>

export interface PackageJson extends JsonObject {
  name?: string
  scripts?: PackageScripts
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

export interface PackageJsonWithScripts extends PackageJson {
  scripts: PackageScripts
}

export type SyncMode = 'harness-only' | 'full'

export interface SyncConfig {
  managedPaths: string[]
  seedOnlyPaths: string[]
  mergeKeepPaths: string[]
  managedPackageScripts: string[]
  suggestedPackageScripts: string[]
  buildContractPackageScripts: string[]
  buildContractFilePaths: string[]
  suggestedPackageSections: string[]
}

export type SyncConfigOverrides = Partial<SyncConfig>

export interface MutationOptions {
  onMutation?: () => void
}

export interface CopyManagedResult {
  copied: boolean
  reason?: 'missing-source'
}

export interface CopySeedResult {
  seeded: string[]
  skipped: string[]
  reason?: 'missing-source'
}

export interface MergeKeepResult {
  merged: boolean
  addedLines: string[]
  changed: boolean
  created: boolean
  reason?: 'missing-source' | 'unsupported-path'
}

export interface PackageScriptMissing {
  name: string
  value: string
}

export interface PackageScriptDifference {
  name: string
  source: string
  target: string
}

export interface PackageSectionEntry {
  name: string
  value?: JsonValue
  source?: JsonValue
  target?: JsonValue
}

export interface PackageSyncProposal {
  missingScripts: PackageScriptMissing[]
  differentScripts: PackageScriptDifference[]
  differentBemoatScripts: PackageScriptDifference[]
  missingSectionEntries: Record<string, PackageSectionEntry[]>
  differentSectionEntries: Record<string, PackageSectionEntry[]>
}

export interface PackageSyncResult {
  addedScripts: string[]
  appliedBuildContractScripts: string[]
  updatedBuildContractScripts: string[]
  proposalPath: string | null
  proposal: PackageSyncProposal | null
  packageChanged: boolean
}

export interface BuildContractFileResult {
  applied: string[]
  updated: string[]
  skipped: Array<{ path: string; reason: 'missing-source' }>
}

export interface BuildContractSyncResult {
  packageJSON: PackageJsonWithScripts
  addedScripts: string[]
  updatedScripts: string[]
}

export interface SyncMetadataInput {
  repo?: string
  ref?: string
  syncMode: SyncMode
  seedOnlyPathsSkipped: boolean
  syncedManaged?: string[]
  seededFiles?: string[]
  skippedSeedFiles?: string[]
  mergedFiles?: string[]
  packageSync?: Partial<PackageSyncResult>
  buildContractFiles?: Partial<BuildContractFileResult>
  syncedAt?: string
  syncConfig?: SyncConfig
}

export interface SyncMetadata {
  repo: string
  ref: string
  syncMode: SyncMode
  seedOnlyPathsSkipped: boolean
  syncedAt: string
  managedPaths: string[]
  seedOnlyPaths: string[]
  mergeKeepPaths: string[]
  managedPackageScripts: string[]
  suggestedPackageScripts: string[]
  buildContractPackageScripts: string[]
  buildContractFilePaths: string[]
  suggestedPackageSections: string[]
  lastSyncedManagedPaths: string[]
  seededFiles: string[]
  skippedSeedFiles: string[]
  mergedFiles: string[]
  packageSync: {
    addedScripts: string[]
    appliedBuildContractScripts: string[]
    updatedBuildContractScripts: string[]
    proposalPath: string | null
  }
  buildContractFiles: BuildContractFileResult
}

export interface SyncPathsInput {
  sourceRootPath: string
  targetRootPath: string
  mode?: SyncMode
  onWarn?: (message: string) => void
  onLog?: (message: string) => void
  syncConfig?: SyncConfig
  assertManagedRuntimeDeliveryClosure?: (input: {
    root: string
    managedPaths: string[]
  }) => void
  onMutation?: () => void
}

export interface SyncPathsResult {
  syncedManaged: string[]
  seededFiles: string[]
  skippedSeedFiles: string[]
  mergedFiles: string[]
  seedOnlyPathsSkipped: boolean
  syncMode: SyncMode
}

export interface SyncResult extends SyncPathsResult {
  repo: string
  ref: string
  applyBuildContract: boolean
  packageSync: PackageSyncResult
  buildContractFiles: BuildContractFileResult
  mutationPerformed: boolean
  legacyClassification: 'SYNCED' | 'NO_OP'
  legacyOutput: string[]
}
