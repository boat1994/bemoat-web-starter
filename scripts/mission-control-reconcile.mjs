#!/usr/bin/env node

const PRE_DELIVERY_STATES = new Set(['READY', 'IN_PROGRESS'])
const CORE_VERDICTS = new Set([
  'CORRECTION REQUIRED',
  'ELIGIBLE FOR FOUNDER REVIEW',
  'BLOCKED FOR FOUNDER DECISION',
  'BLOCKED EXTERNAL',
  'STATE CONFLICT',
])

const VERDICT_TO_STATE = {
  'CORRECTION REQUIRED': {
    1: 'CORRECTION_REQUIRED_1',
    2: 'CORRECTION_REQUIRED_2',
  },
  'ELIGIBLE FOR FOUNDER REVIEW': 'ELIGIBLE_FOR_FOUNDER_REVIEW',
  'BLOCKED FOR FOUNDER DECISION': 'BLOCKED_FOR_FOUNDER_DECISION',
  'BLOCKED EXTERNAL': 'BLOCKED_EXTERNAL',
  'STATE CONFLICT': 'STATE_CONFLICT',
}

const REPAIR_OUTCOMES = new Set([
  'DETERMINISTIC_MIGRATION',
  'BOOKKEEPING_REPAIR',
  'TERMINAL_REPAIR',
])

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function hasLegacyManagedState(state = {}) {
  return (
    Object.hasOwn(state, 'post_budget_review_history') ||
    Object.hasOwn(state, 'founder_authorization') ||
    Object.hasOwn(state, 'founder_correction_authorization')
  )
}

/**
 * Exhaustive, ordered reconciliation classification. Only contradictory live
 * authority is a conflict; schema and bookkeeping lag remain repairable.
 */
export function classifyReconciliation(evidence = {}) {
  if (evidence.requiredEvidenceUnavailable) {
    return { outcome: 'BLOCKED_EXTERNAL', reason: 'required live evidence is unavailable' }
  }
  if (
    evidence.authoritativeContradiction ||
    evidence.competingPrs ||
    evidence.headMismatch ||
    evidence.staleCi
  ) {
    return { outcome: 'STATE_CONFLICT', reason: 'authoritative live evidence contradicts' }
  }

  const terminal = evidence.terminal ?? {}
  if (terminal.issueClosed && terminal.prMerged && terminal.reviewedHeadMatches) {
    if (evidence.managedState?.state === 'DONE') {
      return { outcome: 'NO_OP', reason: 'terminal evidence already recorded' }
    }
    return { outcome: 'TERMINAL_REPAIR', reason: 'terminal bookkeeping lags live merge evidence' }
  }

  if (hasLegacyManagedState(evidence.managedState)) {
    return { outcome: 'DETERMINISTIC_MIGRATION', reason: 'legacy managed-state representation is unambiguous' }
  }
  if (evidence.bookkeepingProposal) {
    const proposed = { ...(evidence.managedState ?? {}), ...evidence.bookkeepingProposal }
    if (sameValue(proposed, evidence.managedState ?? {})) {
      return { outcome: 'NO_OP', reason: 'bookkeeping evidence is already recorded' }
    }
    return { outcome: 'BOOKKEEPING_REPAIR', reason: 'unambiguous live evidence is ahead of bookkeeping' }
  }
  return { outcome: 'NO_OP', reason: 'no authoritative evidence changed' }
}

/**
 * Convert the Issue #155 legacy post-budget fields to their canonical shape.
 * Superseded keys are removed only from the proposed replacement state; the
 * caller owns the single durable write and verification.
 */
export function migrateLegacyManagedState(managedState = {}) {
  if (!hasLegacyManagedState(managedState)) {
    return { changed: false, state: managedState }
  }

  const state = structuredClone(managedState)
  const history = Array.isArray(state.post_budget_review_history)
    ? state.post_budget_review_history
    : []
  const legacyReviewAuthorization = state.founder_authorization

  if (!Array.isArray(state.post_budget_reviews)) {
    state.post_budget_reviews = history.map((entry) => ({
      ...entry,
      authorization:
        entry.authorization ??
        (legacyReviewAuthorization?.review_number === entry.review_number &&
        legacyReviewAuthorization?.reviewed_head === entry.reviewed_head
          ? structuredClone(legacyReviewAuthorization)
          : null),
    }))
  }

  if (!state.founder_decision && state.founder_correction_authorization) {
    state.founder_decision = structuredClone(state.founder_correction_authorization)
  }

  delete state.post_budget_review_history
  delete state.founder_authorization
  delete state.founder_correction_authorization

  if (state.state === 'STATE_CONFLICT') {
    state.state = state.founder_decision ? 'IN_PROGRESS' : 'BLOCKED_FOR_FOUNDER_DECISION'
  }

  return { changed: true, state }
}

