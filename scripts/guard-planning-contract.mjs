#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseMissionControlState } from './mission-control-state.mjs'
import {
  parseIssueNumber,
  parseTaskIdentityBlock,
  makeViolation,
  validatePairedContracts,
  validateStaticContract,
} from './guards/planning-contract.mjs'

export {
  parseTaskIdentityBlock,
  TASK_IDENTITY_REQUIRED_KEYS,
  TERMINAL_TRANSITION_TARGETS,
  VALID_TASK_ISSUE_STRATEGIES,
} from './guards/planning-contract.mjs'

const PLANNING_ROOTS = [
  'docs/superpowers/plans',
  'docs/superpowers/specs',
]

function isPlanningPath(relativePath) {
  return PLANNING_ROOTS.some((root) =>
    relativePath === root || relativePath.startsWith(`${root}/`),
  )
}

function walkPlanningFiles(rootDir, relativeDir, results = []) {
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

function runGit(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function resolveApprovedBase(root, options = {}) {
  if (options.approvedBase) {
    return options.approvedBase
  }

  const originDev = runGit(['merge-base', 'HEAD', 'origin/dev'], root)
  if (originDev.status === 0) {
    const sha = originDev.stdout.trim()
    if (sha) return sha
  }

  const localDev = runGit(['merge-base', 'HEAD', 'dev'], root)
  if (localDev.status === 0) {
    const sha = localDev.stdout.trim()
    if (sha) return sha
  }

  const originMain = runGit(['merge-base', 'HEAD', 'origin/main'], root)
  if (originMain.status === 0) {
    const sha = originMain.stdout.trim()
    if (sha) return sha
  }

  const main = runGit(['merge-base', 'HEAD', 'main'], root)
  if (main.status === 0) {
    const sha = main.stdout.trim()
    if (sha) return sha
  }

  return null
}

function discoverPlanningFiles(root, options = {}) {
  if (Array.isArray(options.files) && options.files.length > 0) {
    return [...new Set(options.files.map((filePath) => filePath.replace(/\\/g, '/')))]
  }

  if (options.checkAll) {
    const files = []
    for (const planningRoot of PLANNING_ROOTS) {
      walkPlanningFiles(root, planningRoot, files)
    }
    return files
  }

  const diff = runGit(['diff', '--name-only', '--diff-filter=ACMRTUXB', 'HEAD'], root)
  const cached = runGit(['diff', '--cached', '--name-only', '--diff-filter=ACMRTUXB'], root)
  const untracked = runGit(['ls-files', '--others', '--exclude-standard'], root)
  const candidates = new Set(
    `${diff.stdout}\n${cached.stdout}\n${untracked.stdout}`
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  )

  const approvedBase = resolveApprovedBase(root, options)
  if (approvedBase) {
    const branchDiff = runGit(
      ['diff', '--name-only', '--diff-filter=ACMRTUXB', `${approvedBase}...HEAD`],
      root,
    )
    for (const line of branchDiff.stdout.split('\n')) {
      const trimmed = line.trim()
      if (trimmed) candidates.add(trimmed)
    }
  }

  return [...candidates].filter(isPlanningPath)
}

function validatePlanningFile(root, relativePath, readFile, validatedPairs, allViolations) {
  const absolutePath = resolve(root, relativePath)
  if (!existsSync(absolutePath)) return

  const content = readFile(absolutePath)
  const parsed = parseTaskIdentityBlock(content, relativePath)
  allViolations.push(...parsed.violations)
  if (!parsed.valid || !parsed.contract) return

  allViolations.push(...validateStaticContract(parsed.contract, relativePath))

  const pairedSpecPath = parsed.contract.paired_spec
  const pairedPlanPath = parsed.contract.paired_plan
  if (!pairedSpecPath || !pairedPlanPath) return

  const normalizedPath = relativePath.replace(/\\/g, '/')
  const isSpec = normalizedPath === String(pairedSpecPath).replace(/\\/g, '/')
  const isPlan = normalizedPath === String(pairedPlanPath).replace(/\\/g, '/')
  if (!isSpec && !isPlan) return

  const pairKey = [String(pairedSpecPath), String(pairedPlanPath)].sort().join('::')
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

/**
 * @param {{ root?: string, files?: string[], checkAll?: boolean, approvedBase?: string, readFile?: (filePath: string) => string }} [options]
 */
export function runPlanningContractGuard(options = {}) {
  const root = options.root ?? process.cwd()
  const readFile = options.readFile ?? ((filePath) => readFileSync(filePath, 'utf8'))
  const files = discoverPlanningFiles(root, options)
  /** @type {import('./guard-planning-contract.mjs').PlanningViolation[]} */
  const violations = []
  const validatedPairs = new Set()

  for (const relativePath of files) {
    validatePlanningFile(root, relativePath, readFile, validatedPairs, violations)
  }

  return violations
}

export function formatPlanningContractViolations(violations) {
  if (violations.length === 0) {
    return ['Planning contract guard passed.']
  }

  return violations.map((item) =>
    `[${item.rule}] ${item.file}: ${item.message}. Found: ${item.found}. Reason: ${item.reason}. Corrective action: ${item.correctiveAction}`,
  )
}

export function getPlanningContractExitCode(violations) {
  return violations.length > 0 ? 1 : 0
}

function getOriginUrl(cwd) {
  const result = runGit(['remote', 'get-url', 'origin'], cwd)
  if (result.status !== 0) return null
  const origin = result.stdout.trim()
  return origin || null
}

function getDefaultRepo(cwd) {
  const origin = getOriginUrl(cwd)
  if (!origin) return null

  if (origin.startsWith('git@github.com:')) {
    return origin.slice('git@github.com:'.length).replace(/\.git$/, '')
  }

  if (origin.startsWith('https://github.com/')) {
    return origin.replace('https://github.com/', '').replace(/\.git$/, '')
  }

  return null
}

function parseRepoFromIssueUrl(url) {
  if (!url || typeof url !== 'string') return null
  const match = url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/\d+/)
  return match ? match[1] : null
}

export function defaultRunGh(args, options = {}) {
  const result = spawnSync('gh', args, {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    encoding: 'utf8',
  })

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function isGhAvailable(runGh, cwd, env) {
  const version = runGh(['--version'], { cwd, env })
  if (version.status !== 0) return false
  const auth = runGh(['auth', 'status'], { cwd, env })
  return auth.status === 0
}

function issueIdentifiesTaskKey(issue, taskKey) {
  const haystack = `${issue.title ?? ''}\n${issue.body ?? ''}`.toLowerCase()
  return haystack.includes(String(taskKey).toLowerCase())
}

function validateMissionControlCompatibility(stateAnalysis, contract, issueNumber, filePath) {
  if (!stateAnalysis.present || !stateAnalysis.valid || !stateAnalysis.state) {
    return []
  }

  const managedState = stateAnalysis.state
  const expectedIssueNumber = parseIssueNumber(contract.active_task_issue)
  const managedIssueNumber = parseIssueNumber(String(managedState.active_task_issue ?? ''))
  const hasTerminalState = managedState.state === 'DONE'
  const hasIssueConflict =
    Boolean(expectedIssueNumber && managedIssueNumber) &&
    managedIssueNumber !== expectedIssueNumber

  if (!hasTerminalState && !hasIssueConflict) {
    return []
  }

  return [makeViolation({
    rule: 'PLAN010',
    file: filePath,
    message: 'Incompatible Mission Control state on active task issue',
    found: 'incompatible Mission Control state',
    reason: 'recorded state is DONE or conflicts with task issue',
    correctiveAction: `Reconcile Mission Control state on issue #${issueNumber}`,
  })]
}

/**
 * @param {{
 *   cwd?: string,
 *   filePath: string,
 *   contract: import('./guard-planning-contract.mjs').TaskIdentityContract,
 *   env?: Record<string, string>,
 *   offline?: boolean,
 *   runGh?: typeof defaultRunGh,
 * }} options
 */
export function verifyLiveTaskIdentity(options) {
  const cwd = options.cwd ?? process.cwd()
  const env = options.env ?? process.env
  const runGh = options.runGh ?? defaultRunGh
  const filePath = options.filePath
  const contract = options.contract

  if (options.offline || !isGhAvailable(runGh, cwd, env)) {
    return {
      ok: true,
      degradedOffline: true,
      violations: [],
    }
  }

  if (contract.task_issue_strategy === 'create_before_execution') {
    return {
      ok: true,
      degradedOffline: false,
      violations: [],
    }
  }

  if (contract.task_issue_strategy !== 'existing_dedicated_issue') {
    return {
      ok: true,
      degradedOffline: false,
      violations: [],
    }
  }

  const issueNumber = parseIssueNumber(contract.active_task_issue)
  if (!issueNumber) {
    return {
      ok: true,
      degradedOffline: false,
      violations: [],
    }
  }

  const defaultRepo = getDefaultRepo(cwd)
  const args = ['issue', 'view', issueNumber, '--json', 'title,state,body,url']
  if (defaultRepo) {
    args.push('--repo', defaultRepo)
  }

  const ghResult = runGh(args, { cwd, env })
  if (ghResult.status !== 0) {
    return {
      ok: false,
      degradedOffline: false,
      violations: [makeViolation({
        rule: 'PLAN008',
        file: filePath,
        message: 'Active task issue could not be verified in the target repository',
        found: ghResult.stderr.trim() || ghResult.stdout.trim() || 'GitHub issue lookup failed',
        reason: `Active task issue #${issueNumber} could not be verified in the target repository`,
        correctiveAction: `Verify issue #${issueNumber} exists in the current repository`,
      })],
    }
  }

  let issue
  try {
    issue = JSON.parse(ghResult.stdout)
  } catch (error) {
    return {
      ok: false,
      degradedOffline: false,
      violations: [makeViolation({
        rule: 'PLAN008',
        file: filePath,
        message: 'Active task issue metadata could not be parsed',
        found: error instanceof Error ? error.message : String(error),
        reason: `Active task issue #${issueNumber} returned invalid GitHub metadata`,
        correctiveAction: `Re-fetch issue #${issueNumber} with gh issue view`,
      })],
    }
  }

  const issueRepo = parseRepoFromIssueUrl(issue.url)
  if (defaultRepo && issueRepo && issueRepo !== defaultRepo) {
    return {
      ok: false,
      degradedOffline: false,
      violations: [makeViolation({
        rule: 'PLAN008',
        file: filePath,
        message: 'Active task issue belongs to a different repository',
        found: issue.url ?? 'missing issue URL',
        reason: `Active task issue #${issueNumber} is not in repository ${defaultRepo}`,
        correctiveAction: `Point active_task_issue to an issue in ${defaultRepo}`,
      })],
    }
  }

  if (issue.state !== 'OPEN') {
    return {
      ok: false,
      degradedOffline: false,
      violations: [makeViolation({
        rule: 'PLAN008',
        file: filePath,
        message: 'Active task issue is closed or terminal',
        found: `state '${issue.state}'`,
        reason: `Active task issue #${issueNumber} is closed/terminal`,
        correctiveAction: `Reopen issue #${issueNumber} or create a new dedicated open task issue`,
      })],
    }
  }

  if (!issueIdentifiesTaskKey(issue, contract.task_key)) {
    return {
      ok: false,
      degradedOffline: false,
      violations: [makeViolation({
        rule: 'PLAN009',
        file: filePath,
        message: 'Active task issue does not identify the declared task_key',
        found: 'task key mismatch',
        reason: `Issue #${issueNumber} title/body does not identify ${contract.task_key}`,
        correctiveAction: `Update active_task_issue to point to the issue for ${contract.task_key}`,
      })],
    }
  }

  const missionControlViolations = validateMissionControlCompatibility(
    parseMissionControlState(issue.body ?? ''),
    contract,
    issueNumber,
    filePath,
  )
  if (missionControlViolations.length > 0) {
    return {
      ok: false,
      degradedOffline: false,
      violations: missionControlViolations,
    }
  }

  return {
    ok: true,
    degradedOffline: false,
    violations: [],
    issueMetadata: {
      number: issueNumber,
      state: issue.state,
      title: issue.title,
      body: issue.body,
    },
  }
}

export function isDirectExecution() {
  const entrypoint = process.argv[1]
  if (!entrypoint) return false
  return import.meta.url === pathToFileURL(resolve(entrypoint)).href
}

function main() {
  const violations = runPlanningContractGuard()
  for (const line of formatPlanningContractViolations(violations)) {
    console.log(line)
  }
  process.exit(getPlanningContractExitCode(violations))
}

if (isDirectExecution()) main()
