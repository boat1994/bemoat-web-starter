#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { parseCorrectionContract } from './correction-contract.mjs'
import { writeIssueBodyWithLease } from './mission-control-issue-body-cas.mjs'
import { populateOrPreservePlanningAuthorizationBaseSha, projectMissionControlStateBlock } from './mission-control-state.mjs'

const PRE_DELIVERY_STATES = new Set(['READY', 'IN_PROGRESS', 'CORRECTION_REQUIRED_1', 'CORRECTION_REQUIRED_2'])
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
  const canonicalize = (value) => {
    if (Array.isArray(value)) return value.map(canonicalize)
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
      )
    }
    return value
  }
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right))
}

function hasLegacyManagedState(state = {}) {
  return (
    Object.hasOwn(state, 'post_budget_review_history') ||
    Object.hasOwn(state, 'founder_authorization') ||
    (state.state === 'STATE_MIGRATION_REQUIRED' && state.review_cycle === 3 &&
      state.full_review_count === 1 && (Object.hasOwn(state, 'founder_decision') ||
        Object.hasOwn(state, 'founder_correction_authorization')))
  )
}

function isReviewThreeCorrectionAuthorization(authorization, state) {
  return authorization &&
    authorization.status === 'approved' && authorization.authority === 'Founder' &&
    authorization.scope === 'correction' && authorization.for_review_number === 3 &&
    typeof authorization.reviewed_head === 'string' && authorization.reviewed_head.length > 0 &&
    authorization.reviewed_head === state.last_reviewed_head &&
    authorization.reviewed_head === state.current_head &&
    Array.isArray(authorization.finding_ids) && authorization.finding_ids.length > 0 &&
    authorization.finding_ids.every((id) => typeof id === 'string' && id.length > 0) &&
    typeof authorization.action === 'string' && authorization.action.length > 0 &&
    typeof authorization.authorized_at === 'string' && authorization.authorized_at.length > 0
}

function correctionAuthorizationId(authorization) {
  return `founder-r3-${authorization.reviewed_head.slice(0, 12)}-${authorization.authorized_at}`
    .replace(/[^a-zA-Z0-9_-]/g, '-')
}

function validateReviewThreeLegacyLineage(state, authorization) {
  if (!Array.isArray(state.finding_lineage) || state.finding_lineage.length === 0) {
    throw new Error('Review 3 Founder correction migration requires complete finding_lineage')
  }
  const authorizedIds = [...authorization.finding_ids].sort()
  const openLineage = state.finding_lineage.filter((finding) => finding?.disposition === 'open')
  const lineageIds = openLineage.map((finding) => finding?.finding_id).sort()
  if (!sameValue(authorizedIds, lineageIds)) {
    throw new Error('Review 3 Founder correction migration finding lineage does not match Founder authority')
  }
  for (const finding of openLineage) {
    if (typeof finding.finding_id !== 'string' || !finding.finding_id ||
        typeof finding.source_thread !== 'string' || !finding.source_thread ||
        typeof finding.evidence !== 'string' || !finding.evidence ||
        !Array.isArray(finding.required_correction_evidence) || finding.required_correction_evidence.length === 0 ||
        finding.required_correction_evidence.some((entry) => typeof entry !== 'string' || !entry)) {
      throw new Error(`Review 3 Founder correction migration has incomplete evidence for ${finding?.finding_id ?? 'unknown finding'}`)
    }
  }
}

/**
 * Exhaustive, ordered reconciliation classification. Only contradictory live
 * authority is a conflict; schema and bookkeeping lag remain repairable.
 */
export function classifyReconciliation(evidence = {}) {
  if (evidence.classification) return evidence.classification
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
  if (
    terminal.prMerged && !terminal.issueClosed &&
    terminal.reviewedHeadMatches && terminal.currentHeadMatches &&
    typeof terminal.mergeCommit === 'string' && terminal.mergeCommit.length > 0 &&
    terminal.exactHeadCi === true
  ) {
    return {
      outcome: 'STATE_CONFLICT',
      reason: 'merged PR is verified but the managed Issue remains open; merge transport must close the Issue before terminal reconciliation',
    }
  }
  if (terminal.prMerged && (
    !terminal.issueClosed ||
    !terminal.reviewedHeadMatches ||
    !terminal.currentHeadMatches ||
    typeof terminal.mergeCommit !== 'string' || terminal.mergeCommit.length === 0 ||
    terminal.exactHeadCi !== true
  )) {
    return { outcome: 'STATE_CONFLICT', reason: 'terminal evidence is incomplete or does not bind the reviewed head' }
  }
  if (terminal.issueClosed && terminal.prMerged && terminal.reviewedHeadMatches && terminal.currentHeadMatches && terminal.mergeCommit && terminal.exactHeadCi) {
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
  if (Object.hasOwn(state, 'post_budget_review_history') && !Array.isArray(state.post_budget_review_history)) {
    throw new Error('legacy post_budget_review_history must be an array')
  }
  const history = state.post_budget_review_history ?? []
  const legacyReviewAuthorization = state.founder_authorization
  const legacyCorrectionAuthorization = state.state === 'STATE_MIGRATION_REQUIRED' &&
    state.review_cycle === 3 && state.full_review_count === 1
    ? (state.founder_decision ?? state.founder_correction_authorization)
    : state.founder_correction_authorization

  if (Object.hasOwn(state, 'post_budget_reviews') && !Array.isArray(state.post_budget_reviews)) {
    throw new Error('canonical post_budget_reviews must be an array')
  }
  const normalizeReview = (entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error('post-budget review entries must be mappings')
    }
    return {
      ...structuredClone(entry),
      authorization:
        entry.authorization ??
        (legacyReviewAuthorization?.review_number === entry.review_number &&
        legacyReviewAuthorization?.reviewed_head === entry.reviewed_head
          ? structuredClone(legacyReviewAuthorization)
          : null),
    }
  }
  const reviewsByNumber = new Map()
  for (const entry of [...(state.post_budget_reviews ?? []), ...history]) {
    const normalized = normalizeReview(entry)
    const existing = reviewsByNumber.get(normalized.review_number)
    if (existing && !sameValue(existing, normalized)) {
      throw new Error(`contradictory post-budget review ${normalized.review_number}`)
    }
    reviewsByNumber.set(normalized.review_number, normalized)
  }
  if (reviewsByNumber.size > 0) {
    state.post_budget_reviews = [...reviewsByNumber.values()].sort((left, right) => left.review_number - right.review_number)
  }

  if (
    state.state === 'STATE_MIGRATION_REQUIRED' &&
    state.review_cycle === 3 && state.full_review_count === 1 &&
    (state.post_budget_reviews ?? []).length === 0 && history.length === 0 &&
    isReviewThreeCorrectionAuthorization(legacyCorrectionAuthorization, state)
  ) {
    validateReviewThreeLegacyLineage(state, legacyCorrectionAuthorization)
    state.state = 'FOUNDER_AUTHORIZED_CORRECTION'
    state.founder_correction_authorization = {
      ...structuredClone(legacyCorrectionAuthorization),
      schema_version: 2,
      authorization_id: correctionAuthorizationId(legacyCorrectionAuthorization),
      status: 'authorized',
    }
  } else if (!state.founder_decision && state.founder_correction_authorization) {
    state.founder_decision = structuredClone(state.founder_correction_authorization)
  }

  if (state.state === 'STATE_CONFLICT') {
    const latestReview = state.post_budget_reviews?.at(-1) ?? null
    const decision = state.founder_decision
    const validCorrection =
      latestReview &&
      decision?.status === 'approved' &&
      decision?.authority === 'Founder' &&
      decision?.scope === 'correction' &&
      decision?.for_review_number === latestReview.review_number &&
      decision?.reviewed_head === latestReview.reviewed_head &&
      Array.isArray(decision?.finding_ids) && decision.finding_ids.length > 0 &&
      decision.finding_ids.every((id) => latestReview.finding_dispositions?.some((finding) => finding.finding_id === id))
    if (decision && !validCorrection) {
      throw new Error('invalid Founder correction authorization cannot grant IN_PROGRESS')
    }
    state.state = validCorrection ? 'IN_PROGRESS' : 'BLOCKED_FOR_FOUNDER_DECISION'
  }

  for (const review of state.post_budget_reviews ?? []) {
    if (review.authorization?.status !== 'approved' || review.authorization?.authority !== 'Founder' ||
      review.authorization?.scope !== 'review' || review.authorization?.review_number !== review.review_number ||
      review.authorization?.reviewed_head !== review.reviewed_head) {
      throw new Error(`invalid Founder review authorization for Review ${review.review_number}`)
    }
  }

  // The complete canonical representation is proven before any legacy key is removed.
  delete state.post_budget_review_history
  delete state.founder_authorization
  if (state.state === 'FOUNDER_AUTHORIZED_CORRECTION') delete state.founder_decision
  if (state.state !== 'FOUNDER_AUTHORIZED_CORRECTION') delete state.founder_correction_authorization

  return { changed: true, state }
}

