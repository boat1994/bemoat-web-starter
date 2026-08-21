#!/usr/bin/env node

import { createHelpEnvelopeV1, formatTextHelp } from '../../cli/command-help.mjs'
import { parseCommandInvocation } from '../../cli/command-invocation.mjs'
import { createResultEnvelopeV1, classificationExitCode } from '../../cli/command-result.mjs'
import { parseProductionMergeReviewVerdict } from '../domain/merge-review-verdict.ts'
import { validateFounderMergeAuthorization } from '../domain/merge-founder-authority.ts'
import { classifyRequiredExactHeadCi } from '../domain/merge-exact-head-ci.ts'
import { classifyMergeability } from '../domain/merge-mergeability.ts'
import { normalizePrNumber } from '../domain/merge-issue-references.ts'
import { parseMergeCliArgs } from '../domain/merge-cli-args.mjs'
import { classifyStandardNonManagedEligibility, STANDARD_POLICY_PATH } from '../domain/standard-non-managed-eligibility.ts'
import { createTaskBootstrapGithubAdapter } from '../adapters/task-bootstrap-github.mjs'
import { createProductionMergeDeps, defaultRunGh } from '../adapters/merge-github.mjs'
import { createProductionDeps } from './merge.mjs'
import { selectLiveReviewVerdictComment } from '../review-verdict-binding.mjs'

const FULL_SHA_RE = /^[0-9a-f]{40}$/
const STARTER_REPOSITORY = 'boat1994/bemoat-web-starter'

function classifiedError(classification, message) {
  return Object.assign(new Error(`${classification}: ${message}`), { classification })
}

function stateConflict(message) {
  return classifiedError('STATE_CONFLICT', message)
}

function blockedExternal(message) {
  return classifiedError('BLOCKED_EXTERNAL', message)
}

function ambiguousResult(message) {
  return classifiedError('AMBIGUOUS_RESULT', message)
}

function requireDependencies(deps) {
  const required = [
    'readIssue',
    'readPullRequest',
    'readIssueComments',
    'readFounderAuthorization',
    'readTrustedFounderLogins',
    'readProtectedRef',
    'readPolicy',
    'mergePullRequest',
    'verifyCommitOnProtectedBase',
  ]
  const missing = required.filter((name) => typeof deps?.[name] !== 'function')
  if (missing.length > 0) throw blockedExternal(`STANDARD merge transport dependencies are unavailable: ${missing.join(', ')}`)
}

function mergeCommitOid(pr, mergeResult) {
  const resultOid = mergeResult?.mergeCommit?.oid ?? mergeResult?.merge_commit_sha
  const prOid = pr?.mergeCommit?.oid ?? pr?.merge_commit_sha
  const value = resultOid ?? prOid
  return FULL_SHA_RE.test(String(value ?? '')) ? String(value).toLowerCase() : null
}

function verifyLivePr(pr, { prNumber, reviewedHead, base }) {
  if (Number(pr?.number) !== prNumber) throw stateConflict('live PR number does not match the authorized PR')
  if (String(pr?.baseRefName ?? '') !== base) throw stateConflict('live PR base does not match the authorized base')
  if (String(pr?.headRefOid ?? '').toLowerCase() !== reviewedHead) throw stateConflict('live PR head does not match the authorized exact head')
  if (String(pr?.state ?? '').toUpperCase() !== 'OPEN' && String(pr?.state ?? '').toUpperCase() !== 'MERGED') {
    throw stateConflict('STANDARD merge transport requires an open or already merged PR')
  }
  const mergeability = classifyMergeability(pr)
  if (String(pr?.state ?? '').toUpperCase() !== 'MERGED' && !mergeability.valid) throw stateConflict(mergeability.reason)
  if (pr?.isDraft === true && String(pr?.state ?? '').toUpperCase() !== 'MERGED') throw stateConflict('STANDARD merge transport cannot merge a draft PR')
}

function verifyExactHeadCi(pr, repository) {
  const requiredChecks = repository === STARTER_REPOSITORY ? ['ci', 'starter-ci'] : ['ci']
  const classification = classifyRequiredExactHeadCi(pr, requiredChecks)
  if (!classification.valid) throw stateConflict(classification.reason)
}

function verifyPolicyAndAuthorization({ authorization, policy, protectedBaseSha, repository, issueNumber, prNumber, reviewedHead, base, trustedFounderLogins, authorizationCommentId }) {
  if (authorization?.comment_id !== null) throw stateConflict('STANDARD Founder authorization must have a separately verified immutable receipt')
  if (authorization?.policy_source !== policy.path) throw stateConflict('Founder authorization does not bind the trusted Mission Control policy path')
  if (authorization?.policy_source_sha !== policy.blobSha) throw stateConflict('Founder authorization does not bind the trusted Mission Control policy blob SHA')
  if (authorization?.protected_base_sha !== protectedBaseSha) throw stateConflict('Founder authorization does not bind the trusted protected-base commit SHA')
  if (authorization?.policy_version !== policy.version) throw stateConflict('Founder authorization does not bind the trusted Mission Control policy version')
  if (!authorization?.review_verdict_comment_id) throw stateConflict('Founder authorization does not bind an immutable REVIEW_VERDICT comment ID')

  validateFounderMergeAuthorization({
    authorization,
    authorizationCommentId,
    issueNumber,
    prNumber,
    reviewedHead,
    base,
    repository,
    policyVersion: policy.version,
    reviewCommentId: authorization.review_verdict_comment_id,
    policySourceSha: policy.blobSha,
    protectedBaseSha,
    trustedFounderLogins,
  })
}

