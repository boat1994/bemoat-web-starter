#!/usr/bin/env node
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getCommandContract } from './command-contract.mjs'
import {
  CliInvocationError,
  parseCommandInvocation,
  resolveCommandIdentity,
} from './command-invocation.mjs'
import {
  CLI_EXIT_CODES,
  classificationExitCode,
  createResultEnvelopeV1,
} from './command-result.mjs'

function registeredContract(contract) {
  if (
    typeof contract !== 'object' ||
    contract === null ||
    typeof contract.command !== 'string' ||
    getCommandContract(contract.command) === null
  ) {
    throw new TypeError('help requires a registered command contract')
  }
  return contract
}

function copyValue(value) {
  if (Array.isArray(value)) return value.map(copyValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, copyValue(entry)]),
    )
  }
  return value
}

function copyArray(value) {
  return Array.isArray(value) ? value.map(copyValue) : []
}

function resultClassifications(contract) {
  return [
    ...new Set([
      ...copyArray(contract.success_classifications),
      ...copyArray(contract.stop_classifications),
    ]),
  ]
}

/**
 * Create the exact schema-version-1 help envelope for a command contract.
 *
 * @param {Record<string, unknown>} inputContract
 * @returns {Record<string, unknown>}
 */
export function createHelpEnvelopeV1(inputContract) {
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
    retry_contract: copyValue(contract.retry_contract ?? {}),
    result_classifications: resultClassifications(contract),
    next_action_rules: copyArray(contract.next_action_rules),
    stop_conditions: copyArray(contract.stop_conditions),
    examples: copyArray(contract.examples),
  }
}

function listLines(items, render = (item) => String(item)) {
  if (!Array.isArray(items) || items.length === 0) return ['none']
  return items.map((item) => `- ${render(item)}`)
}

function formatInput(input) {
  return [
    input.syntax,
    `(${input.name}; ${input.value_type}; ${input.source})`,
    input.description,
  ].join(' — ')
}

function formatNextAction(rule) {
  const action = rule.next_action
  const destination = action.command ? ` ${action.command}` : ''
  return `${rule.classification} -> ${action.type}${destination} — ${action.reason}`
}

function formatExample(example, command) {
  const argv = Array.isArray(example.argv) ? example.argv : []
  const suffix = argv.length > 0 ? ` -- ${argv.join(' ')}` : ''
  return `${example.description}: pnpm run ${command}${suffix}`
}

function appendSection(lines, title, contents) {
  lines.push(`${title}:`, ...contents, '')
}

function appendListSection(lines, title, values, render) {
  appendSection(lines, title, listLines(values, render))
}

function appendWritesSection(lines, contract) {
  if (!Array.isArray(contract.writes) || contract.writes.length === 0) {
    lines.push('WRITES: none', '')
    return
  }
  appendListSection(lines, 'WRITES', contract.writes)
}

function appendExitCodeSection(lines) {
  appendListSection(
    lines,
    'EXIT CODES',
    Object.entries(CLI_EXIT_CODES),
    ([classification, code]) => `${classification}: ${code}`,
  )
}

/**
 * Render deterministic plain-text help in the approved tier-specific order.
 *
 * @param {Record<string, unknown>} inputContract
 * @returns {string}
 */
export function formatTextHelp(inputContract) {
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
    appendSection(lines, 'AUTHORITY AND TRUST BOUNDARY', [
      `Caller-supplied values: ${contract.caller_supplied_values.join(', ') || 'none'}`,
      `Trusted-derived values: ${contract.trusted_derived_values.join(', ') || 'none'}`,
    ])
  }

  appendListSection(lines, 'READS', contract.reads)
  appendWritesSection(lines, contract)
  appendListSection(
    lines,
    'RESULT CLASSIFICATIONS',
    resultClassifications(contract),
    (classification) => `${classification}: ${classificationExitCode(classification)}`,
  )
  appendExitCodeSection(lines)
  appendSection(lines, 'RETRY CONTRACT', [
    JSON.stringify(contract.retry_contract ?? {}),
  ])
  appendListSection(lines, 'NEXT ACTIONS', contract.next_action_rules, formatNextAction)
  appendListSection(lines, 'STOP CONDITIONS', contract.stop_conditions)
  appendListSection(
    lines,
    'EXAMPLES',
    contract.examples,
    (example) => formatExample(example, contract.command),
  )
  appendSection(lines, 'SAFE RECOVERY', [
    `Safe help invocation: ${contract.safe_help_invocation ?? 'none'}`,
    `Last validation: ${contract.last_validation_before_mutation ?? 'none'}`,
    `Post-write readback: ${contract.post_write_readback ?? 'none'}`,
  ])

  return `${lines.join('\n')}\n`
}

function directHelpRequest(argv) {
  const [requestedCommand, ...commandArgv] = argv
  if (
    typeof requestedCommand !== 'string' ||
    requestedCommand.startsWith('-')
  ) {
    throw new CliInvocationError(
      requestedCommand ?? null,
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

function validateRunningFacadeIdentity(env) {
  const facadeCommand = env?.BEMOAT_FACADE_COMMAND
  const facadeEntrypoint = env?.BEMOAT_FACADE_ENTRYPOINT
  if (facadeCommand === undefined && facadeEntrypoint === undefined) return
  if (typeof facadeCommand !== 'string' || facadeCommand.trim() === '') {
    throw new CliInvocationError(
      facadeCommand ?? null,
      'BEMOAT_FACADE_COMMAND is required with a running facade identity',
    )
  }

  const facadeContract = getCommandContract(facadeCommand)
  resolveCommandIdentity({
    fallback: facadeCommand,
    env,
    entrypoint: facadeEntrypoint ?? facadeContract?.entrypoint,
  })
}

function errorClassification(error) {
  if (
    error &&
    typeof error === 'object' &&
    typeof error.classification === 'string' &&
    Object.hasOwn(CLI_EXIT_CODES, error.classification)
  ) {
    return error.classification
  }
  return 'INTERNAL_ERROR'
}

function errorDetails(error) {
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
}) {
  const classification = errorClassification(error)
  const details = errorDetails(error)
  if (json && command) {
    const envelope = createResultEnvelopeV1({
      command,
      outcome: classification === 'INTERNAL_ERROR' ? 'ERROR' : 'ERROR',
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

function isDirectExecution() {
  return Boolean(
    process.argv[1] &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url),
  )
}

function main() {
  let command = null
  let classification = 'HELP'
  const argv = process.argv.slice(2)
  const json = argv.includes('--json')

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

  // Only the direct process boundary chooses an exit status. The library
  // functions above return values or throw typed errors.
  process.exitCode = classificationExitCode(classification)
}

if (isDirectExecution()) main()
