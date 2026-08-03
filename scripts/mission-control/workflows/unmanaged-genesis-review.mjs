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
  parseLegacyDeltaEvidence,
  parseUnmanagedGenesisReviewComment,
  renderUnmanagedGenesisReviewComment,
  signUnmanagedGenesisReviewRecord,
  stateConflict,
  validateFounderUnmanagedGenesisAuthorization,
  verifyUnmanagedGenesisReviewRecord,
} from '../domain/unmanaged-genesis-review.mjs'

const REQUIRED_CI_NAMES = ['ci', 'starter-ci']

function positiveId(value) {
  return /^[1-9]\d*$/.test(String(value ?? ''))
}

function founderLoginsFromEnv(env) {
  const raw = env.BEMOAT_FOUNDER_LOGINS ?? ''
  return String(raw).split(',').map((entry) => entry.trim()).filter(Boolean)
}

function githubAppSlugFromEnv(env) {
  const value = String(env.BEMOAT_UGR_GITHUB_APP_SLUG ?? '').trim()
  return value || null
}

function checkName(check) {
  return String(check?.name ?? check?.context ?? '').trim().toLowerCase()
}

function checkConclusion(check) {
  return String(check?.conclusion ?? check?.state ?? '').trim().toUpperCase()
}

function verifyRequiredChecks(checks, requiredNames, label) {
  const list = Array.isArray(checks) ? checks : []
  const failed = list.filter((check) => ['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ERROR'].includes(checkConclusion(check)))
  if (failed.length > 0) throw stateConflict(`${label} contains a failed check`)
  const successfulNames = new Set(list
    .filter((check) => checkConclusion(check) === 'SUCCESS')
    .map(checkName))
  for (const required of requiredNames) {
    const wanted = String(required).toLowerCase()
    if (![...successfulNames].some((name) => name === wanted || name.includes(wanted))) {
      throw stateConflict(`${label} check ${wanted} is missing or unsuccessful`)
    }
  }
  return list.filter((check) => checkConclusion(check) === 'SUCCESS').map((check) => ({
    name: check.name ?? check.context,
    conclusion: check.conclusion ?? check.state,
    id: check.id ?? null,
  }))
}

function exactHeadCiEvidence(pullRequest, expectedHead, requiredNames = REQUIRED_CI_NAMES) {
  if (pullRequest.headRefOid !== expectedHead) {
    throw stateConflict('live PR head does not match the authorized exact_current_head')
  }
  const analysis = analyzeExactHeadCi(pullRequest)
  if (!analysis.exactHeadVerified) throw stateConflict(`required exact-head CI is not verified: ${analysis.summary}`)
  const checks = Array.isArray(pullRequest.statusCheckRollup) ? pullRequest.statusCheckRollup : []
  return {
    head: expectedHead,
    checks: verifyRequiredChecks(checks, requiredNames, 'required current CI'),
  }
}

async function historicalCiEvidence(github, sha, requiredNames) {
  if (typeof github.getCommitCheckRuns !== 'function') {
    throw blockedExternal('GitHub adapter cannot retrieve historical commit check runs')
  }
  let checks
  try {
    checks = await github.getCommitCheckRuns(sha)
  } catch (error) {
    throw blockedExternal(`historical CI could not be retrieved for ${sha}: ${error.message}`, error)
  }
  return {
    head: sha,
    checks: verifyRequiredChecks(checks, requiredNames, 'historical CI'),
  }
}

function sourceReviewFromComment(comment, parsed = null, role = 'FULL_REVIEW_VERDICT') {
  const result = parsed ?? parseHistoricalReviewOccurrence(comment.body ?? '')
  return {
    commentId: Number(comment.id),
    bodySha256: sha256Hex(String(comment.body ?? '')),
    authorLogin: comment.user?.login ?? comment.author?.login ?? null,
    verdict: result.verdict,
    role,
    base: result.base ?? null,
    head: result.reviewedHead ?? result.head ?? null,
    parsed: result,
  }
}

function commentById(comments, id) {
  return comments.find((comment) => Number(comment.id) === Number(id)) ?? null
}

function immutableCommentBody(comment, expectedHash, label) {
  if (!comment) throw stateConflict(`${label} comment was not found`)
  if (comment.created_at && comment.updated_at && comment.created_at !== comment.updated_at) {
    throw stateConflict(`${label} comment was edited`)
  }
  const actualHash = sha256Hex(String(comment.body ?? ''))
  if (actualHash !== expectedHash) throw stateConflict(`${label} comment body hash mismatches immutable evidence`)
  return actualHash
}

