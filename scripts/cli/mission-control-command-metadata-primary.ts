/** Mission Control command metadata ownership. */
import type { CommandMetadataDependencies } from './mission-control-command-metadata-deps.ts'

export function missionControlPrimaryCommands(dependencies: CommandMetadataDependencies) {
  const { contract, positional, flag, nextAction } = dependencies
  const commands = {
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
        next_action: nextAction('FOUNDER_GATE', null, 'The custom merge wrappers are retired; stop for native GitHub authority reconstruction.'),
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
  }
  return commands
}
