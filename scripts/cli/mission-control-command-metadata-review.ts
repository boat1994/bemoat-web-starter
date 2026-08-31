/** Mission Control command metadata ownership. */
import type { CommandMetadataDependencies } from './mission-control-command-metadata-deps.ts'

export function missionControlReviewCommands(dependencies: CommandMetadataDependencies) {
  const { contract, flag, environment, nextAction } = dependencies
  return {
    'bemoat:mission-control:task-bootstrap': contract({
      command: 'bemoat:mission-control:task-bootstrap',
      tier: 'A',
      entrypoint: 'scripts/mission-control-task-create.mjs',
      purpose: 'MIGRATION-ONLY HISTORICAL: Create or initialize the Founder-authorized Mission Control Task Issue.',
      operation: 'MIGRATION-ONLY HISTORICAL: Verify signed Actions identity and project the initial Task state and ownership record.',
      accepted_pre_states: ['NOT_STATEFUL', 'EXISTING_REGISTERED_TASK'],
      required_inputs: [
        flag('founder_authorization_comment_id', '--founder-authorization-comment-id <id>', 'positive_integer', 'Immutable Founder authorization comment.', [], true),
      ],
      optional_flags: [
        flag('check', '--check', 'boolean', 'Validate without creating the Task Issue.'),
        environment('GITHUB_ACTIONS', 'boolean', 'Trusted GitHub Actions execution identity.', ['true']),
        environment('GITHUB_REPOSITORY', 'repository', 'Trusted Actions repository identity.'),
        environment('GITHUB_WORKFLOW', 'string', 'Trusted Actions workflow identity.'),
        environment('GITHUB_REF', 'string', 'Trusted Actions ref identity.'),
        environment('GITHUB_SHA', 'full_sha', 'Trusted Actions commit identity.'),
        environment('GITHUB_RUN_ID', 'positive_integer', 'Trusted Actions workflow run identity.'),
        environment('BEMOAT_TASK_BOOTSTRAP_SIGNING_KEY_ID', 'string', 'Trusted signing key identity.'),
        environment('BEMOAT_TASK_BOOTSTRAP_SIGNING_PRIVATE_KEY', 'string', 'Trusted signing material supplied only by Actions secret configuration.'),
      ],
      trusted_derived_values: ['Actions-derived workflow identity', 'trusted-derived protected public key', 'GitHub-derived current target, protected-base, and policy evidence'],
      required_evidence: ['Founder-authorized signed authorization.', 'Actions-derived trusted GitHub workflow identity and public key.', 'GitHub-derived current protected-base/policy evidence and, only when authorized, campaign/PR evidence.'],
      reads: ['signed authorization', 'workflow identity', 'public key', 'GitHub current policy/target evidence'],
      writes: ['Task Issue creation or state/attestation projection', 'ownership registry'],
      retry_contract: { identical_retry: 'conditional', classification: 'NO_OP_IDENTICAL_RETRY', condition: 'A retry is identical only when the same authorization fingerprint and Task projection already exist.' },
      role_contracts: {
        FOUNDER_AUTHORIZATION: {
          required_bindings: ['schema_version', 'status', 'authority', 'author_login', 'comment_id', 'immutable_comment_reference', 'non_superseded', 'superseded_by', 'repository', 'bundle_kind', 'parent_issue', 'task_issue', 'pr', 'target_mode', 'exact_head', 'reviewed_head', 'base', 'policy_source', 'policy_source_sha', 'protected_base_sha', 'policy_version', 'scope', 'action'],
          representation: 'raw_json_object',
          identity_requirements: 'Must be authored by a trusted Founder login.',
          scope_binding: 'task-initialization',
          action_binding: 'create-managed-task',
          canonical_example: '{"schema_version":1,"status":"approved","authority":"Founder","action":"create-managed-task"}',
        },
      },
      next_action_rules: [
        { classification: 'SUCCESS', next_action: nextAction('FOUNDER_GATE', null, 'The historical stateful dispatch transport was retired; stop before continuing this migration-only route.') },
        { classification: 'NO_OP_IDENTICAL_RETRY', next_action: nextAction('COMPLETE', null, 'The identical Task bootstrap is already durable.') },
      ],
      examples: [{ description: 'Bootstrap the Founder-authorized current target Issue.', argv: ['--founder-authorization-comment-id', '12345'] }],
      parser_owner: 'scripts/mission-control-task-create.mjs',
      safe_help_invocation: 'pnpm run bemoat:mission-control:task-bootstrap -- --help --json',
      last_validation_before_mutation: 'Re-verify signed authorization, Actions identity, public key, current protected base/policy, and target ownership evidence immediately before projection.',
      post_write_readback: 'Read the target Task Issue, attestation, and ownership registry and confirm the exact authorization fingerprint.',
      legacy_classification_map: { CREATED: 'SUCCESS', RECOVERED: 'SUCCESS', IDEMPOTENT: 'NO_OP_IDENTICAL_RETRY' },
    }),
  }
}
