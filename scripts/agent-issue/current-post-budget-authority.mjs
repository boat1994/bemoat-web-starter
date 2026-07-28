import { createHash } from 'node:crypto'

import { parseCompleteGitHubPullUrl } from '../pr-identity.mjs'
import { parseMissionControlState } from '../mission-control-state.mjs'

function pinnedCommentId(comment) {
  const match = String(comment?.url ?? comment?.html_url ?? '').match(/#issuecomment-(\d+)$/)
  return match?.[1] ?? null
}

function findExactlyOnePinnedComment(comments, commentId) {
  const matches = comments.filter((comment) => pinnedCommentId(comment) === String(commentId))
  return matches.length === 1 ? matches[0] : null
}

function sourceField(body, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = String(body ?? '').match(new RegExp('^-\\s+\\*\\*' + escaped + ':\\*\\*\\s*`?(.+?)`?\\s*$', 'm'))
  return match?.[1]?.trim().replace(/^`|`$/g, '') ?? null
}

function matchesPinnedList(value, expected) {
  const ids = String(value ?? '').match(/[A-Za-z0-9][A-Za-z0-9_-]*/g) ?? []
  return JSON.stringify(ids) === JSON.stringify(expected)
}

function validateCurrentAuthorityState(state, issueNumber, defaultRepo) {
  const authority = state?.founder_migration_authority
  if (!authority || typeof authority !== 'object' || Array.isArray(authority)) return null
  const errors = []
  const latestReview = state.post_budget_reviews?.at(-1)
  if (authority.schema_version !== 3 || authority.status !== 'approved' || authority.authority !== 'Founder' || authority.scope !== 'correction') {
    errors.push('current authority record must be an approved Founder schema-version 3 correction authority')
  }
  if (authority.canonical_repository !== defaultRepo || authority.issue !== `#${issueNumber}` ||
      !/^#[1-9]\d*$/.test(String(authority.pr ?? ''))) {
    errors.push('current authority record does not bind the current repository, issue, and PR')
  }
  if (!/^[0-9a-f]{64}$/.test(String(authority.content_sha256 ?? '')) ||
      !/^[1-9]\d*$/.test(String(authority.comment_id ?? '')) ||
      !/^[1-9]\d*$/.test(String(authority.specification_result_comment_id ?? '')) ||
      !/^[1-9]\d*$/.test(String(authority.review_7_verdict_comment_id ?? '')) ||
      !/^[1-9]\d*$/.test(String(authority.historical_review_3_source_comment_id ?? '')) ||
      !/^[1-9]\d*$/.test(String(authority.historical_handoff_comment_id ?? ''))) {
    errors.push('current authority record is missing a pinned source ID or content hash')
  }
  if (!latestReview || latestReview.review_number !== 7 || latestReview.verdict_comment_id !== authority.review_7_verdict_comment_id ||
      latestReview.reviewed_head !== authority.correction_base || state.current_head !== authority.correction_base ||
      state.last_reviewed_head !== authority.correction_base) {
    errors.push('current authority record does not bind the latest post-budget Review 7 head')
  }
  if (!Array.isArray(authority.finding_ids) || authority.finding_ids.length === 0 ||
      JSON.stringify(authority.finding_ids) !== JSON.stringify(authority.historical_finding_ids)) {
    errors.push('current authority record does not preserve the historical immutable finding set')
  }
  return { authority, ok: errors.length === 0, errors }
}

function validatePinnedFounderDecision({ authority, source, issueNumber, defaultRepo }) {
  const errors = []
  const comment = source.comment
  const expectedUrl = `https://github.com/${defaultRepo}/issues/${issueNumber}#issuecomment-${authority.comment_id}`
  if (String(comment.id) !== String(authority.comment_id) || comment.html_url !== expectedUrl ||
      comment.user?.login !== authority.author_login || comment.author_association !== authority.author_association ||
      comment.created_at !== authority.created_at || comment.updated_at !== authority.updated_at) {
    errors.push('pinned Founder decision source metadata does not match state')
  }
  if (createHash('sha256').update(comment.body ?? '').digest('hex') !== authority.content_sha256) {
    errors.push('pinned Founder decision content hash does not match state')
  }
  const fields = [
    ['Canonical repository', authority.canonical_repository], ['Repository ID', authority.repository_id],
    ['Issue', authority.issue], ['PR', authority.pr], ['Specification RESULT comment', authority.specification_result_comment_id],
    ['Review 7 verdict comment', authority.review_7_verdict_comment_id], ['Correction base', authority.correction_base],
    ['Historical Review 3 authority source comment', authority.historical_review_3_source_comment_id],
    ['Historical HANDOFF comment', authority.historical_handoff_comment_id], ['Historical authorization ID', authority.historical_authorization_id],
    ['Historical reviewed head', authority.historical_reviewed_head], ['Historical action', authority.historical_action],
    ['Historical authorization timestamp', authority.historical_authorized_at], ['Approved action', authority.approved_action],
  ]
  for (const [label, expected] of fields) {
    const sourceValue = sourceField(comment.body, label)
    if (label === 'Approved action') {
      if (!sourceValue?.includes(authority.finding_ids[0]) || !sourceValue.includes(authority.correction_base)) {
        errors.push('pinned Founder decision Approved action does not bind the finding and correction base')
      }
    } else if (sourceValue !== String(expected)) {
      errors.push(`pinned Founder decision ${label} does not match state`)
    }
  }
  if (!matchesPinnedList(sourceField(comment.body, 'Finding IDs'), authority.finding_ids) ||
      !matchesPinnedList(sourceField(comment.body, 'Historical finding IDs'), authority.historical_finding_ids)) {
    errors.push('pinned Founder decision finding IDs do not match state')
  }
  return { ok: errors.length === 0, errors }
}

function validateHistoricalAuthority({ state, authority, comments, historicalHandoff, issueNumber, defaultRepo }) {
  const errors = []
  const historical = state.founder_correction_authorization
  const reviewThree = findExactlyOnePinnedComment(comments, authority.historical_review_3_source_comment_id)
  const expectedHandoffUrl = `https://github.com/${defaultRepo}/issues/${issueNumber}#issuecomment-${authority.historical_handoff_comment_id}`
  if (!historical || historical.authorization_id !== authority.historical_authorization_id ||
      historical.reviewed_head !== authority.historical_reviewed_head || historical.action !== authority.historical_action ||
      historical.authorized_at !== authority.historical_authorized_at || historical.handoff_comment_id !== authority.historical_handoff_comment_id ||
      JSON.stringify(historical.finding_ids) !== JSON.stringify(authority.historical_finding_ids)) {
    errors.push('historical Review 3 authorization does not match the current pinned authority record')
  }
  if (!reviewThree || !String(reviewThree.url ?? '').endsWith(`#issuecomment-${authority.historical_review_3_source_comment_id}`)) {
    errors.push('pinned historical Review 3 source is missing or inconsistent')
  }
  const handoff = historicalHandoff.comment
  if (String(handoff.id) !== String(authority.historical_handoff_comment_id) || handoff.html_url !== expectedHandoffUrl ||
      handoff.user?.login !== 'boat1994' || handoff.author_association !== 'OWNER' ||
      !String(handoff.body ?? '').match(/^##\s+HANDOFF\s*$/m) || !String(handoff.body ?? '').includes(authority.historical_authorization_id) ||
      !String(handoff.body ?? '').includes(authority.historical_reviewed_head) || !String(handoff.body ?? '').includes(String(authority.pr))) {
    errors.push('pinned historical HANDOFF source is missing or inconsistent')
  }
  return { ok: errors.length === 0, errors }
}

function validatePinnedSpecificationResult({ authority, source, issueNumber, defaultRepo }) {
  const errors = []
  const comment = source.comment
  const expectedUrl = `https://github.com/${defaultRepo}/issues/${issueNumber}#issuecomment-${authority.specification_result_comment_id}`
  const body = String(comment?.body ?? '')
  const findingId = authority.finding_ids[0]
  if (String(comment.id) !== String(authority.specification_result_comment_id) || comment.html_url !== expectedUrl ||
      comment.user?.login !== 'boat1994' || comment.author_association !== 'OWNER' ||
      comment.created_at !== comment.updated_at) {
    errors.push('pinned Specification RESULT source metadata is missing or inconsistent')
  }
  if (!body.match(/^##\s+RESULT\s*$/m)) {
    errors.push('pinned Specification RESULT heading is missing')
  }
  if (!body.includes(findingId) || !body.includes(authority.correction_base)) {
    errors.push('pinned Specification RESULT does not bind the finding and correction base')
  }
  if (!body.includes('Smallest bounded correction scope') && !body.includes('Mutation-isolated test matrix') &&
      !body.includes('Required correction behavior')) {
    errors.push('pinned Specification RESULT does not preserve required correction behavior')
  }
  return { ok: errors.length === 0, errors, body }
}

function extractFindingThreadUrl(reviewSevenBody, findingId, defaultRepo, prNumber) {
  const escapedFinding = String(findingId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const link = String(reviewSevenBody ?? '').match(
    new RegExp(`\\[${escapedFinding}\\]\\((https://github\\.com/${defaultRepo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/pull/${prNumber}#discussion_r[0-9]+)\\)`),
  )
  if (link?.[1]) return link[1]
  const fallback = String(reviewSevenBody ?? '').match(
    new RegExp(`https://github\\.com/${defaultRepo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/pull/${prNumber}#discussion_r[0-9]+`),
  )
  return fallback?.[0] ?? null
}

function validatePinnedReview7({ authority, source, issueNumber, defaultRepo }) {
  const errors = []
  const comment = source.comment
  const expectedUrl = `https://github.com/${defaultRepo}/issues/${issueNumber}#issuecomment-${authority.review_7_verdict_comment_id}`
  const body = String(comment?.body ?? '')
  const findingId = authority.finding_ids[0]
  const prNumber = String(authority.pr).slice(1)
  if (String(comment.id) !== String(authority.review_7_verdict_comment_id) || comment.html_url !== expectedUrl ||
      comment.user?.login !== 'boat1994' || comment.author_association !== 'OWNER' ||
      comment.created_at !== comment.updated_at) {
    errors.push('pinned Review 7 source metadata is missing or inconsistent')
  }
  if (!body.match(/^##\s+REVIEW_VERDICT\s*$/m) || !body.includes('CORRECTION REQUIRED') ||
      !body.includes(authority.correction_base) || !body.includes(`/pull/${prNumber}`) || !body.includes(findingId)) {
    errors.push('pinned Review 7 content does not bind the PR, correction base, and finding')
  }
  const threadUrl = extractFindingThreadUrl(body, findingId, defaultRepo, prNumber)
  if (!threadUrl) {
    errors.push('pinned Review 7 does not pin the original finding thread')
  }
  return { ok: errors.length === 0, errors, body, threadUrl }
}

function parseFindingFromThread(body, findingId) {
  const escaped = String(findingId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = String(body ?? '').match(
    new RegExp(`^\\*\\*${escaped}\\s+[—-]\\s+([A-Za-z]+)\\s+[—-]\\s+(.+?)\\*\\*\\s*$`, 'm'),
  )
  if (!match) return null
  return {
    id: findingId,
    severity: match[1],
    canonical_summary: match[2].trim(),
  }
}

function validatePinnedFindingThread({ authority, source, threadUrl, defaultRepo }) {
  const errors = []
  const comment = source.comment
  const findingId = authority.finding_ids[0]
  const expectedId = String(threadUrl ?? '').match(/#discussion_r([0-9]+)$/)?.[1] ?? null
  const prNumber = String(authority.pr).slice(1)
  if (!expectedId || String(comment.id) !== expectedId || comment.html_url !== threadUrl ||
      comment.user?.login !== 'boat1994' || comment.author_association !== 'OWNER' ||
      !String(comment.pull_request_url ?? '').endsWith(`/pulls/${prNumber}`)) {
    errors.push('pinned finding thread source metadata is missing or inconsistent')
  }
  const parsed = parseFindingFromThread(comment.body, findingId)
  if (!parsed || parsed.severity.toLowerCase() !== 'critical' || !parsed.canonical_summary) {
    errors.push('pinned finding thread does not preserve the immutable finding identity')
  }
  if (!String(comment.body ?? '').includes(findingId)) {
    errors.push('pinned finding thread content does not bind the finding ID')
  }
  return {
    ok: errors.length === 0,
    errors,
    finding: parsed
      ? {
          id: parsed.id,
          canonical_summary: parsed.canonical_summary,
          source_thread: threadUrl,
          required_evidence: [
            `Pinned S8 Founder decision ${authority.comment_id}`,
            `Specification RESULT ${authority.specification_result_comment_id}`,
            `Review 7 ${authority.review_7_verdict_comment_id}`,
            `Original finding thread ${expectedId}`,
            `Historical Review 3/HANDOFF ${authority.historical_handoff_comment_id}`,
          ],
          expected_areas: [],
          prohibited_areas: [],
        }
      : null,
  }
}

function reconcilePinnedCurrentPr({ authority, state, defaultRepo, fetchPrByReference, analyzeExactHeadCi, cwd, env }) {
  const prNumber = String(authority.pr).slice(1)
  const result = fetchPrByReference(cwd, `${defaultRepo}#${prNumber}`, env)
  if (!result.ok) return { ok: false, errors: [`live PR evidence is unavailable: ${result.reason}`] }
  const pr = result.pr
  const parsedUrl = parseCompleteGitHubPullUrl(String(pr?.url ?? ''))
  const errors = []
  if (!parsedUrl.ok || parsedUrl.identity.key !== `${defaultRepo.toLowerCase()}#${prNumber}`) {
    errors.push('live PR identity does not match current pinned authority')
  }
  if (pr?.headRefOid !== authority.correction_base || pr?.baseRefName !== state.approved_base || pr?.state !== 'OPEN' || pr?.isDraft !== true) {
    errors.push('live PR head, base, open state, or draft state does not match current pinned authority')
  }
  const ci = analyzeExactHeadCi(pr)
  if (!ci.exactHeadVerified) errors.push(`current authority requires successful exact-head CI (${ci.summary})`)
  return { ok: errors.length === 0, errors, pr }
}

/**
 * Transportless current-authority recovery: compile a source-bound contract from
 * independently pinned Spec RESULT, Review 7, original finding thread, S8, and
 * historical lineage evidence. Accepts no verdict transport and has no fallback.
 */
export function recoverCurrentAuthority({
  cwd,
  env,
  issueNumber,
  issueBody,
  comments,
  getDefaultRepo,
  fetchIssueCommentById,
  fetchPullReviewCommentById,
  fetchPrByReference,
  analyzeExactHeadCi,
}) {
  const parsed = parseMissionControlState(issueBody ?? '')
  const defaultRepo = getDefaultRepo(cwd)
  if (!parsed.valid || !parsed.state || !defaultRepo) return null
  const stateCheck = validateCurrentAuthorityState(parsed.state, issueNumber, defaultRepo)
  if (!stateCheck) return null
  if (!stateCheck.ok) return { ok: false, errors: stateCheck.errors }
  const { authority } = stateCheck

  const founderSource = fetchIssueCommentById(cwd, authority.comment_id, env)
  const handoffSource = fetchIssueCommentById(cwd, authority.historical_handoff_comment_id, env)
  const specSource = fetchIssueCommentById(cwd, authority.specification_result_comment_id, env)
  const reviewSevenSource = fetchIssueCommentById(cwd, authority.review_7_verdict_comment_id, env)
  if (!founderSource.ok || !handoffSource.ok || !specSource.ok || !reviewSevenSource.ok) {
    return { ok: false, errors: ['pinned authority source metadata is unavailable'] }
  }

  const founderCheck = validatePinnedFounderDecision({ authority, source: founderSource, issueNumber, defaultRepo })
  const historicalCheck = validateHistoricalAuthority({
    state: parsed.state,
    authority,
    comments,
    historicalHandoff: handoffSource,
    issueNumber,
    defaultRepo,
  })
  const specCheck = validatePinnedSpecificationResult({ authority, source: specSource, issueNumber, defaultRepo })
  const reviewSevenCheck = validatePinnedReview7({ authority, source: reviewSevenSource, issueNumber, defaultRepo })
  const prCheck = reconcilePinnedCurrentPr({
    cwd,
    env,
    authority,
    state: parsed.state,
    defaultRepo,
    fetchPrByReference,
    analyzeExactHeadCi,
  })

  const earlyErrors = [
    ...founderCheck.errors,
    ...historicalCheck.errors,
    ...specCheck.errors,
    ...reviewSevenCheck.errors,
    ...prCheck.errors,
  ]
  if (earlyErrors.length > 0 || !reviewSevenCheck.threadUrl) {
    return { ok: false, errors: earlyErrors.length > 0 ? earlyErrors : ['pinned Review 7 does not pin the original finding thread'] }
  }

  const threadId = reviewSevenCheck.threadUrl.match(/#discussion_r([0-9]+)$/)?.[1]
  const threadSource = fetchPullReviewCommentById(cwd, threadId, env)
  if (!threadSource.ok) {
    return { ok: false, errors: ['pinned finding thread source metadata is unavailable'] }
  }
  const threadCheck = validatePinnedFindingThread({
    authority,
    source: threadSource,
    threadUrl: reviewSevenCheck.threadUrl,
    defaultRepo,
  })
  if (!threadCheck.ok || !threadCheck.finding) {
    return { ok: false, errors: threadCheck.errors }
  }

  return {
    ok: true,
    contract: {
      mode: 'implementation_pr',
      reviewed_head: authority.correction_base,
      findings: [threadCheck.finding],
    },
    livePr: prCheck.pr,
  }
}
