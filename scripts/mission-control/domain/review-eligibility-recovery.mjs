import { parseMissionControlState } from './task-state.ts'
import { hashExactBody, stableStringify } from './correction-contract-fingerprint.mjs'

const FULL_SHA = /^[0-9a-f]{40}$/i
const REVIEW_VERDICT = /^##\s+REVIEW_VERDICT\s*$/mi
const RESULT = /^##\s+RESULT\s*$/mi

function error(classification, message) {
  const result = new Error(`${classification}: ${message}`)
  result.classification = classification
  return result
}

function sha(value, label) {
  if (typeof value !== 'string' || !FULL_SHA.test(value.trim())) throw error('HEAD_DRIFT', `${label} must be a full commit SHA`)
  return value.trim().toLowerCase()
}

function id(value, label) {
  if (!/^[1-9]\d*$/.test(String(value ?? ''))) throw error('EVIDENCE_CONFLICT', `${label} must be an immutable comment ID`)
  return String(value)
}

function immutable(comment, label) {
  if (comment?.created_at != null && comment?.updated_at != null && String(comment.created_at) !== String(comment.updated_at)) {
    throw error('EVIDENCE_CONFLICT', `${label} was edited after creation`)
  }
}

function binding(body, { issueNumber, expectedPr, expectedBase }, label) {
  const text = String(body ?? '')
  if (!text.match(new RegExp(`(?:Task / Issue|Issue):\\s*#?${issueNumber}\\b`, 'i'))) throw error('EVIDENCE_CONFLICT', `${label} does not bind Issue #${issueNumber}`)
  if (!text.match(new RegExp(`(?:PR|Pull Request):[^\\n]*#?${expectedPr}\\b`, 'i')) && !text.includes(`/pull/${expectedPr}`)) throw error('EVIDENCE_CONFLICT', `${label} does not bind PR #${expectedPr}`)
  if (!new RegExp(`\\b${expectedBase}\\b`, 'i').test(text)) throw error('HEAD_DRIFT', `${label} does not bind base ${expectedBase}`)
  if (text.includes('REVIEW_VERDICT')) throw error('STATE_CONFLICT', `${label} must be a RESULT, not a review verdict`)
}

function resultHead(body) {
  const match = String(body ?? '').match(/(?:^|\n)\s*(?:Head|Exact head):\s*`?([0-9a-f]{40})`?/i)
  if (!match) throw error('EVIDENCE_CONFLICT', 'RESULT does not bind a full head SHA')
  return match[1].toLowerCase()
}

function assertMechanicalCorrection(correction, fromHead, toHead) {
  if (fromHead === toHead) return
  const files = correction?.files
  if (correction?.fromHead !== fromHead || correction?.toHead !== toHead || !Array.isArray(files) || files.length !== 1) throw error('HEAD_DRIFT', 'predecessor RESULT head is not joined to the current head by a proven correction delta')
  const file = files[0]
  if (file.filename !== 'tests/int/structural-protection.int.spec.ts' || file.status !== 'modified' || file.additions !== 1 || file.deletions !== 1 || !String(file.patch ?? '').includes('toBe(263)') || !String(file.patch ?? '').includes('toBe(264)')) throw error('EVIDENCE_CONFLICT', 'the predecessor-to-current correction is not the exact mechanical inventory synchronization')
}

function issueIdentity(comment, repository, issueNumber) {
  return comment?.issue_url === `https://api.github.com/repos/${repository}/issues/${issueNumber}`
}

function assertCi(ci, head) {
  for (const name of ['ci', 'starter-ci']) {
    const check = ci?.[name]
    if (!check || check.conclusion !== 'success' || String(check.head_sha ?? '').toLowerCase() !== head) {
      throw error('BLOCKED_EXTERNAL', `${name} is not a successful exact-head check`)
    }
  }
}

function assertNoSuperseder(comments, commentId, label) {
  for (const candidate of comments) {
    if (String(candidate?.id) === commentId) continue
    try {
      const body = JSON.parse(String(candidate?.body ?? ''))
      const ids = [body.supersedes_comment_id, ...(Array.isArray(body.supersedes_comment_ids) ? body.supersedes_comment_ids : [])]
      if (ids.some((value) => String(value) === commentId)) throw error('AUTHORITY_CONFLICT', `${label} is superseded`)
    } catch (caught) {
      if (caught?.classification) throw caught
    }
  }
}

