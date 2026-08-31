/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getCommandContract } from './command-contract.ts'
import {
  legacyArgvIncludes,
  parseFacadeIdentityEnv,
  parseHelpContractInput,
  readArgvTokens,
} from './command-help-schemas.ts'
import {
  CliInvocationError,
  parseCommandInvocation,
  resolveCommandIdentity,
} from './command-invocation.ts'
import {
  CLI_EXIT_CODES,
  classificationExitCode,
  createResultEnvelopeV1,
} from './command-result.ts'
import type { CommandContract } from './command-invocation-schemas.ts'

function registeredContract(contract: unknown): CommandContract {
  const schema = z.unknown().superRefine((value, context) => {
    const parsed = parseHelpContractInput(value)
    if (
      typeof value !== 'object' ||
      value === null ||
      typeof parsed.command !== 'string' ||
      getCommandContract(parsed.command) === null
    ) {
      context.addIssue({
        code: 'custom',
        message: 'help requires a registered command contract',
      })
    }
  })
  const result = schema.safeParse(contract)
  if (!result.success) {
    throw new TypeError(result.error.issues[0]?.message ?? 'help requires a registered command contract')
  }

  const parsed = parseHelpContractInput(result.data)
  if (typeof parsed.command !== 'string') {
    throw new TypeError('help requires a registered command contract')
  }
  const registered = getCommandContract(parsed.command)
  if (registered === null) {
    throw new TypeError('help requires a registered command contract')
  }
  return registered
}

function copyValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(copyValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, copyValue(entry)]),
    )
  }
  return value
}

function copyArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value.map(copyValue) : []
}

function resultClassifications(contract: CommandContract): unknown[] {
  return [
    ...new Set([
      ...copyArray(contract.success_classifications),
      ...copyArray(contract.stop_classifications),
    ]),
  ]
}

export function createHelpEnvelopeV1(inputContract: any): Record<string, unknown> {
  const contract = registeredContract(inputContract)

  return {
    schema_version: 1,
    command: contract.command,
    mode: 'help',
    classification: 'HELP',
    tier: contract.tier,
    purpose: contract.purpose,
    accepted_pre_states: copyArray(contract.accepted_pre_states),
    required_inputs: copyArray(contract.required_inputs),
    optional_flags: copyArray(contract.optional_flags),
    caller_supplied_values: copyArray(contract.caller_supplied_values),
    trusted_derived_values: copyArray(contract.trusted_derived_values),
    required_evidence: copyArray(contract.required_evidence),
    reads: copyArray(contract.reads),
    writes: copyArray(contract.writes),
    retry_contract: copyValue(contract.retry_contract ?? {}) as Record<string, unknown>,
    role_contracts: copyValue(contract.role_contracts ?? {}) as Record<string, unknown>,
    result_classifications: resultClassifications(contract),
    stop_classifications: copyArray(contract.stop_classifications),
    next_action_rules: copyArray(contract.next_action_rules),
    stop_conditions: copyArray(contract.stop_conditions),
    examples: copyArray(contract.examples),
  }
}

function listLines(
  items: unknown,
  render: (item: unknown) => string = (item) => String(item),
): string[] {
  if (!Array.isArray(items) || items.length === 0) return ['none']
  return items.map((item) => `- ${render(item)}`)
}

function formatInput(input: unknown): string {
  const typed = input as {
    syntax?: string
    name?: string
    value_type?: string
    source?: string
    description?: string
  }
  return [
    typed.syntax,
    `(${typed.name}; ${typed.value_type}; ${typed.source})`,
    typed.description,
  ].join(' — ')
}

function formatNextAction(rule: unknown): string {
  const typed = rule as {
    classification?: unknown
    next_action?: {
      command?: string | null
      type?: string
      reason?: string
    }
  }
  const action = typed.next_action ?? {}
  const destination = action.command ? ` ${action.command}` : ''
  return `${typed.classification} -> ${action.type}${destination} — ${action.reason}`
}

function formatExample(example: { argv?: unknown; description?: unknown }, command: string): string {
  const argv = Array.isArray(example.argv) ? example.argv : []
  const suffix = argv.length > 0 ? ` -- ${argv.join(' ')}` : ''
  return `${example.description}: pnpm run ${command}${suffix}`
}

