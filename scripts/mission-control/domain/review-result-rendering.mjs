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
  const prefix = reason.match(/^(?:ERROR:\s*)?([A-Z_]+):/)
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

export function createRuntimeErrorRendering({
  command,
  format,
  error,
  mutationPerformed = false,
  values = {},
  parsedVerdict = null,
}) {
  const classification = runtimeClassification(error)
  const details = runtimeDetails(error)
  const mutated = Boolean(
    mutationPerformed ||
    (error && typeof error === 'object' && error.mutationPerformed === true),
  )
  const envelope = format === 'json' && command
    ? createResultEnvelopeV1({
      command,
      outcome: 'ERROR',
      classification,
      mutation_performed: mutated,
      repository: values.repository ?? null,
      issue_number: values.issue_number ?? null,
      pr_number: parsedVerdict?.prNumber ?? null,
      exact_head: /^[0-9a-f]{40}$/i.test(parsedVerdict?.headSha ?? values.expected_head ?? '')
        ? (parsedVerdict?.headSha ?? values.expected_head).toLowerCase()
        : null,
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

export function createResultRendering({ command, options, result, repository, observedPreState }) {
  const replayed = result.replayed === true
  const output = `Mission Control review ${replayed ? 'NO_OP_IDENTICAL_RETRY' : result.outcome}: ${result.state.state} + REVIEW_VERDICT comment ${result.comment.id}`
  const envelope = createResultEnvelopeV1({
    command,
    outcome: replayed ? 'NO_OP' : 'SUCCESS',
    classification: replayed ? 'NO_OP_IDENTICAL_RETRY' : 'SUCCESS',
    mutation_performed: !replayed,
    observed_pre_state: observedPreState,
    resulting_state: result.state?.state ?? null,
    repository,
    issue_number: options.issue,
    pr_number: options.prNumber,
    exact_head: options.expectedHead.length === 40 ? options.expectedHead.toLowerCase() : null,
    next_action: replayed
      ? {
        type: 'COMPLETE',
        command: null,
        reason: 'The identical REVIEW_VERDICT retry is already durable; no further dispatch is required.',
      }
      : {
        type: 'COMMAND',
        command: 'bemoat:mission-control:dispatch',
        reason: 'The resulting review state determines the next bounded dispatch or Founder gate.',
      },
    details: {
      legacy_classification: replayed ? 'NO_OP' : result.outcome,
      legacy_output: [output],
      comment_id: String(result.comment.id),
      ...(replayed ? { replayed: true } : {}),
    },
  })

  return {
    envelope,
    output,
    exitCode: classificationExitCode(envelope.classification),
  }
}
