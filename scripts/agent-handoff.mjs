#!/usr/bin/env node
import { readFileSync } from 'node:fs'

import { createHelpEnvelopeV1, formatTextHelp } from './cli/command-help.mjs'
import { CliInvocationError, parseCommandInvocation, resolveCommandIdentity } from './cli/command-invocation.mjs'
import { classificationExitCode, createResultEnvelopeV1 } from './cli/command-result.mjs'
import { runHandoffWorkflow } from './handoff/workflow.ts'

const COMMAND = 'bemoat:handoff'
const ENTRYPOINT = 'scripts/agent-handoff.mjs'

function readBody(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    throw new CliInvocationError(path, error instanceof Error ? error.message : String(error))
  }
}
function renderHelp(invocation) {
  if (invocation.format === 'json') return process.stdout.write(`${JSON.stringify(createHelpEnvelopeV1(invocation.contract))}\n`)
  process.stdout.write(formatTextHelp(invocation.contract))
}

function classification(error) {
  if (error instanceof CliInvocationError) return error.classification
  if (error && typeof error.classification === 'string') return error.classification
  return 'INTERNAL_ERROR'
}
function renderError({ command, format, error, values }) {
  const resultClassification = classification(error)
  const reason = error instanceof Error ? error.message : String(error)
  const details = {
    argument: error instanceof CliInvocationError ? error.details.argument : null,
    reason,
    ...(Array.isArray(error?.errors) ? { errors: error.errors } : {}),
  }
  if (format === 'json') {
    process.stdout.write(`${JSON.stringify(createResultEnvelopeV1({
      command,
      outcome: 'ERROR',
      classification: resultClassification,
      mutation_performed: error?.mutationPerformed === true,
      issue_number: values?.issue_number ?? null,
      next_action: { type: 'STOP', command: null, reason },
      details,
    }))}\n`)
  } else {
    process.stderr.write(`ERROR: ${resultClassification}: ${reason}\n`)
  }
  process.exitCode = classificationExitCode(resultClassification)
}

function renderSuccess({ command, format, result }) {
  const envelope = createResultEnvelopeV1({
    command,
    outcome: result.classification === 'NO_OP_IDENTICAL_RETRY' ? 'NO_OP' : 'SUCCESS',
    classification: result.classification,
    mutation_performed: result.mutationPerformed,
    repository: result.repository,
    issue_number: result.issueNumber,
    pr_number: result.record.pr?.number ?? null,
    exact_head: result.record.exact_head,
    next_action: { type: 'COMPLETE', command: null, reason: 'The HANDOFF comment was verified by exact readback.' },
    details: {
      record_type: 'HANDOFF',
      comment_id: result.comment.id,
      comment_url: result.comment.html_url,
      readback_verified: true,
      recovered: result.recovered,
    },
  })
  if (format === 'json') process.stdout.write(`${JSON.stringify(envelope)}\n`)
  else process.stdout.write(`SUCCESS: HANDOFF comment ${result.comment.id} verified on Issue #${result.issueNumber}\n`)
  process.exitCode = 0
}

function main() {
  let invocation = null
  let command = COMMAND
  try {
    command = resolveCommandIdentity({ fallback: COMMAND, env: process.env, entrypoint: ENTRYPOINT })
    invocation = parseCommandInvocation(command, process.argv.slice(2))
    if (invocation.mode === 'help') return renderHelp(invocation)
    const body = readBody(invocation.values.body_file)
    const result = runHandoffWorkflow({
      issueNumber: invocation.values.issue_number,
      body,
    })
    renderSuccess({ command, format: invocation.format, result })
  } catch (error) {
    renderError({
      command,
      format: invocation?.format ?? (process.argv.includes('--json') ? 'json' : 'text'),
      error,
      values: invocation?.values,
    })
  }
}

main()
