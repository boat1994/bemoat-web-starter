import { CliInvocationError } from '../../cli/command-invocation.mjs'
import {
  CLI_EXIT_CODES,
  classificationExitCode,
  createResultEnvelopeV1,
} from '../../cli/command-result.mjs'

const FULL_SHA_RE = /^[0-9a-f]{40}$/i

function isLeaseCasConflict(error) {
  if (!error) return false
  if (error.code === 'CAS_CONFLICT') return true
  const message = error instanceof Error ? error.message : String(error)
  return /CAS_CONFLICT|409 Conflict|422 .*sha|but expected|lease CAS lost/i.test(message)
}

export function exactNextAction(issueNumber) {
  return `pnpm run bemoat:agent:issue -- ${issueNumber} --phase correction`
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
  if (isLeaseCasConflict(error) || /\blease\b/i.test(reason)) return 'STATE_CONFLICT'
  if (/\b(?:gh|GitHub|network|remote)\b/i.test(reason)) return 'BLOCKED_EXTERNAL'
  return 'INTERNAL_ERROR'
}

function runtimeDetails(error) {
  if (error instanceof CliInvocationError) {
    return {
      argument: error.details.argument,
      reason: error.details.reason,
    }
  }
  return {
    reason: error instanceof Error ? error.message : String(error),
  }
}

function normalizedHead(value) {
  return typeof value === 'string' && FULL_SHA_RE.test(value) ? value.toLowerCase() : null
}

function resultNextAction(classification, issueNumber) {
  return classification === 'SUCCESS' || classification === 'NO_OP_IDENTICAL_RETRY'
    ? {
      type: 'COMMAND',
      command: 'bemoat:agent:issue',
      reason: `Exact next permitted action: ${exactNextAction(issueNumber)}`,
    }
    : {
      type: 'STOP',
      command: null,
      reason: `Stop on ${classification}; do not retry unless the classification is identically completed.`,
    }
}

export function createResultRendering({
  command,
  format,
  options,
  classification,
  outcome,
  mutationPerformed,
  observedPreState,
  resultingState,
  repository,
  exactHead,
  evidenceIds,
  details,
}) {
  const nextAction = resultNextAction(classification, options.issueNumber)
  const envelope = createResultEnvelopeV1({
    command,
    outcome,
    classification,
    mutation_performed: mutationPerformed,
    observed_pre_state: observedPreState,
    resulting_state: resultingState,
    repository,
    issue_number: String(options.issueNumber),
    pr_number: String(options.expectedPr),
    exact_head: exactHead,
    evidence_ids: evidenceIds,
    next_action: nextAction,
    details: {
      ...details,
      exact_next_permitted_action: exactNextAction(options.issueNumber),
    },
  })

  const legacyOutput = `${envelope.classification}: adopt-finding Task #${options.issueNumber}\n`
  return {
    envelope,
    output: format === 'json' ? `${JSON.stringify(envelope)}\n` : legacyOutput,
    stream: 'stdout',
    exitCode: classificationExitCode(envelope.classification),
  }
}

export function createRuntimeErrorRendering({ command, format, error, options }) {
  const classification = runtimeClassification(error)
  const details = runtimeDetails(error)

  if (error instanceof CliInvocationError) {
    const envelope = createResultEnvelopeV1({
      command,
      outcome: 'STOP',
      classification: 'INVALID_INVOCATION',
      mutation_performed: false,
      observed_pre_state: null,
      resulting_state: null,
      repository: null,
      issue_number: null,
      pr_number: null,
      exact_head: null,
      evidence_ids: {},
      next_action: { type: 'STOP', command: null, reason: error.message },
      details: {
        argument: error.details?.argument ?? null,
        reason: error.message,
      },
    })
    return {
      envelope,
      output: format === 'json' ? `${JSON.stringify(envelope)}\n` : `INVALID_INVOCATION: ${error.message}\n`,
      stream: format === 'json' ? 'stdout' : 'stderr',
      exitCode: classificationExitCode('INVALID_INVOCATION'),
    }
  }

  const envelope = options
    ? createResultEnvelopeV1({
      command,
      outcome: classification === 'INTERNAL_ERROR' ? 'ERROR' : 'STOP',
      classification,
      mutation_performed: false,
      observed_pre_state: options.expectedState ?? null,
      resulting_state: null,
      repository: options.repo.toLowerCase(),
      issue_number: String(options.issueNumber),
      pr_number: String(options.expectedPr),
      exact_head: normalizedHead(options.expectedAdoptionHead),
      evidence_ids: {
        founder_authorization_comment_id: String(options.authorizationComment),
        predecessor_comment_id: String(options.predecessorComment),
      },
      next_action: { type: 'STOP', command: null, reason: details.reason },
      details,
    })
    : null

  if (envelope) {
    return {
      envelope,
      output: format === 'json' ? `${JSON.stringify(envelope)}\n` : `${classification}: ${details.reason}\n`,
      stream: format === 'json' ? 'stdout' : 'stderr',
      exitCode: classificationExitCode(classification),
    }
  }

  return classification === 'BLOCKED_EXTERNAL'
    ? {
      envelope: null,
      output: `${classification}: ${details.reason}\n`,
      stream: 'stdout',
      exitCode: classificationExitCode(classification),
    }
    : {
      envelope: null,
      output: `${classification}: ${error instanceof Error ? error.message : String(error)}\n`,
      stream: 'stderr',
      exitCode: classificationExitCode(classification),
    }
}
