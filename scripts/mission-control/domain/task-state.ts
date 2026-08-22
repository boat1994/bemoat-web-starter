import yaml from 'yaml'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

import {
  validateBoundCorrectionAuthorization,
  validateFounderCorrectionAuthorization,
  validateObsoleteIssue155LegacyFields,
  validatePostBudgetReviews,
  validatePreReviewFounderDecisionGate,
} from './task-state-authorization.ts'
export const MISSION_CONTROL_STATES = Object.freeze([
  'READY',
  'IN_PROGRESS',
  'AWAITING_REVIEW_1',
  'CORRECTION_REQUIRED_1',
  'AWAITING_REVIEW_2',
  'CORRECTION_REQUIRED_2',
  'AWAITING_REVIEW_3',
  'FOUNDER_AUTHORIZED_CORRECTION',
  'BLOCKED_FOR_FOUNDER_DECISION',
  'ELIGIBLE_FOR_FOUNDER_REVIEW',
  'DONE',
  'BLOCKED_EXTERNAL',
  'STATE_CONFLICT',
  'STATE_MIGRATION_REQUIRED',
])
const missionControlStates = new Set(MISSION_CONTROL_STATES)

const missionControlRequiredKeys = [
  'schema_version', 'state', 'review_cycle', 'full_review_count', 'approved_base',
  'active_task_issue', 'active_pr', 'current_head', 'last_reviewed_head',
  'guide_version', 'guide_source_ref', 'guide_source_sha', 'open_blockers',
  'follow_up_issues', 'next_permitted_action', 'material_change_status', 'updated_at',
  'updated_by',
]

const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/i
type NormalizationResult =
  | { ok: true; value: string | null | undefined }
  | { ok: false; reason: string }

/** Durable workflow discriminator for planning vs implementation transport. */
export const MISSION_CONTROL_WORKFLOW_MODES = new Set(['planning_no_pr', 'implementation_pr'])

/**
 * Optional additive workflow discriminator. Absent/null is valid (non-planning).
 * Free-text, branch names, and title heuristics are rejected.
 *
 * @param {unknown} value
 * @returns {{ ok: true, value: string | null | undefined } | { ok: false, reason: string }}
 */
export function normalizeWorkflowMode(value: unknown): NormalizationResult {
  if (value === undefined) return { ok: true, value: undefined }
  if (value === null || value === '') return { ok: true, value: null }
  if (typeof value !== 'string' || !MISSION_CONTROL_WORKFLOW_MODES.has(value)) {
    return {
      ok: false,
      reason: 'workflow_mode must be null, planning_no_pr, or implementation_pr',
    }
  }
  return { ok: true, value }
}

/**
 * Optional additive planning-lineage field. Absent/null is valid for non-planning
 * tasks; when present it must be an exact full commit SHA (fail closed).
 *
 * @param {unknown} value
 * @returns {{ ok: true, value: string | null | undefined } | { ok: false, reason: string }}
 */
export function normalizePlanningAuthorizationBaseSha(value: unknown): NormalizationResult {
  if (value === undefined) return { ok: true, value: undefined }
  if (value === null || value === '') return { ok: true, value: null }
  if (typeof value !== 'string' || !FULL_COMMIT_SHA.test(value.trim())) {
    return {
      ok: false,
      reason: 'planning_authorization_base_sha must be null or an exact full commit SHA',
    }
  }
  return { ok: true, value: value.trim().toLowerCase() }
}

/**
 * Deterministic population/preserve path for planning_no_pr lineage authority.
 * - Missing/null → populate with the provided exact SHA
 * - Matching existing SHA → preserve (idempotent)
 * - Conflicting existing SHA → fail closed (immutable once authorized)
 * - Malformed existing value → fail closed
 *
 * @param {Record<string, unknown>} state
 * @param {string} lineageSha
 * @returns {{ ok: true, state: Record<string, unknown>, populated: boolean } | { ok: false, reason: string }}
 */
export function populateOrPreservePlanningAuthorizationBaseSha(
  state: Record<string, unknown>,
  lineageSha: string,
): PlanningLineageResult {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return { ok: false, reason: 'managed state mapping is required to populate planning_authorization_base_sha' }
  }
  const incoming = normalizePlanningAuthorizationBaseSha(lineageSha)
  if (!incoming.ok || incoming.value == null) {
    return { ok: false, reason: 'planning lineage population requires an exact full commit SHA' }
  }
  const existing = normalizePlanningAuthorizationBaseSha(state.planning_authorization_base_sha)
  if (existing.ok === false) return { ok: false, reason: existing.reason }
  if (existing.value != null && existing.value !== incoming.value) {
    return {
      ok: false,
      reason: 'planning_authorization_base_sha is immutable once authorized and conflicts with the requested lineage SHA',
    }
  }
  const next = { ...state, planning_authorization_base_sha: incoming.value }
  return { ok: true, state: next, populated: existing.value == null }
}

