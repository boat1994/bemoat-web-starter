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
  const legacyOutput = property(error, 'legacyOutput')
  if (Array.isArray(legacyOutput)) details.legacy_output = legacyOutput
  const legacyClassification = property(error, 'legacyClassification')
  if (typeof legacyClassification === 'string') details.legacy_classification = legacyClassification
  return details
}

export type RuntimeErrorRenderingOptions = {
  command?: unknown
  format?: unknown
  error: unknown
  values?: RuntimeObject
}

export function renderRuntimeError({
  command,
  format,
  error,
  values = {},
}: RuntimeErrorRenderingOptions) {
  const classification = runtimeClassification(error)
  const details = runtimeDetails(error)
  const mutationPerformed = property(error, 'mutationPerformed') === true

  if (format === 'json' && command) {
    process.stdout.write(`${JSON.stringify(createResultEnvelopeV1({
      command,
      outcome: 'ERROR',
      classification,
      mutation_performed: mutationPerformed,
      repository: property(values, 'repository') ?? null,
      issue_number: property(values, 'issue_number') ?? null,
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
    const legacyClassification = property(details, 'legacy_classification')
    const legacyPrefix = typeof legacyClassification === 'string'
      ? `${legacyClassification}: `
      : ''
    process.stderr.write(`ERROR: ${classification}: ${legacyPrefix}${details.reason}\n`)
    const legacyOutput = property(details, 'legacy_output')
    if (Array.isArray(legacyOutput)) {
      for (const line of legacyOutput) process.stderr.write(`${line}\n`)
    }
  }

  process.exitCode = classificationExitCode(classification)
}

export type ResultRenderingOptions = {
  command: unknown
  format: unknown
  options: RuntimeObject
  role: string
  legacyClassification: string | null
  legacyOutput: string[]
  mutationPerformed: boolean
  parsedBody: RuntimeObject
  commentId?: unknown
  classification?: string
}

function normalizedHead(value: unknown): string | null {
  return typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value) ? value.toLowerCase() : null
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
}: ResultRenderingOptions) {
  const exactHead = normalizedHead(property(parsedBody, 'headSha'))
  const issue = property(options, 'issue')
  const result = createResultEnvelopeV1({
    command,
    outcome: classification === 'NO_OP_IDENTICAL_RETRY' ? 'NO_OP' : 'SUCCESS',
    classification,
    mutation_performed: mutationPerformed,
    repository: property(options, 'repo'),
    issue_number: issue,
    pr_number: property(parsedBody, 'prNumber'),
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
      ...(property(options, 'check') ? { check: true } : {}),
      ...(commentId != null ? { comment_id: String(commentId) } : {}),
    },
  })

  if (format === 'json') {
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } else {
    for (const line of legacyOutput) {
      if (line.startsWith('WARNING:')) process.stderr.write(`${line}\n`)
    }
    const check = property(options, 'check') === true
    const message = check
      ? `validated ${role} comment for Issue #${issue}`
      : classification === 'NO_OP_IDENTICAL_RETRY'
        ? `reused authoritative ${role} comment on Issue #${issue}; no mutation was performed`
        : `posted ${role} comment to Issue #${issue}; no durable-state transition was performed`
    process.stdout.write(`SUCCESS: ${message}\n`)
  }

  process.exitCode = classificationExitCode('SUCCESS')
}
