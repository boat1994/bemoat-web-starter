#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { analyzeExactHeadCi } from './agent-issue/exact-head-ci.mjs'
import { runCommand as run } from './adapters/command-runner.mjs'
import { parseReviewVerdictContractFindings } from './correction-contract.mjs'
import { parseMissionControlState, projectMissionControlStateBlock } from './mission-control-state.mjs'
import { preflightCanonicalBootstrapTask } from './mission-control/domain/task-bootstrap-preflight.mjs'
import {
  Coordinator,
  normalizeIssueComments,
  parsePaginatedGhApiJson,
  parseRoleCommentBody,
  projectReviewVerdictState,
  resolveProductionCommentTrust,
} from './mission-control-reconcile.mjs'
import { writeIssueBodyWithLease } from './mission-control-issue-body-cas.mjs'
import {
  detectUnaccountedReviewEvidence,
  isReviewRecoveryIncident,
} from './mission-control/domain/review-recovery.mjs'
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

const COMMAND = 'bemoat:mission-control:review'
const ENTRYPOINT = 'scripts/mission-control-review.mjs'
const ROLE_COMMENT_ENTRYPOINT = fileURLToPath(new URL('./post-role-comment.mjs', import.meta.url))

function runtimeError(classification, message, details = {}) {
  const error = new Error(message)
  error.classification = classification
  Object.assign(error, details)
  return error
}

function normalizeRepositoryOutput(value) {
  const trimmed = String(value ?? '').trim()
  try {
    const parsed = JSON.parse(trimmed)
    if (typeof parsed?.nameWithOwner === 'string') return parsed.nameWithOwner
  } catch {
    // The --jq form already returns plain text in production.
  }
  return trimmed
}

function resolveReviewCommand() {
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
  parsedVerdict = null,
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
      pr_number: parsedVerdict?.prNumber ?? null,
      exact_head: /^[0-9a-f]{40}$/i.test(parsedVerdict?.headSha ?? values.expected_head ?? '')
        ? (parsedVerdict?.headSha ?? values.expected_head).toLowerCase()
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
  } else if (classification === 'BLOCKED_EXTERNAL') {
    process.stdout.write(`${classification}: ${details.reason}\n`)
  } else {
    const legacyPrefix = details.legacy_classification
      ? `${details.legacy_classification}: `
      : ''
    process.stderr.write(`ERROR: ${classification}: ${legacyPrefix}${details.reason}\n`)
  }

  process.exitCode = classificationExitCode(classification)
}

