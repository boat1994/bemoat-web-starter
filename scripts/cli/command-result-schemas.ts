import { z } from 'zod'

import { getCommandContract } from './command-contract.mjs'

export const CLI_EXIT_CODES = Object.freeze({
  HELP: 0,
  SUCCESS: 0,
  NO_OP_IDENTICAL_RETRY: 0,
  INTERNAL_ERROR: 1,
  INVALID_INVOCATION: 2,
  UNSUPPORTED_PRE_STATE: 3,
  STATE_CONFLICT: 3,
  AUTHORITY_CONFLICT: 3,
  HEAD_DRIFT: 3,
  BLOCKED_EXTERNAL: 3,
  EVIDENCE_CONFLICT: 3,
  AMBIGUOUS_RESULT: 4,
})

export type CliClassification = keyof typeof CLI_EXIT_CODES

export const CANONICAL_CLASSIFICATIONS = new Set(Object.keys(CLI_EXIT_CODES))
export const RESULT_CLASSIFICATIONS = new Set(
  [...CANONICAL_CLASSIFICATIONS].filter((classification) => classification !== 'HELP'),
)
export const RESULT_OUTCOMES = new Set(['SUCCESS', 'NO_OP', 'STOP', 'ERROR'])
export const NEXT_ACTION_TYPES = new Set(['COMMAND', 'FOUNDER_GATE', 'STOP', 'COMPLETE'])

export const RESULT_KEYS = [
  'schema_version',
  'command',
  'mode',
  'outcome',
  'classification',
  'mutation_performed',
  'observed_pre_state',
  'resulting_state',
  'repository',
  'issue_number',
  'pr_number',
  'exact_head',
  'evidence_ids',
  'next_action',
  'details',
] as const

export const NEXT_ACTION_KEYS = ['type', 'command', 'reason'] as const

export const POSITIVE_INTEGER_RE = /^[1-9]\d*$/
export const REPOSITORY_RE = /^[^/\s:]+\/[^/\s:]+$/
export const FULL_SHA_RE = /^[0-9a-f]{40}$/
export const FULL_SHA_INPUT_RE = /^[0-9a-f]{40}$/i

export type ResultOutcome = 'SUCCESS' | 'NO_OP' | 'STOP' | 'ERROR'
export type NextActionType = 'COMMAND' | 'FOUNDER_GATE' | 'STOP' | 'COMPLETE'

export type NextAction = {
  type: NextActionType
  command: string | null
  reason: string
}

export type ResultEnvelopeV1 = {
  schema_version: 1
  command: string
  mode: 'result'
  outcome: ResultOutcome
  classification: Exclude<CliClassification, 'HELP'>
  mutation_performed: boolean
  observed_pre_state: string | null
  resulting_state: string | null
  repository: string | null
  issue_number: string | null
  pr_number: string | null
  exact_head: string | null
  evidence_ids: Record<string, string>
  next_action: NextAction
  details: Record<string, unknown>
}

export const delegatedFailureInputSchema = z.looseObject({
  command: z.unknown().optional(),
  stdout: z.unknown().optional(),
  stderr: z.unknown().optional(),
  error: z.unknown().optional(),
})

export type DelegatedFailureInput = z.infer<typeof delegatedFailureInputSchema>

export const createResultInputSchema = z.looseObject({
  command: z.unknown().optional(),
  outcome: z.unknown().optional(),
  classification: z.unknown().optional(),
  mutation_performed: z.unknown().optional(),
  observed_pre_state: z.unknown().optional(),
  resulting_state: z.unknown().optional(),
  repository: z.unknown().optional(),
  issue_number: z.unknown().optional(),
  pr_number: z.unknown().optional(),
  exact_head: z.unknown().optional(),
  evidence_ids: z.unknown().optional(),
  next_action: z.unknown().optional(),
  details: z.unknown().optional(),
})

export type CreateResultInput = z.infer<typeof createResultInputSchema>

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join('\u0000') === [...expected].sort().join('\u0000')
}

function typeError(message: string): never {
  throw new TypeError(message)
}

