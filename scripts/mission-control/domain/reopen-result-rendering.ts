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
  if (typeof legacyClassification === 'string') {
    details.legacy_classification = legacyClassification
  }
  return details
}

function normalizedHead(value: unknown): string | null {
  return typeof value === 'string' && FULL_SHA_RE.test(value) ? value.toLowerCase() : null
}

function legacyOutput(options: RuntimeObject, result: RuntimeObject): string {
  const state = property(result, 'state')
  return `Mission Control reopen ${result.outcome}: Task #${options.issueNumber} -> ${property(state, 'state')} ${property(state, 'review_cycle')}/${property(state, 'full_review_count')}`
}

export type ReopenResultRenderingOptions = {
  command: unknown
  format: unknown
  options: RuntimeObject
  result: RuntimeObject
  observedPreState: unknown
}

export function createResultRendering({
  command,
  format,
  options,
  result,
  observedPreState,
}: ReopenResultRenderingOptions) {
  const replayed = result.outcome === 'NO_OP'
  const output = legacyOutput(options, result)
  const state = property(result, 'state')
  const envelope = createResultEnvelopeV1({
    command,
    outcome: replayed ? 'NO_OP' : 'SUCCESS',
    classification: replayed ? 'NO_OP_IDENTICAL_RETRY' : 'SUCCESS',
    mutation_performed: !replayed,
    observed_pre_state: observedPreState,
    resulting_state: property(state, 'state') ?? null,
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
    exitCode: classificationExitCode(replayed ? 'NO_OP_IDENTICAL_RETRY' : 'SUCCESS'),
  }
}

export type ReopenRuntimeErrorRenderingOptions = {
  command: unknown
  format: unknown
  error: unknown
  options?: RuntimeObject
  mutationPerformed?: boolean
}

export function createRuntimeErrorRendering({
  command,
  format,
  error,
  options,
  mutationPerformed = false,
}: ReopenRuntimeErrorRenderingOptions) {
  const classification = runtimeClassification(error)
  const details = runtimeDetails(error)
  const envelope = format === 'json' && command
    ? createResultEnvelopeV1({
      command,
      outcome: 'ERROR',
      classification,
      mutation_performed: Boolean(mutationPerformed || property(error, 'mutationPerformed') === true),
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
