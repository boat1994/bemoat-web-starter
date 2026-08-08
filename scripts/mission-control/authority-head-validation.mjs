import { spawnSync } from 'node:child_process'
import {
  normalizeAuthorityBase,
  normalizeAuthorityHead,
} from './review-verdict-binding.mjs'

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

/**
 * Prove the reviewed head is contained in the current protected base.
 * Mirrors merge-transport containment: compare(commit...base) is ahead|identical.
 */
export function assertReviewedHeadContainedInProtectedMain({
  repo,
  base,
  commit,
  runGh = (args, options) => run('gh', args, options),
}) {
  if (!repo || !base || !commit) {
    throw new Error('STATE_CONFLICT: protected main containment proof is missing repo/base/commit')
  }
  const comparison = JSON.parse(runGh(['api', `repos/${repo}/compare/${commit}...${base}`]))
  if (comparison?.status !== 'ahead' && comparison?.status !== 'identical') {
    throw new Error(
      `STATE_CONFLICT: reviewed head ${commit} is not contained in protected ${base}`,
    )
  }
  return true
}

/**
 * Accept OPEN PRs unchanged, or MERGED PRs only when exact managed heads match
 * and the reviewed head is contained in protected main. Fail closed otherwise.
 */
export function assertManagedActivePrForReviewVerdictReconciliation({
  state,
  pr,
  repo,
  runGh = (args, options) => run('gh', args, options),
}) {
  const prNumber = String(state.active_pr).replace(/^#/, '')
  if (
    String(pr.number) !== prNumber ||
    normalizeAuthorityBase(pr.baseRefName) !== normalizeAuthorityBase(state.approved_base)
  ) {
    throw new Error('STATE_CONFLICT: managed active PR or approved base does not match live PR')
  }
  const liveHead = normalizeAuthorityHead(pr.headRefOid)
  if (
    liveHead !== normalizeAuthorityHead(state.current_head) ||
    liveHead !== normalizeAuthorityHead(state.last_reviewed_head)
  ) {
    throw new Error('STATE_CONFLICT: managed exact head does not match live PR head')
  }

  const prState = String(pr.state).toUpperCase()
  if (prState === 'OPEN') return { mode: 'open' }
  if (prState === 'MERGED') {
    assertReviewedHeadContainedInProtectedMain({
      repo,
      base: state.approved_base,
      commit: pr.headRefOid,
      runGh,
    })
    return { mode: 'merged' }
  }
  throw new Error('STATE_CONFLICT: managed active PR or approved base does not match live PR')
}
