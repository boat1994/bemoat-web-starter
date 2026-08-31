import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import {
  buildContractPackageScripts,
  exactManagedPackageScripts,
  managedPackageScripts,
  packageSyncProposalPath,
  suggestedPackageScripts,
  suggestedPackageSections,
} from './inventory.ts'
import { getDefaultSyncConfig } from './config.ts'
import type {
  BuildContractSyncResult,
  PackageJson,
  PackageJsonWithScripts,
  PackageSectionEntry,
  PackageSyncProposal,
  PackageSyncResult,
  SyncConfig,
} from './types.ts'

const repo = process.env.BEMOAT_BOILERPLATE_REPO || 'boat1994/bemoat-web-starter'
const ref = process.env.BEMOAT_BOILERPLATE_REF || 'main'

function isJsonObject(value: unknown): value is PackageJson {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readJSON(path: string): PackageJson {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!isJsonObject(parsed)) throw new TypeError(`Expected a JSON object in ${path}`)
  return parsed
}

function clonePackage(targetPackage: PackageJson): PackageJsonWithScripts {
  return { ...structuredClone(targetPackage), scripts: targetPackage.scripts ? { ...targetPackage.scripts } : {} }
}

export function applyManagedPackageScripts(
  sourcePackage: PackageJson,
  targetPackage: PackageJson,
  scriptNames: string[] = managedPackageScripts,
): { packageJSON: PackageJsonWithScripts; addedScripts: string[] } {
  const nextPackage = clonePackage(targetPackage)
  const addedScripts: string[] = []
  for (const scriptName of scriptNames) {
    const sourceValue = sourcePackage.scripts?.[scriptName]
    if (!sourceValue || scriptName in nextPackage.scripts) continue
    nextPackage.scripts[scriptName] = sourceValue
    addedScripts.push(scriptName)
  }
  return { packageJSON: nextPackage, addedScripts }
}

export function assertExactManagedPackageScripts(
  sourcePackage: PackageJson,
  targetPackage: PackageJson,
  scriptNames: string[] = exactManagedPackageScripts,
): void {
  for (const scriptName of scriptNames) {
    const sourceValue = sourcePackage.scripts?.[scriptName]
    const targetValue = targetPackage.scripts?.[scriptName]
    if (!sourceValue || targetValue === undefined) continue
    if (targetValue !== sourceValue) {
      throw new Error(`Managed package script ${scriptName} diverges from the boilerplate contract`)
    }
  }
}

export function applyBuildContractScripts(
  sourcePackage: PackageJson,
  targetPackage: PackageJson,
  scriptNames: string[] = buildContractPackageScripts,
): BuildContractSyncResult & { packageJSON: PackageJsonWithScripts } {
  const nextPackage = clonePackage(targetPackage)
  const addedScripts: string[] = []
  const updatedScripts: string[] = []
  for (const scriptName of scriptNames) {
    const sourceValue = sourcePackage.scripts?.[scriptName]
    if (!sourceValue) continue
    const previousValue = nextPackage.scripts[scriptName]
    nextPackage.scripts[scriptName] = sourceValue
    if (previousValue === undefined) addedScripts.push(scriptName)
    else if (previousValue !== sourceValue) updatedScripts.push(scriptName)
  }
  return { packageJSON: nextPackage, addedScripts, updatedScripts }
}

export function buildPackageSyncProposal(
  sourcePackage: PackageJson,
  targetPackage: PackageJson,
  {
    managedPackageScripts: managedScripts = managedPackageScripts,
    suggestedPackageScripts: suggestedScripts = suggestedPackageScripts,
    suggestedPackageSections: suggestedSections = suggestedPackageSections,
  }: { managedPackageScripts?: string[]; suggestedPackageScripts?: string[]; suggestedPackageSections?: string[] } = {},
): PackageSyncProposal {
  const missingScripts: PackageSyncProposal['missingScripts'] = []
  const differentScripts: PackageSyncProposal['differentScripts'] = []
  const differentBemoatScripts: PackageSyncProposal['differentBemoatScripts'] = []
  const missingSectionEntries: Record<string, PackageSectionEntry[]> = {}
  const differentSectionEntries: Record<string, PackageSectionEntry[]> = {}

  for (const scriptName of managedScripts) {
    const sourceValue = sourcePackage.scripts?.[scriptName]
    const targetValue = targetPackage.scripts?.[scriptName]
    if (sourceValue && targetValue !== undefined && targetValue !== sourceValue) {
      differentBemoatScripts.push({ name: scriptName, source: sourceValue, target: targetValue })
    }
  }
  for (const scriptName of suggestedScripts) {
    const sourceValue = sourcePackage.scripts?.[scriptName]
    if (!sourceValue) continue
    const targetValue = targetPackage.scripts?.[scriptName]
    if (targetValue === undefined) missingScripts.push({ name: scriptName, value: sourceValue })
    else if (targetValue !== sourceValue) differentScripts.push({ name: scriptName, source: sourceValue, target: targetValue })
  }
  for (const section of suggestedSections) {
    const sourceSection = isJsonObject(sourcePackage[section]) ? sourcePackage[section] : {}
    const targetSection = isJsonObject(targetPackage[section]) ? targetPackage[section] : {}
    const missing: PackageSectionEntry[] = []
    const different: PackageSectionEntry[] = []
    for (const [name, sourceValue] of Object.entries(sourceSection)) {
      const targetValue = targetSection[name]
      if (targetValue === undefined) missing.push({ name, value: sourceValue })
      else if (targetValue !== sourceValue) different.push({ name, source: sourceValue, target: targetValue })
    }
    if (missing.length > 0) missingSectionEntries[section] = missing
    if (different.length > 0) differentSectionEntries[section] = different
  }
  return { missingScripts, differentScripts, differentBemoatScripts, missingSectionEntries, differentSectionEntries }
}