function proposedRepair(evidence, classification) {
  const migrated = migrateLegacyManagedState(evidence.managedState ?? {}).state
  if (classification.outcome === 'TERMINAL_REPAIR') {
    return {
      ...migrated,
      state: 'DONE',
      merged_commit_sha: evidence.terminal?.mergeCommit ?? migrated.merged_commit_sha ?? null,
      open_blockers: [],
      next_permitted_action: 'none on this task',
    }
  }
  if (classification.outcome === 'BOOKKEEPING_REPAIR') {
    return { ...migrated, ...evidence.bookkeepingProposal }
  }
  return migrated
}

/**
 * Run at most one deterministic repair and one live verification. A second
 * repair is never attempted in the same run.
 */
export async function runBoundedReconciliation({ readEvidence, writeState }) {
  const measurements = {
    coordination_runs: 1,
    state_writes: 0,
    role_comments: 0,
    model_required_stages: 0,
    reconciliation_attempts: 0,
    false_state_conflicts: 0,
  }

  const initialEvidence = await readEvidence()
  measurements.reconciliation_attempts += 1
  const initial = classifyReconciliation(initialEvidence)
  if (!REPAIR_OUTCOMES.has(initial.outcome)) {
    return { ...initial, finalOutcome: initial.outcome, measurements }
  }

  await writeState(proposedRepair(initialEvidence, initial))
  measurements.state_writes += 1

  const verifiedEvidence = await readEvidence()
  measurements.reconciliation_attempts += 1
  const verified = classifyReconciliation(verifiedEvidence)
  return {
    ...initial,
    finalOutcome: verified.outcome,
    finalReason: verified.reason,
    measurements,
  }
}

/**
 * Transactional READY -> IN_PROGRESS dispatch with compensating rollback.
 * The caller supplies durable Issue and role-comment operations so this logic
 * remains testable and transport-agnostic.
 */
export async function dispatchManagedTask({ readState, writeState, postHandoff, handoffBody, transitionState }) {
  const original = await readState()
  if (original?.state !== 'READY') {
    throw new Error(`dispatch requires READY, received ${original?.state ?? 'missing state'}`)
  }
  if (!/^## HANDOFF\s*$/m.test(handoffBody ?? '')) {
    throw new Error('dispatch requires one HANDOFF role comment')
  }

  const defaultTransition = (state) => ({ ...structuredClone(state), state: 'IN_PROGRESS' })
  const dispatched = (transitionState ?? defaultTransition)(original)
  await writeState(dispatched)
  try {
    await postHandoff(handoffBody)
  } catch (error) {
    const live = await readState()
    if (!sameValue(live, dispatched)) {
      throw new Error('dispatch failed and concurrent state change prevented rollback', { cause: error })
    }
    await writeState(original)
    throw new Error('dispatch rolled back after HANDOFF failure', { cause: error })
  }

  const verified = await readState()
  if (!sameValue(verified, dispatched)) {
    throw new Error('dispatch verification found a concurrent state change')
  }
  return { outcome: 'DISPATCHED', state: verified }
}

/**
 * @param {string} body
 */
