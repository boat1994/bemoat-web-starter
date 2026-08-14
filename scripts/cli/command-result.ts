import {
  CLI_EXIT_CODES,
  createResultInputSchema,
  normalizeCommonValue,
  parseCreateResultInput,
  parseDelegatedFailureInput,
  resultEnvelopeV1Schema,
  throwTypeErrorFromZod,
  type CliClassification,
  type CreateResultInput,
} from './command-result-schemas.ts'

export {
  CLI_EXIT_CODES,
  type CliClassification,
  type NextAction,
  type ResultEnvelopeV1,
  type ResultOutcome,
} from './command-result-schemas.ts'

export function classifyDelegatedFailure(
  input: unknown = {},
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
  const result = resultEnvelopeV1Schema.safeParse(value)
  if (!result.success) {
    throwTypeErrorFromZod(result.error)
  }
  return value as Record<string, unknown>
}

export function createResultEnvelopeV1(input: CreateResultInput = {}): Record<string, unknown> {
  createResultInputSchema.safeParse(input === undefined ? {} : input)
  const validatedInput = parseCreateResultInput(input)
  const envelope = {
    schema_version: 1 as const,
    command: validatedInput.command,
    mode: 'result' as const,
    outcome: validatedInput.outcome,
    classification: validatedInput.classification,
    mutation_performed: validatedInput.mutation_performed ?? false,
    observed_pre_state: normalizeCommonValue(
      'observed_pre_state',
      validatedInput.observed_pre_state,
    ),
    resulting_state: normalizeCommonValue(
      'resulting_state',
      validatedInput.resulting_state,
    ),
    repository: normalizeCommonValue('repository', validatedInput.repository),
    issue_number: normalizeCommonValue('issue_number', validatedInput.issue_number),
    pr_number: normalizeCommonValue('pr_number', validatedInput.pr_number),
    exact_head: normalizeCommonValue('exact_head', validatedInput.exact_head),
    evidence_ids: validatedInput.evidence_ids ?? {},
    next_action: validatedInput.next_action ?? {
      type: 'COMPLETE',
      command: null,
      reason: 'The command completed its registered operation.',
    },
    details: validatedInput.details ?? {},
  }

  return assertResultEnvelopeV1(envelope)
}
