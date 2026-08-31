/** Routing metadata for the bounded protected-base synchronization command. */
type ContextSyncRoute = {
  route_key: string
  observed_state: string
  evidence_case: string
  required_evidence_condition: string
  forbidden_evidence_condition: string
  permitted_operation: string
  canonical_command: string
  required_review_type: null
  expected_post_state_or_gate: string
  prohibited_commands: string[]
  decision: 'COMMAND'
  stop_condition: string
}

export function contextSyncRoutes(): ContextSyncRoute[] {
  return [{
    route_key: 'context_sync_base',
    observed_state: 'NOT_STATEFUL',
    evidence_case: 'Otherwise-valid stale active PR base with same Issue/PR/base branch/scope and durable local state.',
    required_evidence_condition: 'Live evidence uniquely binds the Issue, PR, protected branch, old base, current head, and canonical origin upstream; native ancestry proves old base is an ancestor of protected main and PR head.',
    forbidden_evidence_condition: 'Missing, stale, ambiguous, conflicting, non-durable, wrong-identity, or merge-conflicting evidence.',
    permitted_operation: 'One native Git fetch/merge/push of protected main into the same active PR branch.',
    canonical_command: 'bemoat:context:sync-base',
    required_review_type: null,
    expected_post_state_or_gate: 'New exact PR head with exact-head CI and semantic review rerun required.',
    prohibited_commands: [],
    decision: 'COMMAND',
    stop_condition: 'Stop with canonical evidence, drift, external, or ambiguous classifications on any failed gate.',
  }]
}
