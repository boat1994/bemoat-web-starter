/** Mission Control command metadata ownership. */
import type { CommandMetadataDependencies } from './mission-control-command-metadata-deps.ts'

export function missionControlPrimaryCommands(dependencies: CommandMetadataDependencies) {
  const { contract, positional, flag, nextAction } = dependencies
  return {
  'bemoat:mission-control:authorize-founder': contract({
    command: 'bemoat:mission-control:authorize-founder',
    tier: 'A',
    entrypoint: 'scripts/mission-control-authorize-founder.mjs',
    purpose: 'MIGRATION-ONLY HISTORICAL: Record an immutable Founder authorization.',
    operation: 'MIGRATION-ONLY HISTORICAL: Validate Founder identity, exact head or policy source, and protected base, and project an immutable authorization and receipt.',
    accepted_pre_states: ['NOT_STATEFUL', 'EXISTING_REGISTERED_TASK', 'ELIGIBLE_FOR_FOUNDER_REVIEW', 'STANDARD_NON_MANAGED_ELIGIBLE'],
    required_inputs: [positional('issue_number', '<issue-number>', 'positive_integer', 'Target Issue receiving the Founder authorization.'), flag('scope', '--scope <scope>', 'enum', 'Authorization scope.', ['merge', 'task-bootstrap'], true)],
    optional_flags: [
      flag('repository', '--repo <owner/repository>', 'repository', 'Repository containing the Task Issue.'),
    ],
    trusted_derived_values: ['authenticated actor identity', 'trusted Founder logins', 'live PR/base/head/policy evidence', 'branch reservation evidence'],
    required_evidence: ['Exact head, base, and policy identity when applicable.', 'Separate immutable receipt binding the returned authorization comment ID to its exact body SHA-256.', 'Authenticated GitHub actor must be a trusted Founder.', 'Live protected main ref.', 'For STANDARD/non-managed Issues: merged-policy eligibility, one active exact-target REVIEW_VERDICT, and its immutable comment ID.'],
    reads: ['Task/PR/state', 'live protected main', 'BEMOAT_FOUNDER_LOGINS action variable', 'Issue comments'], writes: ['immutable authorization comment', 'immutable receipt comment', 'leased/CAS Issue state'],
    success_classifications: ['SUCCESS', 'NO_OP_IDENTICAL_RETRY'],
    retry_contract: {
      identical_retry: 'conditional',
      classification: 'NO_OP_IDENTICAL_RETRY',
      condition: 'An identical retry is allowed only when the same exact authorization comment and receipt are already durable.',
    },
    next_action_rules: [
      {
        classification: 'SUCCESS',
        next_action: nextAction('FOUNDER_GATE', null, 'The custom merge wrappers are retired; stop for native GitHub authority reconstruction or the separately registered task-bootstrap route.'),
      },
      {
        classification: 'NO_OP_IDENTICAL_RETRY',
        condition: 'Managed Task Issue with valid managed state.',
        next_action: nextAction('FOUNDER_GATE', null, 'The identical authorization is durable, but no custom merge wrapper remains.'),
      },
      {
        classification: 'SUCCESS',
        condition: 'Explicit STANDARD/non-managed eligibility with no managed state.',
        next_action: nextAction('FOUNDER_GATE', null, 'The STANDARD authorization is durable; Context must reconstruct native GitHub merge authority and evidence.'),
      },
      {
        classification: 'NO_OP_IDENTICAL_RETRY',
        condition: 'Explicit STANDARD/non-managed eligibility with no managed state.',
        next_action: nextAction('FOUNDER_GATE', null, 'The identical STANDARD authorization is durable, but no custom merge wrapper remains.'),
      },
    ],
    examples: [
      {
        description: 'Authorize a merge for a Task Issue.',
        argv: ['284', '--scope', 'merge', '--repo', 'boat1994/bemoat-web-starter'],
      },
      { description: 'Authorize a task-bootstrap.', argv: ['383', '--scope', 'task-bootstrap', '--repo', 'boat1994/bemoat-web-starter'] },
    ],
    parser_owner: 'scripts/mission-control-authorize-founder.mjs',
    safe_help_invocation: 'pnpm run bemoat:mission-control:authorize-founder -- --help --json',
    last_validation_before_mutation: 'Re-read the Task Issue, policy lineage, protected base, and existing authorization comments immediately before the leased/CAS write.',
    post_write_readback: 'Re-read the Issue comments and confirm the projected immutable authorization identity and receipt.',
    legacy_classification_map: {
      NO_OP: 'NO_OP_IDENTICAL_RETRY',
      RECORDED: 'SUCCESS',
    },
  }),
  'bemoat:mission-control:reconcile': contract({
    command: 'bemoat:mission-control:reconcile',
    tier: 'A',
    entrypoint: 'scripts/mission-control-reconcile.mjs',
    purpose: 'MIGRATION-ONLY HISTORICAL: Repair routing-only Mission Control projection drift.',
    operation: 'MIGRATION-ONLY HISTORICAL: Classify authoritative evidence and apply only a leased/CAS routing projection repair.',
    accepted_pre_states: [
      'READY',
      'IN_PROGRESS',
      'AWAITING_REVIEW_1',
      'CORRECTION_REQUIRED_1',
      'AWAITING_REVIEW_2',
      'CORRECTION_REQUIRED_2',
      'AWAITING_REVIEW_3',
      'FOUNDER_AUTHORIZED_CORRECTION',
      'BLOCKED_FOR_FOUNDER_DECISION',
      'ELIGIBLE_FOR_FOUNDER_REVIEW',
      'DONE',
      'BLOCKED_EXTERNAL',
      'STATE_CONFLICT',
      'STATE_MIGRATION_REQUIRED',
    ],
    required_inputs: [
      positional('issue_number', '<issue-number>', 'positive_integer', 'Managed Task Issue number.'),
    ],
    optional_flags: [
      flag('repository', '--repo <owner/repository>', 'repository', 'Repository containing the Task Issue.'),
    ],
    trusted_derived_values: ['canonical transport ownership', 'live evidence identity', 'lease/CAS holder identity'],
    required_evidence: ['Authoritative live evidence proves routing-only projection drift after a failed canonical transport.'],
    reads: ['Task/PR/comments/state/terminal evidence'],
    writes: ['routing-only Issue state projection via lease/CAS'],
    success_classifications: [
      'SUCCESS',
      'NO_OP_IDENTICAL_RETRY',
    ],
    retry_contract: {
      identical_retry: 'conditional',
      classification: 'NO_OP_IDENTICAL_RETRY',
      condition: 'A retry is identical only when the authoritative evidence and routing projection already agree.',
    },
    next_action_rules: [
      {
        classification: 'SUCCESS',
        next_action: nextAction('COMPLETE', null, 'The routing-only projection repair is verified.'),
      },
      {
        classification: 'NO_OP_IDENTICAL_RETRY',
        next_action: nextAction('COMPLETE', null, 'No routing projection repair remains necessary.'),
      },
    ],
    examples: [{ description: 'Reconcile routing-only projection drift.', argv: ['284', '--repo', 'boat1994/bemoat-web-starter'] }],
    parser_owner: 'scripts/mission-control-reconcile.mjs',
    safe_help_invocation: 'pnpm run bemoat:mission-control:reconcile -- --help --json',
    last_validation_before_mutation: 'Re-read the authoritative evidence and Task Issue body immediately before the routing-only lease/CAS write.',
    post_write_readback: 'Re-read the Task Issue and confirm only the permitted routing projection changed.',
    legacy_classification_map: {
      RECONCILED: 'SUCCESS',
      BOOKKEEPING_REPAIR: 'SUCCESS',
      TERMINAL_REPAIR: 'SUCCESS',
      DISPATCHED: 'SUCCESS',
      REVIEWED: 'SUCCESS',
      RECOVERABLE_ROUTING_DRIFT: 'AMBIGUOUS_RESULT',
      NO_OP: 'NO_OP_IDENTICAL_RETRY',
    },
  }),

  }
}
