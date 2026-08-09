#!/usr/bin/env node
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
import { parseCorrectionContract } from '../../correction-contract.mjs'
import { isLeaseCasConflict, writeIssueBodyWithLease } from '../../mission-control-issue-body-cas.mjs'
import {
  appendMissingMissionControlStateBlock,
  parseMissionControlState,
} from '../../mission-control-state.mjs'
import {
  assertFounderAdoptFindingAuthorization,
  parseFounderAdoptFindingAuthorization,
} from '../domain/adopt-finding-authorization.mjs'
import { hashExactBody, stableStringify } from '../domain/correction-contract-fingerprint.mjs'
import {
  parseLineageCorrectionAuthorization,
  validateRecoverStateLineage,
} from '../domain/recover-state-lineage.mjs'

export const RECOVER_STATE_COMMAND = 'bemoat:mission-control:recover-state'
export const RECOVER_STATE_ENTRYPOINT = 'scripts/mission-control-recover-state.mjs'
export const ACCEPTED_PRE_STATES = Object.freeze(['MANAGED_STATE_BLOCK_ABSENT'])
export const NEXT_ACTION_COMMAND = 'bemoat:mission-control:adopt-finding'

const ADOPT_FINDING_ID = 'MC-CORRECTION-FINDING-ADOPTION-001'
const FULL_SHA_RE = /^[0-9a-f]{40}$/i
const ADOPT_AUTHORIZATION_HEADING_RE =
  /^##\s+FOUNDER AUTHORIZATION\s+[—-]\s+MC-CORRECTION-FINDING-ADOPTION-001\s*$/mi
const RESULT_HEADING_RE = /^##\s+RESULT\s*$/mi
const REVIEW_VERDICT_HEADING_RE = /^##\s+REVIEW_VERDICT\s*$/mi

function classifiedError(classification, message, details = {}) {
  const error = new Error(`${classification}: ${message}`)
  error.classification = classification
  Object.assign(error, details)
  return error
}

function normalizeSha(value) {
  return typeof value === 'string' && FULL_SHA_RE.test(value.trim())
    ? value.trim().toLowerCase()
    : null
}

