/** Stateless HANDOFF command metadata ownership. */
import type { CommandMetadataDependencies } from './command-metadata-deps.ts'

export function handoffCommands(dependencies: CommandMetadataDependencies) {
  const { contract, positional, flag, nextAction } = dependencies
  return {
    'bemoat:handoff': contract({
      command: 'bemoat:handoff',
      tier: 'A',
      entrypoint: 'scripts/agent-handoff.ts',
      purpose: 'Append one validated, stateless HANDOFF record to an Issue.',
      operation: 'Validate the complete live repository binding, run the repository-required validation tier, append exactly one top-level Issue comment, and verify its identity/content by fresh readback.',
      accepted_pre_states: ['NOT_STATEFUL'],
      required_inputs: [
        positional('issue_number', '<issue-number>', 'positive_integer', 'Issue number receiving the HANDOFF.'),
        flag('body_file', '--body-file <path>', 'path', 'Strict JSON file containing one canonical HANDOFF record.', [], true),
      ],
      optional_flags: [],
      required_evidence: [
        'Canonical HANDOFF schema and closed route/next-action binding.',
        'Live repository and Issue identity.',
        'Protected base branch and exact SHA.',
        'Required local branch/head/upstream durability and PR identity when present.',
        'Authoritative changed-file evidence determining the required validation tier.',
        'Runtime-generated PASS proof bound to the validation tier, canonical command, and exact HEAD.',
        'Fresh Issue comment readback proving one exact HANDOFF body and comment identity.',
      ],
      reads: [
        'HANDOFF body file',
        'local Git branch, HEAD, cleanliness, upstream, origin, and protected-base-to-HEAD changed files when no PR is present',
        'GitHub repository, protected base, Issue, PR and changed files when applicable, and Issue comments',
        'authoritative changed-file evidence and synchronous result from the selected pnpm validation command',
      ],
      writes: ['exactly one top-level Issue HANDOFF comment; no other protocol mutation'],
      success_classifications: ['SUCCESS', 'NO_OP_IDENTICAL_RETRY'],
      stop_classifications: ['INVALID_INVOCATION', 'STATE_CONFLICT', 'AUTHORITY_CONFLICT', 'HEAD_DRIFT', 'BLOCKED_EXTERNAL', 'EVIDENCE_CONFLICT', 'AMBIGUOUS_RESULT', 'INTERNAL_ERROR'],
      retry_contract: {
        identical_retry: 'conditional' as const,
        classification: 'NO_OP_IDENTICAL_RETRY',
        condition: 'Return NO_OP_IDENTICAL_RETRY only when one exact canonical HANDOFF already exists and fresh readback proves its identity; never blindly retry an unproven POST.',
      },
      next_action_rules: [
        { classification: 'SUCCESS', next_action: nextAction('COMPLETE', null, 'The HANDOFF comment was appended and verified by exact readback.') },
        { classification: 'NO_OP_IDENTICAL_RETRY', next_action: nextAction('COMPLETE', null, 'The exact canonical HANDOFF is already durable; no mutation was performed.') },
      ],
      examples: [{ description: 'Append one validated HANDOFF record from a JSON file.', argv: ['410', '--body-file', './handoff.json'] }],
      parser_owner: 'scripts/agent-handoff.ts',
      safe_help_invocation: 'pnpm run bemoat:handoff -- --help --json',
      last_validation_before_mutation: 'Run the repository-required validation tier after the clean exact-head preflight, add runtime-generated PASS proof bound to the tier, canonical command, and exact HEAD, then re-read the complete HANDOFF schema, repository, Issue, protected-base, branch/head/upstream, changed-file scope, and applicable PR bindings immediately after validation and before posting.',
      post_write_readback: 'Fresh-read the target Issue comments and require exactly one matching canonical HANDOFF body with a durable comment ID/URL before success.',
      legacy_classification_map: {},
    }),
  }
}