export function throwTypeErrorFromZod(error: z.ZodError): never {
  const message = error.issues[0]?.message
  typeError(message ?? 'validation failed')
}

function assertNullableString(value: unknown, field: string): void {
  if (value !== null && (typeof value !== 'string' || value.trim() === '')) {
    typeError(`${field} must be a non-empty string or null`)
  }
}

function assertPositiveInteger(value: unknown, field: string): void {
  if (value === null) return
  if (typeof value !== 'string' || !POSITIVE_INTEGER_RE.test(value)) {
    typeError(`${field} must be a canonical positive integer string or null`)
  }
  try {
    if (BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)) {
      typeError(`${field} exceeds JavaScript safe integer range`)
    }
  } catch {
    typeError(`${field} must be a canonical positive integer string or null`)
  }
}

function assertRepository(value: unknown): void {
  if (value !== null && (
    typeof value !== 'string' ||
    !REPOSITORY_RE.test(value) ||
    value !== value.toLowerCase()
  )) {
    typeError('repository must be a lowercase owner/repository string or null')
  }
}

function assertExactHead(value: unknown): void {
  if (value !== null && (
    typeof value !== 'string' ||
    !FULL_SHA_RE.test(value)
  )) {
    typeError('exact_head must be a lowercase full SHA or null')
  }
}

function assertEvidenceIds(value: unknown): void {
  if (!isRecord(value)) typeError('evidence_ids must be an object')
  for (const [key, evidenceId] of Object.entries(value)) {
    if (key.trim() === '' || typeof evidenceId !== 'string' || evidenceId.trim() === '') {
      typeError('evidence_ids must contain non-empty string values')
    }
  }
}

function assertNextAction(value: unknown): asserts value is NextAction {
  if (!isRecord(value) || !exactKeys(value, NEXT_ACTION_KEYS)) {
    typeError('next_action must contain exactly type, command, and reason')
  }
  if (!NEXT_ACTION_TYPES.has(value.type as NextAction['type'])) {
    typeError(`next_action.type is invalid: ${String(value.type)}`)
  }
  if (typeof value.reason !== 'string' || value.reason.trim() === '') {
    typeError('next_action.reason must be a non-empty string')
  }

  if (value.type === 'COMMAND') {
    if (
      typeof value.command !== 'string' ||
      getCommandContract(value.command) === null
    ) {
      typeError('next_action.command must be a registered command')
    }
    return
  }

  if (value.command !== null) {
    typeError('next_action.command must be null for a non-command action')
  }
}

export function validateResultEnvelopeV1Shape(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || !exactKeys(value, RESULT_KEYS)) {
    typeError('result envelope must contain exactly the schema-v1 result fields')
  }

  if (value.schema_version !== 1) typeError('result schema_version must be 1')
  if (typeof value.command !== 'string' || getCommandContract(value.command) === null) {
    typeError('result command must be a registered command')
  }
  if (value.mode !== 'result') typeError('result mode must be result')
  if (!RESULT_OUTCOMES.has(value.outcome as ResultOutcome)) {
    typeError(`result outcome is invalid: ${String(value.outcome)}`)
  }
  if (!RESULT_CLASSIFICATIONS.has(value.classification as Exclude<CliClassification, 'HELP'>)) {
    typeError(`result classification is invalid: ${String(value.classification)}`)
  }
  if (typeof value.mutation_performed !== 'boolean') {
    typeError('mutation_performed must be boolean')
  }

  for (const field of [
    'observed_pre_state',
    'resulting_state',
  ] as const) {
    assertNullableString(value[field], field)
  }
  assertRepository(value.repository)
  assertPositiveInteger(value.issue_number, 'issue_number')
  assertPositiveInteger(value.pr_number, 'pr_number')
  assertExactHead(value.exact_head)
  assertEvidenceIds(value.evidence_ids)
  assertNextAction(value.next_action)
  if (!isRecord(value.details)) typeError('details must be an object')

  return value
}

export const resultEnvelopeV1Schema = z.unknown().superRefine((value, context) => {
  try {
    validateResultEnvelopeV1Shape(value)
  } catch (error) {
    if (error instanceof TypeError) {
      context.addIssue({
        code: 'custom',
        message: error.message,
      })
      return
    }
    throw error
  }
})

