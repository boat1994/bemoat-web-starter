import { resolve } from 'node:path'

import { getCommandContract } from './command-contract.mjs'

const POSITIVE_INTEGER_RE = /^[1-9]\d*$/
const REPOSITORY_RE = /^[^/\s:]+\/[^/\s:]+$/
const FULL_SHA_RE = /^[0-9a-f]{40}$/i
const HELP_ARGUMENTS = new Set(['--help', '-h'])
const JSON_ARGUMENT = '--json'
const EXCLUSIVE_INPUTS = [
  ['harness_only', 'full'],
]

/**
 * @typedef {Object} ParsedInvocation
 * @property {'help'|'run'} mode
 * @property {'text'|'json'} format
 * @property {Object} contract
 * @property {Record<string, string|boolean>} [values]
 */

export class CliInvocationError extends Error {
  /**
   * @param {string|null} argument
   * @param {string} reason
   */
  constructor(argument, reason) {
    super(reason)
    this.name = 'CliInvocationError'
    this.classification = 'INVALID_INVOCATION'
    this.exit_code = 2
    this.details = {
      argument: argument ?? null,
      reason,
    }
  }
}

function invalidInvocation(argument, reason) {
  throw new CliInvocationError(argument, reason)
}

function registeredContract(command, argument = command) {
  if (typeof command !== 'string' || command.trim() === '') {
    invalidInvocation(argument ?? null, 'command identity is required')
  }

  const contract = getCommandContract(command)
  if (contract === null) {
    invalidInvocation(command, `command is not registered: ${command}`)
  }
  return contract
}

function commandEntrypointMatches(expected, actual) {
  if (expected === actual) return true
  if (typeof expected !== 'string' || typeof actual !== 'string') return false

  try {
    return resolve(expected) === resolve(actual)
  } catch {
    return false
  }
}

/**
 * Resolve the package command identity for a direct facade invocation.
 *
 * @param {{
 *   fallback: string,
 *   env?: Record<string, string|undefined>,
 *   entrypoint?: string,
 * }} options
 * @returns {string}
 */
export function resolveCommandIdentity({
  fallback,
  env = process.env,
  entrypoint,
}) {
  const fallbackContract = registeredContract(fallback)
  const actualEntrypoint = entrypoint ?? fallbackContract.entrypoint

  if (typeof actualEntrypoint !== 'string' || actualEntrypoint.trim() === '') {
    invalidInvocation(fallback, 'running facade entrypoint is required')
  }

  const lifecycleEvent = env?.npm_lifecycle_event
  if (lifecycleEvent === undefined || lifecycleEvent === null || lifecycleEvent === '') {
    if (!commandEntrypointMatches(fallbackContract.entrypoint, actualEntrypoint)) {
      invalidInvocation(
        fallback,
        `fallback command entrypoint does not match the running facade: ${fallback}`,
      )
    }
    return fallback
  }

  if (typeof lifecycleEvent !== 'string') {
    invalidInvocation(null, 'npm_lifecycle_event must be a registered command')
  }

  const lifecycleContract = getCommandContract(lifecycleEvent)
  if (lifecycleContract === null) {
    invalidInvocation(
      lifecycleEvent,
      `npm_lifecycle_event is not a registered command: ${lifecycleEvent}`,
    )
  }

  if (!commandEntrypointMatches(lifecycleContract.entrypoint, actualEntrypoint)) {
    invalidInvocation(
      lifecycleEvent,
      `npm_lifecycle_event entrypoint does not match the running facade: ${lifecycleEvent}`,
    )
  }

  return lifecycleEvent
}

function normalizePositiveInteger(value, argument) {
  if (!POSITIVE_INTEGER_RE.test(value)) {
    invalidInvocation(argument, 'value must be a positive integer')
  }

  try {
    const integer = BigInt(value)
    if (integer > BigInt(Number.MAX_SAFE_INTEGER)) {
      invalidInvocation(argument, 'value exceeds JavaScript safe integer range')
    }
    return integer.toString()
  } catch {
    invalidInvocation(argument, 'value must be a positive integer')
  }
}

function normalizeRepository(value, argument) {
  if (!REPOSITORY_RE.test(value)) {
    invalidInvocation(argument, 'value must use owner/repository form')
  }
  return value.toLowerCase()
}

function normalizeFullSha(value, argument) {
  if (!FULL_SHA_RE.test(value)) {
    invalidInvocation(argument, 'value must be a full 40-character SHA')
  }
  return value.toLowerCase()
}

function normalizeInputValue(input, value, argument) {
  if (typeof value !== 'string' || value.trim() === '') {
    invalidInvocation(argument, 'value is required')
  }

  switch (input.value_type) {
    case 'positive_integer':
      return normalizePositiveInteger(value, argument)
    case 'repository':
      return normalizeRepository(value, argument)
    case 'full_sha':
      return normalizeFullSha(value, argument)
    case 'enum':
      if (!input.values.includes(value)) {
        invalidInvocation(
          argument,
          `value must be one of: ${input.values.join(', ')}`,
        )
      }
      return value
    case 'path':
    case 'string':
      return value
    default:
      invalidInvocation(
        argument,
        `unsupported input value type: ${String(input.value_type)}`,
      )
  }
}

