import { CliInvocationError } from '../../cli/command-invocation.mjs'
import {
  CLI_EXIT_CODES,
  classificationExitCode,
  createResultEnvelopeV1,
} from '../../cli/command-result.mjs'

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
    if (Array.isArray(error.legacyOutput)) details.legacy_output = error.legacyOutput
    if (typeof error.legacyClassification === 'string') {
      details.legacy_classification = error.legacyClassification
    }
  }

  return details
}

export function renderRuntimeError({ command, format, error, values = {} }) {
  const classification = runtimeClassification(error)
  const details = runtimeDetails(error)
  const mutationPerformed = Boolean(
    error &&
    typeof error === 'object' &&
    error.mutationPerformed === true,
  )

  if (format === 'json' && command) {
    process.stdout.write(`${JSON.stringify(createResultEnvelopeV1({
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
    }))}\n`)
  } else if (error instanceof CliInvocationError) {
    process.stderr.write(`${classification}: ${details.reason}\n`)
  } else if (classification === 'BLOCKED_EXTERNAL') {
    process.stdout.write(`${classification}: ${details.reason}\n`)
  } else {
    const legacyPrefix = details.legacy_classification
      ? `${details.legacy_classification}: `
      : ''
    process.stderr.write(`ERROR: ${classification}: ${legacyPrefix}${details.reason}\n`)
    for (const line of details.legacy_output ?? []) process.stderr.write(`${line}\n`)
  }

  process.exitCode = classificationExitCode(classification)
}

export function renderResult({
  command,
  format,
  options,
  role,
  legacyClassification,
  legacyOutput,
  mutationPerformed,
  parsedBody,
  commentId = null,
  classification = 'SUCCESS',
}) {
  const exactHead = /^[0-9a-f]{40}$/i.test(parsedBody.headSha ?? '')
    ? parsedBody.headSha.toLowerCase()
    : null
  const result = createResultEnvelopeV1({
    command,
    outcome: classification === 'NO_OP_IDENTICAL_RETRY' ? 'NO_OP' : 'SUCCESS',
    classification,
    mutation_performed: mutationPerformed,
    repository: options.repo,
    issue_number: options.issue,
    pr_number: parsedBody.prNumber,
    exact_head: exactHead,
    next_action: {
      type: 'COMPLETE',
      command: null,
      reason: classification === 'NO_OP_IDENTICAL_RETRY'
        ? 'The identical validated role comment is already authoritative.'
        : 'The role comment operation completed without owning a state transition.',
    },
    details: {
      role,
      ...(legacyClassification ? { legacy_classification: legacyClassification } : {}),
      ...(legacyOutput.length > 0 ? { legacy_output: legacyOutput } : {}),
      ...(options.check ? { check: true } : {}),
      ...(commentId != null ? { comment_id: String(commentId) } : {}),
    },
  })

  if (format === 'json') {
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } else {
    for (const line of legacyOutput) {
      if (line.startsWith('WARNING:')) process.stderr.write(`${line}\n`)
    }
    const message = options.check
      ? `validated ${role} comment for Issue #${options.issue}`
      : classification === 'NO_OP_IDENTICAL_RETRY'
        ? `reused authoritative ${role} comment on Issue #${options.issue}; no mutation was performed`
        : `posted ${role} comment to Issue #${options.issue}; no durable-state transition was performed`
    process.stdout.write(`SUCCESS: ${message}\n`)
  }

  process.exitCode = classificationExitCode('SUCCESS')
}
