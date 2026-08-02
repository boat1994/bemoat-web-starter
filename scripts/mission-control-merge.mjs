#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

import { analyzeExactHeadCi, normalizeStatusChecks, isCheckSuccessful } from './agent-issue/exact-head-ci.mjs'
import { resolveIssueNumber, resolvePrNumber } from './agent-issue/issue-references.mjs'
import { parseMissionControlState, renderMissionControlState } from './mission-control-state.mjs'
import { writeIssueBodyWithLease } from './mission-control-issue-body-cas.mjs'
import { parseCampaign } from './mission-control/domain/campaign-parser.mjs'
import { replaceCampaignBlock } from './mission-control/domain/campaign-renderer.mjs'

const STARTER_REPOSITORY = 'boat1994/bemoat-web-starter'
const FULL_SHA_RE = /^[0-9a-f]{40}$/i
const COMMENT_SHA_RE = /^[0-9a-f]{64}$/i

export const SAFE_EXECUTION_BUNDLES = Object.freeze({
  'authorization-execution': Object.freeze([
    'record-founder-authorization',
    'execute-authorized-action',
    'project-task-state',
  ]),
  'task-initialization': Object.freeze([
    'create-task-issue',
    'initialize-planning-state',
    'project-campaign',
  ]),
  delivery: Object.freeze([
    'deliver-implementation',
    'verify-exact-head-ci',
    'post-result',
    'project-awaiting-review',
  ]),
  'merge-completion': Object.freeze([
    'verify-founder-merge-authority',
    'verify-exact-reviewed-head-and-ci',
    'merge-exact-reviewed-head',
    'verify-protected-base-merge-commit',
    'post-final-result',
    'close-task-issue',
    'write-task-done',
    'project-campaign-slice-done',
    'select-next-campaign-action',
  ]),
})

export const SAFE_EXECUTION_BUNDLE_SCOPES = Object.freeze({
  'authorization-execution': 'authorization-execution',
  'task-initialization': 'task-initialization',
  delivery: 'delivery',
  'merge-completion': 'merge',
})

function sameArray(left, right) {
  return Array.isArray(left) && Array.isArray(right) &&
    left.length === right.length && left.every((value, index) => value === right[index])
}

export function validateSafeExecutionBundle(bundle = {}) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    return { valid: false, reason: 'safe execution bundle must be a mapping' }
  }
  const expectedSteps = SAFE_EXECUTION_BUNDLES[bundle.kind]
  if (!expectedSteps) return { valid: false, reason: 'safe execution bundle kind is not allowed' }
  const expectedScope = SAFE_EXECUTION_BUNDLE_SCOPES[bundle.kind]
  if (bundle.authority_scope !== expectedScope) {
    return { valid: false, reason: `safe execution bundle authority scope must be exactly ${expectedScope}` }
  }
  if (typeof bundle.terminal_outcome !== 'string' || bundle.terminal_outcome.length === 0) {
    return { valid: false, reason: 'safe execution bundle requires one terminal durable outcome' }
  }
  if (!sameArray(bundle.steps, expectedSteps)) {
    return {
      valid: false,
      reason: 'safe execution bundle steps are prohibited or cross an independent gate; use one canonical bundle shape',
    }
  }
  return { valid: true, kind: bundle.kind, authority_scope: bundle.authority_scope }
}

function defaultMergeCompletionBundle() {
  return {
    kind: 'merge-completion',
    authority_scope: 'merge',
    terminal_outcome: 'Task DONE and campaign slice DONE; next action selected but not started',
    steps: SAFE_EXECUTION_BUNDLES['merge-completion'],
  }
}

function stateConflict(message) {
  return new Error(`STATE_CONFLICT: ${message}`)
}

function blockedExternal(message) {
  return new Error(`BLOCKED_EXTERNAL: ${message}`)
}

function normalizeIssueNumber(value) {
  return resolveIssueNumber(value)
}

function normalizePrNumber(value) {
  return resolvePrNumber(value)
}

function parseJsonBlock(body = '') {
  const fenced = String(body).match(/```json\s*([\s\S]*?)```/i)?.[1]
  try {
    return JSON.parse(fenced ?? String(body).trim())
  } catch {
    throw stateConflict('Founder merge authorization comment does not contain valid JSON evidence')
  }
}

