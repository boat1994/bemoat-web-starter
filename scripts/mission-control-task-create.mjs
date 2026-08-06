#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { createHelpEnvelopeV1, formatTextHelp } from './cli/command-help.mjs'
import {
  CliInvocationError,
  parseCommandInvocation,
  resolveCommandIdentity,
} from './cli/command-invocation.mjs'
import {
  CLI_EXIT_CODES,
  classificationExitCode,
  createResultEnvelopeV1,
} from './cli/command-result.mjs'
import { createTaskBootstrapGithubAdapter } from './mission-control/adapters/task-bootstrap-github.mjs'
import { BOOTSTRAP_CONTRACT } from './mission-control/domain/task-bootstrap-authorization.mjs'
import { createTaskBootstrapService } from './mission-control/workflows/task-bootstrap.mjs'
import { parseMissionControlState } from './mission-control-state.mjs'

const COMMAND = 'bemoat:mission-control:task-bootstrap'
const ENTRYPOINT = 'scripts/mission-control-task-create.mjs'

function protectedPublicKey() {
  try {
    return readFileSync(resolve(process.cwd(), '.bemoat/mission-control/task-bootstrap-public-key.pem'), 'utf8')
  } catch (error) {
    const blocked = new Error('committed public verification key is unavailable', { cause: error })
    blocked.code = 'BLOCKED_EXTERNAL'
    throw blocked
  }
}

function renderHelp(invocation) {
  if (invocation.format === 'json') {
    process.stdout.write(`${JSON.stringify(createHelpEnvelopeV1(invocation.contract))}\n`)
    return
  }

  process.stdout.write(formatTextHelp(invocation.contract))
}

function isCanonicalClassification(value) {
  return typeof value === 'string' && Object.hasOwn(CLI_EXIT_CODES, value)
}

function mayHaveMutated(error) {
  if (error?.mutationPerformed === true) return true
  if (error?.code === 'PROJECTION_FAILED' || error?.classification === 'PROJECTION_FAILED') {
    return true
  }

  const reason = error instanceof Error ? error.message : String(error)
  return /(?:creation response was ambiguous|ownership registry write was ambiguous|allocated Task Issue|after projection|readback Task attestation|ownership registry readback)/i.test(reason)
}

function runtimeClassification(error) {
  if (mayHaveMutated(error)) return 'AMBIGUOUS_RESULT'

  const candidate = error?.classification ?? error?.code
  if (isCanonicalClassification(candidate)) return candidate

  const reason = error instanceof Error ? error.message : String(error)
  const prefix = reason.match(/^(?:ERROR:\s*)?([A-Z_]+):/)?.[1]
  if (isCanonicalClassification(prefix)) return prefix
  if (/\b(?:adapter|GitHub|public key|signing|workflow|repository)\b/i.test(reason)) {
    return 'BLOCKED_EXTERNAL'
  }
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

  if (typeof error?.legacyClassification === 'string') {
    details.legacy_classification = error.legacyClassification
  }
  return details
}

function renderRuntimeError({ command, format, error, values = {} }) {
  const classification = runtimeClassification(error)
  const details = runtimeDetails(error)
  const mutationPerformed = mayHaveMutated(error)

  if (format === 'json') {
    process.stdout.write(`${JSON.stringify(createResultEnvelopeV1({
      command,
      outcome: 'ERROR',
      classification,
      mutation_performed: mutationPerformed,
      repository: BOOTSTRAP_CONTRACT.repository,
      issue_number: null,
      pr_number: String(BOOTSTRAP_CONTRACT.pullRequest),
      exact_head: BOOTSTRAP_CONTRACT.head,
      next_action: {
        type: 'STOP',
        command: null,
        reason: details.reason,
      },
      details: {
        ...details,
        ...(values.founder_authorization_comment_id
          ? { authorization_comment_id: values.founder_authorization_comment_id }
          : {}),
      },
    }))}\n`)
  } else {
    process.stderr.write(`${classification}: ${details.reason}\n`)
  }

  process.exitCode = classificationExitCode(classification)
}

