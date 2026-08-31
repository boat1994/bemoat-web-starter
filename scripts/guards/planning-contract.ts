const LINE_IDENTITY_START = /^\s*<!--\s*bemoat-task-identity:start\s*-->\s*$/
const LINE_IDENTITY_END = /^\s*<!--\s*bemoat-task-identity:end\s*-->\s*$/

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

const IDENTITY_FIELDS_FOR_PAIRING = TASK_IDENTITY_REQUIRED_KEYS.filter(
  (key) => key !== 'paired_spec' && key !== 'paired_plan',
)

export interface PlanningContract {
  schema_version?: number
  main_issue?: unknown
  task_key?: unknown
  task_issue_strategy?: unknown
  active_task_issue?: unknown
  branch_template?: unknown
  transition_target?: unknown
  planning_base_sha?: unknown
  execution_base_rule?: unknown
  paired_spec?: unknown
  paired_plan?: unknown
  [key: string]: unknown
}

export interface PlanningViolation {
  type: 'planning-contract'
  rule: string
  file: string
  message: string
  found: unknown
  reason: string
  correctiveAction: string
}

export interface ParsedTaskIdentity {
  present: boolean
  valid: boolean
  contract: PlanningContract | null
  violations: PlanningViolation[]
}

function stripFencedCodeBlocks(content = ''): string {
  return content.replace(/```[\s\S]*?```/g, '')
}