function appendSection(lines: string[], title: string, contents: string[]): void {
  lines.push(`${title}:`, ...contents, '')
}

function appendListSection(
  lines: string[],
  title: string,
  values: unknown,
  render?: (item: unknown) => string,
): void {
  appendSection(lines, title, listLines(values, render))
}

function appendWritesSection(lines: string[], contract: CommandContract): void {
  if (!Array.isArray(contract.writes) || contract.writes.length === 0) {
    lines.push('WRITES: none', '')
    return
  }
  appendListSection(lines, 'WRITES', contract.writes)
}

function appendExitCodeSection(lines: string[]): void {
  appendListSection(
    lines,
    'EXIT CODES',
    Object.entries(CLI_EXIT_CODES),
    (item) => {
      const [classification, code] = item as [string, number]
      return `${classification}: ${code}`
    },
  )
}

export function formatTextHelp(inputContract: Record<string, unknown>): string {
  const contract = registeredContract(inputContract)
  const lines = [
    `HELP: ${contract.command}`,
    `Direct entrypoint: ${contract.entrypoint}`,
    '',
  ]

  appendSection(lines, 'NAME', [
    String(contract.command),
    `Direct entrypoint: ${contract.entrypoint}`,
  ])
  appendSection(lines, 'PURPOSE', [
    String(contract.purpose),
    `Operation: ${contract.operation}`,
  ])
  appendSection(lines, 'USAGE', [
    `Package command: ${contract.command}`,
    `Safe help invocation: ${contract.safe_help_invocation ?? 'none'}`,
    `Direct entrypoint: ${contract.entrypoint}`,
  ])

  if (contract.tier === 'A') {
    appendListSection(lines, 'ACCEPTED PRE-STATE', contract.accepted_pre_states)
  } else {
    appendListSection(lines, 'PRECONDITIONS', contract.accepted_pre_states)
  }

  appendListSection(lines, 'REQUIRED INPUTS', contract.required_inputs, formatInput)
  appendListSection(lines, 'OPTIONAL FLAGS', contract.optional_flags, formatInput)

  if (contract.tier === 'A') {
    const callerValues = Array.isArray(contract.caller_supplied_values)
      ? contract.caller_supplied_values.join(', ')
      : 'none'
    const trustedValues = Array.isArray(contract.trusted_derived_values)
      ? contract.trusted_derived_values.join(', ')
      : 'none'
    appendSection(lines, 'AUTHORITY AND TRUST BOUNDARY', [
      `Caller-supplied values: ${callerValues || 'none'}`,
      `Trusted-derived values: ${trustedValues || 'none'}`,
    ])
  }

  appendListSection(lines, 'READS', contract.reads)
  appendWritesSection(lines, contract)
  appendListSection(
    lines,
    'RESULT CLASSIFICATIONS',
    resultClassifications(contract),
    (classification) => `${classification}: ${classificationExitCode(String(classification))}`,
  )
  appendExitCodeSection(lines)
  appendSection(lines, 'RETRY CONTRACT', [
    JSON.stringify(contract.retry_contract ?? {}),
  ])
  if (contract.role_contracts && Object.keys(contract.role_contracts).length > 0) {
    appendSection(lines, 'ROLE CONTRACTS', [
      JSON.stringify(contract.role_contracts, null, 2),
    ])
  }
  appendListSection(lines, 'NEXT ACTIONS', contract.next_action_rules, formatNextAction)
  appendListSection(lines, 'STOP CONDITIONS', contract.stop_conditions)
  appendListSection(
    lines,
    'EXAMPLES',
    contract.examples,
    (example) => formatExample(example as { argv?: unknown; description?: unknown }, contract.command),
  )
  appendSection(lines, 'SAFE RECOVERY', [
    `Safe help invocation: ${contract.safe_help_invocation ?? 'none'}`,
    `Last validation: ${contract.last_validation_before_mutation ?? 'none'}`,
    `Post-write readback: ${contract.post_write_readback ?? 'none'}`,
  ])

  return `${lines.join('\n')}\n`
}

