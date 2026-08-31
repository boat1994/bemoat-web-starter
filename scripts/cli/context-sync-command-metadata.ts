/** Bounded protected-base synchronization command metadata ownership. */
import type { CommandMetadataDependencies } from './command-metadata-deps.ts'

export function contextSyncCommands(dependencies: CommandMetadataDependencies) {
  const { contract, positional, flag, nextAction } = dependencies
  return {
    'bemoat:context:sync-base': contract({
      command: 'bemoat:context:sync-base',
      tier: 'A',
      entrypoint: 'scripts/agent-context-sync-base.ts',
      purpose: 'Perform one bounded protected-main synchronization into the same stale active PR branch, optionally from an exact protected-main command checkout into one explicit target worktree.',
      operation: 'Resolve canonical source and target roots, validate protected-main command identity plus live target Issue/PR/base/head/scope, ancestry, and clean durable state, then fetch/merge/push/read back only in the target.',
      accepted_pre_states: ['Active PR with stale protected base and otherwise-valid continuation.'],
      required_inputs: [
        positional('issue_number', '<issue-number>', 'positive_integer', 'Issue number owning the stale active PR.'),
      ],
      optional_flags: [
        flag('json', '--json', 'boolean', 'Emit canonical machine-readable result.'),
        flag('target_worktree', '--target-worktree <absolute-path>', 'path', 'Absolute canonicalizable path to the stale active PR worktree; omit for same-worktree mode.'),
      ],
      trusted_derived_values: [
        'canonical command-source root and live protected-main SHA/repository identity',
        'live target Issue, PR, protected-base, local Git, ancestry, and remote branch evidence',
      ],
      required_evidence: [
        'Same Issue/PR/base/head.',
        'In explicit-target mode, clean canonical command source at the exact live protected-main SHA and canonical target repository.',
        'Old base ancestor of protected main and PR head.',
        'Clean attached pushed durable target state tracking the canonical origin PR branch, plus remote readback.',
        'Merge-tree preflight and exact post-write head.',
      ],
      reads: [
        'command-source Git root/HEAD/status/origin in explicit-target mode',
        'target Git refs/status/ancestry/merge-tree',
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
        'Stop before mutation when an explicit target is relative, unavailable, not a directory, or aliases the command source.',
        'Stop with canonical evidence, source/target drift, external, or ambiguous classifications on any failed gate.',
      ],
      examples: [
        { description: 'Synchronize an otherwise-valid stale active PR base.', argv: ['427', '--json'] },
        { description: 'Run the protected-main command against one explicit stale PR worktree.', argv: ['410', '--target-worktree', '/absolute/path/to/stale-pr', '--json'] },
      ],
      parser_owner: 'scripts/agent-context-sync-base.ts',
      safe_help_invocation: 'pnpm run bemoat:context:sync-base -- --help --json',
      last_validation_before_mutation: 'Re-read explicit source root/HEAD/status/origin, target clean status/branch/HEAD, protected-base ref, and PR branch ref immediately before target merge.',
      post_write_readback: 'Confirm clean branch and remote exact head; CI and semantic review must rerun.',
    }),
  }
}
