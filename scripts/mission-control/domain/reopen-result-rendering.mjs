import { CliInvocationError } from '../../cli/command-invocation.mjs'
import {
  CLI_EXIT_CODES,
  classificationExitCode,
  createResultEnvelopeV1,
} from '../../cli/command-result.mjs'

const FULL_SHA_RE = /^[0-9a-f]{40}$/i

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

function normalizedHead(value) {
  return typeof value === 'string' && FULL_SHA_RE.test(value) ? value.toLowerCase() : null
}

function legacyOutput(options, result) {
  const state = result.state ?? {}
  return `Mission Control reopen ${result.outcome}: Task #${options.issueNumber} -> ${state.state} ${state.review_cycle}/${state.full_review_count}`
}

export function createResultRendering({
  command,
  format,
  options,
  result,
  observedPreState,
}) {
  const replayed = result.outcome === 'NO_OP'
  const output = legacyOutput(options, result)
  const envelope = createResultEnvelopeV1({
    command,
    outcome: replayed ? 'NO_OP' : 'SUCCESS',
    classification: replayed ? 'NO_OP_IDENTICAL_RETRY' : 'SUCCESS',
    mutation_performed: !replayed,
    observed_pre_state: observedPreState,
    resulting_state: result.state?.state ?? null,
    repository: options.repo,
    issue_number: options.issueNumber,
    pr_number: options.expectedPr,
    exact_head: normalizedHead(options.expectedNewHead),
    next_action: replayed
      ? {
        type: 'COMPLETE',
        command: null,
        reason: 'The identical Founder-authorized reopen projection is already durable.',
      }
      : {
        type: 'COMMAND',
        command: 'bemoat:agent:delivery',
        reason: 'The bounded correction delivery is the only next mutation.',
      },
    details: {
      legacy_classification: result.outcome,
      legacy_output: [output],
    },
  })

  return {
    envelope,
    output: format === 'json' ? `${JSON.stringify(envelope)}\n` : `${output}\n`,
    stream: 'stdout',
    exitCode: classificationExitCode(envelope.classification),
  }
}

export function createRuntimeErrorRendering({
  command,
  format,
  error,
  options,
  mutationPerformed = false,
}) {
  const classification = runtimeClassification(error)
  const details = runtimeDetails(error)
  const envelope = format === 'json' && command
    ? createResultEnvelopeV1({
      command,
      outcome: 'ERROR',
      classification,
      mutation_performed: Boolean(
        mutationPerformed ||
        (error && typeof error === 'object' && error.mutationPerformed === true),
      ),
      repository: options?.repo ?? null,
      issue_number: options?.issueNumber ?? null,
      pr_number: options?.expectedPr ?? null,
      exact_head: normalizedHead(options?.expectedNewHead),
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
