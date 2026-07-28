import { parseMissionControlState } from '../mission-control-state.mjs'
import { run } from './process-runner.mjs'

export function verifyPlanningNoPrDurableProofs({
  cwd,
  env,
  issueBody,
  issueNumber,
  contractReviewedHead,
  branchName,
  verdictBase,
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

  const approvedBase = state.approved_base || verdictBase
  if (!approvedBase) {
    errors.push('STATE CONFLICT: approved_base is required for planning_no_pr ancestry proof')
  } else {
    const baseRef = run('git', ['rev-parse', '--verify', approvedBase], { cwd, env })
    if (baseRef.status !== 0) {
      errors.push(`STATE CONFLICT: approved_base ${approvedBase} is not a valid git ref`)
    } else {
      const baseSha = baseRef.stdout.trim()
      const onBaseCheck = run('git', ['merge-base', '--is-ancestor', baseSha, contractReviewedHead], { cwd, env })
      if (onBaseCheck.status !== 0) {
        errors.push('STATE CONFLICT: reviewed_head is not safely descended from approved_base')
      }
    }
  }

  if (branchName && !branchName.includes(String(issueNumber))) {
    errors.push('STATE CONFLICT: current branch does not match the active planning task identity')
  }

  return { ok: errors.length === 0, errors }
}