export function normalizePaginatedCommitMessages(pages) {
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
    throw blockedExternal('GitHub PR commit pagination did not return complete page arrays')
  }
  return pages.flat().map((entry) => {
    const message = String(entry?.commit?.message ?? '')
    const [messageHeadline = '', ...bodyLines] = message.split('\n')
    return { messageHeadline, messageBody: bodyLines.join('\n') }
  })
}

export function validateFounderAuthorizationRecord({
  authorization,
  authorizationCommentId,
  trustedFounderLogins,
  expected,
}) {
  if (!Array.isArray(trustedFounderLogins) || trustedFounderLogins.length === 0) {
    throw stateConflict('repository-owned Founder identity configuration is missing or empty')
  }
  if (!authorization || typeof authorization !== 'object' || Array.isArray(authorization)) {
    throw stateConflict('Founder authorization record is missing or ambiguous')
  }
  const required = [
    authorization.schema_version === 1,
    authorization.status === 'approved',
    authorization.authority === 'Founder',
    typeof authorization.author_login === 'string' && authorization.author_login.length > 0,
    String(authorization.comment_id) === String(authorizationCommentId),
    authorization.immutable_comment_reference === true,
    typeof authorization.comment_sha256 === 'string' && COMMENT_SHA_RE.test(authorization.comment_sha256),
    authorization.non_superseded === true,
    authorization.superseded_by == null,
    authorization.repository === expected.repository,
    normalizeIssueNumber(authorization.task_issue) === expected.taskIssue,
    normalizePrNumber(authorization.pr) === expected.pr,
    FULL_SHA_RE.test(String(expected.exactHead)) && FULL_SHA_RE.test(String(authorization.exact_head)),
    authorization.exact_head === expected.exactHead,
    authorization.reviewed_head === expected.exactHead,
    authorization.base === expected.base,
    authorization.scope === expected.scope,
    authorization.action === expected.action,
    expected.policyVersion == null || authorization.policy_version === expected.policyVersion,
    expected.reviewCommentId == null || String(authorization.review_verdict_comment_id) === String(expected.reviewCommentId),
  ]
  if (required.some((condition) => !condition)) {
    throw stateConflict('Founder authorization record does not bind trusted identity, immutable comment, non-supersession, repository, task, PR, exact head/base, scope, policy, and action')
  }
  if (!trustedFounderLogins.includes(authorization.author_login)) {
    throw stateConflict('authorization comment author does not match repository-owned Founder identity configuration')
  }
  return authorization
}

export function validateFounderMergeAuthorization({
  authorization,
  authorizationCommentId,
  issueNumber,
  prNumber,
  reviewedHead,
  base,
  repository,
  policyVersion,
  reviewCommentId,
  trustedFounderLogins,
}) {
  return validateFounderAuthorizationRecord({
    authorization,
    authorizationCommentId,
    trustedFounderLogins,
    expected: {
      repository,
      taskIssue: issueNumber,
      pr: prNumber,
      exactHead: reviewedHead,
      base,
      policyVersion,
      reviewCommentId,
      scope: 'merge',
      action: 'merge',
    },
  })
}

export function validateMergeReviewVerdict({ reviewVerdict, expected }) {
  const valid =
    reviewVerdict && typeof reviewVerdict === 'object' && !Array.isArray(reviewVerdict) &&
    reviewVerdict.verdict === 'ELIGIBLE FOR FOUNDER REVIEW' &&
    String(reviewVerdict.comment_id) === String(expected.commentId) &&
    reviewVerdict.reviewed_head === expected.exactHead &&
    normalizePrNumber(reviewVerdict.pr) === expected.pr &&
    reviewVerdict.base === expected.base &&
    reviewVerdict.non_superseded === true
  if (!valid) throw stateConflict('latest review verdict is changed, superseded, or does not bind the exact PR, base, and reviewed head')
  return true
}

function verifyRequiredExactHeadCi(pr, repo) {
  const analysis = analyzeExactHeadCi(pr)
  if (!analysis.exactHeadVerified) {
    throw stateConflict(`required exact-head CI is not successful: ${analysis.summary}`)
  }
  const checks = normalizeStatusChecks(pr.statusCheckRollup)
  const successfulNames = new Set(checks.filter(isCheckSuccessful).map((check) => check.name ?? check.context))
  const requiredChecks = repo === STARTER_REPOSITORY ? ['ci', 'starter-ci'] : ['ci']
  const missing = requiredChecks.filter((name) => !successfulNames.has(name))
  if (missing.length > 0) throw stateConflict(`required exact-head CI checks are missing or unsuccessful: ${missing.join(', ')}`)
}

