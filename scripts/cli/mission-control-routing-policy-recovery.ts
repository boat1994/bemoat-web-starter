/** Retained utility routes for non-stateful repository maintenance. */
type UtilityRoute = {
  route_key: string
  observed_state: 'NOT_STATEFUL'
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

function utilityRoute(
  route_key: string,
  evidence_case: string,
  permitted_operation: string,
  canonical_command: string,
  expected_post_state_or_gate: string,
): UtilityRoute {
  return {
    route_key,
    observed_state: 'NOT_STATEFUL',
    evidence_case,
    required_evidence_condition: 'Authoritative live evidence is complete and current.',
    forbidden_evidence_condition: 'Missing, stale, competing, or conflicting evidence.',
    permitted_operation,
    canonical_command,
    required_review_type: null,
    expected_post_state_or_gate,
    prohibited_commands: [],
    decision: 'COMMAND',
    stop_condition: 'Stop with canonical evidence, drift, external, or ambiguous classifications on any failed gate.',
  }
}

export function missionControlRecoveryRoutes(): UtilityRoute[] {
  return [
    utilityRoute(
      'NOT_STATEFUL/explicit-authorized-starter-child-sync',
      'explicit-authorized-starter-child-sync',
      'One native sync of the approved harness paths.',
      'bemoat:boilerplate:sync',
      'SYNCED',
    ),
    utilityRoute(
      'NOT_STATEFUL/explicit-local-hook-install',
      'explicit-local-hook-install',
      'Install the repository-owned local git hooks.',
      'bemoat:hooks:install',
      'COMPLETE',
    ),
  ]
}
