import { createHash } from 'node:crypto'
import { parseMissionControlState } from '../mission-control/domain/task-state.ts'
import type {
  AuthorityRecord,
  CurrentAuthorityStateCheck,
  IssueCommentFetchSuccess,
  PostBudgetReviewRecord,
  ReviewEightAuthorizationRecord,
  ValidationResult,
} from './authority-domain-types.ts'
import {
  asAuthorityRecord,
  asDecisionRecord,
  asDispatchRecord,
  asReviewEightAuthorizationRecord,
  isPlainObject,
  readLegacyField,
} from './authority-domain-types.ts'

type MissionControlStateValue = NonNullable<ReturnType<typeof parseMissionControlState>['state']>

function sourceField(body: string | null | undefined, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = String(body ?? '').match(new RegExp('^-\\s+\\*\\*' + escaped + ':\\*\\*\\s*`?(.+?)`?\\s*$', 'm'))
  return match?.[1]?.trim().replace(/^`|`$/g, '') ?? null
}

function matchesPinnedList(value: unknown, expected: string[]): boolean {
  const ids = String(value ?? '').match(/[A-Za-z0-9][A-Za-z0-9_-]*/g) ?? []
  return JSON.stringify(ids) === JSON.stringify(expected)
}

function normalizeQuotedReference(value: unknown): string {
  return String(value ?? '').trim().replace(/^(["'])(.*)\1$/, '$2')
}

function sameTimestamp(left: unknown, right: unknown): boolean {
  const leftTime = Date.parse(String(left ?? ''))
  const rightTime = Date.parse(String(right ?? ''))
  return !Number.isNaN(leftTime) && leftTime === rightTime
}

export function validateCurrentAuthorityState(
  state: MissionControlStateValue,
  issueNumber: number,
  defaultRepo: string,
): CurrentAuthorityStateCheck | ValidationResult | null {
  const authorityRaw = state.founder_migration_authority
  const postBudgetCount = Array.isArray(state.post_budget_reviews) ? state.post_budget_reviews.length : 0
  if (postBudgetCount < 4) return null
  if (!authorityRaw || !isPlainObject(authorityRaw)) {
    return { ok: false, errors: ['STATE MIGRATION REQUIRED: post-budget authority evidence is missing'] }
  }
  const authority = asAuthorityRecord(authorityRaw)
  const errors: string[] = []
  const postBudgetReviews: PostBudgetReviewRecord[] = Array.isArray(state.post_budget_reviews)
    ? state.post_budget_reviews.filter(isPlainObject)
    : []
  const historicalReview = postBudgetReviews.find((review) => review.review_number === 7)
  const reviewEight = postBudgetReviews.find((review) => review.review_number === 8)
  const expectedReviewNumbers = state.founder_review_8_correction_authorization ? [4, 5, 6, 7, 8] : [4, 5, 6, 7]
  if (state.review_cycle !== 3 || state.full_review_count !== 1 ||
      normalizeQuotedReference(state.active_task_issue) !== `#${issueNumber}` ||
      JSON.stringify(postBudgetReviews.map((review) => review.review_number)) !== JSON.stringify(expectedReviewNumbers)) {
    errors.push('STATE CONFLICT: post-budget authority does not preserve counters, issue identity, and Reviews 4-8')
  }
  if (authority.schema_version !== 3 || !['approved', 'consumed'].includes(String(authority.status ?? '')) ||
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
  const founderDecisionValue = state.founder_decision
  if (!founderDecisionValue || readLegacyField(founderDecisionValue, 'status') !== 'approved' ||
      readLegacyField(founderDecisionValue, 'authority') !== 'Founder' ||
      readLegacyField(founderDecisionValue, 'scope') !== 'correction' || readLegacyField(founderDecisionValue, 'for_review_number') !== 7 ||
      readLegacyField(founderDecisionValue, 'reviewed_head') !== authority.correction_base ||
      JSON.stringify(readLegacyField(founderDecisionValue, 'finding_ids')) !== JSON.stringify(authority.finding_ids) ||
      !String(readLegacyField(founderDecisionValue, 'action') ?? '').includes(String(authority.specification_result_comment_id)) ||
      !readLegacyField(founderDecisionValue, 'authorized_at')) {
    errors.push('STATE CONFLICT: Founder post-Review-7 decision does not bind the specification, head, and exact finding set')
  }
  const historicalValue = state.founder_correction_authorization
  if (!historicalValue || readLegacyField(historicalValue, 'schema_version') !== 2 || readLegacyField(historicalValue, 'status') !== 'consumed' ||
      readLegacyField(historicalValue, 'authority') !== 'Founder' || readLegacyField(historicalValue, 'scope') !== 'correction' ||
      readLegacyField(historicalValue, 'for_review_number') !== 3 ||
      readLegacyField(historicalValue, 'authorization_id') !== authority.historical_authorization_id ||
      readLegacyField(historicalValue, 'reviewed_head') !== authority.historical_reviewed_head ||
      readLegacyField(historicalValue, 'action') !== authority.historical_action ||
      readLegacyField(historicalValue, 'authorized_at') !== authority.historical_authorized_at ||
      String(readLegacyField(historicalValue, 'handoff_comment_id')) !== String(authority.historical_handoff_comment_id) ||
      JSON.stringify(readLegacyField(historicalValue, 'finding_ids')) !== JSON.stringify(authority.historical_finding_ids)) {
    errors.push('STATE CONFLICT: migration authority does not bind the consumed historical Review 3 authorization')
  }

  if (authority.status === 'approved') {
    if (state.current_head !== authority.correction_base || state.active_pr !== authority.pr ||
        state.founder_base_change_decision || state.replacement_dispatch) {
      errors.push('STATE CONFLICT: approved migration authority is inconsistent with its pre-HANDOFF phase')
    }
    return { authority, phase: 'approved_unconsumed', ok: errors.length === 0, errors }
  }

  const decisionValue = state.founder_base_change_decision
  const dispatchValue = state.replacement_dispatch
  if (!decisionValue || !dispatchValue) {
    errors.push('BLOCKED_EXTERNAL: consumed historical migration authority has no active current dispatch')
    return { authority, phase: 'consumed_historical', ok: errors.length === 0, errors }
  }
  if (readLegacyField(decisionValue, 'status') !== 'approved' || readLegacyField(decisionValue, 'authority') !== 'Founder' ||
      readLegacyField(decisionValue, 'old_pr') !== authority.pr ||
      readLegacyField(decisionValue, 'old_base') !== authority.correction_base ||
      readLegacyField(decisionValue, 'replacement_pr') !== state.active_pr ||
      readLegacyField(decisionValue, 'finding_scope') !== authority.finding_ids?.[0] ||
      !/^[1-9]\d*$/.test(String(readLegacyField(decisionValue, 'source_comment_id') ?? ''))) {
    errors.push('STATE CONFLICT: Founder base-change decision does not bind the historical authority and replacement PR')
  }
  if (readLegacyField(dispatchValue, 'status') !== 'active' || readLegacyField(dispatchValue, 'target') !== 'Dev / Correction Builder' ||
      String(readLegacyField(dispatchValue, 'handoff_comment_id')) !== String(readLegacyField(decisionValue, 'source_comment_id')) ||
      readLegacyField(dispatchValue, 'active_pr') !== state.active_pr ||
      readLegacyField(dispatchValue, 'correction_base') !== readLegacyField(decisionValue, 'new_correction_base') ||
      JSON.stringify(readLegacyField(dispatchValue, 'finding_ids')) !== JSON.stringify(authority.finding_ids)) {
    errors.push('STATE CONFLICT: replacement dispatch does not bind the authorized replacement base, PR, target, and exact finding set')
  }
  const decision = isPlainObject(decisionValue) ? asDecisionRecord(decisionValue) : undefined
  const dispatch = isPlainObject(dispatchValue) ? asDispatchRecord(dispatchValue) : undefined
  const reviewEightAuthorizationValue = state.founder_review_8_correction_authorization
  const correctionDispatchValue = state.correction_dispatch
  if (!reviewEightAuthorizationValue && !correctionDispatchValue) {
    return { authority, decision, dispatch, phase: 'consumed_current_dispatch', ok: errors.length === 0, errors }
  }
  if (!reviewEightAuthorizationValue || !correctionDispatchValue || !reviewEight) {
    errors.push('STATE CONFLICT: Review 8 correction authority, dispatch, and review evidence must be present together')
    return { authority, decision, dispatch, phase: 'consumed_current_dispatch', ok: false, errors }
  }
  if (readLegacyField(reviewEightAuthorizationValue, 'schema_version') !== 1 ||
      readLegacyField(reviewEightAuthorizationValue, 'status') !== 'consumed' ||
      readLegacyField(reviewEightAuthorizationValue, 'authority') !== 'Founder' ||
      readLegacyField(reviewEightAuthorizationValue, 'scope') !== 'correction' ||
      readLegacyField(reviewEightAuthorizationValue, 'for_review_number') !== 8 ||
      readLegacyField(reviewEightAuthorizationValue, 'reviewed_head') !== reviewEight.reviewed_head ||
      readLegacyField(reviewEightAuthorizationValue, 'active_pr') !== state.active_pr ||
      readLegacyField(reviewEightAuthorizationValue, 'historical_correction_base') !== authority.correction_base ||
      readLegacyField(reviewEightAuthorizationValue, 'authorized_replacement_base') !== readLegacyField(decisionValue, 'new_correction_base') ||
      readLegacyField(reviewEightAuthorizationValue, 'implementation_head') !== readLegacyField(dispatchValue, 'exact_head') ||
      JSON.stringify(readLegacyField(reviewEightAuthorizationValue, 'finding_ids')) !== JSON.stringify(authority.finding_ids) ||
      readLegacyField(reviewEightAuthorizationValue, 'review_8_verdict_comment_id') !== reviewEight.verdict_comment_id ||
      readLegacyField(reviewEightAuthorizationValue, 'review_8_verdict_url') !== reviewEight.verdict_url ||
      readLegacyField(reviewEightAuthorizationValue, 'review_9_authorized') !== false ||
      !/^[1-9]\d*$/.test(String(readLegacyField(reviewEightAuthorizationValue, 'handoff_comment_id') ?? '')) ||
      !String(readLegacyField(reviewEightAuthorizationValue, 'handoff_url') ?? '').endsWith(
        '#issuecomment-' + readLegacyField(reviewEightAuthorizationValue, 'handoff_comment_id'),
      ) ||
      !readLegacyField(reviewEightAuthorizationValue, 'authorized_at') || !readLegacyField(reviewEightAuthorizationValue, 'consumed_at') ||
      !String(readLegacyField(reviewEightAuthorizationValue, 'action') ?? '').includes(String(authority.finding_ids?.[0] ?? ''))) {
    errors.push('STATE CONFLICT: Review 8 correction authority does not independently bind the historical base, replacement base, implementation head, and review evidence')
  }
  if (readLegacyField(correctionDispatchValue, 'status') !== 'active' ||
      readLegacyField(correctionDispatchValue, 'target') !== 'Dev / Correction Builder' ||
      String(readLegacyField(correctionDispatchValue, 'handoff_comment_id')) !==
        String(readLegacyField(reviewEightAuthorizationValue, 'handoff_comment_id')) ||
      readLegacyField(correctionDispatchValue, 'active_pr') !== state.active_pr ||
      readLegacyField(correctionDispatchValue, 'branch') !== readLegacyField(reviewEightAuthorizationValue, 'branch') ||
      readLegacyField(correctionDispatchValue, 'historical_correction_base') !== authority.correction_base ||
      readLegacyField(correctionDispatchValue, 'authorized_replacement_base') !== readLegacyField(decisionValue, 'new_correction_base') ||
      readLegacyField(correctionDispatchValue, 'implementation_head') !== state.current_head ||
      readLegacyField(correctionDispatchValue, 'review_number') !== 8 ||
      JSON.stringify(readLegacyField(correctionDispatchValue, 'finding_ids')) !== JSON.stringify(authority.finding_ids)) {
    errors.push('STATE CONFLICT: current correction dispatch does not independently bind the implementation head and all authority identities')
  }
  const reviewEightAuthorization = isPlainObject(reviewEightAuthorizationValue)
    ? asReviewEightAuthorizationRecord(reviewEightAuthorizationValue)
    : undefined
  const correctionDispatch = isPlainObject(correctionDispatchValue)
    ? asDispatchRecord(correctionDispatchValue)
    : undefined
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

export function validateReviewEightCorrectionSource({
  authorization,
  source,
  state,
  issueNumber,
  defaultRepo,
}: {
  authorization: ReviewEightAuthorizationRecord
  source: IssueCommentFetchSuccess | null
  state: MissionControlStateValue
  issueNumber: number
  defaultRepo: string
}): ValidationResult {
  const errors: string[] = []
  if (!source) {
    return { ok: false, errors: ['STATE CONFLICT: Review 8 correction HANDOFF source identity or timestamp is inconsistent'] }
  }
  const comment = source.comment
  const bindingValue = authorization.canonical_handoff_source_binding
  const binding = isPlainObject(bindingValue) ? bindingValue : null
  const expectedUrl = 'https://github.com/' + defaultRepo + '/issues/' + issueNumber + '#issuecomment-' + authorization.handoff_comment_id
  const body = String(comment?.body ?? '')
  if (!sameTimestamp(authorization.authorized_at, authorization.consumed_at) ||
      readLegacyField(binding, 'schema_version') !== 1 ||
      String(readLegacyField(binding, 'comment_id')) !== String(authorization.handoff_comment_id) ||
      readLegacyField(binding, 'url') !== expectedUrl || readLegacyField(binding, 'author_login') !== 'boat1994' ||
      readLegacyField(binding, 'author_association') !== 'OWNER' ||
      readLegacyField(binding, 'canonical_repository') !== defaultRepo || readLegacyField(binding, 'issue') !== '#' + issueNumber ||
      readLegacyField(binding, 'pr') !== authorization.active_pr || readLegacyField(binding, 'exact_head') !== state.current_head ||
      JSON.stringify(readLegacyField(binding, 'finding_ids')) !== JSON.stringify(authorization.finding_ids) ||
      !/^[0-9a-f]{64}$/.test(String(readLegacyField(binding, 'content_sha256') ?? '')) ||
      String(comment?.id) !== String(readLegacyField(binding, 'comment_id')) ||
      comment?.html_url !== readLegacyField(binding, 'url') ||
      comment?.user?.login !== readLegacyField(binding, 'author_login') ||
      comment?.author_association !== readLegacyField(binding, 'author_association') ||
      createHash('sha256').update(body).digest('hex') !== readLegacyField(binding, 'content_sha256') ||
      !sameTimestamp(comment?.created_at, readLegacyField(binding, 'created_at')) ||
      !sameTimestamp(comment?.updated_at, readLegacyField(binding, 'updated_at'))) {
    errors.push('STATE CONFLICT: Review 8 correction HANDOFF source identity or timestamp is inconsistent')
  }
  const requiredValues = [
    '## HANDOFF',
    'Dev / Correction Builder',
    '#'+ String(authorization.active_pr ?? '').slice(1),
    String(authorization.historical_correction_base ?? ''),
    String(authorization.authorized_replacement_base ?? ''),
    String(authorization.implementation_head ?? ''),
    String(authorization.finding_ids?.[0] ?? ''),
    'No Review 9',
  ]
  for (const value of requiredValues) {
    if (!body.includes(value)) errors.push('STATE CONFLICT: Review 8 correction HANDOFF is missing required topology binding ' + value)
  }
  return { ok: errors.length === 0, errors }
}

export function validatePinnedFounderDecision({
  authority,
  source,
  issueNumber,
  defaultRepo,
}: {
  authority: AuthorityRecord
  source: IssueCommentFetchSuccess
  issueNumber: number
  defaultRepo: string
}): ValidationResult {
  const errors: string[] = []
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
  const fields: Array<[string, string | number]> = [
    ['Canonical repository', authority.canonical_repository ?? ''],
    ['Repository ID', authority.repository_id ?? ''],
    ['Issue', authority.issue ?? ''],
    ['PR', authority.pr ?? ''],
    ['Specification RESULT comment', authority.specification_result_comment_id ?? ''],
    ['Review 7 verdict comment', authority.review_7_verdict_comment_id ?? ''],
    ['Correction base', authority.correction_base ?? ''],
    ['Historical Review 3 authority source comment', authority.historical_review_3_source_comment_id ?? ''],
    ['Historical HANDOFF comment', authority.historical_handoff_comment_id ?? ''],
    ['Historical authorization ID', authority.historical_authorization_id ?? ''],
    ['Historical reviewed head', authority.historical_reviewed_head ?? ''],
    ['Historical action', authority.historical_action ?? ''],
    ['Historical authorization timestamp', authority.historical_authorized_at ?? ''],
    ['Approved action', authority.approved_action ?? ''],
  ]
  for (const [label, expected] of fields) {
    const sourceValue = sourceField(comment.body, label)
    if (label === 'Approved action') {
      if (!sourceValue?.includes(String(authority.finding_ids?.[0] ?? '')) || !sourceValue.includes(String(authority.correction_base ?? ''))) {
        errors.push('STATE CONFLICT: pinned Founder decision Approved action does not bind the finding and correction base')
      }
    } else if (sourceValue !== String(expected)) {
      errors.push(`STATE CONFLICT: pinned Founder decision ${label} does not match state`)
    }
  }
  if (!matchesPinnedList(sourceField(comment.body, 'Finding IDs'), authority.finding_ids ?? []) ||
      !matchesPinnedList(sourceField(comment.body, 'Historical finding IDs'), authority.historical_finding_ids ?? [])) {
    errors.push('STATE CONFLICT: pinned Founder decision finding IDs do not match state')
  }
  return { ok: errors.length === 0, errors }
}
