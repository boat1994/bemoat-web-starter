import { BOOTSTRAP_CONTRACT } from './task-bootstrap-authorization.ts'

type AllocationInput = {
  request?: unknown
  context?: unknown
  registryRecords?: readonly unknown[]
  scanned?: unknown
  existingTaskIssue?: ExistingTaskIssue | null
  [key: string]: unknown
}

type RequestRecord = {
  requestId?: unknown
}

type ContextRecord = {
  targetMode?: unknown
  repository?: { nameWithOwner?: unknown } | null
  parentIssue?: { number?: unknown } | null
  pullRequest?: {
    number?: unknown
    baseRefName?: unknown
    headRefOid?: unknown
    baseRefOid?: unknown
  } | null
  policy?: { path?: unknown, version?: unknown, blobSha?: unknown } | null
}

type ExistingTaskIssue = { number?: unknown, body?: unknown }

type ProvisionalRecord = {
  request_id?: unknown
  repository?: unknown
  parent_issue?: unknown
  pr?: unknown
  base?: unknown
  head?: unknown
  protected_base_sha?: unknown
  policy_source?: unknown
  policy_version?: unknown
  policy_sha?: unknown
}

type TaskIdentityPayload = {
  task_issue_number?: number
  task_issue_id?: unknown
  task_issue_node_id?: unknown
  pr_number?: unknown
  request_id?: unknown
}

type RegistryEntry = {
  record?: { payload?: TaskIdentityPayload | null } | null
}

type ScannedRecord = {
  signed?: { issue?: unknown }
  provisional?: { provisional?: unknown, issue?: unknown }
}

export const ALLOCATION_KINDS = Object.freeze({
  REGISTRY: 'REGISTRY',
  SIGNED_ISSUE: 'SIGNED_ISSUE',
  PROVISIONAL_ISSUE: 'PROVISIONAL_ISSUE',
  CREATE_PROVISIONAL: 'CREATE_PROVISIONAL',
} as const)

type AllocationResult =
  | { kind: typeof ALLOCATION_KINDS.REGISTRY, outcome: 'RECOVERED', registry: unknown, issue: null }
  | { kind: typeof ALLOCATION_KINDS.SIGNED_ISSUE, outcome: 'IDEMPOTENT', registry: null, issue: unknown }
  | { kind: typeof ALLOCATION_KINDS.PROVISIONAL_ISSUE, outcome: 'RECOVERED', registry: null, issue: unknown }
  | { kind: typeof ALLOCATION_KINDS.CREATE_PROVISIONAL, outcome: 'CREATED', registry: null, issue: null }
  | { kind: 'EXISTING_ISSUE', outcome: 'RECOVERED', registry: unknown, issue: unknown }

function allocationConflict(message: string) {
  const error = new Error(message) as Error & { code?: string, classification?: string }
  error.code = 'STATE_CONFLICT'
  error.classification = 'STATE_CONFLICT'
  return error
}

function completeTaskIdentity(payload: unknown) {
  const payloadRecord = payload as TaskIdentityPayload | null | undefined
  if (!Number.isInteger(payloadRecord?.task_issue_number) || payloadRecord!.task_issue_number! < 1 ||
      typeof payloadRecord!.task_issue_id !== 'string' || !payloadRecord!.task_issue_id ||
      typeof payloadRecord!.task_issue_node_id !== 'string' || !payloadRecord!.task_issue_node_id) {
    return null
  }
  return {
    number: payloadRecord!.task_issue_number,
    id: payloadRecord!.task_issue_id,
    node_id: payloadRecord!.task_issue_node_id,
  }
}

function sameTaskIdentity(left: unknown, right: unknown) {
  const leftIdentity = completeTaskIdentity((left as RegistryEntry | null | undefined)?.record?.payload)
  const rightIdentity = completeTaskIdentity((right as RegistryEntry | null | undefined)?.record?.payload)
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
  const matches = (records as readonly RegistryEntry[]).filter(({ record }) => record?.payload?.request_id === requestId)
  if (matches.length <= 1) return matches[0] ?? null
  const owner = matches[0]
  if (!matches.every((candidate) => sameTaskIdentity(owner, candidate))) {
    throw allocationConflict('parent ownership registry contains conflicting Task identities for the deterministic request')
  }
  return owner
}

