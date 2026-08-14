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

export type DelegatedFailureInput = {
  command?: string
  stdout?: string
  stderr?: string
  error?: { message?: string } | null
}

export function parseDelegatedFailureInput(
  input: DelegatedFailureInput = {},
): Required<Pick<DelegatedFailureInput, 'command' | 'stdout' | 'stderr'>> & {
  error: { message?: string } | null
} {
  return {
    command: input.command ?? '',
    stdout: input.stdout ?? '',
    stderr: input.stderr ?? '',
    error: input.error ?? null,
  }
}
