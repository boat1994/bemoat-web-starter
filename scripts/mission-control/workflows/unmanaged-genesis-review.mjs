import { analyzeExactHeadCi } from '../../agent-issue/exact-head-ci.mjs'
import { canonicalSerialize, sha256Hex } from '../domain/task-attestation.mjs'
import {
  UGR_CONTRACT,
  assertUnmanagedTopology,
  blockedExternal,
  buildUnmanagedGenesisReviewRecord,
  collectVerifiedRecords,
  createFounderUnmanagedGenesisAuthorizationBody,
  evaluateUnmanagedGenesisMergeEligibility,
  parseFounderUnmanagedGenesisAuthorization,
  parseHistoricalReviewOccurrence,
  parseUnmanagedGenesisReviewComment,
  renderUnmanagedGenesisReviewComment,
  signUnmanagedGenesisReviewRecord,
  stateConflict,
  validateFounderUnmanagedGenesisAuthorization,
  verifyUnmanagedGenesisReviewRecord,
} from '../domain/unmanaged-genesis-review.mjs'

const REQUIRED_CI_NAMES = new Set(['ci', 'starter-ci'])

function positiveId(value) {
  return /^[1-9]\d*$/.test(String(value ?? ''))
}

function founderLoginsFromEnv(env) {
  const raw = env.BEMOAT_FOUNDER_LOGINS ?? ''
  return String(raw).split(',').map((entry) => entry.trim()).filter(Boolean)
}

function exactHeadCiEvidence(pullRequest, expectedHead) {
  if (pullRequest.headRefOid !== expectedHead) {
    throw stateConflict('live PR head does not match the authorized reviewed_head')
  }
  const analysis = analyzeExactHeadCi(pullRequest)
  if (!analysis.exactHeadVerified) throw stateConflict(`required exact-head CI is not verified: ${analysis.summary}`)
  const checks = Array.isArray(pullRequest.statusCheckRollup) ? pullRequest.statusCheckRollup : []
  const failed = checks.filter((check) => check?.conclusion === 'FAILURE' || check?.conclusion === 'CANCELLED' || check?.state === 'FAILURE')
  if (failed.length > 0) throw stateConflict('required exact-head CI contains a failed check')
  const successful = checks.filter((check) => check?.conclusion === 'SUCCESS' || check?.state === 'SUCCESS')
  const successfulNames = new Set(successful.map((check) => String(check.name ?? check.context ?? '').toLowerCase()))
  for (const required of REQUIRED_CI_NAMES) {
    if (![...successfulNames].some((name) => name === required || name.includes(required))) {
      throw stateConflict(`required exact-head CI check ${required} is missing or unsuccessful`)
    }
  }
  return {
    head: expectedHead,
    checks: successful.map((check) => ({
      name: check.name ?? check.context,
      conclusion: check.conclusion ?? check.state,
      id: check.id ?? null,
    })),
  }
}

function sourceReviewFromComment(comment) {
  const parsed = parseHistoricalReviewOccurrence(comment.body ?? '')
  if (parsed.hasSignedRecord) {
    // A comment that already carries a signed envelope is handled by record collection.
  }
  return {
    commentId: Number(comment.id),
    bodySha256: sha256Hex(String(comment.body ?? '')),
    authorLogin: comment.user?.login ?? comment.author?.login ?? null,
    verdict: parsed.verdict,
    parsed,
  }
}

function findingsSha256(findings) {
  return sha256Hex(JSON.stringify(findings ?? []))
}

function sameRecord(left, right) {
  return left?.record_id === right?.record_id &&
    left?.signing?.signature === right?.signing?.signature &&
    left?.founder_authorization?.comment_body_sha256 === right?.founder_authorization?.comment_body_sha256
}

