import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { assertManagedRuntimeDeliveryClosure as assertManagedRuntimeDeliveryClosureDefault } from '../guard-harness-contract.mjs'
import { scanToolchainContract } from '../guard-toolchain-contract.mjs'
import { SYNC_MODES, getDefaultSyncConfig } from './config.mjs'
import {
  buildContractFilePaths,
  buildContractPackageScripts,
  exactManagedPackageScripts,
  listPathFiles,
  managedPackageScripts,
  packageSyncProposalPath,
  suggestedPackageScripts,
  suggestedPackageSections,
} from './inventory.mjs'

const repo = process.env.BEMOAT_BOILERPLATE_REPO || 'boat1994/bemoat-web-starter'
const ref = process.env.BEMOAT_BOILERPLATE_REF || 'main'
const targetRoot = process.cwd()

export const syncMetadataPath = '.bemoat-boilerplate-sync.json'

export function copyManagedPath(
  sourceRootPath,
  targetRootPath,
  relativePath,
  { onMutation = () => {} } = {},
) {
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
  sourceRootPath,
  targetRootPath,
  relativePath,
  { onMutation = () => {} } = {},
) {
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

export function mergeKeepPath(
  sourceRootPath,
  targetRootPath,
  relativePath,
  { onMutation = () => {} } = {},
) {
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

export function readJSON(path) {
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
  { onMutation = () => {} } = {},
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
  onMutation = () => {},
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

  onMutation()
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

export function syncPathsFromSource({
  sourceRootPath,
  targetRootPath,
  mode = SYNC_MODES.HARNESS_ONLY,
  onWarn = console.warn,
  onLog = console.log,
  syncConfig = getDefaultSyncConfig(),
  assertManagedRuntimeDeliveryClosure = assertManagedRuntimeDeliveryClosureDefault,
  onMutation = () => {},
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
