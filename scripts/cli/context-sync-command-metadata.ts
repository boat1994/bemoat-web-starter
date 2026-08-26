/** Bounded protected-base synchronization command metadata ownership. */
import type { CommandMetadataDependencies } from './mission-control-command-metadata-deps.ts'

export function contextSyncCommands(dependencies: CommandMetadataDependencies) {
  const { contract, positional, flag, nextAction } = dependencies
  return {
    'bemoat:context:sync-base': contract({
      command: 'bemoat:context:sync-base',
      tier: 'A',
      entrypoint: 'scripts/agent-context-sync-base.mjs',
      purpose: 'Perform one bounded protected-main synchronization into the same stale active PR branch.',
      operation: 'Validate live Issue/PR/base/head/scope, ancestry, and clean durable state before fetch/merge/push/readback.',
      accepted_pre_states: ['Active PR with stale protected base and otherwise-valid continuation.'],
      required_inputs: [
        positional('issue_number', '<issue-number>', 'positive_integer', 'Issue number owning the stale active PR.'),
      ],
      optional_flags: [flag('json', '--json', 'boolean', 'Emit canonical machine-readable result.')],
      trusted_derived_values: [
        'live Issue, PR, protected-base, local Git, ancestry, and remote branch evidence',
      ],
      required_evidence: [
        'Same Issue/PR/base/head.',
        'Old base ancestor of protected main and PR head.',
        'Clean attached pushed durable state tracking the canonical origin PR branch, plus remote readback.',
        'Merge-tree preflight and exact post-write head.',
      ],
      reads: [
        'local Git refs/status/ancestry/merge-tree',
        'GitHub Issue/PR/base/checks/reviews',
      ],
      writes: [
        'one native Git merge and push of the same active PR branch; no Issue/comment/PR metadata/PR merge/scope mutation',
      ],
      success_classifications: ['SUCCESS'],
      retry_contract: {
        identical_retry: 'forbidden',
        classification: null,
        condition: 'A successful synchronization changes the exact PR head; every later attempt requires fresh live evidence evaluation.',
      },
      next_action_rules: [
        {
          classification: 'SUCCESS',
          next_action: nextAction('COMMAND', 'bemoat:context', 'Reconstruct synchronized exact-head context; CI and review must rerun.'),
        },
      ],
      stop_conditions: [
        'Stop with canonical evidence, drift, external, or ambiguous classifications on any failed gate.',
      ],
      examples: [
        { description: 'Synchronize an otherwise-valid stale active PR base.', argv: ['427', '--json'] },
      ],
      parser_owner: 'scripts/agent-context-sync-base.mjs',
      safe_help_invocation: 'pnpm run bemoat:context:sync-base -- --help --json',
      last_validation_before_mutation: 'Re-read clean status, branch, HEAD, protected-base ref, PR branch ref, and ancestry immediately before merge and push.',
      post_write_readback: 'Confirm clean branch and remote exact head; CI and semantic review must rerun.',
    }),
  }
}