function competingRegistry(records: readonly unknown[], requestId: unknown, pullRequest: unknown) {
  return (records as readonly RegistryEntry[]).find(({ record }) =>
    record?.payload?.request_id !== requestId &&
    String(record?.payload?.pr_number) === String(pullRequest),
  ) ?? null
}

export function matchesProvisional(provisional?: unknown, { request, context }: { request?: unknown, context?: unknown } = {}) {
  const provisionalRecord = provisional as ProvisionalRecord | null | undefined
  const requestRecord = request as RequestRecord | null | undefined
  const contextRecord = context as ContextRecord | null | undefined
  return provisionalRecord?.request_id === requestRecord?.requestId &&
    provisionalRecord!.repository === contextRecord?.repository?.nameWithOwner &&
    Number(provisionalRecord!.parent_issue) === Number(contextRecord?.parentIssue?.number ?? BOOTSTRAP_CONTRACT.parentIssue) &&
    Number(provisionalRecord!.pr) === Number(contextRecord?.pullRequest?.number ?? BOOTSTRAP_CONTRACT.pullRequest) &&
    provisionalRecord!.base === (contextRecord?.pullRequest?.baseRefName ?? BOOTSTRAP_CONTRACT.base) &&
    provisionalRecord!.head === (contextRecord?.pullRequest?.headRefOid ?? BOOTSTRAP_CONTRACT.head) &&
    provisionalRecord!.protected_base_sha === (contextRecord?.pullRequest?.baseRefOid ?? BOOTSTRAP_CONTRACT.protectedBaseSha) &&
    provisionalRecord!.policy_source === contextRecord?.policy?.path &&
    provisionalRecord!.policy_version === contextRecord?.policy?.version &&
    provisionalRecord!.policy_sha === contextRecord?.policy?.blobSha
}

/**
 * @param {{ request?: any, context?: any, registryRecords?: any[], scanned?: any }} [input={}]
 */
export function classifyTaskBootstrapAllocation({
  request,
  context,
  registryRecords = [],
  scanned = {},
  existingTaskIssue = null,
}: AllocationInput = {}): AllocationResult {
  const requestRecord = request as RequestRecord | null | undefined
  const contextRecord = context as ContextRecord | null | undefined
  const scannedRecord = scanned as ScannedRecord
  const requestId = requestRecord?.requestId
  const pullRequest = contextRecord?.pullRequest?.number
  if (contextRecord?.targetMode === 'planning_no_pr') {
    const valid = (registryRecords as RegistryEntry[]).filter((entry) => entry?.record?.payload)
    const competing = valid.find((entry) => entry.record?.payload?.request_id !== requestId)
    if (competing) throw allocationConflict('existing Task target already has a competing registry owner')
    const registry = registryForRequest(registryRecords, requestId)
    if (!existingTaskIssue || Number(existingTaskIssue.number) !== Number(contextRecord.parentIssue?.number)) {
      throw allocationConflict('Founder-authorized existing Task target could not be read back')
    }
    return { kind: 'EXISTING_ISSUE', outcome: 'RECOVERED', registry, issue: existingTaskIssue }
  }
  const competing = competingRegistry(registryRecords, requestId, pullRequest)
  if (competing) throw allocationConflict('parent ownership registry already records a competing Task for PR #263')

  const registry = registryForRequest(registryRecords, requestId)
  if (registry) return { kind: ALLOCATION_KINDS.REGISTRY, outcome: 'RECOVERED', registry, issue: null }
  if (scannedRecord.signed) return { kind: ALLOCATION_KINDS.SIGNED_ISSUE, outcome: 'IDEMPOTENT', registry: null, issue: scannedRecord.signed.issue }
  if (scannedRecord.provisional) {
    if (!matchesProvisional(scannedRecord.provisional.provisional, { request, context })) throw allocationConflict('provisional Task Issue has a mismatched deterministic binding')
    return { kind: ALLOCATION_KINDS.PROVISIONAL_ISSUE, outcome: 'RECOVERED', registry: null, issue: scannedRecord.provisional.issue }
  }
  return { kind: ALLOCATION_KINDS.CREATE_PROVISIONAL, outcome: 'CREATED', registry: null, issue: null }
}