function verifyDirectOwnership(issueNumber, issue, pr) {
  const state = issue?.managedState
  if (!state) throw stateConflict('managed Issue state is unavailable')
  if (normalizeIssueNumber(state.active_task_issue) !== issueNumber) {
    throw stateConflict('merge transport may operate only on the directly managed task Issue')
  }
  const prNumber = normalizePrNumber(state.active_pr)
  if (!prNumber) throw stateConflict('directly managed task has no active PR terminal ownership')
  if (pr?.number != null && normalizePrNumber(pr.number) !== prNumber) {
    throw stateConflict('live PR does not match the managed task active PR')
  }
  return prNumber
}

function verifyHeadBindings(state, pr, authorization, repo) {
  const reviewedHead = state?.last_reviewed_head
  if (!state?.approved_base || pr.baseRefName !== state.approved_base) {
    throw stateConflict('live PR base differs from the managed protected base')
  }
  if (!reviewedHead || state.current_head !== reviewedHead || pr.headRefOid !== reviewedHead) {
    throw stateConflict('current, reviewed, and live PR heads must match exactly')
  }
  if (authorization.reviewed_head !== reviewedHead) {
    throw stateConflict('Founder authorization reviewed head differs from managed/live head')
  }
  verifyRequiredExactHeadCi(pr, repo)
  return reviewedHead
}

function verifyMergeability(pr) {
  if (String(pr?.mergeable ?? '').toUpperCase() !== 'MERGEABLE') {
    throw stateConflict('PR mergeability changed or is not verified as MERGEABLE')
  }
  return true
}

function verifyNoAutomaticClosure(pr, issueNumber, repo) {
  const linkedClosure = (pr.closingIssuesReferences ?? []).some((reference) =>
    normalizeIssueNumber(reference.number) === issueNumber &&
    (reference.repository?.nameWithOwner ?? repo) === repo
  )
  const escapedRepo = repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const closingPattern = new RegExp(
    `\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s+(?:#${issueNumber}\\b|${escapedRepo}#${issueNumber}\\b|https://github\\.com/${escapedRepo}/issues/${issueNumber}\\b)`,
    'i',
  )
  const closingSources = [
    pr.title,
    pr.body,
    ...(pr.commits ?? []).flatMap((commit) => [commit.messageHeadline, commit.messageBody]),
  ]
  const closingKeyword = closingSources.some((source) => closingPattern.test(String(source ?? '')))
  if (linkedClosure || closingKeyword) {
    throw stateConflict('PR contains an automatic closing reference to the managed Issue; use Refs so merge transport remains the closure owner')
  }
}

function mergeCommitOid(pr, mergeResult) {
  return pr?.mergeCommit?.oid ?? pr?.mergeCommit?.sha ?? mergeResult?.mergeCommit?.oid ?? mergeResult?.mergeCommit?.sha ?? null
}

function normalizeIssueState(issue) {
  return String(issue?.state ?? '').toUpperCase()
}

function normalizeIssueReason(issue) {
  return String(issue?.stateReason ?? issue?.state_reason ?? '').toUpperCase()
}

function resultCommentId(result) {
  return result?.id ?? result?.commentId ?? null
}

function finalResultBody({ issueNumber, prNumber, reviewedHead, mergeCommit, base, policyVersion, nextAction }) {
  return [
    '## RESULT',
    '',
    `**Task / Issue:** #${issueNumber}`,
    '**Phase:** Merge completion',
    `**PR / base / head:** PR #${prNumber} · \`${base}\` · \`${reviewedHead}\``,
    `**Policy:** \`${policyVersion}\``,
    `**Merged commit:** \`${mergeCommit}\``,
    '**Verdict:** DONE',
    `**Next:** ${nextAction ?? 'select the next campaign action; do not start it in this bundle.'}`,
  ].join('\n')
}

async function reconcileAfterFailure({ deps, issueNumber, repo, error }) {
  if (typeof deps.reconcile !== 'function') return null
  try {
    return await deps.reconcile(issueNumber, repo, {
      reason: error instanceof Error ? error.message : String(error),
      trigger: 'merge-completion-projection-failure',
    })
  } catch (reconciliationError) {
    if (error && typeof error === 'object') error.reconciliationError = reconciliationError
    return null
  }
}

