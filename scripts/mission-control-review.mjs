#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runCommand as run } from './adapters/command-runner.mjs'
import { fetchIssueComments, postIssueComment } from './mission-control/adapters/github-transport.mjs'
import { writeIssueBodyWithLease } from './mission-control/workflows/issue-body-cas.mjs'
import { parseRoleCommentBody } from './mission-control-reconcile.mjs'
import { executeReviewWorkflow } from './mission-control/workflows/review.mjs'
import { createHelpEnvelopeV1, formatTextHelp } from './cli/command-help.mjs'
import { CliInvocationError, parseCommandInvocation, resolveCommandIdentity } from './cli/command-invocation.mjs'
import { createResultRendering, createRuntimeErrorRendering } from './mission-control/domain/review-result-rendering.ts'

const COMMAND = 'bemoat:mission-control:review'
const ENTRYPOINT = 'scripts/mission-control-review.mjs'
const ROLE_COMMENT_ENTRYPOINT = fileURLToPath(new URL('./post-role-comment.mjs', import.meta.url))

function resolveReviewCommand() {
  const env = process.env.npm_lifecycle_event === 'test:int' ? { ...process.env, npm_lifecycle_event: undefined } : process.env
  return resolveCommandIdentity({ fallback: COMMAND, env, entrypoint: ENTRYPOINT })
}

function renderHelp(invocation) {
  if (invocation.format === 'json') process.stdout.write(`${JSON.stringify(createHelpEnvelopeV1(invocation.contract))}\n`)
  else process.stdout.write(formatTextHelp(invocation.contract))
}

async function main() {
  let command = null
  let invocation = null
  let mutationPerformed = false
  let parsedVerdict = null
  try {
    command = resolveReviewCommand()
    invocation = parseCommandInvocation(command, process.argv.slice(2))
    if (invocation.mode === 'help') {
      renderHelp(invocation)
      return
    }
    const options = {
      issue: invocation.values.issue_number,
      repo: invocation.values.repository ?? null,
      bodyFile: invocation.values.body_file ?? null,
      expectedState: invocation.values.expected_state,
      reviewType: invocation.values.review_type,
      expectedHead: invocation.values.expected_head,
    }
    let body
    try {
      body = readFileSync(options.bodyFile, 'utf8')
    } catch (error) {
      throw new CliInvocationError(options.bodyFile, error instanceof Error ? error.message : String(error))
    }
    run(process.execPath, [ROLE_COMMENT_ENTRYPOINT, options.issue, '--body-file', options.bodyFile, '--check', ...(options.repo ? ['--repo', options.repo] : [])], { env: { ...process.env, npm_lifecycle_event: undefined } })
    parsedVerdict = parseRoleCommentBody(body)
    const workflow = await executeReviewWorkflow({
      options,
      body,
      parsedVerdict,
      onMutation: () => { mutationPerformed = true },
      dependencies: { run, fetchIssueComments, postIssueComment, writeIssueBodyWithLease },
    })
    const rendering = createResultRendering({ command, options: { ...options, prNumber: workflow.prNumber }, result: workflow.result, repository: workflow.repository, observedPreState: workflow.observedPreState })
    if (invocation.format === 'json') process.stdout.write(`${JSON.stringify(rendering.envelope)}\n`)
    else process.stdout.write(`${rendering.envelope.classification}: ${rendering.output}\n`)
    process.exitCode = rendering.exitCode
  } catch (error) {
    const rendering = createRuntimeErrorRendering({ command: command ?? COMMAND, format: invocation?.format ?? (process.argv.includes('--json') ? 'json' : 'text'), error, mutationPerformed, values: invocation?.values, parsedVerdict })
    if (rendering.stream === 'stdout') process.stdout.write(rendering.output)
    else process.stderr.write(rendering.output)
    process.exitCode = rendering.exitCode
  }
}

main()
