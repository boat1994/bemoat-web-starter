import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { analyzeExactHeadCi } from '../../agent-issue/exact-head-ci.mjs'
import { parseReviewVerdictContractFindings } from '../domain/correction-contract.mjs'
import { parseMissionControlState, projectMissionControlStateBlock } from '../domain/task-state.mjs'
import { preflightCanonicalBootstrapTask } from '../domain/task-bootstrap-preflight.mjs'
import {
  Coordinator,
  normalizeIssueComments,
  parsePaginatedGhApiJson,
  projectReviewVerdictState,
  resolveProductionCommentTrust,
  verifyPostedCommentReadback,
  normalizeAuthorityBase,
} from '../../mission-control-reconcile.mjs'
import {
  detectUnaccountedReviewEvidence,
  isReviewRecoveryIncident,
} from '../domain/review-recovery.mjs'
import { runtimeError } from '../domain/review-result-rendering.ts'

function issueArgs(options, fields) {
  const args = ['issue', 'view', options.issue, '--json', fields]
  if (options.repo) args.push('--repo', options.repo)
  return args
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

function parseFindings(body, verdict) {
  const parsed = parseReviewVerdictContractFindings(body, verdict)
  if (!parsed.ok) throw new Error(`STATE_CONFLICT: ${parsed.errors.join('; ')}`)
  return parsed.findings
}

export async function executeReviewWorkflow({ options, body, parsedVerdict, dependencies, onMutation, onObservedPreState }) {
  const { run, fetchIssueComments, postIssueComment, writeIssueBodyWithLease } = dependencies
  if (parsedVerdict.role !== 'REVIEW_VERDICT' || !parsedVerdict.verdict || !parsedVerdict.prNumber || !parsedVerdict.headSha) throw new Error('STATE_CONFLICT: canonical REVIEW_VERDICT PR/head/verdict evidence is required')
  if (parsedVerdict.headSha.toLowerCase() !== options.expectedHead.toLowerCase()) throw new Error('STATE_CONFLICT: verdict head differs from --expected-head')
  const repo = normalizeRepositoryOutput(
    options.repo || run('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']),
  )
  const issueArgsForCommand = issueArgs(options, 'number,id,title,body')
  let expectedBody = null
  let liveIssue = null
  const readIssue = () => {
    const issue = JSON.parse(run('gh', issueArgsForCommand))
    liveIssue = issue
    const parsed = parseMissionControlState(issue.body)
    if (!parsed.present || !parsed.valid) throw new Error(`STATE_CONFLICT: invalid managed state: ${parsed.reason ?? 'missing state block'}`)
    expectedBody = issue.body
    onObservedPreState?.(parsed.state?.state ?? null)
    return parsed.state
  }
  const prArgs = ['pr', 'view', parsedVerdict.prNumber, '--json', 'number,id,headRefOid,baseRefName,statusCheckRollup', ...(options.repo ? ['--repo', options.repo] : [])]
  const pr = JSON.parse(run('gh', prArgs))
  if (pr.headRefOid.toLowerCase() !== options.expectedHead.toLowerCase() || pr.headRefOid.toLowerCase() !== parsedVerdict.headSha.toLowerCase()) {
    throw new Error('STATE_CONFLICT: live PR head differs from reviewed head')
  }
  const liveBase = normalizeAuthorityBase(pr.baseRefName)
  const verdictBase = normalizeAuthorityBase(parsedVerdict.base)
  if (!liveBase || !verdictBase || liveBase !== verdictBase) throw new Error('STATE_CONFLICT: REVIEW_VERDICT base differs from live PR base')
  if (!analyzeExactHeadCi(pr).exactHeadVerified) throw new Error('STATE_CONFLICT: exact-head CI is not verified')

  const verifyLivePullRequest = () => {
    const livePr = JSON.parse(run('gh', prArgs))
    if (livePr.headRefOid.toLowerCase() !== options.expectedHead.toLowerCase() || livePr.headRefOid.toLowerCase() !== parsedVerdict.headSha.toLowerCase()) {
      throw new Error('HEAD_DRIFT: live PR head changed during final validation')
    }
    if (normalizeAuthorityBase(livePr.baseRefName) !== liveBase) throw new Error('STATE_CONFLICT: live PR base changed during final validation')
    if (!analyzeExactHeadCi(livePr).exactHeadVerified) throw new Error('STATE_CONFLICT: exact-head CI is not verified during final validation')
    return livePr
  }
  const listComments = () => {
    verifyLivePullRequest()
    return normalizeIssueComments(parsePaginatedGhApiJson(fetchIssueComments({ repository: repo, issueNumber: options.issue, runGh: run })))
  }
  const listPrComments = () => isReviewRecoveryIncident({ taskIssue: options.issue, activePr: parsedVerdict.prNumber })
    ? normalizeIssueComments(parsePaginatedGhApiJson(fetchIssueComments({ repository: repo, issueNumber: parsedVerdict.prNumber, runGh: run })))
    : []
  const commentTrust = resolveProductionCommentTrust()
  const postComment = (commentBody) => {
    const temp = mkdtempSync(join(tmpdir(), 'bemoat-review-comment-'))
    const payload = join(temp, 'payload.json')
    try {
      writeFileSync(payload, JSON.stringify({ body: commentBody }))
      onMutation?.()
      let posted = null
      try {
        posted = JSON.parse(postIssueComment({ repository: repo, issueNumber: options.issue, payloadPath: payload, runGh: run }))
        if (posted?.id == null) throw new Error('review verdict comment did not return a durable comment identifier')
        const durable = verifyPostedCommentReadback({ comments: listComments(), body: commentBody, role: 'REVIEW_VERDICT', postedId: posted.id, matchOptions: commentTrust })
        return { ...posted, ...durable, id: durable.id, body: durable.body }
      } catch (error) {
        throw runtimeError('AMBIGUOUS_RESULT', `review verdict comment result is ambiguous: ${error instanceof Error ? error.message : String(error)}`, { mutationPerformed: true, postedCommentId: posted?.id ?? null, legacyClassification: 'STATE_CONFLICT' })
      }
    } finally { rmSync(temp, { recursive: true, force: true }) }
  }
  const writeState = async (next, expected) => {
    const live = JSON.parse(run('gh', issueArgsForCommand))
    const parsed = parseMissionControlState(live.body)
    if (!parsed.present || !parsed.valid || JSON.stringify(parsed.state) !== JSON.stringify(expected) || live.body !== expectedBody) throw new Error('STATE_CONFLICT: concurrent Issue body change detected before state write')
    const nextBody = projectMissionControlStateBlock(live.body, next)
    onMutation?.()
    await writeIssueBodyWithLease({ repo, issueNumber: options.issue, expectedBody: live.body, nextBody, transitionIdentity: next.latest_transition_identity, holder: 'mission-control-review', repoFlag: options.repo, deps: { runGh: (args, ghOptions) => run('gh', args, ghOptions) } })
    const verified = JSON.parse(run('gh', issueArgsForCommand))
    const verifiedState = parseMissionControlState(verified.body)
    if (!verifiedState.valid || verifiedState.state.latest_review_verdict_comment_id !== next.latest_review_verdict_comment_id) throw new Error('postcondition: verdict projection could not be verified')
    expectedBody = verified.body
    return verifiedState.state
  }

  const original = readIssue()
  const rawEvidence = detectUnaccountedReviewEvidence({ repository: repo, taskIssue: options.issue, activePr: parsedVerdict.prNumber, managedState: original, issueComments: listComments(), prComments: listPrComments() })
  if (!rawEvidence.ok) throw new Error(`${rawEvidence.code}: ${rawEvidence.reason}. Use ${rawEvidence.recoveryCommand}.`)
  const bootstrapPreflight = preflightCanonicalBootstrapTask({ issue: liveIssue, pullRequest: pr, repository: repo })
  if (!bootstrapPreflight.ok) throw new Error(`${bootstrapPreflight.classification ?? 'STATE_CONFLICT'}: ${bootstrapPreflight.reason}`)
  if (original.state !== options.expectedState) throw new Error(`UNSUPPORTED_PRE_STATE: expected ${options.expectedState}, received ${original.state}`)
  if (normalizeAuthorityBase(original.approved_base) !== liveBase) throw new Error('STATE_CONFLICT: live PR base differs from approved base')
  if (String(original.current_head ?? '').toLowerCase() !== options.expectedHead.toLowerCase()) throw new Error('STATE_CONFLICT: managed current head differs from reviewed head')

  const coordinator = new Coordinator({ readState: async () => readIssue(), writeState, listComments: async () => listComments(), postComment: async (comment) => postComment(comment), ...commentTrust, verifiedHead: pr.headRefOid, verifiedBase: liveBase })
  const result = await coordinator.integrateReviewVerdict({
    verdictBody: body,
    verifyPreconditions: async () => undefined,
    policy: { reviewType: options.reviewType },
    projectState: (prior, comment, identity) => projectReviewVerdictState({ prior, verdict: parsedVerdict.verdict, reviewType: options.reviewType, reviewedHead: options.expectedHead, commentId: comment.id, transitionIdentity: JSON.stringify(identity), findings: parseFindings(body, parsedVerdict.verdict) }),
  })
  if (result.outcome === 'RECOVERABLE_ROUTING_DRIFT') throw runtimeError('AMBIGUOUS_RESULT', `verdict comment ${result.comment.id} posted but projection failed; rerun this command`, { mutationPerformed: true, legacyClassification: result.outcome })
  if (!result.comment?.id || !result.state?.state) throw runtimeError('AMBIGUOUS_RESULT', 'review verdict result did not retain a durable comment and state', { mutationPerformed: true, legacyClassification: result.outcome })
  try {
    verifyPostedCommentReadback({ comments: listComments(), body, role: 'REVIEW_VERDICT', postedId: result.comment.id, matchOptions: commentTrust })
  } catch (error) {
    throw runtimeError('AMBIGUOUS_RESULT', `REVIEW_VERDICT comment could not be confirmed on final live readback: ${error instanceof Error ? error.message : String(error)}`, { mutationPerformed: true, postedCommentId: result.comment.id, legacyClassification: result.outcome })
  }
  return { result, repository: repo, observedPreState: original.state, prNumber: parsedVerdict.prNumber }
}