export async function runFounderAuthorizedMerge({
  issueNumber,
  repo,
  authorizationCommentId,
  executionBundle,
  deps,
}) {
  if (!Number.isInteger(issueNumber) || issueNumber <= 0 || !repo || !/^[1-9]\d*$/.test(String(authorizationCommentId))) {
    throw stateConflict('task Issue, repository, and Founder authorization comment ID are required')
  }
  const bundleCheck = validateSafeExecutionBundle(executionBundle ?? defaultMergeCompletionBundle())
  if (!bundleCheck.valid) throw stateConflict(bundleCheck.reason)
  if (!deps || typeof deps.readManagedIssue !== 'function' || typeof deps.readPullRequest !== 'function') {
    throw blockedExternal('merge completion transport dependencies are incomplete')
  }

  let issue = await deps.readManagedIssue(issueNumber, repo)
  const state = issue?.managedState
  const prNumber = normalizePrNumber(state?.active_pr)
  if (!prNumber) throw stateConflict('directly managed task has no active PR terminal ownership')
  let pr = await deps.readPullRequest(prNumber, repo)
  verifyDirectOwnership(issueNumber, issue, pr)

  const authorization = await deps.readFounderAuthorization(repo, issueNumber, authorizationCommentId)
  const trustedFounderLogins = await deps.readTrustedFounderLogins(repo)
  const reviewedHead = state.last_reviewed_head
  const reviewCommentId = authorization?.review_verdict_comment_id ?? state.latest_review_verdict_comment_id
  validateFounderMergeAuthorization({
    authorization,
    authorizationCommentId,
    issueNumber,
    prNumber,
    reviewedHead,
    base: state.approved_base,
    repository: repo,
    policyVersion: state.guide_version,
    reviewCommentId,
    trustedFounderLogins,
  })
  if (typeof deps.readReviewVerdict !== 'function') {
    throw blockedExternal('exact reviewed verdict evidence is unavailable')
  }
  const reviewVerdict = await deps.readReviewVerdict(repo, issueNumber, reviewCommentId)
  validateMergeReviewVerdict({
    reviewVerdict,
    expected: {
      commentId: reviewCommentId,
      exactHead: reviewedHead,
      pr: prNumber,
      base: state.approved_base,
    },
  })
  verifyHeadBindings(state, pr, authorization, repo)
  verifyNoAutomaticClosure(pr, issueNumber, repo)

  const alreadyDone = state.state === 'DONE'
  if (!alreadyDone && state.state !== 'ELIGIBLE_FOR_FOUNDER_REVIEW') {
    throw stateConflict(`managed task state ${state.state ?? 'unknown'} is not eligible for Founder-authorized merge`)
  }

  if (alreadyDone) {
    if (normalizeIssueState(issue) !== 'CLOSED' || normalizeIssueReason(issue) !== 'COMPLETED' || String(pr.state).toUpperCase() !== 'MERGED') {
      throw stateConflict('DONE task does not have the verified closed Issue and merged PR terminal projection')
    }
    const commit = mergeCommitOid(pr, null)
    if (!commit) throw stateConflict('DONE task does not expose a merge commit')
    const onBase = await deps.verifyCommitOnProtectedBase({ repo, base: state.approved_base, commit })
    if (!onBase) throw stateConflict('verified merge commit has not reached the protected base')
    return { outcome: 'NO_OP', issueNumber, prNumber, reviewedHead, mergeCommit: commit }
  }

  const requiredProjectionDeps = [
    'markReadyForReview',
    'mergePullRequest',
    'verifyCommitOnProtectedBase',
    'postFinalResult',
    'closeIssueCompleted',
    'writeTaskDone',
    'projectCampaignSliceDone',
    'selectNextCampaignAction',
  ]
  const missingProjectionDeps = requiredProjectionDeps.filter((name) => typeof deps[name] !== 'function')
  if (missingProjectionDeps.length > 0) {
    throw blockedExternal(`merge completion projection dependencies are unavailable: ${missingProjectionDeps.join(', ')}`)
  }

  let mutationStarted = false
  let mergeResult = null
  try {
    if (String(pr.state).toUpperCase() !== 'MERGED') {
      if (normalizeIssueState(issue) !== 'OPEN') throw stateConflict('an unmerged PR cannot belong to an already-closed managed Issue')
      if (String(pr.state).toUpperCase() !== 'OPEN') throw stateConflict('PR must be open before merge')
      verifyMergeability(pr)
      if (pr.isDraft) {
        mutationStarted = true
        await deps.markReadyForReview(prNumber, repo)
        pr = await deps.readPullRequest(prNumber, repo)
        verifyHeadBindings(state, pr, authorization, repo)
        const currentReviewVerdict = await deps.readReviewVerdict(repo, issueNumber, reviewCommentId)
        validateMergeReviewVerdict({
          reviewVerdict: currentReviewVerdict,
          expected: { commentId: reviewCommentId, exactHead: reviewedHead, pr: prNumber, base: state.approved_base },
        })
        verifyNoAutomaticClosure(pr, issueNumber, repo)
        verifyMergeability(pr)
        if (pr.isDraft) throw stateConflict('Draft PR did not become ready for review')
      }
      mutationStarted = true
      mergeResult = await deps.mergePullRequest({ prNumber, repo, expectedHead: reviewedHead })
      pr = await deps.readPullRequest(prNumber, repo)
      if (pr.headRefOid !== reviewedHead || String(pr.state).toUpperCase() !== 'MERGED') {
        throw stateConflict('merge result does not preserve the authorized expected head')
      }
    } else {
      mutationStarted = true
    }

    const commit = mergeCommitOid(pr, mergeResult)
    if (!commit) throw stateConflict('merged PR does not expose a merge commit')
    const onBase = await deps.verifyCommitOnProtectedBase({ repo, base: state.approved_base, commit })
    if (!onBase) throw stateConflict('verified merge commit has not reached the protected base')

    const finalResult = await deps.postFinalResult({
      repo,
      issueNumber,
      prNumber,
      reviewedHead,
      base: state.approved_base,
      policyVersion: state.guide_version,
      mergeCommit: commit,
      body: finalResultBody({
        issueNumber,
        prNumber,
        reviewedHead,
        mergeCommit: commit,
        base: state.approved_base,
        policyVersion: state.guide_version,
      }),
    })
    const finalResultId = resultCommentId(finalResult)
    if (!finalResultId || !/^[1-9]\d*$/.test(String(finalResultId))) {
      throw blockedExternal('final RESULT did not return an immutable comment identifier')
    }

    issue = await deps.readManagedIssue(issueNumber, repo)
    if (normalizeIssueState(issue) === 'OPEN') {
      await deps.closeIssueCompleted(issueNumber, repo)
      issue = await deps.readManagedIssue(issueNumber, repo)
    }
    if (normalizeIssueState(issue) !== 'CLOSED' || normalizeIssueReason(issue) !== 'COMPLETED') {
      throw stateConflict('managed task Issue was not closed as completed')
    }

    const taskProjection = await deps.writeTaskDone({
      repo,
      issueNumber,
      prNumber,
      reviewedHead,
      mergeCommit: commit,
      resultCommentId: String(finalResultId),
      expectedState: state,
    })
    if (taskProjection?.state !== 'DONE') throw stateConflict('direct deterministic Task DONE projection was not confirmed')

    const campaignIssue = normalizeIssueNumber(authorization.campaign_issue ?? state.campaign_issue)
    const campaignSlice = Number(authorization.campaign_slice ?? state.campaign_slice)
    if (!campaignIssue || !Number.isInteger(campaignSlice) || campaignSlice <= 0) {
      throw stateConflict('merge completion requires an exact campaign Issue and slice binding')
    }
    const campaignProjection = await deps.projectCampaignSliceDone({
      repo,
      campaignIssue,
      campaignSlice,
      taskIssue: issueNumber,
      prNumber,
      reviewedHead,
      mergeCommit: commit,
      authorizationCommentId: String(authorizationCommentId),
    })
    if (campaignProjection?.status !== 'DONE') throw stateConflict('campaign slice DONE projection was not confirmed')

    const nextAction = await deps.selectNextCampaignAction({
      repo,
      campaignIssue,
      completedSlice: campaignSlice,
      taskIssue: issueNumber,
    })
    if (!nextAction || nextAction.started !== false || typeof nextAction.action !== 'string' || nextAction.action.length === 0) {
      throw stateConflict('merge completion must select the next campaign action without starting it')
    }

    return {
      outcome: 'DONE',
      issueNumber,
      prNumber,
      reviewedHead,
      mergeCommit: commit,
      finalResultCommentId: String(finalResultId),
      nextAction: nextAction.action,
    }
  } catch (error) {
    if (mutationStarted) await reconcileAfterFailure({ deps, issueNumber, repo, error })
    throw error
  }
}

