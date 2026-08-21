/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  COMMAND_CONTRACT_REGISTRY,
  COMMAND_CONTRACT_SCHEMA_VERSION,
} from './command-contract-registry.ts'
import { validateTransportBindings } from './command-contract-transport.ts'

const COMMAND_FIELDS = [
  'schema_version',
  'command',
  'tier',
  'entrypoint',
  'purpose',
  'operation',
  'accepted_pre_states',
  'required_inputs',
  'optional_flags',
  'caller_supplied_values',
  'trusted_derived_values',
  'required_evidence',
  'reads',
  'writes',
  'success_classifications',
  'stop_classifications',
  'stop_conditions',
  'retry_contract',
  'role_contracts',
  'next_action_rules',
  'examples',
  'exceptional',
  'transport_role',
  'parser_owner',
  'delegated_executable',
  'help_meaningful',
  'safe_help_invocation',
  'exclusion_reason',
  'last_validation_before_mutation',
  'post_write_readback',
  'legacy_classification_map',
]

const INPUT_FIELDS = [
  'name',
  'syntax',
  'kind',
  'value_type',
  'required',
  'source',
  'multiple',
  'values',
  'description',
]

const RETRY_FIELDS = ['identical_retry', 'classification', 'condition']

const ROUTE_FIELDS = [
  'route_key',
  'observed_state',
  'evidence_case',
  'required_evidence_condition',
  'forbidden_evidence_condition',
  'permitted_operation',
  'canonical_command',
  'required_review_type',
  'expected_post_state_or_gate',
  'prohibited_commands',
  'decision',
  'stop_condition',
]

const CANONICAL_CLASSIFICATIONS = new Set([
  'HELP',
  'SUCCESS',
  'NO_OP_IDENTICAL_RETRY',
  'INVALID_INVOCATION',
  'UNSUPPORTED_PRE_STATE',
  'STATE_CONFLICT',
  'AUTHORITY_CONFLICT',
  'HEAD_DRIFT',
  'BLOCKED_EXTERNAL',
  'EVIDENCE_CONFLICT',
  'AMBIGUOUS_RESULT',
  'INTERNAL_ERROR',
])

const TIERS = new Set(['A', 'B', 'C'])
const INPUT_KINDS = new Set(['positional', 'flag', 'environment', 'stdin'])
const INPUT_VALUE_TYPES = new Set([
  'boolean',
  'positive_integer',
  'repository',
  'full_sha',
  'path',
  'enum',
  'string',
])
const INPUT_SOURCES = new Set(['caller', 'trusted_derived'])
const RETRY_POLICIES = new Set(['allowed', 'forbidden', 'conditional'])
const ROUTE_DECISIONS = new Set(['COMMAND', 'FOUNDER_GATE', 'COMPLETE', 'STOP'])
const REVIEW_TYPES = new Set(['full', 'delta', 'blocker-verification'])

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: any, expected: string[]): boolean {
  return isRecord(value) &&
    Object.keys(value).sort().join('\u0000') === [...expected].sort().join('\u0000')
}

function strings(value: any): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function valuesFromStates(states: unknown): string[] | null {
  if (states instanceof Set || Array.isArray(states)) return [...(states as any)]
  if (states && typeof (states as any)[Symbol.iterator] === 'function') return [...(states as any)]
  return null
}

function sameArray(left: unknown, right: unknown): boolean {
  return Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((entry, index) => entry === right[index])
}

