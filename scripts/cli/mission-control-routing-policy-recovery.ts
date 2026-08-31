/** Recovery routing retains only stop/gate and retained utility routes. */
import { ALL_MUTATING_COMMANDS } from './mission-control-routing-policy-primary.ts'

type RecoveryRoute = {
  route_key: string
  observed_state: string | null
  evidence_case: string
  required_evidence_condition: string
  forbidden_evidence_condition: string
  permitted_operation: string | null
  canonical_command: string | null
  required_review_type: string | null
  expected_post_state_or_gate: string
  prohibited_commands: string[]
  decision: string
  stop_condition: string | null
}

function route(observed_state: string | null, route_key: string, evidence_case: string, decision: string, expected_post_state_or_gate: string, canonical_command: string | null = null, stop_condition: string | null = null): RecoveryRoute {
  return {
    route_key, observed_state, evidence_case,
    required_evidence_condition: 'Authoritative live evidence is complete and current.',
    forbidden_evidence_condition: 'Missing, stale, competing, or conflicting evidence.',
    permitted_operation: canonical_command === null ? null : 'Perform the explicitly retained utility operation.',
    canonical_command, required_review_type: null, expected_post_state_or_gate,
    prohibited_commands: canonical_command === null ? ALL_MUTATING_COMMANDS : [],
    decision, stop_condition,
  }
}

export function missionControlRecoveryRoutes() {
  return [
    route('DONE', 'DONE/exact-terminal-retry', 'exact-terminal-retry', 'COMPLETE', 'COMPLETE'),
    route('BLOCKED_EXTERNAL', 'BLOCKED_EXTERNAL/explicit-stop', 'external-evidence-unavailable', 'STOP', 'STOP', null, 'Stop until external evidence is available.'),
    route('STATE_CONFLICT', 'STATE_CONFLICT/explicit-stop', 'contradictory-evidence', 'STOP', 'STOP', null, 'Stop with STATE_CONFLICT; do not select a fallback command.'),
    route('STATE_MIGRATION_REQUIRED', 'STATE_MIGRATION_REQUIRED/explicit-stop', 'required-migration', 'STOP', 'STOP', null, 'Stop until the required state migration is separately reviewed.'),
    route(null, 'ANY_STATE/ambiguous-evidence-stop', 'malformed-stale-superseded-competing-evidence', 'STOP', 'STOP', null, 'Stop with STATE_CONFLICT; never select a fallback command.'),
    route('NOT_STATEFUL', 'NOT_STATEFUL/explicit-authorized-starter-child-sync', 'explicit-authorized-starter-child-sync', 'COMMAND', 'COMPLETE', 'bemoat:boilerplate:sync'),
    route('NOT_STATEFUL', 'NOT_STATEFUL/explicit-local-hook-install', 'explicit-local-hook-install', 'COMMAND', 'COMPLETE', 'bemoat:hooks:install'),
  ]
}
