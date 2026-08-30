/** Stateless HANDOFF routing policy ownership. */
type HandoffRoute = {
  route_key: string
  observed_state: string
  evidence_case: string
  required_evidence_condition: string
  forbidden_evidence_condition: string
  permitted_operation: string
  canonical_command: string
  required_review_type: string | null
  expected_post_state_or_gate: string
  prohibited_commands: string[]
  decision: string
  stop_condition: string | null
}

export function handoffRoutes(): HandoffRoute[] {
  return [{
    route_key: 'NOT_STATEFUL_HANDOFF',
    observed_state: 'NOT_STATEFUL',
    evidence_case: 'validated HANDOFF record with complete live repository binding',
    required_evidence_condition: 'Schema, Issue, repository, protected base, and applicable local/PR bindings are all proven.',
    forbidden_evidence_condition: 'Malformed, stale, conflicting, ambiguous, non-durable, or stateful evidence is present.',
    permitted_operation: 'Append exactly one top-level Issue HANDOFF comment and verify exact readback.',
    canonical_command: 'bemoat:handoff',
    required_review_type: null,
    expected_post_state_or_gate: 'One read-back-verified HANDOFF comment; no workflow-state projection.',
    prohibited_commands: [
      'bemoat:mission-control:review',
      'bemoat:mission-control:reconcile',
    ],
    decision: 'COMMAND',
    stop_condition: null,
  }]
}
