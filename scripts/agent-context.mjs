#!/usr/bin/env node

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createHelpEnvelopeV1, formatTextHelp } from './cli/command-help.mjs'
import {
  CliInvocationError,
  parseCommandInvocation,
  resolveCommandIdentity,
} from './cli/command-invocation.mjs'
import { collectContextEvidence } from './context/evidence.ts'
import { routeContext } from './context/router.ts'

function renderHelp(invocation) {
  if (invocation.format === 'json') {
    process.stdout.write(`${JSON.stringify(createHelpEnvelopeV1(invocation.contract))}\n`)
    return
  }

  process.stdout.write(formatTextHelp(invocation.contract))
}

function handleInvocationError(error) {
  if (!(error instanceof CliInvocationError)) return false

  process.stderr.write(`INVALID_INVOCATION: ${error.details.reason}\n`)
  process.exitCode = error.exit_code
  return true
}

function getFacadeEnvironment() {
  const lifecycleEvent = process.env.npm_lifecycle_event
  if (!lifecycleEvent || lifecycleEvent.startsWith('bemoat:')) return process.env

  return { ...process.env, npm_lifecycle_event: undefined }
}

function createContextOutput(evidence, decision, issueNumber) {
  return {
    schema_version: 1,
    command: 'bemoat:context',
    mode: 'context',
    mutation_performed: false,
    repository: evidence.repository,
    protected_base: evidence.protectedBase,
    policy: evidence.policy,
    issue: evidence.issue,
    local_git: evidence.localGit,
    active_pr: evidence.activePr,
    current_head_verification: evidence.currentHeadVerification,
    durable_context: evidence.durableContext,
    route: decision.route,
    reasons: decision.reasons,
    next_action: {
      type: decision.nextAction.type,
      command: decision.nextAction.command,
      reason: decision.nextAction.description,
    },
    evidence_urls: decision.evidenceUrls,
    issue_number: issueNumber,
  }
}

function renderText(output) {
  const lines = [
    `bemoat:context — Issue #${output.issue_number}`,
    `Repository: ${output.repository.nameWithOwner}`,
    `Protected base: ${output.protected_base.branch}@${output.protected_base.sha || '<unavailable>'}`,
    `Policy: ${output.policy.path} ${output.policy.version || '<unavailable>'}`,
    `Local: ${output.local_git.branch} ${output.local_git.head || '<unavailable>'} (${output.local_git.durable ? 'durable' : 'not durable'})`,
    `Route: ${output.route}`,
    `Next: ${output.next_action.reason}`,
  ]
  if (output.reasons.length > 0) {
    lines.push('Reasons:', ...output.reasons.map((reason) => `- ${reason}`))
  }
  process.stdout.write(`${lines.join('\n')}\n`)
}

function main() {
  let invocation

  try {
    const command = resolveCommandIdentity({
      fallback: 'bemoat:context',
      env: getFacadeEnvironment(),
      entrypoint: 'scripts/agent-context.mjs',
    })
    invocation = parseCommandInvocation(command, process.argv.slice(2))
  } catch (error) {
    if (handleInvocationError(error)) return
    throw error
  }

  if (invocation.mode === 'help') {
    renderHelp(invocation)
    return
  }

  const issueNumber = String(invocation.values.issue_number)
  const evidence = collectContextEvidence({ issueNumber })
  const decision = routeContext(evidence)
  const output = createContextOutput(evidence, decision, issueNumber)
  if (invocation.format === 'json') {
    process.stdout.write(`${JSON.stringify(output)}\n`)
  } else {
    renderText(output)
  }
}

if (
  process.argv[1] &&
  (resolve(process.argv[1]) === fileURLToPath(import.meta.url) ||
    process.argv[1].endsWith('/agent-context.mjs'))
) {
  main()
}
