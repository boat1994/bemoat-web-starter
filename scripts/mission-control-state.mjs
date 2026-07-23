import yaml from 'yaml'

const missionControlStates = new Set([
  'READY',
  'IN_PROGRESS',
  'AWAITING_REVIEW_1',
  'CORRECTION_REQUIRED_1',
  'AWAITING_REVIEW_2',
  'CORRECTION_REQUIRED_2',
  'AWAITING_REVIEW_3',
  'BLOCKED_FOR_FOUNDER_DECISION',
  'ELIGIBLE_FOR_FOUNDER_REVIEW',
  'DONE',
  'BLOCKED_EXTERNAL',
  'STATE_CONFLICT',
  'STATE_MIGRATION_REQUIRED',
])

const missionControlRequiredKeys = [
  'schema_version', 'state', 'review_cycle', 'full_review_count', 'approved_base',
  'active_task_issue', 'active_pr', 'current_head', 'last_reviewed_head',
  'guide_version', 'guide_source_ref', 'guide_source_sha', 'open_blockers',
  'follow_up_issues', 'next_permitted_action', 'material_change_status', 'updated_at',
  'updated_by',
]

const postBudgetReviewVerdicts = new Set([
  'CORRECTION REQUIRED',
  'ELIGIBLE FOR FOUNDER REVIEW',
  'BLOCKED FOR FOUNDER DECISION',
  'BLOCKED EXTERNAL',
  'STATE CONFLICT',
])

function isFounderAuthorization(value, scope) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    value.status === 'approved' && value.authority === 'Founder' && value.scope === scope &&
    typeof value.action === 'string' && value.action.length > 0 &&
    typeof value.authorized_at === 'string' && value.authorized_at.length > 0
}

function validatePostBudgetReviews(state) {
  if (!Object.hasOwn(state, 'post_budget_reviews')) {
    return { valid: true, reviews: [] }
  }
  if (!Array.isArray(state.post_budget_reviews)) {
    return { valid: false, reason: 'post_budget_reviews must be an array' }
  }

  for (const [index, review] of state.post_budget_reviews.entries()) {
    if (typeof review !== 'object' || review === null || Array.isArray(review)) {
      return { valid: false, reason: 'post-budget review entries must be mappings' }
    }
    if (review.review_number !== index + 4) {
      return { valid: false, reason: 'post-budget review numbers must be contiguous from Review 4' }
    }
    if (typeof review.reviewed_head !== 'string' || review.reviewed_head.length === 0 ||
        typeof review.verdict !== 'string' || !postBudgetReviewVerdicts.has(review.verdict)) {
      return { valid: false, reason: 'post-budget review number, head, or verdict is invalid' }
    }
    if (!isFounderAuthorization(review.authorization, 'review')) {
      return { valid: false, reason: `post-budget review authorization is required for Review ${review.review_number}` }
    }
    if (!Array.isArray(review.finding_dispositions) || review.finding_dispositions.some((finding) =>
      typeof finding !== 'object' || finding === null || Array.isArray(finding) ||
      typeof finding.finding_id !== 'string' || finding.finding_id.length === 0 ||
      typeof finding.disposition !== 'string' || finding.disposition.length === 0
    )) {
      return { valid: false, reason: `post-budget Review ${review.review_number} requires valid finding dispositions` }
    }
  }

  return { valid: true, reviews: state.post_budget_reviews }
}

/**
 * @typedef {{
 *   schema_version: number,
 *   state: string,
 *   review_cycle: number,
 *   full_review_count: number,
 *   approved_base: string,
 *   active_task_issue: string | null,
 *   active_pr: string | null,
 *   current_head: string | null,
 *   last_reviewed_head: string | null,
 *   post_budget_reviews?: unknown[],
 *   founder_decision?: unknown,
 *   guide_version: string,
 *   guide_source_ref: string,
 *   guide_source_sha: string | null,
 *   open_blockers: unknown[],
 *   follow_up_issues: unknown[],
 *   next_permitted_action: string,
 *   material_change_status: string,
 *   updated_at: string | null,
 *   updated_by: string | null,
 *   [key: string]: unknown,
 * }} MissionControlState
 */