function renderResult({ command, format, result }) {
  const legacyClassification = result.outcome
  const noOp = legacyClassification === 'IDEMPOTENT'
  const parsedState = parseMissionControlState(result.issue?.body ?? '')
  const state = parsedState.valid ? parsedState.state : null
  const output = `Mission Control task bootstrap ${legacyClassification}: Task #${result.issue.number} -> ${state?.state ?? 'unknown'}`
  const envelope = createResultEnvelopeV1({
    command,
    outcome: noOp ? 'NO_OP' : 'SUCCESS',
    classification: noOp ? 'NO_OP_IDENTICAL_RETRY' : 'SUCCESS',
    mutation_performed: !noOp,
    resulting_state: state?.state ?? null,
    repository: BOOTSTRAP_CONTRACT.repository,
    issue_number: String(result.issue.number),
    pr_number: String(BOOTSTRAP_CONTRACT.pullRequest),
    exact_head: BOOTSTRAP_CONTRACT.head,
    next_action: noOp
      ? {
        type: 'COMPLETE',
        command: null,
        reason: 'The identical Task bootstrap is already durable.',
      }
      : {
        type: 'COMMAND',
        command: 'bemoat:mission-control:dispatch',
        reason: 'The bootstrapped Task is ready for HANDOFF dispatch.',
      },
    details: {
      legacy_classification: legacyClassification,
      legacy_output: [output],
      request_id: result.requestId,
      task_issue_url: result.issue.url,
      attestation_schema: result.attestation?.payload?.attestation_schema ?? null,
      signing_key_id: result.attestation?.key_id ?? null,
    },
  })

  if (format === 'json') {
    process.stdout.write(`${JSON.stringify(envelope)}\n`)
  } else {
    process.stdout.write(`${envelope.classification}: ${output}\n`)
  }

  process.exitCode = classificationExitCode(envelope.classification)
}

async function main(argv = process.argv.slice(2)) {
  let command = null
  let invocation = null

  try {
    command = resolveCommandIdentity({
      fallback: COMMAND,
      env: process.env,
      entrypoint: ENTRYPOINT,
    })
    invocation = parseCommandInvocation(command, argv)

    if (invocation.mode === 'help') {
      renderHelp(invocation)
      return
    }

    const env = process.env
    const workflow = {
      file: BOOTSTRAP_CONTRACT.workflowFile,
      ref: env.GITHUB_REF ?? '',
      sha: env.GITHUB_SHA ?? '',
      runId: env.GITHUB_RUN_ID ?? '',
    }
    const repository = env.GITHUB_REPOSITORY ?? ''
    const github = createTaskBootstrapGithubAdapter({ repository, env })
    const service = createTaskBootstrapService({
      github,
      repository,
      publicKey: protectedPublicKey(),
      signingPrivateKey: env.BEMOAT_TASK_BOOTSTRAP_SIGNING_PRIVATE_KEY ?? null,
      signingKeyId: env.BEMOAT_TASK_BOOTSTRAP_SIGNING_KEY_ID ?? null,
      workflow,
    })
    const result = await service.bootstrap({
      founderAuthorizationCommentId: invocation.values.founder_authorization_comment_id,
    })
    // Never serialize the private key or the full Issue body into the workflow
    // log. The durable evidence remains on GitHub for the next preflight.
    renderResult({ command, format: invocation.format, result })
  } catch (error) {
    const format = invocation?.format ?? (argv.includes('--json') ? 'json' : 'text')
    renderRuntimeError({
      command: command ?? COMMAND,
      format,
      error,
      values: invocation?.values ?? {},
    })
  }
}

main().catch((error) => {
  // Deliberately emit only classification and a safe message; private signing
  // material and GitHub credentials are never included in diagnostics.
  const message = error instanceof Error
    ? error.message.replace(/-----BEGIN[\s\S]*?-----[\s\S]*?-----END[\s\S]*?-----/g, '[redacted-key]')
    : String(error)
  process.stderr.write(`INTERNAL_ERROR: ${message}\n`)
  process.exitCode = 1
})