type MissionControlState = {
  schema_version: number
  state: string
  review_cycle: number
  full_review_count: number
  approved_base: string
  active_task_issue: string | null
  active_pr: string | null
  current_head: string | null
  last_reviewed_head: string | null
  guide_version: string
  guide_source_ref: string
  guide_source_sha: string | null
  open_blockers: unknown[]
  follow_up_issues: unknown[]
  next_permitted_action: string
  material_change_status: string
  updated_at: string | null
  updated_by: string | null
  planning_authorization_base_sha?: string | null
  workflow_mode?: 'planning_no_pr' | 'implementation_pr' | null
  post_budget_reviews?: unknown[]
  founder_decision?: unknown
  [key: string]: unknown
}
type PlanningLineageResult =
  | { ok: true; state: Record<string, unknown>; populated: boolean }
  | { ok: false; reason: string }

/** @returns {{present: boolean, valid: boolean, reason?: string, state: MissionControlState | null}} */
export function parseMissionControlState(body: string = '') {
  const starts = [...body.matchAll(/<!--\s*bemoat-mission-control-state:start\s*-->/g)]
  const ends = [...body.matchAll(/<!--\s*bemoat-mission-control-state:end\s*-->/g)]
  const hasLegacyHeader = body.includes('## MISSION_CONTROL_STATE')

  if (starts.length === 0 && ends.length === 0) {
    if (hasLegacyHeader) {
      return { present: true, valid: false, reason: 'unmarked YAML is not a durable managed-state block' }
    }
    return { present: false, valid: false, state: null }
  }

  if (starts.length !== 1 || ends.length !== 1 || starts[0].index > ends[0].index) {
    return { present: true, valid: false, reason: 'exactly one balanced marker pair is required' }
  }

  const raw = body.slice(starts[0].index + starts[0][0].length, ends[0].index)
    .replace(/```yaml\s*|```/g, '')

  let state: MissionControlState
  try {
    state = yaml.parse(raw, { uniqueKeys: true }) as MissionControlState
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('Map keys must be unique')) {
      return { present: true, valid: false, reason: `duplicate state key: ${message}` }
    }
    return { present: true, valid: false, reason: `unreadable state line: ${message}` }
  }

  if (typeof state !== 'object' || state === null || Array.isArray(state)) {
    return { present: true, valid: false, reason: 'unreadable state line: root must be a mapping' }
  }

  const missing = missionControlRequiredKeys.filter((key) => !Object.hasOwn(state, key))
  if (missing.length > 0) return { present: true, valid: false, reason: `missing required state key(s): ${missing.join(', ')}` }
  const obsoleteLegacy = validateObsoleteIssue155LegacyFields(state)
  if (obsoleteLegacy.valid === false) return { present: true, valid: false, reason: obsoleteLegacy.reason }
  if (state.schema_version !== 1) return { present: true, valid: false, reason: 'unsupported schema_version' }
  if (typeof state.state !== 'string' || !missionControlStates.has(state.state)) {
    return { present: true, valid: false, reason: 'invalid state enum' }
  }
  const nullableStringKeys = ['active_task_issue', 'active_pr', 'current_head', 'last_reviewed_head', 'guide_source_sha', 'updated_at', 'updated_by']
  const requiredStringKeys = ['approved_base', 'guide_version', 'guide_source_ref', 'next_permitted_action', 'material_change_status']
  if (nullableStringKeys.some((key) => state[key] !== null && typeof state[key] !== 'string') ||
      requiredStringKeys.some((key) => typeof state[key] !== 'string' || state[key].length === 0)) {
    return { present: true, valid: false, reason: 'invalid required state field type' }
  }
  if (Object.hasOwn(state, 'planning_authorization_base_sha')) {
    const lineage = normalizePlanningAuthorizationBaseSha(state.planning_authorization_base_sha)
    if (lineage.ok === false) return { present: true, valid: false, reason: lineage.reason }
    state.planning_authorization_base_sha = lineage.value
  }
  if (Object.hasOwn(state, 'workflow_mode')) {
    const mode = normalizeWorkflowMode(state.workflow_mode)
    if (mode.ok === false) return { present: true, valid: false, reason: mode.reason }
    state.workflow_mode = mode.value as 'planning_no_pr' | 'implementation_pr' | null | undefined
  }
  if (!Number.isInteger(state.review_cycle) || !Number.isInteger(state.full_review_count) || state.review_cycle < 0 || state.review_cycle > 3 || state.full_review_count < 0 || state.full_review_count > 1 || state.full_review_count > state.review_cycle) {
    return { present: true, valid: false, reason: 'impossible review counter values' }
  }
  if (!Array.isArray(state.open_blockers) || !Array.isArray(state.follow_up_issues)) {
    return { present: true, valid: false, reason: 'open_blockers and follow_up_issues must be arrays' }
  }
  if (Object.hasOwn(state, 'recovery_evidence_fingerprint') &&
      (typeof state.recovery_evidence_fingerprint !== 'string' || !/^[0-9a-f]{64}$/i.test(state.recovery_evidence_fingerprint))) {
    return { present: true, valid: false, reason: 'recovery_evidence_fingerprint must be a full SHA-256 when present' }
  }

  const postBudget = validatePostBudgetReviews(state)
  if (postBudget.valid === false) return { present: true, valid: false, reason: postBudget.reason }
  const hasPostBudgetReviews = postBudget.reviews.length > 0

  if (state.review_cycle > 0 && typeof state.last_reviewed_head !== 'string') {
    return { present: true, valid: false, reason: 'reviewed cycles require last_reviewed_head' }
  }
  if (hasPostBudgetReviews) {
    const latestPostBudgetReview = postBudget.reviews.at(-1)!
    if (state.review_cycle !== 3 || state.full_review_count !== 1) {
      return { present: true, valid: false, reason: 'post-budget history must preserve the normal review budget counters at 3/1' }
    }
    if (state.last_reviewed_head !== latestPostBudgetReview.reviewed_head) {
      return { present: true, valid: false, reason: 'last_reviewed_head must match the latest completed post-budget review' }
    }
    if (state.state === 'IN_PROGRESS') {
      if (typeof latestPostBudgetReview.verdict !== 'string' ||
          !['CORRECTION REQUIRED', 'BLOCKED FOR FOUNDER DECISION'].includes(latestPostBudgetReview.verdict)) {
        return { present: true, valid: false, reason: 'post-budget verdict does not authorize a correction transition' }
      }
      const reviewEightCorrection = isRecord(state.founder_review_8_correction_authorization)
        ? state.founder_review_8_correction_authorization
        : null
      const correctionAuthorization = latestPostBudgetReview.review_number === 8 && reviewEightCorrection
        ? {
            valid: reviewEightCorrection.status === 'consumed' &&
              reviewEightCorrection.authority === 'Founder' &&
              reviewEightCorrection.scope === 'correction' &&
              reviewEightCorrection.for_review_number === 8 &&
              reviewEightCorrection.reviewed_head === latestPostBudgetReview.reviewed_head &&
              Array.isArray(reviewEightCorrection.finding_ids) &&
              reviewEightCorrection.finding_ids.length > 0,
            reason: 'Review 8 correction authorization must bind the latest completed review',
          }
        : validateBoundCorrectionAuthorization(state.founder_decision, latestPostBudgetReview)
      if (!correctionAuthorization.valid) {
        return { present: true, valid: false, reason: correctionAuthorization.reason }
      }
      if (typeof state.active_pr !== 'string' || typeof state.current_head !== 'string') {
        return { present: true, valid: false, reason: 'post-budget correction requires active_pr and current_head' }
      }
    }
  }

  const founderCorrection = state.founder_correction_authorization
  if (state.state === 'FOUNDER_AUTHORIZED_CORRECTION') {
    if ((state.review_cycle !== 1 && state.review_cycle !== 3) || state.full_review_count !== 1 ||
        typeof state.active_pr !== 'string' || typeof state.current_head !== 'string') {
      return { present: true, valid: false, reason: 'Founder-authorized correction requires active PR and normal counters at 1/1 or 3/1' }
    }
    if (hasPostBudgetReviews && (postBudget.reviews.length !== 1 || postBudget.reviews[0].review_number !== 4)) {
      return { present: true, valid: false, reason: 'Founder-authorized correction cannot replace post-budget review lineage' }
    }
    const authorization = validateFounderCorrectionAuthorization(founderCorrection, state, 'authorized', state.review_cycle)
    if (!authorization.valid) return { present: true, valid: false, reason: authorization.reason }
  }
  if (state.state === 'IN_PROGRESS' && !hasPostBudgetReviews) {
    if (state.review_cycle === 1 || state.review_cycle === 3) {
      const authorization = validateFounderCorrectionAuthorization(founderCorrection, state, 'consumed', state.review_cycle)
      if (!authorization.valid) return { present: true, valid: false, reason: authorization.reason }
    } else if (state.review_cycle !== 0) {
      return { present: true, valid: false, reason: 'state and review_cycle are inconsistent' }
    }
  }

  const expectedCycles = {
    READY: 0,
    AWAITING_REVIEW_1: 0,
    CORRECTION_REQUIRED_1: 1,
    AWAITING_REVIEW_2: 1,
    CORRECTION_REQUIRED_2: 2,
    AWAITING_REVIEW_3: 2,
  }
  if (Object.hasOwn(expectedCycles, state.state) && state.review_cycle !== expectedCycles[state.state as keyof typeof expectedCycles]) {
    return { present: true, valid: false, reason: 'state and review_cycle are inconsistent' }
  }
  const expectedFullReviewCounts = {
    READY: 0,
    AWAITING_REVIEW_1: 0,
    CORRECTION_REQUIRED_1: 1,
    AWAITING_REVIEW_2: 1,
    CORRECTION_REQUIRED_2: 1,
    AWAITING_REVIEW_3: 1,
    ELIGIBLE_FOR_FOUNDER_REVIEW: 1,
    DONE: 1,
  }
  if (Object.hasOwn(expectedFullReviewCounts, state.state) && state.full_review_count !== expectedFullReviewCounts[state.state as keyof typeof expectedFullReviewCounts]) {
    return { present: true, valid: false, reason: 'state and full_review_count are inconsistent' }
  }
  if (state.state === 'IN_PROGRESS' && !hasPostBudgetReviews && state.full_review_count !== 0 && state.full_review_count !== 1) {
    return { present: true, valid: false, reason: 'state and full_review_count are inconsistent' }
  }
  if (state.state === 'BLOCKED_FOR_FOUNDER_DECISION') {
    if (state.review_cycle === 0 && state.full_review_count === 0) {
      const preReviewGate = validatePreReviewFounderDecisionGate(state)
      if (!preReviewGate.valid) return { present: true, valid: false, reason: preReviewGate.reason }
    } else if (state.full_review_count !== 1) {
      return { present: true, valid: false, reason: 'state and full_review_count are inconsistent' }
    }
  }

  return { present: true, valid: true, state: /** @type {MissionControlState} */ (state) }
}

