#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseMissionControlState } from './agent-issue.mjs'

const IDENTITY_START = /<!--\s*bemoat-task-identity:start\s*-->/
const IDENTITY_END = /<!--\s*bemoat-task-identity:end\s*-->/

export const TASK_IDENTITY_REQUIRED_KEYS = [
  'schema_version',
  'main_issue',
  'task_key',
  'task_issue_strategy',
  'active_task_issue',
  'branch_template',
  'transition_target',
  'planning_base_sha',
  'execution_base_rule',
  'paired_spec',
  'paired_plan',
]

export const VALID_TASK_ISSUE_STRATEGIES = new Set([
  'existing_dedicated_issue',
  'create_before_execution',
])

export const TERMINAL_TRANSITION_TARGETS = new Set(['DONE', 'MERGED', 'CLOSED'])

export const KNOWN_TERMINAL_ISSUE_NUMBERS = new Set(['169'])

const PLANNING_ROOTS = [
  'docs/superpowers/plans',
  'docs/superpowers/specs',
]

const IDENTITY_FIELDS_FOR_PAIRING = TASK_IDENTITY_REQUIRED_KEYS.filter(
  (key) => key !== 'paired_spec' && key !== 'paired_plan',
)

function parseScalar(value) {
  const trimmed = value.trim()
  if (trimmed === 'null') return null
  if (/^\d+$/.test(trimmed)) return Number(trimmed)
  const quoted = trimmed.match(/^(["'])(.*)\1$/)
  return quoted ? quoted[2] : trimmed
}

function parseIssueNumber(reference) {
  if (!reference || typeof reference !== 'string') return null
  const trimmed = reference.trim()
  const repoMatch = trimmed.match(/^[\w.-]+\/[\w.-]+#(\d+)$/)
  if (repoMatch) return repoMatch[1]
  const hashMatch = trimmed.match(/#(\d+)/)
  if (hashMatch) return hashMatch[1]
  const bareMatch = trimmed.match(/^(\d+)$/)
  return bareMatch ? bareMatch[1] : null
}

function extractIssueNumbersFromBranch(branchTemplate) {
  if (!branchTemplate || typeof branchTemplate !== 'string') return []
  const numbers = []
  for (const segment of branchTemplate.split('/')) {
    const leading = segment.match(/^(\d+)(?:[-/]|$)/)
    if (leading) numbers.push(leading[1])
  }
  return [...new Set(numbers)]
}

function basenameLabel(filePath) {
  const segments = filePath.split('/')
  return segments[segments.length - 1] || filePath
}

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

  return [...candidates].filter(isPlanningPath)
}

function makeViolation({
  rule,
  file,
  message,
  found,
  reason,
  correctiveAction,
}) {
  return {
    type: 'planning-contract',
    rule,
    file,
    message,
    found,
    reason,
    correctiveAction,
  }
}

/**
 * @param {string} content
 * @param {string} filePath
 */
export function parseTaskIdentityBlock(content = '', filePath = '<unknown>') {
  /** @type {import('./guard-planning-contract.mjs').PlanningViolation[]} */
  const violations = []
  const starts = [...content.matchAll(new RegExp(IDENTITY_START.source, 'g'))]
  const ends = [...content.matchAll(new RegExp(IDENTITY_END.source, 'g'))]

  if (starts.length === 0 && ends.length === 0) {
    violations.push(makeViolation({
      rule: 'PLAN001',
      file: filePath,
      message: 'Missing task identity marker block',
      found: 'none',
      reason: 'Planning documents must declare <!-- bemoat-task-identity:start --> ... <!-- bemoat-task-identity:end -->',
      correctiveAction: 'Add a balanced task identity YAML block with schema_version: 1',
    }))
    return { present: false, valid: false, contract: null, violations }
  }

  if (starts.length !== 1 || ends.length !== 1 || starts[0].index > ends[0].index) {
    violations.push(makeViolation({
      rule: 'PLAN001',
      file: filePath,
      message: 'Malformed task identity marker block',
      found: `${starts.length} start marker(s), ${ends.length} end marker(s)`,
      reason: 'Exactly one balanced marker pair is required',
      correctiveAction: 'Ensure a single <!-- bemoat-task-identity:start --> ... <!-- bemoat-task-identity:end --> pair',
    }))
    return { present: true, valid: false, contract: null, violations }
  }

  const raw = content
    .slice(starts[0].index + starts[0][0].length, ends[0].index)
    .replace(/```yaml\s*|```/g, '')

  /** @type {Record<string, unknown>} */
  const contract = {}
  for (const line of raw.split('\n')) {
    if (!line.trim() || /^\s*#/.test(line)) continue
    const match = line.match(/^\s*([a-z_]+)\s*:\s*(.*?)\s*$/)
    if (!match) {
      violations.push(makeViolation({
        rule: 'PLAN001',
        file: filePath,
        message: 'Unreadable task identity YAML line',
        found: line.trim(),
        reason: 'Task identity YAML must use simple key: value lines',
        correctiveAction: 'Fix the malformed YAML line inside the task identity block',
      }))
      return { present: true, valid: false, contract: null, violations }
    }
    if (Object.hasOwn(contract, match[1])) {
      violations.push(makeViolation({
        rule: 'PLAN001',
        file: filePath,
        message: 'Duplicate task identity key',
        found: match[1],
        reason: 'Each task identity field may appear only once',
        correctiveAction: `Remove the duplicate ${match[1]} entry`,
      }))
      return { present: true, valid: false, contract: null, violations }
    }
    contract[match[1]] = parseScalar(match[2])
  }

  if (contract.schema_version !== 1) {
    violations.push(makeViolation({
      rule: 'PLAN001',
      file: filePath,
      message: 'Unsupported task identity schema_version',
      found: String(contract.schema_version ?? 'missing'),
      reason: 'Only schema_version: 1 is supported',
      correctiveAction: 'Set schema_version: 1 in the task identity block',
    }))
    return { present: true, valid: false, contract: null, violations }
  }

  const missing = TASK_IDENTITY_REQUIRED_KEYS.filter((key) => !Object.hasOwn(contract, key))
  if (missing.length > 0) {
    const missingStrategyOnly = missing.length === 1 && missing[0] === 'task_issue_strategy'
    if (missingStrategyOnly) {
      violations.push(makeViolation({
        rule: 'PLAN006',
        file: filePath,
        message: 'Missing task_issue_strategy',
        found: 'missing',
        reason: 'task_issue_strategy must be existing_dedicated_issue or create_before_execution',
        correctiveAction: 'Add task_issue_strategy with a supported enum value',
      }))
      return { present: true, valid: false, contract: null, violations }
    }

    violations.push(makeViolation({
      rule: 'PLAN001',
      file: filePath,
      message: 'Missing required task identity field(s)',
      found: missing.join(', '),
      reason: 'All schema_version: 1 task identity fields are required',
      correctiveAction: `Add the missing field(s): ${missing.join(', ')}`,
    }))
    return { present: true, valid: false, contract: null, violations }
  }

  return {
    present: true,
    valid: true,
    contract: /** @type {import('./guard-planning-contract.mjs').TaskIdentityContract} */ (contract),
    violations,
  }
}

function validateTaskIssueStrategy(contract, filePath) {
  /** @type {import('./guard-planning-contract.mjs').PlanningViolation[]} */
  const violations = []

  if (!VALID_TASK_ISSUE_STRATEGIES.has(contract.task_issue_strategy)) {
    violations.push(makeViolation({
      rule: 'PLAN006',
      file: filePath,
      message: 'Invalid task_issue_strategy',
      found: String(contract.task_issue_strategy),
      reason: 'task_issue_strategy must be existing_dedicated_issue or create_before_execution',
      correctiveAction: 'Set task_issue_strategy to a supported enum value',
    }))
    return violations
  }

  const activeIssueNumber = parseIssueNumber(contract.active_task_issue)
  if (contract.task_issue_strategy === 'create_before_execution' && activeIssueNumber) {
    violations.push(makeViolation({
      rule: 'PLAN005',
      file: filePath,
      message: 'Concrete active_task_issue declared under create_before_execution',
      found: String(contract.active_task_issue),
      reason: 'create_before_execution requires active_task_issue: null until the dedicated issue is created',
      correctiveAction: 'Set active_task_issue: null until the dedicated GitHub issue exists',
    }))
  }

  if (contract.task_issue_strategy === 'existing_dedicated_issue' && !activeIssueNumber) {
    violations.push(makeViolation({
      rule: 'PLAN006',
      file: filePath,
      message: 'Missing active_task_issue for existing_dedicated_issue strategy',
      found: String(contract.active_task_issue ?? 'null'),
      reason: 'existing_dedicated_issue requires a concrete active_task_issue reference',
      correctiveAction: 'Set active_task_issue to the dedicated open task issue number',
    }))
  }

  return violations
}

function validateExecutionBaseRule(contract, filePath) {
  if (contract.execution_base_rule === 'use_planning_base_sha_unconditionally') {
    return [makeViolation({
      rule: 'PLAN007',
      file: filePath,
      message: 'Unconditional planning-time SHA execution base rule',
      found: contract.execution_base_rule,
      reason: 'Executable branch creation must resolve the live protected base at dispatch',
      correctiveAction: 'Set execution_base_rule to resolve_live_protected_base_at_dispatch',
    })]
  }

  return []
}

function validateBranchTemplate(contract, filePath) {
  const activeIssueNumber = parseIssueNumber(contract.active_task_issue)
  if (!activeIssueNumber) return []

  const mainIssueNumber = parseIssueNumber(contract.main_issue)
  const allowedNumbers = new Set(
    [activeIssueNumber, mainIssueNumber].filter((value) => value !== null),
  )
  const branchNumbers = extractIssueNumbersFromBranch(contract.branch_template)
  const conflicting = branchNumbers.filter((number) => !allowedNumbers.has(number))

  if (conflicting.length === 0) return []

  return [makeViolation({
    rule: 'PLAN003',
    file: filePath,
    message: 'Branch template references an unrelated issue number',
    found: `${contract.branch_template} vs active_task_issue ${contract.active_task_issue ?? 'null'}`,
    reason: 'branch_template must align with the active task issue reference',
    correctiveAction: 'Update branch_template to use the active_task_issue number',
  })]
}

function validateTransitionTarget(contract, filePath) {
  const activeIssueNumber = parseIssueNumber(contract.active_task_issue)
  const transitionIssueNumber = parseIssueNumber(contract.transition_target)
  const transitionIsTerminalStatus = TERMINAL_TRANSITION_TARGETS.has(String(contract.transition_target).trim())

  const targetsKnownTerminalIssue =
    (activeIssueNumber && KNOWN_TERMINAL_ISSUE_NUMBERS.has(activeIssueNumber)) ||
    (transitionIssueNumber && KNOWN_TERMINAL_ISSUE_NUMBERS.has(transitionIssueNumber))

  if (transitionIsTerminalStatus && targetsKnownTerminalIssue) {
    return [makeViolation({
      rule: 'PLAN004',
      file: filePath,
      message: 'Terminal transition target conflicts with a closed task issue',
      found: `transition_target=${contract.transition_target}, active_task_issue=${contract.active_task_issue ?? 'null'}`,
      reason: 'Cannot apply a terminal transition to an already closed or terminal task issue',
      correctiveAction: 'Create a new dedicated open task issue instead of reusing the closed issue',
    })]
  }

  return []
}

function validateStaticContract(contract, filePath) {
  return [
    ...validateTaskIssueStrategy(contract, filePath),
    ...validateExecutionBaseRule(contract, filePath),
    ...validateBranchTemplate(contract, filePath),
    ...validateTransitionTarget(contract, filePath),
  ]
}

function validatePairedContracts(specPath, specContract, planPath, planContract) {
  /** @type {import('./guard-planning-contract.mjs').PlanningViolation[]} */
  const violations = []

  for (const field of IDENTITY_FIELDS_FOR_PAIRING) {
    const specValue = specContract[field]
    const planValue = planContract[field]
    const specSerialized = JSON.stringify(specValue)
    const planSerialized = JSON.stringify(planValue)
    if (specSerialized === planSerialized) continue

    const specLabel = basenameLabel(specPath).includes('design') ? 'design.md' : basenameLabel(specPath)
    const planLabel = basenameLabel(planPath).includes('implementation-plan')
      ? 'implementation-plan.md'
      : basenameLabel(planPath)

    violations.push(makeViolation({
      rule: 'PLAN002',
      file: specPath,
      message: `Paired spec and plan identity field mismatch for ${field}`,
      found: field === 'active_task_issue'
        ? `Found '${planValue}' in ${planLabel} but '${specValue}' in ${specLabel}`
        : `spec=${specSerialized}, plan=${planSerialized}`,
      reason: 'Paired spec and plan documents must declare identical task identity fields',
      correctiveAction: `Align ${field} across ${specLabel} and ${planLabel}`,
    }))
  }

  return violations
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
 * @param {{ root?: string, files?: string[], checkAll?: boolean, readFile?: (filePath: string) => string }} [options]
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
