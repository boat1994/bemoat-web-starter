#!/usr/bin/env node
import { readFileSync } from 'node:fs'

import { createHelpEnvelopeV1, formatTextHelp } from './cli/command-help.mjs'
import { CliInvocationError, parseCommandInvocation, resolveCommandIdentity } from './cli/command-invocation.mjs'
import { renderResult, renderRuntimeError } from './mission-control/domain/role-comment-rendering.mjs'
import { runPostRoleCommentWorkflow } from './mission-control/workflows/post-role-comment.mjs'

const COMMAND = 'bemoat:issue:comment'
const ENTRYPOINT = 'scripts/post-role-comment.mjs'

function resolveRoleCommentCommand() {
  const env = process.env.npm_lifecycle_event === 'test:int'
    ? { ...process.env, npm_lifecycle_event: undefined }
    : process.env
  return resolveCommandIdentity({ fallback: COMMAND, env, entrypoint: ENTRYPOINT })
}

function renderHelp(invocation) {
  if (invocation.format === 'json') {
    process.stdout.write(`${JSON.stringify(createHelpEnvelopeV1(invocation.contract))}\n`)
    return
  }
  process.stdout.write(formatTextHelp(invocation.contract))
}

function readBody(bodyFile) {
  const stdin = !process.stdin.isTTY ? readFileSync(0, 'utf8') : ''
  if (bodyFile && stdin.length > 0) throw new CliInvocationError('--body-file', '--body-file and stdin are mutually exclusive')
  if (bodyFile) {
    try { return readFileSync(bodyFile, 'utf8') } catch (error) {
      throw new CliInvocationError(bodyFile, error instanceof Error ? error.message : String(error))
    }
  }
  if (!stdin) throw new CliInvocationError('stdin', 'provide a comment body through --body-file or stdin')
  return stdin
}

function main() {
  let command = null
  let invocation = null
  try {
    command = resolveRoleCommentCommand()
    invocation = parseCommandInvocation(command, process.argv.slice(2))
    if (invocation.mode === 'help') return renderHelp(invocation)
    const options = {
      issue: invocation.values.issue_number,
      repo: invocation.values.repository ?? null,
      bodyFile: invocation.values.body_file ?? null,
      check: invocation.values.check === true,
      allowWarning: invocation.values.allow_warning === true,
    }
    const result = runPostRoleCommentWorkflow({
      options,
      body: readBody(options.bodyFile),
      contract: invocation.contract,
      command,
      format: invocation.format,
    })
    renderResult(result)
  } catch (error) {
    const format = invocation?.format ?? (process.argv.includes('--json') ? 'json' : 'text')
    renderRuntimeError({ command: command ?? COMMAND, format, error, values: invocation?.values })
  }
}

main()