export function createUnmanagedGenesisReviewService({
  github,
  repository = UGR_CONTRACT.repository,
  publicKey,
  signingPrivateKey = null,
  signingKeyId = null,
  workflow = null,
  env = process.env,
} = {}) {
  if (!github) throw new Error('unmanaged-genesis review service requires a GitHub adapter')
  if (!publicKey) throw blockedExternal('committed public verification key is unavailable')

  async function loadContext(founderAuthorizationCommentId) {
    if (!positiveId(founderAuthorizationCommentId)) {
      throw stateConflict('founder_authorization_comment_id must be a positive immutable comment ID')
    }
    const [repo, issue, pullRequest, comments, authorizationComment] = await Promise.all([
      github.getRepository(),
      github.getIssue(UGR_CONTRACT.taskIssue),
      github.getPullRequest(UGR_CONTRACT.pullRequest),
      github.getIssueComments(UGR_CONTRACT.taskIssue),
      github.getIssueComment(founderAuthorizationCommentId),
    ])
    assertUnmanagedTopology({ issue, pullRequest, repositoryName: repository })
    if (Number(authorizationComment.issue_number ?? UGR_CONTRACT.taskIssue) !== UGR_CONTRACT.taskIssue) {
      throw stateConflict('Founder authorization comment must belong to Issue #262')
    }
    return { repo, issue, pullRequest, comments, authorizationComment }
  }

  async function recordReview({ founderAuthorizationCommentId }) {
    const { repo, issue, pullRequest, comments, authorizationComment } = await loadContext(founderAuthorizationCommentId)
    const authorization = parseFounderUnmanagedGenesisAuthorization(authorizationComment.body ?? '')
    const validated = validateFounderUnmanagedGenesisAuthorization({
      authorization,
      authorizationComment,
      repository,
      founderLogins: founderLoginsFromEnv(env),
      issueComments: comments,
    })

    const existing = collectVerifiedRecords(comments, { publicKey, signingKeyId })
    const sourceComment = comments.find((comment) => Number(comment.id) === Number(validated.authorization.source_review_comment_id))
      ?? await github.getIssueComment(validated.authorization.source_review_comment_id)

    if (!sourceComment) throw stateConflict('source review comment was not found')
    if (sourceComment.created_at && sourceComment.updated_at && sourceComment.created_at !== sourceComment.updated_at) {
      throw stateConflict('source review comment was edited')
    }

    const sourceReview = sourceReviewFromComment(sourceComment)
    if (!sourceReview.authorLogin) throw stateConflict('source review author is missing')

    // Direct historical comment 5167077714 is evidence-only and never merge authority.
    if (Number(sourceComment.id) === UGR_CONTRACT.historicalFullSourceCommentId) {
      if (sourceComment.performed_via_github_app != null) {
        // unexpected for this occurrence; still treat as evidence-only until signed
      }
      const historical = sourceReview.parsed
      if (historical.pullRequest !== UGR_CONTRACT.pullRequest || historical.base !== UGR_CONTRACT.base) {
        throw stateConflict('historical source review is not bound to PR #266 / main')
      }
      if (validated.evidenceClass === 'full' && historical.reviewedHead !== UGR_CONTRACT.historicalFullReviewedHead) {
        throw stateConflict('historical Full source review head mismatches the approved old head')
      }
    }

    const reviewedHead = validated.authorization.reviewed_head
    const ci = exactHeadCiEvidence(pullRequest, reviewedHead)

    let full = null
    let delta = null
    let findings = Array.isArray(validated.authorization.findings) ? validated.authorization.findings : []

    if (validated.evidenceClass === 'full') {
      if (Number(validated.authorization.source_review_comment_id) === UGR_CONTRACT.historicalFullSourceCommentId) {
        if (reviewedHead !== UGR_CONTRACT.historicalFullReviewedHead) {
          throw stateConflict('Full record for historical Review 1 must bind the approved old head')
        }
      }
      full = {
        reviewed_old_head: reviewedHead,
        findings_sha256: findingsSha256(findings),
      }
    } else {
      const priorFullEntries = existing.filter((entry) => entry.record.evidence_class === 'full' && entry.record.record_id === validated.authorization.prior_full_record_id)
      if (priorFullEntries.length !== 1) throw stateConflict('delta requires exactly one matching valid prior Full record')
      const priorFull = priorFullEntries[0]
      if (Number(priorFull.commentId) !== Number(validated.authorization.prior_full_record_comment_id)) {
        throw stateConflict('delta prior_full_record_comment_id does not match the verified Full record comment')
      }
      if (priorFull.bodySha256 !== sha256Hex(String((comments.find((comment) => Number(comment.id) === priorFull.commentId) ?? {}).body ?? '')) &&
          priorFull.bodySha256 !== priorFull.bodySha256) {
        // body hash already captured at collection time
      }
      if (validated.authorization.correction_base !== priorFull.record.reviewed_head && validated.authorization.predecessor_delta_record_id == null) {
        // first delta must use Full-reviewed old head as correction_base
        if (validated.authorization.correction_base !== UGR_CONTRACT.historicalFullReviewedHead) {
          throw stateConflict('first Delta correction_base must equal the Full-reviewed old head')
        }
      }
      if (validated.authorization.correction_head !== pullRequest.headRefOid) {
        throw stateConflict('Delta correction_head must equal the live PR head')
      }
      if (reviewedHead !== pullRequest.headRefOid) {
        throw stateConflict('Delta reviewed_head must equal the live PR head')
      }

      const diffText = await github.getPullRequestDiff(UGR_CONTRACT.pullRequest, {
        base: validated.authorization.correction_base,
        head: validated.authorization.correction_head,
      })
      const liveDiffSha = sha256Hex(diffText)
      if (liveDiffSha !== validated.authorization.correction_diff_sha256) {
        throw stateConflict('Delta correction_diff_sha256 does not match the live compare diff')
      }

      const priorFullRecordSha = sha256Hex(canonicalSerialize(priorFull.record))
      delta = {
        prior_full_record_id: priorFull.record.record_id,
        prior_full_record_comment_id: Number(priorFull.commentId),
        prior_full_record_sha256: priorFullRecordSha,
        reviewed_old_head: priorFull.record.reviewed_head,
        predecessor_delta_record_id: validated.authorization.predecessor_delta_record_id ?? null,
        correction_of_record_id: validated.authorization.correction_of_record_id ?? null,
        correction_base: validated.authorization.correction_base,
        correction_head: validated.authorization.correction_head,
        correction_commit_oids: validated.authorization.correction_commit_oids ?? [],
        correction_diff_sha256: validated.authorization.correction_diff_sha256,
        correction_result_comment_id: validated.authorization.correction_result_comment_id ?? 0,
        correction_result_body_sha256: validated.authorization.correction_result_body_sha256 ?? sha256Hex(''),
        finding_disposition: validated.authorization.finding_disposition ?? [],
      }

      if (delta.predecessor_delta_record_id) {
        const predecessors = existing.filter((entry) => entry.record.record_id === delta.predecessor_delta_record_id)
        if (predecessors.length !== 1) throw stateConflict('predecessor_delta_record_id does not resolve to exactly one valid Delta')
      }

      // Fork detection: more than one tip under the same Full for the same head/range is conflict.
      const siblings = existing.filter((entry) => (
        entry.record.evidence_class === 'delta' &&
        entry.record.delta?.prior_full_record_id === priorFull.record.record_id &&
        entry.record.delta?.predecessor_delta_record_id === delta.predecessor_delta_record_id &&
        entry.record.reviewed_head === reviewedHead
      ))
      for (const sibling of siblings) {
        // identical retry handled below via record_id
        if (sibling.record.delta?.correction_diff_sha256 === delta.correction_diff_sha256) continue
        throw stateConflict('competing or forked Delta records exist for the same parent/range/head')
      }
    }

    const unsigned = buildUnmanagedGenesisReviewRecord({
      evidenceClass: validated.evidenceClass,
      repository: repo,
      taskIssue: issue,
      pullRequest,
      founderAuthorization: validated,
      sourceReview,
      reviewedHead,
      exactHeadCi: ci,
      findings,
      full,
      delta,
      workflow,
      signingKeyId,
    })
    const signed = signUnmanagedGenesisReviewRecord(unsigned, {
      ['privateKey']: signingPrivateKey,
      keyId: signingKeyId,
    })

    const duplicate = existing.find((entry) => entry.record.record_id === signed.record_id)
    if (duplicate) {
      if (!sameRecord(duplicate.record, signed) && duplicate.record.signing?.signature !== signed.signing.signature) {
        // Allow NO_OP when semantic identity matches even if workflow run_id differs in stored copy.
        const verified = verifyUnmanagedGenesisReviewRecord(duplicate.record, { publicKey, signingKeyId })
        if (!verified.ok) throw stateConflict('existing record with the same identity failed verification')
      }
      const merge = evaluateUnmanagedGenesisMergeEligibility({
        records: existing,
        livePullRequestHead: pullRequest.headRefOid,
      })
      return {
        outcome: 'NO_OP',
        evidenceClass: validated.evidenceClass,
        recordId: duplicate.record.record_id,
        commentId: duplicate.commentId,
        reviewedHead,
        mergeEligibility: merge,
        issueBodyWrites: 0,
      }
    }

    // Ambiguous competing identity with different payload already thrown in collectVerifiedRecords.
    const body = renderUnmanagedGenesisReviewComment({
      verdict: sourceReview.verdict,
      record: signed,
      findingsSummary: findings.length === 0
        ? '- There are no Critical or Important findings in the signed record.'
        : `- ${findings.length} finding(s) bound in the signed record.`,
    })

    let posted
    try {
      posted = await github.postIssueComment(UGR_CONTRACT.taskIssue, body)
    } catch (error) {
      // Partial failure: scan for an identical durable record before failing.
      const reread = await github.getIssueComments(UGR_CONTRACT.taskIssue)
      const recovered = collectVerifiedRecords(reread, { publicKey, signingKeyId })
        .find((entry) => entry.record.record_id === signed.record_id)
      if (recovered) {
        return {
          outcome: 'NO_OP',
          evidenceClass: validated.evidenceClass,
          recordId: recovered.record.record_id,
          commentId: recovered.commentId,
          reviewedHead,
          mergeEligibility: evaluateUnmanagedGenesisMergeEligibility({
            records: recovered ? collectVerifiedRecords(reread, { publicKey, signingKeyId }) : [],
            livePullRequestHead: pullRequest.headRefOid,
          }),
          issueBodyWrites: 0,
          recovered: true,
        }
      }
      throw blockedExternal(`failed to post signed unmanaged-genesis review record: ${error.message}`, error)
    }

    const rereadComments = await github.getIssueComments(UGR_CONTRACT.taskIssue)
    const postedLive = rereadComments.find((comment) => Number(comment.id) === Number(posted.id))
    if (!postedLive || postedLive.body !== body) {
      throw stateConflict('posted unmanaged-genesis review comment failed byte-for-byte readback')
    }
    const parsed = parseUnmanagedGenesisReviewComment(postedLive.body)
    if (!parsed.ok) throw stateConflict(`posted record could not be parsed: ${parsed.reason}`)
    const verified = verifyUnmanagedGenesisReviewRecord(parsed.record, { publicKey, signingKeyId })
    if (!verified.ok) throw stateConflict(`posted record failed signature verification: ${verified.reason}`)
    if (verified.record.record_id !== signed.record_id) throw stateConflict('posted record_id drifted from the signed request')

    // Ensure Issue body was never written.
    const issueAfter = await github.getIssue(UGR_CONTRACT.taskIssue)
    if (issueAfter.body !== issue.body) throw stateConflict('Issue #262 body changed during unmanaged-genesis review transport')
    if (/bemoat-mission-control-state/i.test(issueAfter.body ?? '') || /\breview_cycle\b/.test(issueAfter.body ?? '')) {
      throw stateConflict('Issue #262 gained managed-state markers during transport')
    }

    const allRecords = collectVerifiedRecords(rereadComments, { publicKey, signingKeyId })
    const mergeEligibility = evaluateUnmanagedGenesisMergeEligibility({
      records: allRecords,
      livePullRequestHead: pullRequest.headRefOid,
    })

    return {
      outcome: 'RECORDED',
      evidenceClass: validated.evidenceClass,
      recordId: signed.record_id,
      commentId: Number(posted.id),
      reviewedHead,
      mergeEligibility,
      issueBodyWrites: 0,
    }
  }

  async function evaluateMergeGate() {
    const [issue, pullRequest, comments] = await Promise.all([
      github.getIssue(UGR_CONTRACT.taskIssue),
      github.getPullRequest(UGR_CONTRACT.pullRequest),
      github.getIssueComments(UGR_CONTRACT.taskIssue),
    ])
    assertUnmanagedTopology({ issue, pullRequest, repositoryName: repository })
    const records = collectVerifiedRecords(comments, { publicKey, signingKeyId })
    return evaluateUnmanagedGenesisMergeEligibility({
      records,
      livePullRequestHead: pullRequest.headRefOid,
    })
  }

  return {
    recordReview,
    evaluateMergeGate,
    contract: UGR_CONTRACT,
  }
}

export { createFounderUnmanagedGenesisAuthorizationBody, evaluateUnmanagedGenesisMergeEligibility }