export function normalizePositiveInteger(value: unknown, field: string): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || !POSITIVE_INTEGER_RE.test(value)) {
    typeError(`${field} must be a positive integer string or null`)
  }
  try {
    const integer = BigInt(value)
    if (integer > BigInt(Number.MAX_SAFE_INTEGER)) {
      typeError(`${field} exceeds JavaScript safe integer range`)
    }
    return integer.toString()
  } catch {
    typeError(`${field} must be a positive integer string or null`)
  }
}

export function normalizeRepository(value: unknown): string | null {
  if (value === null) return null
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    !REPOSITORY_RE.test(value)
  ) {
    typeError('repository must use owner/repository form or null')
  }
  return value.toLowerCase()
}

export function normalizeExactHead(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || !FULL_SHA_INPUT_RE.test(value)) {
    typeError('exact_head must be a full 40-character SHA or null')
  }
  return value.toLowerCase()
}

export function normalizeCommonValue(field: string, value: unknown): string | null {
  if (value === undefined) return null
  if (field === 'repository') return normalizeRepository(value)
  if (field === 'issue_number' || field === 'pr_number') {
    return normalizePositiveInteger(value, field)
  }
  if (field === 'exact_head') return normalizeExactHead(value)
  if (value !== null && (typeof value !== 'string' || value.trim() === '')) {
    typeError(`${field} must be a non-empty string or null`)
  }
  return value as string | null
}

function readDelegatedFailureField(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readDelegatedFailureError(
  value: unknown,
): { message?: string } | null {
  if (value === undefined) return null
  if (value === null) return null
  if (typeof value === 'object' && !Array.isArray(value)) {
    const message = Reflect.get(value, 'message')
    return typeof message === 'string' ? { message } : {}
  }
  return null
}

function readCreateResultField<K extends keyof CreateResultInput>(
  source: Record<string, unknown>,
  key: K,
): CreateResultInput[K] {
  return source[key]
}

export function parseDelegatedFailureInput(
  input: unknown = {},
): Required<Pick<DelegatedFailureInput, 'command' | 'stdout' | 'stderr'>> & {
  error: { message?: string } | null
} {
  if (input === undefined) {
    input = {}
  }

  const parsed = delegatedFailureInputSchema.safeParse(input)
  if (parsed.success) {
    const source = parsed.data
    return {
      command: readDelegatedFailureField(source.command),
      stdout: readDelegatedFailureField(source.stdout),
      stderr: readDelegatedFailureField(source.stderr),
      error: readDelegatedFailureError(source.error),
    }
  }

  if (!isRecord(input)) {
    return {
      command: '',
      stdout: '',
      stderr: '',
      error: null,
    }
  }

  return {
    command: readDelegatedFailureField(input.command),
    stdout: readDelegatedFailureField(input.stdout),
    stderr: readDelegatedFailureField(input.stderr),
    error: readDelegatedFailureError(input.error),
  }
}

export function parseCreateResultInput(input: unknown = {}): CreateResultInput {
  if (input === undefined) {
    input = {}
  }

  const parsed = createResultInputSchema.safeParse(input)
  if (parsed.success) {
    return parsed.data
  }

  if (!isRecord(input)) {
    return {}
  }

  return {
    command: readCreateResultField(input, 'command'),
    outcome: readCreateResultField(input, 'outcome'),
    classification: readCreateResultField(input, 'classification'),
    mutation_performed: readCreateResultField(input, 'mutation_performed'),
    observed_pre_state: readCreateResultField(input, 'observed_pre_state'),
    resulting_state: readCreateResultField(input, 'resulting_state'),
    repository: readCreateResultField(input, 'repository'),
    issue_number: readCreateResultField(input, 'issue_number'),
    pr_number: readCreateResultField(input, 'pr_number'),
    exact_head: readCreateResultField(input, 'exact_head'),
    evidence_ids: readCreateResultField(input, 'evidence_ids'),
    next_action: readCreateResultField(input, 'next_action'),
    details: readCreateResultField(input, 'details'),
  }
}