function normalizeId(value) {
  const match = String(value ?? '').match(/^#?([1-9]\d*)$/)
  return match?.[1] ?? null
}

function normalizeText(value) {
  return String(value ?? '').replace(/^`+|`+$/g, '').trim()
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function readLabeledValue(body, labels) {
  const candidates = Array.isArray(labels) ? labels : [labels]
  for (const rawLine of String(body).split(/\r?\n/)) {
    const line = rawLine.trim()
      .replace(/^[-*][ \t]+/, '')
      .replace(/^\*\*/, '')
      .replace(/:\*\*(?=[ \t]|$)/, ':')
    for (const label of candidates) {
      const escaped = escapeRegExp(label)
      const match = line.match(new RegExp(`^${escaped}:[ \t]*(.+?)[ \t]*$`, 'i'))
      if (match) return normalizeText(match[1])
    }
  }
  return null
}

function extractIssueNumber(body) {
  const value = readLabeledValue(body, ['Task / Issue', 'Issue'])
  const leading = String(value ?? '').match(/^#?([1-9]\d*)\b/)
  return leading?.[1] ?? normalizeId(value)
}

function extractPrNumber(body) {
  const value = readLabeledValue(body, ['Reviewed PR', 'PR'])
  if (value) {
    const parsed = normalizeId(value)
    if (parsed) return parsed
    const linked = value.match(/\/pull\/([1-9]\d*)\b/i)
    if (linked) return linked[1]
  }
  const linked = String(body).match(/\/pull\/([1-9]\d*)\b/i)
  return linked?.[1] ?? null
}

function assertCommentIsImmutable({ comment, comments, options, label, commentId = options[label] }) {
  if (!comment || String(comment.id) !== String(commentId)) {
    throw classifiedError('EVIDENCE_CONFLICT', `${label} does not identify the selected immutable comment`)
  }
  const live = comments.filter((entry) => String(entry?.id) === String(comment.id))
  if (live.length !== 1 || String(live[0]?.body ?? '') !== String(comment.body ?? '')) {
    throw classifiedError('EVIDENCE_CONFLICT', `${label} is missing or changed in the live Issue comments`)
  }
  assertCommentSnapshotIsUnedited(live[0], label)
  return comment
}

function assertCommentSnapshotIsUnedited(comment, label) {
  if (comment?.created_at && comment?.updated_at && String(comment.created_at) !== String(comment.updated_at)) {
    throw classifiedError('EVIDENCE_CONFLICT', `${label} has an edited GitHub comment snapshot`)
  }
}

function commentAuthor(comment) {
  return comment?.user?.login ?? comment?.author?.login ?? comment?.author_login ?? null
}

function assertTrustedAuthor(comment, trustedFounderLogins, label) {
  const author = commentAuthor(comment)
  if (!author) throw classifiedError('AUTHORITY_CONFLICT', `${label} author is missing`)
  if (!Array.isArray(trustedFounderLogins) || trustedFounderLogins.length === 0) {
    throw classifiedError('BLOCKED_EXTERNAL', 'repository-owned Founder identity configuration is unavailable')
  }
  if (!trustedFounderLogins.includes(author)) {
    throw classifiedError('AUTHORITY_CONFLICT', `${label} author is not a trusted Founder login`)
  }
  if (comment.author_association && !['OWNER', 'MEMBER'].includes(comment.author_association)) {
    throw classifiedError('AUTHORITY_CONFLICT', `${label} author association is not trusted`)
  }
  return author
}

function assertIssueAttachment(comment, options, label) {
  const expected = `https://api.github.com/repos/${options.repo}/issues/${options.issueNumber}`
  if (comment?.issue_url && comment.issue_url !== expected) {
    throw classifiedError('EVIDENCE_CONFLICT', `${label} is not attached to the Task Issue`)
  }
}

function commentSupersedes(comment, targetId) {
  const body = String(comment?.body ?? '')
  const targetPattern = new RegExp(`\\b#?${escapeRegExp(targetId)}\\b`, 'i')
  return body.split(/\r?\n/).some((line) => {
    if (new RegExp(`\\bsupersedes(?:_comment_id)?[ \\t]*:[ \\t]*#?${escapeRegExp(targetId)}\\b`, 'i').test(line)) {
      return true
    }
    return targetPattern.test(line) && /\\b(?:superseded|not[ \\t]+authoritative)\\b/i.test(line)
  })
}

function assertNotSuperseded(comments, comment, label) {
  for (const candidate of comments) {
    if (String(candidate?.id) === String(comment?.id)) continue
    if (commentSupersedes(candidate, comment.id)) {
      throw classifiedError('AUTHORITY_CONFLICT', `${label} is superseded by comment ${candidate.id}`)
    }
  }
}

function assertSingleHeadingCandidate(comments, selected, heading, label) {
  const candidates = comments.filter((comment) => heading.test(String(comment?.body ?? '')))
  if (candidates.length !== 1 || String(candidates[0]?.id) !== String(selected?.id)) {
    throw classifiedError('AUTHORITY_CONFLICT', `${label} is ambiguous or has competing immutable authority`)
  }
}

function assertTaskPrBinding(body, options, label) {
  if (extractIssueNumber(body) !== String(options.issueNumber)) {
    throw classifiedError('EVIDENCE_CONFLICT', `${label} Task Issue binding does not match`)
  }
  if (extractPrNumber(body) !== String(options.expectedPr)) {
    throw classifiedError('EVIDENCE_CONFLICT', `${label} PR binding does not match`)
  }
}

function assertBaseAndHeadText(body, { base, head }, label) {
  const text = String(body)
  const basePattern = new RegExp(`\\b${escapeRegExp(base)}\\b`)
  if (!basePattern.test(text)) {
    throw classifiedError('HEAD_DRIFT', `${label} protected base binding does not match`)
  }
  if (!text.toLowerCase().includes(String(head).toLowerCase())) {
    throw classifiedError('HEAD_DRIFT', `${label} exact head binding does not match`)
  }
}

function assertBodyContains(body, needle, label, classification = 'EVIDENCE_CONFLICT') {
  if (!String(body).toLowerCase().includes(String(needle).toLowerCase())) {
    throw classifiedError(classification, `${label} is missing required evidence: ${needle}`)
  }
}

function assertApprovedBaseBindingIfPresent(body, options, label) {
  const value = readLabeledValue(body, 'Approved base')
  if (!value) return
  const approvedBaseSha = normalizeSha(value)
  if (approvedBaseSha) {
    if (approvedBaseSha !== options.expectedBaseSha) {
      throw classifiedError('HEAD_DRIFT', `${label} protected base SHA does not match`)
    }
    return
  }
  if (!new RegExp(`\\b${escapeRegExp(options.expectedBase)}\\b`, 'i').test(value)) {
    throw classifiedError('HEAD_DRIFT', `${label} protected base binding does not match`)
  }
}

function lineHasExecutionProof(line, subjects) {
  const text = String(line).toLowerCase()
  const hasSubject = subjects.some((subject) => text.includes(String(subject).toLowerCase()))
  const hasExecution = /\b(?:execute|executed|execution)\b/.test(text)
  const hasNegation = /\b(?:did\s+not|not|never|no)\b/.test(text) || /\bunexecuted\b/.test(text)
  return hasSubject && hasExecution && hasNegation
}

function lineClaimsExecution(line, subjects) {
  const text = String(line).toLowerCase()
  const hasSubject = subjects.some((subject) => text.includes(String(subject).toLowerCase()))
  return hasSubject && /\bexecuted\b/.test(text) && !/\b(?:did\s+not|not|never|no)\b/.test(text)
}

function assertExecutionRemainedUnexecuted(body, subjects, label) {
  const lines = String(body).split(/\r?\n/)
  if (!lines.some((line) => lineHasExecutionProof(line, subjects))) {
    throw classifiedError('AUTHORITY_CONFLICT', `${label} does not prove that the live operation remained unexecuted`)
  }
  if (lines.some((line) => lineClaimsExecution(line, subjects))) {
    throw classifiedError('AUTHORITY_CONFLICT', `${label} claims that the live operation was executed`)
  }
}

function bodyContainsSha(body, sha) {
  return String(body).toLowerCase().includes(String(sha).toLowerCase())
}

function parseExplicitCounterSignals(body) {
  const text = String(body)
  const signals = []
  for (const match of text.matchAll(/\breview_cycle\s*[:=]\s*(\d+)\b/gi)) {
    signals.push({ reviewCycle: Number(match[1]), fullReviewCount: null, source: 'review_cycle' })
  }
  for (const match of text.matchAll(/\bfull_review_count\s*[:=]\s*(\d+)\b/gi)) {
    signals.push({ reviewCycle: null, fullReviewCount: Number(match[1]), source: 'full_review_count' })
  }
  for (const match of text.matchAll(/\bCycle\s*:\s*(\d+)\b/gi)) {
    signals.push({ reviewCycle: Number(match[1]), fullReviewCount: null, source: 'Cycle' })
  }
  for (const match of text.matchAll(/(?:resulting|expected)[^\n]{0,80}?counters?[^\n\d]*(\d+)\s*[|/]\s*(\d+)/gi)) {
    signals.push({ reviewCycle: Number(match[1]), fullReviewCount: Number(match[2]), source: 'counters' })
  }
  return signals
}

function deriveCounters({ predecessorBody, comments, options, trustedFounderLogins }) {
  const relevantComments = [{ id: options.predecessorComment, body: predecessorBody }]
  for (const comment of comments) {
    const body = String(comment?.body ?? '')
    if (body === predecessorBody) continue
    if (!/##\s+REVIEW_VERDICT\b/i.test(body)) continue
    const boundToTaskAndPr = extractIssueNumber(body) === String(options.issueNumber) &&
      extractPrNumber(body) === String(options.expectedPr)
    if (!boundToTaskAndPr) continue
    const signals = parseExplicitCounterSignals(body)
    if (signals.length === 0) continue
    const reviewedHead = normalizeSha(readLabeledValue(body, ['Exact head reviewed', 'Head']))
    if (!reviewedHead) {
      throw classifiedError('EVIDENCE_CONFLICT', `counter evidence comment ${comment.id} does not bind a full reviewed head`)
    }
    const verdict = readLabeledValue(body, 'Verdict')?.toUpperCase()
    if (!['CORRECTION REQUIRED', 'ELIGIBLE FOR FOUNDER REVIEW'].includes(verdict)) {
      throw classifiedError('EVIDENCE_CONFLICT', `counter evidence comment ${comment.id} has an unsupported verdict`)
    }
    assertTrustedAuthor(comment, trustedFounderLogins, `counter evidence comment ${comment.id}`)
    assertCommentSnapshotIsUnedited(comment, `counter evidence comment ${comment.id}`)
    relevantComments.push({ id: comment.id ?? null, body })
  }

  const signals = relevantComments.flatMap((entry) => parseExplicitCounterSignals(entry.body).map((signal) => ({
    ...signal,
    sourceCommentId: entry.id,
  })))
  const reviewCycles = [...new Set(signals.map((signal) => signal.reviewCycle).filter((value) => value !== null))]
  const fullReviewCounts = [...new Set(signals.map((signal) => signal.fullReviewCount).filter((value) => value !== null))]
  if (reviewCycles.some((value) => value < 1 || value > 2) || fullReviewCounts.some((value) => value !== 1)) {
    throw classifiedError('EVIDENCE_CONFLICT', 'evidence contains unsupported review counters')
  }
  if (reviewCycles.length > 1 || fullReviewCounts.length > 1) {
    throw classifiedError('EVIDENCE_CONFLICT', 'evidence contains conflicting review counters')
  }

  if (reviewCycles.length === 0) {
    throw classifiedError('EVIDENCE_CONFLICT', 'no immutable Task/PR-bound counter lineage can reconstruct the review cycle')
  }

  // The selected predecessor contract omits numeric counters. A supported
  // correction lineage may therefore derive full_review_count from the
  // uniquely evidenced review cycle, but only after an immutable bound cycle
  // marker has established that this is a post-review correction state.
  const reviewCycle = reviewCycles[0]
  const fullReviewCount = fullReviewCounts[0] ?? 1
  if (reviewCycle > 2 || fullReviewCount !== 1 || fullReviewCount > reviewCycle) {
    throw classifiedError('EVIDENCE_CONFLICT', 'derived review counters are unsupported')
  }
  return {
    reviewCycle,
    fullReviewCount,
    sourceCommentIds: [...new Set(signals
      .filter((signal) => signal.reviewCycle === reviewCycle || signal.fullReviewCount === fullReviewCount)
      .map((signal) => signal.sourceCommentId)
      .filter((id) => id !== null)
      .map(String))],
    sourceBodyHashes: [...new Set(signals
      .filter((signal) => signal.reviewCycle === reviewCycle || signal.fullReviewCount === fullReviewCount)
      .map((signal) => relevantComments.find((entry) => String(entry.id) === String(signal.sourceCommentId))?.body)
      .filter((body) => body !== undefined)
      .map((body) => hashExactBody(body)))],
  }
}

function parsePredecessor({ comment, comments, options, trustedFounderLogins }) {
  const body = String(comment?.body ?? '')
  assertCommentIsImmutable({ comment, comments, options, label: 'predecessorComment' })
  assertTrustedAuthor(comment, trustedFounderLogins, 'predecessor correction contract')
  assertIssueAttachment(comment, options, 'predecessor correction contract')
  assertNotSuperseded(comments, comment, 'predecessor correction contract')
  assertBodyContains(body, '## REVIEW_VERDICT', 'predecessor correction contract')
  assertBodyContains(body, 'CORRECTION REQUIRED', 'predecessor correction contract')
  assertTaskPrBinding(body, options, 'predecessor correction contract')

  const parsed = parseCorrectionContract(body)
  if (!parsed.ok) {
    throw classifiedError('EVIDENCE_CONFLICT', `predecessor correction contract is invalid: ${parsed.errors.join('; ')}`)
  }
  if (parsed.contract.mode !== 'implementation_pr') {
    throw classifiedError('EVIDENCE_CONFLICT', 'planning_no_pr correction history is unsupported by recovery')
  }
  const reviewedHead = normalizeSha(parsed.contract.reviewed_head)
  if (!reviewedHead) throw classifiedError('HEAD_DRIFT', 'predecessor reviewed head must be a full SHA')
  assertBaseAndHeadText(body, { base: options.expectedBase, head: reviewedHead }, 'predecessor correction contract')
  assertApprovedBaseBindingIfPresent(body, options, 'predecessor correction contract')
  const findingIds = parsed.contract.findings.map((finding) => finding.id)
  if (findingIds.length === 0 || new Set(findingIds).size !== findingIds.length) {
    throw classifiedError('EVIDENCE_CONFLICT', 'predecessor correction findings are empty or duplicated')
  }
  return {
    body,
    bodyHash: hashExactBody(body),
    reviewedHead,
    contract: parsed.contract,
    findingIds,
    counters: deriveCounters({ predecessorBody: body, comments, options, trustedFounderLogins }),
    updatedAt: readLabeledValue(body, 'Timestamp') ?? comment.created_at ?? null,
  }
}

function parseAdoptionAuthorization({ comment, comments, options, predecessor, trustedFounderLogins }) {
  const body = String(comment?.body ?? '')
  assertCommentIsImmutable({ comment, comments, options, label: 'adoptionAuthorizationComment' })
  assertIssueAttachment(comment, options, 'Founder finding-adoption authorization')
  assertTrustedAuthor(comment, trustedFounderLogins, 'Founder finding-adoption authorization')
  assertNotSuperseded(comments, comment, 'Founder finding-adoption authorization')
  assertSingleHeadingCandidate(
    comments,
    comment,
    ADOPT_AUTHORIZATION_HEADING_RE,
    'Founder finding-adoption authorization',
  )

  let parsed
  try {
    parsed = parseFounderAdoptFindingAuthorization(body)
  } catch (error) {
    throw classifiedError('AUTHORITY_CONFLICT', error instanceof Error ? error.message : String(error))
  }
  const authOptions = {
    ...options,
    authorizationComment: options.adoptionAuthorizationComment,
    expectedReviewedHead: predecessor.reviewedHead,
    expectedAdoptionHead: parsed.adoption_head,
  }
  try {
    const asserted = assertFounderAdoptFindingAuthorization({
      authorization: parsed,
      comment,
      comments,
      trustedFounderLogins,
      options: authOptions,
    })
    if (asserted.adopted_finding.id !== ADOPT_FINDING_ID) {
      throw classifiedError('EVIDENCE_CONFLICT', 'unsupported adopted finding identity')
    }
    if (String(asserted.predecessor_comment_id) !== String(options.predecessorComment) ||
        asserted.predecessor_reviewed_head !== predecessor.reviewedHead ||
        stableStringify(asserted.existing_finding_ids) !== stableStringify(predecessor.findingIds)) {
      throw classifiedError('EVIDENCE_CONFLICT', 'adopt-finding authorization does not bind the predecessor contract')
    }
    return asserted
  } catch (error) {
    if (error?.classification) throw error
    throw classifiedError('AUTHORITY_CONFLICT', error instanceof Error ? error.message : String(error))
  }
}

function parseImplementationResult({ comment, comments, options, trustedFounderLogins, expectedHead = null }) {
  const body = String(comment?.body ?? '')
  assertCommentIsImmutable({ comment, comments, options, label: 'implementationResultComment' })
  assertTrustedAuthor(comment, trustedFounderLogins, 'adopt-finding implementation RESULT')
  assertIssueAttachment(comment, options, 'adopt-finding implementation RESULT')
  assertNotSuperseded(comments, comment, 'adopt-finding implementation RESULT')
  assertBodyContains(body, '## RESULT', 'adopt-finding implementation RESULT')
  assertTaskPrBinding(body, options, 'adopt-finding implementation RESULT')
  assertBodyContains(body, 'bemoat:mission-control:adopt-finding', 'adopt-finding implementation RESULT')
  const head = normalizeSha(readLabeledValue(body, ['Head', 'Exact head']))
  if (!head) {
    throw classifiedError('HEAD_DRIFT', 'adopt-finding implementation RESULT must bind a full historical head')
  }
  if (expectedHead && head !== expectedHead) {
    throw classifiedError('HEAD_DRIFT', 'adopt-finding implementation RESULT head does not match its bound historical head')
  }
  assertBodyContains(body, options.expectedBranch, 'adopt-finding implementation RESULT')
  assertExecutionRemainedUnexecuted(
    body,
    ['live adoption', 'adopt-finding'],
    'adopt-finding implementation RESULT',
  )
  return { body, bodyHash: hashExactBody(body), head }
}

function parseImplementationReview({ comment, comments, options, trustedFounderLogins, expectedHead = null }) {
  const body = String(comment?.body ?? '')
  assertCommentIsImmutable({ comment, comments, options, label: 'implementationReviewComment' })
  assertTrustedAuthor(comment, trustedFounderLogins, 'adopt-finding implementation review')
  assertIssueAttachment(comment, options, 'adopt-finding implementation review')
  assertNotSuperseded(comments, comment, 'adopt-finding implementation review')
  assertBodyContains(body, '## REVIEW_VERDICT', 'adopt-finding implementation review')
  assertTaskPrBinding(body, options, 'adopt-finding implementation review')
  assertBodyContains(body, 'ELIGIBLE FOR FOUNDER REVIEW', 'adopt-finding implementation review')
  assertBodyContains(body, ADOPT_FINDING_ID, 'adopt-finding implementation review')
  assertBodyContains(body, NEXT_ACTION_COMMAND, 'adopt-finding implementation review')
  assertApprovedBaseBindingIfPresent(body, options, 'adopt-finding implementation review')
  const head = normalizeSha(readLabeledValue(body, ['Exact head reviewed', 'Head']))
  if (!head) {
    throw classifiedError('HEAD_DRIFT', 'adopt-finding implementation review must bind a full historical head')
  }
  if (expectedHead && head !== expectedHead) {
    throw classifiedError('HEAD_DRIFT', 'adopt-finding implementation review head does not match its bound historical head')
  }
  return { body, bodyHash: hashExactBody(body), head }
}

function assertNoCompetingEvidence({ comments, selectedIds, options, predecessor, historicalHead }) {
  const selected = new Set(Object.values(selectedIds).map((value) => String(value)))
  const sameHeadVerdicts = comments.filter((comment) => {
    const body = String(comment?.body ?? '')
    return REVIEW_VERDICT_HEADING_RE.test(body) &&
      bodyContainsSha(body, options.expectedHead) &&
      (body.includes('ELIGIBLE FOR FOUNDER REVIEW') || body.includes('CORRECTION REQUIRED'))
  })
  if (sameHeadVerdicts.some((comment) => !selected.has(String(comment.id)))) {
    throw classifiedError('EVIDENCE_CONFLICT', 'competing current-head REVIEW_VERDICT evidence exists')
  }

  const samePredecessorContracts = comments.filter((comment) => {
    const body = String(comment?.body ?? '')
    return REVIEW_VERDICT_HEADING_RE.test(body) && bodyContainsSha(body, predecessor.reviewedHead) && /CORRECTION REQUIRED/i.test(body)
  })
  if (samePredecessorContracts.some((comment) => !selected.has(String(comment.id)))) {
    throw classifiedError('EVIDENCE_CONFLICT', 'competing predecessor correction-contract evidence exists')
  }

  const sameHeadResults = comments.filter((comment) => {
    const body = String(comment?.body ?? '')
    return RESULT_HEADING_RE.test(body) && bodyContainsSha(body, options.expectedHead) && body.includes('adopt-finding')
  })
  if (sameHeadResults.some((comment) => !selected.has(String(comment.id)))) {
    throw classifiedError('EVIDENCE_CONFLICT', 'competing adopt-finding implementation RESULT evidence exists')
  }

  const sameHeadRecoveryResults = comments.filter((comment) => {
    const body = String(comment?.body ?? '')
    return RESULT_HEADING_RE.test(body) && bodyContainsSha(body, options.expectedHead) && body.includes(RECOVER_STATE_COMMAND)
  })
  if (sameHeadRecoveryResults.some((comment) => !selected.has(String(comment.id)))) {
    throw classifiedError('EVIDENCE_CONFLICT', 'competing missing-state recovery implementation RESULT evidence exists')
  }

  const sameHistoricalResults = comments.filter((comment) => {
    const body = String(comment?.body ?? '')
    return RESULT_HEADING_RE.test(body) && bodyContainsSha(body, historicalHead) && body.includes('adopt-finding')
  })
  if (sameHistoricalResults.some((comment) => !selected.has(String(comment.id)))) {
    throw classifiedError('EVIDENCE_CONFLICT', 'competing historical adopt-finding implementation RESULT evidence exists')
  }

  const sameHistoricalVerdicts = comments.filter((comment) => {
    const body = String(comment?.body ?? '')
    return REVIEW_VERDICT_HEADING_RE.test(body) && bodyContainsSha(body, historicalHead) &&
      body.includes(ADOPT_FINDING_ID) && body.includes('ELIGIBLE FOR FOUNDER REVIEW')
  })
  if (sameHistoricalVerdicts.some((comment) => !selected.has(String(comment.id)))) {
    throw classifiedError('EVIDENCE_CONFLICT', 'competing historical adopt-finding REVIEW_VERDICT evidence exists')
  }

  for (const comment of comments) {
    if (selected.has(String(comment?.id))) continue
    const lines = String(comment?.body ?? '').split(/\r?\n/)
    if (lines.some((line) => lineClaimsExecution(line, ['live adoption', 'adopt-finding']))) {
      throw classifiedError('AUTHORITY_CONFLICT', 'unknown evidence claims live finding adoption was executed')
    }
  }
}

function buildReconstructedState({ options, pr, predecessor, policy, evidenceFingerprint }) {
  const { reviewCycle, fullReviewCount } = predecessor.counters
  const state = reviewCycle === 1 ? 'CORRECTION_REQUIRED_1' : 'CORRECTION_REQUIRED_2'
  const timestamp = predecessor.updatedAt
  return {
    schema_version: 1,
    state,
    review_cycle: reviewCycle,
    full_review_count: fullReviewCount,
    approved_base: pr.baseRefName,
    active_task_issue: `#${options.issueNumber}`,
    active_pr: `#${options.expectedPr}`,
    current_head: normalizeSha(pr.headRefOid),
    last_reviewed_head: predecessor.reviewedHead,
    workflow_mode: predecessor.contract.mode,
    guide_version: policy.guideVersion,
    guide_source_ref: policy.ref,
    guide_source_sha: normalizeSha(policy.sha),
    latest_review_verdict_comment_id: String(options.predecessorComment),
    open_blockers: predecessor.findingIds,
    follow_up_issues: [],
    next_permitted_action: `Re-attempt Founder-authorized ${NEXT_ACTION_COMMAND} for Issue #${options.issueNumber} after fresh live verification; do not execute automatically.`,
    material_change_status: 'none',
    updated_at: timestamp,
    updated_by: 'Mission Control Missing-State Recovery',
    recovery_evidence_fingerprint: evidenceFingerprint,
  }
}

function sameValue(left, right) {
  return stableStringify(left) === stableStringify(right)
}

function assertPullRequestBinding(pr, options) {
  if (!pr || Number(pr.number) !== Number(options.expectedPr)) {
    throw classifiedError('EVIDENCE_CONFLICT', 'live PR number does not match')
  }
  if (pr.baseRefName !== options.expectedBase || normalizeSha(pr.baseRefOid) !== options.expectedBaseSha) {
    throw classifiedError('HEAD_DRIFT', 'live PR protected base binding does not match')
  }
  if (pr.headRefName !== options.expectedBranch) {
    throw classifiedError('HEAD_DRIFT', 'live PR branch binding does not match')
  }
  if (normalizeSha(pr.headRefOid) !== options.expectedHead) {
    throw classifiedError('HEAD_DRIFT', 'live PR exact head does not match')
  }
  if (String(pr.state ?? '').toUpperCase() !== 'OPEN') {
    throw classifiedError('STATE_CONFLICT', 'live PR is not open for the authorized recovery lineage')
  }
}

async function reconstruct({ options, deps }) {
  const [issue, pr, comments, trustedFounderLogins, policy] = await Promise.all([
    deps.readManagedIssue(options.issueNumber, options.repo),
    deps.readPullRequest(options.expectedPr, options.repo),
    deps.readIssueComments(options.repo, options.issueNumber),
    deps.readTrustedFounderLogins(options.repo),
    deps.readProtectedPolicy(options.repo, options.expectedBase, options.expectedBaseSha),
  ])
  if (!Array.isArray(comments)) throw classifiedError('BLOCKED_EXTERNAL', 'live Issue comment pagination is incomplete')

  const issueBody = String(issue?.body ?? '')
  if (String(issue?.state ?? '').toUpperCase() !== 'OPEN') {
    throw classifiedError('STATE_CONFLICT', 'managed Task Issue is not open for the authorized recovery lineage')
  }
  const parsedState = parseMissionControlState(issueBody)
  if (parsedState.present && !parsedState.valid) {
    throw classifiedError('STATE_CONFLICT', `managed state is malformed or partial: ${parsedState.reason}`)
  }
  if (parsedState.present && parsedState.valid && !['CORRECTION_REQUIRED_1', 'CORRECTION_REQUIRED_2'].includes(parsedState.state.state)) {
    throw classifiedError('STATE_CONFLICT', `valid managed state ${parsedState.state.state} is not an identical recovery projection`)
  }

  assertPullRequestBinding(pr, options)
  if (!policy || policy.ref !== options.expectedBase || normalizeSha(policy.commitSha) !== normalizeSha(options.expectedBaseSha)) {
    throw classifiedError('HEAD_DRIFT', 'protected policy source does not match the invocation')
  }
  if (!normalizeSha(policy.sha)) {
    throw classifiedError('BLOCKED_EXTERNAL', 'protected Mission Control guide blob identity is unavailable')
  }
  if (typeof policy.guideVersion !== 'string' || policy.guideVersion.trim() === '') {
    throw classifiedError('BLOCKED_EXTERNAL', 'protected Mission Control guide version is unavailable')
  }

  for (const [key, value] of Object.entries({
    predecessorComment: options.predecessorComment,
    adoptionAuthorizationComment: options.adoptionAuthorizationComment,
    implementationResultComment: options.implementationResultComment,
    implementationReviewComment: options.implementationReviewComment,
    recoveryAuthorizationComment: options.recoveryAuthorizationComment,
    lineageCorrectionAuthorizationComment: options.lineageCorrectionAuthorizationComment,
    correctionResultComment: options.correctionResultComment,
    correctionReviewComment: options.correctionReviewComment,
  })) {
    if (!normalizeId(value)) {
      throw classifiedError('EVIDENCE_CONFLICT', `${key} must be selected explicitly`)
    }
  }

  const selectedIds = {
    predecessor: options.predecessorComment,
    adoptionAuthorization: options.adoptionAuthorizationComment,
    implementationResult: options.implementationResultComment,
    implementationReview: options.implementationReviewComment,
    recoveryAuthorization: options.recoveryAuthorizationComment,
    lineageCorrectionAuthorization: options.lineageCorrectionAuthorizationComment,
    correctionResult: options.correctionResultComment,
    correctionReview: options.correctionReviewComment,
  }
  const selectedComments = {}
  for (const [key, optionKey] of Object.entries({
    predecessor: 'predecessorComment',
    adoptionAuthorization: 'adoptionAuthorizationComment',
    implementationResult: 'implementationResultComment',
    implementationReview: 'implementationReviewComment',
    recoveryAuthorization: 'recoveryAuthorizationComment',
    lineageCorrectionAuthorization: 'lineageCorrectionAuthorizationComment',
    correctionResult: 'correctionResultComment',
    correctionReview: 'correctionReviewComment',
  })) {
    selectedComments[key] = await deps.readComment(options.repo, options[optionKey])
  }

  const lineageCorrectionAuthorization = parseLineageCorrectionAuthorization({
    comment: selectedComments.lineageCorrectionAuthorization,
    comments,
    options,
    trustedFounderLogins,
  })
  const selectedLineageComments = {}
  for (const [key, commentId] of Object.entries({
    recoveryImplementationResult: lineageCorrectionAuthorization.recoveryImplementationResult,
    recoveryImplementationReview: lineageCorrectionAuthorization.recoveryImplementationReview,
  })) {
    selectedLineageComments[key] = await deps.readComment(options.repo, commentId)
    selectedIds[key] = commentId
  }

  const predecessor = parsePredecessor({
    comment: selectedComments.predecessor,
    comments,
    options,
    trustedFounderLogins,
  })
  const adoptionAuthorization = parseAdoptionAuthorization({
    comment: selectedComments.adoptionAuthorization,
    comments,
    options,
    predecessor,
    trustedFounderLogins,
  })
  const implementationResult = parseImplementationResult({
    comment: selectedComments.implementationResult,
    comments,
    options,
    trustedFounderLogins,
  })
  const implementationReview = parseImplementationReview({
    comment: selectedComments.implementationReview,
    comments,
    options,
    trustedFounderLogins,
    expectedHead: implementationResult.head,
  })
  if (implementationReview.head !== implementationResult.head) {
    throw classifiedError('EVIDENCE_CONFLICT', 'historical adopt-finding implementation RESULT and REVIEW_VERDICT bind different heads')
  }

  if (adoptionAuthorization.adopted_finding.id !== ADOPT_FINDING_ID) {
    throw classifiedError('EVIDENCE_CONFLICT', 'adoption authorization finding is unsupported')
  }
  const derivedState = {
    state: predecessor.counters.reviewCycle === 1 ? 'CORRECTION_REQUIRED_1' : 'CORRECTION_REQUIRED_2',
  }
  const lineage = await validateRecoverStateLineage({
    comments,
    options,
    trustedFounderLogins,
    derivedState,
    historicalImplementationResult: implementationResult,
    recoveryAuthorizationComment: selectedComments.recoveryAuthorization,
    lineageCorrectionAuthorization,
    recoveryImplementationResultComment: selectedLineageComments.recoveryImplementationResult,
    recoveryImplementationReviewComment: selectedLineageComments.recoveryImplementationReview,
    correctionResultComment: selectedComments.correctionResult,
    correctionReviewComment: selectedComments.correctionReview,
    verifyCommitAncestry: deps.verifyCommitAncestry,
  })
  const {
    recoveryAuthorization,
    recoveryImplementationResult,
    recoveryImplementationReview,
    correctionImplementationResult,
    correctionImplementationReview,
    ancestryProofs,
  } = lineage
  assertNoCompetingEvidence({
    comments,
    selectedIds,
    options,
    predecessor,
    historicalHead: implementationResult.head,
  })

  const evidence = {
    predecessor_comment_id: String(options.predecessorComment),
    predecessor_body_sha256: predecessor.bodyHash,
    predecessor_reviewed_head: predecessor.reviewedHead,
    counter_source_comment_ids: predecessor.counters.sourceCommentIds.join(','),
    counter_source_body_sha256: predecessor.counters.sourceBodyHashes.join(','),
    adoption_authorization_comment_id: String(options.adoptionAuthorizationComment),
    adoption_authorization_body_sha256: adoptionAuthorization.body_sha256,
    adoption_head: adoptionAuthorization.adoption_head,
    implementation_result_comment_id: String(options.implementationResultComment),
    implementation_result_body_sha256: implementationResult.bodyHash,
    historical_adopt_finding_head: implementationResult.head,
    implementation_review_comment_id: String(options.implementationReviewComment),
    implementation_review_body_sha256: implementationReview.bodyHash,
    recovery_authorization_comment_id: String(options.recoveryAuthorizationComment),
    recovery_authorization_body_sha256: recoveryAuthorization.bodyHash,
    recovery_implementation_result_comment_id: String(lineageCorrectionAuthorization.recoveryImplementationResult),
    recovery_implementation_result_body_sha256: recoveryImplementationResult.bodyHash,
    recovery_implementation_review_comment_id: String(lineageCorrectionAuthorization.recoveryImplementationReview),
    recovery_implementation_review_body_sha256: recoveryImplementationReview.bodyHash,
    recovery_authorization_bound_head: recoveryAuthorization.authorizedHead,
    recovery_authorization_anchor_head: recoveryImplementationResult.head,
    recovery_implementation_anchor_head: recoveryImplementationResult.head,
    current_recovery_head: recoveryImplementationResult.head,
    correction_result_comment_id: String(options.correctionResultComment),
    correction_result_body_sha256: correctionImplementationResult.bodyHash,
    correction_review_comment_id: String(options.correctionReviewComment),
    correction_review_body_sha256: correctionImplementationReview.bodyHash,
    correction_reviewed_head: correctionImplementationResult.head,
    live_pr_exact_head: normalizeSha(pr.headRefOid),
    ancestry_proof: 'historical_adopt_finding_head_is_ancestor_of_current_recovery_head',
    ancestry_proofs: ancestryProofs.join(','),
    lineage_correction_authorization_comment_id: String(options.lineageCorrectionAuthorizationComment),
    lineage_correction_authorization_body_sha256: lineageCorrectionAuthorization.bodyHash,
    policy_source_sha: normalizeSha(policy.sha),
  }
  const evidenceFingerprint = hashExactBody(stableStringify(evidence))
  const reconstructedState = buildReconstructedState({
    options,
    pr,
    predecessor,
    policy,
    evidenceFingerprint,
  })

  return {
    issue,
    issueBody,
    parsedState,
    pr,
    comments,
    policy,
    state: reconstructedState,
    evidence,
    evidenceFingerprint,
    observedPreState: parsedState.present ? 'MANAGED_STATE_BLOCK_PRESENT' : 'MANAGED_STATE_BLOCK_ABSENT',
  }
}

function exactNextAction(issueNumber) {
  return `Re-attempt Founder-authorized ${NEXT_ACTION_COMMAND} for Issue #${issueNumber} after fresh live verification; do not execute automatically.`
}

export async function runRecoverState({ options, deps, checkOnly = false }) {
  if (!deps) throw classifiedError('BLOCKED_EXTERNAL', 'missing-state recovery transport dependencies are unavailable')
  const reconstruction = await reconstruct({ options, deps })
  const { parsedState, state } = reconstruction

  if (parsedState.present && parsedState.valid) {
    if (sameValue(parsedState.state, state)) {
      return {
        classification: 'NO_OP_IDENTICAL_RETRY',
        outcome: 'NO_OP',
        mutationPerformed: false,
        state: parsedState.state,
        nextAction: { type: 'COMMAND', command: NEXT_ACTION_COMMAND, reason: exactNextAction(options.issueNumber) },
        evidenceIds: reconstruction.evidence,
        observedPreState: reconstruction.observedPreState,
      }
    }
    throw classifiedError('STATE_CONFLICT', 'a valid managed-state projection already exists with different content')
  }

  let nextBody
  try {
    nextBody = appendMissingMissionControlStateBlock(reconstruction.issueBody, state)
  } catch (error) {
    throw classifiedError('STATE_CONFLICT', error instanceof Error ? error.message : String(error))
  }

  const nextAction = { type: 'COMMAND', command: NEXT_ACTION_COMMAND, reason: exactNextAction(options.issueNumber) }
  if (checkOnly) {
    return {
      classification: 'SUCCESS',
      outcome: 'SUCCESS',
      mutationPerformed: false,
      state,
      nextState: state,
      nextAction,
      evidenceIds: reconstruction.evidence,
      observedPreState: reconstruction.observedPreState,
      checkOnly: true,
    }
  }

  const latest = await reconstruct({ options, deps })
  if (latest.issueBody !== reconstruction.issueBody || latest.parsedState.present) {
    throw classifiedError('STATE_CONFLICT', 'managed Issue changed before missing-state recovery mutation')
  }
  if (latest.evidenceFingerprint !== reconstruction.evidenceFingerprint || !sameValue(latest.state, state)) {
    throw classifiedError('EVIDENCE_CONFLICT', 'immutable recovery evidence changed before mutation')
  }

  try {
    await deps.writeIssueBody({
      repo: options.repo,
      issueNumber: options.issueNumber,
      expectedBody: reconstruction.issueBody,
      nextBody,
      transitionIdentity: JSON.stringify({
        command: RECOVER_STATE_COMMAND,
        issue: String(options.issueNumber),
        pr: String(options.expectedPr),
        current_head: options.expectedHead,
        recovery_authorization_comment: String(options.recoveryAuthorizationComment),
        evidence_fingerprint: reconstruction.evidenceFingerprint,
      }),
    })
  } catch (error) {
    if (isLeaseCasConflict(error) || /lease CAS lost|concurrent|stale Issue body/i.test(String(error?.message ?? ''))) {
      throw classifiedError('STATE_CONFLICT', error instanceof Error ? error.message : String(error))
    }
    throw classifiedError('AMBIGUOUS_RESULT', `Issue CAS/lease write outcome is ambiguous: ${error instanceof Error ? error.message : String(error)}`)
  }

  let verified
  try {
    verified = await deps.readManagedIssue(options.issueNumber, options.repo)
  } catch (error) {
    throw classifiedError('AMBIGUOUS_RESULT', `post-write Issue readback failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  const verifiedBody = String(verified?.body ?? '')
  const verifiedState = parseMissionControlState(verifiedBody)
  if (verifiedBody !== nextBody || !verifiedState.present || !verifiedState.valid || !sameValue(verifiedState.state, state)) {
    throw classifiedError('AMBIGUOUS_RESULT', 'post-write Issue body readback does not match the reconstructed canonical state')
  }

  return {
    classification: 'SUCCESS',
    outcome: 'SUCCESS',
    mutationPerformed: true,
    state: verifiedState.state,
    nextAction,
    evidenceIds: reconstruction.evidence,
    observedPreState: reconstruction.observedPreState,
  }
}

function resolveRecoverStateCommand() {
  const env = process.env.npm_lifecycle_event === 'test:int'
    ? { ...process.env, npm_lifecycle_event: undefined }
    : process.env
  return resolveCommandIdentity({
    fallback: RECOVER_STATE_COMMAND,
    env,
    entrypoint: RECOVER_STATE_ENTRYPOINT,
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
    issueNumber: values.issue_number,
    repo: values.repository,
    expectedPr: values.expected_pr,
    expectedBase: values.expected_base,
    expectedBaseSha: values.expected_base_sha,
    expectedHead: values.expected_head,
    expectedBranch: values.expected_branch,
    predecessorComment: values.predecessor_comment,
    adoptionAuthorizationComment: values.adoption_authorization_comment,
    implementationResultComment: values.implementation_result_comment,
    implementationReviewComment: values.implementation_review_comment,
    recoveryAuthorizationComment: values.recovery_authorization_comment,
    lineageCorrectionAuthorizationComment: values.lineage_correction_authorization_comment,
    correctionResultComment: values.correction_result_comment,
    correctionReviewComment: values.correction_review_comment,
    check: values.check === true,
  }
}

function renderResult({ command, format, options, result }) {
  const envelope = createResultEnvelopeV1({
    command,
    outcome: result.outcome,
    classification: result.classification,
    mutation_performed: result.mutationPerformed,
    observed_pre_state: result.observedPreState ?? null,
    resulting_state: result.state?.state ?? null,
    repository: options.repo.toLowerCase(),
    issue_number: String(options.issueNumber),
    pr_number: String(options.expectedPr),
    exact_head: options.expectedHead,
    evidence_ids: result.evidenceIds ?? {},
    next_action: result.nextAction ?? {
      type: 'STOP',
      command: null,
      reason: `Stop on ${result.classification}; do not retry unless the classification is identically completed.`,
    },
    details: {
      check_only: result.checkOnly === true,
      mutation_boundary: 'one missing canonical managed-state block only',
      no_comment_mutation: true,
      adoption_executed: false,
      historical_adopt_finding_head: result.evidenceIds?.historical_adopt_finding_head ?? null,
      recovery_authorization_bound_head: result.evidenceIds?.recovery_authorization_bound_head ?? null,
      recovery_authorization_anchor_head: result.evidenceIds?.recovery_authorization_anchor_head ?? null,
      recovery_implementation_anchor_head: result.evidenceIds?.recovery_implementation_anchor_head ?? null,
      current_recovery_head: result.evidenceIds?.current_recovery_head ?? null,
      correction_reviewed_head: result.evidenceIds?.correction_reviewed_head ?? null,
      live_pr_exact_head: result.evidenceIds?.live_pr_exact_head ?? null,
      ancestry_proof: result.evidenceIds?.ancestry_proof ?? null,
      ancestry_proofs: result.evidenceIds?.ancestry_proofs ?? [],
    },
  })
  if (format === 'json') process.stdout.write(`${JSON.stringify(envelope)}\n`)
  else process.stdout.write(`${envelope.classification}: missing-state recovery Task #${options.issueNumber}\n`)
  process.exitCode = classificationExitCode(envelope.classification)
  return envelope
}

export async function main(argv = process.argv.slice(2), deps = createProductionDeps()) {
  let command = null
  let invocation = null
  let options = null
  try {
    command = resolveRecoverStateCommand()
    invocation = parseCommandInvocation(command, argv)
    if (invocation.mode === 'help') {
      renderHelp(invocation)
      process.exitCode = 0
      return { classification: 'HELP' }
    }
    options = invocationToOptions(invocation)
    const result = await runRecoverState({ options, deps, checkOnly: options.check })
    return renderResult({ command, format: invocation.format, options, result })
  } catch (error) {
    if (error instanceof CliInvocationError) {
      const envelope = createResultEnvelopeV1({
        command: command ?? RECOVER_STATE_COMMAND,
        outcome: 'STOP',
        classification: 'INVALID_INVOCATION',
        mutation_performed: false,
        observed_pre_state: null,
        resulting_state: null,
        repository: options?.repo?.toLowerCase?.() ?? null,
        issue_number: options?.issueNumber ? String(options.issueNumber) : null,
        pr_number: options?.expectedPr ? String(options.expectedPr) : null,
        exact_head: null,
        evidence_ids: {},
        next_action: { type: 'STOP', command: null, reason: error.message },
        details: { argument: error.details?.argument ?? null, reason: error.message },
      })
      if (invocation?.format === 'json' || argv.includes('--json')) process.stdout.write(`${JSON.stringify(envelope)}\n`)
      else process.stderr.write(`INVALID_INVOCATION: ${error.message}\n`)
      process.exitCode = classificationExitCode('INVALID_INVOCATION')
      return envelope
    }

    const classification = runtimeClassification(error)
    const message = error instanceof Error ? error.message : String(error)
    const envelope = createResultEnvelopeV1({
      command: command ?? RECOVER_STATE_COMMAND,
      outcome: classification === 'INTERNAL_ERROR' ? 'ERROR' : 'STOP',
      classification,
      mutation_performed: false,
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
    else process.stderr.write(`${classification}: ${message}\n`)
    process.exitCode = classificationExitCode(classification)
    return envelope
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
      throw classifiedError(
        'BLOCKED_EXTERNAL',
        result.stderr || result.stdout || result.error?.message || 'GitHub CLI failed',
      )
    }
    return result.stdout.trim()
  }

  return {
    readManagedIssue: async (issueNumber, repo) => JSON.parse(runGh([
      'issue', 'view', String(issueNumber), '--repo', repo, '--json', 'number,id,title,body,state',
    ])),
    readPullRequest: async (prNumber, repo) => JSON.parse(runGh([
      'pr', 'view', String(prNumber), '--repo', repo,
      '--json', 'number,state,isDraft,headRefName,headRefOid,baseRefName,baseRefOid',
    ])),
    readComment: async (repo, commentId) => JSON.parse(runGh([
      'api', `repos/${repo}/issues/comments/${commentId}`,
    ])),
    readIssueComments: async (repo, issueNumber) => {
      const pages = JSON.parse(runGh([
        'api', '--paginate', '--slurp',
        `repos/${repo}/issues/${issueNumber}/comments?per_page=100`,
      ]))
      if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
        throw classifiedError('BLOCKED_EXTERNAL', 'live Issue comment pagination is incomplete')
      }
      return pages.flat()
    },
    readTrustedFounderLogins: async (repo) => {
      const variable = JSON.parse(runGh(['api', `repos/${repo}/actions/variables/BEMOAT_FOUNDER_LOGINS`]))
      const logins = String(variable.value ?? '').split(',').map((login) => login.trim()).filter(Boolean)
      if (logins.length === 0) throw classifiedError('BLOCKED_EXTERNAL', 'Founder identity configuration is unavailable')
      return logins
    },
    readProtectedPolicy: async (repo, ref, expectedSha) => {
      const commit = JSON.parse(runGh([
        'api', `repos/${repo}/commits/${expectedSha}`,
      ]))
      if (normalizeSha(commit.sha) !== normalizeSha(expectedSha)) {
        throw classifiedError('HEAD_DRIFT', 'protected Mission Control policy commit does not match the requested base SHA')
      }
      const file = JSON.parse(runGh([
        'api', `repos/${repo}/contents/docs/mission-control/mission-control-guide.md?ref=${expectedSha}`,
      ]))
      const body = Buffer.from(String(file.content ?? '').replace(/\s+/g, ''), 'base64').toString('utf8')
      const version = body.match(/(?:version|Guide version)\s*[`:]\s*([0-9]+\.[0-9]+\.[0-9]+)/i)?.[1] ?? null
      if (!normalizeSha(file.sha)) {
        throw classifiedError('BLOCKED_EXTERNAL', 'protected Mission Control guide blob identity is unavailable')
      }
      return { ref, commitSha: expectedSha, sha: file.sha, guideVersion: version }
    },
    verifyCommitAncestry: async ({ repository, base, baseSha, ancestor, descendant }) => {
      const ancestryScope = `${repository} ${base}@${baseSha}`
      const result = spawnSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
        encoding: 'utf8',
      })
      if (result.status === 0) return true
      if (result.status === 1) return false
      throw classifiedError(
        'BLOCKED_EXTERNAL',
        result.stderr || result.stdout || result.error?.message || `trusted Git ancestry verification failed for ${ancestryScope}`,
      )
    },
    writeIssueBody: async ({ repo, issueNumber, expectedBody, nextBody, transitionIdentity }) =>
      writeIssueBodyWithLease({
        repo,
        issueNumber,
        expectedBody,
        nextBody,
        transitionIdentity,
        holder: 'mission-control-recover-state',
        repoFlag: repo,
        deps: { runGh },
      }),
  }
}