/**
 * Preserve a planning-only task while the canonical guide changes. This is a
 * migration projection, not implementation authority: the planning RESULT,
 * ancestry baseline, counters, and null PR/head fields remain immutable.
 */
export function isSeparatePlanningImplementationAuthorization({
  authorization,
  managedState,
  repository = null,
} = {}) {
  if (!authorization || typeof authorization !== 'object' || Array.isArray(authorization)) return false
  const issueNumber = String(managedState?.active_task_issue ?? '').match(/#?(\d+)$/)?.[1] ?? null
  const expectedBaseline = managedState?.planning_authorization_base_sha
  return authorization.status === 'approved' &&
    authorization.authority === 'Founder' &&
    authorization.scope === 'implementation' &&
    authorization.action === 'implement' &&
    String(authorization.task_issue ?? '') === String(issueNumber) &&
    (!repository || authorization.repository === repository) &&
    authorization.base === managedState?.approved_base &&
    authorization.planning_baseline_sha === expectedBaseline &&
    managedState?.workflow_mode === 'planning_no_pr' &&
    managedState?.active_pr == null &&
    managedState?.current_head == null &&
    managedState?.last_reviewed_head == null
}

/**
 * Migrate a planning-only task such as Issue #248 onto a newer merged guide.
 * The function deliberately refuses to normalize an implementation-shaped
 * state or to infer implementation approval from the planning RESULT.
 */
export function migratePlanningOnlyTaskState({
  managedState,
  issueNumber,
  resultCommentId,
  planningBaselineSha,
  guideVersion,
  policySourceSha = null,
  implementationAuthorization = null,
  repository = null,
} = {}) {
  if (!managedState || typeof managedState !== 'object' || Array.isArray(managedState)) {
    throw new Error('STATE_MIGRATION_REQUIRED: planning task state is missing')
  }
  const expectedIssue = String(issueNumber ?? '')
  if (!/^\d+$/.test(expectedIssue) || !/^[0-9a-f]{40}$/i.test(String(planningBaselineSha ?? ''))) {
    throw new Error('STATE_MIGRATION_REQUIRED: planning migration requires an exact Issue and baseline SHA')
  }
  if (managedState.state !== 'BLOCKED_FOR_FOUNDER_DECISION' ||
      managedState.workflow_mode !== 'planning_no_pr' ||
      managedState.review_cycle !== 0 || managedState.full_review_count !== 0 ||
      managedState.active_pr !== null || managedState.current_head !== null || managedState.last_reviewed_head !== null ||
      managedState.active_task_issue !== `#${expectedIssue}` ||
      managedState.planning_authorization_base_sha !== planningBaselineSha ||
      String(managedState.latest_result_comment_id) !== String(resultCommentId)) {
    throw new Error('STATE_CONFLICT: planning migration evidence does not preserve the exact planning RESULT, baseline, counters, mode, or null PR/head')
  }
  if (implementationAuthorization && !isSeparatePlanningImplementationAuthorization({
    authorization: implementationAuthorization,
    managedState,
    repository,
  })) {
    throw new Error('STATE_CONFLICT: planning migration cannot infer implementation approval from a mismatched Founder decision')
  }

  const nextState = {
    ...structuredClone(managedState),
    guide_version: guideVersion,
    guide_source_sha: policySourceSha ?? managedState.guide_source_sha,
    next_permitted_action: 'Separate Founder implementation approval is required for the bounded implementation plan before any HANDOFF.',
  }
  const implementationApproved = isSeparatePlanningImplementationAuthorization({
    authorization: implementationAuthorization,
    managedState: nextState,
    repository,
  })
  return {
    changed: JSON.stringify(nextState) !== JSON.stringify(managedState),
    state: nextState,
    implementationApprovalRequired: !implementationApproved,
  }
}

function proposedRepair(evidence, classification) {
  if (evidence.proposedState) {
    // Bookkeeping deltas must merge onto the live managed state so additive
    // fields (for example planning_authorization_base_sha) are preserved.
    return {
      ...structuredClone(evidence.managedState ?? {}),
      ...structuredClone(evidence.proposedState),
    }
  }
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
    return {
      ...initial,
      finalOutcome: initial.outcome,
      finalReason: initial.reason,
      measurements,
    }
  }

  let proposed
  try {
    proposed = proposedRepair(initialEvidence, initial)
  } catch (error) {
    return {
      ...initial,
      finalOutcome: 'STATE_CONFLICT',
      finalReason: error instanceof Error ? error.message : String(error),
      measurements,
    }
  }
  const written = await writeState(proposed, initialEvidence.managedState)
  if (!sameValue(written, proposed)) {
    throw new Error('durable reconciliation write was not confirmed')
  }
  measurements.state_writes += 1

  const verifiedEvidence = await readEvidence()
  measurements.reconciliation_attempts += 1
  const verified = classifyReconciliation(verifiedEvidence)
  const verificationStillRequestsRepair = REPAIR_OUTCOMES.has(verified.outcome)
  return {
    ...initial,
    finalOutcome: verificationStillRequestsRepair ? 'STATE_CONFLICT' : verified.outcome,
    finalReason: verificationStillRequestsRepair
      ? 'bounded repair was not confirmed by the single verification'
      : verified.reason,
    measurements,
  }
}

/**
 * Transactional READY -> IN_PROGRESS dispatch with compensating rollback.
 * The caller supplies durable Issue and role-comment operations so this logic
 * remains testable and transport-agnostic.
 */
export async function dispatchManagedTask({ readState, writeState, postHandoff, retractHandoff, handoffBody, transitionState }) {
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
  if (!sameValue(await readState(), dispatched)) {
    throw new Error('dispatch verification found a concurrent state change before HANDOFF')
  }
  let handoff = null
  try {
    handoff = await postHandoff(handoffBody)
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
    if (!retractHandoff || !handoff) {
      throw new Error('dispatch verification found a concurrent state change and cannot retract HANDOFF')
    }
    await retractHandoff(handoff)
    throw new Error('dispatch verification found a concurrent state change')
  }
  return { outcome: 'DISPATCHED', state: verified }
}

