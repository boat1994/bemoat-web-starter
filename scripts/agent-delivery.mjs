#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { Coordinator, parseRoleCommentBody } from './mission-control-reconcile.mjs'
import { writeIssueBodyWithLease } from './mission-control/workflows/issue-body-cas.mjs'
import { runAgentDeliveryWorkflow } from './mission-control/workflows/agent-delivery.mjs'
import {
  createHelpEnvelopeV1,
  formatTextHelp,
} from './cli/command-help.mjs'
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

const COMMAND = 'bemoat:agent:delivery'
const ENTRYPOINT = 'scripts/agent-delivery.mjs'

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options })
  if (result.error || result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}\n${result.stderr || result.stdout || result.error?.message}`)
  }
  return result.stdout.trim()
}

function tryRun(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', input: options.input, env: options.env, ...options })
}

function resolveDeliveryCommand() {
  const env = process.env.npm_lifecycle_event === 'test:int'
    ? { ...process.env, npm_lifecycle_event: undefined }
    : process.env

  return resolveCommandIdentity({
    fallback: COMMAND,
    env,
    entrypoint: ENTRYPOINT,
  })
}

function renderHelp(invocation) {
  if (invocation.format === 'json') {
    process.stdout.write(`${JSON.stringify(createHelpEnvelopeV1(invocation.contract))}\n`)
    return
  }

  process.stdout.write(formatTextHelp(invocation.contract))
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

function renderRuntimeError({
  command,
  format,
  error,
  mutationPerformed = false,
  values = {},
  parsedBody = null,
}) {
  const classification = runtimeClassification(error)
  const details = runtimeDetails(error)
  const mutated = Boolean(
    mutationPerformed ||
    (error && typeof error === 'object' && error.mutationPerformed === true),
  )

  if (format === 'json' && command) {
    process.stdout.write(`${JSON.stringify(createResultEnvelopeV1({
      command,
      outcome: 'ERROR',
      classification,
      mutation_performed: mutated,
      repository: values.repository ?? null,
      issue_number: values.issue_number ?? null,
      pr_number: parsedBody?.prNumber ?? null,
      exact_head: /^[0-9a-f]{40}$/i.test(parsedBody?.headSha ?? '')
        ? parsedBody.headSha.toLowerCase()
        : null,
      next_action: {
        type: 'STOP',
        command: null,
        reason: details.reason,
      },
      details,
    }))}\n`)
  } else if (error instanceof CliInvocationError) {
    process.stderr.write(`${classification}: ${details.reason}\n`)
  } else if (
    classification === 'BLOCKED_EXTERNAL' &&
    !/ambiguous POST|Failed to validate RESULT comment/i.test(details.reason)
  ) {
    process.stdout.write(`${classification}: ${details.reason}\n`)
  } else {
    const legacyPrefix = details.legacy_classification
      ? `${details.legacy_classification}: `
      : ''
    process.stderr.write(`ERROR: ${classification}: ${legacyPrefix}${details.reason}\n`)
  }

  process.exitCode = classificationExitCode(classification)
}

function renderResult({
  command,
  format,
  options,
  result,
  expectedRepo,
  localCommit,
  observedPreState,
}) {
  const output = `Delivery reconciliation successful. RESULT comment ${result.comment.id} posted and state updated.`
  const envelope = createResultEnvelopeV1({
    command,
    outcome: 'SUCCESS',
    classification: 'SUCCESS',
    mutation_performed: true,
    observed_pre_state: observedPreState,
    resulting_state: result.state?.state ?? null,
    repository: expectedRepo,
    issue_number: options.issue,
    pr_number: options.prNumber,
    exact_head: /^[0-9a-f]{40}$/i.test(localCommit) ? localCommit.toLowerCase() : null,
    next_action: {
      type: 'COMMAND',
      command: 'bemoat:mission-control:review',
      reason: 'The delivered head is ready for the registered review route.',
    },
    details: {
      legacy_classification: result.outcome,
      legacy_output: [output],
      comment_id: String(result.comment.id),
    },
  })

  if (format === 'json') {
    process.stdout.write(`${JSON.stringify(envelope)}\n`)
  } else {
    process.stdout.write(`SUCCESS: ${output}\n`)
  }

  process.exitCode = classificationExitCode('SUCCESS')
}

function readBody(bodyFile) {
  const stdinIsPipe = !process.stdin.isTTY
  const stdin = stdinIsPipe ? readFileSync(0, 'utf8') : ''
  if (bodyFile && stdin.length > 0) {
    throw new CliInvocationError('--body-file', '--body-file and stdin are mutually exclusive')
  }
  if (bodyFile) {
    try {
      return readFileSync(bodyFile, 'utf8')
    } catch (error) {
      throw new CliInvocationError(
        bodyFile,
        error instanceof Error ? error.message : String(error),
      )
    }
  }
  if (!stdin) throw new CliInvocationError('stdin', 'provide a comment body through --body-file or stdin')
  return stdin
}

function main() {
  mainAsync()
}

async function mainAsync() {
  let command = null
  let invocation = null
  let mutationPerformed = false
  let parsed = null
  let body = null
  let parsedBody = null

  try {
    command = resolveDeliveryCommand()
    invocation = parseCommandInvocation(command, process.argv.slice(2))

    if (invocation.mode === 'help') {
      renderHelp(invocation)
      return
    }

    parsed = {
      options: {
        issue: invocation.values.issue_number,
        repo: invocation.values.repository ?? null,
        bodyFile: invocation.values.body_file ?? null,
      },
    }

    body = readBody(parsed.options.bodyFile)
    parsedBody = parseRoleCommentBody(body)

    const result = await runAgentDeliveryWorkflow({
      issue: parsed.options.issue,
      repo: parsed.options.repo,
      body,
      onMutation: () => { mutationPerformed = true },
      dependencies: {
        run,
        tryRun,
        createCoordinator: (transports) => new Coordinator(transports),
        writeIssueBodyWithLease,
      },
    })

  renderResult({
    command,
    format: invocation.format,
    options: { ...parsed.options, prNumber: result.prNumber },
    result: result.result,
    expectedRepo: result.expectedRepo,
    localCommit: result.localCommit,
    observedPreState: result.observedPreState,
  })
  } catch (error) {
    renderRuntimeError({
      command: command ?? COMMAND,
      format: invocation?.format ?? (process.argv.includes('--json') ? 'json' : 'text'),
      error,
      mutationPerformed,
      values: invocation?.values,
      parsedBody,
    })
  }
}

main()
