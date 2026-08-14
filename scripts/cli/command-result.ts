import { getCommandContract } from './command-contract.mjs'
import {
  CLI_EXIT_CODES,
  FULL_SHA_INPUT_RE,
  FULL_SHA_RE,
  NEXT_ACTION_KEYS,
  NEXT_ACTION_TYPES,
  POSITIVE_INTEGER_RE,
  REPOSITORY_RE,
  RESULT_CLASSIFICATIONS,
  RESULT_KEYS,
  RESULT_OUTCOMES,
  parseDelegatedFailureInput,
  type CliClassification,
  type NextAction,
  type ResultOutcome,
} from './command-result-schemas.ts'

export {
  CLI_EXIT_CODES,
  type CliClassification,
  type NextAction,
  type ResultEnvelopeV1,
  type ResultOutcome,
} from './command-result-schemas.ts'

type CreateResultInput = {
  command?: unknown
  outcome?: unknown
  classification?: unknown
  mutation_performed?: unknown
  observed_pre_state?: unknown
  resulting_state?: unknown
  repository?: unknown
  issue_number?: unknown
  pr_number?: unknown
  exact_head?: unknown
  evidence_ids?: unknown
  next_action?: unknown
  details?: unknown
}

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

function normalizePositiveInteger(value: unknown, field: string): string | null {
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

function normalizeRepository(value: unknown): string | null {
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

function normalizeExactHead(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || !FULL_SHA_INPUT_RE.test(value)) {
    typeError('exact_head must be a full 40-character SHA or null')
  }
  return value.toLowerCase()
}

function normalizeCommonValue(field: string, value: unknown): string | null {
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

export function classifyDelegatedFailure(
  input: {
    command?: string
    stdout?: string
    stderr?: string
    error?: { message?: string } | null
  } = {},
): CliClassification | 'INTERNAL_ERROR' | 'BLOCKED_EXTERNAL' {
  const parsed = parseDelegatedFailureInput(input)
  const output = [parsed.stderr, parsed.stdout, parsed.error?.message]
    .filter((value) => value)
    .join('\n')
  const match = output.match(/(?:^|\n)\s*(?:ERROR:\s*)?([A-Z_]+):/)
  if (match && Object.hasOwn(CLI_EXIT_CODES, match[1])) {
    return match[1] as CliClassification
  }
  return parsed.command === 'gh' ? 'BLOCKED_EXTERNAL' : 'INTERNAL_ERROR'
}

export function classificationExitCode(classification: unknown): number {
  if (
    typeof classification !== 'string' ||
    !Object.hasOwn(CLI_EXIT_CODES, classification)
  ) {
    throw new RangeError(`unknown CLI classification: ${String(classification)}`)
  }
  return CLI_EXIT_CODES[classification as CliClassification]
}

export function assertResultEnvelopeV1(value: unknown): Record<string, unknown> {
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

  return value as Record<string, unknown>
}

export function createResultEnvelopeV1(input: CreateResultInput = {}): Record<string, unknown> {
  const envelope = {
    schema_version: 1 as const,
    command: input.command,
    mode: 'result' as const,
    outcome: input.outcome,
    classification: input.classification,
    mutation_performed: input.mutation_performed ?? false,
    observed_pre_state: normalizeCommonValue(
      'observed_pre_state',
      input.observed_pre_state,
    ),
    resulting_state: normalizeCommonValue(
      'resulting_state',
      input.resulting_state,
    ),
    repository: normalizeCommonValue('repository', input.repository),
    issue_number: normalizeCommonValue('issue_number', input.issue_number),
    pr_number: normalizeCommonValue('pr_number', input.pr_number),
    exact_head: normalizeCommonValue('exact_head', input.exact_head),
    evidence_ids: input.evidence_ids ?? {},
    next_action: input.next_action ?? {
      type: 'COMPLETE',
      command: null,
      reason: 'The command completed its registered operation.',
    },
    details: input.details ?? {},
  }

  return assertResultEnvelopeV1(envelope)
}