function directHelpRequest(argv: unknown): { command: string; argv: unknown[] } {
  const [requestedCommand, ...commandArgv] = readArgvTokens(argv)
  if (
    typeof requestedCommand !== 'string' ||
    requestedCommand.startsWith('-')
  ) {
    throw new CliInvocationError(
      typeof requestedCommand === 'string' ? requestedCommand : null,
      'command-help requires a registry command before its flags',
    )
  }
  if (getCommandContract(requestedCommand) === null) {
    throw new CliInvocationError(
      requestedCommand,
      `command is not registered: ${requestedCommand}`,
    )
  }
  return {
    command: requestedCommand,
    argv: commandArgv,
  }
}

function validateRunningFacadeIdentity(env: unknown): void {
  const validatedEnv = parseFacadeIdentityEnv(env)
  const facadeCommand = validatedEnv?.BEMOAT_FACADE_COMMAND
  const facadeEntrypoint = validatedEnv?.BEMOAT_FACADE_ENTRYPOINT
  if (facadeCommand === undefined && facadeEntrypoint === undefined) return
  if (typeof facadeCommand !== 'string' || facadeCommand.trim() === '') {
    throw new CliInvocationError(
      typeof facadeCommand === 'string' ? facadeCommand : null,
      'BEMOAT_FACADE_COMMAND is required with a running facade identity',
    )
  }

  const facadeContract = getCommandContract(facadeCommand)
  if (facadeContract === null) {
    throw new CliInvocationError(
      facadeCommand,
      `command is not registered: ${facadeCommand}`,
    )
  }

  resolveCommandIdentity({
    fallback: facadeCommand,
    env: validatedEnv,
    entrypoint: typeof facadeEntrypoint === 'string'
      ? facadeEntrypoint
      : facadeContract.entrypoint,
  })
}

function errorClassification(error: unknown): keyof typeof CLI_EXIT_CODES {
  if (
    error &&
    typeof error === 'object' &&
    'classification' in error &&
    typeof error.classification === 'string' &&
    Object.hasOwn(CLI_EXIT_CODES, error.classification)
  ) {
    return error.classification as keyof typeof CLI_EXIT_CODES
  }
  return 'INTERNAL_ERROR'
}

function errorDetails(error: unknown): { argument: string | null; reason: string } {
  if (error instanceof CliInvocationError) {
    return {
      argument: error.details.argument,
      reason: error.details.reason,
    }
  }
  return {
    argument: null,
    reason: error instanceof Error ? error.message : String(error),
  }
}

function renderError({
  command,
  error,
  json,
}: {
  command: string | null
  error: unknown
  json: boolean
}): keyof typeof CLI_EXIT_CODES {
  const classification = errorClassification(error)
  const details = errorDetails(error)
  if (json && command) {
    const envelope = createResultEnvelopeV1({
      command,
      outcome: 'ERROR',
      classification,
      mutation_performed: false,
      next_action: {
        type: 'STOP',
        command: null,
        reason: details.reason,
      },
      details,
    })
    process.stdout.write(`${JSON.stringify(envelope)}\n`)
    return classification
  }

  process.stderr.write(`${classification}: ${details.reason}\n`)
  return classification
}

export function runCommandHelpMain(argv: string[] = process.argv.slice(2)): number {
  let command: string | null = null
  let classification: keyof typeof CLI_EXIT_CODES = 'HELP'
  const json = legacyArgvIncludes(argv, '--json')

  try {
    const request = directHelpRequest(argv)
    command = request.command
    validateRunningFacadeIdentity(process.env)
    const invocation = parseCommandInvocation(command, request.argv)
    if (invocation.mode !== 'help') {
      throw new CliInvocationError(null, 'command-help requires --help or -h')
    }

    if (invocation.format === 'json') {
      process.stdout.write(`${JSON.stringify(createHelpEnvelopeV1(invocation.contract))}\n`)
    } else {
      process.stdout.write(formatTextHelp(invocation.contract))
    }
    classification = 'HELP'
  } catch (error) {
    classification = renderError({ command, error, json })
  }

  return classificationExitCode(classification)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runCommandHelpMain()
}
