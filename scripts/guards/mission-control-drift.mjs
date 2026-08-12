#!/usr/bin/env node
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { proposeReviewReconciliation as canonicalReconcile } from '../mission-control-reconcile.mjs'
import { parseMissionControlState as canonicalParse, renderMissionControlState as canonicalRender } from '../mission-control/domain/task-state.mjs'

export const RECONCILE_SCRIPT_PATH = 'scripts/mission-control-reconcile.mjs'

const STATES = [
  'READY', 'IN_PROGRESS', 'AWAITING_REVIEW_1', 'CORRECTION_REQUIRED_1',
  'AWAITING_REVIEW_2', 'CORRECTION_REQUIRED_2', 'AWAITING_REVIEW_3',
  'BLOCKED_FOR_FOUNDER_DECISION', 'ELIGIBLE_FOR_FOUNDER_REVIEW', 'DONE',
  'BLOCKED_EXTERNAL', 'STATE_CONFLICT', 'STATE_MIGRATION_REQUIRED',
]

function expectedStateCounterValidity(state, cycle, full) {
  const exact = {
    READY: [0, 0], IN_PROGRESS: [0, 0], AWAITING_REVIEW_1: [0, 0],
    CORRECTION_REQUIRED_1: [1, 1], AWAITING_REVIEW_2: [1, 1],
    CORRECTION_REQUIRED_2: [2, 1], AWAITING_REVIEW_3: [2, 1],
  }
  if (exact[state]) return cycle === exact[state][0] && full === exact[state][1]
  if (['BLOCKED_FOR_FOUNDER_DECISION', 'ELIGIBLE_FOR_FOUNDER_REVIEW', 'DONE'].includes(state)) {
    return cycle >= 1 && full === 1
  }
  return full <= cycle
}

export const MISSION_CONTROL_STATE_COUNTER_MATRIX = STATES.flatMap((state) =>
  Array.from({ length: 4 }, (_, cycle) =>
    Array.from({ length: 2 }, (_, full) => ({
      state,
      cycle,
      full,
      expected_valid: expectedStateCounterValidity(state, cycle, full),
    })),
  ).flat(),
)

const REVIEW_EXPECTATIONS = {
  0: {
    'CORRECTION REQUIRED': ['CORRECTION_REQUIRED_1', 1, 1],
    'ELIGIBLE FOR FOUNDER REVIEW': ['ELIGIBLE_FOR_FOUNDER_REVIEW', 1, 1],
    'BLOCKED FOR FOUNDER DECISION': ['BLOCKED_FOR_FOUNDER_DECISION', 1, 1],
    'BLOCKED EXTERNAL': ['BLOCKED_EXTERNAL', 1, 1],
    'STATE CONFLICT': ['STATE_CONFLICT', 1, 1],
  },
  1: {
    'CORRECTION REQUIRED': ['CORRECTION_REQUIRED_2', 2, 1],
    'ELIGIBLE FOR FOUNDER REVIEW': ['ELIGIBLE_FOR_FOUNDER_REVIEW', 2, 1],
    'BLOCKED FOR FOUNDER DECISION': ['BLOCKED_FOR_FOUNDER_DECISION', 2, 1],
    'BLOCKED EXTERNAL': ['BLOCKED_EXTERNAL', 2, 1],
    'STATE CONFLICT': ['STATE_CONFLICT', 2, 1],
  },
  2: {
    'CORRECTION REQUIRED': ['STATE_CONFLICT', 2, 1],
    'ELIGIBLE FOR FOUNDER REVIEW': ['ELIGIBLE_FOR_FOUNDER_REVIEW', 3, 1],
    'BLOCKED FOR FOUNDER DECISION': ['BLOCKED_FOR_FOUNDER_DECISION', 3, 1],
    'BLOCKED EXTERNAL': ['BLOCKED_EXTERNAL', 3, 1],
    'STATE CONFLICT': ['STATE_CONFLICT', 3, 1],
  },
}

export const MISSION_CONTROL_REVIEW_MATRIX = Object.entries(REVIEW_EXPECTATIONS).flatMap(
  ([cycle, verdicts]) => Object.entries(verdicts).map(([verdict, expected]) => ({
    cycle: Number(cycle),
    verdict,
    expected: expected[0],
    expectedCycle: expected[1],
    expectedFull: expected[2],
  })),
)

