#!/usr/bin/env node
/**
 * Thin CLI/orchestration entrypoint for agent-issue preflight.
 * Implementation lives in scripts/agent-issue/* by security and evidence boundary.
 */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createHelpEnvelopeV1, formatTextHelp } from './cli/command-help.mjs'
import {
  CliInvocationError,
  parseCommandInvocation,
  resolveCommandIdentity,
} from './cli/command-invocation.mjs'
import { parseCompleteGitHubPullUrl } from './pr-identity.mjs'
import { parseMissionControlState } from './mission-control-state.mjs'
import {
  analyzeExactHeadCi,
  isCheckFailed,
  isCheckSuccessful,
  normalizeStatusChecks,
} from './agent-issue/exact-head-ci.mjs'
import {
  deriveWorkflowProfile,
  parseDurableProgress,
  parseIssueDeclarations,
  validatePlanPath,
} from './agent-issue/issue-declarations.mjs'
import { runAgentIssuePreflight } from './agent-issue/issue-preflight.mjs'
import { parseIssueReference, parsePrReference } from './agent-issue/issue-references.mjs'
import { analyzeProgressTracking } from './agent-issue/progress-tracking.mjs'

export {
  parseMissionControlState,
  parseCompleteGitHubPullUrl,
  deriveWorkflowProfile,
  parseIssueDeclarations,
  parseDurableProgress,
  parseIssueReference,
  parsePrReference,
  validatePlanPath,
  normalizeStatusChecks,
  isCheckSuccessful,
  isCheckFailed,
  analyzeExactHeadCi,
  analyzeProgressTracking,
  runAgentIssuePreflight,
}

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

function main() {
  let invocation

  try {
    const command = resolveCommandIdentity({
      fallback: 'bemoat:agent:issue',
      env: getFacadeEnvironment(),
      entrypoint: 'scripts/agent-issue.mjs',
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

  const issueArgs = [invocation.values.issue_number]
  if (invocation.values.phase) {
    issueArgs.push('--phase', invocation.values.phase)
  }

  const report = runAgentIssuePreflight({ argv: issueArgs })
  const stream = report.usageError ? process.stderr : process.stdout

  stream.write(`${report.output.join('\n')}\n`)
  process.exit(report.exitCode)
}

if (
  process.argv[1] &&
  (resolve(process.argv[1]) === fileURLToPath(import.meta.url) ||
    process.argv[1].endsWith('/agent-issue.mjs'))
) {
  main()
}
