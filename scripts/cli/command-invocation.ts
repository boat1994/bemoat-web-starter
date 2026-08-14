import { resolve } from 'node:path'

import { z } from 'zod'

import { getCommandContract } from './command-contract.mjs'
import {
  EXCLUSIVE_INPUTS,
  FULL_SHA_RE,
  HELP_ARGUMENTS,
  JSON_ARGUMENT,
  POSITIVE_INTEGER_RE,
  REPOSITORY_RE,
  parseArgvBoundary,
  parseCommandInvocationBoundary,
  parseResolveCommandIdentityInput,
  type CommandContract,
  type CommandInput,
  type ParsedInvocation,
} from './command-invocation-schemas.ts'

export {
  type CommandContract,
  type CommandInput,
  type ParsedInvocation,
} from './command-invocation-schemas.ts'

export class CliInvocationError extends Error {
  readonly classification = 'INVALID_INVOCATION' as const
  readonly exit_code = 2 as const
  readonly details: { argument: string | null; reason: string }

  constructor(argument: string | null, reason: string) {
    super(reason)
    this.name = 'CliInvocationError'
    this.details = {
      argument: argument ?? null,
      reason,
    }
  }
}

function invalidInvocation(argument: string | null, reason: string): never {
  throw new CliInvocationError(argument, reason)
}

function registeredContract(command: unknown, argument: unknown = command): CommandContract {
  const schema = z.unknown().superRefine((value, context) => {
    if (typeof value !== 'string' || value.trim() === '') {
      context.addIssue({
        code: 'custom',
        message: 'command identity is required',
      })
      return
    }
    if (getCommandContract(value) === null) {
      context.addIssue({
        code: 'custom',
        message: `command is not registered: ${value}`,
      })
    }
  })
  const result = schema.safeParse(command)
  if (!result.success) {
    invalidInvocation(
      typeof argument === 'string' ? argument : null,
      result.error.issues[0]?.message ?? 'command identity is required',
    )
  }

  return getCommandContract(command as string) as CommandContract
}

function commandEntrypointMatches(expected: unknown, actual: unknown): boolean {
  if (expected === actual) return true
  if (typeof expected !== 'string' || typeof actual !== 'string') return false

  try {
    return resolve(expected) === resolve(actual)
  } catch {
    return false
  }
}

export function resolveCommandIdentity(input: {
  fallback: string
  env?: Record<string, string | undefined>
  entrypoint?: string
}): string {
  const {
    fallback: fallbackInput,
    env: envInput = process.env,
    entrypoint,
  } = parseResolveCommandIdentityInput(input)
  const fallbackContract = registeredContract(fallbackInput)
  const fallback = fallbackInput as string
  const env = envInput as Record<string, unknown>
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

  const lifecycleContract = getCommandContract(lifecycleEvent) as CommandContract | null
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

function normalizePositiveInteger(value: string, argument: string): string {
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

function normalizeRepository(value: string, argument: string): string {
  if (!REPOSITORY_RE.test(value)) {
    invalidInvocation(argument, 'value must use owner/repository form')
  }
  return value.toLowerCase()
}

function normalizeFullSha(value: string, argument: string): string {
  if (!FULL_SHA_RE.test(value)) {
    invalidInvocation(argument, 'value must be a full 40-character SHA')
  }
  return value.toLowerCase()
}

function normalizeInputValue(input: CommandInput, value: string, argument: string): string {
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
    case 'enum': {
      const allowed = input.values ?? []
      if (!allowed.includes(value)) {
        invalidInvocation(
          argument,
          `value must be one of: ${allowed.join(', ')}`,
        )
      }
      return value
    }
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

function flagName(input: CommandInput): string | null {
  const syntax = String(input.syntax ?? '').trim()
  const name = syntax.split(/\s+/, 1)[0]
  return name.startsWith('-') ? name : null
}

function normalizeArgv(argv: unknown): string[] {
  const parsed = parseArgvBoundary(argv)
  if (parsed === null) {
    invalidInvocation(null, 'argv must be an array of strings')
  }

  return parsed.filter((argument) => argument !== '--')
}

function ensureNoExclusiveInputs(
  values: Record<string, string | boolean>,
  argument: string | null,
): void {
  for (const [left, right] of EXCLUSIVE_INPUTS) {
    if (Object.hasOwn(values, left) && Object.hasOwn(values, right)) {
      invalidInvocation(
        argument,
        `${left} and ${right} are mutually exclusive`,
      )
    }
  }
}

type RawFlagValue =
  | true
  | {
      value: string
      argument: string
      input: CommandInput
    }

export function parseCommandInvocation(command: string, argv: string[] = []): ParsedInvocation {
  const boundary = parseCommandInvocationBoundary(command, argv)
  const contract = registeredContract(boundary.command)
  const tokens = normalizeArgv(boundary.argv)
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
  const flagByName = new Map<string, CommandInput>()

  for (const input of flagInputs) {
    const name = flagName(input)
    if (name === null) {
      invalidInvocation(input.name ?? null, `invalid flag syntax for ${input.name}`)
    }
    flagByName.set(name, input)
  }

  const rawValues: Record<string, RawFlagValue> = Object.create(null) as Record<string, RawFlagValue>
  const positionalValues: Array<{ value: string; argument: string }> = []
  const seenFlags = new Set<string>()

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

  const values: Record<string, string | boolean> = {}
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
    contract,
  }
}
