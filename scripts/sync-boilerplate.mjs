#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { assertManagedRuntimeDeliveryClosure } from './guard-harness-contract.mjs'
import { scanToolchainContract } from './guard-toolchain-contract.mjs'
import { resolveChildSyncCommandGate } from './mission-control-reconcile.mjs'
import {
  SYNC_MODES,
  getDefaultSyncConfig,
  getSourceSyncConfig,
  parseApplyBuildContract,
  parseSyncMode,
} from './boilerplate/config.mjs'
import {
  buildContractFilePaths,
  buildContractPackageScripts,
  exactManagedPackageScripts,
  listPathFiles,
  managedPackageScripts,
  managedPaths,
  packageSyncProposalPath,
  suggestedPackageScripts,
  suggestedPackageSections,
} from './boilerplate/inventory.mjs'

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

/*
 * Static compatibility inventory for the synchronous Mission Control contract guard.
 * Runtime ownership remains in scripts/boilerplate/inventory.mjs.
 * export const managedPaths = [
 *   'docs/mission-control/README.md',
 *   'docs/mission-control/mission-control-guide.md',
 *   'docs/mission-control/handoff-template.md',
 *   'docs/mission-control/result-template.md',
 *   'docs/mission-control/project-overrides.example.md',
 *   'prompts/mission-control/chatgpt-project-loader.md',
 *   'scripts/guard-mission-control-contract.mjs',
 *   'scripts/mission-control-reconcile.mjs',
 *   'tests/int/mission-control-contract.int.spec.ts',
 *   'tests/int/mission-control-reconcile.int.spec.ts',
 *   'tests/fixtures/mission-control',
 *   'docs/mission-control/modules/procedures.md',
 *   'docs/mission-control/modules/checklists.md',
 *   'docs/mission-control/modules/templates-examples.md',
 *   'docs/mission-control/modules/troubleshooting.md',
 *   'docs/mission-control/modules/migration-guidance.md',
 *   'docs/mission-control/modules/child-sync-operations.md',
 * ]
 */

const repo = process.env.BEMOAT_BOILERPLATE_REPO || 'boat1994/bemoat-web-starter'
const ref = process.env.BEMOAT_BOILERPLATE_REF || 'main'
const targetRoot = process.cwd()
const tempRoot = resolve(targetRoot, '.bemoat-sync-tmp')
const sourceRoot = join(tempRoot, 'source')
const syncMetadataPath = '.bemoat-boilerplate-sync.json'
const stashMessage = 'bemoat-boilerplate-sync: pre-sync stash'

export const syncCommitPaths = [...managedPaths, syncMetadataPath, packageSyncProposalPath]


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

export function applyManagedPackageScripts(
  sourcePackage,
  targetPackage,
  scriptNames = managedPackageScripts,
) {
  const nextPackage = structuredClone(targetPackage)
  nextPackage.scripts = nextPackage.scripts || {}
  const addedScripts = []

  for (const scriptName of scriptNames) {
    const sourceValue = sourcePackage.scripts?.[scriptName]
    if (!sourceValue || scriptName in nextPackage.scripts) continue

    nextPackage.scripts[scriptName] = sourceValue
    addedScripts.push(scriptName)
  }

  return { packageJSON: nextPackage, addedScripts }
}

export function assertExactManagedPackageScripts(sourcePackage, targetPackage, scriptNames = exactManagedPackageScripts) {
  for (const scriptName of scriptNames) {
    const sourceValue = sourcePackage.scripts?.[scriptName]
    const targetValue = targetPackage.scripts?.[scriptName]
    if (!sourceValue || targetValue === undefined) continue
    if (targetValue !== sourceValue) {
      throw new Error(`Managed package script ${scriptName} diverges from the boilerplate contract`)
    }
  }
}

export function assertToolchainContract({ targetRootPath, contractRootPath = targetRoot }) {
  const violations = scanToolchainContract({ root: targetRootPath, contractRoot: contractRootPath })
  if (violations.length > 0) {
    throw new Error(`Toolchain contract validation failed:\n${violations.map((item) => `- [${item.rule}] ${item.message}`).join('\n')}`)
  }
}

const toolchainBootstrapPaths = [
  'scripts/guard-toolchain-contract.mjs',
  'scripts/bemoat-typecheck.mjs',
  'tsconfig.harness-strict.json',
  '.bemoat/toolchain-contract.json',
]

export function isFirstToolchainBootstrap(targetRootPath) {
  return toolchainBootstrapPaths.every((path) => !existsSync(join(targetRootPath, path)))
}

export function runToolchainPreflight({ targetRootPath, contractRootPath, assertContract = assertToolchainContract, log = console.log }) {
  if (isFirstToolchainBootstrap(targetRootPath)) {
    log('[sync] first-sync toolchain bootstrap: validating copied rails before commit')
    return 'bootstrap'
  }

  assertContract({ targetRootPath, contractRootPath })
  return 'validated'
}

export function applyBuildContractScripts(
  sourcePackage,
  targetPackage,
  scriptNames = buildContractPackageScripts,
) {
  const nextPackage = structuredClone(targetPackage)
  nextPackage.scripts = nextPackage.scripts || {}
  const addedScripts = []
  const updatedScripts = []

  for (const scriptName of scriptNames) {
    const sourceValue = sourcePackage.scripts?.[scriptName]
    if (!sourceValue) continue

    const previousValue = nextPackage.scripts[scriptName]
    nextPackage.scripts[scriptName] = sourceValue

    if (previousValue === undefined) {
      addedScripts.push(scriptName)
    } else if (previousValue !== sourceValue) {
      updatedScripts.push(scriptName)
    }
  }

  return { packageJSON: nextPackage, addedScripts, updatedScripts }
}

