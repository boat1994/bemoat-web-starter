/* eslint-disable @typescript-eslint/ban-ts-comment -- Cluster E oracle port preserves legacy .mjs implicit typing */
// @ts-nocheck
import { createHash } from 'node:crypto'

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

function normalizeQuotedReference(value) {
  return String(value ?? '').trim().replace(/^(["'])(.*)\1$/, '$2')
}

function sameTimestamp(left, right) {
  const leftTime = Date.parse(String(left ?? ''))
  const rightTime = Date.parse(String(right ?? ''))
  return !Number.isNaN(leftTime) && leftTime === rightTime
}

export function validateCurrentAuthorityState(state, issueNumber, defaultRepo) {
  const authority = state?.founder_migration_authority
  const postBudgetCount = Array.isArray(state.post_budget_reviews) ? state.post_budget_reviews.length : 0
  if (postBudgetCount < 4) return null
  if (!authority || typeof authority !== 'object' || Array.isArray(authority)) {
    return { ok: false, errors: ['STATE MIGRATION REQUIRED: post-budget authority evidence is missing'] }
  }
  const errors = []
  const postBudgetReviews = state.post_budget_reviews
  const historicalReview = state.post_budget_reviews?.find((review) => review.review_number === 7)
  const reviewEight = state.post_budget_reviews?.find((review) => review.review_number === 8)
  const expectedReviewNumbers = state.founder_review_8_correction_authorization ? [4, 5, 6, 7, 8] : [4, 5, 6, 7]
  if (state.review_cycle !== 3 || state.full_review_count !== 1 ||
      normalizeQuotedReference(state.active_task_issue) !== `#${issueNumber}` ||
      JSON.stringify(postBudgetReviews.map((review) => review.review_number)) !== JSON.stringify(expectedReviewNumbers)) {
    errors.push('STATE CONFLICT: post-budget authority does not preserve counters, issue identity, and Reviews 4-8')
  }
  if (authority.schema_version !== 3 || !['approved', 'consumed'].includes(authority.status) ||
      authority.authority !== 'Founder' || authority.scope !== 'correction') {
    errors.push('STATE CONFLICT: migration authority must be a valid Founder schema-version 3 correction authority')
  }
  if (authority.canonical_repository !== defaultRepo || authority.issue !== `#${issueNumber}` ||
      !/^#[1-9]\d*$/.test(String(authority.pr ?? ''))) {
    errors.push('STATE CONFLICT: migration authority does not bind the canonical repository, issue, and historical PR')
  }
  if (!/^[0-9a-f]{64}$/.test(String(authority.content_sha256 ?? '')) ||
      !/^[1-9]\d*$/.test(String(authority.comment_id ?? '')) ||
      !/^[1-9]\d*$/.test(String(authority.specification_result_comment_id ?? '')) ||
      !/^[1-9]\d*$/.test(String(authority.review_7_verdict_comment_id ?? '')) ||
      !/^[1-9]\d*$/.test(String(authority.historical_review_3_source_comment_id ?? '')) ||
      !/^[1-9]\d*$/.test(String(authority.historical_handoff_comment_id ?? ''))) {
    errors.push('STATE CONFLICT: migration authority is missing a pinned source ID or content hash')
  }
  if (!historicalReview || historicalReview.verdict_comment_id !== authority.review_7_verdict_comment_id ||
      historicalReview.reviewed_head !== authority.correction_base) {
    errors.push('STATE CONFLICT: migration authority does not bind the latest post-budget Review 7 lineage')
  }
  if (!Array.isArray(authority.finding_ids) || authority.finding_ids.length === 0 ||
      JSON.stringify(authority.finding_ids) !== JSON.stringify(authority.historical_finding_ids) ||
      JSON.stringify(authority.finding_ids) !== JSON.stringify(state.open_blockers) ||
      JSON.stringify(authority.finding_ids) !== JSON.stringify(historicalReview?.finding_dispositions?.map((entry) => entry.finding_id)) ||
      historicalReview?.finding_dispositions?.some((entry) => entry.disposition !== 'open')) {
    errors.push('STATE CONFLICT: migration authority does not preserve the exact open finding set')
  }
  if (postBudgetReviews.some((review) => review.authorization?.status !== 'approved' ||
      review.authorization?.authority !== 'Founder' || review.authorization?.scope !== 'review' ||
      review.authorization?.review_number !== review.review_number ||
      review.authorization?.reviewed_head !== review.reviewed_head ||
      !review.authorization?.action || !review.authorization?.authorized_at ||
      JSON.stringify(review.finding_dispositions?.map((entry) => entry.finding_id)) !== JSON.stringify(authority.finding_ids))) {
    errors.push('STATE CONFLICT: Reviews 4-7 do not preserve their Founder authorization and exact finding lineage')
  }
  const founderDecision = state.founder_decision
  if (!founderDecision || founderDecision.status !== 'approved' || founderDecision.authority !== 'Founder' ||
      founderDecision.scope !== 'correction' || founderDecision.for_review_number !== 7 ||
      founderDecision.reviewed_head !== authority.correction_base ||
      JSON.stringify(founderDecision.finding_ids) !== JSON.stringify(authority.finding_ids) ||
      !String(founderDecision.action ?? '').includes(authority.specification_result_comment_id) ||
      !founderDecision.authorized_at) {
    errors.push('STATE CONFLICT: Founder post-Review-7 decision does not bind the specification, head, and exact finding set')
  }
  const historical = state.founder_correction_authorization
  if (!historical || historical.schema_version !== 2 || historical.status !== 'consumed' ||
      historical.authority !== 'Founder' || historical.scope !== 'correction' || historical.for_review_number !== 3 ||
      historical.authorization_id !== authority.historical_authorization_id ||
      historical.reviewed_head !== authority.historical_reviewed_head ||
      historical.action !== authority.historical_action || historical.authorized_at !== authority.historical_authorized_at ||
      String(historical.handoff_comment_id) !== String(authority.historical_handoff_comment_id) ||
      JSON.stringify(historical.finding_ids) !== JSON.stringify(authority.historical_finding_ids)) {
    errors.push('STATE CONFLICT: migration authority does not bind the consumed historical Review 3 authorization')
  }

  if (authority.status === 'approved') {
    if (state.current_head !== authority.correction_base || state.active_pr !== authority.pr ||
        state.founder_base_change_decision || state.replacement_dispatch) {
      errors.push('STATE CONFLICT: approved migration authority is inconsistent with its pre-HANDOFF phase')
    }
    return { authority, phase: 'approved_unconsumed', ok: errors.length === 0, errors }
  }

  const decision = state.founder_base_change_decision
  const dispatch = state.replacement_dispatch
  if (!decision || !dispatch) {
    errors.push('BLOCKED_EXTERNAL: consumed historical migration authority has no active current dispatch')
    return { authority, phase: 'consumed_historical', ok: errors.length === 0, errors }
  }
  if (decision.status !== 'approved' || decision.authority !== 'Founder' || decision.old_pr !== authority.pr ||
      decision.old_base !== authority.correction_base ||
      decision.replacement_pr !== state.active_pr || decision.finding_scope !== authority.finding_ids[0] ||
      !/^[1-9]\d*$/.test(String(decision.source_comment_id ?? ''))) {
    errors.push('STATE CONFLICT: Founder base-change decision does not bind the historical authority and replacement PR')
  }
  if (dispatch.status !== 'active' || dispatch.target !== 'Dev / Correction Builder' ||
      String(dispatch.handoff_comment_id) !== String(decision.source_comment_id) ||
      dispatch.active_pr !== state.active_pr || dispatch.correction_base !== decision.new_correction_base ||
      JSON.stringify(dispatch.finding_ids) !== JSON.stringify(authority.finding_ids)) {
    errors.push('STATE CONFLICT: replacement dispatch does not bind the authorized replacement base, PR, target, and exact finding set')
  }
  const reviewEightAuthorization = state.founder_review_8_correction_authorization
  const correctionDispatch = state.correction_dispatch
  if (!reviewEightAuthorization && !correctionDispatch) {
    return { authority, decision, dispatch, phase: 'consumed_current_dispatch', ok: errors.length === 0, errors }
  }
  if (!reviewEightAuthorization || !correctionDispatch || !reviewEight) {
    errors.push('STATE CONFLICT: Review 8 correction authority, dispatch, and review evidence must be present together')
    return { authority, decision, dispatch, phase: 'consumed_current_dispatch', ok: false, errors }
  }
  if (reviewEightAuthorization.schema_version !== 1 || reviewEightAuthorization.status !== 'consumed' ||
      reviewEightAuthorization.authority !== 'Founder' || reviewEightAuthorization.scope !== 'correction' ||
      reviewEightAuthorization.for_review_number !== 8 || reviewEightAuthorization.reviewed_head !== reviewEight.reviewed_head ||
      reviewEightAuthorization.active_pr !== state.active_pr || reviewEightAuthorization.historical_correction_base !== authority.correction_base ||
      reviewEightAuthorization.authorized_replacement_base !== decision.new_correction_base ||
      reviewEightAuthorization.implementation_head !== dispatch.exact_head ||
      JSON.stringify(reviewEightAuthorization.finding_ids) !== JSON.stringify(authority.finding_ids) ||
      reviewEightAuthorization.review_8_verdict_comment_id !== reviewEight.verdict_comment_id ||
      reviewEightAuthorization.review_8_verdict_url !== reviewEight.verdict_url ||
      reviewEightAuthorization.review_9_authorized !== false ||
      !/^[1-9]\d*$/.test(String(reviewEightAuthorization.handoff_comment_id ?? '')) ||
      !String(reviewEightAuthorization.handoff_url ?? '').endsWith('#issuecomment-' + reviewEightAuthorization.handoff_comment_id) ||
      !reviewEightAuthorization.authorized_at || !reviewEightAuthorization.consumed_at ||
      !String(reviewEightAuthorization.action ?? '').includes(authority.finding_ids[0])) {
    errors.push('STATE CONFLICT: Review 8 correction authority does not independently bind the historical base, replacement base, implementation head, and review evidence')
  }
  if (correctionDispatch.status !== 'active' || correctionDispatch.target !== 'Dev / Correction Builder' ||
      String(correctionDispatch.handoff_comment_id) !== String(reviewEightAuthorization.handoff_comment_id) ||
      correctionDispatch.active_pr !== state.active_pr ||
      correctionDispatch.branch !== reviewEightAuthorization.branch ||
      correctionDispatch.historical_correction_base !== authority.correction_base ||
      correctionDispatch.authorized_replacement_base !== decision.new_correction_base ||
      correctionDispatch.implementation_head !== state.current_head ||
      correctionDispatch.review_number !== 8 ||
      JSON.stringify(correctionDispatch.finding_ids) !== JSON.stringify(authority.finding_ids)) {
    errors.push('STATE CONFLICT: current correction dispatch does not independently bind the implementation head and all authority identities')
  }
  return {
    authority,
    decision,
    dispatch,
    reviewEightAuthorization,
    correctionDispatch,
    phase: 'consumed_review_eight_dispatch',
    ok: errors.length === 0,
    errors,
  }
}

export function validateReplacementDispatchSource({ authority, decision, dispatch, comments, issueNumber, defaultRepo }) {
  const errors = []
  const comment = findExactlyOnePinnedComment(comments, dispatch.handoff_comment_id)
  const body = String(comment?.body ?? '')
  if (!comment || comment.author !== 'boat1994' ||
      String(comment.url ?? '').toLowerCase() !==
        `https://github.com/${defaultRepo}/issues/${issueNumber}#issuecomment-${dispatch.handoff_comment_id}`.toLowerCase()) {
    errors.push('STATE CONFLICT: current replacement HANDOFF source identity is missing or inconsistent')
  }
  const requiredValues = [
    '## HANDOFF',
    '**Target:** Dev / Correction Builder',
    `**Repository:** \`${defaultRepo}\``,
    `**Issue:** #${issueNumber}`,
    `**Superseded PR:** ${authority.pr}`,
    `**Exact correction base:** \`${dispatch.correction_base}\``,
    `**Finding scope:** exactly \`${authority.finding_ids[0]}\``,
    `**Founder migration authority:** ${authority.comment_id}`,
    `**Specification RESULT:** ${authority.specification_result_comment_id}`,
    `**Review 7 verdict:** ${authority.review_7_verdict_comment_id}`,
    '**Historical Review 3 evidence:** consumed lineage evidence only',
    '**Review 8:** No Review 8 is authorized or started',
  ]
  for (const value of requiredValues) {
    if (!body.includes(value)) errors.push(`STATE CONFLICT: current replacement HANDOFF is missing semantic binding ${value}`)
  }
  if (!String(decision.action ?? '').includes(authority.pr) ||
      !String(decision.action ?? '').includes(dispatch.correction_base) ||
      !String(decision.action ?? '').includes(authority.finding_ids[0])) {
    errors.push('STATE CONFLICT: Founder base-change action does not bind the old PR, current head, and finding')
  }
  return { ok: errors.length === 0, errors }
}

export function validateReviewEightCorrectionSource({ authorization, source, state, issueNumber, defaultRepo }) {
  const errors = []
  const comment = source.comment
  const binding = authorization.canonical_handoff_source_binding
  const expectedUrl = 'https://github.com/' + defaultRepo + '/issues/' + issueNumber + '#issuecomment-' + authorization.handoff_comment_id
  const body = String(comment?.body ?? '')
  if (!sameTimestamp(authorization.authorized_at, authorization.consumed_at) ||
      binding?.schema_version !== 1 ||
      String(binding?.comment_id) !== String(authorization.handoff_comment_id) ||
      binding?.url !== expectedUrl || binding?.author_login !== 'boat1994' || binding?.author_association !== 'OWNER' ||
      binding?.canonical_repository !== defaultRepo || binding?.issue !== '#' + issueNumber ||
      binding?.pr !== authorization.active_pr || binding?.exact_head !== state.current_head ||
      JSON.stringify(binding?.finding_ids) !== JSON.stringify(authorization.finding_ids) ||
      !/^[0-9a-f]{64}$/.test(String(binding?.content_sha256 ?? '')) ||
      String(comment?.id) !== String(binding?.comment_id) || comment?.html_url !== binding?.url ||
      comment?.user?.login !== binding?.author_login || comment?.author_association !== binding?.author_association ||
      createHash('sha256').update(body).digest('hex') !== binding?.content_sha256 ||
      !sameTimestamp(comment?.created_at, binding?.created_at) ||
      !sameTimestamp(comment?.updated_at, binding?.updated_at)) {
    errors.push('STATE CONFLICT: Review 8 correction HANDOFF source identity or timestamp is inconsistent')
  }
  const requiredValues = [
    '## HANDOFF',
    'Dev / Correction Builder',
    '#'+ String(authorization.active_pr).slice(1),
    authorization.historical_correction_base,
    authorization.authorized_replacement_base,
    authorization.implementation_head,
    authorization.finding_ids[0],
    'No Review 9',
  ]
  for (const value of requiredValues) {
    if (!body.includes(value)) errors.push('STATE CONFLICT: Review 8 correction HANDOFF is missing required topology binding ' + value)
  }
  return { ok: errors.length === 0, errors }
}

export function validatePinnedFounderDecision({ authority, source, issueNumber, defaultRepo }) {
  const errors = []
  const comment = source.comment
  const expectedUrl = `https://github.com/${defaultRepo}/issues/${issueNumber}#issuecomment-${authority.comment_id}`
  if (String(comment.id) !== String(authority.comment_id) || comment.html_url !== expectedUrl ||
      comment.user?.login !== authority.author_login || comment.author_association !== authority.author_association ||
      comment.created_at !== authority.created_at || comment.updated_at !== authority.updated_at) {
    errors.push('STATE CONFLICT: pinned Founder decision source metadata does not match state')
  }
  if (createHash('sha256').update(comment.body ?? '').digest('hex') !== authority.content_sha256) {
    errors.push('STATE CONFLICT: pinned Founder decision content hash does not match state')
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
        errors.push('STATE CONFLICT: pinned Founder decision Approved action does not bind the finding and correction base')
      }
    } else if (sourceValue !== String(expected)) {
      errors.push(`STATE CONFLICT: pinned Founder decision ${label} does not match state`)
    }
  }
  if (!matchesPinnedList(sourceField(comment.body, 'Finding IDs'), authority.finding_ids) ||
      !matchesPinnedList(sourceField(comment.body, 'Historical finding IDs'), authority.historical_finding_ids)) {
    errors.push('STATE CONFLICT: pinned Founder decision finding IDs do not match state')
  }
  return { ok: errors.length === 0, errors }
}

export function validateHistoricalAuthority({ state, authority, comments, historicalHandoff, historicalReviewThree, issueNumber, defaultRepo }) {
  const errors = []
  const historical = state.founder_correction_authorization
  const reviewThree = findExactlyOnePinnedComment(comments, authority.historical_review_3_source_comment_id)
  const expectedHandoffUrl = `https://github.com/${defaultRepo}/issues/${issueNumber}#issuecomment-${authority.historical_handoff_comment_id}`
  if (!historical || historical.authorization_id !== authority.historical_authorization_id ||
      historical.reviewed_head !== authority.historical_reviewed_head || historical.action !== authority.historical_action ||
      historical.authorized_at !== authority.historical_authorized_at || historical.handoff_comment_id !== authority.historical_handoff_comment_id ||
      JSON.stringify(historical.finding_ids) !== JSON.stringify(authority.historical_finding_ids)) {
    errors.push('STATE CONFLICT: historical Review 3 authorization does not match the pinned migration authority')
  }
  if (!reviewThree || !String(reviewThree.url ?? '').endsWith(`#issuecomment-${authority.historical_review_3_source_comment_id}`)) {
    errors.push('STATE CONFLICT: pinned historical Review 3 source identity is missing or inconsistent')
  }
  const reviewThreeComment = historicalReviewThree.comment
  const reviewThreeBody = String(reviewThreeComment?.body ?? '')
  if (String(reviewThreeComment?.id) !== String(authority.historical_review_3_source_comment_id) ||
      !/^##\s+REVIEW_VERDICT\s*$/m.test(reviewThreeBody) ||
      !reviewThreeBody.includes('Phase: Bounded Delta Review 3') ||
      !reviewThreeBody.includes('BLOCKED FOR FOUNDER DECISION') ||
      !reviewThreeBody.includes(`/pull/${String(authority.pr).slice(1)}`) ||
      !reviewThreeBody.includes(authority.historical_reviewed_head) ||
      !authority.historical_finding_ids.every((findingId) => reviewThreeBody.includes(findingId)) ||
      !/Do not start Review 4/i.test(reviewThreeBody)) {
    errors.push('STATE CONFLICT: pinned historical Review 3 source is semantically inconsistent')
  }
  const handoff = historicalHandoff.comment
  const handoffBody = String(handoff?.body ?? '')
  if (String(handoff.id) !== String(authority.historical_handoff_comment_id) || handoff.html_url !== expectedHandoffUrl ||
      handoff.user?.login !== 'boat1994' || handoff.author_association !== 'OWNER' ||
      historical.handoff_url !== expectedHandoffUrl || !handoffBody.match(/^##\s+HANDOFF\s*$/m)) {
    errors.push('STATE CONFLICT: pinned historical HANDOFF source identity is missing or inconsistent')
  }

  const binding = historical?.handoff_binding
  const phase = handoffBody.match(/^\* Phase:\s*(.+)$/m)?.[1]?.trim() ?? null
  const target = handoffBody.match(/^\*\*Target:\*\*\s*(.+)$/m)?.[1]?.trim() ?? null
  const scope = handoffBody.match(/^\*\*Scope:\*\*\s*(.+)$/m)?.[1]?.trim() ?? null
  const taskIssue = handoffBody.match(/^\* Task \/ Issue:\s*(#[1-9]\d*)$/m)?.[1] ?? null
  const heads = [...new Set([...handoffBody.matchAll(/\bPR head\s+`([0-9a-f]{40})`/gi)].map((match) => match[1]))]
  const prs = [...new Set([...handoffBody.matchAll(/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/gi)]
    .map((match) => `${match[1]}#${match[2]}`))]
  const findings = [...new Set(handoffBody.match(/MC-R[0-9A-Za-z-]+/g) ?? [])]
  const correctionScope = scope && /Bind the planning contract/i.test(scope) && /canonical repository/i.test(scope) &&
    /protected branch/i.test(scope) && /preserve/i.test(scope)
  if (phase !== 'Founder-authorized correction after Review 3' || target !== 'Dev / Correction Builder' ||
      !correctionScope || taskIssue !== `#${issueNumber}` ||
      JSON.stringify(heads) !== JSON.stringify([authority.historical_reviewed_head]) ||
      JSON.stringify(prs) !== JSON.stringify([`${defaultRepo}#${String(authority.pr).slice(1)}`]) ||
      JSON.stringify(findings) !== JSON.stringify(authority.historical_finding_ids) ||
      !/prohibition on Review 4/i.test(handoffBody) || !/Do not[^\n.]*start Review 4/i.test(handoffBody)) {
    errors.push('STATE CONFLICT: historical HANDOFF Phase, Target, Scope, issue, PR, head, finding set, or Review 4 prohibition is inconsistent')
  }

  const expectedSnapshot = {
    authorization_id: historical.authorization_id,
    authority: 'Founder',
    status: 'authorized',
    action: historical.action,
    authorized_at: historical.authorized_at,
    scope: 'correction',
    for_review_number: 3,
    reviewed_head: historical.reviewed_head,
    finding_ids: historical.finding_ids,
  }
  const expectedBinding = {
    authorization_id: historical.authorization_id,
    target: 'Dev / Correction Builder',
    active_pr: authority.pr,
    exact_head: historical.reviewed_head,
    correction_base: historical.reviewed_head,
    review_number: 3,
    scope: 'correction',
    finding_ids: historical.finding_ids,
    handoff_comment_id: String(authority.historical_handoff_comment_id),
    handoff_created_at: handoff.created_at,
    handoff_updated_at: handoff.updated_at,
  }
  if (!binding || JSON.stringify(binding.authorization_snapshot) !== JSON.stringify(expectedSnapshot) ||
      Object.entries(expectedBinding).some(([key, value]) => JSON.stringify(binding[key]) !== JSON.stringify(value))) {
    errors.push('STATE CONFLICT: historical HANDOFF binding does not preserve the complete authorization semantics and timestamps')
  } else {
    if (binding.content_sha256 !== createHash('sha256').update(handoffBody).digest('hex')) {
      errors.push('STATE CONFLICT: historical HANDOFF content hash does not match the pinned source')
    }
    const { binding_sha256: recordedFingerprint, ...bindingPayload } = binding
    if (recordedFingerprint !== createHash('sha256').update(JSON.stringify(bindingPayload)).digest('hex')) {
      errors.push('STATE CONFLICT: historical HANDOFF binding fingerprint is invalid')
    }
  }
  return { ok: errors.length === 0, errors }
}