function runGh(args, options = {}) {
  const result = spawnSync('gh', args, { encoding: 'utf8', input: options.input, env: options.env ?? process.env })
  if (result.error || result.status !== 0) {
    throw blockedExternal(result.stderr || result.stdout || result.error?.message || 'GitHub CLI failed')
  }
  return result.stdout.trim()
}

function runNode(args, env = process.env) {
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', env })
  if (result.error || result.status !== 0) {
    throw new Error(result.stderr || result.stdout || result.error?.message || 'Mission Control reconciler failed')
  }
  return result.stdout.trim()
}

function parseArgs(argv) {
  const options = { issueNumber: null, repo: null, authorizationCommentId: null }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--') continue
    if (argument === '--repo' || argument === '--authorization-comment') {
      const value = argv[++index]
      if (!value) throw new Error(`${argument} requires a value`)
      if (argument === '--repo') options.repo = value
      else options.authorizationCommentId = value
      continue
    }
    if (argument.startsWith('-') || options.issueNumber) throw new Error(`unexpected argument: ${argument}`)
    options.issueNumber = Number(argument)
  }
  if (!Number.isInteger(options.issueNumber) || options.issueNumber <= 0 || !options.repo || !options.authorizationCommentId) {
    throw new Error('Usage: pnpm run bemoat:mission-control:merge -- <issue-number> --repo owner/repo --authorization-comment <id>')
  }
  return options
}

