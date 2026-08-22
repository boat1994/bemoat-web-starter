import { BOOTSTRAP_CONTRACT } from './task-bootstrap-authorization.ts'
import { TASK_ATTESTATION_SCHEMA, canonicalHash } from './task-attestation.mjs'

type BuildInitialTaskStateOptions = {
  issueNumber?: unknown
  requestId?: unknown
  attestation?: unknown
  managedStateSha256?: unknown
  now?: unknown
  targetMode?: unknown
  parentIssue?: { number?: unknown } | null
  base?: unknown
  policy?: { path?: unknown, version?: unknown, blobSha?: unknown } | null
}

type TaskBootstrapState = {
  schema_version: 1
  state: 'AWAITING_REVIEW_1'
  review_cycle: 0
  full_review_count: 0
  approved_base: string
  active_task_issue: string
  active_pr: string | null
  current_head: string | null
  last_reviewed_head: null
  guide_version: string
  guide_source_ref: 'main'
  guide_source_sha: string
  open_blockers: unknown[]
  follow_up_issues: unknown[]
  next_permitted_action: 'Run read-only Review 1 preflight; do not start Review 1.'
  material_change_status: 'none'
  updated_at: unknown
  updated_by: 'Mission Control Task Bootstrap'
  parent_issue: string
  policy_source: string
  policy_version: string
  policy_sha: string
  bootstrap_request_id: unknown
  task_attestation_schema: unknown
  task_attestation_key_id: unknown
  task_attestation_sha256: string | null
  managed_state_sha256: unknown
}

type AttestationShape = {
  payload?: unknown
  key_id?: unknown
}

export function buildInitialTaskState({
  issueNumber,
  requestId,
  attestation,
  managedStateSha256 = null,
  now = null,
  targetMode = null,
  parentIssue = null,
  base = BOOTSTRAP_CONTRACT.base,
  policy = null,
}: BuildInitialTaskStateOptions = {}): TaskBootstrapState {
  const planning = targetMode === 'planning_no_pr'
  const attestationShape = attestation as AttestationShape | null | undefined
  const payload = attestationShape?.payload ?? {}
  const payloadShape = payload as { attestation_schema?: unknown }
  return {
    schema_version: 1,
    state: 'AWAITING_REVIEW_1',
    review_cycle: 0,
    full_review_count: 0,
    approved_base: planning ? String(base) : BOOTSTRAP_CONTRACT.base,
    active_task_issue: `#${issueNumber}`,
    active_pr: planning ? null : `#${BOOTSTRAP_CONTRACT.pullRequest}`,
    current_head: planning ? null : BOOTSTRAP_CONTRACT.head,
    last_reviewed_head: null,
    guide_version: planning ? String(policy?.version) : BOOTSTRAP_CONTRACT.policyVersion,
    guide_source_ref: 'main',
    guide_source_sha: planning ? String(policy?.blobSha) : BOOTSTRAP_CONTRACT.policySha,
    open_blockers: [],
    follow_up_issues: [],
    next_permitted_action: 'Run read-only Review 1 preflight; do not start Review 1.',
    material_change_status: 'none',
    updated_at: now,
    updated_by: 'Mission Control Task Bootstrap',
    parent_issue: `#${planning ? parentIssue?.number : BOOTSTRAP_CONTRACT.parentIssue}`,
    policy_source: planning ? String(policy?.path) : BOOTSTRAP_CONTRACT.policySource,
    policy_version: planning ? String(policy?.version) : BOOTSTRAP_CONTRACT.policyVersion,
    policy_sha: planning ? String(policy?.blobSha) : BOOTSTRAP_CONTRACT.policySha,
    bootstrap_request_id: requestId,
    task_attestation_schema: payloadShape.attestation_schema ?? TASK_ATTESTATION_SCHEMA,
    task_attestation_key_id: attestationShape?.key_id ?? null,
    task_attestation_sha256: attestation ? canonicalHash(attestation) : null,
    managed_state_sha256: managedStateSha256,
    ...(planning ? { workflow_mode: 'planning_no_pr' as const } : {}),
  }
}