function renderResult({ command, format, options, result, repository, observedPreState }) {
  const output = `Mission Control review ${result.outcome}: ${result.state.state} + REVIEW_VERDICT comment ${result.comment.id}`
  const envelope = createResultEnvelopeV1({
    command,
    outcome: 'SUCCESS',
    classification: 'SUCCESS',
    mutation_performed: true,
    observed_pre_state: observedPreState,
    resulting_state: result.state?.state ?? null,
    repository,
    issue_number: options.issue,
    pr_number: options.prNumber,
    exact_head: options.expectedHead.length === 40 ? options.expectedHead.toLowerCase() : null,
    next_action: {
      type: 'COMMAND',
      command: 'bemoat:mission-control:dispatch',
      reason: 'The resulting review state determines the next bounded dispatch or Founder gate.',
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
    process.stdout.write(`${output}\n`)
  }

  process.exitCode = classificationExitCode('SUCCESS')
}

function replaceStateBlock(body, state) {
  return projectMissionControlStateBlock(body, state)
}

function parseFindings(body, verdict) {
  const parsed = parseReviewVerdictContractFindings(body, verdict)
  if (!parsed.ok) throw new Error(`STATE_CONFLICT: ${parsed.errors.join('; ')}`)
  return parsed.findings
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
      throw new CliInvocationError(
        options.bodyFile,
        error instanceof Error ? error.message : String(error),
      )
    }
    run(process.execPath, [
      ROLE_COMMENT_ENTRYPOINT,
      options.issue,
      '--body-file',
      options.bodyFile,
      '--check',
      ...(options.repo ? ['--repo', options.repo] : []),
    ], {
      env: { ...process.env, npm_lifecycle_event: undefined },
    })
    parsedVerdict = parseRoleCommentBody(body)
    if (parsedVerdict.role !== 'REVIEW_VERDICT' || !parsedVerdict.verdict || !parsedVerdict.prNumber || !parsedVerdict.headSha) {
      throw new Error('STATE_CONFLICT: canonical REVIEW_VERDICT PR/head/verdict evidence is required')
    }
    if (parsedVerdict.headSha.toLowerCase() !== options.expectedHead.toLowerCase()) {
      throw new Error('STATE_CONFLICT: verdict head differs from --expected-head')
    }

    const repo = normalizeRepositoryOutput(
      options.repo || run('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']),
    )
    const issueArgs = ['issue', 'view', options.issue, '--json', 'number,id,title,body']
    if (options.repo) issueArgs.push('--repo', options.repo)
    let expectedBody = null
    let liveIssue = null
    const readIssue = () => {
      const issue = JSON.parse(run('gh', issueArgs))
      liveIssue = issue
      const parsed = parseMissionControlState(issue.body)
      if (!parsed.present || !parsed.valid) throw new Error(`STATE_CONFLICT: invalid managed state: ${parsed.reason ?? 'missing state block'}`)
      expectedBody = issue.body
      return parsed.state
    }
    const prArgs = ['pr', 'view', parsedVerdict.prNumber, '--json', 'number,id,headRefOid,baseRefName,statusCheckRollup', ...(options.repo ? ['--repo', options.repo] : [])]
    const pr = JSON.parse(run('gh', prArgs))
    if (
      pr.headRefOid.toLowerCase() !== options.expectedHead.toLowerCase() ||
      pr.headRefOid.toLowerCase() !== parsedVerdict.headSha.toLowerCase()
    ) {
      throw new Error('STATE_CONFLICT: live PR head differs from reviewed head')
    }
    if (!analyzeExactHeadCi(pr).exactHeadVerified) throw new Error('STATE_CONFLICT: exact-head CI is not verified')

    const verifyLivePullRequest = () => {
      const livePr = JSON.parse(run('gh', prArgs))
      if (
        livePr.headRefOid.toLowerCase() !== options.expectedHead.toLowerCase() ||
        livePr.headRefOid.toLowerCase() !== parsedVerdict.headSha.toLowerCase()
      ) {
        throw new Error('HEAD_DRIFT: live PR head changed during final validation')
      }
      if (!analyzeExactHeadCi(livePr).exactHeadVerified) {
        throw new Error('STATE_CONFLICT: exact-head CI is not verified during final validation')
      }
      return livePr
    }
    const listComments = () => {
      verifyLivePullRequest()
      return normalizeIssueComments(parsePaginatedGhApiJson(run('gh', ['api', '--paginate', `repos/${repo}/issues/${options.issue}/comments`])))
    }
    const listPrComments = () =>
      isReviewRecoveryIncident({ taskIssue: options.issue, activePr: parsedVerdict.prNumber })
        ? normalizeIssueComments(parsePaginatedGhApiJson(run('gh', ['api', '--paginate', `repos/${repo}/issues/${parsedVerdict.prNumber}/comments`])))
        : []
    const postComment = (commentBody) => {
      const temp = mkdtempSync(join(tmpdir(), 'bemoat-review-comment-'))
      const payload = join(temp, 'payload.json')
      try {
        writeFileSync(payload, JSON.stringify({ body: commentBody }))
        mutationPerformed = true
        let posted
        try {
          posted = JSON.parse(run('gh', ['api', '--method', 'POST', `repos/${repo}/issues/${options.issue}/comments`, '--input', payload]))
        } catch (error) {
          throw runtimeError(
            'AMBIGUOUS_RESULT',
            `review verdict comment result is ambiguous: ${error instanceof Error ? error.message : String(error)}`,
            {
              mutationPerformed: true,
              legacyClassification: 'STATE_CONFLICT',
            },
          )
        }
        if (posted?.id == null) {
          throw runtimeError(
            'AMBIGUOUS_RESULT',
            'review verdict comment did not return a durable comment identifier',
            {
              mutationPerformed: true,
              legacyClassification: 'STATE_CONFLICT',
            },
          )
        }
        return { ...posted, id: posted.id, body: posted.body ?? commentBody, author: posted.user?.login ?? null, author_association: posted.author_association ?? null }
      } finally { rmSync(temp, { recursive: true, force: true }) }
    }
    const writeState = async (next, expected) => {
      const live = JSON.parse(run('gh', issueArgs))
      const parsed = parseMissionControlState(live.body)
      if (!parsed.present || !parsed.valid || JSON.stringify(parsed.state) !== JSON.stringify(expected) || live.body !== expectedBody) throw new Error('STATE_CONFLICT: concurrent Issue body change detected before state write')
      const nextBody = replaceStateBlock(live.body, next)
      mutationPerformed = true
      await writeIssueBodyWithLease({ repo, issueNumber: options.issue, expectedBody: live.body, nextBody, transitionIdentity: next.latest_transition_identity, holder: 'mission-control-review', repoFlag: options.repo, deps: { runGh: (args, ghOptions) => run('gh', args, ghOptions) } })
      const verified = JSON.parse(run('gh', issueArgs))
      const verifiedState = parseMissionControlState(verified.body)
      if (!verifiedState.valid || verifiedState.state.latest_review_verdict_comment_id !== next.latest_review_verdict_comment_id) throw new Error('postcondition: verdict projection could not be verified')
      expectedBody = verified.body
      return verifiedState.state
    }
    const original = readIssue()
    const rawEvidence = detectUnaccountedReviewEvidence({
      repository: repo,
      taskIssue: options.issue,
      activePr: parsedVerdict.prNumber,
      managedState: original,
      issueComments: listComments(),
      prComments: listPrComments(),
    })
    if (!rawEvidence.ok) {
      throw new Error(`${rawEvidence.code}: ${rawEvidence.reason}. Use ${rawEvidence.recoveryCommand}.`)
    }
    const bootstrapPreflight = preflightCanonicalBootstrapTask({
      issue: liveIssue,
      pullRequest: pr,
      repository: repo,
    })
    if (!bootstrapPreflight.ok) throw new Error(`${bootstrapPreflight.classification ?? 'STATE_CONFLICT'}: ${bootstrapPreflight.reason}`)
    if (original.state !== options.expectedState) throw new Error(`STATE_CONFLICT: expected ${options.expectedState}, received ${original.state}`)
    if (original.approved_base !== pr.baseRefName) throw new Error('STATE_CONFLICT: live PR base differs from approved base')
    if (String(original.current_head ?? '').toLowerCase() !== options.expectedHead.toLowerCase()) {
      throw new Error('STATE_CONFLICT: managed current head differs from reviewed head')
    }
    const coordinator = new Coordinator({ readState: async () => readIssue(), writeState, listComments: async () => listComments(), postComment: async (comment) => postComment(comment), ...resolveProductionCommentTrust() })
    const result = await coordinator.integrateReviewVerdict({
      verdictBody: body,
      verifyPreconditions: async () => undefined,
      projectState: (prior, comment, identity) => projectReviewVerdictState({ prior, verdict: parsedVerdict.verdict, reviewType: options.reviewType, reviewedHead: options.expectedHead, commentId: comment.id, transitionIdentity: JSON.stringify(identity), findings: parseFindings(body, parsedVerdict.verdict) }),
    })
    if (result.outcome === 'RECOVERABLE_ROUTING_DRIFT') {
      throw runtimeError(
        'AMBIGUOUS_RESULT',
        `verdict comment ${result.comment.id} posted but projection failed; rerun this command`,
        {
          mutationPerformed: true,
          legacyClassification: result.outcome,
        },
      )
    }
    if (!result.comment?.id || !result.state?.state) {
      throw runtimeError('AMBIGUOUS_RESULT', 'review verdict result did not retain a durable comment and state', {
        mutationPerformed: true,
        legacyClassification: result.outcome,
      })
    }
    renderResult({
      command,
      format: invocation.format,
      options: { ...options, prNumber: parsedVerdict.prNumber },
      result,
      repository: repo,
      observedPreState: original.state,
    })
  } catch (error) {
    renderRuntimeError({
      command: command ?? COMMAND,
      format: invocation?.format ?? (process.argv.includes('--json') ? 'json' : 'text'),
      error,
      mutationPerformed,
      values: invocation?.values,
      parsedVerdict,
    })
  }
}

main()
