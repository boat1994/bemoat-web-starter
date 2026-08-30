import { CliInvocationError } from '../../cli/command-invocation.mjs'
import {
  CLI_EXIT_CODES,
  classificationExitCode,
  createResultEnvelopeV1,
} from '../../cli/command-result.mjs'

type RuntimeObject = { [key: string]: unknown }

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
  const prefix = reason.match(/^([A-Z_]+):/)
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
  if (typeof legacyClassification === 'string') {
    details.legacy_classification = legacyClassification
  }
  return details
}

export type RuntimeErrorRenderingOptions = {
  command?: unknown
  format?: unknown
  error: unknown
  values?: RuntimeObject
}

export function createRuntimeErrorRendering({
  command,
  format,
  error,
  values = {},
}: RuntimeErrorRenderingOptions) {
  const classification = runtimeClassification(error)
  const details = runtimeDetails(error)
  const mutationPerformed = property(error, 'mutationPerformed') === true
  const envelope = format === 'json' && command
    ? createResultEnvelopeV1({
      command,
      outcome: 'ERROR',
      classification,
      mutation_performed: mutationPerformed,
      repository: values.repository ?? null,
      issue_number: values.issue_number ?? null,
      next_action: {
        type: 'STOP',
        command: null,
        reason: details.reason,
      },
      details,
    })
    : null

  if (envelope) {
    return {
      envelope,
      output: `${JSON.stringify(envelope)}\n`,
      stream: 'stdout',
      exitCode: classificationExitCode(classification),
    }
  }

  if (error instanceof CliInvocationError) {
    return {
      envelope: null,
      output: `${classification}: ${details.reason}\n`,
      stream: 'stderr',
      exitCode: classificationExitCode(classification),
    }
  }

  if (classification === 'BLOCKED_EXTERNAL') {
    return {
      envelope: null,
      output: `${classification}: ${details.reason}\n`,
      stream: 'stdout',
      exitCode: classificationExitCode(classification),
    }
  }

  const legacyPrefix = typeof details.legacy_classification === 'string'
    ? `${details.legacy_classification}: `
    : ''
  return {
    envelope: null,
    output: `ERROR: ${classification}: ${legacyPrefix}${details.reason}\n`,
    stream: 'stderr',
    exitCode: classificationExitCode(classification),
  }
}

function normalizedHead(value: unknown): string | null {
  return typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value) ? value.toLowerCase() : null
}

function legacyOutputForResult(result: RuntimeObject): string {
  if (result.outcome === 'DISPATCHED_FOUNDER_AUTHORIZED_CORRECTION') {
    return 'Mission Control dispatch DISPATCHED_FOUNDER_AUTHORIZED_CORRECTION: FOUNDER_AUTHORIZED_CORRECTION -> IN_PROGRESS + HANDOFF'
  }
  const comment = property(result, 'comment')
  return `Mission Control dispatch ${result.outcome}: READY -> IN_PROGRESS + HANDOFF comment ${property(comment, 'id') ?? 'unknown'}`
}

export type DispatchResultRenderingOptions = {
  command: unknown
  format: unknown
  options: RuntimeObject
  result: RuntimeObject
  observedPreState: unknown
  parsedBody: RuntimeObject
}

export function createResultRendering({
  command,
  format,
  options,
  result,
  observedPreState,
  parsedBody,
}: DispatchResultRenderingOptions) {
  const legacyClassification = result.outcome ?? 'DISPATCHED'
  const isNoOp = legacyClassification === 'NO_OP'
  const state = property(result, 'state')
  const output = legacyOutputForResult(result)
  const comment = property(result, 'comment')
  const identity = property(result, 'identity')
  const envelope = createResultEnvelopeV1({
    command,
    outcome: isNoOp ? 'NO_OP' : 'SUCCESS',
    classification: isNoOp ? 'NO_OP_IDENTICAL_RETRY' : 'SUCCESS',
    mutation_performed: !isNoOp,
    observed_pre_state: observedPreState,
    resulting_state: property(state, 'state') ?? null,
    repository: options.repo,
    issue_number: options.issue,
    pr_number: parsedBody.prNumber ?? String(property(state, 'active_pr') ?? '').match(/\d+/)?.[0] ?? null,
    exact_head: normalizedHead(parsedBody.headSha ?? property(state, 'current_head')),
    next_action: isNoOp
      ? {
        type: 'COMPLETE',
        command: null,
        reason: 'The identical dispatch claim is already durable.',
      }
      : {
        type: 'FOUNDER_GATE',
        command: null,
        reason: 'The historical delivery coordinator was retired; stop before continuing this migration-only route.',
      },
    details: {
      legacy_classification: legacyClassification,
      legacy_output: [output],
      ...(property(comment, 'id') != null ? { comment_id: String(property(comment, 'id')) } : {}),
      ...(identity ? { transition_identity: JSON.stringify(identity) } : {}),
      ...(result.recovered ? { recovered: true } : {}),
    },
  })

  return {
    envelope,
    output: format === 'json'
      ? `${JSON.stringify(envelope)}\n`
      : `${envelope.classification}: ${output}\n`,
    stream: 'stdout',
    exitCode: classificationExitCode(isNoOp ? 'NO_OP_IDENTICAL_RETRY' : 'SUCCESS'),
  }
}