function stateBlockReplacement(body, state) {
  const pattern = /<!--\s*bemoat-mission-control-state:start\s*-->[\s\S]*?<!--\s*bemoat-mission-control-state:end\s*-->/
  if (!pattern.test(body)) throw stateConflict('managed state block is missing')
  return body.replace(pattern, renderMissionControlState(state))
}

function sameTerminalBinding(left, right) {
  return ['state', 'active_task_issue', 'active_pr', 'current_head', 'last_reviewed_head']
    .every((key) => left?.[key] === right?.[key])
}

function flattenGhPages(value) {
  return Array.isArray(value) ? value.flat(Infinity).filter((entry) => entry && typeof entry === 'object') : []
}

function createProductionDeps() {
  const readManagedIssue = async (issueNumber, repo) => {
    const issue = JSON.parse(runGh(['issue', 'view', String(issueNumber), '--repo', repo, '--json', 'body,state,stateReason']))
    const parsed = parseMissionControlState(issue.body)
    if (!parsed.present || !parsed.valid) throw stateConflict(`Issue has invalid managed state: ${parsed.reason ?? 'missing state block'}`)
    return { ...issue, managedState: parsed.state }
  }
  const readPullRequest = async (prNumber, repo) => {
    const pr = JSON.parse(runGh([
      'pr', 'view', String(prNumber), '--repo', repo,
      '--json', 'number,state,isDraft,mergeable,headRefOid,baseRefName,statusCheckRollup,mergeCommit,url,title,body,closingIssuesReferences',
    ]))
    const commitPages = JSON.parse(runGh([
      'api', '--paginate', '--slurp', `repos/${repo}/pulls/${prNumber}/commits?per_page=100`,
    ]))
    return { ...pr, commits: normalizePaginatedCommitMessages(commitPages) }
  }

  const readIssueComment = (repo, issueNumber, commentId) => {
    const comment = JSON.parse(runGh(['api', `repos/${repo}/issues/comments/${commentId}`]))
    const expectedIssueUrl = `https://api.github.com/repos/${repo}/issues/${issueNumber}`
    if (comment.issue_url !== expectedIssueUrl || !comment.user?.login) {
      throw stateConflict(`Issue comment ${commentId} is not bound to Issue #${issueNumber} and an authenticated author`)
    }
    return comment
  }

  const readIssueComments = (repo, issueNumber) => {
    const pages = JSON.parse(runGh([
      'api', '--paginate', '--slurp', `repos/${repo}/issues/${issueNumber}/comments?per_page=100`,
    ]))
    return flattenGhPages(pages)
  }

  return {
    readManagedIssue,
    readPullRequest,
    readFounderAuthorization: async (repo, issueNumber, commentId) => {
      const comment = readIssueComment(repo, issueNumber, commentId)
      const parsed = parseJsonBlock(comment.body)
      const superseded = readIssueComments(repo, issueNumber).some((entry) => {
        const body = String(entry.body ?? '')
        return body.includes(`supersedes: ${comment.id}`) ||
          body.includes(`superseded_comment_id: ${comment.id}`) ||
          (body.includes(String(comment.id)) && /superseded|not authoritative/i.test(body))
      })
      return {
        ...parsed,
        comment_id: String(comment.id),
        author_login: comment.user.login,
        immutable_comment_reference: true,
        comment_sha256: createHash('sha256').update(String(comment.body ?? ''), 'utf8').digest('hex'),
        non_superseded: parsed.non_superseded === true && !superseded,
        superseded_by: superseded ? 'live-issue-comment-evidence' : (parsed.superseded_by ?? null),
      }
    },
    readReviewVerdict: async (repo, issueNumber, commentId) => {
      const comment = readIssueComment(repo, issueNumber, commentId)
      const body = String(comment.body ?? '')
      const verdict = body.match(/^\*\*Verdict:\*\*\s*(.+?)\s*$/m)?.[1]?.trim() ?? null
      const pr = body.match(/\/pull\/(\d+)/)?.[1] ?? null
      const base = body.match(/^\*\*Approved base:\*\*\s*`?([^@\s`]+?)(?:@[^`\s]+)?`?\s*$/m)?.[1] ??
        body.match(/^\*\*PR \/ base \/ head:\*\*.*?·\s*`([^`]+)`\s*·/m)?.[1] ?? null
      const reviewedHead = body.match(/^\*\*Exact head reviewed:\*\*\s*`?([0-9a-f]{40})`?\s*$/im)?.[1] ??
        body.match(/^\*\*PR \/ base \/ head:\*\*.*?·\s*`[0-9a-f]{40}`\s*$/m)?.[0]?.match(/[0-9a-f]{40}/i)?.[0] ?? null
      return {
        comment_id: String(comment.id),
        verdict,
        pr,
        base,
        reviewed_head: reviewedHead,
        non_superseded: !/superseded|not authoritative/i.test(body),
      }
    },
    readTrustedFounderLogins: async (repo) => {
      const variable = JSON.parse(runGh(['api', `repos/${repo}/actions/variables/BEMOAT_FOUNDER_LOGINS`]))
      const value = String(variable.value ?? '').trim()
      const logins = value.split(',').map((login) => login.trim()).filter(Boolean)
      if (logins.length === 0 || logins.some((login) => !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(login))) {
        throw stateConflict('repository Actions variable BEMOAT_FOUNDER_LOGINS must contain a comma-separated list of GitHub logins')
      }
      return logins
    },
    markReadyForReview: async (prNumber, repo) => { runGh(['pr', 'ready', String(prNumber), '--repo', repo]) },
    mergePullRequest: async ({ prNumber, repo, expectedHead }) => {
      runGh(['pr', 'merge', String(prNumber), '--repo', repo, '--merge', '--match-head-commit', expectedHead])
      return {}
    },
    verifyCommitOnProtectedBase: async ({ repo, base, commit }) => {
      const comparison = JSON.parse(runGh(['api', `repos/${repo}/compare/${commit}...${base}`]))
      return comparison.status === 'ahead' || comparison.status === 'identical'
    },
    postFinalResult: async ({ repo, issueNumber, body }) => {
      return JSON.parse(runGh([
        'api', '-X', 'POST', `repos/${repo}/issues/${issueNumber}/comments`, '--input', '-',
      ], { input: JSON.stringify({ body }) }))
    },
    closeIssueCompleted: async (issueNumber, repo) => {
      runGh(['issue', 'close', String(issueNumber), '--repo', repo, '--reason', 'completed'])
    },
    writeTaskDone: async ({ repo, issueNumber, expectedState, mergeCommit, resultCommentId, prNumber, reviewedHead }) => {
      const live = await readManagedIssue(issueNumber, repo)
      if (live.managedState.state === 'DONE' && live.managedState.merged_commit_sha === mergeCommit) return { state: 'DONE' }
      if (!sameTerminalBinding(live.managedState, expectedState)) {
        throw stateConflict('Task DONE CAS/lease precondition changed before direct projection')
      }
      const nextState = {
        ...structuredClone(live.managedState),
        state: 'DONE',
        merged_commit_sha: mergeCommit,
        latest_result_comment_id: String(resultCommentId),
        open_blockers: [],
        next_permitted_action: 'none on this task',
        updated_at: new Date().toISOString(),
        updated_by: 'Founder-authorized merge transport',
      }
      await writeIssueBodyWithLease({
        repo,
        issueNumber,
        expectedBody: live.body,
        nextBody: stateBlockReplacement(live.body, nextState),
        transitionIdentity: `merge-completion:${issueNumber}:${prNumber}:${reviewedHead}:${mergeCommit}`,
        holder: 'mission-control-merge',
        repoFlag: repo,
        deps: { runGh },
      })
      const verified = await readManagedIssue(issueNumber, repo)
      if (verified.managedState.state !== 'DONE' || verified.managedState.merged_commit_sha !== mergeCommit) {
        throw stateConflict('Task DONE direct projection did not survive postcondition verification')
      }
      return { state: 'DONE' }
    },
    projectCampaignSliceDone: async ({ repo, campaignIssue, campaignSlice, taskIssue, prNumber, reviewedHead, mergeCommit, authorizationCommentId }) => {
      const issue = JSON.parse(runGh(['issue', 'view', String(campaignIssue), '--repo', repo, '--json', 'body,state']))
      const parsed = parseCampaign(issue.body)
      if (!parsed.present || !parsed.valid) throw stateConflict(`campaign Issue #${campaignIssue} has invalid projection: ${parsed.reason ?? 'missing campaign block'}`)
      const key = String(campaignSlice)
      const priorSlice = parsed.campaign?.slices?.[key]
      if (!priorSlice || (priorSlice.issue != null && normalizeIssueNumber(priorSlice.issue) !== taskIssue)) {
        throw stateConflict(`campaign slice ${key} is not bound to Task Issue #${taskIssue}`)
      }
      const nextCampaign = {
        ...structuredClone(parsed.campaign),
        slices: {
          ...structuredClone(parsed.campaign.slices),
          [key]: {
            ...structuredClone(priorSlice),
            status: 'DONE',
            issue: `#${taskIssue}`,
            pr: `#${prNumber}`,
            reviewed_head: reviewedHead,
            merged_commit: mergeCommit,
            blocker_ids: [],
            authority_comment_ids: [...new Set([...(priorSlice.authority_comment_ids ?? []), String(authorizationCommentId)])],
          },
        },
        updated_at: new Date().toISOString(),
        updated_by: 'Founder-authorized merge transport',
      }
      const replacement = replaceCampaignBlock(issue.body, nextCampaign)
      if (!replacement.unchanged) {
        await writeIssueBodyWithLease({
          repo,
          issueNumber: campaignIssue,
          expectedBody: issue.body,
          nextBody: replacement.body,
          transitionIdentity: `merge-campaign:${campaignIssue}:${key}:${taskIssue}:${mergeCommit}`,
          holder: 'mission-control-merge',
          repoFlag: repo,
          deps: { runGh },
        })
      }
      const verified = JSON.parse(runGh(['issue', 'view', String(campaignIssue), '--repo', repo, '--json', 'body']))
      const verifiedCampaign = parseCampaign(verified.body)
      if (!verifiedCampaign.valid || verifiedCampaign.campaign?.slices?.[key]?.status !== 'DONE') {
        throw stateConflict(`campaign slice ${key} DONE projection did not survive postcondition verification`)
      }
      return { status: 'DONE', campaignIssue, campaignSlice }
    },
    selectNextCampaignAction: async ({ repo, campaignIssue }) => {
      const issue = JSON.parse(runGh(['issue', 'view', String(campaignIssue), '--repo', repo, '--json', 'body']))
      const parsed = parseCampaign(issue.body)
      if (!parsed.valid) throw stateConflict('campaign evidence is unavailable while selecting the next action')
      const next = Object.entries(parsed.campaign.slices ?? {}).find(([, slice]) => slice?.status === 'NOT_STARTED')
      return {
        action: next ? `Campaign slice ${next[0]} is selected for a future bounded action.` : 'none on this campaign',
        started: false,
      }
    },
    reconcile: async (issueNumber, repo) => {
      const stdout = runNode(
        ['scripts/mission-control-reconcile.mjs', String(issueNumber), '--repo', repo],
        { ...process.env, GH_REPO: repo },
      )
      const finalOutcome = stdout.match(/Mission Control reconciliation\s+(\S+):/)?.[1] ?? null
      const issue = await readManagedIssue(issueNumber, repo)
      return { finalOutcome, state: issue.managedState }
    },
  }
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2))
    const result = await runFounderAuthorizedMerge({ ...options, deps: createProductionDeps() })
    process.stdout.write(`Mission Control merge transport ${result.outcome}: PR #${result.prNumber} at ${result.reviewedHead} -> ${result.mergeCommit}; Issue #${result.issueNumber} DONE.\n`)
  } catch (error) {
    process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

if (process.argv[1]?.endsWith('/mission-control-merge.mjs')) main()
