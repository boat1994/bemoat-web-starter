#!/usr/bin/env node
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { proposeReviewReconciliation } from './mission-control-reconcile.mjs'
import { parseMissionControlState } from './mission-control-state.mjs'

export const RECONCILE_SCRIPT_PATH = 'scripts/mission-control-reconcile.mjs'

export function runMissionControlDriftGuard() {
  const violations = []
  
  // Test Transition Matrix
  const transitions = [
    { verdict: 'CORRECTION REQUIRED', cycle: 0, full: 0, expected: 'CORRECTION_REQUIRED_1', expectedCycle: 1, expectedFull: 1 },
    { verdict: 'CORRECTION REQUIRED', cycle: 1, full: 1, expected: 'CORRECTION_REQUIRED_2', expectedCycle: 2, expectedFull: 1 },
    { verdict: 'CORRECTION REQUIRED', cycle: 2, full: 1, expected: 'STATE_CONFLICT', expectedCycle: 2, expectedFull: 1 },
    { verdict: 'ELIGIBLE FOR FOUNDER REVIEW', cycle: 0, full: 0, expected: 'ELIGIBLE_FOR_FOUNDER_REVIEW', expectedCycle: 1, expectedFull: 1 },
    { verdict: 'ELIGIBLE FOR FOUNDER REVIEW', cycle: 1, full: 1, expected: 'ELIGIBLE_FOR_FOUNDER_REVIEW', expectedCycle: 2, expectedFull: 1 },
    { verdict: 'BLOCKED FOR FOUNDER DECISION', cycle: 2, full: 1, expected: 'BLOCKED_FOR_FOUNDER_DECISION', expectedCycle: 3, expectedFull: 1 },
    { verdict: 'BLOCKED EXTERNAL', cycle: 0, full: 0, expected: 'BLOCKED_EXTERNAL', expectedCycle: 1, expectedFull: 1 },
    { verdict: 'STATE CONFLICT', cycle: 0, full: 0, expected: 'STATE_CONFLICT', expectedCycle: 1, expectedFull: 1 },
  ]

  for (const t of transitions) {
    const prop = proposeReviewReconciliation({
      verdict: t.verdict,
      reviewedHead: 'deadbeef',
      reviewCycle: t.cycle,
      fullReviewCount: t.full
    })

    if (prop.state !== t.expected) {
      violations.push({
        type: 'mission-control-drift',
        rule: 'MC-DRIFT-001',
        file: RECONCILE_SCRIPT_PATH,
        message: `Expected state ${t.expected} for ${t.verdict} at cycle ${t.cycle}, got ${prop.state}`,
      })
    }

    if (prop.review_cycle !== t.expectedCycle) {
      violations.push({
        type: 'mission-control-drift',
        rule: 'MC-DRIFT-002',
        file: RECONCILE_SCRIPT_PATH,
        message: `Expected review cycle ${t.expectedCycle} for ${t.verdict} at cycle ${t.cycle}, got ${prop.review_cycle}`,
      })
    }

    if (prop.full_review_count !== t.expectedFull || prop.full_review_count > 1) {
      violations.push({
        type: 'mission-control-drift',
        rule: 'MC-DRIFT-003',
        file: RECONCILE_SCRIPT_PATH,
        message: `Expected full review count ${t.expectedFull} (max 1) for ${t.verdict} at cycle ${t.cycle}, got ${prop.full_review_count}`,
      })
    }

    // Ensure parser accepts the reconciliation proposal
    const validStateBlock = `<!-- bemoat-mission-control-state:start -->
\`\`\`yaml
schema_version: 1
state: ${prop.state}
review_cycle: ${prop.review_cycle}
full_review_count: ${prop.full_review_count}
approved_base: main
active_task_issue: "#150"
active_pr: "#151"
current_head: abcdef1
last_reviewed_head: ${prop.last_reviewed_head}
guide_version: 1.2.0
guide_source_ref: main
guide_source_sha: deadbeef
open_blockers: []
follow_up_issues: []
next_permitted_action: "${prop.next_permitted_action.replace(/"/g, '\\"')}"
material_change_status: none
updated_at: "2026-07-23T03:45:00Z"
updated_by: "Mission Control"
\`\`\`
<!-- bemoat-mission-control-state:end -->`

    const parsed = parseMissionControlState(validStateBlock)
    if (!parsed.valid) {
       violations.push({
        type: 'mission-control-drift',
        rule: 'MC-DRIFT-004',
        file: RECONCILE_SCRIPT_PATH,
        message: `Parser rejected valid proposal for ${t.verdict} at cycle ${t.cycle}. Reason: ${parsed.reason}`,
      })
    }
  }

  return violations
}

export function formatMissionControlDriftViolations(violations) {
  if (violations.length === 0) {
    return ['Mission Control drift guard passed.']
  }

  const lines = [
    'Mission Control drift guard failed:',
    '',
    'Fix the violations below, then rerun `pnpm run bemoat:guard:safety`.',
    '',
  ]

  for (const item of violations) {
    lines.push(`- [${item.rule}] ${item.file}: ${item.message}`)
  }

  return lines
}

export function isDirectExecution() {
  const entrypoint = process.argv[1]
  if (!entrypoint) return false
  return import.meta.url === pathToFileURL(resolve(entrypoint)).href
}

function main() {
  const violations = runMissionControlDriftGuard()
  const lines = formatMissionControlDriftViolations(violations)

  for (const line of lines) console.log(line)

  process.exit(violations.length > 0 ? 1 : 0)
}

if (isDirectExecution()) main()