export function applyBuildContractFiles(
  sourceRootPath,
  targetRootPath,
  filePaths = buildContractFilePaths,
) {
  const applied = []
  const updated = []
  const skipped = []

  for (const relativePath of filePaths) {
    const source = join(sourceRootPath, relativePath)
    const destination = join(targetRootPath, relativePath)

    if (!existsSync(source)) {
      skipped.push({ path: relativePath, reason: 'missing-source' })
      continue
    }

    const hadExisting = existsSync(destination)
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

export function buildPackageSyncProposal(
  sourcePackage,
  targetPackage,
  {
    managedPackageScripts: managedScripts = managedPackageScripts,
    suggestedPackageScripts: suggestedScripts = suggestedPackageScripts,
    suggestedPackageSections: suggestedSections = suggestedPackageSections,
  } = {},
) {
  const missingScripts = []
  const differentScripts = []
  const differentBemoatScripts = []
  const missingSectionEntries = {}
  const differentSectionEntries = {}

  for (const scriptName of managedScripts) {
    const sourceValue = sourcePackage.scripts?.[scriptName]
    const targetValue = targetPackage.scripts?.[scriptName]
    if (!sourceValue || targetValue === undefined) continue

    if (targetValue !== sourceValue) {
      differentBemoatScripts.push({ name: scriptName, source: sourceValue, target: targetValue })
    }
  }

  for (const scriptName of suggestedScripts) {
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

  for (const section of suggestedSections) {
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

export function formatPackageSyncProposal({ repo, ref, proposal, suggestedPackageSections: suggestedSections = suggestedPackageSections }) {
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
    for (const section of suggestedSections) {
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
  applyBuildContract = false,
  syncConfig = getDefaultSyncConfig(),
}) {
  const sourcePackagePath = join(sourceRootPath, 'package.json')
  const targetPackagePath = join(targetRootPath, 'package.json')

  if (!existsSync(sourcePackagePath) || !existsSync(targetPackagePath)) {
    return {
      addedScripts: [],
      appliedBuildContractScripts: [],
      updatedBuildContractScripts: [],
      proposalPath: null,
      proposal: null,
      packageChanged: false,
    }
  }

  const sourcePackage = readJSON(sourcePackagePath)
  const targetPackage = readJSON(targetPackagePath)
  assertExactManagedPackageScripts(sourcePackage, targetPackage)
  const { packageJSON: managedPackageJSON, addedScripts } = applyManagedPackageScripts(
    sourcePackage,
    targetPackage,
    syncConfig.managedPackageScripts,
  )

  let packageJSON = managedPackageJSON
  let appliedBuildContractScripts = []
  let updatedBuildContractScripts = []

  if (applyBuildContract) {
    const buildContractResult = applyBuildContractScripts(
      sourcePackage,
      packageJSON,
      syncConfig.buildContractPackageScripts,
    )
    packageJSON = buildContractResult.packageJSON
    appliedBuildContractScripts = buildContractResult.addedScripts
    updatedBuildContractScripts = buildContractResult.updatedScripts
  }

  const proposal = buildPackageSyncProposal(sourcePackage, targetPackage, syncConfig)
  const proposalMarkdown = formatPackageSyncProposal({
    repo: sourceRepo,
    ref: sourceRef,
    proposal,
    suggestedPackageSections: syncConfig.suggestedPackageSections,
  })
  const proposalPath = join(targetRootPath, packageSyncProposalPath)

  mkdirSync(dirname(proposalPath), { recursive: true })
  writeFileSync(proposalPath, proposalMarkdown)

  const packageChanged =
    addedScripts.length > 0 ||
    appliedBuildContractScripts.length > 0 ||
    updatedBuildContractScripts.length > 0

  if (packageChanged) {
    writeFileSync(targetPackagePath, `${JSON.stringify(packageJSON, null, 2)}\n`)
  }

  return {
    addedScripts,
    appliedBuildContractScripts,
    updatedBuildContractScripts,
    proposalPath: packageSyncProposalPath,
    proposal,
    packageChanged,
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

export function commitValidatedSyncChanges(options, { validate = () => {}, git = createGitClient() } = {}) {
  validate()
  return commitSyncedChanges(options, git)
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
  buildContractFiles = { applied: [], updated: [], skipped: [] },
  syncedAt = new Date().toISOString(),
  syncConfig = getDefaultSyncConfig(),
}) {
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
      addedScripts: packageSync.addedScripts,
      appliedBuildContractScripts: packageSync.appliedBuildContractScripts ?? [],
      updatedBuildContractScripts: packageSync.updatedBuildContractScripts ?? [],
      proposalPath: packageSync.proposalPath,
    },
    buildContractFiles: {
      applied: buildContractFiles.applied ?? [],
      updated: buildContractFiles.updated ?? [],
      skipped: buildContractFiles.skipped ?? [],
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
  syncConfig = getDefaultSyncConfig(),
}) {
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
    const result = copyManagedPath(sourceRootPath, targetRootPath, path)
    if (result.copied) syncedManaged.push(path)
  }

  if (!seedOnlyPathsSkipped) {
    for (const path of syncConfig.seedOnlyPaths) {
      const result = copySeedOnlyPath(sourceRootPath, targetRootPath, path)
      if (result.reason === 'missing-source') {
        onWarn(`[skip] ${path} not found in ${repo}#${ref}`)
        continue
      }

      seededFiles.push(...result.seeded)
      skippedSeedFiles.push(...result.skipped)
    }
  }

  for (const path of syncConfig.mergeKeepPaths) {
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