async function verifyReviewEvidence({ deps, repository, issueNumber, pr, reviewedHead, reviewCommentId }) {
  const comments = await deps.readIssueComments(repository, issueNumber)
  const selected = selectLiveReviewVerdictComment({
    comments,
    issueNumber,
    livePr: pr,
    exactHead: reviewedHead,
    requireExactIssueBinding: true,
    requireNonSuperseded: true,
    requireImmutableCommentId: true,
    rejectNonExactTargets: true,
  })
  if (String(selected.id) !== String(reviewCommentId)) throw stateConflict('Founder authorization REVIEW_VERDICT comment ID does not match the unique live exact-target verdict')
  const reviewVerdict = parseProductionMergeReviewVerdict(selected.body, selected.id)
  if (reviewVerdict.verdict !== 'ELIGIBLE FOR FOUNDER REVIEW' || reviewVerdict.non_superseded !== true) {
    throw stateConflict('selected STANDARD REVIEW_VERDICT is not active and eligible')
  }
  return { selected, reviewVerdict }
}

async function verifyMergedResult({ deps, repository, base, pr, prNumber, reviewedHead }) {
  if (Number(pr?.number) !== prNumber || String(pr?.state ?? '').toUpperCase() !== 'MERGED' || String(pr?.headRefOid ?? '').toLowerCase() !== reviewedHead) {
    throw stateConflict('merged PR readback does not preserve the authorized exact PR/head')
  }
  const commit = mergeCommitOid(pr)
  if (!commit) throw ambiguousResult('merged PR readback did not expose an immutable merge commit')
  const onBase = await deps.verifyCommitOnProtectedBase({ repository, repo: repository, base, commit })
  if (!onBase) throw stateConflict('verified merge commit has not reached the protected base')
  return commit
}

