#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseLegacyManagedStateIdentity } from './legacy-managed-state.ts'
import {
  makeViolation,
  parseIssueNumber,
  parseTaskIdentityBlock,
  validatePairedContracts,
  validateStaticContract,
} from './planning-contract.ts'
import type { PlanningViolation } from './planning-contract.ts'
import type { ReadTextFile } from './types.ts'
import {
  defaultRunGh,
  verifyLiveTaskIdentity as verifyLiveTaskIdentityInternal,
} from './planning-contract-live.ts'
import type {
  TaskVerificationResult,
  VerifyLiveTaskIdentityOptions,
} from './planning-contract-live.ts'
export {
  parseTaskIdentityBlock,
  TASK_IDENTITY_REQUIRED_KEYS,
  TERMINAL_TRANSITION_TARGETS,
  VALID_TASK_ISSUE_STRATEGIES,
} from './planning-contract.ts'
export { defaultRunGh }
const PLANNING_ROOTS = [
  'docs/superpowers/plans',
  'docs/superpowers/specs',
]

function validateLegacyManagedStateCompatibility(
  stateAnalysis: ReturnType<typeof parseLegacyManagedStateIdentity>,
  contract: VerifyLiveTaskIdentityOptions['contract'],
  issueNumber: string,
  filePath: string,
): PlanningViolation[] {
  if (!stateAnalysis.present) return []
  if (!stateAnalysis.valid || !stateAnalysis.state) {
    return [makeViolation({
      rule: 'PLAN010',
      file: filePath,
      message: 'Malformed legacy managed-state metadata on active task issue',
      found: 'malformed managed state',
      reason: stateAnalysis.reason ?? 'managed state identity could not be validated',
      correctiveAction: `Repair or remove legacy managed-state metadata on issue #${issueNumber}`,
    })]
  }
  const managedState = stateAnalysis.state
  const expectedIssueNumber = parseIssueNumber(contract.active_task_issue)
  const managedIssueNumber = parseIssueNumber(String(managedState.active_task_issue ?? ''))
  const hasTerminalState = managedState.state === 'DONE'
  const hasIssueConflict = Boolean(expectedIssueNumber && managedIssueNumber) && managedIssueNumber !== expectedIssueNumber
  if (!hasTerminalState && !hasIssueConflict) return []
  return [makeViolation({
    rule: 'PLAN010',
    file: filePath,
    message: 'Incompatible legacy managed-state metadata on active task issue',
    found: 'incompatible legacy managed-state metadata',
    reason: 'recorded state is DONE or conflicts with task issue',
    correctiveAction: `Repair or remove legacy managed-state metadata on issue #${issueNumber}`,
  })]
}

export function verifyLiveTaskIdentity(options: VerifyLiveTaskIdentityOptions): TaskVerificationResult {
  return verifyLiveTaskIdentityInternal({
    ...options,
    validateLegacyManagedState: (issue, contract, issueNumber, filePath) =>
      validateLegacyManagedStateCompatibility(
        parseLegacyManagedStateIdentity(issue.body ?? ''),
        contract,
        issueNumber,
        filePath,
      ),
  })
}

interface GitResult {
  status: number
  stdout: string
  stderr: string
}

interface PlanningGuardOptions {
  root?: string
  files?: readonly string[]
  checkAll?: boolean
  approvedBase?: string
  readFile?: ReadTextFile
}

