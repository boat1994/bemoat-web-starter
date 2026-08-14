/* eslint-disable @typescript-eslint/ban-ts-comment -- Cluster E oracle port preserves legacy .mjs implicit typing */
// @ts-nocheck
import { parseCompleteGitHubPullUrl } from '../mission-control/domain/pr-identity.ts'
import { run } from './process-runner.ts'

export function validatePinnedSpecificationResult({ authority, source, issueNumber, defaultRepo }) {
  const errors = []
  const comment = source.comment
  const expectedUrl = `https://github.com/${defaultRepo}/issues/${issueNumber}#issuecomment-${authority.specification_result_comment_id}`
  const body = String(comment?.body ?? '')
  const findingId = authority.finding_ids[0]
  if (String(comment.id) !== String(authority.specification_result_comment_id) || comment.html_url !== expectedUrl ||
      comment.user?.login !== 'boat1994' || comment.author_association !== 'OWNER' ||
      comment.created_at !== comment.updated_at) {
    errors.push('pinned Specification RESULT source metadata is missing or inconsistent')
  }
  if (!body.match(/^##\s+RESULT\s*$/m)) {
    errors.push('pinned Specification RESULT heading is missing')
  }
  if (!body.includes(findingId) || !body.includes(authority.correction_base)) {
    errors.push('pinned Specification RESULT does not bind the finding and correction base')
  }
  if (!body.includes('Smallest bounded correction scope') && !body.includes('Mutation-isolated test matrix') &&
      !body.includes('Required correction behavior')) {
    errors.push('pinned Specification RESULT does not preserve required correction behavior')
  }
  return { ok: errors.length === 0, errors, body }
}

function extractFindingThreadUrl(reviewSevenBody, findingId, defaultRepo, prNumber) {
  const escapedFinding = String(findingId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const link = String(reviewSevenBody ?? '').match(
    new RegExp(`\\[${escapedFinding}\\]\\((https://github\\.com/${defaultRepo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/pull/${prNumber}#discussion_r[0-9]+)\\)`),
  )
  if (link?.[1]) return link[1]
  const fallback = String(reviewSevenBody ?? '').match(
    new RegExp(`https://github\\.com/${defaultRepo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/pull/${prNumber}#discussion_r[0-9]+`),
  )
  return fallback?.[0] ?? null
}

export function validatePinnedReview7({ authority, source, issueNumber, defaultRepo }) {
  const errors = []
  const comment = source.comment
  const expectedUrl = `https://github.com/${defaultRepo}/issues/${issueNumber}#issuecomment-${authority.review_7_verdict_comment_id}`
  const body = String(comment?.body ?? '')
  const findingId = authority.finding_ids[0]
  const prNumber = String(authority.pr).slice(1)
  if (String(comment.id) !== String(authority.review_7_verdict_comment_id) || comment.html_url !== expectedUrl ||
      comment.user?.login !== 'boat1994' || comment.author_association !== 'OWNER' ||
      comment.created_at !== comment.updated_at) {
    errors.push('pinned Review 7 source metadata is missing or inconsistent')
  }
  if (!body.match(/^##\s+REVIEW_VERDICT\s*$/m) || !body.includes('CORRECTION REQUIRED') ||
      !body.includes(authority.correction_base) || !body.includes(`/pull/${prNumber}`) || !body.includes(findingId)) {
    errors.push('pinned Review 7 content does not bind the PR, correction base, and finding')
  }
  const threadUrl = extractFindingThreadUrl(body, findingId, defaultRepo, prNumber)
  if (!threadUrl) {
    errors.push('pinned Review 7 does not pin the original finding thread')
  }
  return { ok: errors.length === 0, errors, body, threadUrl }
}

function parseFindingFromThread(body, findingId) {
  const escaped = String(findingId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = String(body ?? '').match(
    new RegExp(`^\\*\\*${escaped}\\s+[—-]\\s+([A-Za-z]+)\\s+[—-]\\s+(.+?)\\*\\*\\s*$`, 'm'),
  )
  if (!match) return null
  return {
    id: findingId,
    severity: match[1],
    canonical_summary: match[2].trim(),
  }
}

export function validatePinnedFindingThread({ authority, source, threadUrl }) {
  const errors = []
  const comment = source.comment
  const findingId = authority.finding_ids[0]
  const expectedId = String(threadUrl ?? '').match(/#discussion_r([0-9]+)$/)?.[1] ?? null
  const prNumber = String(authority.pr).slice(1)
  if (!expectedId || String(comment.id) !== expectedId || comment.html_url !== threadUrl ||
      comment.user?.login !== 'boat1994' || comment.author_association !== 'OWNER' ||
      !String(comment.pull_request_url ?? '').endsWith(`/pulls/${prNumber}`)) {
    errors.push('pinned finding thread source metadata is missing or inconsistent')
  }
  const parsed = parseFindingFromThread(comment.body, findingId)
  if (!parsed || parsed.severity.toLowerCase() !== 'critical' || !parsed.canonical_summary) {
    errors.push('pinned finding thread does not preserve the immutable finding identity')
  }
  if (!String(comment.body ?? '').includes(findingId)) {
    errors.push('pinned finding thread content does not bind the finding ID')
  }
  return {
    ok: errors.length === 0,
    errors,
    finding: parsed
      ? {
          id: parsed.id,
          canonical_summary: parsed.canonical_summary,
          source_thread: threadUrl,
          required_evidence: [
            `Pinned S8 Founder decision ${authority.comment_id}`,
            `Specification RESULT ${authority.specification_result_comment_id}`,
            `Review 7 ${authority.review_7_verdict_comment_id}`,
            `Original finding thread ${expectedId}`,
            `Historical Review 3/HANDOFF ${authority.historical_handoff_comment_id}`,
          ],
          expected_areas: [],
          prohibited_areas: [],
        }
      : null,
  }
}

export function reconcilePinnedCurrentPr({ dispatch, state, defaultRepo, fetchPrByReference, analyzeExactHeadCi, cwd, env }) {
  if (!/^#[1-9]\d*$/.test(String(dispatch.active_pr ?? ''))) {
    return { ok: false, errors: [`BLOCKED_EXTERNAL: required Active PR evidence is unavailable: ${dispatch.active_pr ?? 'missing'}`] }
  }
  const prNumber = String(dispatch.active_pr).slice(1)
  const result = fetchPrByReference(cwd, `${defaultRepo}#${prNumber}`, env)
  if (!result.ok) return { ok: false, errors: [`live PR evidence is unavailable: ${result.reason}`] }
  const pr = result.pr
  const parsedUrl = parseCompleteGitHubPullUrl(String(pr?.url ?? ''))
  const errors = []
  if (!parsedUrl.ok || parsedUrl.identity.key !== `${defaultRepo.toLowerCase()}#${prNumber}`) {
    errors.push('live PR identity does not match current pinned authority')
  }
  const implementationHead = dispatch.implementation_head ?? dispatch.correction_base
  if (pr?.headRefOid !== implementationHead || pr?.headRefOid !== state.current_head ||
      (dispatch.branch && pr?.headRefName !== dispatch.branch) ||
      pr?.baseRefName !== state.approved_base || pr?.state !== 'OPEN' || pr?.isDraft !== true) {
    errors.push('live PR head, base, open state, or draft state does not match current replacement dispatch')
  }
  if (dispatch.authorized_replacement_base) {
    const ancestry = run('git', ['merge-base', '--is-ancestor', dispatch.authorized_replacement_base, implementationHead], { cwd, env })
    if (ancestry.status === 1) {
      errors.push('STATE CONFLICT: implementation head is unrelated to the authorized replacement base')
    } else if (ancestry.status !== 0) {
      errors.push('BLOCKED_EXTERNAL: replacement-base ancestry evidence is unavailable')
    }
  }
  const ci = analyzeExactHeadCi(pr)
  if (!ci.exactHeadVerified) errors.push(`current authority requires successful exact-head CI (${ci.summary})`)
  return { ok: errors.length === 0, errors, pr }
}
