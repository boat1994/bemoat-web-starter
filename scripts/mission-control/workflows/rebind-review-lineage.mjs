#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

import {
  createHelpEnvelopeV1,
  formatTextHelp,
} from '../../cli/command-help.mjs'
import {
  CliInvocationError,
  parseCommandInvocation,
  resolveCommandIdentity,
} from '../../cli/command-invocation.mjs'
import {
  CLI_EXIT_CODES,
  classificationExitCode,
  createResultEnvelopeV1,
} from '../../cli/command-result.mjs'
import { isLeaseCasConflict, writeIssueBodyWithLease } from './issue-body-cas.mjs'
import {
  parseMissionControlState,
  projectMissionControlStateBlock,
} from '../domain/task-state.ts'
import { verifyPostedCommentReadback } from '../comment-evidence.ts'
import { selectLiveReviewVerdictComment } from '../review-verdict-binding.mjs'
import {
  ACCEPTED_PRE_STATE,
  REBIND_COMMAND,
  REBIND_ENTRYPOINT,
  REGISTERED_TUPLE,
  assertCanonicalRebindBody,
  assertFounderAuthorization,
  assertLegacySourceComment,
  assertLiveManagedPreState,
  assertRegisteredTuple,
  assertUnchangedExceptLineage,
  buildDemotionBody,
  buildRebindTransitionIdentity,
  classifiedError,
  classifyActiveVerdicts,
  isDemotedSourceBody,
  parseDemotedCanonicalId,
  projectLineageRebindState,
  sameId,
} from '../domain/review-lineage-rebind.mjs'

function flattenPages(value) {
  return Array.isArray(value)
    ? value.flat(Infinity).filter((entry) => entry && typeof entry === 'object')
    : []
}