function expectedEntrypoint(command: string, script: any): string | null {
  if (command === 'bemoat:check' || command === 'bemoat:test:int') return 'package.json'

  const direct = String(script ?? '').match(/\b(?:node|bash)\s+(scripts\/[^\s"'`]+)/)
  if (direct) return direct[1]

  return null
}

function validateInput(input: any, label: string, errors: string[]): void {
  if (!exactKeys(input, INPUT_FIELDS)) {
    errors.push(`${label} must contain exactly the schema-v1 InputSpec fields`)
    return
  }
  if (
    typeof input.name !== 'string' ||
    input.name.trim() === '' ||
    typeof input.syntax !== 'string' ||
    input.syntax.trim() === '' ||
    !INPUT_KINDS.has(input.kind) ||
    !INPUT_VALUE_TYPES.has(input.value_type) ||
    typeof input.required !== 'boolean' ||
    !INPUT_SOURCES.has(input.source) ||
    input.multiple !== false ||
    !strings(input.values) ||
    typeof input.description !== 'string' ||
    input.description.trim() === ''
  ) {
    errors.push(`${label} has invalid InputSpec values`)
  }
  if (
    (['positional', 'flag', 'stdin'].includes(input.kind) && input.source !== 'caller') ||
    (input.kind === 'environment' && input.source !== 'trusted_derived')
  ) {
    errors.push(`${label} source does not match its InputSpec kind`)
  }
}

function validateNextAction(action: any, label: string, commands: Set<string>, errors: string[]): void {
  if (!exactKeys(action, ['type', 'command', 'reason'])) {
    errors.push(`${label} must contain exactly type, command, and reason`)
    return
  }
  if (!new Set(['COMMAND', 'FOUNDER_GATE', 'STOP', 'COMPLETE']).has(action.type)) {
    errors.push(`${label}.type is invalid`)
  }
  if (action.command !== null && typeof action.command !== 'string') {
    errors.push(`${label}.command must be a command or null`)
  }
  if (action.type === 'COMMAND' && !commands.has(action.command)) {
    errors.push(`${label}.command is not registered`)
  }
  if (action.type !== 'COMMAND' && action.command !== null) {
    errors.push(`${label}.command must be null for a non-command next action`)
  }
  if (typeof action.reason !== 'string' || action.reason.trim() === '') {
    errors.push(`${label}.reason is required`)
  }
}

function validateCommandRecord(commandKey: string, record: any, packageScript: any, commands: Set<string>, errors: string[]): void {
  const label = `commands.${commandKey}`
  if (!exactKeys(record, COMMAND_FIELDS)) {
    errors.push(`${label} must contain exactly the schema-v1 command fields`)
    return
  }

  if (
    record.schema_version !== COMMAND_CONTRACT_SCHEMA_VERSION ||
    record.command !== commandKey ||
    !TIERS.has((record as any).tier) ||
    typeof record.entrypoint !== 'string' ||
    record.entrypoint.trim() === '' ||
    typeof record.purpose !== 'string' ||
    record.purpose.trim() === '' ||
    typeof record.operation !== 'string' ||
    record.operation.trim() === ''
  ) {
    errors.push(`${label} has invalid identity or descriptive fields`)
  }

  if (!existsSync(resolve(process.cwd(), record.entrypoint))) {
    errors.push(`${label}.entrypoint does not exist: ${record.entrypoint}`)
  }

  const packageEntrypoint = expectedEntrypoint(commandKey, packageScript)
  if (packageEntrypoint !== null && record.entrypoint !== packageEntrypoint) {
    errors.push(`${label}.entrypoint does not match package.json: ${packageEntrypoint}`)
  }

  for (const field of [
    'accepted_pre_states',
    'caller_supplied_values',
    'trusted_derived_values',
    'required_evidence',
    'reads',
    'writes',
    'success_classifications',
    'stop_classifications',
    'stop_conditions',
  ]) {
    if (!strings(record[field])) errors.push(`${label}.${field} must be a string array`)
  }

  for (const classification of [
    ...(Array.isArray(record.success_classifications) ? record.success_classifications : []),
    ...(Array.isArray(record.stop_classifications) ? record.stop_classifications : []),
  ]) {
    if (!CANONICAL_CLASSIFICATIONS.has(classification as any)) {
      errors.push(`${label} contains unknown classification ${classification}`)
    }
  }

  const requiredInputs = Array.isArray(record.required_inputs) ? record.required_inputs : []
  const optionalFlags = Array.isArray(record.optional_flags) ? record.optional_flags : []
  const allInputs = [...requiredInputs, ...optionalFlags]
  for (const [index, value] of requiredInputs.entries()) {
    validateInput(value, `${label}.required_inputs[${index}]`, errors)
    if (value?.required !== true) errors.push(`${label}.required_inputs[${index}] must be required`)
  }
  for (const [index, value] of optionalFlags.entries()) {
    validateInput(value, `${label}.optional_flags[${index}]`, errors)
    if (value?.required !== false) errors.push(`${label}.optional_flags[${index}] must be optional`)
  }

  const inputNames = allInputs.map((value) => value?.name)
  if (new Set(inputNames).size !== inputNames.length) {
    errors.push(`${label} contains duplicate input names`)
  }
  const singletonSyntaxes = allInputs
    .map((value) => value?.syntax)
    .filter((syntax) => typeof syntax === 'string' && syntax.length > 0)
  if (new Set(singletonSyntaxes).size !== singletonSyntaxes.length) {
    errors.push(`${label} contains duplicate singleton syntax`)
  }

  const expectedCallerValues = allInputs
    .filter((value) => value?.source === 'caller')
    .map((value) => value.name)
  const expectedTrustedValues = [
    ...allInputs
      .filter((value) => value?.source === 'trusted_derived')
      .map((value) => value.name),
  ]
  if (!sameArray(record.caller_supplied_values, expectedCallerValues)) {
    errors.push(`${label}.caller_supplied_values does not match InputSpec sources`)
  }
  if (!sameArray(
    record.trusted_derived_values,
    [...new Set(expectedTrustedValues.concat(
      record.trusted_derived_values.filter((value: any) => !inputNames.includes(value)),
    ))],
  )) {
    errors.push(`${label}.trusted_derived_values contains inconsistent InputSpec sources`)
  }

  if (typeof record.role_contracts !== 'object' || record.role_contracts === null) {
    errors.push(`${label}.role_contracts must be an object`)
  }

  if (!exactKeys(record.retry_contract, RETRY_FIELDS)) {
    errors.push(`${label}.retry_contract must contain exactly the schema-v1 retry fields`)
  } else {
    if (!RETRY_POLICIES.has(record.retry_contract.identical_retry)) {
      errors.push(`${label}.retry_contract.identical_retry is invalid`)
    }
    if (
      record.retry_contract.classification !== null &&
      !CANONICAL_CLASSIFICATIONS.has(record.retry_contract.classification)
    ) {
      errors.push(`${label}.retry_contract.classification is invalid`)
    }
    if (typeof record.retry_contract.condition !== 'string' || record.retry_contract.condition.trim() === '') {
      errors.push(`${label}.retry_contract.condition is required`)
    }
  }

  if (!Array.isArray(record.next_action_rules)) {
    errors.push(`${label}.next_action_rules must be an array`)
  } else {
    for (const [index, rule] of record.next_action_rules.entries()) {
      if (!exactKeys(rule, ['classification', 'next_action']) && !exactKeys(rule, ['classification', 'condition', 'next_action'])) {
        errors.push(`${label}.next_action_rules[${index}] has invalid fields`)
        continue
      }
      if (!CANONICAL_CLASSIFICATIONS.has(rule.classification)) {
        errors.push(`${label}.next_action_rules[${index}].classification is invalid`)
      }
      if ('condition' in rule && (typeof rule.condition !== 'string' || rule.condition.trim() === '')) {
        errors.push(`${label}.next_action_rules[${index}].condition is required when present`)
      }
      validateNextAction(rule.next_action, `${label}.next_action_rules[${index}].next_action`, commands, errors)
    }
  }

  if (!Array.isArray(record.examples)) {
    errors.push(`${label}.examples must be an array`)
  } else {
    for (const [index, example] of record.examples.entries()) {
      if (!exactKeys(example, ['description', 'argv']) || typeof example.description !== 'string' || !strings(example.argv)) {
        errors.push(`${label}.examples[${index}] has invalid fields`)
      }
    }
  }

  if (
    typeof (record as any).exceptional !== 'boolean' ||
    (record.transport_role !== null && typeof record.transport_role !== 'string') ||
    (record.parser_owner !== null && typeof record.parser_owner !== 'string') ||
    (record.delegated_executable !== null && typeof record.delegated_executable !== 'string') ||
    typeof record.help_meaningful !== 'boolean' ||
    (record.safe_help_invocation !== null && typeof record.safe_help_invocation !== 'string') ||
    ((record as any).exclusion_reason !== null && typeof (record as any).exclusion_reason !== 'string') ||
    (record.last_validation_before_mutation !== null && typeof record.last_validation_before_mutation !== 'string') ||
    (record.post_write_readback !== null && typeof record.post_write_readback !== 'string') ||
    !isRecord(record.legacy_classification_map)
  ) {
    errors.push(`${label} has invalid boundary or legacy fields`)
  }

  if (record.parser_owner !== null && !existsSync(resolve(process.cwd(), record.parser_owner))) {
    errors.push(`${label}.parser_owner does not exist: ${record.parser_owner}`)
  }
  for (const [legacy, classification] of Object.entries(record.legacy_classification_map ?? {})) {
    if (typeof legacy !== 'string' || !CANONICAL_CLASSIFICATIONS.has(classification as any)) {
      errors.push(`${label}.legacy_classification_map contains an invalid mapping`)
    }
  }

  if ((record as any).tier === 'C') {
    if (
      record.parser_owner !== null ||
      typeof record.delegated_executable !== 'string' ||
      record.delegated_executable.trim() === '' ||
      record.required_inputs.length !== 0 ||
      record.optional_flags.length !== 0 ||
      record.caller_supplied_values.length !== 0 ||
      record.writes.length !== 0 ||
      typeof record.safe_help_invocation !== 'string' ||
      record.safe_help_invocation.trim() === '' ||
      typeof (record as any).exclusion_reason !== 'string' ||
      !/delegat|wrapper|parser|pipeline/i.test((record as any).exclusion_reason)
    ) {
      errors.push(`${label} violates the Tier C delegation boundary`)
    }
    if (record.delegated_executable !== packageScript) {
      errors.push(`${label}.delegated_executable does not match package.json`)
    }
  }

  if ((record as any).tier !== 'C' && (record as any).exclusion_reason !== null) {
    errors.push(`${label}.exclusion_reason is only valid for Tier C`)
  }
}

function validateRoutes(registry: any, commands: any, states: string[], errors: string[]): void {
  if (!Array.isArray(registry.routes)) {
    errors.push('registry.routes must be an array')
    return
  }

  const routeKeys = new Set()
  const routeTuples = new Set()
  const routedStates = new Set()

  for (const [index, route] of (registry.routes as any[]).entries()) {
    const label = `routes[${index}]`
    if (!exactKeys(route, ROUTE_FIELDS)) {
      errors.push(`${label} must contain exactly the schema-v1 RouteRow fields`)
      continue
    }
    if (
      typeof route.route_key !== 'string' ||
      route.route_key.trim() === '' ||
      typeof route.evidence_case !== 'string' ||
      route.evidence_case.trim() === '' ||
      typeof route.required_evidence_condition !== 'string' ||
      typeof route.forbidden_evidence_condition !== 'string' ||
      (route.permitted_operation !== null && typeof route.permitted_operation !== 'string') ||
      ((route as any).canonical_command !== null && typeof (route as any).canonical_command !== 'string') ||
      (route.required_review_type !== null && !REVIEW_TYPES.has(route.required_review_type)) ||
      typeof route.expected_post_state_or_gate !== 'string' ||
      !Array.isArray(route.prohibited_commands) ||
      !ROUTE_DECISIONS.has(route.decision) ||
      (route.stop_condition !== null && typeof route.stop_condition !== 'string')
    ) {
      errors.push(`${label} has invalid route values`)
    }
    if (
      route.observed_state !== null &&
      route.observed_state !== 'NOT_STATEFUL' &&
      typeof route.observed_state !== 'string'
    ) {
      errors.push(`${label}.observed_state is invalid`)
    }
    if (route.observed_state !== null && route.observed_state !== 'NOT_STATEFUL') {
      routedStates.add(route.observed_state)
    }
    if (routeKeys.has(route.route_key)) errors.push(`duplicate route_key: ${route.route_key}`)
    routeKeys.add(route.route_key)
    const tuple = `${String(route.observed_state)}\u0000${route.evidence_case}`
    if (routeTuples.has(tuple)) errors.push(`duplicate route tuple: ${tuple}`)
    routeTuples.add(tuple)

    if ((route as any).canonical_command !== null && !commands[(route as any).canonical_command]) {
      errors.push(`${label}.canonical_command is not registered`)
    }
    for (const command of route.prohibited_commands) {
      if (typeof command !== 'string' || !commands[command]) {
        errors.push(`${label}.prohibited_commands contains an unregistered command`)
      }
    }
    if (route.decision === 'COMMAND' && (route as any).canonical_command === null) {
      errors.push(`${label} COMMAND decision must select a command`)
    }
    if (route.decision !== 'COMMAND' && (route as any).canonical_command !== null) {
      errors.push(`${label} non-command decision must not select a command`)
    }
    if (
      (route.decision === 'STOP' || route.decision === 'FOUNDER_GATE') &&
      (typeof route.stop_condition !== 'string' || route.stop_condition.trim() === '')
    ) {
      errors.push(`${label} stop/gate decision requires stop_condition`)
    }
  }

  for (const state of states) {
    if (!routedStates.has(state)) errors.push(`state is absent from registry routes: ${state}`)
  }

  for (const [command, contract] of Object.entries(commands)) {
    if ((contract as any).tier !== 'A') continue
    const hasRoute = (registry.routes as any[]).some((route: any) => (route as any).canonical_command === command)
    const hasExceptionalRecord =
      (contract as any).exceptional === true &&
      typeof (contract as any).exclusion_reason === 'string' &&
      (contract as any).exclusion_reason.trim() !== ''
    if (!hasRoute && !hasExceptionalRecord) {
      errors.push(`Tier A command has no route or explicit exceptional record: ${command}`)
    }
  }
}

import type { CommandContract } from './command-contract-registry.ts'
export function getCommandContract(command: unknown): CommandContract | null {
  return COMMAND_CONTRACT_REGISTRY.commands[String(command)] ?? null
}

export function validateCommandContractRegistry({
  registry,
  packageJson,
  transports,
  states,
}: { registry: unknown, packageJson: unknown, transports: unknown, states: unknown }) {
  const errors = []
  const target = registry as any
  const packageScripts = (packageJson as { scripts?: Record<string, unknown> })?.scripts
  const stateValues = valuesFromStates(states)

  if (!isRecord(target)) {
    errors.push('registry must be an object')
    return { valid: false, errors }
  }
  if (target.schema_version !== COMMAND_CONTRACT_SCHEMA_VERSION) {
    errors.push('registry schema_version must be 1')
  }
  if (!isRecord(target.commands)) {
    errors.push('registry.commands must be an object')
    return { valid: false, errors }
  }
  if (!isRecord(packageScripts)) errors.push('packageJson.scripts must be an object')
  if (!stateValues || stateValues.some((state) => typeof state !== 'string')) {
    errors.push('states must be an iterable of strings')
  }

  const packageCommands = isRecord(packageScripts)
    ? Object.keys(packageScripts).filter((command) => command.startsWith('bemoat:')).sort()
    : []
  const registryCommands = Object.keys(target.commands).sort()
  if (!sameArray(registryCommands, packageCommands)) {
    errors.push('registry commands must match every bemoat:* package script exactly once')
  }

  const commandSet = new Set(registryCommands)
  for (const command of registryCommands) {
    const record = target.commands[command]
    validateCommandRecord(command, record, packageScripts?.[command], commandSet, errors)
  }

  errors.push(...validateTransportBindings(target.commands as any, transports))
  if (stateValues) validateRoutes(target as any, target.commands, stateValues, errors)

  const tierCounts = { A: 0, B: 0, C: 0 }
  for (const record of Object.values(target.commands)) {
    if (record && TIERS.has((record as any).tier)) tierCounts[(record as any).tier as keyof typeof tierCounts] += 1
  }

  return {
    valid: errors.length === 0,
    errors,
    command_count: registryCommands.length,
    tier_counts: tierCounts,
    transport_count: Array.isArray(transports) ? transports.length : 0,
    state_count: stateValues?.length ?? 0,
  }
}