export function runMissionControlDriftGuard({
  proposeReviewReconciliation = canonicalReconcile,
  parseMissionControlState = canonicalParse,
  renderMissionControlState = canonicalRender,
} = {}) {
  const violations = []
  
  function renderStateBlock({ state, cycle, full, lastReviewedHead = cycle > 0 ? 'deadbeef' : null }) {
    return renderMissionControlState({
      schema_version: 1,
      state,
      review_cycle: cycle,
      full_review_count: full,
      approved_base: 'main',
      active_task_issue: '#150',
      active_pr: '#151',
      current_head: 'abcdef1',
      last_reviewed_head: lastReviewedHead,
      guide_version: '1.2.0',
      guide_source_ref: 'main',
      guide_source_sha: 'deadbeef',
      open_blockers: [],
      follow_up_issues: [],
      next_permitted_action: 'bounded action',
      material_change_status: 'none',
      updated_at: '2026-07-23T03:45:00Z',
      updated_by: 'Mission Control',
    })
  }

  for (const entry of MISSION_CONTROL_REVIEW_MATRIX) {
    const proposal = proposeReviewReconciliation({
      verdict: entry.verdict,
      reviewedHead: 'deadbeef',
      reviewCycle: entry.cycle,
      fullReviewCount: entry.cycle === 0 ? 0 : 1,
    })
    if (proposal.state !== entry.expected) {
      violations.push({ type: 'mission-control-drift', rule: 'MC-DRIFT-001', file: RECONCILE_SCRIPT_PATH, message: `Expected ${entry.expected} for ${entry.verdict} at cycle ${entry.cycle}, got ${proposal.state}` })
    }
    if (proposal.review_cycle !== entry.expectedCycle) {
      violations.push({ type: 'mission-control-drift', rule: 'MC-DRIFT-002', file: RECONCILE_SCRIPT_PATH, message: `Expected cycle ${entry.expectedCycle} for ${entry.verdict} at cycle ${entry.cycle}, got ${proposal.review_cycle}` })
    }
    if (proposal.full_review_count !== entry.expectedFull || proposal.full_review_count > 1) {
      violations.push({ type: 'mission-control-drift', rule: 'MC-DRIFT-003', file: RECONCILE_SCRIPT_PATH, message: `Expected full_review_count ${entry.expectedFull} for ${entry.verdict} at cycle ${entry.cycle}, got ${proposal.full_review_count}` })
    }
    const parsed = parseMissionControlState(renderStateBlock({
      state: proposal.state,
      cycle: proposal.review_cycle,
      full: proposal.full_review_count,
      lastReviewedHead: proposal.last_reviewed_head,
    }))
    if (!parsed.valid) {
      violations.push({ type: 'mission-control-drift', rule: 'MC-DRIFT-004', file: RECONCILE_SCRIPT_PATH, message: `Parser rejected proposal for ${entry.verdict} at cycle ${entry.cycle}: ${parsed.reason}` })
    }
  }

  for (const entry of MISSION_CONTROL_STATE_COUNTER_MATRIX) {
    const parsed = parseMissionControlState(renderStateBlock({
      state: entry.state,
      cycle: entry.cycle,
      full: entry.full,
    }))
    if (parsed.valid !== entry.expected_valid) {
      violations.push({ type: 'mission-control-drift', rule: 'MC-DRIFT-005', file: 'scripts/mission-control/domain/task-state.mjs', message: `${entry.state} at cycle/full ${entry.cycle}/${entry.full} expected valid=${entry.expected_valid}, got ${parsed.valid}` })
    }
  }

  return violations
}

export function formatMissionControlDriftViolations(violations) {
  if (violations.length === 0) return ['Mission Control drift guard passed.']
  return [
    'Mission Control drift guard failed:', '',
    'Fix the violations below, then rerun `pnpm run bemoat:guard:safety`.', '',
    ...violations.map((item) => `- [${item.rule}] ${item.file}: ${item.message}`),
  ]
}

export function isDirectExecution() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
}

if (isDirectExecution()) {
  const violations = runMissionControlDriftGuard()
  for (const line of formatMissionControlDriftViolations(violations)) console.log(line)
  process.exit(violations.length > 0 ? 1 : 0)
}
