import { CANONICAL_TRANSPORTS } from '../mission-control/transport-registry.mjs'

export const COMMAND_CONTRACT_SCHEMA_VERSION = 1

const canonicalTransportByCommand = new Map(
  CANONICAL_TRANSPORTS.map((transport) => [transport.command, transport]),
)

const SAFE_STOP_CLASSIFICATIONS = [
  'INVALID_INVOCATION',
  'UNSUPPORTED_PRE_STATE',
  'STATE_CONFLICT',
  'AUTHORITY_CONFLICT',
  'HEAD_DRIFT',
  'BLOCKED_EXTERNAL',
  'EVIDENCE_CONFLICT',
  'AMBIGUOUS_RESULT',
  'INTERNAL_ERROR',
]

const ALL_MUTATING_COMMANDS = [
  'bemoat:agent:delivery',
  'bemoat:boilerplate:sync',
  'bemoat:hooks:install',
  'bemoat:issue:comment',
  'bemoat:mission-control:dispatch',
  'bemoat:mission-control:merge',
  'bemoat:mission-control:reconcile',
  'bemoat:mission-control:recover-review',
  'bemoat:mission-control:reopen',
  'bemoat:mission-control:review',
  'bemoat:mission-control:task-bootstrap',
]

function input({
  name,
  syntax,
  kind,
  value_type,
  required,
  source = 'caller',
  values = [],
  description,
}) {
  return {
    name,
    syntax,
    kind,
    value_type,
    required,
    source,
    multiple: false,
    values,
    description,
  }
}

function positional(name, syntax, value_type, description) {
  return input({
    name,
    syntax,
    kind: 'positional',
    value_type,
    required: true,
    description,
  })
}

function flag(name, syntax, value_type, description, values = [], required = false) {
  return input({
    name,
    syntax,
    kind: 'flag',
    value_type,
    required,
    values,
    description,
  })
}

function stdinInput(name, description) {
  return input({
    name,
    syntax: 'stdin',
    kind: 'stdin',
    value_type: 'string',
    required: true,
    description,
  })
}

function environment(name, value_type, description, values = []) {
  return input({
    name,
    syntax: name,
    kind: 'environment',
    value_type,
    required: false,
    source: 'trusted_derived',
    values,
    description,
  })
}

function nextAction(type, command, reason) {
  return { type, command, reason }
}

function transportFields(command) {
  const transport = canonicalTransportByCommand.get(command)
  return {
    exceptional: transport?.exceptional ?? false,
    transport_role: transport?.role ?? null,
  }
}

function contract({
  command,
  tier,
  entrypoint,
  purpose,
  operation,
  accepted_pre_states = [],
  required_inputs = [],
  optional_flags = [],
  trusted_derived_values = [],
  required_evidence = [],
  reads = [],
  writes = [],
  success_classifications = ['SUCCESS'],
  stop_classifications = SAFE_STOP_CLASSIFICATIONS,
  stop_conditions = ['Stop before mutation when preconditions or evidence cannot be proven.'],
  retry_contract = {
    identical_retry: 'allowed',
    classification: null,
    condition: 'No durable retry distinction is defined for this command.',
  },
  role_contracts = {},
  next_action_rules = [
    {
      classification: 'SUCCESS',
      next_action: nextAction('COMPLETE', null, 'The command completed its registered operation.'),
    },
  ],
  examples = [],
  parser_owner = null,
  delegated_executable = null,
  help_meaningful = tier !== 'C',
  safe_help_invocation = tier === 'C'
    ? null
    : `pnpm run ${command} -- --help --json`,
  exclusion_reason = null,
  last_validation_before_mutation = null,
  post_write_readback = null,
  legacy_classification_map = {},
}) {
  const fields = transportFields(command)
  const allInputs = [...required_inputs, ...optional_flags]
  const callerSuppliedValues = [...new Set(
    allInputs
      .filter((entry) => entry.source === 'caller')
      .map((entry) => entry.name),
  )]
  const trustedValues = [...new Set([
    ...allInputs
      .filter((entry) => entry.source === 'trusted_derived')
      .map((entry) => entry.name),
    ...trusted_derived_values,
  ])]

  return {
    schema_version: COMMAND_CONTRACT_SCHEMA_VERSION,
    command,
    tier,
    entrypoint,
    purpose,
    operation,
    accepted_pre_states,
    required_inputs,
    optional_flags,
    caller_supplied_values: callerSuppliedValues,
    trusted_derived_values: trustedValues,
    required_evidence,
    reads,
    writes,
    success_classifications,
    stop_classifications,
    stop_conditions,
    retry_contract,
    role_contracts,
    next_action_rules,
    examples,
    exceptional: fields.exceptional,
    transport_role: fields.transport_role,
    parser_owner,
    delegated_executable,
    help_meaningful,
    safe_help_invocation,
    exclusion_reason,
    last_validation_before_mutation,
    post_write_readback,
    legacy_classification_map,
  }
}

/**
 * @typedef {Object} InputSpec
 * @property {string} name
 * @property {string} syntax
 * @property {'positional'|'flag'|'environment'|'stdin'} kind
 * @property {'boolean'|'positive_integer'|'repository'|'full_sha'|'path'|'enum'|'string'} value_type
 * @property {boolean} required
 * @property {'caller'|'trusted_derived'} source
 * @property {false} multiple
 * @property {string[]} values
 * @property {string} description
 */

/**
 * @typedef {Object} NextAction
 * @property {'COMMAND'|'FOUNDER_GATE'|'STOP'|'COMPLETE'} type
 * @property {string|null} command
 * @property {string} reason
 */

/**
 * @typedef {Object} CommandContract
 * @property {1} schema_version
 * @property {string} command
 * @property {'A'|'B'|'C'} tier
 * @property {string} entrypoint
 * @property {string} purpose
 * @property {string} operation
 * @property {string[]} accepted_pre_states
 * @property {InputSpec[]} required_inputs
 * @property {InputSpec[]} optional_flags
 * @property {string[]} caller_supplied_values
 * @property {string[]} trusted_derived_values
 * @property {string[]} required_evidence
 * @property {string[]} reads
 * @property {string[]} writes
 * @property {string[]} success_classifications
 * @property {string[]} stop_classifications
 * @property {string[]} stop_conditions
 * @property {{identical_retry: 'allowed'|'forbidden'|'conditional', classification: string|null, condition: string}} retry_contract
 * @property {Record<string, any>} role_contracts
 * @property {{classification: string, next_action: NextAction}[]} next_action_rules
 * @property {{description: string, argv: string[]}[]} examples
 * @property {boolean} exceptional
 * @property {string|null} transport_role
 * @property {string|null} parser_owner
 * @property {string|null} delegated_executable
 * @property {boolean} help_meaningful
 * @property {string|null} safe_help_invocation
 * @property {string|null} exclusion_reason
 * @property {string|null} last_validation_before_mutation
 * @property {string|null} post_write_readback
 * @property {Record<string, string>} legacy_classification_map
 */

/**
 * @typedef {Object} RouteRow
 * @property {string} route_key
 * @property {string|null|'NOT_STATEFUL'} observed_state
 * @property {string} evidence_case
 * @property {string} required_evidence_condition
 * @property {string} forbidden_evidence_condition
 * @property {string|null} permitted_operation
 * @property {string|null} canonical_command
 * @property {'full'|'delta'|'blocker-verification'|null} required_review_type
 * @property {string} expected_post_state_or_gate
 * @property {string[]} prohibited_commands
 * @property {'COMMAND'|'FOUNDER_GATE'|'COMPLETE'|'STOP'} decision
 * @property {string|null} stop_condition
 */