/**
 * Atomically consumes the one Founder authority granted after normal Review 3.
 * The durable authorization is bound to the concrete HANDOFF comment identifier;
 * a failed state write retracts that comment instead of allowing replay.
 */
function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

const ROLE_MARKERS = new Set(['HANDOFF', 'RESULT', 'REVIEW_VERDICT'])

/**
 * @param {string} body
 * @returns {'HANDOFF' | 'RESULT' | 'REVIEW_VERDICT' | null}
 */
export function parseCommentMarker(body = '') {
  const match = body.match(/^##\s+(HANDOFF|RESULT|REVIEW_VERDICT)\s*$/m)
  const marker = match?.[1] ?? null
  return marker && ROLE_MARKERS.has(marker) ? marker : null
}

/**
 * @param {string} body
 * @param {{ taskId?: string, phase?: string, role?: string }} [overrides]
 */
export function normalizeTransitionIdentity(body = '', overrides = {}) {
  const role = overrides.role ?? parseCommentMarker(body) ?? ''
  const taskId = overrides.taskId ??
    body.match(/\*\*Task(?:\s*\/\s*Issue)?:\*\*\s*#?(\d+)/i)?.[1] ??
    body.match(/Task\s*\/\s*Issue:\s*#?(\d+)/i)?.[1] ?? ''
  const phase = overrides.phase ??
    body.match(/\*\*Phase:\*\*\s*(.+?)\s*$/m)?.[1]?.trim() ??
    body.match(/Phase:\s*(.+?)$/m)?.[1]?.trim() ?? ''
  const normalizedContent = body
    .replace(/^### Task log[\s\S]*?(?=\n\*\*|\n##|$)/m, '')
    .replace(/^- Timestamp:.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
  return {
    taskId: String(taskId),
    phase,
    role,
    contentHash: sha256(normalizedContent),
  }
}

export function serializeTransitionIdentity(identity) {
  return JSON.stringify({
    taskId: identity.taskId,
    phase: identity.phase,
    role: identity.role,
    contentHash: identity.contentHash,
  })
}

export function transitionIdentityMatches(left, right) {
  return serializeTransitionIdentity(left) === serializeTransitionIdentity(right)
}

/**
 * @param {number} matchCount
 * @returns {'BLOCKED_EXTERNAL' | 'STATE_CONFLICT' | 'RESUME_PROJECTION'}
 */
export function classifyTransition(matchCount) {
  if (matchCount === 0) return 'BLOCKED_EXTERNAL'
  if (matchCount > 1) return 'STATE_CONFLICT'
  return 'RESUME_PROJECTION'
}

/**
 * Explicit non-authoritative / superseded role-comment markers. Shared with
 * projection semantics so historical comments do not compete with active authority.
 */
export function isExplicitlyNonAuthoritativeRoleBody(body = '') {
  return (
    /\[(?:diagnostic|stale|superseded)\]/i.test(body) ||
    (/\b(?:hereby\s+)?superseded\b/i.test(body) && /\bnot\s+authorized\b/i.test(body)) ||
    /\bnot\s+authoritative\b/i.test(body) ||
    /^\[Superseded (?:HANDOFF|RESULT|REVIEW_VERDICT) comment\./i.test(body)
  )
}

/**
 * Select active, non-superseded comments for a role. Historical superseded
 * comments remain visible but are not competing authority.
 */
export function selectActiveRoleComments(comments = [], role) {
  return comments.filter((comment) => {
    const body = comment?.body ?? ''
    if (parseCommentMarker(body) !== role) return false
    return !isExplicitlyNonAuthoritativeRoleBody(body)
  })
}

function headsAlign(left, right) {
  if (!left || !right) return true
  return left === right || left.startsWith(right.slice(0, 7)) || right.startsWith(left.slice(0, 7))
}

export const DEFAULT_MC_TRUSTED_ASSOCIATIONS = Object.freeze([
  'OWNER',
  'MEMBER',
  'COLLABORATOR',
])

/**
 * Production trust filter for authoritative Mission Control role comments.
 * Override authors with `BEMOAT_MC_TRUSTED_AUTHORS` (comma-separated).
 *
 * @param {{ env?: NodeJS.ProcessEnv, trustedAuthors?: string[] | null, trustedAssociations?: string[] | null }} [input]
 */
export function resolveProductionCommentTrust({
  env = process.env,
  trustedAuthors = null,
  trustedAssociations = null,
} = {}) {
  const fromEnv = String(env.BEMOAT_MC_TRUSTED_AUTHORS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const defaultAuthor = env.GITHUB_REPOSITORY_OWNER || 'boat1994'
  return {
    trustedAuthors: trustedAuthors?.length
      ? trustedAuthors
      : (fromEnv.length ? fromEnv : [defaultAuthor]),
    requireTrustedAuthor: true,
    trustedAssociations: trustedAssociations?.length
      ? trustedAssociations
      : [...DEFAULT_MC_TRUSTED_ASSOCIATIONS],
  }
}

/**
 * @param {Array<{ body?: string, id?: string | number, author?: string, user?: { login?: string }, author_association?: string }>} comments
 * @param {{ taskId: string, phase: string, role: string, contentHash: string }} identity
 * @param {{
 *   activeOnly?: boolean,
 *   bindings?: { prNumber?: string | number | null, headSha?: string | null, taskId?: string | null, phase?: string | null },
 *   trustedAuthors?: string[],
 *   requireTrustedAuthor?: boolean,
 *   trustedAssociations?: string[],
 * }} [options]
 */
export function findMatchingComments(comments = [], identity, options = {}) {
  const pool = options.activeOnly === false
    ? comments
    : selectActiveRoleComments(comments, identity.role)
  const bindings = options.bindings ?? null
  const trustedAuthors = options.trustedAuthors ?? null
  const trustedAssociations = options.trustedAssociations ?? null

  return pool
    .map((comment) => ({
      comment,
      identity: normalizeTransitionIdentity(comment.body ?? ''),
      parsed: parseRoleCommentBody(comment.body ?? ''),
      author: comment.author || comment.user?.login || null,
      association: comment.author_association || comment.authorAssociation || null,
    }))
    .filter((entry) => {
      if (entry.identity.role !== identity.role) return false
      if (!transitionIdentityMatches(entry.identity, identity)) return false
      if (bindings?.taskId && entry.identity.taskId && String(entry.identity.taskId) !== String(bindings.taskId)) {
        return false
      }
      if (bindings?.phase && entry.identity.phase && entry.identity.phase !== bindings.phase) {
        return false
      }
      if (bindings?.prNumber && entry.parsed.prNumber && String(entry.parsed.prNumber) !== String(bindings.prNumber)) {
        return false
      }
      if (bindings?.headSha && entry.parsed.headSha && !headsAlign(entry.parsed.headSha, bindings.headSha)) {
        return false
      }
      if (trustedAuthors?.length) {
        if (!entry.author || !trustedAuthors.includes(entry.author)) return false
      } else if (options.requireTrustedAuthor && !entry.author) {
        return false
      }
      if (trustedAssociations?.length) {
        if (!entry.association || !trustedAssociations.includes(entry.association)) return false
      }
      return true
    })
    .map((entry) => entry.comment)
}

/**
 * Parse concatenated JSON arrays produced by `gh api --paginate`.
 * @param {string} stdout
 * @returns {Array<Record<string, unknown>>}
 */
export function parsePaginatedGhApiJson(stdout = '') {
  const trimmed = String(stdout ?? '').trim()
  if (!trimmed) return []
  try {
    const parsed = JSON.parse(trimmed)
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return JSON.parse(trimmed.replace(/\]\s*\[/g, ','))
  }
}

/**
 * Normalize raw GitHub issue comments into coordinator transport shape.
 * @param {Array<Record<string, unknown>>} rawComments
 */
export function normalizeIssueComments(rawComments = []) {
  return rawComments.map((comment) => ({
    id: comment.id ?? comment.databaseId ?? comment.node_id ?? null,
    body: comment.body ?? '',
    author: comment.author?.login || comment.user?.login || 'unknown',
    user: comment.user || (comment.author ? { login: comment.author.login } : undefined),
    author_association: comment.author_association || comment.authorAssociation || null,
    createdAt: comment.createdAt || comment.created_at || null,
    updatedAt: comment.updatedAt || comment.updated_at || null,
    url: comment.html_url || comment.url || null,
  }))
}

/**
 * Child-sync command gate evidence. When enforcement is required, all declared
 * gates must pass before sync may mutate a child.
 */
export function resolveChildSyncCommandGate({
  enforce = false,
  issues182Merged = false,
  issues184Merged = false,
  liveChildReconstructed = false,
  freshHandoffIssued = false,
} = {}) {
  if (!enforce) return { enforced: false, allowed: true }
  assertChildSyncGateReady({
    issues182Merged,
    issues184Merged,
    liveChildReconstructed,
    freshHandoffIssued,
  })
  return { enforced: true, allowed: true }
}

/**
 * @param {{ comments?: Array<{ body?: string, id?: string | number }>, identity: object, ambiguousPost?: boolean, matchOptions?: object }} input
 */
export function recoverAmbiguousPost({ comments = [], identity, ambiguousPost = true, matchOptions = { activeOnly: true } }) {
  const matches = findMatchingComments(comments, identity, matchOptions)
  const classification = classifyTransition(matches.length)
  if (classification === 'RESUME_PROJECTION') {
    return { classification, comment: matches[0], recovered: ambiguousPost }
  }
  if (classification === 'STATE_CONFLICT') {
    return { classification, error: new Error('ambiguous POST resolved to competing matches') }
  }
  return { classification, error: new Error('ambiguous POST has no provable match') }
}

/**
 * @param {Record<string, unknown>} expected
 * @param {Record<string, unknown>} actual
 * @param {string[] | null} [fields]
 */
export function verifyStatePostcondition(expected, actual, fields = null) {
  const keys = fields ?? [
    'state', 'review_cycle', 'full_review_count', 'active_pr', 'current_head', 'last_reviewed_head',
  ]
  for (const key of keys) {
    if (!sameValue(expected?.[key], actual?.[key])) {
      throw new Error(
        `postcondition mismatch on ${key}: expected ${JSON.stringify(expected?.[key])}, got ${JSON.stringify(actual?.[key])}`,
      )
    }
  }
  return true
}

export const CHILD_SYNC_GATE_ISSUES = Object.freeze([182, 184])

export const CHILD_SYNC_GATE_REQUIREMENTS = Object.freeze({
  issuesMergedAndGreen: CHILD_SYNC_GATE_ISSUES,
  requiresLiveChildStateReconstruction: true,
  requiresFreshChildSyncHandoff: true,
})

const COORDINATOR_OWNED_LINEAGE_KEYS = Object.freeze([
  'latest_handoff_comment_id',
  'latest_result_comment_id',
  'latest_review_verdict_comment_id',
  'latest_transition_identity',
])

function coordinatorOwnedProjection({ prior = {}, base = {}, identity, comment, role }) {
  const owned = {
    ...structuredClone(prior ?? {}),
    ...structuredClone(base ?? {}),
  }

  // Callers may propose domain state, counters, and heads, but they cannot
  // manufacture comment lineage. Preserve the durable prior values first and
  // let the coordinator replace only the field owned by this role transition.
  for (const key of COORDINATOR_OWNED_LINEAGE_KEYS) {
    if (Object.hasOwn(prior ?? {}, key)) owned[key] = prior[key]
    else delete owned[key]
  }

  if (role === 'REVIEW_VERDICT') {
    for (const key of ['review_cycle', 'full_review_count']) {
      if (Number.isInteger(prior?.[key]) &&
          (!Number.isInteger(owned[key]) || owned[key] < prior[key])) {
        owned[key] = prior[key]
      }
    }
    for (const key of ['current_head', 'last_reviewed_head']) {
      if (Object.hasOwn(prior ?? {}, key)) owned[key] = prior[key]
    }
  }

  owned.latest_transition_identity = serializeTransitionIdentity(identity)
  if (role === 'HANDOFF') {
    owned.latest_handoff_comment_id = comment?.id != null ? String(comment.id) : null
  } else if (role === 'RESULT') {
    owned.latest_result_comment_id = comment?.id != null ? String(comment.id) : null
  } else if (role === 'REVIEW_VERDICT') {
    owned.latest_review_verdict_comment_id = comment?.id != null ? String(comment.id) : null
  }

  return owned
}

function routingDriftClassification({ prior = {}, identity, comment, role }) {
  const expectedIdentity = serializeTransitionIdentity(identity)
  const expectedId = comment?.id != null ? String(comment.id) : null
  const key = role === 'HANDOFF'
    ? 'latest_handoff_comment_id'
    : role === 'RESULT'
      ? 'latest_result_comment_id'
      : role === 'REVIEW_VERDICT'
        ? 'latest_review_verdict_comment_id'
        : null
  if (!key) return null
  if (String(prior?.[key] ?? '') !== String(expectedId ?? '') ||
      prior?.latest_transition_identity !== expectedIdentity) {
    return 'REPAIRABLE_DRIFT'
  }
  return null
}

export function assertChildSyncGateReady({ issues182Merged = false, issues184Merged = false, liveChildReconstructed = false, freshHandoffIssued = false } = {}) {
  const blockers = []
  if (!issues182Merged) blockers.push('Issue #182 must be merged and green on protected main')
  if (!issues184Merged) blockers.push('Issue #184 must be merged and green on protected main')
  if (!liveChildReconstructed) blockers.push('live child-state reconstruction required')
  if (!freshHandoffIssued) blockers.push('fresh child-sync HANDOFF required')
  if (blockers.length > 0) {
    throw new Error(`child-sync gate blocked: ${blockers.join('; ')}`)
  }
  return true
}

/**
 * Canonical comment-first transition coordinator. Role comments are immutable
 * evidence; managed state is the routing projection.
 */
export class Coordinator {
  /**
   * @param {{
   *   readState: () => Promise<Record<string, unknown>>,
   *   writeState: (next: Record<string, unknown>, expected?: Record<string, unknown>) => Promise<Record<string, unknown>>,
   *   listComments: () => Promise<Array<{ body?: string, id?: string | number }>>,
   *   postComment: (body: string) => Promise<{ id?: string | number, body?: string }>,
   *   readIssueBody?: () => Promise<string>,
   *   trustedAuthors?: string[] | null,
   *   requireTrustedAuthor?: boolean,
   *   trustedAssociations?: string[] | null,
   * }} transports
   */
  constructor(transports) {
    this.readState = transports.readState
    this.writeState = transports.writeState
    this.listComments = transports.listComments
    this.postComment = transports.postComment
    this.readIssueBody = transports.readIssueBody ?? null
    this.trustedAuthors = transports.trustedAuthors ?? null
    this.requireTrustedAuthor = transports.requireTrustedAuthor ?? false
    this.trustedAssociations = transports.trustedAssociations ?? null
  }

  _matchOptions(roleBody, role) {
    const parsed = parseRoleCommentBody(roleBody)
    const identity = normalizeTransitionIdentity(roleBody, { role })
    return {
      identity,
      options: {
        activeOnly: true,
        bindings: {
          taskId: identity.taskId || null,
          phase: identity.phase || null,
          prNumber: parsed.prNumber,
          headSha: parsed.headSha,
        },
        trustedAuthors: this.trustedAuthors ?? undefined,
        requireTrustedAuthor: this.requireTrustedAuthor,
        trustedAssociations: this.trustedAssociations ?? undefined,
      },
    }
  }

  async _resolveComment(roleBody, role) {
    const { identity, options } = this._matchOptions(roleBody, role)
    const comments = await this.listComments()
    const activeRoleComments = selectActiveRoleComments(comments, role)
    if (role === 'HANDOFF' && activeRoleComments.length > 1) {
      const identities = new Set(
        activeRoleComments.map((comment) => serializeTransitionIdentity(normalizeTransitionIdentity(comment.body ?? ''))),
      )
      if (identities.size > 1) {
        throw new Error('STATE_CONFLICT: competing HANDOFF comments')
      }
    }
    if (identity.taskId) {
      const sameTaskComments = activeRoleComments.filter((comment) =>
        normalizeTransitionIdentity(comment.body ?? '').taskId === identity.taskId,
      )
      if (sameTaskComments.length > 1) {
        throw new Error(`STATE_CONFLICT: competing role comments for ${role}`)
      }
    }
    const matches = findMatchingComments(comments, identity, options)
    if (matches.length === 0) {
      try {
        const posted = await this.postComment(roleBody)
        if (posted?.id == null) {
          throw new Error('posted role comment did not return a durable comment identifier')
        }
        return { identity, comment: posted, created: true }
      } catch (error) {
        const recovery = recoverAmbiguousPost({
          comments: await this.listComments(),
          identity,
          ambiguousPost: true,
          matchOptions: options,
        })
        if (recovery.classification === 'RESUME_PROJECTION' && recovery.comment) {
          return { identity, comment: recovery.comment, created: false, recovered: true }
        }
        if (recovery.classification === 'STATE_CONFLICT') {
          throw new Error('STATE_CONFLICT: ambiguous POST resolved to competing matches', { cause: error })
        }
        throw new Error('BLOCKED_EXTERNAL: ambiguous POST has no provable match', { cause: error })
      }
    }
    if (matches.length > 1) {
      throw new Error('STATE_CONFLICT: competing role comments for the same transition identity')
    }
    return { identity, comment: matches[0], created: false }
  }

  _coordinatorOwnedRouting({ identity, comment, role, updatedAt, updatedBy, base, prior, planningAuthorizationBaseSha, preserveState = false }) {
    const target = (comment?.body ?? '').match(/^\*\*Target:\*\*\s*(.+?)\s*$/m)?.[1]?.trim()
    let owned = {
      ...coordinatorOwnedProjection({ prior, base, identity, comment, role }),
      latest_transition_identity: serializeTransitionIdentity(identity),
      updated_at: updatedAt ?? new Date().toISOString(),
      updated_by: updatedBy ?? 'Mission Control',
    }
    if (role === 'HANDOFF') {
      if (!preserveState) owned.state = 'IN_PROGRESS'
      owned.next_permitted_action = target
        ? (preserveState ? (owned.next_permitted_action ?? `${target} executes the authorized HANDOFF; do not re-post HANDOFF.`) : `${target} executes the authorized HANDOFF; do not re-post HANDOFF.`)
        : (preserveState ? (owned.next_permitted_action ?? 'Worker executes the authorized HANDOFF; do not re-post HANDOFF.') : 'Worker executes the authorized HANDOFF; do not re-post HANDOFF.')

      // planning_authorization_base_sha is ancestry authority for planning_no_pr only.
      // It is never derived from guide_source_sha (policy provenance at HANDOFF time).
      // Authoritative sources: explicit integrateHandoff seam, or durable state already set
      // when Mission Control authorized the planning branch from that exact commit.
      if (owned.workflow_mode === 'planning_no_pr') {
        const lineageSha = planningAuthorizationBaseSha ?? owned.planning_authorization_base_sha
        if (lineageSha == null || lineageSha === '') {
          throw new Error(
            'STATE_CONFLICT: planning_no_pr HANDOFF requires explicit planning_authorization_base_sha ancestry authority',
          )
        }
        const populated = populateOrPreservePlanningAuthorizationBaseSha(owned, lineageSha)
        if (!populated.ok) {
          throw new Error(`STATE_CONFLICT: ${populated.reason}`)
        }
        owned = populated.state
      }
    }
    return owned
  }

  /**
   * Comment-first READY -> IN_PROGRESS HANDOFF integration.
   */
  async integrateHandoff({ handoffBody, transitionState, updatedAt, updatedBy, planningAuthorizationBaseSha }) {
    if (!/^## HANDOFF\s*$/m.test(handoffBody ?? '')) {
      throw new Error('integrateHandoff requires one HANDOFF role comment')
    }
    const original = await this.readState()
    const planningCorrectionInitialization = original?.state === 'BLOCKED_FOR_FOUNDER_DECISION' &&
      original?.workflow_mode === 'planning_no_pr' &&
      original?.review_cycle === 0 &&
      original?.full_review_count === 0 &&
      original?.active_pr == null &&
      original?.current_head == null &&
      original?.last_reviewed_head == null &&
      original?.founder_decision?.status === 'declined' &&
      /Planning Correction 1 Initialization/i.test(handoffBody)
    if (original?.state !== 'READY' && !planningCorrectionInitialization) {
      throw new Error(`integrateHandoff requires READY, received ${original?.state ?? 'missing state'}`)
    }
    const { identity, comment, recovered } = await this._resolveComment(handoffBody, 'HANDOFF')
    const callerProjection = typeof transitionState === 'function'
      ? transitionState(original)
      : (transitionState ?? structuredClone(original))
    const projected = this._coordinatorOwnedRouting({
      identity,
      comment,
      role: 'HANDOFF',
      updatedAt,
      updatedBy,
      base: callerProjection,
      prior: original,
      preserveState: planningCorrectionInitialization,
      planningAuthorizationBaseSha,
    })
    const written = await this.writeState(projected, original)
    verifyStatePostcondition(projected, written, [
      'state', 'latest_transition_identity', 'latest_handoff_comment_id', 'next_permitted_action',
    ])
    return {
      outcome: 'DISPATCHED',
      classification: routingDriftClassification({ prior: original, identity, comment, role: 'HANDOFF' }),
      state: written,
      comment,
      identity,
      recovered: Boolean(recovered),
    }
  }

  /**
   * Comment-first RESULT integration with precondition gating.
   */
  async integrateResult({ resultBody, projectState, verifyPreconditions, updatedAt, updatedBy }) {
    if (parseCommentMarker(resultBody) !== 'RESULT') {
      throw new Error('integrateResult requires a RESULT role comment')
    }
    if (typeof verifyPreconditions === 'function') {
      await verifyPreconditions()
    }
    const original = await this.readState()
    const { identity, comment, created, recovered } = await this._resolveComment(resultBody, 'RESULT')
    const callerProjection = typeof projectState === 'function' ? projectState(original) : projectState
    const projected = this._coordinatorOwnedRouting({
      identity,
      comment,
      role: 'RESULT',
      updatedAt,
      updatedBy,
      base: callerProjection,
      prior: original,
    })
    try {
      const written = await this.writeState(projected, original)
      verifyStatePostcondition(projected, written)
      return {
        outcome: 'DELIVERED',
        classification: routingDriftClassification({ prior: original, identity, comment, role: 'RESULT' }),
        state: written,
        comment,
        identity,
        created,
        recovered: Boolean(recovered),
      }
    } catch (error) {
      if (!created) throw error
      let live
      try {
        live = await this.readState()
      } catch {
        throw error
      }
      if (sameValue(live, original)) {
        return {
          outcome: 'RECOVERABLE_ROUTING_DRIFT',
          classification: 'REPAIRABLE_DRIFT',
          state: original,
          comment,
          identity,
          recovered: Boolean(recovered),
          error: error instanceof Error ? error.message : String(error),
        }
      }
      if (sameValue(live, projected)) {
        verifyStatePostcondition(projected, live)
        return { outcome: 'DELIVERED', state: live, comment, identity, created }
      }
      throw new Error(
        `STATE_CONFLICT: incompatible concurrent authority after comment post: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
    }
  }

  /**
   * Routing-only REVIEW_VERDICT projection preserving counters and heads.
   */
  async reconcileReviewVerdict({ verdictBody, projectReview }) {
    if (parseCommentMarker(verdictBody) !== 'REVIEW_VERDICT') {
      throw new Error('reconcileReviewVerdict requires a REVIEW_VERDICT role comment')
    }
    const original = await this.readState()
    const { identity, options } = this._matchOptions(verdictBody, 'REVIEW_VERDICT')
    const comments = await this.listComments()
    const matches = findMatchingComments(comments, identity, options)
    const classification = classifyTransition(matches.length)
    if (classification === 'BLOCKED_EXTERNAL') {
      throw new Error('BLOCKED_EXTERNAL: no matching REVIEW_VERDICT evidence')
    }
    if (classification === 'STATE_CONFLICT') {
      throw new Error('STATE_CONFLICT: competing REVIEW_VERDICT comments')
    }
    const projected = this._coordinatorOwnedRouting({
      identity,
      comment: matches[0],
      role: 'REVIEW_VERDICT',
      base: typeof projectReview === 'function' ? projectReview(original) : projectReview,
      prior: original,
    })
    if (
      (projected.review_cycle ?? original.review_cycle) < (original.review_cycle ?? 0) ||
      (projected.full_review_count ?? original.full_review_count) < (original.full_review_count ?? 0)
    ) {
      throw new Error('routing-only repair must not decrease review counters')
    }
    const written = await this.writeState(projected, original)
    return {
      outcome: 'RECONCILED',
      classification: routingDriftClassification({ prior: original, identity, comment: matches[0], role: 'REVIEW_VERDICT' }),
      state: written,
      comment: matches[0],
      identity,
    }
  }

  /** Comment-first reviewer completion with a verified durable projection. */
  async integrateReviewVerdict({ verdictBody, projectState, verifyPreconditions, updatedAt, updatedBy }) {
    if (parseCommentMarker(verdictBody) !== 'REVIEW_VERDICT') {
      throw new Error('integrateReviewVerdict requires a REVIEW_VERDICT role comment')
    }
    if (typeof verifyPreconditions === 'function') await verifyPreconditions()
    const original = await this.readState()
    const { identity, comment, created, recovered } = await this._resolveComment(verdictBody, 'REVIEW_VERDICT')
    const serializedIdentity = serializeTransitionIdentity(identity)
    if (
      original?.latest_transition_identity === serializedIdentity &&
      String(original?.latest_review_verdict_comment_id ?? '') === String(comment.id)
    ) {
      return { outcome: 'REVIEWED', state: original, comment, identity, created: false, replayed: true }
    }
    const callerProjection = typeof projectState === 'function' ? projectState(original, comment, identity) : projectState
    const projected = this._coordinatorOwnedRouting({
      identity,
      comment,
      role: 'REVIEW_VERDICT',
      base: callerProjection,
      prior: original,
      updatedAt,
      updatedBy: updatedBy ?? 'Reviewer',
    })
    try {
      const written = await this.writeState(projected, original)
      verifyStatePostcondition(projected, written, [
        'state', 'review_cycle', 'full_review_count', 'current_head', 'last_reviewed_head',
        'latest_transition_identity', 'latest_review_verdict_comment_id', 'open_blockers',
      ])
      return {
        outcome: 'REVIEWED',
        classification: routingDriftClassification({ prior: original, identity, comment, role: 'REVIEW_VERDICT' }),
        state: written,
        comment,
        identity,
        created,
        recovered: Boolean(recovered),
      }
    } catch (error) {
      if (!created) throw error
      const live = await this.readState()
      if (sameValue(live, projected)) return {
        outcome: 'REVIEWED',
        classification: routingDriftClassification({ prior: original, identity, comment, role: 'REVIEW_VERDICT' }),
        state: live,
        comment,
        identity,
        created,
        recovered: Boolean(recovered),
      }
      if (sameValue(live, original)) {
        return {
          outcome: 'RECOVERABLE_ROUTING_DRIFT',
          classification: 'REPAIRABLE_DRIFT',
          state: original,
          comment,
          identity,
          created,
          recovered: Boolean(recovered),
          error: String(error),
        }
      }
      throw new Error(`STATE_CONFLICT: incompatible concurrent authority after verdict post: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
  }

  /**
   * Resume projection when comment exists but state update previously failed.
   */
  async resumeProjection({ roleBody, role, projectState, planningAuthorizationBaseSha }) {
    const { identity, options } = this._matchOptions(roleBody, role)
    const comments = await this.listComments()
    const matches = findMatchingComments(comments, identity, options)
    const classification = classifyTransition(matches.length)
    if (classification !== 'RESUME_PROJECTION') {
      throw new Error(`${classification}: cannot resume projection`)
    }
    const original = await this.readState()
    const callerProjection = typeof projectState === 'function' ? projectState(original) : projectState
    const projected = this._coordinatorOwnedRouting({
      identity,
      comment: matches[0],
      role,
      base: callerProjection,
      prior: original,
      planningAuthorizationBaseSha,
    })
    const written = await this.writeState(projected, original)
    verifyStatePostcondition(projected, written)
    return { outcome: 'RESUMED', state: written, comment: matches[0], identity }
  }

  /**
   * Fail closed when concurrent incompatible state is observed.
   */
  async assertCompatibleSnapshot(expectedState) {
    const live = await this.readState()
    const incompatibleKeys = ['state', 'active_pr', 'review_cycle', 'full_review_count']
    for (const key of incompatibleKeys) {
      if (expectedState?.[key] !== undefined && !sameValue(live?.[key], expectedState[key])) {
        throw new Error(`STATE_CONFLICT: incompatible concurrent state change on ${key}`)
      }
    }
    return live
  }
}

export function buildCorrectionHandoffBinding({ authorization, state, handoffBody, handoff }) {
  const target = handoffBody.match(/^\*\*Target:\*\*\s*(.+?)\s*$/m)?.[1]?.trim()
  if (!target) throw new Error('correction HANDOFF requires an explicit Target binding')
  const payload = {
    schema_version: 1,
    authorization_snapshot: {
      authorization_id: authorization.authorization_id,
      authority: authorization.authority,
      status: authorization.status,
      action: authorization.action,
      authorized_at: authorization.authorized_at,
      scope: authorization.scope,
      for_review_number: authorization.for_review_number,
      reviewed_head: authorization.reviewed_head,
      finding_ids: [...authorization.finding_ids],
    },
    authorization_id: authorization.authorization_id,
    target,
    active_pr: state.active_pr,
    exact_head: state.current_head,
    correction_base: authorization.reviewed_head,
    review_number: authorization.for_review_number,
    scope: authorization.scope,
    finding_ids: [...authorization.finding_ids],
    handoff_comment_id: String(handoff.id),
    handoff_created_at: handoff.created_at ?? handoff.createdAt ?? null,
    handoff_updated_at: handoff.updated_at ?? handoff.updatedAt ?? null,
    content_sha256: sha256(handoffBody),
  }
  return { ...payload, binding_sha256: sha256(JSON.stringify(payload)) }
}

export async function dispatchFounderAuthorizedCorrection({
  readState,
  writeState,
  postHandoff,
  retractHandoff,
  reserveAuthorization,
  releaseAuthorization,
  handoffBody,
  updatedAt = new Date().toISOString(),
  updatedBy = 'Mission Control',
}) {
  const original = await readState()
  const authorization = original?.founder_correction_authorization
  if (original?.state !== 'FOUNDER_AUTHORIZED_CORRECTION' || authorization?.status !== 'authorized') {
    throw new Error('dispatch requires an unconsumed Founder correction authorization')
  }
  if (!/^## HANDOFF\s*$/m.test(handoffBody ?? '') || !handoffBody.includes(authorization.authorization_id)) {
    throw new Error('correction HANDOFF must bind the Founder correction authorization identity')
  }
  if (typeof reserveAuthorization !== 'function' || typeof releaseAuthorization !== 'function') {
    throw new Error('correction dispatch requires a race-safe authorization reservation')
  }

  const reservation = await reserveAuthorization(authorization, original)
  let handoff = null
  let consumed = null
  let writeAttempted = false
  try {
    if (!sameValue(await readState(), original)) {
      throw new Error('correction dispatch reservation found stale or consumed authority')
    }
    handoff = await postHandoff(handoffBody)
    if (!handoff?.id) throw new Error('correction HANDOFF did not return a comment identifier')
    consumed = {
      ...structuredClone(original),
      state: 'IN_PROGRESS',
      updated_at: updatedAt,
      updated_by: updatedBy,
      founder_correction_authorization: {
        ...structuredClone(authorization),
        schema_version: 2,
        status: 'consumed',
        handoff_comment_id: String(handoff.id),
        handoff_url: handoff.html_url ?? handoff.url ?? null,
        handoff_binding: buildCorrectionHandoffBinding({ authorization, state: original, handoffBody, handoff }),
      },
    }
    writeAttempted = true
    await writeState(consumed)
    if (!sameValue(await readState(), consumed)) {
      throw new Error('correction dispatch verification found a concurrent state change')
    }
    await releaseAuthorization(reservation)
    return { outcome: 'DISPATCHED_FOUNDER_AUTHORIZED_CORRECTION', state: consumed }
  } catch (error) {
    let live = null
    try { live = await readState() } catch { /* indeterminate state retains reservation */ }
    if (consumed && sameValue(live, consumed)) {
      try { await releaseAuthorization(reservation) } catch { /* consumed state prevents replay */ }
      return { outcome: 'DISPATCHED_FOUNDER_AUTHORIZED_CORRECTION', state: consumed }
    }
    if (handoff && retractHandoff && (!writeAttempted || sameValue(live, original))) {
      try {
        await retractHandoff(handoff)
      } catch (retractError) {
        throw new Error('correction dispatch failed and HANDOFF rollback failed; reservation retained', { cause: retractError })
      }
    }
    if (!writeAttempted || sameValue(live, original)) {
      try { await releaseAuthorization(reservation) } catch { /* retained reservation fails closed */ }
    }
    throw new Error(
      `correction dispatch failed before verified Founder authorization consumption: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
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
  const prFromCanonicalLine =
    body.match(
      /\*\*PR\s*\/\s*base\s*\/\s*head:\*\*[^\n]*https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/(\d+)/i,
    )?.[1] ?? null
  const prFromCanonicalShorthand =
    body.match(/\*\*PR\s*\/\s*base\s*\/\s*head:\*\*[^\n]*\bPR\s*#(\d+)\b/i)?.[1] ?? null
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
    prNumber:
      heading === 'REVIEW_VERDICT'
        ? prFromCanonicalLine || prFromCanonicalShorthand
        : prFromUrl || prFromHash,
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
  const updatedAt = evidence.updatedAt ?? new Date().toISOString()
  const updatedBy = evidence.updatedBy ?? 'Mission Control'

  const managedState = evidence.managedState
  const correctionAuthorization = managedState?.founder_correction_authorization
  if (managedState?.state === 'IN_PROGRESS' && managedState.review_cycle === 3 &&
      managedState.full_review_count === 1 && correctionAuthorization?.status === 'consumed' &&
      correctionAuthorization?.for_review_number === 3) {
    return {
      ...structuredClone(managedState),
      state: 'BLOCKED_FOR_FOUNDER_DECISION',
      review_cycle: 3,
      full_review_count: 1,
      approved_base: approvedBase,
      active_task_issue: evidence.activeTaskIssue ? `#${evidence.activeTaskIssue}` : managedState.active_task_issue,
      active_pr: `#${prNumber}`,
      current_head: head,
      last_reviewed_head: managedState.last_reviewed_head,
      post_budget_reviews: [],
      founder_decision: {
        status: 'pending',
        authority: 'Founder',
        scope: 'review',
        review_number: 4,
        reviewed_head: head,
        action: 'Founder Approve or Decline a separately bound Review 4 authorization',
      },
      next_permitted_action: `Founder decides whether to authorize Review 4 on PR #${prNumber} at exact head ${head}; no Review 4 is authorized yet.`,
      material_change_status: 'founder_decision_required_for_review_4',
      updated_at: updatedAt,
      updated_by: updatedBy,
    }
  }

  const normalCorrectionTransitions = {
    CORRECTION_REQUIRED_1: 'AWAITING_REVIEW_2',
    CORRECTION_REQUIRED_2: 'AWAITING_REVIEW_3',
  }
  if (managedState && Object.hasOwn(normalCorrectionTransitions, managedState.state)) {
    const nextState = normalCorrectionTransitions[managedState.state]
    const nextReview = managedState.review_cycle + 1
    return {
      ...structuredClone(managedState),
      state: nextState,
      approved_base: approvedBase,
      active_task_issue: evidence.activeTaskIssue ? `#${evidence.activeTaskIssue}` : managedState.active_task_issue,
      active_pr: `#${prNumber}`,
      current_head: head,
      review_cycle: managedState.review_cycle,
      full_review_count: managedState.full_review_count,
      last_reviewed_head: managedState.last_reviewed_head,
      next_permitted_action: `Reviewer performs bounded Review ${nextReview} on PR #${prNumber} at exact head ${head}.`,
      material_change_status: 'none',
      updated_at: updatedAt,
      updated_by: updatedBy,
    }
  }

  return {
    state: 'AWAITING_REVIEW_1',
    review_cycle: 0,
    full_review_count: 0,
    approved_base: approvedBase,
    active_task_issue: evidence.activeTaskIssue ? `#${evidence.activeTaskIssue}` : null,
    active_pr: `#${prNumber}`,
    current_head: head,
    last_reviewed_head: null,
    next_permitted_action: `Reviewer performs bounded Review 1 on PR #${prNumber} at exact head ${head}.`,
    material_change_status: 'none',
    updated_at: updatedAt,
    updated_by: updatedBy,
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

/**
 * Build the complete reviewer-owned durable projection.  The executable
 * facade supplies only evidence already bound to the live Issue/PR/comment;
 * this pure function never reads transport state or posts comments.
 */
export function projectReviewVerdictState({
  prior,
  verdict,
  reviewType,
  reviewedHead,
  commentId,
  transitionIdentity,
  findings = [],
  updatedAt = new Date().toISOString(),
  updatedBy = 'Reviewer',
}) {
  if (!prior || typeof prior !== 'object') throw new Error('review projection requires prior managed state')
  if (!CORE_VERDICTS.has(verdict)) throw new Error('review projection requires a Core verdict')
  if (!['full', 'delta'].includes(reviewType)) throw new Error('review projection requires review type full or delta')
  if (!reviewedHead) throw new Error('review projection requires exact reviewed head')
  if (reviewType === 'full' && prior.review_cycle !== 0) throw new Error('full review requires review_cycle 0')
  if (reviewType === 'delta' && prior.review_cycle < 1) throw new Error('delta review requires an existing review cycle')

  const proposal = proposeReviewReconciliation({
    verdict,
    reviewedHead,
    reviewCycle: prior.review_cycle,
    fullReviewCount: prior.full_review_count,
  })
  const immutableFindings = findings
    .filter((finding) => finding?.finding_id || finding?.id)
    .map((finding) => String(finding.finding_id ?? finding.id))
  const projectsContractBlockers =
    verdict === 'CORRECTION REQUIRED' || verdict === 'BLOCKED FOR FOUNDER DECISION'
  const blockerIds = projectsContractBlockers ? immutableFindings : []

  return {
    ...structuredClone(prior),
    ...proposal,
    current_head: reviewedHead,
    last_reviewed_head: reviewedHead,
    open_blockers: blockerIds,
    latest_review_verdict_comment_id: String(commentId),
    latest_transition_identity: transitionIdentity,
    updated_at: updatedAt,
    updated_by: updatedBy,
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
      managedState: context.managedState,
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

  const authoritativeContract = parseCorrectionContract(context.latestVerdict?.comment?.body ?? '')
  if (authoritativeContract.ok) {
    const expectedBlockers = authoritativeContract.contract.findings.map((finding) => finding.id)
    const durableBlockers = context.managedState?.open_blockers ?? []
    if (!sameValue(expectedBlockers, durableBlockers)) {
      bookkeepingType = bookkeepingType ?? 'review'
      bookkeepingProposal = {
        ...(bookkeepingProposal ?? {}),
        open_blockers: expectedBlockers,
      }
    }
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
    try {
      result.proposal = {
        type: 'migration',
        fields: migrateLegacyManagedState(context.managedState).state,
      }
    } catch (error) {
      result.classification = {
        outcome: 'STATE_CONFLICT',
        reason: error instanceof Error ? error.message : String(error),
      }
      result.proposal = null
    }
  } else if (classification.outcome === 'BOOKKEEPING_REPAIR' && bookkeepingType) {
    result.proposal = {
      type: bookkeepingType,
      fields: bookkeepingProposal,
    }
  }

  return result
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    input: options.input,
    env: options.env,
  })
  if (result.error || result.status !== 0) {
    throw new Error(result.stderr || result.stdout || result.error?.message || `${command} failed`)
  }
  return result.stdout.trim()
}

function parseReconcileArgs(argv) {
  const options = { issue: null, repo: null }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--') continue
    if (argument === '--repo') {
      const repo = argv[++index]
      if (!repo) throw new Error('--repo requires a value')
      options.repo = repo
      continue
    }
    if (argument.startsWith('-') || options.issue) throw new Error(`unexpected argument: ${argument}`)
    options.issue = argument
  }
  if (!options.issue || !/^[1-9]\d*$/.test(options.issue)) {
    throw new Error('Usage: pnpm run bemoat:mission-control:reconcile -- <issue-number> [--repo owner/repo]')
  }
  return options
}

function stateBlockReplacement(body, state) {
  return projectMissionControlStateBlock(body, state)
}

async function runProductionBoundedReconciliation() {
  const options = parseReconcileArgs(process.argv.slice(2))
  const repoArgs = options.repo ? ['--repo', options.repo] : []
  const { analyzeProgressTracking } = await import('./agent-issue.mjs')
  const { parseMissionControlState } = await import('./mission-control-state.mjs')
  let expectedBody = null

  const readEvidence = async () => {
    const issue = JSON.parse(run('gh', ['issue', 'view', options.issue, '--json', 'body,state', ...repoArgs]))
    const state = parseMissionControlState(issue.body)
    if (!state.present || !state.valid) throw new Error(`invalid managed state: ${state.reason ?? 'missing state block'}`)
    expectedBody = issue.body
    const analysis = analyzeProgressTracking({
      activeIssueBody: issue.body,
      activeIssueNumber: options.issue,
      activeIssueState: issue.state,
    })
    const reconciliation = analysis.report.reconciliation
    if (!reconciliation) throw new Error('production preflight did not produce reconciliation evidence')
    const bookkeepingFields =
      reconciliation.proposal?.type === 'review' || reconciliation.proposal?.type === 'delivery'
        ? reconciliation.proposal.fields
        : null
    return {
      managedState: state.state,
      classification: reconciliation.classification,
      bookkeepingProposal: bookkeepingFields,
      // Keep proposedState as the merged bookkeeping view for proposedRepair callers.
      proposedState: bookkeepingFields
        ? { ...structuredClone(state.state), ...structuredClone(bookkeepingFields) }
        : (reconciliation.proposal?.fields ?? null),
    }
  }

  const writeState = async (nextState, expectedState) => {
    const live = JSON.parse(run('gh', ['issue', 'view', options.issue, '--json', 'body', ...repoArgs]))
    const liveState = parseMissionControlState(live.body)
    if (!liveState.valid || !sameValue(liveState.state, expectedState) || live.body !== expectedBody) {
      throw new Error('STATE_CONFLICT: concurrent Issue write detected before reconciliation repair')
    }
    const observedBody = live.body
    const nextBody = stateBlockReplacement(observedBody, nextState)
    const repo = options.repo || run('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'])
    await writeIssueBodyWithLease({
      repo,
      issueNumber: options.issue,
      expectedBody: observedBody,
      nextBody,
      transitionIdentity: nextState?.latest_transition_identity ?? null,
      holder: 'mission-control-reconcile',
      repoFlag: options.repo,
      deps: { runGh: (args, ghOptions) => run('gh', args, ghOptions) },
    })
    const verified = JSON.parse(run('gh', ['issue', 'view', options.issue, '--json', 'body', ...repoArgs]))
    const verifiedState = parseMissionControlState(verified.body)
    if (!verifiedState.valid || !sameValue(verifiedState.state, nextState)) {
      throw new Error('STATE_CONFLICT: concurrent Issue write detected after reconciliation repair')
    }
    expectedBody = verified.body
    return verifiedState.state
  }

  const result = await runBoundedReconciliation({ readEvidence, writeState })
  if (['STATE_CONFLICT', 'BLOCKED_EXTERNAL'].includes(result.finalOutcome)) {
    throw new Error(reconciliationFailureReason(result))
  }
  process.stdout.write(`Mission Control reconciliation ${result.finalOutcome}: ${result.measurements.reconciliation_attempts} attempt(s), ${result.measurements.state_writes} durable write(s)\n`)
}

export function reconciliationFailureReason(result = {}) {
  return result.finalReason ?? result.reason ?? 'Mission Control reconciliation failed without a diagnostic'
}

if (process.argv[1]?.endsWith('/mission-control-reconcile.mjs')) {
  runProductionBoundedReconciliation().catch((error) => {
    process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