/** @returns {{present: boolean, valid: boolean, reason?: string, state: MissionControlState | null}} */
export function parseMissionControlState(body = '') {
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

  let state
  try {
    state = yaml.parse(raw, { uniqueKeys: true })
  } catch (error) {
    if (error.message.includes('Map keys must be unique')) {
      return { present: true, valid: false, reason: `duplicate state key: ${error.message}` }
    }
    return { present: true, valid: false, reason: `unreadable state line: ${error.message}` }
  }

  if (typeof state !== 'object' || state === null || Array.isArray(state)) {
    return { present: true, valid: false, reason: 'unreadable state line: root must be a mapping' }
  }

  const missing = missionControlRequiredKeys.filter((key) => !Object.hasOwn(state, key))
  if (missing.length > 0) return { present: true, valid: false, reason: `missing required state key(s): ${missing.join(', ')}` }
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
  if (!Number.isInteger(state.review_cycle) || !Number.isInteger(state.full_review_count) || state.review_cycle < 0 || state.review_cycle > 3 || state.full_review_count < 0 || state.full_review_count > 1 || state.full_review_count > state.review_cycle) {
    return { present: true, valid: false, reason: 'impossible review counter values' }
  }
  if (!Array.isArray(state.open_blockers) || !Array.isArray(state.follow_up_issues)) {
    return { present: true, valid: false, reason: 'open_blockers and follow_up_issues must be arrays' }
  }

  const postBudget = validatePostBudgetReviews(state)
  if (!postBudget.valid) return { present: true, valid: false, reason: postBudget.reason }
  const hasPostBudgetReviews = postBudget.reviews.length > 0

  if (state.review_cycle > 0 && typeof state.last_reviewed_head !== 'string') {
    return { present: true, valid: false, reason: 'reviewed cycles require last_reviewed_head' }
  }
  if (hasPostBudgetReviews) {
    const latestPostBudgetReview = postBudget.reviews.at(-1)
    if (state.review_cycle !== 3 || state.full_review_count !== 1) {
      return { present: true, valid: false, reason: 'post-budget history must preserve the normal review budget counters at 3/1' }
    }
    if (state.last_reviewed_head !== latestPostBudgetReview.reviewed_head) {
      return { present: true, valid: false, reason: 'last_reviewed_head must match the latest completed post-budget review' }
    }
    if (state.state === 'IN_PROGRESS') {
      if (!['CORRECTION REQUIRED', 'BLOCKED FOR FOUNDER DECISION'].includes(latestPostBudgetReview.verdict)) {
        return { present: true, valid: false, reason: 'post-budget verdict does not authorize a correction transition' }
      }
      if (!isFounderAuthorization(state.founder_decision, 'correction')) {
        return { present: true, valid: false, reason: 'post-budget correction authorization is required for IN_PROGRESS' }
      }
      if (typeof state.active_pr !== 'string' || typeof state.current_head !== 'string') {
        return { present: true, valid: false, reason: 'post-budget correction requires active_pr and current_head' }
      }
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
  if (Object.hasOwn(expectedCycles, state.state) && state.review_cycle !== expectedCycles[state.state]) {
    return { present: true, valid: false, reason: 'state and review_cycle are inconsistent' }
  }
  if (state.state === 'IN_PROGRESS' && !hasPostBudgetReviews && state.review_cycle !== 0) {
    return { present: true, valid: false, reason: 'state and review_cycle are inconsistent' }
  }
  const expectedFullReviewCounts = {
    READY: 0,
    AWAITING_REVIEW_1: 0,
    CORRECTION_REQUIRED_1: 1,
    AWAITING_REVIEW_2: 1,
    CORRECTION_REQUIRED_2: 1,
    AWAITING_REVIEW_3: 1,
    BLOCKED_FOR_FOUNDER_DECISION: 1,
    ELIGIBLE_FOR_FOUNDER_REVIEW: 1,
    DONE: 1,
  }
  if (Object.hasOwn(expectedFullReviewCounts, state.state) && state.full_review_count !== expectedFullReviewCounts[state.state]) {
    return { present: true, valid: false, reason: 'state and full_review_count are inconsistent' }
  }
  if (state.state === 'IN_PROGRESS' && !hasPostBudgetReviews && state.full_review_count !== 0) {
    return { present: true, valid: false, reason: 'state and full_review_count are inconsistent' }
  }

  return { present: true, valid: true, state: /** @type {MissionControlState} */ (state) }
}

export function renderMissionControlState(stateObj) {
  const orderedKeys = [
    'schema_version', 'state', 'review_cycle', 'full_review_count', 'approved_base',
    'active_task_issue', 'active_pr', 'current_head', 'last_reviewed_head',
    'post_budget_reviews', 'founder_decision',
    'guide_version', 'guide_source_ref', 'guide_source_sha', 'open_blockers',
    'follow_up_issues', 'next_permitted_action', 'material_change_status', 'updated_at',
    'updated_by'
  ]
  const keys = new Set([...orderedKeys, ...Object.keys(stateObj)])
  
  const orderedState = {}
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
