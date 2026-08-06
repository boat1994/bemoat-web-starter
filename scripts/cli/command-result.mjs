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

const CANONICAL_CLASSIFICATIONS = new Set(Object.keys(CLI_EXIT_CODES))
const RESULT_CLASSIFICATIONS = new Set(
  [...CANONICAL_CLASSIFICATIONS].filter((classification) => classification !== 'HELP'),
)
const RESULT_OUTCOMES = new Set(['SUCCESS', 'NO_OP', 'STOP', 'ERROR'])
const NEXT_ACTION_TYPES = new Set(['COMMAND', 'FOUNDER_GATE', 'STOP', 'COMPLETE'])
const RESULT_KEYS = [
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
]
const NEXT_ACTION_KEYS = ['type', 'command', 'reason']
const POSITIVE_INTEGER_RE = /^[1-9]\d*$/
const REPOSITORY_RE = /^[^/\s:]+\/[^/\s:]+$/
const FULL_SHA_RE = /^[0-9a-f]{40}$/
const FULL_SHA_INPUT_RE = /^[0-9a-f]{40}$/i

function isRecord(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function exactKeys(value, expected) {
  return isRecord(value) &&
    Object.keys(value).sort().join('\u0000') === [...expected].sort().join('\u0000')
}

function typeError(message) {
  throw new TypeError(message)
}

function assertNullableString(value, field) {
  if (value !== null && (typeof value !== 'string' || value.trim() === '')) {
    typeError(`${field} must be a non-empty string or null`)
  }
}

function assertPositiveInteger(value, field) {
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

function assertRepository(value) {
  if (value !== null && (
    typeof value !== 'string' ||
    !REPOSITORY_RE.test(value) ||
    value !== value.toLowerCase()
  )) {
    typeError('repository must be a lowercase owner/repository string or null')
  }
}

function assertExactHead(value) {
  if (value !== null && (
    typeof value !== 'string' ||
    !FULL_SHA_RE.test(value)
  )) {
    typeError('exact_head must be a lowercase full SHA or null')
  }
}

function normalizePositiveInteger(value, field) {
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

function normalizeRepository(value) {
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

function normalizeExactHead(value) {
  if (value === null) return null
  if (typeof value !== 'string' || !FULL_SHA_INPUT_RE.test(value)) {
    typeError('exact_head must be a full 40-character SHA or null')
  }
  return value.toLowerCase()
}

function normalizeCommonValue(field, value) {
  if (value === undefined) return null
  if (field === 'repository') return normalizeRepository(value)
  if (field === 'issue_number' || field === 'pr_number') {
    return normalizePositiveInteger(value, field)
  }
  if (field === 'exact_head') return normalizeExactHead(value)
  if (value !== null && (typeof value !== 'string' || value.trim() === '')) {
    typeError(`${field} must be a non-empty string or null`)
  }
  return value
}

function assertEvidenceIds(value) {
  if (!isRecord(value)) typeError('evidence_ids must be an object')
  for (const [key, evidenceId] of Object.entries(value)) {
    if (key.trim() === '' || typeof evidenceId !== 'string' || evidenceId.trim() === '') {
      typeError('evidence_ids must contain non-empty string values')
    }
  }
}

function assertNextAction(value) {
  if (!exactKeys(value, NEXT_ACTION_KEYS)) {
    typeError('next_action must contain exactly type, command, and reason')
  }
  if (!NEXT_ACTION_TYPES.has(value.type)) {
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

/**
 * Return the canonical process exit code for a classification.
 *
 * @param {string} classification
 * @returns {number}
 */
export function classificationExitCode(classification) {
  if (
    typeof classification !== 'string' ||
    !Object.hasOwn(CLI_EXIT_CODES, classification)
  ) {
    throw new RangeError(`unknown CLI classification: ${String(classification)}`)
  }
  return CLI_EXIT_CODES[classification]
}

/**
 * Validate a schema-version-1 runtime result envelope.
 *
 * @param {unknown} value
 * @returns {object}
 */
export function assertResultEnvelopeV1(value) {
  if (!exactKeys(value, RESULT_KEYS)) {
    typeError('result envelope must contain exactly the schema-v1 result fields')
  }

  if (value.schema_version !== 1) typeError('result schema_version must be 1')
  if (typeof value.command !== 'string' || getCommandContract(value.command) === null) {
    typeError('result command must be a registered command')
  }
  if (value.mode !== 'result') typeError('result mode must be result')
  if (!RESULT_OUTCOMES.has(value.outcome)) {
    typeError(`result outcome is invalid: ${String(value.outcome)}`)
  }
  if (!RESULT_CLASSIFICATIONS.has(value.classification)) {
    typeError(`result classification is invalid: ${String(value.classification)}`)
  }
  if (typeof value.mutation_performed !== 'boolean') {
    typeError('mutation_performed must be boolean')
  }

  for (const field of [
    'observed_pre_state',
    'resulting_state',
  ]) {
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

/**
 * Create and validate a schema-version-1 runtime result envelope.
 *
 * @param {Record<string, unknown>} input
 * @returns {Record<string, unknown>}
 */
export function createResultEnvelopeV1(input = {}) {
  const envelope = {
    schema_version: 1,
    command: input.command,
    mode: 'result',
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