export function formatPackageSyncProposal({
  repo,
  ref,
  proposal,
  suggestedPackageSections: suggestedSections = suggestedPackageSections,
}: {
  repo: string
  ref: string
  proposal: PackageSyncProposal
  suggestedPackageSections?: string[]
}): string {
  const lines = [
    '# Bemoat package sync proposal', '', `Generated from \`${repo}#${ref}\`.`, '',
    'This report is informational only. `package.json` is child-owned. Do not apply these changes automatically. Review manually before changing scripts or dependencies.',
    '', '## Managed `bemoat:*` scripts', '',
    'Sync adds missing namespaced scripts only. Existing `bemoat:*` entries are never overwritten.', '',
    '## Script drift report (human review only)', '',
  ]
  const hasScriptDrift = proposal.missingScripts.length > 0 || proposal.differentScripts.length > 0 || proposal.differentBemoatScripts.length > 0
  if (!hasScriptDrift) lines.push('- No missing or differing scripts to report.')
  else {
    if (proposal.differentBemoatScripts.length > 0) {
      lines.push('### Existing `bemoat:*` scripts differ from starter', '')
      for (const script of proposal.differentBemoatScripts) lines.push(`- \`${script.name}\``, `  - starter: \`${script.source}\``, `  - child: \`${script.target}\``)
      lines.push('')
    }
    if (proposal.missingScripts.length > 0) {
      lines.push('### Missing non-namespaced scripts in child project', '')
      for (const script of proposal.missingScripts) lines.push(`- \`${script.name}\`: \`${script.value}\``)
      lines.push('')
    }
    if (proposal.differentScripts.length > 0) {
      lines.push('### Non-namespaced scripts differ from starter', '')
      for (const script of proposal.differentScripts) lines.push(`- \`${script.name}\``, `  - starter: \`${script.source}\``, `  - child: \`${script.target}\``)
      lines.push('')
    }
  }
  lines.push('## Dependency drift report (human review only)', '')
  const hasSectionDrift = Object.keys(proposal.missingSectionEntries).length > 0 || Object.keys(proposal.differentSectionEntries).length > 0
  if (!hasSectionDrift) lines.push('- No missing or differing dependencies to report.')
  else {
    for (const section of suggestedSections) {
      const missing = proposal.missingSectionEntries[section] || []
      const different = proposal.differentSectionEntries[section] || []
      if (missing.length === 0 && different.length === 0) continue
      lines.push(`### ${section}`, '')
      if (missing.length > 0) {
        lines.push('Missing in child project:')
        for (const entry of missing) lines.push(`- \`${entry.name}\`: \`${entry.value}\``)
        lines.push('')
      }
      if (different.length > 0) {
        lines.push('Differs from starter:')
        for (const entry of different) lines.push(`- \`${entry.name}\`: starter \`${entry.source}\`, child \`${entry.target}\``)
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
}: {
  sourceRootPath: string
  targetRootPath: string
  repo?: string
  ref?: string
  applyBuildContract?: boolean
  syncConfig?: SyncConfig
  onMutation?: () => void
}): PackageSyncResult {
  const sourcePackagePath = join(sourceRootPath, 'package.json')
  const targetPackagePath = join(targetRootPath, 'package.json')
  if (!existsSync(sourcePackagePath) || !existsSync(targetPackagePath)) {
    return { addedScripts: [], appliedBuildContractScripts: [], updatedBuildContractScripts: [], proposalPath: null, proposal: null, packageChanged: false }
  }
  const sourcePackage = readJSON(sourcePackagePath)
  const targetPackage = readJSON(targetPackagePath)
  assertExactManagedPackageScripts(sourcePackage, targetPackage)
  const { packageJSON: managedPackageJSON, addedScripts } = applyManagedPackageScripts(sourcePackage, targetPackage, syncConfig.managedPackageScripts)
  let packageJSON = managedPackageJSON
  let appliedBuildContractScripts: string[] = []
  let updatedBuildContractScripts: string[] = []
  if (applyBuildContract) {
    const buildContractResult = applyBuildContractScripts(sourcePackage, packageJSON, syncConfig.buildContractPackageScripts)
    packageJSON = buildContractResult.packageJSON
    appliedBuildContractScripts = buildContractResult.addedScripts
    updatedBuildContractScripts = buildContractResult.updatedScripts
  }
  const proposal = buildPackageSyncProposal(sourcePackage, targetPackage, syncConfig)
  const proposalMarkdown = formatPackageSyncProposal({ repo: sourceRepo, ref: sourceRef, proposal, suggestedPackageSections: syncConfig.suggestedPackageSections })
  const proposalPath = join(targetRootPath, packageSyncProposalPath)
  onMutation()
  mkdirSync(dirname(proposalPath), { recursive: true })
  writeFileSync(proposalPath, proposalMarkdown)
  const packageChanged = addedScripts.length > 0 || appliedBuildContractScripts.length > 0 || updatedBuildContractScripts.length > 0
  if (packageChanged) writeFileSync(targetPackagePath, `${JSON.stringify(packageJSON, null, 2)}\n`)
  return { addedScripts, appliedBuildContractScripts, updatedBuildContractScripts, proposalPath: packageSyncProposalPath, proposal, packageChanged }
}
