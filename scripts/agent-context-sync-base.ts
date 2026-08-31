#!/usr/bin/env node

import { createHelpEnvelopeV1, formatTextHelp } from './cli/command-help.ts'
import { CliInvocationError, parseCommandInvocation, resolveCommandIdentity } from './cli/command-invocation.ts'
import { classificationExitCode, createResultEnvelopeV1 } from './cli/command-result.ts'
import { collectContextEvidence } from './context/evidence.ts'
import { synchronizeContext } from './context/sync.ts'
import { ContextSyncWorktreeError, resolveContextSyncRoots } from './context/sync-worktree.ts'
import type { NormalizedContextEvidence } from './context/model.ts'
import type { ContextSyncResult } from './context/sync.ts'
import type { ParsedInvocation } from './cli/command-invocation-schemas.ts'

const COMMAND = 'bemoat:context:sync-base'
const ENTRYPOINT = 'scripts/agent-context-sync-base.ts'

function renderHelp(invocation: Extract<ParsedInvocation, { mode: 'help' }>) {
  if (invocation.format === 'json') process.stdout.write(`${JSON.stringify(createHelpEnvelopeV1(invocation.contract))}\n`)
  else process.stdout.write(formatTextHelp(invocation.contract))
}

function renderResult({ command, format, issueNumber, result, evidence }: { command: string; format: 'json' | 'text'; issueNumber: string; result: ContextSyncResult; evidence: NormalizedContextEvidence }) {
  const success = result.classification === 'SUCCESS'
  const envelope = createResultEnvelopeV1({
    command,
    outcome: success ? 'SUCCESS' : 'STOP',
    classification: result.classification,
    mutation_performed: result.mutationPerformed,
    repository: evidence.repository.nameWithOwner,
    issue_number: issueNumber,
    pr_number: !Array.isArray(evidence.activePr) ? evidence.activePr?.number ?? null : null,
    exact_head: result.currentHead ?? (!Array.isArray(evidence.activePr) ? evidence.activePr?.headSha ?? null : null),
    next_action: {
      type: result.nextAction.type,
      command: result.nextAction.command,
      reason: result.nextAction.description,
    },
    details: {
      route: result.route,
      reasons: result.reasons,
      evidence_urls: [evidence.repository.url, evidence.protectedBase.url, evidence.policy.url, evidence.issue.url, ...(!Array.isArray(evidence.activePr) && evidence.activePr ? [evidence.activePr.url] : [])],
      exact_head_ci_and_review_must_rerun: success,
    },
  })
  if (format === 'json') process.stdout.write(`${JSON.stringify(envelope)}\n`)
  else process.stdout.write(`${success ? 'SUCCESS' : result.classification}: ${result.reasons.join('; ')}\n`)
  process.exitCode = success ? 0 : classificationExitCode(result.classification)
}

function renderError({ command, format, error, values }: { command: string; format: 'json' | 'text'; error: unknown; values?: Record<string, string | boolean> }) {
  const classification = error instanceof CliInvocationError ? error.classification : 'INTERNAL_ERROR'
  const reason = error instanceof Error ? error.message : String(error)
  if (format === 'json') {
    process.stdout.write(`${JSON.stringify(createResultEnvelopeV1({
      command,
      outcome: 'ERROR',
      classification,
      mutation_performed: false,
      issue_number: values?.issue_number ?? null,
      next_action: { type: 'STOP', command: null, reason },
      details: { reason },
    }))}\n`)
  } else process.stderr.write(`ERROR: ${classification}: ${reason}\n`)
  process.exitCode = classificationExitCode(classification)
}

function main() {
  let invocation = null
  let command = COMMAND
  try {
    command = resolveCommandIdentity({ fallback: COMMAND, env: process.env, entrypoint: ENTRYPOINT })
    invocation = parseCommandInvocation(command, process.argv.slice(2))
    if (invocation.mode === 'help') return renderHelp(invocation)
    let roots
    try {
      roots = resolveContextSyncRoots({
        sourceCwd: process.cwd(),
        targetWorktree: typeof invocation.values.target_worktree === 'string' ? invocation.values.target_worktree : null,
      })
    } catch (error) {
      if (error instanceof ContextSyncWorktreeError) {
        throw new CliInvocationError('--target-worktree', error.message)
      }
      throw error
    }
    if (invocation.mode !== 'run') throw new Error('run invocation required')
    const evidence = collectContextEvidence({ cwd: roots.targetCwd, issueNumber: String(invocation.values.issue_number) })
    const result = synchronizeContext({
      evidence,
      cwd: roots.targetCwd,
      sourceCwd: roots.bootstrap ? roots.sourceCwd : null,
    })
    return renderResult({ command, format: invocation.format, issueNumber: String(invocation.values.issue_number), result, evidence })
  } catch (error) {
    return renderError({ command, format: invocation?.format ?? (process.argv.includes('--json') ? 'json' : 'text'), error, values: invocation?.mode === 'run' ? invocation.values : undefined })
  }
}

main()
