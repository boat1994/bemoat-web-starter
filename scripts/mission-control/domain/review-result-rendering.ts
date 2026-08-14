import { CliInvocationError } from '../../cli/command-invocation.mjs'
import {
  CLI_EXIT_CODES,
  classificationExitCode,
  createResultEnvelopeV1,
} from '../../cli/command-result.mjs'

type RuntimeObject = { [key: string]: unknown }
const FULL_SHA_RE = /^[0-9a-f]{40}$/i

function isRuntimeObject(value: unknown): value is RuntimeObject {
  return Boolean(value) && typeof value === 'object'
}

function property(value: unknown, key: string): unknown {
  return isRuntimeObject(value) ? Reflect.get(value, key) : undefined
}

export function runtimeError(
  classification: unknown,
  message: string,
  details: Record<string, unknown> = {},
) {
  return Object.assign(new Error(message), { classification }, details)
}

function runtimeClassification(error: unknown): string {
  const explicit = property(error, 'classification')
  if (typeof explicit === 'string' && Object.hasOwn(CLI_EXIT_CODES, explicit)) return explicit

  const reason = error instanceof Error ? error.message : String(error)
  const prefix = reason.match(/^(?:ERROR:\s*)?([A-Z_]+):/)
  if (prefix && Object.hasOwn(CLI_EXIT_CODES, prefix[1])) return prefix[1]
  if (/\b(?:gh|GitHub|network|remote)\b/i.test(reason)) return 'BLOCKED_EXTERNAL'
  return 'INTERNAL_ERROR'
}

function runtimeDetails(error: unknown): RuntimeObject {
  const invocationDetails = property(error, 'details')
  const details: RuntimeObject = error instanceof CliInvocationError
    ? {
      argument: property(invocationDetails, 'argument'),
      reason: property(invocationDetails, 'reason'),
    }
    : {
      argument: null,
      reason: error instanceof Error ? error.message : String(error),
    }

  const errors = property(error, 'errors')
  if (Array.isArray(errors)) details.errors = errors
  const legacyClassification = property(error, 'legacyClassification')
  if (typeof legacyClassification === 'string') details.legacy_classification = legacyClassification
  return details
}

function normalizedHead(value: unknown): string | null {
  return typeof value === 'string' && FULL_SHA_RE.test(value) ? value.toLowerCase() : null
}

export type ReviewRuntimeErrorRenderingOptions = {
  command?: unknown
  format?: unknown
  error: unknown
  mutationPerformed?: boolean
  values?: RuntimeObject
  parsedVerdict?: RuntimeObject | null
}

export function createRuntimeErrorRendering({
  command,
  format,
  error,
  mutationPerformed = false,
  values = {},
  parsedVerdict = null,
}: ReviewRuntimeErrorRenderingOptions) {
  const classification = runtimeClassification(error)
  const details = runtimeDetails(error)
  const mutated = Boolean(mutationPerformed || property(error, 'mutationPerformed') === true)
  const parsedHead = property(parsedVerdict, 'headSha')
  const expectedHead = property(values, 'expected_head')
  const envelope = format === 'json' && command
    ? createResultEnvelopeV1({
      command,
      outcome: 'ERROR',
      classification,
      mutation_performed: mutated,
      repository: property(values, 'repository') ?? null,
      issue_number: property(values, 'issue_number') ?? null,
      pr_number: property(parsedVerdict, 'prNumber') ?? null,
      exact_head: normalizedHead(parsedHead ?? expectedHead),
      next_action: { type: 'STOP', command: null, reason: details.reason },
      details,
    })
    : null

  if (envelope) {
    return { envelope, output: `${JSON.stringify(envelope)}\n`, stream: 'stdout', exitCode: classificationExitCode(classification) }
  }
  if (error instanceof CliInvocationError) {
    return { envelope: null, output: `${classification}: ${details.reason}\n`, stream: 'stderr', exitCode: classificationExitCode(classification) }
  }
  if (classification === 'BLOCKED_EXTERNAL') {
    return { envelope: null, output: `${classification}: ${details.reason}\n`, stream: 'stdout', exitCode: classificationExitCode(classification) }
  }
  const legacyClassification = property(details, 'legacy_classification')
  const legacyPrefix = typeof legacyClassification === 'string' ? `${legacyClassification}: ` : ''
  return {
    envelope: null,
    output: `ERROR: ${classification}: ${legacyPrefix}${details.reason}\n`,
    stream: 'stderr',
    exitCode: classificationExitCode(classification),
  }
}

export type ReviewResultRenderingOptions = {
  command: unknown
  options: RuntimeObject & { expectedHead: string }
  result: RuntimeObject & {
    state: { state: unknown }
    comment: { id: unknown }
  }
  repository: unknown
  observedPreState: unknown
}

export function createResultRendering({ command, options, result, repository, observedPreState }: ReviewResultRenderingOptions) {
  const replayed = property(result, 'replayed') === true
  const state = result.state
  const comment = result.comment
  const outcome = property(result, 'outcome')
  const classification = replayed ? 'NO_OP_IDENTICAL_RETRY' : 'SUCCESS'
  const output = `Mission Control review ${replayed ? 'NO_OP_IDENTICAL_RETRY' : outcome}: ${state.state} + REVIEW_VERDICT comment ${comment.id}`
  const envelope = createResultEnvelopeV1({
    command,
    outcome: replayed ? 'NO_OP' : 'SUCCESS',
    classification,
    mutation_performed: !replayed,
    observed_pre_state: observedPreState,
    resulting_state: property(state, 'state') ?? null,
    repository,
    issue_number: property(options, 'issue'),
    pr_number: property(options, 'prNumber'),
    exact_head: options.expectedHead.length === 40
      ? options.expectedHead.toLowerCase()
      : null,
    next_action: replayed
      ? { type: 'COMPLETE', command: null, reason: 'The identical REVIEW_VERDICT retry is already durable; no further dispatch is required.' }
      : { type: 'COMMAND', command: 'bemoat:mission-control:dispatch', reason: 'The resulting review state determines the next bounded dispatch or Founder gate.' },
    details: {
      legacy_classification: replayed ? 'NO_OP' : outcome,
      legacy_output: [output],
      comment_id: String(property(comment, 'id')),
      ...(replayed ? { replayed: true } : {}),
    },
  })
  return { envelope, output, exitCode: classificationExitCode(classification) }
}