function isPlanningPath(relativePath: string): boolean {
  return PLANNING_ROOTS.some((root) =>
    relativePath === root || relativePath.startsWith(`${root}/`),
  )
}
function walkPlanningFiles(rootDir: string, relativeDir: string, results: string[] = []): string[] {
  const absoluteDir = join(rootDir, relativeDir)
  if (!existsSync(absoluteDir)) return results
  for (const entry of readdirSync(absoluteDir)) {
    const relativePath = join(relativeDir, entry).replace(/\\/g, '/')
    const absolutePath = join(rootDir, relativePath)
    const stats = statSync(absolutePath)
    if (stats.isDirectory()) {
      walkPlanningFiles(rootDir, relativePath, results)
      continue
    }
    if (stats.isFile() && relativePath.endsWith('.md')) {
      results.push(relativePath)
    }
  }
  return results
}
function runGit(args: string[], cwd: string): GitResult {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}
function resolveApprovedBaseCandidates(root: string, options: PlanningGuardOptions = {}): string[] {
  if (options.approvedBase) {
    return [options.approvedBase]
  }
  return ['origin/dev', 'dev', 'origin/main', 'main'].filter((ref) => {
    const relationship = runGit(['merge-base', 'HEAD', ref], root)
    return relationship.status === 0 && relationship.stdout.trim().length > 0
  })
}
function resolveApprovedBaseDiff(root: string, approvedBase: string): GitResult | null {
  const approvedTree = runGit(['rev-parse', '--verify', `${approvedBase}^{tree}`], root)
  const headTree = runGit(['rev-parse', '--verify', 'HEAD^{tree}'], root)
  if (approvedTree.status !== 0 || headTree.status !== 0) return null
  const diffRange =
    approvedTree.stdout.trim() === headTree.stdout.trim()
      ? [approvedBase, 'HEAD']
      : [approvedBase + '...HEAD']
  return runGit(
    ['diff', '--name-only', '--diff-filter=ACMRTUXB', ...diffRange],
    root,
  )
}
function discoverPlanningFiles(root: string, options: PlanningGuardOptions = {}): string[] {
  if (Array.isArray(options.files) && options.files.length > 0) {
    return [...new Set(options.files.map((filePath) => filePath.replace(/\\/g, '/')))]
  }
  if (options.checkAll) {
    const files: string[] = []
    for (const planningRoot of PLANNING_ROOTS) {
      walkPlanningFiles(root, planningRoot, files)
    }
    return files
  }
  const diff = runGit(['diff', '--name-only', '--diff-filter=ACMRTUXB', 'HEAD'], root)
  const cached = runGit(['diff', '--cached', '--name-only', '--diff-filter=ACMRTUXB'], root)
  const untracked = runGit(['ls-files', '--others', '--exclude-standard'], root)
  const workingTreeDiffFailed = diff.status !== 0 || cached.status !== 0 || untracked.status !== 0
  const candidates = new Set(
    `${diff.stdout}\n${cached.stdout}\n${untracked.stdout}`
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  )
  let branchDiff: GitResult | null = null
  for (const approvedBase of resolveApprovedBaseCandidates(root, options)) {
    const candidateDiff = resolveApprovedBaseDiff(root, approvedBase)
    if (!candidateDiff || candidateDiff.status !== 0) continue
    branchDiff = candidateDiff
    break
  }
  if (branchDiff && !workingTreeDiffFailed) {
    for (const line of branchDiff.stdout.split('\n')) {
      const trimmed = line.trim()
      if (trimmed) candidates.add(trimmed)
    }
  } else {
    for (const planningRoot of PLANNING_ROOTS) {
      const fallbackFiles: string[] = []
      walkPlanningFiles(root, planningRoot, fallbackFiles)
      for (const file of fallbackFiles) candidates.add(file)
    }
  }
  return [...candidates].filter(isPlanningPath)
}
function validatePlanningFile(
  root: string,
  relativePath: string,
  readFile: ReadTextFile,
  validatedPairs: Set<string>,
  allViolations: PlanningViolation[],
): void {
  const absolutePath = resolve(root, relativePath)
  if (!existsSync(absolutePath)) return
  const content = readFile(absolutePath)
  const parsed = parseTaskIdentityBlock(content, relativePath)
  allViolations.push(...parsed.violations)
  if (!parsed.valid || !parsed.contract) return
  allViolations.push(...validateStaticContract(parsed.contract, relativePath))
  const pairedSpecPath = parsed.contract.paired_spec
  const pairedPlanPath = parsed.contract.paired_plan
  if (
    typeof pairedSpecPath !== 'string' ||
    typeof pairedPlanPath !== 'string' ||
    pairedSpecPath.trim().length === 0 ||
    pairedPlanPath.trim().length === 0
  ) return
  const normalizedPath = relativePath.replace(/\\/g, '/')
  const isSpec = normalizedPath === pairedSpecPath.replace(/\\/g, '/')
  const isPlan = normalizedPath === pairedPlanPath.replace(/\\/g, '/')
  if (!isSpec && !isPlan) return
  const pairKey = [pairedSpecPath, pairedPlanPath].sort().join('::')
  if (validatedPairs.has(pairKey)) return
  const specAbsolutePath = resolve(root, pairedSpecPath)
  const planAbsolutePath = resolve(root, pairedPlanPath)
  if (!existsSync(specAbsolutePath) || !existsSync(planAbsolutePath)) return
  const specParsed = parseTaskIdentityBlock(readFile(specAbsolutePath), pairedSpecPath)
  const planParsed = parseTaskIdentityBlock(readFile(planAbsolutePath), pairedPlanPath)
  allViolations.push(...specParsed.violations, ...planParsed.violations)
  if (specParsed.valid && specParsed.contract && planParsed.valid && planParsed.contract) {
    allViolations.push(
      ...validatePairedContracts(
        pairedSpecPath,
        specParsed.contract,
        pairedPlanPath,
        planParsed.contract,
      ),
    )
  }
  validatedPairs.add(pairKey)
}
export function runPlanningContractGuard(options: PlanningGuardOptions = {}): PlanningViolation[] {
  const root = options.root ?? process.cwd()
  const readFile = options.readFile ?? ((filePath: string) => readFileSync(filePath, 'utf8'))
  const files = discoverPlanningFiles(root, options)
  const violations: PlanningViolation[] = []
  const validatedPairs = new Set<string>()
  for (const relativePath of files) {
    validatePlanningFile(root, relativePath, readFile, validatedPairs, violations)
  }
  return violations
}
export function formatPlanningContractViolations(violations: PlanningViolation[]): string[] {
  if (violations.length === 0) {
    return ['Planning contract guard passed.']
  }
  return violations.map((item) =>
    `[${item.rule}] ${item.file}: ${item.message}. Found: ${item.found}. Reason: ${item.reason}. Corrective action: ${item.correctiveAction}`,
  )
}
export function getPlanningContractExitCode(violations: PlanningViolation[]): number {
  return violations.length > 0 ? 1 : 0
}
export function isDirectExecution(): boolean {
  const entrypoint = process.argv[1]
  if (!entrypoint) return false
  return import.meta.url === pathToFileURL(resolve(entrypoint)).href
}
function main(): void {
  const violations = runPlanningContractGuard()
  for (const line of formatPlanningContractViolations(violations)) {
    console.log(line)
  }
  process.exit(getPlanningContractExitCode(violations))
}
if (isDirectExecution()) main()
