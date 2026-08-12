import { CliInvocationError } from '../../cli/command-invocation.mjs'
import { CLI_EXIT_CODES, classificationExitCode, createResultEnvelopeV1 } from '../../cli/command-result.mjs'

type RuntimeObject = { [key: string]: unknown }
const FULL_SHA_RE = /^[0-9a-f]{40}$/i

function isRuntimeObject(value: unknown): value is RuntimeObject {
  return Boolean(value) && typeof value === 'object'
}

function property(value: unknown, key: string): unknown {
  return isRuntimeObject(value) ? Reflect.get(value, key) : undefined
}

function isLeaseCasConflict(error: unknown): boolean {
  if (!error) return false
  if (property(error, 'code') === 'CAS_CONFLICT') return true
  const message = error instanceof Error ? error.message : String(error)
  return /CAS_CONFLICT|409 Conflict|422 .*sha|but expected|lease CAS lost/i.test(message)
}

export function exactNextAction(issueNumber: unknown): string {
  return `pnpm run bemoat:agent:issue -- ${issueNumber} --phase correction`
}

function runtimeClassification(error: unknown): string {
  const explicit = property(error, 'classification')
  if (typeof explicit === 'string' && Object.hasOwn(CLI_EXIT_CODES, explicit)) return explicit
  const reason = error instanceof Error ? error.message : String(error)
  const prefix = reason.match(/^(?:ERROR:\s*)?([A-Z_]+):/)
  if (prefix && Object.hasOwn(CLI_EXIT_CODES, prefix[1])) return prefix[1]
  if (isLeaseCasConflict(error) || /\blease\b/i.test(reason)) return 'STATE_CONFLICT'
  if (/\b(?:gh|GitHub|network|remote)\b/i.test(reason)) return 'BLOCKED_EXTERNAL'
  return 'INTERNAL_ERROR'
}

function runtimeDetails(error: unknown): RuntimeObject {
  if (error instanceof CliInvocationError) {
    const invocationDetails = property(error, 'details')
    return { argument: property(invocationDetails, 'argument'), reason: property(invocationDetails, 'reason') }
  }
  return { reason: error instanceof Error ? error.message : String(error) }
}

function normalizedHead(value: unknown): string | null {
  return typeof value === 'string' && FULL_SHA_RE.test(value) ? value.toLowerCase() : null
}

function resultNextAction(classification: unknown, issueNumber: unknown) {
  return classification === 'SUCCESS' || classification === 'NO_OP_IDENTICAL_RETRY'
    ? { type: 'COMMAND', command: 'bemoat:agent:issue', reason: `Exact next permitted action: ${exactNextAction(issueNumber)}` }
    : { type: 'STOP', command: null, reason: `Stop on ${classification}; do not retry unless the classification is identically completed.` }
}

export type AdoptFindingResultRenderingOptions = {
  command: unknown
  format: unknown
  options: RuntimeObject
  classification: string
  outcome: string
  mutationPerformed: unknown
  observedPreState: unknown
  resultingState: unknown
  repository: unknown
  exactHead: unknown
  evidenceIds: unknown
  details: RuntimeObject
}

export function createResultRendering({
  command, format, options, classification, outcome, mutationPerformed, observedPreState,
  resultingState, repository, exactHead, evidenceIds, details,
}: AdoptFindingResultRenderingOptions) {
  const issueNumber = property(options, 'issueNumber')
  const envelope = createResultEnvelopeV1({
    command,
    outcome,
    classification,
    mutation_performed: mutationPerformed,
    observed_pre_state: observedPreState,
    resulting_state: resultingState,
    repository,
    issue_number: String(issueNumber),
    pr_number: String(property(options, 'expectedPr')),
    exact_head: exactHead,
    evidence_ids: evidenceIds,
    next_action: resultNextAction(classification, issueNumber),
    details: { ...details, exact_next_permitted_action: exactNextAction(issueNumber) },
  })
  const legacyOutput = `${envelope.classification}: adopt-finding Task #${issueNumber}\n`
  return {
    envelope,
    output: format === 'json' ? `${JSON.stringify(envelope)}\n` : legacyOutput,
    stream: 'stdout',
    exitCode: classificationExitCode(classification),
  }
}

export type AdoptFindingRuntimeErrorRenderingOptions = {
  command: unknown
  format: unknown
  error: unknown
  options?: RuntimeObject | null
}

export function createRuntimeErrorRendering({ command, format, error, options }: AdoptFindingRuntimeErrorRenderingOptions) {
  const classification = runtimeClassification(error)
  const details = runtimeDetails(error)
  if (error instanceof CliInvocationError) {
    const invocationDetails = property(error, 'details')
    const envelope = createResultEnvelopeV1({
      command, outcome: 'STOP', classification: 'INVALID_INVOCATION', mutation_performed: false,
      observed_pre_state: null, resulting_state: null, repository: null, issue_number: null,
      pr_number: null, exact_head: null, evidence_ids: {},
      next_action: { type: 'STOP', command: null, reason: error.message },
      details: { argument: property(invocationDetails, 'argument') ?? null, reason: error.message },
    })
    return {
      envelope,
      output: format === 'json' ? `${JSON.stringify(envelope)}\n` : `INVALID_INVOCATION: ${error.message}\n`,
      stream: format === 'json' ? 'stdout' : 'stderr',
      exitCode: classificationExitCode('INVALID_INVOCATION'),
    }
  }
  const repository = property(options, 'repo')
  const envelope = options
    ? createResultEnvelopeV1({
      command,
      outcome: classification === 'INTERNAL_ERROR' ? 'ERROR' : 'STOP',
      classification,
      mutation_performed: false,
      observed_pre_state: property(options, 'expectedState') ?? null,
      resulting_state: null,
      repository: typeof repository === 'string' ? repository.toLowerCase() : String(repository).toLowerCase(),
      issue_number: String(property(options, 'issueNumber')),
      pr_number: String(property(options, 'expectedPr')),
      exact_head: normalizedHead(property(options, 'expectedAdoptionHead')),
      evidence_ids: {
        founder_authorization_comment_id: String(property(options, 'authorizationComment')),
        predecessor_comment_id: String(property(options, 'predecessorComment')),
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
    ? { envelope: null, output: `${classification}: ${details.reason}\n`, stream: 'stdout', exitCode: classificationExitCode(classification) }
    : { envelope: null, output: `${classification}: ${error instanceof Error ? error.message : String(error)}\n`, stream: 'stderr', exitCode: classificationExitCode(classification) }
}