export function renderMissionControlState(stateObj: Record<string, unknown>) {
  const orderedKeys = [
    'schema_version', 'state', 'review_cycle', 'full_review_count', 'approved_base',
    'active_task_issue', 'active_pr', 'current_head', 'last_reviewed_head',
    'workflow_mode',
    'planning_authorization_base_sha',
    'post_budget_reviews', 'founder_decision', 'founder_correction_authorization',
    'latest_transition_identity',
    'guide_version', 'guide_source_ref', 'guide_source_sha', 'open_blockers',
    'follow_up_issues', 'next_permitted_action', 'material_change_status', 'updated_at',
    'updated_by', 'recovery_evidence_fingerprint'
  ]
  const keys = new Set([...orderedKeys, ...Object.keys(stateObj)])

  const orderedState: Record<string, unknown> = {}
  for (const key of keys) {
    if (Object.hasOwn(stateObj, key)) {
      orderedState[key] = stateObj[key]
    }
  }

  const yamlStr = yaml.stringify(orderedState, { lineWidth: 0 })

  return [
    '<!-- bemoat-mission-control-state:start -->',
    '```yaml',
    yamlStr.trim(),
    '```',
    '<!-- bemoat-mission-control-state:end -->'
  ].join('\n')
}

/** Replace exactly one managed Mission Control state block without touching surrounding Issue prose. */
export function projectMissionControlStateBlock(
  body: string = '',
  stateObj: Record<string, unknown> = {},
) {
  const starts = [...String(body).matchAll(/<!--\s*bemoat-mission-control-state:start\s*-->/g)]
  const ends = [...String(body).matchAll(/<!--\s*bemoat-mission-control-state:end\s*-->/g)]

  if (starts.length === 0 && ends.length === 0) {
    throw new Error('managed state block is missing')
  }
  if (starts.length !== 1 || ends.length !== 1 || starts[0].index > ends[0].index) {
    throw new Error('exactly one balanced marker pair is required')
  }

  const start = starts[0]
  const end = ends[0]
  const before = String(body).slice(0, start.index)
  const after = String(body).slice(end.index + end[0].length)
  return `${before}${renderMissionControlState(stateObj)}${after}`
}

/** Append one managed-state block only when the canonical projection is wholly absent. */
export function appendMissingMissionControlStateBlock(
  body: string = '',
  stateObj: Record<string, unknown> = {},
) {
  const parsed = parseMissionControlState(String(body))
  if (parsed.present) {
    throw new Error('managed state block is not wholly absent')
  }
  const source = String(body)
  const separator = source.length === 0 || source.endsWith('\n') ? '' : '\n'
  return `${source}${separator}${renderMissionControlState(stateObj)}\n`
}
