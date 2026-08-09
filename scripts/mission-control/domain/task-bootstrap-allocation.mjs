import { BOOTSTRAP_CONTRACT } from './task-bootstrap-authorization.mjs'

const ALLOCATION_KINDS = Object.freeze({
  REGISTRY: 'REGISTRY',
  SIGNED_ISSUE: 'SIGNED_ISSUE',
  PROVISIONAL_ISSUE: 'PROVISIONAL_ISSUE',
  CREATE_PROVISIONAL: 'CREATE_PROVISIONAL',
})

function allocationConflict(message) {
  const error = new Error(message)
  error.code = 'STATE_CONFLICT'
  error.classification = 'STATE_CONFLICT'
  return error
}

function completeTaskIdentity(payload) {
  if (!Number.isInteger(payload?.task_issue_number) || payload.task_issue_number < 1 ||
      typeof payload.task_issue_id !== 'string' || !payload.task_issue_id ||
      typeof payload.task_issue_node_id !== 'string' || !payload.task_issue_node_id) {
    return null
  }
  return {
    number: payload.task_issue_number,
    id: payload.task_issue_id,
    node_id: payload.task_issue_node_id,
  }
}

function sameTaskIdentity(left, right) {
  const leftIdentity = completeTaskIdentity(left?.record?.payload)
  const rightIdentity = completeTaskIdentity(right?.record?.payload)
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
export function registryForRequest(records = [], requestId) {
  const matches = records.filter(({ record }) => record?.payload?.request_id === requestId)
  if (matches.length <= 1) return matches[0] ?? null
  const owner = matches[0]
  if (!matches.every((candidate) => sameTaskIdentity(owner, candidate))) {
    throw allocationConflict('parent ownership registry contains conflicting Task identities for the deterministic request')
  }
  return owner
}

function competingRegistry(records, requestId, pullRequest) {
  return records.find(({ record }) =>
    record?.payload?.request_id !== requestId &&
    String(record?.payload?.pr_number) === String(pullRequest),
  ) ?? null
}

export function matchesProvisional(provisional, { request, context } = {}) {
  return provisional?.request_id === request?.requestId &&
    provisional.repository === context?.repository?.nameWithOwner &&
    Number(provisional.parent_issue) === Number(context?.parentIssue?.number ?? BOOTSTRAP_CONTRACT.parentIssue) &&
    Number(provisional.pr) === Number(context?.pullRequest?.number ?? BOOTSTRAP_CONTRACT.pullRequest) &&
    provisional.base === (context?.pullRequest?.baseRefName ?? BOOTSTRAP_CONTRACT.base) &&
    provisional.head === (context?.pullRequest?.headRefOid ?? BOOTSTRAP_CONTRACT.head) &&
    provisional.protected_base_sha === (context?.pullRequest?.baseRefOid ?? BOOTSTRAP_CONTRACT.protectedBaseSha) &&
    provisional.policy_source === context?.policy?.path &&
    provisional.policy_version === context?.policy?.version &&
    provisional.policy_sha === context?.policy?.blobSha
}

/**
 * @param {{ request?: any, context?: any, registryRecords?: any[], scanned?: any }} [input={}]
 */
export function classifyTaskBootstrapAllocation({
  request,
  context,
  registryRecords = [],
  scanned = {},
} = {}) {
  const requestId = request?.requestId
  const pullRequest = context?.pullRequest?.number
  const competing = competingRegistry(registryRecords, requestId, pullRequest)
  if (competing) throw allocationConflict('parent ownership registry already records a competing Task for PR #263')

  const registry = registryForRequest(registryRecords, requestId)
  if (registry) return { kind: ALLOCATION_KINDS.REGISTRY, outcome: 'RECOVERED', registry, issue: null }
  if (scanned.signed) return { kind: ALLOCATION_KINDS.SIGNED_ISSUE, outcome: 'IDEMPOTENT', registry: null, issue: scanned.signed.issue }
  if (scanned.provisional) {
    if (!matchesProvisional(scanned.provisional.provisional, { request, context })) throw allocationConflict('provisional Task Issue has a mismatched deterministic binding')
    return { kind: ALLOCATION_KINDS.PROVISIONAL_ISSUE, outcome: 'RECOVERED', registry: null, issue: scanned.provisional.issue }
  }
  return { kind: ALLOCATION_KINDS.CREATE_PROVISIONAL, outcome: 'CREATED', registry: null, issue: null }
}

export { ALLOCATION_KINDS }