function flagName(input) {
  const syntax = String(input.syntax ?? '').trim()
  const name = syntax.split(/\s+/, 1)[0]
  return name.startsWith('-') ? name : null
}

function normalizeArgv(argv) {
  if (!Array.isArray(argv) || argv.some((argument) => typeof argument !== 'string')) {
    invalidInvocation(null, 'argv must be an array of strings')
  }

  // pnpm inserts this separator before the command's arguments. It is the
  // only token that the boundary is allowed to discard.
  return argv.filter((argument) => argument !== '--')
}

function ensureNoExclusiveInputs(values, argument) {
  for (const [left, right] of EXCLUSIVE_INPUTS) {
    if (Object.hasOwn(values, left) && Object.hasOwn(values, right)) {
      invalidInvocation(
        argument,
        `${left} and ${right} are mutually exclusive`,
      )
    }
  }
}

/**
 * Parse and normalize one registered command invocation.
 *
 * @param {string} command
 * @param {string[]} argv
 * @returns {ParsedInvocation}
 */
export function parseCommandInvocation(command, argv = []) {
  const contract = registeredContract(command)
  const tokens = normalizeArgv(argv)
  const helpArguments = tokens.filter((argument) => HELP_ARGUMENTS.has(argument))
  const jsonArguments = tokens.filter((argument) => argument === JSON_ARGUMENT)

  if (helpArguments.length > 1) {
    invalidInvocation(helpArguments[1], 'help may be provided only once')
  }
  if (jsonArguments.length > 1) {
    invalidInvocation(jsonArguments[1], '--json may be provided only once')
  }

  const format = jsonArguments.length === 1 ? 'json' : 'text'
  if (helpArguments.length === 1) {
    return {
      mode: 'help',
      format,
      contract,
    }
  }

  const requiredInputs = Array.isArray(contract.required_inputs)
    ? contract.required_inputs
    : []
  const optionalFlags = Array.isArray(contract.optional_flags)
    ? contract.optional_flags
    : []
  const callerInputs = [...requiredInputs, ...optionalFlags]
    .filter((input) => input.source === 'caller')
  const flagInputs = callerInputs
    .filter((input) => input.kind === 'flag')
  const flagByName = new Map()

  for (const input of flagInputs) {
    const name = flagName(input)
    if (name === null) {
      invalidInvocation(input.name ?? null, `invalid flag syntax for ${input.name}`)
    }
    flagByName.set(name, input)
  }

  const rawValues = Object.create(null)
  const positionalValues = []
  const seenFlags = new Set()

  for (let index = 0; index < tokens.length; index += 1) {
    const argument = tokens[index]
    if (HELP_ARGUMENTS.has(argument) || argument === JSON_ARGUMENT) continue

    if (argument.startsWith('-')) {
      const input = flagByName.get(argument)
      if (!input) {
        invalidInvocation(argument, `unknown flag: ${argument}`)
      }
      if (seenFlags.has(input.name)) {
        invalidInvocation(argument, `input may be provided only once: ${argument}`)
      }
      seenFlags.add(input.name)

      if (input.value_type === 'boolean') {
        rawValues[input.name] = true
        continue
      }

      const value = tokens[index + 1]
      if (
        value === undefined ||
        value.startsWith('-') ||
        HELP_ARGUMENTS.has(value) ||
        value === JSON_ARGUMENT
      ) {
        invalidInvocation(argument, `${argument} requires one value`)
      }
      rawValues[input.name] = {
        value,
        argument,
        input,
      }
      index += 1
      continue
    }

    positionalValues.push({ value: argument, argument })
  }

  const positionalInputs = requiredInputs
    .filter((input) => input.kind === 'positional')

  if (positionalValues.length > positionalInputs.length) {
    invalidInvocation(
      positionalValues[positionalInputs.length].argument,
      'multiple positional values are not allowed',
    )
  }
  if (positionalValues.length < positionalInputs.length) {
    invalidInvocation(
      null,
      `missing positional input: ${positionalInputs[positionalValues.length].name}`,
    )
  }

  for (const [index, input] of positionalInputs.entries()) {
    const positional = positionalValues[index]
    rawValues[input.name] = {
      value: positional.value,
      argument: positional.argument,
      input,
    }
  }

  for (const input of requiredInputs) {
    if (input.kind === 'stdin') continue
    if (input.kind === 'positional') continue
    if (input.kind === 'flag' && !seenFlags.has(input.name)) {
      invalidInvocation(input.syntax ?? input.name, `missing required input: ${input.name}`)
    }
  }

  const values = {}
  for (const input of callerInputs) {
    if (!Object.hasOwn(rawValues, input.name)) continue
    const raw = rawValues[input.name]
    values[input.name] = raw === true
      ? true
      : normalizeInputValue(input, raw.value, raw.argument)
  }

  ensureNoExclusiveInputs(values, null)

  return {
    mode: 'run',
    format,
    values,
  }
}