/** @type {Record<string, CommandContract>} */
const commands = {
  'bemoat:agent:delivery': contract({
    command: 'bemoat:agent:delivery',
    tier: 'A',
    entrypoint: 'scripts/agent-delivery.mjs',
    purpose: 'Deliver one implementation RESULT after exact-head verification.',
    operation: 'Post a canonical RESULT and project the leased Task Issue state.',
    accepted_pre_states: [
      'IN_PROGRESS',
      'CORRECTION_REQUIRED_1',
      'CORRECTION_REQUIRED_2',
      'FOUNDER_AUTHORIZED_CORRECTION',
    ],
    required_inputs: [
      positional('issue_number', '<issue-number>', 'positive_integer', 'Managed Task Issue number.'),
      stdinInput('result_body', 'Canonical RESULT comment body when --body-file is not used.'),
    ],
    optional_flags: [
      flag('repository', '--repo <owner/repository>', 'repository', 'Repository containing the Task Issue.'),
      flag('body_file', '--body-file <path>', 'path', 'Read the RESULT body from this file instead of stdin.'),
    ],
    required_evidence: [
      'Local HEAD and branch identity.',
      'Remote branch ref, Pull Request head, and exact-head CI evidence.',
      'Live Task Issue state and comment evidence.',
      'One canonical RESULT transition identity.',
    ],
    reads: [
      'local HEAD/branch',
      'remote branch ref',
      'Pull Request head and CI',
      'Task Issue managed state and comments',
    ],
    writes: [
      'canonical RESULT comment',
      'leased/CAS Task Issue state projection',
    ],
    success_classifications: ['SUCCESS', 'NO_OP_IDENTICAL_RETRY'],
    retry_contract: {
      identical_retry: 'conditional',
      classification: 'NO_OP_IDENTICAL_RETRY',
      condition: 'Return NO_OP_IDENTICAL_RETRY only when the exact RESULT identity and head are already projected.',
    },
    next_action_rules: [
      {
        classification: 'SUCCESS',
        next_action: nextAction(
          'COMMAND',
          'bemoat:mission-control:review',
          'The delivered head is ready for the registered review route.',
        ),
      },
      {
        classification: 'NO_OP_IDENTICAL_RETRY',
        next_action: nextAction('COMPLETE', null, 'The identical RESULT is already durable.'),
      },
    ],
    examples: [
      {
        description: 'Deliver a RESULT from a body file.',
        argv: ['284', '--repo', 'boat1994/bemoat-web-starter', '--body-file', './result.md'],
      },
    ],
    parser_owner: 'scripts/agent-delivery.mjs',
    safe_help_invocation: 'pnpm run bemoat:agent:delivery -- --help --json',
    last_validation_before_mutation: 'Re-read the Task Issue, PR head, exact-head CI, and live comment evidence immediately before the leased/CAS write.',
    post_write_readback: 'Re-read the Task Issue and comments and confirm the RESULT identity, projected state, and PR head.',
    legacy_classification_map: {
      DELIVERED: 'SUCCESS',
      RECOVERABLE_ROUTING_DRIFT: 'AMBIGUOUS_RESULT',
    },
  }),

  'bemoat:agent:issue': contract({
    command: 'bemoat:agent:issue',
    tier: 'B',
    entrypoint: 'scripts/agent-issue.mjs',
    purpose: 'Inspect an Issue and produce the agent preflight without mutation.',
    operation: 'Run the read-only Issue preflight and correction-phase checks.',
    required_inputs: [
      positional('issue_number', '<issue-number>', 'positive_integer', 'Issue number to inspect.'),
    ],
    optional_flags: [
      flag(
        'phase',
        '--phase <phase>',
        'enum',
        'Optional read-only preflight phase.',
        ['correction'],
      ),
    ],
    reads: [
      'local git and repository files',
      'GitHub Issue, comments, Pull Request, and checks',
    ],
    writes: [],
    stop_conditions: ['Stop without mutation when Issue, PR, or correction evidence is incomplete or conflicting.'],
    parser_owner: 'scripts/agent-issue/cli-args.mjs',
    safe_help_invocation: 'pnpm run bemoat:agent:issue -- --help --json',
  }),

  'bemoat:boilerplate:check': contract({
    command: 'bemoat:boilerplate:check',
    tier: 'B',
    entrypoint: 'scripts/check-boilerplate-drift.mjs',
    purpose: 'Inspect boilerplate drift without changing the target repository.',
    operation: 'Compare the selected starter-managed harness projection with the target.',
    optional_flags: [
      flag('harness_only', '--harness-only', 'boolean', 'Inspect only harness-managed paths.', ['true']),
      flag('full', '--full', 'boolean', 'Inspect the full boilerplate projection.', ['true']),
      environment('BEMOAT_SYNC_MODE', 'enum', 'Trusted default sync mode.', ['harness-only', 'full']),
      environment('BEMOAT_BOILERPLATE_REPO', 'repository', 'Trusted upstream boilerplate repository default.'),
      environment('BEMOAT_BOILERPLATE_REF', 'string', 'Trusted upstream boilerplate ref default.'),
    ],
    reads: [
      'repository files and configuration',
      'upstream boilerplate clone and network evidence',
    ],
    writes: [],
    stop_conditions: ['Stop when the upstream clone, target tree, or selected sync mode cannot be inspected deterministically.'],
    parser_owner: 'scripts/boilerplate/config.mjs',
    safe_help_invocation: 'pnpm run bemoat:boilerplate:check -- --help --json',
  }),

  'bemoat:boilerplate:sync': contract({
    command: 'bemoat:boilerplate:sync',
    tier: 'A',
    entrypoint: 'scripts/sync-boilerplate.mjs',
    purpose: 'Synchronize the approved starter-managed harness projection.',
    operation: 'Apply managed, seed, and merge-keep boilerplate changes after preflight.',
    optional_flags: [
      flag('harness_only', '--harness-only', 'boolean', 'Apply only harness-managed paths.', ['true']),
      flag('full', '--full', 'boolean', 'Apply the full boilerplate projection.', ['true']),
      flag('apply_build_contract', '--apply-build-contract', 'boolean', 'Opt into the separately gated build contract.', ['true']),
      flag('skip_mc_transition_gate', '--skip-mc-transition-gate', 'boolean', 'Explicitly bypass the Mission Control child-sync transition gate.', ['true']),
      flag('require_mc_transition_gate', '--require-mc-transition-gate', 'boolean', 'Accepted legacy no-op transition-gate compatibility flag.', ['true']),
      environment('BEMOAT_SYNC_MODE', 'enum', 'Trusted default sync mode.', ['harness-only', 'full']),
      environment('BEMOAT_APPLY_BUILD_CONTRACT', 'boolean', 'Trusted build-contract opt-in default.', ['0', '1', 'true', 'false']),
      environment('BEMOAT_SKIP_MC_TRANSITION_CHILD_SYNC_GATE', 'boolean', 'Trusted explicit transition-gate bypass default.', ['1']),
      environment('BEMOAT_REQUIRE_MC_TRANSITION_CHILD_SYNC_GATE', 'boolean', 'Accepted legacy no-op transition-gate compatibility default.', ['1']),
      environment('BEMOAT_CHILD_SYNC_182_MERGED', 'boolean', 'Trusted child-sync Issue #182 merge evidence.', ['1']),
      environment('BEMOAT_CHILD_SYNC_184_MERGED', 'boolean', 'Trusted child-sync Issue #184 merge evidence.', ['1']),
      environment('BEMOAT_CHILD_SYNC_LIVE_RECONSTRUCTED', 'boolean', 'Trusted live child reconstruction evidence.', ['1']),
      environment('BEMOAT_CHILD_SYNC_FRESH_HANDOFF', 'boolean', 'Trusted fresh child-sync HANDOFF evidence.', ['1']),
      environment('BEMOAT_BOILERPLATE_REPO', 'repository', 'Trusted upstream boilerplate repository default.'),
      environment('BEMOAT_BOILERPLATE_REF', 'string', 'Trusted upstream boilerplate ref default.'),
    ],
    required_evidence: [
      'Selected source and target repositories.',
      'Transition-gate and build-contract evidence when requested.',
      'Clean or explicitly preserved target working-tree state.',
    ],
    reads: [
      'source and target files',
      'git refs and working-tree state',
      'upstream clone and transition evidence',
    ],
    writes: [
      'managed and seed paths',
      'merge-keep paths',
      'package proposal and sync metadata',
      'stash/commit only when explicitly authorized by the workflow',
    ],
    retry_contract: {
      identical_retry: 'conditional',
      classification: 'NO_OP_IDENTICAL_RETRY',
      condition: 'A retry is NO_OP_IDENTICAL_RETRY only when the selected projection and target metadata are already identical.',
    },
    next_action_rules: [
      {
        classification: 'SUCCESS',
        next_action: nextAction('COMPLETE', null, 'The selected boilerplate projection was synchronized.'),
      },
      {
        classification: 'NO_OP_IDENTICAL_RETRY',
        next_action: nextAction('COMPLETE', null, 'The selected boilerplate projection is already synchronized.'),
      },
    ],
    examples: [
      {
        description: 'Synchronize harness rails only.',
        argv: ['--harness-only'],
      },
    ],
    parser_owner: 'scripts/boilerplate/config.mjs',
    safe_help_invocation: 'pnpm run bemoat:boilerplate:sync -- --help --json',
    last_validation_before_mutation: 'Re-check selected mode, source/target paths, transition gates, and working-tree preservation immediately before applying changes.',
    post_write_readback: 'Re-scan managed paths and sync metadata and confirm the documented target projection.',
    legacy_classification_map: {
      SYNCED: 'SUCCESS',
      NO_OP: 'NO_OP_IDENTICAL_RETRY',
    },
  }),

  'bemoat:branch:check': contract({
    command: 'bemoat:branch:check',
    tier: 'B',
    entrypoint: 'scripts/check-branch-safety.sh',
    purpose: 'Validate branch safety before routine implementation work.',
    operation: 'Read the current branch and opt-in integration environment.',
    optional_flags: [
      environment('ALLOW_INTEGRATION_BRANCH', 'boolean', 'Trusted explicit integration-maintenance opt-in.', ['0', '1']),
    ],
    reads: ['current git branch and opt-in environment'],
    writes: [],
    stop_conditions: ['Stop when the branch is protected or the required integration opt-in is absent.'],
    parser_owner: 'scripts/check-branch-safety.sh',
    safe_help_invocation: 'pnpm run bemoat:branch:check -- --help --json',
  }),

  'bemoat:check': contract({
    command: 'bemoat:check',
    tier: 'C',
    entrypoint: 'package.json',
    purpose: 'Run the registered repository validation pipeline.',
    operation: 'Delegate to the package validation pipeline without adding a repository parser.',
    reads: [
      'delegated guards',
      'ESLint and TypeScript inputs',
      'Vitest source, test, and configuration files',
    ],
    writes: [],
    parser_owner: null,
    delegated_executable: 'pnpm run bemoat:guard:safety && pnpm run lint && pnpm run typecheck && pnpm run bemoat:test:int',
    help_meaningful: false,
    safe_help_invocation: 'pnpm run bemoat:guard:safety -- --help',
    exclusion_reason: 'Tier C is a package pipeline wrapper; it delegates validation and has no repository-owned argument parser.',
  }),

  'bemoat:guard:cloudflare-env': contract({
    command: 'bemoat:guard:cloudflare-env',
    tier: 'B',
    entrypoint: 'scripts/guard-cloudflare-env.mjs',
    purpose: 'Inspect Cloudflare environment configuration for unsafe placeholders.',
    operation: 'Run the read-only Cloudflare environment guard.',
    reads: ['environment values and wrangler.jsonc'],
    writes: [],
    stop_conditions: ['Stop when required environment or wrangler configuration is missing or unsafe.'],
    parser_owner: 'scripts/guard-cloudflare-env.mjs',
    safe_help_invocation: 'pnpm run bemoat:guard:cloudflare-env -- --help --json',
  }),

  'bemoat:guard:harness-contract': contract({
    command: 'bemoat:guard:harness-contract',
    tier: 'B',
    entrypoint: 'scripts/guard-harness-contract.mjs',
    purpose: 'Inspect the managed harness contract and runtime closure.',
    operation: 'Run the read-only harness contract guard.',
    reads: ['managed sync manifest and harness files'],
    writes: [],
    stop_conditions: ['Stop when managed harness paths or runtime closure violate the sync contract.'],
    parser_owner: 'scripts/guard-harness-contract.mjs',
    safe_help_invocation: 'pnpm run bemoat:guard:harness-contract -- --help --json',
  }),

  'bemoat:guard:mission-control-contract': contract({
    command: 'bemoat:guard:mission-control-contract',
    tier: 'B',
    entrypoint: 'scripts/guard-mission-control-contract.mjs',
    purpose: 'Inspect Mission Control policy, scripts, and managed rails.',
    operation: 'Run the read-only Mission Control contract guard.',
    reads: ['Mission Control policy/docs/scripts and sync manifest'],
    writes: [],
    stop_conditions: ['Stop when Mission Control ownership or managed-path contracts drift.'],
    parser_owner: 'scripts/guard-mission-control-contract.mjs',
    safe_help_invocation: 'pnpm run bemoat:guard:mission-control-contract -- --help --json',
  }),

  'bemoat:guard:pack': contract({
    command: 'bemoat:guard:pack',
    tier: 'B',
    entrypoint: 'scripts/guard-pack.mjs',
    purpose: 'Run the aggregate repository safety guard pack.',
    operation: 'Delegate read-only safety checks through the shared guard facade.',
    reads: ['repository guard inputs'],
    writes: [],
    stop_conditions: ['Stop when any registered repository safety guard reports a violation.'],
    parser_owner: 'scripts/guard-pack.mjs',
    safe_help_invocation: 'pnpm run bemoat:guard:pack -- --help --json',
  }),

  'bemoat:guard:safety': contract({
    command: 'bemoat:guard:safety',
    tier: 'B',
    entrypoint: 'scripts/guard-pack.mjs',
    purpose: 'Run the safety alias of the aggregate repository guard pack.',
    operation: 'Use the same guard facade as bemoat:guard:pack while preserving command identity.',
    reads: ['repository guard inputs'],
    writes: [],
    stop_conditions: ['Stop when any registered repository safety guard reports a violation.'],
    parser_owner: 'scripts/guard-pack.mjs',
    safe_help_invocation: 'pnpm run bemoat:guard:safety -- --help --json',
  }),

  'bemoat:hooks:install': contract({
    command: 'bemoat:hooks:install',
    tier: 'A',
    entrypoint: 'scripts/install-git-hooks.mjs',
    purpose: 'Install the repository-owned local git hook configuration.',
    operation: 'Apply hook modes and core.hooksPath after deterministic preflight.',
    accepted_pre_states: ['NOT_STATEFUL'],
    required_evidence: ['.githooks exists and contains the approved hook files.', 'Git config write target is the current repository.'],
    reads: ['.githooks existence', 'git config'],
    writes: ['hook file modes', 'core.hooksPath'],
    retry_contract: {
      identical_retry: 'conditional',
      classification: 'NO_OP_IDENTICAL_RETRY',
      condition: 'Return NO_OP_IDENTICAL_RETRY only when hook modes and core.hooksPath already match the approved configuration.',
    },
    next_action_rules: [
      {
        classification: 'SUCCESS',
        next_action: nextAction('COMPLETE', null, 'The approved local hooks are installed.'),
      },
      {
        classification: 'NO_OP_IDENTICAL_RETRY',
        next_action: nextAction('COMPLETE', null, 'The approved local hooks are already installed.'),
      },
    ],
    examples: [{ description: 'Install local hooks.', argv: [] }],
    parser_owner: 'scripts/install-git-hooks.mjs',
    safe_help_invocation: 'pnpm run bemoat:hooks:install -- --help --json',
    last_validation_before_mutation: 'Confirm the current repository, hook files, and expected git configuration immediately before chmod/config writes.',
    post_write_readback: 'Read hook modes and core.hooksPath and compare them with the approved configuration.',
    legacy_classification_map: {
      INSTALLED: 'SUCCESS',
      NO_OP: 'NO_OP_IDENTICAL_RETRY',
    },
  }),

  'bemoat:issue:comment': contract({
    command: 'bemoat:issue:comment',
    tier: 'A',
    entrypoint: 'scripts/post-role-comment.mjs',
    purpose: 'Validate or publish a role comment outside canonical state transports.',
    operation: 'Validate a role comment and optionally post it without owning ordinary state transitions.',
    accepted_pre_states: ['NOT_STATEFUL'],
    required_inputs: [
      positional('issue_number', '<issue-number>', 'positive_integer', 'Issue number receiving the role comment.'),
      stdinInput('comment_body', 'Role comment body when --body-file is not used.'),
    ],
    optional_flags: [
      flag('repository', '--repo <owner/repository>', 'repository', 'Repository containing the Issue.'),
      flag('body_file', '--body-file <path>', 'path', 'Read the comment body from this file instead of stdin.'),
      flag('check', '--check', 'boolean', 'Validate without posting.'),
      flag('allow_warning', '--allow-warning', 'boolean', 'Acknowledge the documented long-comment warning.'),
    ],
    required_evidence: ['Canonical role/comment body validation.', 'Issue and correction evidence when the role requires it.'],
    reads: ['body file or stdin', 'Issue comments and correction evidence'],
    writes: ['Issue role comment unless --check is supplied or an identical authoritative retry is proven'],
    success_classifications: ['SUCCESS', 'NO_OP_IDENTICAL_RETRY'],
    retry_contract: {
      identical_retry: 'conditional',
      classification: 'NO_OP_IDENTICAL_RETRY',
      condition: 'A retry is identical only when the same validated role comment is already the live authoritative comment.',
    },
    role_contracts: {
      HANDOFF: {
        required_heading: '## HANDOFF',
        required_bindings: [
          'issue_number',
          'bounded_objective',
          'permitted_scope',
          'prohibited_scope',
          'approved_branch_or_target_when_applicable',
          'authority_identity_when_required',
          'exact_base_or_head_when_required',
          'one_next_permitted_action',
          'stop_conditions'
        ],
        compatibility_shapes: [
          ['### Task log', 'Timestamp:', 'Task / Issue:', 'Phase:', 'Executing role:', '**Target:**', '**Objective:**', '**Links:**', '**Next:**']
        ],
        required_sections: [],
        allowed_verdicts: []
      },
      RESULT: {
        required_heading: '## RESULT',
        required_bindings: [
          'issue_number',
          'executing_role',
          'branch',
          'exact_head_when_code',
          'pr_binding_when_applicable',
          'predecessor_evidence_when_correction'
        ],
        compatibility_shapes: [
          ['### Task log', 'Timestamp:', 'Task / Issue:', 'Phase:', 'Executing role:', '**Completed:**', '**Summary:**', '**Next:**'],
          ['### Task log', 'Timestamp:', 'Task / Issue:', 'Phase:', 'Executing role:', '**Role / phase completed:**', '### Summary', '### Files or artifacts changed', '### Commands run', '### Next handoff'],
          ['**Profile:**', '**Task:**', '**PR:**', '**Completed:**', '**Evidence:**', '**AC audit:**', '**Risks / escalation:**', '**Next:**'],
          ['### Task log', 'Task / Issue:', 'Executing role:', 'Branch:', 'Head:', 'PR:', '### Summary', '### Evidence', 'Commands:', 'Tests:', 'CI:', '### Acceptance criteria', '### Risks / blockers', '### Next permitted action']
        ],
        required_sections: [
          'Task log',
          'Summary',
          'Evidence',
          'Acceptance criteria',
          'Risks / blockers',
          'Next permitted action'
        ],
        allowed_verdicts: []
      },
      REVIEW_VERDICT: {
        required_heading: '## REVIEW_VERDICT',
        required_bindings: [
          'issue_number',
          'pr_number',
          'exact_reviewed_head',
          'policy_sha_when_required',
          'review_type',
          'review_cycle',
          'reviewer_identity',
          'predecessor_evidence_when_correction'
        ],
        compatibility_shapes: [
          ['### Task log', 'Timestamp:', 'Task / Issue:', 'Phase:', 'Executing role:', '**PR / base / head:**', '**Verdict:**', '**Findings:**', '**Gates:**', '**Next:**'],
          ['### Task log', 'Timestamp:', 'Task / Issue:', 'Phase:', 'Executing role:', '**Reviewed PR:**', '**Approved base:**', '**Exact head reviewed:**', '**Verdict:**', '### Critical / Important findings summary', '### Gate status', '### Next handoff']
        ],
        required_sections: [
          'Review identity',
          'Immutable finding disposition',
          'Critical findings',
          'Important findings',
          'Minor / Nit findings',
          'Evidence',
          'Exact next permitted action'
        ],
        allowed_verdicts: [
          'CORRECTION REQUIRED',
          'ELIGIBLE FOR FOUNDER REVIEW',
          'BLOCKED FOR FOUNDER DECISION',
          'BLOCKED EXTERNAL',
          'STATE CONFLICT'
        ],
        correction_contract: {
          condition: 'Verdict is CORRECTION REQUIRED or BLOCKED FOR FOUNDER DECISION with unresolved implementation findings',
          placement: 'Must be provided as a markdown fenced JSON block anywhere in the comment body.',
          representation: 'fenced_json_block',
          schema_version: 1,
          modes: ['implementation_pr', 'planning_no_pr'],
          required_keys: ['schema_version', 'reviewed_head', 'findings'],
          optional_keys: ['mode'],
          finding_id_requirements: 'Must be a non-empty string and unique after whitespace normalization.',
          reviewed_head_binding: 'Must be a non-empty string matching the exact PR head or base SHA being reviewed.',
          evidence_requirements: 'Finding required_evidence must be a non-empty array of non-empty strings.',
          multiplicity: 'Exactly one Correction Contract JSON block is permitted per role comment.',
          invalid_combinations: ['Multiple JSON blocks', 'planning_no_pr mode without expected_areas', 'Duplicate finding IDs'],
          finding_schema: {
            required_keys: ['id', 'canonical_summary', 'source_thread', 'required_evidence'],
            optional_keys: ['expected_areas', 'prohibited_areas']
          },
          canonical_example: "```json\n{\n  \"schema_version\": 1,\n  \"mode\": \"implementation_pr\",\n  \"reviewed_head\": \"1234567890abcdef1234567890abcdef12345678\",\n  \"findings\": [\n    {\n      \"id\": \"EXAMPLE-001\",\n      \"canonical_summary\": \"Fix the thing\",\n      \"source_thread\": \"https://github.com/...\",\n      \"required_evidence\": [\"Test output\"]\n    }\n  ]\n}\n```"
        }
      }
    },
    next_action_rules: [
      {
        classification: 'SUCCESS',
        next_action: nextAction('COMPLETE', null, 'The role comment operation completed without owning a state transition.'),
      },
      {
        classification: 'NO_OP_IDENTICAL_RETRY',
        next_action: nextAction('COMPLETE', null, 'The identical validated role comment is already authoritative.'),
      },
    ],
    examples: [
      {
        description: 'Validate a role comment before a transport posts it.',
        argv: ['284', '--repo', 'boat1994/bemoat-web-starter', '--body-file', './comment.md', '--check'],
      },
      {
        description: 'Publish a HANDOFF comment.',
        argv: ['284', '--body-file', './handoff.md'],
      },
      {
        description: 'Publish a RESULT comment.',
        argv: ['284', '--body-file', './result.md'],
      },
      {
        description: 'Publish a REVIEW_VERDICT comment.',
        argv: ['284', '--body-file', './review.md'],
      }
    ],
    parser_owner: 'scripts/post-role-comment.mjs',
    safe_help_invocation: 'pnpm run bemoat:issue:comment -- --help --json',
    last_validation_before_mutation: 'Validate the role body, Issue binding, and correction evidence immediately before posting.',
    post_write_readback: 'Verify mutation via returned comment ID; if absent or unpropagated, retry readback with bounded delay before asserting AMBIGUOUS_RESULT: POSTED.',
    legacy_classification_map: {
      POSTED: 'SUCCESS',
      NO_OP: 'NO_OP_IDENTICAL_RETRY',
    },
  }),

  'bemoat:mission-control:dispatch': contract({
    command: 'bemoat:mission-control:dispatch',
    tier: 'A',
    entrypoint: 'scripts/mission-control-dispatch.mjs',
    purpose: 'Claim the next Mission Control delivery or authorized correction.',
    operation: 'Validate HANDOFF evidence and project one leased dispatch transition.',
    accepted_pre_states: ['READY', 'FOUNDER_AUTHORIZED_CORRECTION'],
    required_inputs: [
      positional('issue_number', '<issue-number>', 'positive_integer', 'Managed Task Issue number.'),
      stdinInput('handoff_body', 'Canonical HANDOFF body when --body-file is not used.'),
    ],
    optional_flags: [
      flag('repository', '--repo <owner/repository>', 'repository', 'Repository containing the Task Issue.'),
      flag('body_file', '--body-file <path>', 'path', 'Read the HANDOFF body from this file instead of stdin.'),
      flag('founder_correction', '--founder-correction', 'boolean', 'Consume the exact Founder correction authorization route.'),
      flag('workflow_mode', '--workflow-mode <mode>', 'enum', 'Explicit workflow mode.', ['planning_no_pr', 'implementation_pr']),
      flag('planning_base_sha', '--planning-base-sha <full-sha>', 'full_sha', 'Exact planning authorization base SHA.'),
    ],
    trusted_derived_values: ['workflow identity', 'repository-owned policy version and source SHA', 'branch reservation evidence'],
    required_evidence: [
      'Task Issue state and active-task identity.',
      'Canonical HANDOFF evidence and immutable transition identity.',
      'Workflow mode and planning lineage when applicable.',
      'Branch reservation evidence for the selected operation.',
    ],
    reads: ['Issue/state/comments/PR', 'HANDOFF body', 'branch reservation evidence'],
    writes: ['HANDOFF comment', 'leased/CAS Issue state', 'temporary reservation ref with cleanup'],
    success_classifications: ['SUCCESS', 'NO_OP_IDENTICAL_RETRY'],
    retry_contract: {
      identical_retry: 'conditional',
      classification: 'NO_OP_IDENTICAL_RETRY',
      condition: 'An identical retry is allowed only when the same HANDOFF transition identity is already projected.',
    },
    next_action_rules: [
      {
        classification: 'SUCCESS',
        next_action: nextAction('COMMAND', 'bemoat:agent:delivery', 'The dispatch claim is ready for one delivery RESULT.'),
      },
      {
        classification: 'NO_OP_IDENTICAL_RETRY',
        next_action: nextAction('COMPLETE', null, 'The identical dispatch claim is already durable.'),
      },
    ],
    examples: [
      {
        description: 'Dispatch a canonical HANDOFF.',
        argv: ['284', '--repo', 'boat1994/bemoat-web-starter', '--body-file', './handoff.md'],
      },
    ],
    parser_owner: 'scripts/mission-control-dispatch.mjs',
    safe_help_invocation: 'pnpm run bemoat:mission-control:dispatch -- --help --json',
    last_validation_before_mutation: 'Re-read the Task Issue, HANDOFF evidence, policy lineage, and branch reservation immediately before the leased/CAS write.',
    post_write_readback: 'Re-read the Issue, comments, and reservation cleanup state and confirm the projected dispatch identity.',
    legacy_classification_map: {
      DISPATCHED: 'SUCCESS',
      DISPATCHED_FOUNDER_AUTHORIZED_CORRECTION: 'SUCCESS',
      NO_OP: 'NO_OP_IDENTICAL_RETRY',
    },
  }),

  'bemoat:mission-control:merge': contract({
    command: 'bemoat:mission-control:merge',
    tier: 'A',
    entrypoint: 'scripts/mission-control-merge.mjs',
    purpose: 'Execute an existing Founder-authorized merge completion bundle.',
    operation: 'Verify reviewed head, authorization, checks, merge, and terminal projections.',
    accepted_pre_states: ['ELIGIBLE_FOR_FOUNDER_REVIEW', 'DONE'],
    required_inputs: [
      positional('issue_number', '<issue-number>', 'positive_integer', 'Managed Task Issue number.'),
      flag('repository', '--repo <owner/repository>', 'repository', 'Repository containing the Task Issue.', [], true),
      flag('authorization_comment', '--authorization-comment <id>', 'positive_integer', 'Immutable Founder merge authorization comment.', [], true),
    ],
    trusted_derived_values: ['live PR/base/head/check evidence', 'Founder identity configuration', 'campaign projection evidence'],
    required_evidence: [
      'Founder merge authorization bound to the reviewed head.',
      'Exact PR/base/check and protected-head evidence.',
      'Task Issue and campaign completion projections.',
    ],
    reads: ['Founder authorization', 'Task/PR/comments/checks/base/policy/campaign'],
    writes: ['ready/merge state', 'terminal RESULT comment', 'Issue close/state', 'campaign projection'],
    success_classifications: ['SUCCESS', 'NO_OP_IDENTICAL_RETRY'],
    retry_contract: {
      identical_retry: 'conditional',
      classification: 'NO_OP_IDENTICAL_RETRY',
      condition: 'A DONE task with the exact verified merge-completion bundle returns NO_OP_IDENTICAL_RETRY and performs no new mutation.',
    },
    next_action_rules: [
      {
        classification: 'SUCCESS',
        next_action: nextAction('COMPLETE', null, 'The Founder-authorized merge completion bundle is durable.'),
      },
      {
        classification: 'NO_OP_IDENTICAL_RETRY',
        next_action: nextAction('COMPLETE', null, 'The identical merge completion is already durable.'),
      },
    ],
    examples: [
      {
        description: 'Execute a Founder-authorized merge.',
        argv: ['284', '--repo', 'boat1994/bemoat-web-starter', '--authorization-comment', '12345'],
      },
    ],
    parser_owner: 'scripts/mission-control-merge.mjs',
    safe_help_invocation: 'pnpm run bemoat:mission-control:merge -- --help --json',
    last_validation_before_mutation: 'Re-read authorization, reviewed head, protected base, checks, Task state, and campaign evidence immediately before merge/CAS operations.',
    post_write_readback: 'Re-read PR, Task Issue, comments, and campaign projection and confirm the complete DONE bundle.',
    legacy_classification_map: {
      DONE: 'SUCCESS',
      NO_OP: 'NO_OP_IDENTICAL_RETRY',
    },
  }),

  'bemoat:mission-control:reconcile': contract({
    command: 'bemoat:mission-control:reconcile',
    tier: 'A',
    entrypoint: 'scripts/mission-control-reconcile.mjs',
    purpose: 'Repair routing-only Mission Control projection drift.',
    operation: 'Classify authoritative evidence and apply only a leased/CAS routing projection repair.',
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
      DETERMINISTIC_MIGRATION: 'SUCCESS',
      BOOKKEEPING_REPAIR: 'SUCCESS',
      TERMINAL_REPAIR: 'SUCCESS',
      DISPATCHED: 'SUCCESS',
      REVIEWED: 'SUCCESS',
      RECOVERABLE_ROUTING_DRIFT: 'AMBIGUOUS_RESULT',
      NO_OP: 'NO_OP_IDENTICAL_RETRY',
    },
  }),

  'bemoat:mission-control:recover-review': contract({
    command: 'bemoat:mission-control:recover-review',
    tier: 'A',
    entrypoint: 'scripts/mission-control-recover-review.mjs',
    purpose: 'Quarantine only the exact approved #274/#275 raw-review incident.',
    operation: 'Verify the pinned incident tuple and project its proven Review 2 result.',
    accepted_pre_states: ['AWAITING_REVIEW_2'],
    required_inputs: [
      positional('issue_number', '<issue-number>', 'positive_integer', 'Quarantined incident Task Issue number.'),
      flag('repository', '--repo <owner/repository>', 'repository', 'Exact starter repository.', [], true),
      flag('expected_pr', '--expected-pr <number>', 'positive_integer', 'Exact incident Pull Request number.', [], true),
      flag('expected_base', '--expected-base <branch>', 'string', 'Exact protected base branch.', [], true),
      flag('expected_state', '--expected-state <state>', 'enum', 'Expected incident managed state.', ['AWAITING_REVIEW_2'], true),
      flag('expected_head', '--expected-head <full-sha>', 'full_sha', 'Exact incident PR head.', [], true),
      flag('expected_review_cycle', '--expected-review-cycle <number>', 'positive_integer', 'Expected managed review cycle.', [], true),
      flag('expected_full_review_count', '--expected-full-review-count <number>', 'positive_integer', 'Expected full-review count.', [], true),
      flag('review_type', '--review-type <type>', 'enum', 'Exact recovery review type.', ['delta'], true),
      flag('issue_source_comment', '--issue-source-comment <id>', 'positive_integer', 'Pinned Task Issue source comment.', [], true),
      flag('pr_source_comment', '--pr-source-comment <id>', 'positive_integer', 'Pinned PR source comment.', [], true),
      flag('original_review_comment', '--original-review-comment <id>', 'positive_integer', 'Pinned original review comment.', [], true),
      flag('correction_result_comment', '--correction-result-comment <id>', 'positive_integer', 'Pinned correction RESULT comment.', [], true),
      flag('body_file', '--body-file <path>', 'path', 'Read recovery review body from this file.', [], true),
    ],
    required_evidence: [
      'Pinned #274/#275 repository, Issue, PR, base, state, head, and comment tuple.',
      'Executing checkout and policy identity.',
      'Quarantined raw-review evidence with no ordinary-review ownership.',
    ],
    reads: ['pinned policy/source/checkout', 'Task/PR/comments/checks'],
    writes: ['one quarantined REVIEW_VERDICT comment', 'leased/CAS state projection'],
    success_classifications: ['SUCCESS', 'NO_OP_IDENTICAL_RETRY'],
    retry_contract: {
      identical_retry: 'conditional',
      classification: 'NO_OP_IDENTICAL_RETRY',
      condition: 'A retry is identical only when the same quarantined recovery evidence and projection are already durable.',
    },
    next_action_rules: [
      {
        classification: 'SUCCESS',
        next_action: nextAction('COMPLETE', null, 'The exact incident recovery projection is verified.'),
      },
      {
        classification: 'NO_OP_IDENTICAL_RETRY',
        next_action: nextAction('COMPLETE', null, 'The exact incident recovery projection is already durable.'),
      },
    ],
    examples: [
      {
        description: 'Run the quarantined incident recovery route.',
        argv: [
          '274',
          '--repo',
          'boat1994/bemoat-web-starter',
          '--expected-pr',
          '275',
          '--expected-base',
          'main',
          '--expected-state',
          'AWAITING_REVIEW_2',
          '--expected-head',
          '<full-sha>',
          '--expected-review-cycle',
          '1',
          '--expected-full-review-count',
          '1',
          '--review-type',
          'delta',
          '--issue-source-comment',
          '<task-issue-comment-id>',
          '--pr-source-comment',
          '<pr-source-comment-id>',
          '--original-review-comment',
          '<original-review-comment-id>',
          '--correction-result-comment',
          '<correction-result-comment-id>',
          '--body-file',
          './review.md',
        ],
      },
    ],
    parser_owner: 'scripts/mission-control/workflows/recover-review.mjs',
    safe_help_invocation: 'pnpm run bemoat:mission-control:recover-review -- --help --json',
    last_validation_before_mutation: 'Verify the complete pinned #274/#275 tuple and quarantine boundary immediately before the state/comment writes.',
    post_write_readback: 'Re-read the quarantined comment and managed state and confirm no ordinary REVIEW_VERDICT path was used.',
    legacy_classification_map: {
      RECOVERED: 'SUCCESS',
      RECOVERABLE_ROUTING_DRIFT: 'AMBIGUOUS_RESULT',
      NO_OP: 'NO_OP_IDENTICAL_RETRY',
    },
  }),

  'bemoat:mission-control:reopen': contract({
    command: 'bemoat:mission-control:reopen',
    tier: 'A',
    entrypoint: 'scripts/mission-control-reopen.mjs',
    purpose: 'Project the exact Founder-authorized #285 reopen correction route.',
    operation: 'Verify old/new heads and Founder authorization, then project bounded correction state.',
    accepted_pre_states: ['ELIGIBLE_FOR_FOUNDER_REVIEW'],
    required_inputs: [
      positional('issue_number', '<issue-number>', 'positive_integer', 'Managed Task Issue number.'),
      flag('repository', '--repo <owner/repository>', 'repository', 'Repository containing the Task Issue.', [], true),
      flag('expected_pr', '--expected-pr <number>', 'positive_integer', 'Exact active Pull Request number.', [], true),
      flag('expected_base', '--expected-base <branch>', 'string', 'Approved Pull Request base branch.', [], true),
      flag('expected_state', '--expected-state <state>', 'enum', 'Must be ELIGIBLE_FOR_FOUNDER_REVIEW.', ['ELIGIBLE_FOR_FOUNDER_REVIEW'], true),
      flag('expected_old_head', '--expected-old-head <full-sha>', 'full_sha', 'Immutable Review 1 head.', [], true),
      flag('expected_new_head', '--expected-new-head <full-sha>', 'full_sha', 'Founder-authorized live correction head.', [], true),
      flag('expected_review_cycle', '--expected-review-cycle <number>', 'positive_integer', 'Existing review cycle; do not increment.', [], true),
      flag('expected_full_review_count', '--expected-full-review-count <number>', 'positive_integer', 'Existing full-review count; do not reset.', [], true),
      flag('authorization_comment', '--authorization-comment <id>', 'positive_integer', 'Immutable Founder authorization comment.', [], true),
    ],
    trusted_derived_values: ['Founder identity configuration', 'live Task/PR/policy/head evidence', 'lease/CAS holder identity'],
    required_evidence: [
      'Founder authorization bound to the complete repository/Task/PR/base tuple.',
      'Old reviewed head and new authorized head are distinct full SHAs.',
      'Review counters and original RESULT/REVIEW_VERDICT identities.',
    ],
    reads: ['Founder authorization', 'Task/PR/comments/policy/head'],
    writes: ['state projection to FOUNDER_AUTHORIZED_CORRECTION'],
    success_classifications: ['SUCCESS', 'NO_OP_IDENTICAL_RETRY'],
    retry_contract: {
      identical_retry: 'conditional',
      classification: 'NO_OP_IDENTICAL_RETRY',
      condition: 'A retry is NO_OP_IDENTICAL_RETRY only when the exact old/new-head authorization projection is already FOUNDER_AUTHORIZED_CORRECTION.',
    },
    next_action_rules: [
      {
        classification: 'SUCCESS',
        next_action: nextAction('COMMAND', 'bemoat:agent:delivery', 'The bounded correction delivery is the only next mutation.'),
      },
      {
        classification: 'NO_OP_IDENTICAL_RETRY',
        next_action: nextAction('COMPLETE', null, 'The exact Founder-authorized reopen projection is already durable.'),
      },
    ],
    examples: [
      {
        description: 'Reopen one Founder-authorized correction head.',
        argv: [
          '284',
          '--repo',
          'boat1994/bemoat-web-starter',
          '--expected-pr',
          '285',
          '--expected-state',
          'ELIGIBLE_FOR_FOUNDER_REVIEW',
          '--expected-old-head',
          '<review-1-sha>',
          '--expected-new-head',
          '<correction-sha>',
          '--expected-review-cycle',
          '1',
          '--expected-full-review-count',
          '1',
          '--authorization-comment',
          '12345',
        ],
      },
    ],
    parser_owner: 'scripts/mission-control/workflows/reopen.mjs',
    safe_help_invocation: 'pnpm run bemoat:mission-control:reopen -- --help --json',
    last_validation_before_mutation: 'Re-read the live Issue/PR, exact old/new heads, policy, counters, and immutable Founder authorization immediately before the lease/CAS write.',
    post_write_readback: 'Re-read the Issue/PR/comments and verify FOUNDER_AUTHORIZED_CORRECTION, preserved old head/counters, and the complete authorization record.',
    legacy_classification_map: {
      REOPENED: 'SUCCESS',
      NO_OP: 'NO_OP_IDENTICAL_RETRY',
    },
  }),

  'bemoat:mission-control:review': contract({
    command: 'bemoat:mission-control:review',
    tier: 'A',
    entrypoint: 'scripts/mission-control-review.mjs',
    purpose: 'Publish one ordinary Full or Delta Review verdict.',
    operation: 'Validate review evidence and project a leased/CAS REVIEW_VERDICT transition.',
    accepted_pre_states: ['AWAITING_REVIEW_1', 'AWAITING_REVIEW_2', 'AWAITING_REVIEW_3'],
    required_inputs: [
      positional('issue_number', '<issue-number>', 'positive_integer', 'Managed Task Issue number.'),
      flag('body_file', '--body-file <path>', 'path', 'Read the review body from this file.', [], true),
      flag('expected_state', '--expected-state <state>', 'enum', 'Expected managed review state.', ['AWAITING_REVIEW_1', 'AWAITING_REVIEW_2', 'AWAITING_REVIEW_3'], true),
      flag('review_type', '--review-type <type>', 'enum', 'Full or Delta review.', ['full', 'delta'], true),
      flag('expected_head', '--expected-head <full-sha>', 'full_sha', 'Exact reviewed PR head.', [], true),
    ],
    optional_flags: [
      flag('repository', '--repo <owner/repository>', 'repository', 'Repository containing the Task Issue.'),
    ],
    trusted_derived_values: ['reviewer identity', 'live Task/PR/comment/check evidence', 'lease/CAS holder identity'],
    required_evidence: [
      'Canonical verdict body and review type.',
      'Exact PR/base/head/check evidence.',
      'Current managed state and review counters.',
    ],
    reads: ['verdict body', 'Task/PR/comments/checks'],
    writes: ['REVIEW_VERDICT comment', 'leased/CAS Issue state and counters'],
    success_classifications: ['SUCCESS', 'NO_OP_IDENTICAL_RETRY'],
    retry_contract: {
      identical_retry: 'conditional',
      classification: 'NO_OP_IDENTICAL_RETRY',
      condition: 'An identical retry is allowed only when the same review identity and exact head are already projected.',
    },
    next_action_rules: [
      {
        classification: 'SUCCESS',
        next_action: nextAction('COMMAND', 'bemoat:mission-control:dispatch', 'The resulting review state determines the next bounded dispatch or Founder gate.'),
      },
      {
        classification: 'NO_OP_IDENTICAL_RETRY',
        next_action: nextAction('COMPLETE', null, 'The identical review verdict is already durable.'),
      },
    ],
    examples: [
      {
        description: 'Publish a full review verdict.',
        argv: ['284', '--body-file', './review.md', '--expected-state', 'AWAITING_REVIEW_1', '--review-type', 'full', '--expected-head', '<full-sha>'],
      },
    ],
    parser_owner: 'scripts/mission-control-review.mjs',
    safe_help_invocation: 'pnpm run bemoat:mission-control:review -- --help --json',
    last_validation_before_mutation: 'Re-read the verdict, current state/counters, exact PR head, and live comment evidence immediately before the lease/CAS write.',
    post_write_readback: 'Re-read the REVIEW_VERDICT comment and managed state and confirm the exact review identity, counters, and resulting state.',
    legacy_classification_map: {
      REVIEWED: 'SUCCESS',
      RECOVERABLE_ROUTING_DRIFT: 'AMBIGUOUS_RESULT',
      NO_OP: 'NO_OP_IDENTICAL_RETRY',
    },
  }),

  'bemoat:mission-control:task-bootstrap': contract({
    command: 'bemoat:mission-control:task-bootstrap',
    tier: 'A',
    entrypoint: 'scripts/mission-control-task-create.mjs',
    purpose: 'Create and attest a Mission Control Task Issue from Founder authorization.',
    operation: 'Verify signed Actions identity and project the initial Task state and campaign link.',
    accepted_pre_states: ['NOT_STATEFUL'],
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
    trusted_derived_values: [
      'Actions-derived workflow identity',
      'trusted-derived protected public key',
      'GitHub-derived campaign and Pull Request evidence',
    ],
    required_evidence: [
      'Founder-authorized signed authorization.',
      'Actions-derived trusted GitHub workflow identity and public key.',
      'GitHub-derived campaign/PR evidence for the Task bootstrap.',
    ],
    reads: ['signed authorization', 'workflow identity', 'public key', 'GitHub campaign/PR'],
    writes: ['Task Issue creation/state/attestation', 'campaign projection'],
    retry_contract: {
      identical_retry: 'conditional',
      classification: 'NO_OP_IDENTICAL_RETRY',
      condition: 'A retry is identical only when the same authorization fingerprint and Task projection already exist.',
    },
    role_contracts: {
      FOUNDER_AUTHORIZATION: {
        required_bindings: [
          'schema_version',
          'status',
          'authority',
          'author_login',
          'comment_id',
          'immutable_comment_reference',
          'non_superseded',
          'superseded_by',
          'repository',
          'bundle_kind',
          'parent_issue',
          'pr',
          'exact_head',
          'reviewed_head',
          'base',
          'policy_source',
          'policy_source_sha',
          'protected_base_sha',
          'policy_version',
          'scope',
          'action'
        ],
        representation: 'raw_json_object',
        identity_requirements: 'Must be authored by a trusted Founder login.',
        scope_binding: 'task-initialization',
        action_binding: 'create-managed-task',
        canonical_example: `{
  "schema_version": 1,
  "status": "approved",
  "authority": "Founder",
  "author_login": "boat1994",
  "comment_id": "12345",
  "immutable_comment_reference": true,
  "non_superseded": true,
  "superseded_by": null,
  "repository": "boat1994/bemoat-web-starter",
  "bundle_kind": "task-bootstrap-genesis",
  "parent_issue": 262,
  "task_issue": null,
  "pr": 263,
  "exact_head": "d5f0d1edf86f0c0f94a4891558ae6fcea7bfb73f",
  "reviewed_head": "d5f0d1edf86f0c0f94a4891558ae6fcea7bfb73f",
  "base": "main",
  "policy_source": "docs/mission-control/mission-control-guide.md",
  "policy_source_sha": "f46f5de1d5ee17669c7c4663893164ffb835b339",
  "protected_base_sha": "f6ac355b98aa281dda2a49bcf2ddaeb279d8173d",
  "policy_version": "1.3.0",
  "scope": "task-initialization",
  "action": "create-managed-task",
  "comment_sha256": "..."
}`
      }
    },
    next_action_rules: [
      {
        classification: 'SUCCESS',
        next_action: nextAction('COMMAND', 'bemoat:mission-control:dispatch', 'The bootstrapped Task is ready for HANDOFF dispatch.'),
      },
      {
        classification: 'NO_OP_IDENTICAL_RETRY',
        next_action: nextAction('COMPLETE', null, 'The identical Task bootstrap is already durable.'),
      },
    ],
    examples: [{ description: 'Bootstrap from a Founder authorization comment.', argv: ['--founder-authorization-comment-id', '12345'] }],
    parser_owner: 'scripts/mission-control-task-create.mjs',
    safe_help_invocation: 'pnpm run bemoat:mission-control:task-bootstrap -- --help --json',
    last_validation_before_mutation: 'Re-verify signed authorization, Actions identity, public key, and campaign/PR evidence immediately before Task creation.',
    post_write_readback: 'Read the created Task Issue, attestation, and campaign projection and confirm the exact authorization fingerprint.',
    legacy_classification_map: {
      CREATED: 'SUCCESS',
      RECOVERED: 'SUCCESS',
      IDEMPOTENT: 'NO_OP_IDENTICAL_RETRY',
    },
  }),

  'bemoat:test:int': contract({
    command: 'bemoat:test:int',
    tier: 'C',
    entrypoint: 'package.json',
    purpose: 'Run the registered integration-test pipeline.',
    operation: 'Delegate directly to Vitest without adding a repository parser.',
    reads: ['source, test, and Vitest configuration files'],
    writes: [],
    parser_owner: null,
    delegated_executable: 'cross-env NODE_OPTIONS=--no-deprecation vitest run --config ./vitest.config.mts',
    help_meaningful: false,
    safe_help_invocation: 'pnpm exec vitest --help',
    exclusion_reason: 'Tier C is a third-party test wrapper; Vitest owns its argument parser and this package command adds none.',
  }),

  'bemoat:typecheck': contract({
    command: 'bemoat:typecheck',
    tier: 'C',
    entrypoint: 'scripts/bemoat-typecheck.mjs',
    purpose: 'Run the registered TypeScript validation wrapper.',
    operation: 'Delegate to the toolchain contract and tsc without consuming command arguments.',
    reads: ['toolchain contract and TypeScript projects'],
    writes: [],
    parser_owner: null,
    delegated_executable: 'node scripts/bemoat-typecheck.mjs',
    help_meaningful: false,
    safe_help_invocation: 'pnpm exec tsc --help',
    exclusion_reason: 'Tier C is a bounded toolchain wrapper, not a repository parser; tsc owns its arguments and the wrapper performs no mutation or network operation.',
  }),
}