function verifyHistoricalFullEvidence({ authorization, sourceComment }) {
  const evidence = authorization.full.source_evidence
  immutableCommentBody(sourceComment, UGR_CONTRACT.historicalFullSourceBodySha256, 'historical Full source')
  if (Number(sourceComment.id) !== UGR_CONTRACT.historicalFullSourceCommentId ||
      evidence.body_sha256 !== UGR_CONTRACT.historicalFullSourceBodySha256) {
    throw stateConflict('historical Full source evidence comment identity mismatches the approved occurrence')
  }
  const parsed = parseHistoricalReviewOccurrence(sourceComment.body ?? '')
  if (parsed.pullRequest !== UGR_CONTRACT.pullRequest ||
      parsed.base !== UGR_CONTRACT.base ||
      parsed.reviewedHead !== UGR_CONTRACT.historicalFullReviewedHead ||
      parsed.verdict !== 'ELIGIBLE FOR FOUNDER REVIEW' ||
      parsed.unresolvedCriticalOrImportant) {
    throw stateConflict('historical Full source review is not the approved evidence-only verdict')
  }
  return sourceReviewFromComment(sourceComment, parsed, evidence.role)
}

function verifyLegacyCoverageSegment({ segment, comment }) {
  if (Number(segment.comment_id) !== UGR_CONTRACT.legacyDeltaEvidenceCommentId ||
      segment.body_sha256 !== UGR_CONTRACT.legacyDeltaEvidenceBodySha256 ||
      segment.base !== UGR_CONTRACT.legacyDeltaEvidenceBase ||
      segment.head !== UGR_CONTRACT.legacyDeltaEvidenceHead ||
      segment.role !== 'LEGACY_DELTA_EVIDENCE_RESULT' ||
      segment.verdict !== 'ELIGIBLE FOR FOUNDER REVIEW') {
    throw stateConflict('only the exact legacy Delta RESULT may authorize a legacy coverage segment')
  }
  immutableCommentBody(comment, UGR_CONTRACT.legacyDeltaEvidenceBodySha256, 'legacy Delta evidence')
  const parsed = parseLegacyDeltaEvidence(comment.body ?? '')
  if (!parsed.evidenceOnly ||
      parsed.pullRequest !== UGR_CONTRACT.pullRequest ||
      parsed.base !== UGR_CONTRACT.legacyDeltaEvidenceBase ||
      parsed.head !== UGR_CONTRACT.legacyDeltaEvidenceHead ||
      parsed.verdict !== 'ELIGIBLE FOR FOUNDER REVIEW') {
    throw stateConflict('legacy Delta RESULT is not the exact evidence-only occurrence')
  }
  return sourceReviewFromComment(comment, parsed, segment.role)
}

function verifyDeltaVerdictSegment({ segment, comment }) {
  if (segment.role !== 'DELTA_REVIEW_VERDICT') {
    throw stateConflict('generic RESULT comments are non-authoritative Delta evidence')
  }
  immutableCommentBody(comment, segment.body_sha256, 'Delta review verdict')
  const parsed = parseHistoricalReviewOccurrence(comment.body ?? '')
  if (parsed.pullRequest !== UGR_CONTRACT.pullRequest ||
      (parsed.base !== UGR_CONTRACT.base && parsed.base !== segment.base) ||
      parsed.reviewedHead !== segment.head ||
      parsed.verdict !== segment.verdict) {
    throw stateConflict('Delta REVIEW_VERDICT coverage segment does not match its bound range')
  }
  return sourceReviewFromComment(comment, parsed, segment.role)
}

function verifyCoverageSegments({ authorization, comments, fullReviewedHead }) {
  const segments = authorization.delta.coverage_segments
  let cursor = fullReviewedHead
  let sourceReview = null
  for (const segment of segments) {
    if (segment.base !== cursor) throw stateConflict('Delta coverage segments must be contiguous')
    const comment = commentById(comments, segment.comment_id)
    if (!comment) throw stateConflict(`Delta coverage comment ${segment.comment_id} was not found`)
    sourceReview = segment.role === 'LEGACY_DELTA_EVIDENCE_RESULT'
      ? verifyLegacyCoverageSegment({ segment, comment })
      : verifyDeltaVerdictSegment({ segment, comment })
    cursor = segment.head
  }
  if (cursor !== authorization.delta.exact_current_head) {
    throw stateConflict('Delta coverage must end at exact_current_head')
  }
  return { sourceReview, segments }
}

function fullRecordReviewHead(record) {
  return record.full?.reviewed_head ?? record.reviewed_head
}

