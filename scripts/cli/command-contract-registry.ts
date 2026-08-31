/* eslint-disable @typescript-eslint/no-explicit-any */
import { handoffCommands } from './handoff-command-metadata.ts'
import { handoffRoutes } from './handoff-routing-policy.ts'
import { contextSyncCommands } from './context-sync-command-metadata.ts'
import { contextSyncRoutes } from './context-sync-routing-policy.ts'
import { utilityRoutes } from './utility-routing-policy.ts'

export const COMMAND_CONTRACT_SCHEMA_VERSION = 1 as const

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

function input({
  name,
  syntax,
  kind,
  value_type,
  required,
  source = 'caller',
  values = [],
  description,
}: Partial<InputSpec> & Pick<InputSpec, 'name' | 'syntax' | 'kind' | 'value_type' | 'required' | 'description'>): InputSpec {
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

function positional(name: string, syntax: string, value_type: InputSpec['value_type'], description: string): InputSpec {
  return input({
    name,
    syntax,
    kind: 'positional',
    value_type,
    required: true,
    description,
  })
}

function flag(name: string, syntax: string, value_type: InputSpec['value_type'], description: string, values: string[] = [], required = false): InputSpec {
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

function environment(name: string, value_type: InputSpec['value_type'], description: string, values: string[] = []): InputSpec {
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

function nextAction(type: NextAction['type'], command: string | null, reason: string): NextAction {
  return { type, command, reason }
}

type ContractInput = any;
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
    identical_retry: 'allowed' as const,
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
  exceptional,
}: ContractInput): CommandContract {
  const isExceptional = exceptional ?? false
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
    exceptional: isExceptional,
    transport_role: null,
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

export interface InputSpec { [key: string]: unknown;
  name: string;
  syntax: string;
  kind: 'positional'|'flag'|'environment'|'stdin';
  value_type: 'boolean'|'positive_integer'|'repository'|'full_sha'|'path'|'enum'|'string';
  required: boolean;
  source: 'caller'|'trusted_derived';
  multiple: false;
  values: string[];
  description: string;
}

export interface NextAction { [key: string]: unknown;
  type: 'COMMAND'|'FOUNDER_GATE'|'STOP'|'COMPLETE';
  command: string|null;
  reason: string;
}

export interface CommandContract { [key: string]: unknown;
  schema_version: 1;
  command: string;
  tier: 'A'|'B'|'C';
  entrypoint: string;
  purpose: string;
  operation: string;
  accepted_pre_states: string[];
  required_inputs: InputSpec[];
  optional_flags: InputSpec[];
  caller_supplied_values: string[];
  trusted_derived_values: string[];
  required_evidence: string[];
  reads: string[];
  writes: string[];
  success_classifications: string[];
  stop_classifications: string[];
  stop_conditions: string[];
  retry_contract: { identical_retry: 'allowed'|'forbidden'|'conditional', classification: string|null, condition: string };
  role_contracts: Record<string, unknown>;
  next_action_rules: { classification: string, condition?: string, next_action: NextAction }[];
  examples: { description: string, argv: string[] }[];
  exceptional: boolean;
  transport_role: string|null;
  parser_owner: string|null;
  delegated_executable: string|null;
  help_meaningful: boolean;
  safe_help_invocation: string|null;
  exclusion_reason: string|null;
  last_validation_before_mutation: string|null;
  post_write_readback: string|null;
  legacy_classification_map: Record<string, string>;
}

export interface RouteRow { [key: string]: unknown;
  route_key: string;
  observed_state: string|null|'NOT_STATEFUL';
  evidence_case: string;
  required_evidence_condition: string;
  forbidden_evidence_condition: string;
  permitted_operation: string|null;
  canonical_command: string|null;
  required_review_type: 'full'|'delta'|'blocker-verification'|null;
  expected_post_state_or_gate: string;
  prohibited_commands: string[];
  decision: 'COMMAND'|'FOUNDER_GATE'|'COMPLETE'|'STOP';
  stop_condition: string|null;
}


const commands: Record<string, CommandContract> = {
  'bemoat:context': contract({
    command: 'bemoat:context',
    tier: 'B',
    entrypoint: 'scripts/agent-context.ts',
    purpose: 'Reconstruct deterministic bounded task context without mutation.',
    operation: 'Read and normalize live GitHub and local Git evidence, then compute one pure route.',
    required_inputs: [positional('issue_number', '<issue-number>', 'positive_integer', 'Issue number to reconstruct.')],
    optional_flags: [flag('json', '--json', 'boolean', 'Emit deterministic machine-readable context output.')],
    required_evidence: ['Canonical repository identity and live protected-base SHA.', 'Canonical policy path, version, and source/blob identity.', 'Issue objective, scope, acceptance criteria, dependencies, and durable comments.', 'Local branch, HEAD, upstream, origin identity, cleanliness, and push durability.', 'Unique active PR, exact head, CI/check, review, and applicable protection evidence when present.'],
    reads: ['local Git refs, status, branch, upstream, and origin identity', 'GitHub repository, protected base, policy, Issue, comments, PR, checks, reviews, and protection'],
    writes: [],
    success_classifications: ['SUCCESS'],
    next_action_rules: [
      { classification: 'SUCCESS', next_action: nextAction('COMPLETE', null, 'The context was reconstructed without mutation.') },
      { classification: 'BLOCKED_EXTERNAL', next_action: nextAction('STOP', null, 'Required external evidence is unavailable.') },
      { classification: 'EVIDENCE_CONFLICT', next_action: nextAction('STOP', null, 'Required evidence is contradictory or ambiguous.') },
    ],
    stop_conditions: ['Stop fail-closed when required evidence is missing, unavailable, contradictory, or ambiguous.', 'Stop with LOCAL_STATE_NOT_DURABLE-style evidence when required local work is dirty, detached, unpushed, or local-only.'],
    examples: [{ description: 'Reconstruct Issue context as JSON.', argv: ['410', '--json'] }],
    parser_owner: 'scripts/agent-context.ts',
    safe_help_invocation: 'pnpm run bemoat:context -- --help --json',
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
      environment('BEMOAT_SYNC_MODE', 'enum', 'Trusted default sync mode.', ['harness-only', 'full']),
      environment('BEMOAT_APPLY_BUILD_CONTRACT', 'boolean', 'Trusted build-contract opt-in default.', ['0', '1', 'true', 'false']),
      environment('BEMOAT_BOILERPLATE_REPO', 'repository', 'Trusted upstream boilerplate repository default.'),
      environment('BEMOAT_BOILERPLATE_REF', 'string', 'Trusted upstream boilerplate ref default.'),
    ],
    required_evidence: [
      'Selected source and target repositories.',
      'Build-contract evidence when requested.',
      'Clean or explicitly preserved target working-tree state.',
    ],
    reads: [
      'source and target files',
      'git refs and working-tree state',
      'upstream clone and selected source-ref evidence',
    ],
    writes: [
      'managed and seed paths',
      'merge-keep paths',
      'package proposal and sync metadata',
      'stash/commit only when explicitly authorized by the workflow',
    ],
    retry_contract: {
      identical_retry: 'conditional' as const,
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
    last_validation_before_mutation: 'Re-check selected mode, source/target paths, and working-tree preservation immediately before applying changes.',
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
    entrypoint: 'scripts/guard-cloudflare-env.ts',
    purpose: 'Inspect Cloudflare environment configuration for unsafe placeholders.',
    operation: 'Run the read-only Cloudflare environment guard.',
    reads: ['environment values and wrangler.jsonc'],
    writes: [],
    stop_conditions: ['Stop when required environment or wrangler configuration is missing or unsafe.'],
    parser_owner: 'scripts/guard-cloudflare-env.ts',
    safe_help_invocation: 'pnpm run bemoat:guard:cloudflare-env -- --help --json',
  }),

  'bemoat:guard:harness-contract': contract({
    command: 'bemoat:guard:harness-contract',
    tier: 'B',
    entrypoint: 'scripts/guard-harness-contract.ts',
    purpose: 'Inspect the managed harness contract and runtime closure.',
    operation: 'Run the read-only harness contract guard.',
    reads: ['managed sync manifest and harness files'],
    writes: [],
    stop_conditions: ['Stop when managed harness paths or runtime closure violate the sync contract.'],
    parser_owner: 'scripts/guard-harness-contract.ts',
    safe_help_invocation: 'pnpm run bemoat:guard:harness-contract -- --help --json',
  }),

  'bemoat:guard:pack': contract({
    command: 'bemoat:guard:pack',
    tier: 'B',
    entrypoint: 'scripts/guard-pack.ts',
    purpose: 'Run the aggregate repository safety guard pack.',
    operation: 'Delegate read-only safety checks through the shared guard facade.',
    reads: ['repository guard inputs'],
    writes: [],
    stop_conditions: ['Stop when any registered repository safety guard reports a violation.'],
    parser_owner: 'scripts/guard-pack.ts',
    safe_help_invocation: 'pnpm run bemoat:guard:pack -- --help --json',
  }),

  'bemoat:guard:safety': contract({
    command: 'bemoat:guard:safety',
    tier: 'B',
    entrypoint: 'scripts/guard-pack.ts',
    purpose: 'Run the safety alias of the aggregate repository guard pack.',
    operation: 'Use the same guard facade as bemoat:guard:pack while preserving command identity.',
    reads: ['repository guard inputs'],
    writes: [],
    stop_conditions: ['Stop when any registered repository safety guard reports a violation.'],
    parser_owner: 'scripts/guard-pack.ts',
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
      identical_retry: 'conditional' as const,
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
    entrypoint: 'scripts/bemoat-typecheck.ts',
    purpose: 'Run the registered TypeScript validation wrapper.',
    operation: 'Delegate to the toolchain contract and tsc without consuming command arguments.',
    reads: ['toolchain contract and TypeScript projects'],
    writes: [],
    parser_owner: null,
    delegated_executable: 'node scripts/bemoat-typecheck.ts',
    help_meaningful: false,
    safe_help_invocation: 'pnpm exec tsc --help',
    exclusion_reason: 'Tier C is a bounded toolchain wrapper, not a repository parser; tsc owns its arguments and the wrapper performs no mutation or network operation.',
  }),
}


const commandMetadataDependencies: any = { contract: contract as unknown as <T extends Record<string, unknown>>(value: T) => T, positional, flag, environment, nextAction }
const protocolCommands = handoffCommands(commandMetadataDependencies)

const trailingCommands = Object.fromEntries(
  ['bemoat:test:int', 'bemoat:typecheck'].map((command) => [command, commands[command]]),
)
delete commands['bemoat:test:int']
delete commands['bemoat:typecheck']
const orderedCommands = { ...commands, ...contextSyncCommands(commandMetadataDependencies), ...protocolCommands, ...trailingCommands }

const routes = [
  ...utilityRoutes(),
  ...contextSyncRoutes(),
  ...handoffRoutes(),
]

/**
 * @template {object} T
 * @param {T} value
 * @returns {T}
 */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}


const registry: any = {
  schema_version: COMMAND_CONTRACT_SCHEMA_VERSION,
  commands: orderedCommands,
  routes,
}

export const COMMAND_CONTRACT_REGISTRY = deepFreeze(registry)
