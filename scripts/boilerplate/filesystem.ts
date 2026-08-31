import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { assertManagedRuntimeDeliveryClosure as assertManagedRuntimeDeliveryClosureDefault } from '../guard-harness-contract.ts'
import { scanToolchainContract } from '../guards/toolchain-contract.ts'
import { SYNC_MODES, getDefaultSyncConfig } from './config.ts'
import { buildContractFilePaths, listPathFiles } from './inventory.ts'
import type {
  BuildContractFileResult,
  CopyManagedResult,
  CopySeedResult,
  MergeKeepResult,
  MutationOptions,
  PackageSyncResult,
  SyncMetadata,
  SyncMetadataInput,
  SyncMode,
  SyncPathsInput,
  SyncPathsResult,
} from './types.ts'

const repo = process.env.BEMOAT_BOILERPLATE_REPO || 'boat1994/bemoat-web-starter'
const ref = process.env.BEMOAT_BOILERPLATE_REF || 'main'
const targetRoot = process.cwd()

export const syncMetadataPath = '.bemoat-boilerplate-sync.json'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readSyncMetadata(path: string): unknown {
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

export function preserveIdenticalSyncTimestamp(
  previous: unknown,
  next: SyncMetadata,
): SyncMetadata {
  if (!isRecord(previous) || typeof previous.syncedAt !== 'string') return next
  const { syncedAt: _previousTimestamp, ...previousProjection } = previous
  const { syncedAt: _nextTimestamp, ...nextProjection } = next
  if (JSON.stringify(previousProjection) !== JSON.stringify(nextProjection)) return next
  return { ...next, syncedAt: previous.syncedAt }
}

function printList(log: (message: string) => void, title: string, values: string[]): void {
  log(`\n${title}:`)
  for (const value of values.length > 0 ? values : ['(none)']) log(`- ${value}`)
}

export function printSyncReport({
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
  const appliedBuildContract = [...(packageSync.appliedBuildContractScripts ?? []), ...(packageSync.updatedBuildContractScripts ?? [])]
  if (appliedBuildContract.length > 0) {
    log(`- applied build contract scripts: ${appliedBuildContract.join(', ')}`)
  }
  const appliedBuildContractFiles = [...(buildContractFiles.applied ?? []), ...(buildContractFiles.updated ?? [])]
  if (appliedBuildContractFiles.length > 0) {
    log(`- applied build contract files: ${appliedBuildContractFiles.join(', ')}`)
  }
  if (packageSync.proposalPath) {
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

export function printSuggestedNextCommands(
  syncMode: SyncMode,
  packageSync: Partial<PackageSyncResult>,
  applyBuildContract: boolean,
  log: (message: string) => void,
): void {
  log('\nDone. Suggested next commands:')
  for (const line of getSuggestedNextCommands(syncMode, {
    proposalPath: packageSync.proposalPath,
    applyBuildContract,
  })) {
    log(line)
  }
}

export function copyManagedPath(
  sourceRootPath: string,
  targetRootPath: string,
  relativePath: string,
  { onMutation = () => {} }: MutationOptions = {},
): CopyManagedResult {
  const source = join(sourceRootPath, relativePath)
  const destination = join(targetRootPath, relativePath)

  if (!existsSync(source)) {
    return { copied: false, reason: 'missing-source' }
  }

  onMutation()
  mkdirSync(dirname(destination), { recursive: true })
  cpSync(source, destination, { recursive: true, force: true })
  return { copied: true }
}

export function copySeedOnlyPath(
  sourceRootPath: string,
  targetRootPath: string,
  relativePath: string,
  { onMutation = () => {} }: MutationOptions = {},
): CopySeedResult {
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

    onMutation()
    mkdirSync(dirname(destinationFile), { recursive: true })
    cpSync(sourceFile, destinationFile)
    seeded.push(filePath)
  }

  return { seeded, skipped }
}

export function normalizeGitignoreLine(line: string): string {
  return line.trim()
}

export function mergeGitignoreKeepTarget(sourceContent: string, targetContent: string): {
  content: string
  addedLines: string[]
  changed: boolean
} {
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

export function mergeKeepPath(
  sourceRootPath: string,
  targetRootPath: string,
  relativePath: string,
  { onMutation = () => {} }: MutationOptions = {},
): MergeKeepResult {
  const source = join(sourceRootPath, relativePath)
  const destination = join(targetRootPath, relativePath)

  if (!existsSync(source)) {
    return { merged: false, reason: 'missing-source', addedLines: [], changed: false, created: false }
  }

  const sourceContent = readFileSync(source, 'utf8')

  if (!existsSync(destination)) {
    onMutation()
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

  onMutation()
  writeFileSync(destination, mergeResult.content)
  return {
    merged: true,
    addedLines: mergeResult.addedLines,
    changed: true,
    created: false,
  }
}

export function assertToolchainContract({
  targetRootPath,
  contractRootPath = targetRoot,
}: {
  targetRootPath: string
  contractRootPath?: string
}): void {
  const violations = scanToolchainContract({ root: targetRootPath, contractRoot: contractRootPath })
  if (violations.length > 0) {
    throw new Error(`Toolchain contract validation failed:\n${violations.map((item) => `- [${item.rule}] ${item.message}`).join('\n')}`)
  }
}

const toolchainBootstrapPaths = [
  'scripts/guards/toolchain-contract.ts',
  'scripts/bemoat-typecheck.ts',
  'tsconfig.harness-strict.json',
  '.bemoat/toolchain-contract.json',
]

export function isFirstToolchainBootstrap(targetRootPath: string): boolean {
  return toolchainBootstrapPaths.every((path) => !existsSync(join(targetRootPath, path)))
}

export function runToolchainPreflight({
  targetRootPath,
  contractRootPath,
  assertContract = assertToolchainContract,
  log = console.log,
}: {
  targetRootPath: string
  contractRootPath: string
  assertContract?: (input: { targetRootPath: string; contractRootPath?: string }) => void
  log?: (message: string) => void
}): 'bootstrap' | 'validated' {
  if (isFirstToolchainBootstrap(targetRootPath)) {
    log('[sync] first-sync toolchain bootstrap: validating copied rails before commit')
    return 'bootstrap'
  }

  assertContract({ targetRootPath, contractRootPath })
  return 'validated'
}

export function applyBuildContractFiles(
  sourceRootPath: string,
  targetRootPath: string,
  filePaths: string[] = buildContractFilePaths,
  { onMutation = () => {} }: MutationOptions = {},
): BuildContractFileResult {
  const applied = []
  const updated = []
  const skipped = []

  for (const relativePath of filePaths) {
    const source = join(sourceRootPath, relativePath)
    const destination = join(targetRootPath, relativePath)

    if (!existsSync(source)) {
      skipped.push({ path: relativePath, reason: 'missing-source' as const })
      continue
    }

    const hadExisting = existsSync(destination)
    onMutation()
    mkdirSync(dirname(destination), { recursive: true })
    cpSync(source, destination, { force: true })

    if (hadExisting) {
      updated.push(relativePath)
    } else {
      applied.push(relativePath)
    }
  }

  return { applied, updated, skipped }
}

export {
  applyBuildContractScripts,
  applyManagedPackageScripts,
  assertExactManagedPackageScripts,
  buildPackageSyncProposal,
  formatPackageSyncProposal,
  readJSON,
  syncPackageManifest,
} from './package.ts'

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
  buildContractFiles = { applied: [], updated: [], skipped: [] },
  syncedAt = new Date().toISOString(),
  syncConfig = getDefaultSyncConfig(),
}: SyncMetadataInput): SyncMetadata {
  return {
    repo: sourceRepo,
    ref: sourceRef,
    syncMode,
    seedOnlyPathsSkipped,
    syncedAt,
    managedPaths: syncConfig.managedPaths,
    seedOnlyPaths: syncConfig.seedOnlyPaths,
    mergeKeepPaths: syncConfig.mergeKeepPaths,
    managedPackageScripts: syncConfig.managedPackageScripts,
    suggestedPackageScripts: syncConfig.suggestedPackageScripts,
    buildContractPackageScripts: syncConfig.buildContractPackageScripts,
    buildContractFilePaths: syncConfig.buildContractFilePaths,
    suggestedPackageSections: syncConfig.suggestedPackageSections,
    lastSyncedManagedPaths: syncedManaged,
    seededFiles,
    skippedSeedFiles,
    mergedFiles,
    packageSync: {
      addedScripts: packageSync.addedScripts ?? [],
      appliedBuildContractScripts: packageSync.appliedBuildContractScripts ?? [],
      updatedBuildContractScripts: packageSync.updatedBuildContractScripts ?? [],
      proposalPath: packageSync.proposalPath ?? null,
    },
    buildContractFiles: {
      applied: buildContractFiles.applied ?? [],
      updated: buildContractFiles.updated ?? [],
      skipped: buildContractFiles.skipped ?? [],
    },
  }
}

export function syncPathsFromSource({
  sourceRootPath,
  targetRootPath,
  mode = SYNC_MODES.HARNESS_ONLY,
  onWarn = console.warn,
  onLog = console.log,
  syncConfig = getDefaultSyncConfig(),
  assertManagedRuntimeDeliveryClosure = assertManagedRuntimeDeliveryClosureDefault,
  onMutation = () => {},
}: SyncPathsInput): SyncPathsResult {
  const syncedManaged = []
  const seededFiles = []
  const skippedSeedFiles = []
  const mergedFiles = []
  const seedOnlyPathsSkipped = mode === SYNC_MODES.HARNESS_ONLY

  assertManagedRuntimeDeliveryClosure({
    root: sourceRootPath,
    managedPaths: syncConfig.managedPaths,
  })

  for (const path of syncConfig.managedPaths) {
    const result = copyManagedPath(sourceRootPath, targetRootPath, path, { onMutation })
    if (result.copied) syncedManaged.push(path)
  }

  if (!seedOnlyPathsSkipped) {
    for (const path of syncConfig.seedOnlyPaths) {
      const result = copySeedOnlyPath(sourceRootPath, targetRootPath, path, { onMutation })
      if (result.reason === 'missing-source') {
        onWarn(`[skip] ${path} not found in ${repo}#${ref}`)
        continue
      }

      seededFiles.push(...result.seeded)
      skippedSeedFiles.push(...result.skipped)
    }
  }

  for (const path of syncConfig.mergeKeepPaths) {
    const result = mergeKeepPath(sourceRootPath, targetRootPath, path, { onMutation })
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