function route({
  route_key,
  observed_state,
  evidence_case,
  required_evidence_condition,
  forbidden_evidence_condition,
  permitted_operation,
  canonical_command,
  required_review_type,
  expected_post_state_or_gate,
  prohibited_commands = [],
  decision,
  stop_condition = null,
}) {
  return {
    route_key,
    observed_state,
    evidence_case,
    required_evidence_condition,
    forbidden_evidence_condition,
    permitted_operation,
    canonical_command,
    required_review_type,
    expected_post_state_or_gate,
    prohibited_commands,
    decision,
    stop_condition,
  }
}

/** @type {RouteRow[]} */
const routes = [
  route({
    route_key: 'no-task/exact-task-bootstrap-founder-authorization-workflow-tuple',
    observed_state: null,
    evidence_case: 'exact-task-bootstrap-founder-authorization-workflow-tuple',
    required_evidence_condition: 'Signed Founder authorization, trusted Actions workflow identity, public key, and campaign/PR tuple are complete.',
    forbidden_evidence_condition: 'Any missing, stale, competing, or conflicting bootstrap identity/evidence.',
    permitted_operation: 'Create and attest the Task Issue.',
    canonical_command: 'bemoat:mission-control:task-bootstrap',
    required_review_type: null,
    expected_post_state_or_gate: 'READY',
    decision: 'COMMAND',
  }),
  route({
    route_key: 'READY/valid-handoff-inputs',
    observed_state: 'READY',
    evidence_case: 'valid-handoff-inputs',
    required_evidence_condition: 'One canonical HANDOFF binds the Task, workflow mode, and required planning/implementation lineage.',
    forbidden_evidence_condition: 'Duplicate, stale, competing, or malformed HANDOFF evidence.',
    permitted_operation: 'Claim the delivery or approved correction dispatch.',
    canonical_command: 'bemoat:mission-control:dispatch',
    required_review_type: null,
    expected_post_state_or_gate: 'IN_PROGRESS or FOUNDER_AUTHORIZED_CORRECTION',
    decision: 'COMMAND',
  }),
  route({
    route_key: 'IN_PROGRESS/complete-exact-head-delivery-evidence',
    observed_state: 'IN_PROGRESS',
    evidence_case: 'complete-exact-head-delivery-evidence',
    required_evidence_condition: 'Local/remote/PR/CI exact-head evidence and one canonical RESULT are complete.',
    forbidden_evidence_condition: 'Head drift, missing CI, competing RESULT, or incomplete readback evidence.',
    permitted_operation: 'Deliver one bounded RESULT.',
    canonical_command: 'bemoat:agent:delivery',
    required_review_type: null,
    expected_post_state_or_gate: 'AWAITING_REVIEW_1',
    decision: 'COMMAND',
  }),
  route({
    route_key: 'AWAITING_REVIEW_1/exact-full-review-evidence',
    observed_state: 'AWAITING_REVIEW_1',
    evidence_case: 'exact-full-review-evidence',
    required_evidence_condition: 'Exact full-review body, reviewer identity, PR/base/head/check, and Task lineage are complete.',
    forbidden_evidence_condition: 'Delta review, stale head, duplicate verdict, or competing review evidence.',
    permitted_operation: 'Publish one ordinary Full Review.',
    canonical_command: 'bemoat:mission-control:review',
    required_review_type: 'full',
    expected_post_state_or_gate: 'CORRECTION_REQUIRED_1, ELIGIBLE_FOR_FOUNDER_REVIEW, or a blocking gate',
    decision: 'COMMAND',
  }),
  route({
    route_key: 'CORRECTION_REQUIRED_1/bounded-correction-result-evidence',
    observed_state: 'CORRECTION_REQUIRED_1',
    evidence_case: 'bounded-correction-result-evidence',
    required_evidence_condition: 'The bounded correction scope and exact correction RESULT are complete.',
    forbidden_evidence_condition: 'Unbounded changes, stale head, duplicate RESULT, or missing correction authorization.',
    permitted_operation: 'Deliver one bounded correction RESULT.',
    canonical_command: 'bemoat:agent:delivery',
    required_review_type: null,
    expected_post_state_or_gate: 'AWAITING_REVIEW_2',
    decision: 'COMMAND',
  }),
  route({
    route_key: 'AWAITING_REVIEW_2/exact-delta-review-evidence',
    observed_state: 'AWAITING_REVIEW_2',
    evidence_case: 'exact-delta-review-evidence',
    required_evidence_condition: 'Exact Delta Review body, finding dispositions, reviewed head, and Task lineage are complete.',
    forbidden_evidence_condition: 'Full review on a delta route, stale head, duplicate verdict, or competing evidence.',
    permitted_operation: 'Publish one ordinary Delta Review.',
    canonical_command: 'bemoat:mission-control:review',
    required_review_type: 'delta',
    expected_post_state_or_gate: 'CORRECTION_REQUIRED_2, ELIGIBLE_FOR_FOUNDER_REVIEW, or a blocking gate',
    decision: 'COMMAND',
  }),
  route({
    route_key: 'CORRECTION_REQUIRED_2/bounded-correction-result-evidence',
    observed_state: 'CORRECTION_REQUIRED_2',
    evidence_case: 'bounded-correction-result-evidence',
    required_evidence_condition: 'The second bounded correction scope and exact correction RESULT are complete.',
    forbidden_evidence_condition: 'Unbounded changes, stale head, duplicate RESULT, or missing correction authorization.',
    permitted_operation: 'Deliver one bounded correction RESULT.',
    canonical_command: 'bemoat:agent:delivery',
    required_review_type: null,
    expected_post_state_or_gate: 'AWAITING_REVIEW_3',
    decision: 'COMMAND',
  }),
  route({
    route_key: 'AWAITING_REVIEW_3/exact-bounded-delta-review-evidence',
    observed_state: 'AWAITING_REVIEW_3',
    evidence_case: 'exact-bounded-delta-review-evidence',
    required_evidence_condition: 'Exact bounded Delta Review evidence and required finding verification are complete.',
    forbidden_evidence_condition: 'Full review, stale head, duplicate verdict, or competing evidence.',
    permitted_operation: 'Publish the bounded Delta Review.',
    canonical_command: 'bemoat:mission-control:review',
    required_review_type: 'delta',
    expected_post_state_or_gate: 'ELIGIBLE_FOR_FOUNDER_REVIEW or a blocking gate',
    decision: 'COMMAND',
  }),
  route({
    route_key: 'AWAITING_REVIEW_3/exact-blocker-verification-evidence',
    observed_state: 'AWAITING_REVIEW_3',
    evidence_case: 'exact-blocker-verification-evidence',
    required_evidence_condition: 'The exact bounded blocker-verification evidence is complete.',
    forbidden_evidence_condition: 'Unrelated review, stale head, duplicate verdict, or competing evidence.',
    permitted_operation: 'Publish the bounded blocker-verification Delta Review.',
    canonical_command: 'bemoat:mission-control:review',
    required_review_type: 'blocker-verification',
    expected_post_state_or_gate: 'ELIGIBLE_FOR_FOUNDER_REVIEW or BLOCKED_FOR_FOUNDER_DECISION',
    decision: 'COMMAND',
  }),
  route({
    route_key: 'FOUNDER_AUTHORIZED_CORRECTION/unconsumed-exact-authorization',
    observed_state: 'FOUNDER_AUTHORIZED_CORRECTION',
    evidence_case: 'unconsumed-exact-authorization',
    required_evidence_condition: 'One unconsumed exact Founder correction authorization binds the current head and bounded scope.',
    forbidden_evidence_condition: 'Consumed, superseded, competing, or head-drifted authorization.',
    permitted_operation: 'Dispatch the Founder-authorized correction.',
    canonical_command: 'bemoat:mission-control:dispatch',
    required_review_type: null,
    expected_post_state_or_gate: 'IN_PROGRESS',
    prohibited_commands: ['bemoat:mission-control:merge', 'bemoat:mission-control:reopen'],
    decision: 'COMMAND',
  }),
  route({
    route_key: 'BLOCKED_FOR_FOUNDER_DECISION/missing-named-authorization',
    observed_state: 'BLOCKED_FOR_FOUNDER_DECISION',
    evidence_case: 'missing-named-authorization',
    required_evidence_condition: 'The blocking evidence is present but the exact named Founder authorization is absent.',
    forbidden_evidence_condition: 'Any agent-mutation authorization or competing authority.',
    permitted_operation: null,
    canonical_command: null,
    required_review_type: null,
    expected_post_state_or_gate: 'FOUNDER_GATE — no agent mutation',
    prohibited_commands: ALL_MUTATING_COMMANDS,
    decision: 'FOUNDER_GATE',
    stop_condition: 'Wait for the exact named Founder authorization; no agent mutation is permitted.',
  }),
  route({
    route_key: 'ELIGIBLE_FOR_FOUNDER_REVIEW/missing-merge-authorization',
    observed_state: 'ELIGIBLE_FOR_FOUNDER_REVIEW',
    evidence_case: 'missing-merge-authorization',
    required_evidence_condition: 'An eligible review result is complete but merge authorization is absent.',
    forbidden_evidence_condition: 'Any inferred, stale, competing, or non-Founder merge authority.',
    permitted_operation: null,
    canonical_command: null,
    required_review_type: null,
    expected_post_state_or_gate: 'FOUNDER_GATE — no agent mutation',
    prohibited_commands: ALL_MUTATING_COMMANDS,
    decision: 'FOUNDER_GATE',
    stop_condition: 'Wait for explicit Founder merge or reopen authorization; no agent mutation is permitted.',
  }),
  route({
    route_key: 'ELIGIBLE_FOR_FOUNDER_REVIEW/exact-merge-authorization-current-reviewed-head',
    observed_state: 'ELIGIBLE_FOR_FOUNDER_REVIEW',
    evidence_case: 'exact-merge-authorization-current-reviewed-head',
    required_evidence_condition: 'Exact Founder merge authorization and current reviewed head are verified.',
    forbidden_evidence_condition: 'Head drift, stale authorization, competing authority, or reopen tuple.',
    permitted_operation: 'Execute the Founder-authorized merge completion bundle.',
    canonical_command: 'bemoat:mission-control:merge',
    required_review_type: null,
    expected_post_state_or_gate: 'DONE',
    prohibited_commands: ['bemoat:mission-control:reopen'],
    decision: 'COMMAND',
  }),
  route({
    route_key: 'ELIGIBLE_FOR_FOUNDER_REVIEW/complete-founder-old-new-head-reopen-tuple',
    observed_state: 'ELIGIBLE_FOR_FOUNDER_REVIEW',
    evidence_case: 'complete-founder-old-new-head-reopen-tuple',
    required_evidence_condition: 'Founder authorization binds the complete repository/Task/PR/base, old reviewed head, new live head, counters, and bounded correction scope.',
    forbidden_evidence_condition: 'Missing, stale, superseded, competing, or same old/new head evidence.',
    permitted_operation: 'Project the Founder-authorized reopen correction state only.',
    canonical_command: 'bemoat:mission-control:reopen',
    required_review_type: null,
    expected_post_state_or_gate: 'FOUNDER_AUTHORIZED_CORRECTION',
    prohibited_commands: ['bemoat:mission-control:merge', 'bemoat:mission-control:dispatch'],
    decision: 'COMMAND',
  }),
  route({
    route_key: 'ANY_STATE/unauthorized-head-drift',
    observed_state: null,
    evidence_case: 'unauthorized-head-drift',
    required_evidence_condition: 'Live head differs from the authorized/reviewed head without a matching authorization.',
    forbidden_evidence_condition: 'A complete exact Founder authorization proving the drift is permitted.',
    permitted_operation: null,
    canonical_command: null,
    required_review_type: null,
    expected_post_state_or_gate: 'STOP',
    prohibited_commands: ALL_MUTATING_COMMANDS,
    decision: 'STOP',
    stop_condition: 'Stop with HEAD_DRIFT; obtain fresh authority and exact evidence before any mutation.',
  }),
  route({
    route_key: 'ANY_STATE/proven-routing-only-projection-drift',
    observed_state: null,
    evidence_case: 'proven-routing-only-projection-drift',
    required_evidence_condition: 'A failed canonical transport left a routing-only projection drift proven by authoritative live evidence.',
    forbidden_evidence_condition: 'Ordinary delivery/review/reopen/merge work, ambiguous evidence, or an unproved write outcome.',
    permitted_operation: 'Repair the routing projection only.',
    canonical_command: 'bemoat:mission-control:reconcile',
    required_review_type: null,
    expected_post_state_or_gate: 'Verified routing projection',
    prohibited_commands: [
      'bemoat:agent:delivery',
      'bemoat:mission-control:review',
      'bemoat:mission-control:reopen',
      'bemoat:mission-control:merge',
    ],
    decision: 'COMMAND',
  }),
  route({
    route_key: 'ANY_STATE/exact-quarantined-274-275-incident-tuple',
    observed_state: null,
    evidence_case: 'exact-quarantined-274-275-incident-tuple',
    required_evidence_condition: 'The exact pinned #274/#275 incident tuple and quarantined raw-review evidence are complete.',
    forbidden_evidence_condition: 'Any ordinary review tuple or mismatch in the pinned incident identity.',
    permitted_operation: 'Run exceptional recovery only.',
    canonical_command: 'bemoat:mission-control:recover-review',
    required_review_type: 'delta',
    expected_post_state_or_gate: 'AWAITING_REVIEW_2 projection from quarantined evidence',
    prohibited_commands: ['bemoat:mission-control:review'],
    decision: 'COMMAND',
  }),
  route({
    route_key: 'DONE/exact-identical-merge-completion-retry',
    observed_state: 'DONE',
    evidence_case: 'exact-identical-merge-completion-retry',
    required_evidence_condition: 'The exact merge-completion bundle, merge commit, closed Issue, and campaign projection are already verified.',
    forbidden_evidence_condition: 'Any changed head, authorization, merge commit, or terminal projection.',
    permitted_operation: 'Verify the existing merge completion without mutation.',
    canonical_command: 'bemoat:mission-control:merge',
    required_review_type: null,
    expected_post_state_or_gate: 'NO_OP_IDENTICAL_RETRY',
    decision: 'COMMAND',
  }),
  route({
    route_key: 'DONE/no-retry-request',
    observed_state: 'DONE',
    evidence_case: 'no-retry-request',
    required_evidence_condition: 'The terminal DONE projection is complete and no retry request is present.',
    forbidden_evidence_condition: 'Unverified or conflicting terminal evidence.',
    permitted_operation: null,
    canonical_command: null,
    required_review_type: null,
    expected_post_state_or_gate: 'COMPLETE',
    decision: 'COMPLETE',
  }),
  route({
    route_key: 'BLOCKED_EXTERNAL/state-conflict-or-migration-required',
    observed_state: 'BLOCKED_EXTERNAL',
    evidence_case: 'blocked-external-state-conflict-or-migration-required',
    required_evidence_condition: 'External evidence is unavailable or the managed state requires an unresolved migration.',
    forbidden_evidence_condition: 'A complete authoritative recovery path.',
    permitted_operation: null,
    canonical_command: null,
    required_review_type: null,
    expected_post_state_or_gate: 'STOP',
    prohibited_commands: ALL_MUTATING_COMMANDS,
    decision: 'STOP',
    stop_condition: 'Stop until external evidence, state conflict, or migration requirements are resolved.',
  }),
  route({
    route_key: 'STATE_CONFLICT/explicit-stop',
    observed_state: 'STATE_CONFLICT',
    evidence_case: 'explicit-state-conflict-stop',
    required_evidence_condition: 'Managed evidence is contradictory, duplicated, or otherwise non-authoritative.',
    forbidden_evidence_condition: 'A fresh exact evidence tuple that resolves the conflict.',
    permitted_operation: null,
    canonical_command: null,
    required_review_type: null,
    expected_post_state_or_gate: 'STOP',
    prohibited_commands: ALL_MUTATING_COMMANDS,
    decision: 'STOP',
    stop_condition: 'Stop with STATE_CONFLICT; do not select a fallback command.',
  }),
  route({
    route_key: 'STATE_MIGRATION_REQUIRED/explicit-stop',
    observed_state: 'STATE_MIGRATION_REQUIRED',
    evidence_case: 'unresolved-state-migration-required',
    required_evidence_condition: 'The managed state explicitly requires a reviewed migration.',
    forbidden_evidence_condition: 'An approved migration result and stable state projection.',
    permitted_operation: null,
    canonical_command: null,
    required_review_type: null,
    expected_post_state_or_gate: 'STOP',
    prohibited_commands: ALL_MUTATING_COMMANDS,
    decision: 'STOP',
    stop_condition: 'Stop until the required state migration is separately reviewed and complete.',
  }),
  route({
    route_key: 'ANY_STATE/malformed-stale-superseded-duplicated-competing-evidence',
    observed_state: null,
    evidence_case: 'malformed-stale-superseded-duplicated-competing-evidence',
    required_evidence_condition: 'Evidence is malformed, stale, superseded, duplicated, competing, ambiguous, or unknown.',
    forbidden_evidence_condition: 'One exact supported evidence tuple with no competing interpretation.',
    permitted_operation: null,
    canonical_command: null,
    required_review_type: null,
    expected_post_state_or_gate: 'STOP',
    prohibited_commands: ALL_MUTATING_COMMANDS,
    decision: 'STOP',
    stop_condition: 'Stop with STATE_CONFLICT; never select a fallback command.',
  }),
  route({
    route_key: 'NOT_STATEFUL/explicit-fast-unmanaged-role-comment',
    observed_state: 'NOT_STATEFUL',
    evidence_case: 'explicit-fast-unmanaged-role-comment',
    required_evidence_condition: 'The operation is explicitly authorized as a FAST/unmanaged role comment.',
    forbidden_evidence_condition: 'Any managed-state transition or canonical transport evidence.',
    permitted_operation: 'Validate or post the unmanaged role comment.',
    canonical_command: 'bemoat:issue:comment',
    required_review_type: null,
    expected_post_state_or_gate: 'COMPLETE',
    decision: 'COMMAND',
  }),
  route({
    route_key: 'NOT_STATEFUL/explicit-authorized-starter-child-sync',
    observed_state: 'NOT_STATEFUL',
    evidence_case: 'explicit-authorized-starter-child-sync',
    required_evidence_condition: 'The starter/child sync operation is explicitly authorized and its transition gates are complete.',
    forbidden_evidence_condition: 'Managed Task state mutation or unapproved project-specific resource changes.',
    permitted_operation: 'Synchronize the approved boilerplate projection.',
    canonical_command: 'bemoat:boilerplate:sync',
    required_review_type: null,
    expected_post_state_or_gate: 'COMPLETE',
    decision: 'COMMAND',
  }),
  route({
    route_key: 'NOT_STATEFUL/explicit-local-hook-install',
    observed_state: 'NOT_STATEFUL',
    evidence_case: 'explicit-local-hook-install',
    required_evidence_condition: 'The local hook-install operation is explicitly authorized.',
    forbidden_evidence_condition: 'Task-state or remote GitHub mutation evidence.',
    permitted_operation: 'Install local hooks.',
    canonical_command: 'bemoat:hooks:install',
    required_review_type: null,
    expected_post_state_or_gate: 'COMPLETE',
    decision: 'COMMAND',
  }),
]

/**
 * @template {object} T
 * @param {T} value
 * @returns {T}
 */
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

/** @type {{schema_version: 1, commands: Record<string, CommandContract>, routes: RouteRow[]}} */
const registry = {
  schema_version: COMMAND_CONTRACT_SCHEMA_VERSION,
  commands,
  routes,
}

export const COMMAND_CONTRACT_REGISTRY = deepFreeze(registry)