export function reconstructReviewEligibilityState(input) {
  const {
    repository, issueNumber, expectedPr, expectedBase, expectedBaseSha,
    protectedMainSha, expectedHead, expectedBranch, issueBody, comments,
    resultComment, pullRequest, policy, ci, mechanicalCorrection,
  } = input ?? {}
  if (repository !== 'boat1994/bemoat-web-starter') throw error('STATE_CONFLICT', 'review recovery is outside the protected starter')
  const currentHead = sha(expectedHead, 'expected head')
  const recordedBase = sha(expectedBaseSha, 'recorded PR base')
  const protectedMain = sha(protectedMainSha, 'protected main')
  const parsed = parseMissionControlState(String(issueBody ?? ''))
  if (parsed.present) throw error('STATE_CONFLICT', parsed.valid ? 'a valid managed state already exists' : `managed state is malformed or partial: ${parsed.reason}`)
  if (!Array.isArray(comments)) throw error('BLOCKED_EXTERNAL', 'Issue comment pagination is incomplete')
  if (!pullRequest || Number(pullRequest.number) !== Number(expectedPr) || String(pullRequest.state).toUpperCase() !== 'OPEN' || pullRequest.isDraft === true) throw error('STATE_CONFLICT', 'live PR is not an open non-draft review target')
  if (pullRequest.baseRefName !== expectedBase || String(pullRequest.baseRefOid).toLowerCase() !== recordedBase || pullRequest.headRefName !== expectedBranch || String(pullRequest.headRefOid).toLowerCase() !== currentHead) throw error('HEAD_DRIFT', 'live PR base, branch, or head does not match the exact recovery tuple')
  if (!policy || policy.ref !== expectedBase || String(policy.commitSha).toLowerCase() !== protectedMain) throw error('HEAD_DRIFT', 'protected policy source is not read from the current protected main')
  sha(policy.sha, 'Mission Control policy blob')
  assertCi(ci, currentHead)
  if (!resultComment || !RESULT.test(String(resultComment.body ?? ''))) throw error('EVIDENCE_CONFLICT', 'the selected comment is not an immutable RESULT')
  const recordedResultHead = resultHead(resultComment.body)
  const candidates = comments.filter((comment) => {
    if (!RESULT.test(String(comment?.body ?? ''))) return false
    if (!String(comment?.body ?? '').includes(`/pull/${expectedPr}`)) return false
    return resultHead(comment.body) === recordedResultHead
  })
  if (candidates.length !== 1 || String(candidates[0].id) !== String(resultComment.id)) throw error('EVIDENCE_CONFLICT', 'exactly one immutable RESULT for the selected delivery lineage must be selected explicitly')
  if (!id(resultComment.id, 'RESULT comment') || !issueIdentity(resultComment, repository, issueNumber)) throw error('EVIDENCE_CONFLICT', 'RESULT comment is not bound to the target Issue')
  immutable(resultComment, 'RESULT comment')
  binding(resultComment.body, { repository, issueNumber, expectedPr, expectedBase, expectedHead: currentHead }, 'RESULT comment')
  assertMechanicalCorrection(mechanicalCorrection, recordedResultHead, currentHead)
  assertNoSuperseder(comments, String(resultComment.id), 'RESULT comment')
  if (comments.some((comment) => REVIEW_VERDICT.test(String(comment?.body ?? '')) && String(comment?.body ?? '').toLowerCase().includes(currentHead))) throw error('STATE_CONFLICT', 'current-head REVIEW_VERDICT evidence already exists')
  const evidence = {
    result_comment_id: String(resultComment.id),
    result_body_sha256: hashExactBody(String(resultComment.body)),
    result_head: recordedResultHead,
    live_pr_base_sha: recordedBase,
    protected_main_sha: protectedMain,
    live_pr_head: currentHead,
    policy_source_sha: sha(policy.sha, 'Mission Control policy blob'),
    ci: ['ci', 'starter-ci'],
  }
  const fingerprint = hashExactBody(stableStringify(evidence))
  return {
    schema_version: 1,
    state: 'AWAITING_REVIEW_1',
    review_cycle: 0,
    full_review_count: 0,
    approved_base: expectedBase,
    active_task_issue: `#${issueNumber}`,
    active_pr: `#${expectedPr}`,
    current_head: currentHead,
    last_reviewed_head: null,
    workflow_mode: 'implementation_pr',
    guide_version: policy.guideVersion,
    guide_source_ref: policy.ref,
    guide_source_sha: sha(policy.sha, 'Mission Control policy blob'),
    latest_review_verdict_comment_id: null,
    open_blockers: [],
    follow_up_issues: [],
    next_permitted_action: `Publish the ordinary exact-head review through bemoat:mission-control:review for Issue #${issueNumber}; do not infer a verdict.`,
    material_change_status: 'none',
    updated_at: resultComment.created_at ?? null,
    updated_by: 'Mission Control Missing-State Review Recovery',
    recovery_base_binding: {
      recorded_pr_base_sha: recordedBase,
      protected_main_sha: protectedMain,
    },
    recovery_evidence_fingerprint: fingerprint,
  }
}
