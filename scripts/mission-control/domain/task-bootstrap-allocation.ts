import { BOOTSTRAP_CONTRACT } from './task-bootstrap-authorization.mjs'

type AllocationInput = {
  request?: unknown
  context?: unknown
  registryRecords?: readonly unknown[]
  scanned?: unknown
  [key: string]: unknown
}

type AllocationResult = {
  kind: string
  outcome: string
  registry: unknown
  issue: unknown
}

function readOptional(value: unknown, key: string): unknown {
  return value == null ? undefined : Reflect.get(Object(value), key)
}

function readRequired(value: unknown, key: string): unknown {
  if (value == null) return Reflect.get(value as unknown as object, key)
  return Reflect.get(Object(value), key)
}

export const ALLOCATION_KINDS = Object.freeze({
  REGISTRY: 'REGISTRY',
  SIGNED_ISSUE: 'SIGNED_ISSUE',
  PROVISIONAL_ISSUE: 'PROVISIONAL_ISSUE',
  CREATE_PROVISIONAL: 'CREATE_PROVISIONAL',
} as const)

function allocationConflict(message: string) {
  const error = new Error(message) as Error & { code?: string, classification?: string }
  error.code = 'STATE_CONFLICT'
  error.classification = 'STATE_CONFLICT'
  return error
}

function completeTaskIdentity(payload: unknown) {
  const taskIssueNumber = readOptional(payload, 'task_issue_number')
  if (!Number.isInteger(taskIssueNumber) || (taskIssueNumber as number) < 1 ||
      typeof readRequired(payload, 'task_issue_id') !== 'string' || !readRequired(payload, 'task_issue_id') ||
      typeof readRequired(payload, 'task_issue_node_id') !== 'string' || !readRequired(payload, 'task_issue_node_id')) {
    return null
  }
  return {
    number: taskIssueNumber,
    id: readRequired(payload, 'task_issue_id'),
    node_id: readRequired(payload, 'task_issue_node_id'),
  }
}

function sameTaskIdentity(left: unknown, right: unknown) {
  const leftIdentity = completeTaskIdentity(readOptional(readOptional(left, 'record'), 'payload'))
  const rightIdentity = completeTaskIdentity(readOptional(readOptional(right, 'record'), 'payload'))
  return leftIdentity != null &&
    rightIdentity != null &&
    leftIdentity.number === rightIdentity.number &&
    leftIdentity.id === rightIdentity.id &&
    leftIdentity.node_id === rightIdentity.node_id
}

/**
 * Return the canonical owner for a request, rejecting ambiguous duplicate
 * registry records while preserving idempotent duplicates for the same Task.
 *
 * @param {any[]} records
 * @param {string} requestId
 * @returns {any|null}
 */
export function registryForRequest(records: readonly unknown[] = [], requestId?: unknown) {
  const matches = records.filter((entry) => {
    const record = readRequired(entry, 'record')
    return readOptional(readOptional(record, 'payload'), 'request_id') === requestId
  })
  if (matches.length <= 1) return matches[0] ?? null
  const owner = matches[0]
  if (!matches.every((candidate) => sameTaskIdentity(owner, candidate))) {
    throw allocationConflict('parent ownership registry contains conflicting Task identities for the deterministic request')
  }
  return owner
}

function competingRegistry(records: readonly unknown[], requestId: unknown, pullRequest: unknown) {
  return records.find((entry) => {
    const record = readRequired(entry, 'record')
    return readOptional(readOptional(record, 'payload'), 'request_id') !== requestId &&
      String(readOptional(readOptional(record, 'payload'), 'pr_number')) === String(pullRequest)
  }) ?? null
}

export function matchesProvisional(provisional?: unknown, { request, context }: { request?: unknown, context?: unknown } = {}) {
  const pullRequest = readOptional(context, 'pullRequest')
  const policy = readOptional(context, 'policy')
  return readOptional(provisional, 'request_id') === readOptional(request, 'requestId') &&
    readRequired(provisional, 'repository') === readOptional(readOptional(context, 'repository'), 'nameWithOwner') &&
    Number(readRequired(provisional, 'parent_issue')) === Number(readOptional(readOptional(context, 'parentIssue'), 'number') ?? BOOTSTRAP_CONTRACT.parentIssue) &&
    Number(readRequired(provisional, 'pr')) === Number(readOptional(pullRequest, 'number') ?? BOOTSTRAP_CONTRACT.pullRequest) &&
    readRequired(provisional, 'base') === (readOptional(pullRequest, 'baseRefName') ?? BOOTSTRAP_CONTRACT.base) &&
    readRequired(provisional, 'head') === (readOptional(pullRequest, 'headRefOid') ?? BOOTSTRAP_CONTRACT.head) &&
    readRequired(provisional, 'protected_base_sha') === (readOptional(pullRequest, 'baseRefOid') ?? BOOTSTRAP_CONTRACT.protectedBaseSha) &&
    readRequired(provisional, 'policy_source') === readOptional(policy, 'path') &&
    readRequired(provisional, 'policy_version') === readOptional(policy, 'version') &&
    readRequired(provisional, 'policy_sha') === readOptional(policy, 'blobSha')
}

/**
 * @param {{ request?: any, context?: any, registryRecords?: any[], scanned?: any }} [input={}]
 */
export function classifyTaskBootstrapAllocation({
  request,
  context,
  registryRecords = [],
  scanned = {},
}: AllocationInput = {}): AllocationResult {
  const requestId = readOptional(request, 'requestId')
  const pullRequest = readOptional(readOptional(context, 'pullRequest'), 'number')
  const competing = competingRegistry(registryRecords, requestId, pullRequest)
  if (competing) throw allocationConflict('parent ownership registry already records a competing Task for PR #263')

  const registry = registryForRequest(registryRecords, requestId)
  if (registry) return { kind: ALLOCATION_KINDS.REGISTRY, outcome: 'RECOVERED', registry, issue: null }
  const signed = readRequired(scanned, 'signed')
  if (signed) return { kind: ALLOCATION_KINDS.SIGNED_ISSUE, outcome: 'IDEMPOTENT', registry: null, issue: readRequired(signed, 'issue') }
  const provisionalScan = readRequired(scanned, 'provisional')
  if (provisionalScan) {
    if (!matchesProvisional(readRequired(provisionalScan, 'provisional'), { request, context })) throw allocationConflict('provisional Task Issue has a mismatched deterministic binding')
    return { kind: ALLOCATION_KINDS.PROVISIONAL_ISSUE, outcome: 'RECOVERED', registry: null, issue: readRequired(provisionalScan, 'issue') }
  }
  return { kind: ALLOCATION_KINDS.CREATE_PROVISIONAL, outcome: 'CREATED', registry: null, issue: null }
}