export async function runStandardFounderAuthorizedMerge({ issueNumber, repo, authorizationCommentId, deps }) {
  if (!Number.isInteger(issueNumber) || issueNumber <= 0 || !repo || !/^[1-9]\d*$/.test(String(authorizationCommentId))) {
    throw stateConflict('Issue, repository, and Founder authorization comment ID are required')
  }
  if (repo !== STARTER_REPOSITORY) throw stateConflict('STANDARD/non-managed merge is not enabled outside the starter repository')
  requireDependencies(deps)

  const issue = await deps.readIssue(issueNumber, repo)
  if (Number(issue?.number) !== issueNumber) throw stateConflict('authorization target Issue readback is inconsistent')
  const mainRef = await deps.readProtectedRef(repo, 'main')
  const protectedBaseSha = String(mainRef?.object?.sha ?? '').toLowerCase()
  if (!FULL_SHA_RE.test(protectedBaseSha)) throw blockedExternal('live protected main ref is unavailable')
  const policy = await deps.readPolicy({ repository: repo, repo, ref: protectedBaseSha, path: STANDARD_POLICY_PATH, sourceCommit: protectedBaseSha })
  classifyStandardNonManagedEligibility({ repository: repo, issueBody: issue.body, policy, protectedBaseSha })

  const authorization = await deps.readFounderAuthorization(repo, issueNumber, authorizationCommentId)
  const prNumber = normalizePrNumber(authorization?.pr)
  const reviewedHead = String(authorization?.reviewed_head ?? authorization?.exact_head ?? '').toLowerCase()
  const base = String(authorization?.base ?? '')
  if (!prNumber || !FULL_SHA_RE.test(reviewedHead) || base !== 'main') throw stateConflict('Founder authorization does not bind a complete STANDARD Issue/PR/base/head tuple')
  const trustedFounderLogins = await deps.readTrustedFounderLogins(repo)
  verifyPolicyAndAuthorization({ authorization, policy, protectedBaseSha, repository: repo, issueNumber, prNumber, reviewedHead, base, trustedFounderLogins, authorizationCommentId })

  let pr = await deps.readPullRequest(prNumber, repo)
  verifyLivePr(pr, { prNumber, reviewedHead, base })
  verifyExactHeadCi(pr, repo)
  await verifyReviewEvidence({ deps, repository: repo, issueNumber, pr, reviewedHead, reviewCommentId: authorization.review_verdict_comment_id })

  if (String(pr.state).toUpperCase() === 'MERGED') {
    const commit = await verifyMergedResult({ deps, repository: repo, base, pr, prNumber, reviewedHead })
    return { outcome: 'NO_OP_IDENTICAL_RETRY', issueNumber, prNumber, reviewedHead, mergeCommit: commit, reviewVerdictCommentId: String(authorization.review_verdict_comment_id) }
  }

  let mergeResult
  try {
    mergeResult = await deps.mergePullRequest({ prNumber, repo, expectedHead: reviewedHead })
  } catch (error) {
    let readback
    try { readback = await deps.readPullRequest(prNumber, repo) } catch (readError) {
      throw ambiguousResult(`merge outcome and authoritative readback are unavailable: ${readError instanceof Error ? readError.message : String(readError)}`)
    }
    if (String(readback?.state ?? '').toUpperCase() === 'MERGED') {
      const commit = await verifyMergedResult({ deps, repository: repo, base, pr: readback, prNumber, reviewedHead })
      return { outcome: 'SUCCESS', issueNumber, prNumber, reviewedHead, mergeCommit: commit, reviewVerdictCommentId: String(authorization.review_verdict_comment_id), recoveredFromAmbiguousWrite: true }
    }
    throw ambiguousResult(`merge outcome is unknown; authoritative readback did not prove a merge. No retry was attempted${error instanceof Error ? `: ${error.message}` : ''}`)
  }

  try { pr = await deps.readPullRequest(prNumber, repo) } catch (error) {
    throw ambiguousResult(`merge succeeded or may have succeeded but exact readback is unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }
  const commit = await verifyMergedResult({ deps, repository: repo, base, pr, prNumber, reviewedHead })
  return { outcome: 'SUCCESS', issueNumber, prNumber, reviewedHead, mergeCommit: commit, reviewVerdictCommentId: String(authorization.review_verdict_comment_id), mergeResult }
}

export function createProductionStandardMergeDeps({ runGh = defaultRunGh, env = process.env } = {}) {
  if (env == null) throw stateConflict('STANDARD merge transport environment is unavailable')
  const transport = createProductionMergeDeps({ runGh })
  const shared = createProductionDeps({ runGh })
  const bootstrap = createTaskBootstrapGithubAdapter({ repository: STARTER_REPOSITORY, env, runGh })
  return {
    readIssue: transport.readIssue,
    readPullRequest: shared.readPullRequest,
    readIssueComments: shared.readIssueComments,
    readFounderAuthorization: shared.readFounderAuthorization,
    readTrustedFounderLogins: shared.readTrustedFounderLogins,
    readProtectedRef: shared.readProtectedRef,
    readPolicy: async ({ repo = STARTER_REPOSITORY, repository = repo, ref, path, sourceCommit }) => bootstrap.getPolicy({ ref, path, sourceCommit, repository }),
    mergePullRequest: shared.mergePullRequest,
    verifyCommitOnProtectedBase: shared.verifyCommitOnProtectedBase,
  }
}

export async function runProductionStandardMerge() {
  const command = 'bemoat:mission-control:merge-standard'
  let invocation
  try {
    const argv = process.argv.slice(2)
    invocation = parseCommandInvocation(command, argv)
    if (invocation.mode === 'help') {
      if (invocation.format === 'json') process.stdout.write(`${JSON.stringify(createHelpEnvelopeV1(invocation.contract))}\n`)
      else process.stdout.write(formatTextHelp(invocation.contract))
      return
    }
    const options = parseMergeCliArgs(argv)
    const result = await runStandardFounderAuthorizedMerge({ ...options, deps: createProductionStandardMergeDeps() })
    const classification = result.outcome === 'NO_OP_IDENTICAL_RETRY' ? 'NO_OP_IDENTICAL_RETRY' : 'SUCCESS'
    const envelope = createResultEnvelopeV1({
      command,
      outcome: classification === 'NO_OP_IDENTICAL_RETRY' ? 'NO_OP' : 'SUCCESS',
      classification,
      mutation_performed: classification !== 'NO_OP_IDENTICAL_RETRY',
      repository: options.repo,
      issue_number: String(options.issueNumber),
      pr_number: String(result.prNumber),
      exact_head: result.reviewedHead,
      next_action: { type: 'COMPLETE', command: null, reason: 'The exact STANDARD/non-managed merge completion is durably verified.' },
      details: { merge_commit: result.mergeCommit, review_verdict_comment_id: result.reviewVerdictCommentId },
    })
    if (invocation.format === 'json') process.stdout.write(`${JSON.stringify(envelope)}\n`)
    else process.stdout.write(`${classification}: STANDARD/non-managed PR #${result.prNumber} exact head ${result.reviewedHead}\n`)
    process.exitCode = classificationExitCode(classification)
  } catch (error) {
    const classification = error?.classification ?? error?.code ?? 'INTERNAL_ERROR'
    const reason = error instanceof Error ? error.message : String(error)
    if (invocation?.format === 'json' || process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(createResultEnvelopeV1({ command, outcome: 'ERROR', classification, mutation_performed: false, repository: null, issue_number: null, next_action: { type: 'STOP', command: null, reason }, details: { reason } }))}\n`)
    else process.stderr.write(`${classification}: ${reason}\n`)
    process.exitCode = classificationExitCode(classification)
  }
}
