import { parseMissionControlState } from '../mission-control-state.mjs'
import { run } from './process-runner.mjs'

const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/i

/**
 * Immutable planning-lineage base for ancestry proofs.
 * Must be an exact full commit SHA from durable state — never a mutable branch tip.
 *
 * @param {Record<string, unknown>} state
 * @returns {{ sha: string | null, missing: boolean, invalid: boolean }}
 */
export function resolvePlanningAuthorizationBaseSha(state) {
  const raw = state?.planning_authorization_base_sha
  if (raw === undefined || raw === null || raw === '') {
    return { sha: null, missing: true, invalid: false }
  }
  if (typeof raw !== 'string' || !FULL_COMMIT_SHA.test(raw.trim())) {
    return { sha: null, missing: false, invalid: true }
  }
  return { sha: raw.trim().toLowerCase(), missing: false, invalid: false }
}

/**
 * planning_no_pr durable authorization proofs.
 *
 * Ancestry contract (Option A):
 * - Current protected policy source (`approved_base` / tip) may advance independently.
 * - Ancestry requires: immutable `planning_authorization_base_sha` is an ancestor of
 *   the contract reviewed head.
 * - Do not require the current protected policy tip to be an ancestor of the
 *   historical planning reviewed head.
 * - Never resolve mutable local branch refs as lineage authority.
 */
export function verifyPlanningNoPrDurableProofs({
  cwd,
  env,
  issueBody,
  issueNumber,
  contractReviewedHead,
  branchName,
  verdictBase: _verdictBase,
}) {
  const errors = []
  const stateAnalysis = parseMissionControlState(issueBody ?? '')
  if (!stateAnalysis.present || !stateAnalysis.valid || !stateAnalysis.state) {
    errors.push('STATE CONFLICT: managed Mission Control state block is missing or invalid for planning_no_pr authorization')
    return { ok: false, errors }
  }

  const state = stateAnalysis.state
  if (state.active_pr !== null) {
    errors.push(
      `STATE CONFLICT: state block active_pr is ${JSON.stringify(state.active_pr)}, but planning_no_pr requires active_pr: null`,
    )
  }

  if (state.last_reviewed_head && state.last_reviewed_head !== contractReviewedHead) {
    errors.push('STATE CONFLICT: state last_reviewed_head does not match the immutable contract reviewed_head')
  }

  if (
    state.active_task_issue &&
    state.active_task_issue !== `#${issueNumber}` &&
    state.active_task_issue !== String(issueNumber)
  ) {
    errors.push('STATE CONFLICT: state active_task_issue does not match the correction issue number')
  }

  const localHead = run('git', ['rev-parse', 'HEAD'], { cwd, env }).stdout.trim()
  if (!localHead) {
    errors.push('STATE CONFLICT: local HEAD is unavailable for planning_no_pr authorization')
  } else if (localHead !== contractReviewedHead) {
    const ancestorCheck = run('git', ['merge-base', '--is-ancestor', contractReviewedHead, 'HEAD'], { cwd, env })
    if (ancestorCheck.status !== 0) {
      errors.push('STATE CONFLICT: local HEAD does not match reviewed_head and reviewed_head is not an ancestor of HEAD')
    }
  }

  const lineage = resolvePlanningAuthorizationBaseSha(state)
  if (lineage.missing) {
    const mutableHint =
      typeof state.approved_base === 'string' && state.approved_base.length > 0
        ? ` mutable approved_base ${JSON.stringify(state.approved_base)} is not ancestry authority`
        : ' mutable approved_base alone is not ancestry authority'
    errors.push(
      `STATE_MIGRATION_REQUIRED: planning_no_pr requires durable planning_authorization_base_sha (immutable lineage base);${mutableHint}`,
    )
  } else if (lineage.invalid) {
    errors.push(
      'STATE CONFLICT: planning_authorization_base_sha must be an exact full commit SHA (immutable lineage base)',
    )
  } else {
    const objectCheck = run('git', ['rev-parse', '--verify', `${lineage.sha}^{commit}`], { cwd, env })
    if (objectCheck.status !== 0) {
      errors.push(
        `STATE CONFLICT: planning_authorization_base_sha ${lineage.sha} is not a resolvable commit object`,
      )
    } else {
      const lineageSha = objectCheck.stdout.trim().toLowerCase()
      const onBaseCheck = run('git', ['merge-base', '--is-ancestor', lineageSha, contractReviewedHead], {
        cwd,
        env,
      })
      if (onBaseCheck.status !== 0) {
        errors.push(
          'STATE CONFLICT: reviewed_head is not safely descended from planning_authorization_base_sha',
        )
      }
    }
  }

  if (branchName && !branchName.includes(String(issueNumber))) {
    errors.push('STATE CONFLICT: current branch does not match the active planning task identity')
  }

  return { ok: errors.length === 0, errors }
}