function stripInlineCode(content = ''): string {
  return content.replace(/`[^`]*`/g, '')
}

function contentForMarkerDetection(content = ''): string {
  return stripInlineCode(stripFencedCodeBlocks(content))
}

function countLineMarkers(content: string, linePattern: RegExp): number {
  let count = 0
  let inFence = false

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    if (linePattern.test(line)) count += 1
  }

  return count
}

function extractIdentityBlockLines(content: string): string | null {
  const lines = content.split('\n')
  let inFence = false
  let startLineIdx = -1
  let endLineIdx = -1

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim()
    if (trimmed.startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (inFence) continue

    if (startLineIdx === -1 && LINE_IDENTITY_START.test(lines[index])) {
      startLineIdx = index
      continue
    }

    if (startLineIdx !== -1 && LINE_IDENTITY_END.test(lines[index])) {
      endLineIdx = index
      break
    }
  }

  if (startLineIdx === -1 || endLineIdx === -1 || endLineIdx <= startLineIdx) {
    return null
  }

  return lines.slice(startLineIdx + 1, endLineIdx).join('\n')
}

function parseScalar(value: string): string | number | null {
  const trimmed = value.trim()
  if (trimmed === 'null') return null
  if (/^\d+$/.test(trimmed)) return Number(trimmed)
  const quoted = trimmed.match(/^("|')(.*)\1$/)
  return quoted ? quoted[2] : trimmed
}

export function parseIssueNumber(reference: unknown): string | null {
  if (!reference || typeof reference !== 'string') return null
  const trimmed = reference.trim()
  const repoMatch = trimmed.match(/^[\w.-]+\/[\w.-]+#(\d+)$/)
  if (repoMatch) return repoMatch[1]
  const hashMatch = trimmed.match(/#(\d+)/)
  if (hashMatch) return hashMatch[1]
  const bareMatch = trimmed.match(/^(\d+)$/)
  return bareMatch ? bareMatch[1] : null
}

function extractIssueNumbersFromBranch(branchTemplate: unknown): string[] {
  if (!branchTemplate || typeof branchTemplate !== 'string') return []
  const numbers = []
  for (const segment of branchTemplate.split('/')) {
    const leading = segment.match(/^(\d+)(?:[-/]|$)/)
    if (leading) numbers.push(leading[1])
  }
  return [...new Set(numbers)]
}

function basenameLabel(filePath: string): string {
  const segments = filePath.split('/')
  return segments[segments.length - 1] || filePath
}

export function makeViolation({
  rule,
  file,
  message,
  found,
  reason,
  correctiveAction,
}: Omit<PlanningViolation, 'type'>): PlanningViolation {
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

export function parseTaskIdentityBlock(content = '', filePath = '<unknown>'): ParsedTaskIdentity {
  const violations: PlanningViolation[] = []
  const markerSource = contentForMarkerDetection(content)
  const startCount = countLineMarkers(markerSource, LINE_IDENTITY_START)
  const endCount = countLineMarkers(markerSource, LINE_IDENTITY_END)

  if (startCount === 0 && endCount === 0) {
    violations.push(makeViolation({
      rule: 'PLAN001', file: filePath, message: 'Missing task identity marker block', found: 'none',
      reason: 'Planning documents must declare <!-- bemoat-task-identity:start --> ... <!-- bemoat-task-identity:end -->',
      correctiveAction: 'Add a balanced task identity YAML block with schema_version: 1',
    }))
    return { present: false, valid: false, contract: null, violations }
  }

  if (startCount !== 1 || endCount !== 1) {
    violations.push(makeViolation({
      rule: 'PLAN001', file: filePath, message: 'Malformed task identity marker block',
      found: `${startCount} start marker(s), ${endCount} end marker(s)`,
      reason: 'Exactly one balanced marker pair is required',
      correctiveAction: 'Ensure a single <!-- bemoat-task-identity:start --> ... <!-- bemoat-task-identity:end --> pair',
    }))
    return { present: true, valid: false, contract: null, violations }
  }

  const blockBody = extractIdentityBlockLines(content)
  if (!blockBody) {
    violations.push(makeViolation({
      rule: 'PLAN001', file: filePath, message: 'Malformed task identity marker block',
      found: 'unbalanced line markers', reason: 'Exactly one balanced marker pair is required',
      correctiveAction: 'Ensure a single <!-- bemoat-task-identity:start --> ... <!-- bemoat-task-identity:end --> pair',
    }))
    return { present: true, valid: false, contract: null, violations }
  }

  const raw = blockBody.replace(/```yaml\s*|```/g, '')
  const contract: PlanningContract = {}
  for (const line of raw.split('\n')) {
    if (!line.trim() || /^\s*#/.test(line)) continue
    const match = line.match(/^\s*([a-z_]+)\s*:\s*(.*?)\s*$/)
    if (!match) {
      violations.push(makeViolation({
        rule: 'PLAN001', file: filePath, message: 'Unreadable task identity YAML line', found: line.trim(),
        reason: 'Task identity YAML must use simple key: value lines',
        correctiveAction: 'Fix the malformed YAML line inside the task identity block',
      }))
      return { present: true, valid: false, contract: null, violations }
    }
    if (Object.hasOwn(contract, match[1])) {
      violations.push(makeViolation({
        rule: 'PLAN001', file: filePath, message: 'Duplicate task identity key', found: match[1],
        reason: 'Each task identity field may appear only once',
        correctiveAction: `Remove the duplicate ${match[1]} entry`,
      }))
      return { present: true, valid: false, contract: null, violations }
    }
    contract[match[1]] = parseScalar(match[2])
  }

  if (contract.schema_version !== 1) {
    violations.push(makeViolation({
      rule: 'PLAN001', file: filePath, message: 'Unsupported task identity schema_version',
      found: String(contract.schema_version ?? 'missing'), reason: 'Only schema_version: 1 is supported',
      correctiveAction: 'Set schema_version: 1 in the task identity block',
    }))
    return { present: true, valid: false, contract: null, violations }
  }

  const missing = TASK_IDENTITY_REQUIRED_KEYS.filter((key) => !Object.hasOwn(contract, key))
  if (missing.length > 0) {
    const missingStrategyOnly = missing.length === 1 && missing[0] === 'task_issue_strategy'
    if (missingStrategyOnly) {
      violations.push(makeViolation({
        rule: 'PLAN006', file: filePath, message: 'Missing task_issue_strategy', found: 'missing',
        reason: 'task_issue_strategy must be existing_dedicated_issue or create_before_execution',
        correctiveAction: 'Add task_issue_strategy with a supported enum value',
      }))
      return { present: true, valid: false, contract: null, violations }
    }
    violations.push(makeViolation({
      rule: 'PLAN001', file: filePath, message: 'Missing required task identity field(s)',
      found: missing.join(', '), reason: 'All schema_version: 1 task identity fields are required',
      correctiveAction: `Add the missing field(s): ${missing.join(', ')}`,
    }))
    return { present: true, valid: false, contract: null, violations }
  }

  return { present: true, valid: true, contract, violations }
}

function validateTaskIssueStrategy(contract: PlanningContract, filePath: string): PlanningViolation[] {
  const violations: PlanningViolation[] = []
  const strategy = contract.task_issue_strategy
  if (typeof strategy !== 'string' || !VALID_TASK_ISSUE_STRATEGIES.has(strategy)) {
    violations.push(makeViolation({
      rule: 'PLAN006', file: filePath, message: 'Invalid task_issue_strategy',
      found: String(strategy),
      reason: 'task_issue_strategy must be existing_dedicated_issue or create_before_execution',
      correctiveAction: 'Set task_issue_strategy to a supported enum value',
    }))
    return violations
  }
  const activeIssueNumber = parseIssueNumber(contract.active_task_issue)
  if (strategy === 'create_before_execution' && activeIssueNumber) {
    violations.push(makeViolation({
      rule: 'PLAN005', file: filePath, message: 'Concrete active_task_issue declared under create_before_execution',
      found: String(contract.active_task_issue),
      reason: 'create_before_execution requires active_task_issue: null until the dedicated issue is created',
      correctiveAction: 'Set active_task_issue: null until the dedicated GitHub issue exists',
    }))
  }
  if (strategy === 'existing_dedicated_issue' && !activeIssueNumber) {
    violations.push(makeViolation({
      rule: 'PLAN006', file: filePath, message: 'Missing active_task_issue for existing_dedicated_issue strategy',
      found: String(contract.active_task_issue ?? 'null'),
      reason: 'existing_dedicated_issue requires a concrete active_task_issue reference',
      correctiveAction: 'Set active_task_issue to the dedicated open task issue number',
    }))
  }
  return violations
}

function validateExecutionBaseRule(contract: PlanningContract, filePath: string): PlanningViolation[] {
  if (contract.execution_base_rule !== 'use_planning_base_sha_unconditionally') return []
  return [makeViolation({
    rule: 'PLAN007', file: filePath, message: 'Unconditional planning-time SHA execution base rule',
    found: contract.execution_base_rule,
    reason: 'Executable branch creation must resolve the live protected base at dispatch',
    correctiveAction: 'Set execution_base_rule to resolve_live_protected_base_at_dispatch',
  })]
}

function validateBranchTemplate(contract: PlanningContract, filePath: string): PlanningViolation[] {
  const activeIssueNumber = parseIssueNumber(contract.active_task_issue)
  if (!activeIssueNumber) return []
  const mainIssueNumber = parseIssueNumber(contract.main_issue)
  const allowedNumbers = new Set([activeIssueNumber, mainIssueNumber].filter((value) => value !== null))
  const conflicting = extractIssueNumbersFromBranch(contract.branch_template)
    .filter((number) => !allowedNumbers.has(number))
  if (conflicting.length === 0) return []
  return [makeViolation({
    rule: 'PLAN003', file: filePath, message: 'Branch template references an unrelated issue number',
    found: `${contract.branch_template} vs active_task_issue ${contract.active_task_issue ?? 'null'}`,
    reason: 'branch_template must align with the active task issue reference',
    correctiveAction: 'Update branch_template to use the active_task_issue number',
  })]
}

function validateTransitionTarget(contract: PlanningContract, filePath: string): PlanningViolation[] {
  const activeIssueNumber = parseIssueNumber(contract.active_task_issue)
  const transitionIsTerminalStatus = TERMINAL_TRANSITION_TARGETS.has(String(contract.transition_target).trim())
  if (!transitionIsTerminalStatus || !activeIssueNumber) return []
  return [makeViolation({
    rule: 'PLAN004', file: filePath, message: 'Terminal transition target conflicts with a closed task issue',
    found: `transition_target=${contract.transition_target}, active_task_issue=${contract.active_task_issue ?? 'null'}`,
    reason: 'Cannot apply a terminal transition while modifying a dedicated task issue that is already closed or terminal',
    correctiveAction: 'Create a new dedicated open task issue instead of reusing the closed issue',
  })]
}

export function validateStaticContract(contract: PlanningContract, filePath: string): PlanningViolation[] {
  return [
    ...validateTaskIssueStrategy(contract, filePath),
    ...validateExecutionBaseRule(contract, filePath),
    ...validateBranchTemplate(contract, filePath),
    ...validateTransitionTarget(contract, filePath),
  ]
}

export function validatePairedContracts(
  specPath: string,
  specContract: PlanningContract,
  planPath: string,
  planContract: PlanningContract,
): PlanningViolation[] {
  const violations: PlanningViolation[] = []
  for (const field of IDENTITY_FIELDS_FOR_PAIRING) {
    const specValue = specContract[field]
    const planValue = planContract[field]
    const specSerialized = JSON.stringify(specValue)
    const planSerialized = JSON.stringify(planValue)
    if (specSerialized === planSerialized) continue
    const specLabel = basenameLabel(specPath).includes('design') ? 'design.md' : basenameLabel(specPath)
    const planLabel = basenameLabel(planPath).includes('implementation-plan') ? 'implementation-plan.md' : basenameLabel(planPath)
    violations.push(makeViolation({
      rule: 'PLAN002', file: specPath, message: `Paired spec and plan identity field mismatch for ${field}`,
      found: field === 'active_task_issue'
        ? `Found '${planValue}' in ${planLabel} but '${specValue}' in ${specLabel}`
        : `spec=${specSerialized}, plan=${planSerialized}`,
      reason: 'Paired spec and plan documents must declare identical task identity fields',
      correctiveAction: `Align ${field} across ${specLabel} and ${planLabel}`,
    }))
  }
  return violations
}