function resolveRebindCommand() {
  const env = process.env.npm_lifecycle_event === 'test:int'
    ? { ...process.env, npm_lifecycle_event: undefined }
    : process.env
  return resolveCommandIdentity({
    fallback: REBIND_COMMAND,
    env,
    entrypoint: REBIND_ENTRYPOINT,
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
  ) return error.classification
  const reason = error instanceof Error ? error.message : String(error)
  const prefix = reason.match(/^(?:ERROR:\s*)?([A-Z_]+):/)
  if (prefix && Object.hasOwn(CLI_EXIT_CODES, prefix[1])) return prefix[1]
  if (isLeaseCasConflict(error) || /\blease\b/i.test(reason)) return 'STATE_CONFLICT'
  if (/\b(?:gh|GitHub|network|remote)\b/i.test(reason)) return 'BLOCKED_EXTERNAL'
  return 'INTERNAL_ERROR'
}

function invocationToOptions(invocation) {
  const values = invocation.values
  return {
    issueNumber: String(values.issue_number),
    repo: values.repository,
    expectedPr: String(values.expected_pr),
    expectedBase: values.expected_base,
    expectedState: values.expected_state,
    expectedHead: String(values.expected_head).toLowerCase(),
    expectedReviewCycle: String(values.expected_review_cycle),
    expectedFullReviewCount: String(values.expected_full_review_count),
    sourceComment: String(values.source_comment),
    authorizationComment: String(values.authorization_comment),
    bodyFile: values.body_file,
  }
}

function renderResult({ command, format, options, result }) {
  const envelope = createResultEnvelopeV1({
    command,
    outcome: result.outcome === 'REBOUND' ? 'SUCCESS' : result.outcome,
    classification: result.classification,
    mutation_performed: result.mutationPerformed === true,
    observed_pre_state: result.observedPreState ?? null,
    resulting_state: result.state?.state ?? null,
    repository: options.repo.toLowerCase(),
    issue_number: String(options.issueNumber),
    pr_number: String(options.expectedPr),
    exact_head: options.expectedHead,
    evidence_ids: result.evidenceIds ?? {},
    next_action: result.nextAction ?? {
      type: 'COMPLETE',
      command: null,
      reason: 'The registered lineage-transport rebind is verified.',
    },
    details: {
      source_comment_id: String(options.sourceComment),
      authorization_comment_id: String(options.authorizationComment),
      counters_unchanged: true,
    },
  })
  if (format === 'json') process.stdout.write(`${JSON.stringify(envelope)}\n`)
  else process.stdout.write(`${envelope.classification}: lineage rebind Task #${options.issueNumber}\n`)
  process.exitCode = classificationExitCode(envelope.classification)
  return envelope
}

function completeResult({ state, comment, mutationPerformed, observedPreState, classification, outcome }) {
  return {
    classification,
    outcome,
    mutationPerformed,
    state,
    comment,
    observedPreState,
    nextAction: {
      type: 'COMPLETE',
      command: null,
      reason: classification === 'NO_OP_IDENTICAL_RETRY'
        ? 'The identical lineage-transport rebind is already durable.'
        : 'The registered lineage-transport rebind is verified.',
    },
    evidenceIds: {
      source_comment_id: String(REGISTERED_TUPLE.sourceComment),
      canonical_comment_id: String(comment?.id ?? ''),
    },
  }
}

async function readLiveEvidence({ options, body, deps }) {
  assertRegisteredTuple(options)
  assertCanonicalRebindBody(body, options)
  if (!deps || typeof deps.readManagedIssue !== 'function') {
    throw classifiedError('INTERNAL_ERROR', 'rebind-review-lineage requires live GitHub evidence dependencies')
  }
  const [issue, pr, comments] = await Promise.all([
    deps.readManagedIssue(options.issueNumber, options.repo),
    deps.readPullRequest(options.expectedPr, options.repo),
    deps.readIssueComments(options.repo, options.issueNumber),
  ])
  let source
  let authorization
  try {
    source = await deps.readComment(options.repo, options.sourceComment)
  } catch (error) {
    throw classifiedError(
      'STATE_CONFLICT',
      `source comment ${options.sourceComment} is unavailable: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  try {
    authorization = await deps.readComment(options.repo, options.authorizationComment)
  } catch (error) {
    throw classifiedError(
      'AUTHORITY_CONFLICT',
      `Founder authorization comment is unavailable: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const parsed = issue.managedState
    ? { present: true, valid: true, state: issue.managedState }
    : parseMissionControlState(issue.body)
  if (!parsed.present || !parsed.valid) {
    throw classifiedError('STATE_CONFLICT', `Issue has invalid managed state: ${parsed.reason ?? 'missing state block'}`)
  }
  const state = parsed.state
  assertLiveManagedPreState({ state, options })
  if (Number(pr?.number) !== Number(options.expectedPr)) {
    throw classifiedError('STATE_CONFLICT', 'live PR number does not match the registered tuple')
  }
  if (String(pr.baseRefName ?? '').toLowerCase() !== String(options.expectedBase).toLowerCase()) {
    throw classifiedError('STATE_CONFLICT', 'live PR base does not match the registered tuple')
  }
  if (String(pr.headRefOid ?? '').toLowerCase() !== String(options.expectedHead).toLowerCase()) {
    throw classifiedError('HEAD_DRIFT', 'live PR exact head does not match the registered tuple')
  }
  assertLegacySourceComment({ comment: source, options })
  assertFounderAuthorization({ comment: authorization, options })
  const classified = classifyActiveVerdicts({
    comments,
    sourceComment: options.sourceComment,
    canonicalBody: body,
  })
  if (classified.competitors.length > 0) {
    throw classifiedError(
      'AMBIGUOUS_RESULT',
      `competing active REVIEW_VERDICT ${classified.competitors.map((comment) => comment.id).join(', ')} blocks lineage rebind`,
    )
  }
  if (classified.matchingCanonicals.length > 1) {
    throw classifiedError('AMBIGUOUS_RESULT', 'multiple matching canonical REVIEW_VERDICT comments exist')
  }
  return {
    issue: { ...issue, managedState: state, body: issue.body },
    pr,
    comments,
    source,
    authorization,
    classified,
    transitionIdentity: buildRebindTransitionIdentity({ body, options }),
  }
}

function isIdenticalRetry({ evidence, options }) {
  const canonical = evidence.classified.matchingCanonicals[0]
  const demotedId = parseDemotedCanonicalId(evidence.source.body)
  return Boolean(
    canonical &&
    isDemotedSourceBody(evidence.source.body) &&
    sameId(demotedId, canonical.id) &&
    sameId(evidence.issue.managedState.latest_review_verdict_comment_id, canonical.id) &&
    evidence.issue.managedState.latest_transition_identity === evidence.transitionIdentity &&
    Number(evidence.issue.managedState.review_cycle) === Number(options.expectedReviewCycle) &&
    Number(evidence.issue.managedState.full_review_count) === Number(options.expectedFullReviewCount) &&
    evidence.issue.managedState.state === ACCEPTED_PRE_STATE,
  )
}

async function readbackAuthoritativeCanonical({ deps, options, body, commentId }) {
  const comments = await deps.readIssueComments(options.repo, options.issueNumber)
  const pr = await deps.readPullRequest(options.expectedPr, options.repo)
  const selected = selectLiveReviewVerdictComment({
    comments,
    issueNumber: options.issueNumber,
    livePr: pr,
  })
  if (!sameId(selected.id, commentId) || String(selected.body ?? '') !== String(body)) {
    throw classifiedError(
      'AMBIGUOUS_RESULT',
      'live readback did not select exactly one authoritative canonical REVIEW_VERDICT',
    )
  }
  verifyPostedCommentReadback({
    comments,
    body,
    role: 'REVIEW_VERDICT',
    postedId: commentId,
    matchOptions: { trustedAuthors: ['boat1994'], requireTrustedAuthor: false },
  })
  return selected
}

export async function runReviewLineageRebind({ options, body, deps }) {
  const evidence = await readLiveEvidence({ options, body, deps })
  if (isIdenticalRetry({ evidence, options })) {
    return completeResult({
      state: evidence.issue.managedState,
      comment: evidence.classified.matchingCanonicals[0],
      mutationPerformed: false,
      observedPreState: evidence.issue.managedState.state,
      classification: 'NO_OP_IDENTICAL_RETRY',
      outcome: 'NO_OP',
    })
  }

  let mutationPerformed = false
  let canonical = evidence.classified.matchingCanonicals[0] ?? null
  try {
    if (!canonical) {
      mutationPerformed = true
      const posted = await deps.postComment(options.repo, options.issueNumber, body)
      if (posted?.id == null) {
        throw classifiedError('AMBIGUOUS_RESULT', 'canonical REVIEW_VERDICT comment did not return a durable identifier')
      }
      const comments = await deps.readIssueComments(options.repo, options.issueNumber)
      canonical = verifyPostedCommentReadback({
        comments,
        body,
        role: 'REVIEW_VERDICT',
        postedId: posted.id,
        matchOptions: { trustedAuthors: ['boat1994'], requireTrustedAuthor: false },
      })
    }

    const source = await deps.readComment(options.repo, options.sourceComment)
    if (!isDemotedSourceBody(source.body)) {
      mutationPerformed = true
      const nextBody = buildDemotionBody(source.body, canonical.id)
      await deps.updateComment(options.repo, options.sourceComment, nextBody)
      const demoted = await deps.readComment(options.repo, options.sourceComment)
      if (!sameId(parseDemotedCanonicalId(demoted.body), canonical.id) || !isDemotedSourceBody(demoted.body)) {
        throw classifiedError('AMBIGUOUS_RESULT', 'source comment demotion could not be verified')
      }
    } else if (!sameId(parseDemotedCanonicalId(source.body), canonical.id)) {
      throw classifiedError('AMBIGUOUS_RESULT', 'source comment is demoted to a different canonical lineage')
    }

    const live = await deps.readManagedIssue(options.issueNumber, options.repo)
    const liveParsed = live.managedState
      ? { valid: true, state: live.managedState, present: true }
      : parseMissionControlState(live.body)
    if (!liveParsed.valid) {
      throw classifiedError('AMBIGUOUS_RESULT', 'managed state became invalid during lineage rebind')
    }
    if (!sameId(liveParsed.state.latest_review_verdict_comment_id, canonical.id) ||
        liveParsed.state.latest_transition_identity !== evidence.transitionIdentity) {
      mutationPerformed = true
      const nextState = projectLineageRebindState({
        prior: liveParsed.state,
        commentId: canonical.id,
        transitionIdentity: evidence.transitionIdentity,
      })
      const expectedBody = live.body ?? evidence.issue.body
      const nextBody = projectMissionControlStateBlock(expectedBody, nextState)
      await deps.writeIssueBody({
        repo: options.repo,
        issueNumber: options.issueNumber,
        expectedBody,
        nextBody,
        transitionIdentity: evidence.transitionIdentity,
      })
    }

    const verified = await deps.readManagedIssue(options.issueNumber, options.repo)
    const verifiedParsed = verified.managedState
      ? { valid: true, state: verified.managedState }
      : parseMissionControlState(verified.body)
    if (!verifiedParsed.valid) {
      throw classifiedError('AMBIGUOUS_RESULT', 'post-write managed state readback is invalid')
    }
    assertUnchangedExceptLineage({
      prior: evidence.issue.managedState,
      next: verifiedParsed.state,
      commentId: canonical.id,
      transitionIdentity: evidence.transitionIdentity,
    })
    await readbackAuthoritativeCanonical({
      deps,
      options,
      body,
      commentId: canonical.id,
    })
    return completeResult({
      state: verifiedParsed.state,
      comment: canonical,
      mutationPerformed,
      observedPreState: evidence.issue.managedState.state,
      classification: 'SUCCESS',
      outcome: 'REBOUND',
    })
  } catch (error) {
    if (mutationPerformed && runtimeClassification(error) !== 'AMBIGUOUS_RESULT') {
      throw classifiedError(
        'AMBIGUOUS_RESULT',
        `lineage rebind mutation result is ambiguous: ${error instanceof Error ? error.message : String(error)}`,
        { mutationPerformed: true },
      )
    }
    throw error
  }
}

export function createProductionDeps() {
  const runGh = (args, options = {}) => {
    const result = spawnSync('gh', args, {
      encoding: 'utf8',
      input: options.input,
      env: options.env ?? process.env,
    })
    if (result.error || result.status !== 0) {
      const error = classifiedError(
        'BLOCKED_EXTERNAL',
        result.stderr || result.stdout || result.error?.message || 'GitHub CLI failed',
      )
      throw error
    }
    return result.stdout.trim()
  }
  return {
    readManagedIssue: async (issueNumber, repo) => {
      const issue = JSON.parse(runGh([
        'issue', 'view', String(issueNumber), '--repo', repo, '--json', 'number,id,title,body,state',
      ]))
      const parsed = parseMissionControlState(issue.body)
      if (!parsed.present || !parsed.valid) {
        throw classifiedError('STATE_CONFLICT', `Issue has invalid managed state: ${parsed.reason ?? 'missing state block'}`)
      }
      return { ...issue, managedState: parsed.state }
    },
    readPullRequest: async (prNumber, repo) => JSON.parse(runGh([
      'pr', 'view', String(prNumber), '--repo', repo,
      '--json', 'number,state,isDraft,headRefOid,baseRefName,baseRefOid',
    ])),
    readIssueComments: async (repo, issueNumber) => flattenPages(JSON.parse(runGh([
      'api', '--paginate', '--slurp', `repos/${repo}/issues/${issueNumber}/comments?per_page=100`,
    ]))),
    readComment: async (repo, commentId) => JSON.parse(runGh([
      'api', `repos/${repo}/issues/comments/${commentId}`,
    ])),
    postComment: async (repo, issueNumber, body) => JSON.parse(runGh([
      'api', '--method', 'POST', `repos/${repo}/issues/${issueNumber}/comments`, '--input', '-',
    ], { input: JSON.stringify({ body }) })),
    updateComment: async (repo, commentId, body) => JSON.parse(runGh([
      'api', '--method', 'PATCH', `repos/${repo}/issues/comments/${commentId}`, '--input', '-',
    ], { input: JSON.stringify({ body }) })),
    writeIssueBody: async ({ repo, issueNumber, expectedBody, nextBody, transitionIdentity }) =>
      writeIssueBodyWithLease({
        repo,
        issueNumber,
        expectedBody,
        nextBody,
        transitionIdentity,
        holder: 'mission-control-rebind-review-lineage',
        repoFlag: repo,
        deps: { runGh },
      }),
  }
}

export async function main(argv = process.argv.slice(2), deps = createProductionDeps()) {
  let command = null
  let invocation = null
  let options = null
  try {
    command = resolveRebindCommand()
    invocation = parseCommandInvocation(command, argv)
    if (invocation.mode === 'help') {
      renderHelp(invocation)
      process.exitCode = 0
      return { classification: 'HELP' }
    }
    options = invocationToOptions(invocation)
    const body = readFileSync(options.bodyFile, 'utf8')
    const result = await runReviewLineageRebind({ options, body, deps })
    return renderResult({ command, format: invocation.format, options, result })
  } catch (error) {
    const classification = error instanceof CliInvocationError
      ? 'INVALID_INVOCATION'
      : runtimeClassification(error)
    const message = error instanceof Error ? error.message : String(error)
    const envelope = createResultEnvelopeV1({
      command: command ?? REBIND_COMMAND,
      outcome: classification === 'INTERNAL_ERROR' ? 'ERROR' : 'STOP',
      classification,
      mutation_performed: error?.mutationPerformed === true,
      observed_pre_state: null,
      resulting_state: null,
      repository: options?.repo?.toLowerCase?.() ?? null,
      issue_number: options?.issueNumber ? String(options.issueNumber) : null,
      pr_number: options?.expectedPr ? String(options.expectedPr) : null,
      exact_head: options?.expectedHead ?? null,
      evidence_ids: {},
      next_action: { type: 'STOP', command: null, reason: message },
      details: { reason: message },
    })
    if (invocation?.format === 'json' || argv.includes('--json')) process.stdout.write(`${JSON.stringify(envelope)}\n`)
    else {
      const display = message.startsWith(`${classification}:`) ? message : `${classification}: ${message}`
      process.stderr.write(`${display}\n`)
    }
    process.exitCode = classificationExitCode(classification)
    return envelope
  }
}