export function parseRoleCommentBody(body = '') {
  const heading = body.match(/^##\s+(HANDOFF|RESULT|REVIEW_VERDICT)\s*$/m)?.[1] ?? null
  if (!heading) {
    return { role: null, body, prNumber: null, headSha: null, verdict: null, managedStateLine: null }
  }

  const prFromUrl = body.match(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/(\d+)/)?.[1] ?? null
  const prFromHash = body.match(/\bPR\s*#(\d+)\b/i)?.[1] ?? null
  const headFromState = body.match(/\*\*State:\*\*[^\n]*head\s+`([0-9a-f]{7,40})`/i)?.[1] ?? null
  const headFromPrLine = body.match(/\*\*PR\s*\/\s*base\s*\/\s*head:\*\*[^\n]*·\s*`([0-9a-f]{7,40})`/i)?.[1] ?? null
  const headFromExact = body.match(/\*\*Exact head reviewed:\*\*\s*`([0-9a-f]{7,40})`/i)?.[1] ?? null
  const headSha =
    headFromState ||
    headFromPrLine ||
    headFromExact ||
    (body.match(/head\s+`([0-9a-f]{7,40})`/i)?.[1] ?? null)
  const verdict = body.match(/^\*\*Verdict:\*\*\s*(.+?)\s*$/m)?.[1]?.trim() ?? null
  const managedStateLine = body.match(/^\*\*Managed state:\*\*\s*(.+?)\s*$/m)?.[1]?.trim() ?? null

  return {
    role: heading,
    body,
    prNumber: prFromUrl || prFromHash,
    headSha,
    verdict,
    managedStateLine,
  }
}

/**
 * @param {Array<{ body?: string, createdAt?: string }>} comments
 * @param {'RESULT' | 'REVIEW_VERDICT'} role
 */
export function findLatestRoleComment(comments = [], role) {
  const matches = comments
    .map((comment) => ({ comment, parsed: parseRoleCommentBody(comment.body ?? '') }))
    .filter((entry) => entry.parsed.role === role)

  if (matches.length === 0) return null

  matches.sort((left, right) => {
    const leftTime = Date.parse(left.comment.createdAt ?? '') || 0
    const rightTime = Date.parse(right.comment.createdAt ?? '') || 0
    return rightTime - leftTime
  })

  return matches[0]
}

export function classifyDeliveryLag(managedState, livePr, exactHeadCi, latestResult = null) {
  if (!managedState?.state || !PRE_DELIVERY_STATES.has(managedState.state)) {
    return { lag: false, kind: null, reason: 'state is not pre-delivery' }
  }

  const stalePointers =
    managedState.active_pr == null ||
    managedState.current_head == null ||
    managedState.state !== 'AWAITING_REVIEW_1'

  if (!stalePointers) {
    return { lag: false, kind: null, reason: 'delivery state already recorded' }
  }

  if (!livePr?.number || !livePr.headRefOid) {
    return { lag: true, kind: 'INCOMPLETE_DELIVERY', reason: 'missing live PR evidence' }
  }

  const resultPr = latestResult?.parsed?.prNumber ?? null
  if (latestResult && !resultPr) {
    return { lag: false, kind: 'STATE_CONFLICT', reason: 'RESULT PR identifier missing' }
  }
  if (resultPr && String(resultPr) !== String(livePr.number)) {
    return { lag: false, kind: 'STATE_CONFLICT', reason: 'RESULT PR does not match live PR' }
  }

  const resultHead = latestResult?.parsed?.headSha ?? null
  const headsAlign =
    !resultHead || resultHead === livePr.headRefOid || resultHead.startsWith(livePr.headRefOid.slice(0, 7))

  if (!headsAlign) {
    return { lag: false, kind: 'STATE_CONFLICT', reason: 'RESULT head does not match live PR head' }
  }

  if (exactHeadCi && exactHeadCi.exactHeadVerified === false) {
    return { lag: true, kind: 'INCOMPLETE_DELIVERY', reason: 'exact-head CI not verified' }
  }

  if (!latestResult) {
    return { lag: true, kind: 'INCOMPLETE_DELIVERY', reason: 'delivery RESULT not found' }
  }

  return { lag: true, kind: 'DETERMINISTIC_RECONCILIATION', reason: 'unambiguous delivery evidence' }
}

export function classifyReviewLag(managedState, livePr, latestVerdict = null) {
  if (!managedState?.state || !latestVerdict?.parsed?.verdict) {
    return { lag: false, kind: null, reason: 'no review verdict evidence' }
  }

  const awaitingStates = /^AWAITING_REVIEW_\d+$/
  const correctionStates = /^CORRECTION_REQUIRED_\d+$/
  const verdict = latestVerdict.parsed.verdict
  const reviewedHead = latestVerdict.parsed.headSha

  if (!CORE_VERDICTS.has(verdict)) {
    return { lag: false, kind: 'STATE_CONFLICT', reason: 'invalid review verdict enum' }
  }

  const verdictPr = latestVerdict.parsed.prNumber ?? null
  if (livePr?.number && !verdictPr) {
    return { lag: false, kind: 'STATE_CONFLICT', reason: 'REVIEW_VERDICT PR identifier missing' }
  }
  if (verdictPr && livePr?.number && String(verdictPr) !== String(livePr.number)) {
    return { lag: false, kind: 'STATE_CONFLICT', reason: 'REVIEW_VERDICT PR does not match live PR' }
  }

  if (reviewedHead && livePr?.headRefOid && reviewedHead !== livePr.headRefOid) {
    return { lag: false, kind: 'STATE_CONFLICT', reason: 'verdict head does not match live PR head' }
  }

  const expectedState = resolveVerdictState(verdict, managedState.review_cycle ?? 0)
  if (managedState.state === expectedState && managedState.last_reviewed_head === reviewedHead) {
    return { lag: false, kind: null, reason: 'review state already recorded' }
  }

  if (awaitingStates.test(managedState.state) || correctionStates.test(managedState.state)) {
    return { lag: true, kind: 'DETERMINISTIC_RECONCILIATION', reason: 'post-review bookkeeping lag' }
  }

  return { lag: false, kind: null, reason: 'state does not indicate review lag' }
}

export function classifyMergeDrift(authorizedHead, liveHead) {
  if (!authorizedHead || !liveHead) {
    return { drift: true, reason: 'missing authorized or live head for merge transition' }
  }
  if (authorizedHead !== liveHead) {
    return { drift: true, reason: 'authorized merge head does not match live PR head' }
  }
  return { drift: false, reason: null }
}

export function isGenuineStateConflict(evidence = {}) {
  if (evidence.competingPrs) return true
  if (evidence.headMismatch) return true
  if (evidence.staleCi) return true
  if ((evidence.stateConflictBlockers ?? []).some((blocker) => blocker.includes('STATE_CONFLICT'))) {
    return true
  }
  return false
}

export function proposeDeliveryReconciliation(evidence) {
  const prNumber = String(evidence.livePr.number)
  const head = evidence.latestResult?.parsed?.headSha || evidence.livePr.headRefOid
  const approvedBase = evidence.approvedBase || evidence.livePr.baseRefName || 'main'

  return {
    state: 'AWAITING_REVIEW_1',
    review_cycle: 0,
    full_review_count: 0,
    approved_base: approvedBase,
    active_task_issue: evidence.activeTaskIssue ? `"#${evidence.activeTaskIssue}"` : null,
    active_pr: `"#${prNumber}"`,
    current_head: head,
    last_reviewed_head: null,
    next_permitted_action: `Reviewer performs bounded Review 1 on PR #${prNumber} at exact head ${head}.`,
    material_change_status: 'none',
  }
}

export function resolveVerdictState(verdict, currentReviewCycle = 0) {
  if (verdict === 'CORRECTION REQUIRED') {
    const nextCycle = Math.min(currentReviewCycle + 1, 3)
    return VERDICT_TO_STATE['CORRECTION REQUIRED'][nextCycle] ?? 'STATE_CONFLICT'
  }
  return VERDICT_TO_STATE[verdict] ?? 'STATE_CONFLICT'
}

export function proposeReviewReconciliation(input) {
  const reviewCycle = input.reviewCycle ?? 0

  if (input.verdict === 'CORRECTION REQUIRED' && reviewCycle >= 2) {
    return {
      state: 'STATE_CONFLICT',
      review_cycle: reviewCycle,
      full_review_count: Math.min(input.fullReviewCount ?? 0, 1),
      last_reviewed_head: input.reviewedHead,
      next_permitted_action: 'Mission Control must classify contradictory evidence.',
    }
  }

  const nextCycle = Math.min(reviewCycle + 1, 3)
  
  let currentFull = input.fullReviewCount ?? 0
  const nextFullReviewCount = Math.min(currentFull + (reviewCycle === 0 ? 1 : 0), 1)

  return {
    state: resolveVerdictState(input.verdict, reviewCycle),
    review_cycle: nextCycle,
    full_review_count: nextFullReviewCount,
    last_reviewed_head: input.reviewedHead,
    next_permitted_action: nextActionForVerdict(input.verdict, nextCycle),
  }
}

function nextActionForVerdict(verdict, reviewCycle) {
  if (verdict === 'CORRECTION REQUIRED') {
    return `Dev posts correction ## RESULT, then Review ${Math.min(reviewCycle + 1, 3)} on the corrected head.`
  }
  if (verdict === 'ELIGIBLE FOR FOUNDER REVIEW') {
    return 'Founder merge authorization required before merge.'
  }
  if (verdict === 'BLOCKED FOR FOUNDER DECISION') {
    return 'Founder Approve or Decline on remaining Blocker/Critical; no implementation prompt until Approve.'
  }
  if (verdict === 'BLOCKED EXTERNAL') {
    return 'Resolve external blocker before continuing.'
  }
  return 'Mission Control must classify contradictory evidence.'
}

export function founderMergeTransitionAuthorized({ mergeAuthorized = false, migrationAuthorized = false, deployAuthorized = false } = {}) {
  return {
    mergeAllowed: mergeAuthorized,
    migrationAllowed: migrationAuthorized,
    deployAllowed: deployAuthorized,
    boundedSequence: mergeAuthorized && !migrationAuthorized && !deployAuthorized,
  }
}

export function analyzeReconciliation(context) {
  const terminalEvidence = context.terminal ?? null
  const genuineConflict = isGenuineStateConflict({
    stateConflictBlockers: context.stateConflictBlockers,
    headMismatch: Boolean(
      !terminalEvidence?.prMerged &&
      context.managedState?.current_head &&
        context.livePr?.headRefOid &&
        context.managedState.current_head !== context.livePr.headRefOid,
    ),
    staleCi: context.exactHeadCi?.exactHeadVerified === false && context.exactHeadCi?.olderShaSuccess === true,
  })

  const deliveryLag = classifyDeliveryLag(
    context.managedState,
    context.livePr,
    context.exactHeadCi,
    context.latestResult,
  )
  const reviewLag = classifyReviewLag(context.managedState, context.livePr, context.latestVerdict)

  let bookkeepingProposal = null
  let bookkeepingType = null
  if (deliveryLag.kind === 'DETERMINISTIC_RECONCILIATION' && context.livePr) {
    bookkeepingType = 'delivery'
    bookkeepingProposal = proposeDeliveryReconciliation({
      livePr: context.livePr,
      activeTaskIssue: context.activeTaskIssue,
      approvedBase: context.managedState?.approved_base,
      latestResult: context.latestResult,
    })
  } else if (reviewLag.kind === 'DETERMINISTIC_RECONCILIATION' && context.latestVerdict?.parsed?.verdict) {
    bookkeepingType = 'review'
    bookkeepingProposal = proposeReviewReconciliation({
      verdict: context.latestVerdict.parsed.verdict,
      reviewedHead: context.latestVerdict.parsed.headSha || context.livePr?.headRefOid,
      reviewCycle: context.managedState?.review_cycle ?? 0,
      fullReviewCount: context.managedState?.full_review_count ?? 0,
    })
  }

  const classification = classifyReconciliation({
    authoritativeContradiction: genuineConflict,
    requiredEvidenceUnavailable: context.requiredEvidenceUnavailable,
    managedState: context.managedState,
    terminal: terminalEvidence,
    bookkeepingProposal,
  })

  const result = {
    genuineConflict,
    classification,
    delivery: deliveryLag,
    review: reviewLag,
    proposal: null,
  }

  if (classification.outcome === 'STATE_CONFLICT' || classification.outcome === 'BLOCKED_EXTERNAL') {
    return result
  }

  if (classification.outcome === 'TERMINAL_REPAIR') {
    result.proposal = {
      type: 'terminal',
      fields: proposedRepair(context, classification),
    }
  } else if (classification.outcome === 'DETERMINISTIC_MIGRATION') {
    result.proposal = {
      type: 'migration',
      fields: migrateLegacyManagedState(context.managedState).state,
    }
  } else if (classification.outcome === 'BOOKKEEPING_REPAIR' && bookkeepingType) {
    result.proposal = {
      type: bookkeepingType,
      fields: bookkeepingProposal,
    }
  }

  return result
}
