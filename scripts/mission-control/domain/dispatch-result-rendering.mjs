import { CliInvocationError } from '../../cli/command-invocation.mjs'
import {
  CLI_EXIT_CODES,
  classificationExitCode,
  createResultEnvelopeV1,
} from '../../cli/command-result.mjs'

export function runtimeError(classification, message, details = {}) {
  const error = new Error(message)
  error.classification = classification
  Object.assign(error, details)
  return error
}

function runtimeClassification(error) {
  if (
    error &&
    typeof error === 'object' &&
    typeof error.classification === 'string' &&
    Object.hasOwn(CLI_EXIT_CODES, error.classification)
  ) {
    return error.classification
  }

  const reason = error instanceof Error ? error.message : String(error)
  const prefix = reason.match(/^([A-Z_]+):/)
  if (prefix && Object.hasOwn(CLI_EXIT_CODES, prefix[1])) return prefix[1]
  if (/\b(?:gh|GitHub|network|remote)\b/i.test(reason)) return 'BLOCKED_EXTERNAL'
  return 'INTERNAL_ERROR'
}

function runtimeDetails(error) {
  const details = error instanceof CliInvocationError
    ? {
      argument: error.details.argument,
      reason: error.details.reason,
    }
    : {
      argument: null,
      reason: error instanceof Error ? error.message : String(error),
    }

  if (error && typeof error === 'object') {
    if (Array.isArray(error.errors)) details.errors = error.errors
    if (typeof error.legacyClassification === 'string') {
      details.legacy_classification = error.legacyClassification
    }
  }

  return details
}

export function createRuntimeErrorRendering({ command, format, error, values = {} }) {
  const classification = runtimeClassification(error)
  const details = runtimeDetails(error)
  const mutationPerformed = Boolean(
    error &&
    typeof error === 'object' &&
    error.mutationPerformed === true,
  )

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

  const legacyPrefix = details.legacy_classification
    ? `${details.legacy_classification}: `
    : ''
  return {
    envelope: null,
    output: `ERROR: ${classification}: ${legacyPrefix}${details.reason}\n`,
    stream: 'stderr',
    exitCode: classificationExitCode(classification),
  }
}

function normalizedHead(value) {
  return /^[0-9a-f]{40}$/i.test(value ?? '') ? value.toLowerCase() : null
}

function legacyOutputForResult(result) {
  if (result.outcome === 'DISPATCHED_FOUNDER_AUTHORIZED_CORRECTION') {
    return 'Mission Control dispatch DISPATCHED_FOUNDER_AUTHORIZED_CORRECTION: FOUNDER_AUTHORIZED_CORRECTION -> IN_PROGRESS + HANDOFF'
  }
  return `Mission Control dispatch ${result.outcome}: READY -> IN_PROGRESS + HANDOFF comment ${result.comment?.id ?? 'unknown'}`
}

export function createResultRendering({ command, format, options, result, observedPreState, parsedBody }) {
  const legacyClassification = result.outcome ?? 'DISPATCHED'
  const isNoOp = legacyClassification === 'NO_OP'
  const state = result.state ?? {}
  const output = legacyOutputForResult(result)
  const envelope = createResultEnvelopeV1({
    command,
    outcome: isNoOp ? 'NO_OP' : 'SUCCESS',
    classification: isNoOp ? 'NO_OP_IDENTICAL_RETRY' : 'SUCCESS',
    mutation_performed: !isNoOp,
    observed_pre_state: observedPreState,
    resulting_state: state.state ?? null,
    repository: options.repo,
    issue_number: options.issue,
    pr_number: parsedBody.prNumber ?? String(state.active_pr ?? '').match(/\d+/)?.[0] ?? null,
    exact_head: normalizedHead(parsedBody.headSha ?? state.current_head),
    next_action: isNoOp
      ? {
        type: 'COMPLETE',
        command: null,
        reason: 'The identical dispatch claim is already durable.',
      }
      : {
        type: 'COMMAND',
        command: 'bemoat:agent:delivery',
        reason: 'The dispatch claim is ready for one delivery RESULT.',
      },
    details: {
      legacy_classification: legacyClassification,
      legacy_output: [output],
      ...(result.comment?.id != null ? { comment_id: String(result.comment.id) } : {}),
      ...(result.identity ? { transition_identity: JSON.stringify(result.identity) } : {}),
      ...(result.recovered ? { recovered: true } : {}),
    },
  })

  return {
    envelope,
    output: format === 'json'
      ? `${JSON.stringify(envelope)}\n`
      : `${envelope.classification}: ${output}\n`,
    stream: 'stdout',
    exitCode: classificationExitCode(envelope.classification),
  }
}