function sameRecord(left, right) {
  return left?.record_id === right?.record_id &&
    left?.signing?.signature === right?.signing?.signature &&
    left?.founder_authorization?.comment_body_sha256 === right?.founder_authorization?.comment_body_sha256
}

function matchingParentFull(existing, parent) {
  const matches = existing.filter((entry) => {
    const record = entry.record
    return record.evidence_class === 'full' &&
      record.record_id === parent.record_id &&
      record.founder_authorization?.authorization_id === parent.authorization_id &&
      Number(record.founder_authorization?.comment_id) === Number(parent.authorization_comment_id) &&
      Number(entry.commentId) === Number(parent.record_comment_id) &&
      entry.bodySha256 === parent.record_body_sha256
  })
  if (matches.length !== 1) throw stateConflict('Delta parent_full does not resolve to exactly one valid signed Full')
  return matches[0]
}

function detectDeltaSiblingConflicts(existing, candidate) {
  const candidateDelta = candidate.delta
  const siblings = existing.filter((entry) => {
    const delta = entry.record.delta
    return entry.record.evidence_class === 'delta' &&
      delta?.parent_full?.record_id === candidateDelta.parent_full.record_id &&
      delta?.predecessor_delta_record_id === candidateDelta.predecessor_delta_record_id &&
      delta?.exact_current_head === candidateDelta.exact_current_head
  })
  for (const sibling of siblings) {
    if (sibling.record.record_id !== candidate.record_id) {
      throw stateConflict('competing or forked Delta records exist for the same parent/range/head')
    }
  }
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
  const githubAppSlug = githubAppSlugFromEnv(env)

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
      workflow,
      signingKeyId,
      githubAppSlug,
    })
    const expectedPr = authorization.expected_pr
    if (pullRequest.state !== expectedPr.state ||
        pullRequest.isDraft !== expectedPr.draft ||
        pullRequest.headRefName !== expectedPr.head_ref ||
        pullRequest.headRefOid !== expectedPr.observed_head ||
        pullRequest.baseRefName !== expectedPr.base_ref ||
        pullRequest.baseRefOid !== expectedPr.base_sha) {
      throw stateConflict('live PR does not match the authorization expected_pr binding')
    }

    const existing = collectVerifiedRecords(comments, { publicKey, signingKeyId, githubAppSlug })
    const evidenceClass = validated.evidenceClass
    let sourceReview
    let reviewedHead
    let exactHeadCi
    let full = null
    let delta = null
    const findings = []

    if (evidenceClass === 'full') {
      reviewedHead = authorization.full.reviewed_head
      const sourceComment = commentById(comments, authorization.full.source_evidence.comment_id) ??
        await github.getIssueComment(authorization.full.source_evidence.comment_id)
      sourceReview = verifyHistoricalFullEvidence({ authorization, sourceComment })
      if (typeof github.isCommitAncestor !== 'function') {
        throw blockedExternal('GitHub adapter cannot verify historical Full ancestry')
      }
      let ancestor
      try {
        ancestor = await github.isCommitAncestor({
          ancestor: reviewedHead,
          descendant: pullRequest.headRefOid,
        })
      } catch (error) {
        throw blockedExternal(`historical Full ancestry could not be verified: ${error.message}`, error)
      }
      if (ancestor !== true) throw stateConflict('historical Full reviewed head is not an ancestor of the live PR head')
      exactHeadCi = await historicalCiEvidence(
        github,
        reviewedHead,
        authorization.full.required_historical_checks,
      )
      full = {
        ...authorization.full,
        findings_sha256: sha256Hex(canonicalSerialize(findings)),
      }
    } else {
      const parent = authorization.delta.parent_full
      const parentEntry = matchingParentFull(existing, parent)
      const fullReviewedHead = fullRecordReviewHead(parentEntry.record)
      const coverage = verifyCoverageSegments({
        authorization,
        comments,
        fullReviewedHead,
      })
      sourceReview = coverage.sourceReview
      reviewedHead = authorization.delta.exact_current_head
      exactHeadCi = exactHeadCiEvidence(
        pullRequest,
        reviewedHead,
        authorization.delta.required_current_checks,
      )
      const predecessorId = authorization.delta.predecessor_delta_record_id
      let correctionBase = fullReviewedHead
      if (predecessorId != null) {
        const predecessor = existing.filter((entry) => entry.record.record_id === predecessorId)
        if (predecessor.length !== 1 || predecessor[0].record.evidence_class !== 'delta') {
          throw stateConflict('Delta predecessor_delta_record_id does not resolve to exactly one valid Delta')
        }
        correctionBase = predecessor[0].record.delta.exact_current_head
      }
      const correctionDiff = await github.getPullRequestDiff(UGR_CONTRACT.pullRequest, {
        base: correctionBase,
        head: reviewedHead,
      })
      if (sha256Hex(correctionDiff) !== authorization.delta.correction_diff_sha256) {
        throw stateConflict('Delta correction_diff_sha256 does not match the live compare diff')
      }
      const overallDiff = await github.getPullRequestDiff(UGR_CONTRACT.pullRequest, {
        base: fullReviewedHead,
        head: reviewedHead,
      })
      if (sha256Hex(overallDiff) !== authorization.delta.overall_diff_sha256) {
        throw stateConflict('Delta overall_diff_sha256 does not match the live compare diff')
      }
      delta = {
        ...authorization.delta,
        correction_base: correctionBase,
        correction_head: reviewedHead,
        prior_full_record_id: parent.record_id,
        prior_full_record_comment_id: Number(parent.record_comment_id),
        prior_full_record_sha256: parent.record_body_sha256,
      }
    }

    const unsigned = buildUnmanagedGenesisReviewRecord({
      evidenceClass,
      repository: repo,
      taskIssue: issue,
      pullRequest,
      founderAuthorization: validated,
      sourceReview,
      reviewedHead,
      livePrHead: pullRequest.headRefOid,
      exactHeadCi,
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

    if (evidenceClass === 'delta') detectDeltaSiblingConflicts(existing, signed)
    const duplicate = existing.find((entry) => entry.record.record_id === signed.record_id)
    if (duplicate) {
      if (!sameRecord(duplicate.record, signed)) {
        throw stateConflict('existing signed record with the same identity does not match the requested record')
      }
      return {
        outcome: 'NO_OP',
        evidenceClass,
        recordId: duplicate.record.record_id,
        commentId: duplicate.commentId,
        reviewedHead,
        mergeEligibility: evaluateUnmanagedGenesisMergeEligibility({
          records: existing,
          livePullRequestHead: pullRequest.headRefOid,
        }),
        issueBodyWrites: 0,
      }
    }

    const body = renderUnmanagedGenesisReviewComment({
      verdict: sourceReview.verdict,
      record: signed,
      findingsSummary: '- There are no Critical or Important findings in the signed record.',
    })
    let posted
    try {
      posted = await github.postIssueComment(UGR_CONTRACT.taskIssue, body)
    } catch (error) {
      const reread = await github.getIssueComments(UGR_CONTRACT.taskIssue)
      const recovered = collectVerifiedRecords(reread, { publicKey, signingKeyId, githubAppSlug })
        .filter((entry) => entry.record.record_id === signed.record_id)
      if (recovered.length === 1 && sameRecord(recovered[0].record, signed)) {
        return {
          outcome: 'NO_OP',
          evidenceClass,
          recordId: recovered[0].record.record_id,
          commentId: recovered[0].commentId,
          reviewedHead,
          mergeEligibility: evaluateUnmanagedGenesisMergeEligibility({
            records: collectVerifiedRecords(reread, { publicKey, signingKeyId, githubAppSlug }),
            livePullRequestHead: pullRequest.headRefOid,
          }),
          issueBodyWrites: 0,
          recovered: true,
        }
      }
      if (recovered.length > 1) throw stateConflict('post failure produced duplicate signed records')
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

    const issueAfter = await github.getIssue(UGR_CONTRACT.taskIssue)
    if (issueAfter.body !== issue.body) throw stateConflict('Issue #262 body changed during unmanaged-genesis review transport')
    if (/bemoat-mission-control-state/i.test(issueAfter.body ?? '') ||
        /\breview_cycle\b/.test(issueAfter.body ?? '') ||
        /\bfull_review_count\b/.test(issueAfter.body ?? '')) {
      throw stateConflict('Issue #262 gained managed-state markers during transport')
    }

    const allRecords = collectVerifiedRecords(rereadComments, { publicKey, signingKeyId, githubAppSlug })
    return {
      outcome: 'RECORDED',
      evidenceClass,
      recordId: signed.record_id,
      authorizationId: authorization.authorization_id,
      commentId: Number(posted.id),
      reviewedHead,
      mergeEligibility: evaluateUnmanagedGenesisMergeEligibility({
        records: allRecords,
        livePullRequestHead: pullRequest.headRefOid,
      }),
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
    const records = collectVerifiedRecords(comments, { publicKey, signingKeyId, githubAppSlug })
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
