#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { parseRoleCommentBody } from './mission-control-reconcile.mjs'
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
  classifyDelegatedFailure,
} from './cli/command-result.mjs'
import { executeDispatchWorkflow } from './mission-control/workflows/dispatch.mjs'
import {
  createResultRendering,
  createRuntimeErrorRendering,
  runtimeError,
} from './mission-control/domain/dispatch-result-rendering.ts'

const COMMAND = 'bemoat:mission-control:dispatch'
const ENTRYPOINT = 'scripts/mission-control-dispatch.mjs'
const ROLE_COMMENT_ENTRYPOINT = fileURLToPath(new URL('./post-role-comment.mjs', import.meta.url))

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    input: options.input,
    env: options.env,
  })
  if (result.error || result.status !== 0) {
    const reason = result.stderr || result.stdout || result.error?.message || `${command} failed`
    throw runtimeError(
      classifyDelegatedFailure({
        command,
        stdout: result.stdout,
        stderr: result.stderr,
        error: result.error,
      }),
      reason,
    )
  }
  return result.stdout.trim()
}

function resolveDispatchCommand() {
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

function renderRuntimeError({ command, format, error, values = {} }) {
  const rendering = createRuntimeErrorRendering({ command, format, error, values })
  process[rendering.stream].write(rendering.output)
  process.exitCode = rendering.exitCode
}

function renderResult({ command, format, options, result, observedPreState, handoffBody }) {
  const parsedBody = parseRoleCommentBody(handoffBody)
  const rendering = createResultRendering({
    command,
    format,
    options,
    result,
    observedPreState,
    parsedBody,
  })
  process[rendering.stream].write(rendering.output)
  process.exitCode = rendering.exitCode
}

async function main() {
  let command = null
  let invocation = null
  let observedPreState = null

  try {
    command = resolveDispatchCommand()
    invocation = parseCommandInvocation(command, process.argv.slice(2))

    if (invocation.mode === 'help') {
      renderHelp(invocation)
      return
    }

    const options = {
      issue: invocation.values.issue_number,
      repo: invocation.values.repository ?? null,
      bodyFile: invocation.values.body_file ?? null,
      founderCorrection: invocation.values.founder_correction === true,
      workflowMode: invocation.values.workflow_mode ?? null,
      planningBaseSha: invocation.values.planning_base_sha ?? null,
    }
    const repo = options.repo || run('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'])
    let handoffBody
    try {
      const stdin = !process.stdin.isTTY ? readFileSync(0, 'utf8') : ''
      if (options.bodyFile && stdin.length > 0) {
        throw new CliInvocationError('--body-file', '--body-file and stdin are mutually exclusive')
      }
      handoffBody = options.bodyFile
        ? readFileSync(options.bodyFile, 'utf8')
        : stdin
    } catch (error) {
      if (error instanceof CliInvocationError) throw error
      throw new CliInvocationError(
        options.bodyFile ?? 'stdin',
        error instanceof Error ? error.message : String(error),
      )
    }
    if (!handoffBody) {
      throw new CliInvocationError('stdin', 'provide a HANDOFF through --body-file or stdin')
    }

    const timestamp = new Date().toISOString()
    const result = await executeDispatchWorkflow({
      options: { ...options, repo },
      handoffBody,
      updatedAt: timestamp,
      updatedBy: 'Mission Control',
      onObservedPreState: (state) => { if (observedPreState === null) observedPreState = state },
      dependencies: {
        run,
        execPath: process.execPath,
        env: process.env,
        roleCommentEntrypoint: ROLE_COMMENT_ENTRYPOINT,
      },
    })
    renderResult({
      command,
      format: invocation.format,
      options: { ...options, repo },
      result,
      observedPreState,
      handoffBody,
    })
  } catch (error) {
    const format = invocation?.format ?? (process.argv.includes('--json') ? 'json' : 'text')
    renderRuntimeError({
      command: command ?? COMMAND,
      format,
      error,
      values: invocation?.values,
    })
  }
}

main()
