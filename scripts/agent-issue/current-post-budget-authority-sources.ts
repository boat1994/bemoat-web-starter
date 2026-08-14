import { parseCompleteGitHubPullUrl } from '../mission-control/domain/pr-identity.ts'
import { parseMissionControlState } from '../mission-control/domain/task-state.ts'
import type {
  AnalyzeExactHeadCi,
  AuthorityRecord,
  DecisionRecord,
  DispatchRecord,
  FetchPrByReference,
  GitHubIssueComment,
  IssueCommentFetchSuccess,
  LivePullRequestEvidence,
  PinnedFinding,
  PullReviewCommentFetchSuccess,
  ValidationResult,
} from './authority-domain-types.ts'
import {
  findExactlyOnePinnedComment,
  isPlainObject,
  readLegacyField,
} from './authority-domain-types.ts'
import { run } from './process-runner.ts'
import { createHash } from 'node:crypto'

type MissionControlStateValue = NonNullable<ReturnType<typeof parseMissionControlState>['state']>

export function validatePinnedSpecificationResult({
  authority,
  source,
  issueNumber,
  defaultRepo,
}: {
  authority: AuthorityRecord
  source: IssueCommentFetchSuccess
  issueNumber: number
  defaultRepo: string
}): ValidationResult & { body: string } {
  const errors: string[] = []
  const comment = source.comment
  const expectedUrl = `https://github.com/${defaultRepo}/issues/${issueNumber}#issuecomment-${authority.specification_result_comment_id}`
  const body = String(comment?.body ?? '')
  const findingId = (authority.finding_ids ?? [])[0] ?? ''
  if (String(comment.id) !== String(authority.specification_result_comment_id) || comment.html_url !== expectedUrl ||
      comment.user?.login !== 'boat1994' || comment.author_association !== 'OWNER' ||
      comment.created_at !== comment.updated_at) {
    errors.push('pinned Specification RESULT source metadata is missing or inconsistent')
  }
  if (!body.match(/^##\s+RESULT\s*$/m)) {
    errors.push('pinned Specification RESULT heading is missing')
  }
  if (!body.includes(findingId) || !body.includes(String(authority.correction_base ?? ''))) {
    errors.push('pinned Specification RESULT does not bind the finding and correction base')
  }
  if (!body.includes('Smallest bounded correction scope') && !body.includes('Mutation-isolated test matrix') &&
      !body.includes('Required correction behavior')) {
    errors.push('pinned Specification RESULT does not preserve required correction behavior')
  }
  return { ok: errors.length === 0, errors, body }
}

function extractFindingThreadUrl(
  reviewSevenBody: string,
  findingId: string,
  defaultRepo: string,
  prNumber: string,
): string | null {
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

export function validatePinnedReview7({
  authority,
  source,
  issueNumber,
  defaultRepo,
}: {
  authority: AuthorityRecord
  source: IssueCommentFetchSuccess
  issueNumber: number
  defaultRepo: string
}): ValidationResult & { body: string; threadUrl: string | null } {
  const errors: string[] = []
  const comment = source.comment
  const expectedUrl = `https://github.com/${defaultRepo}/issues/${issueNumber}#issuecomment-${authority.review_7_verdict_comment_id}`
  const body = String(comment?.body ?? '')
  const findingId = (authority.finding_ids ?? [])[0] ?? ''
  const prNumber = String(authority.pr).slice(1)
  if (String(comment.id) !== String(authority.review_7_verdict_comment_id) || comment.html_url !== expectedUrl ||
      comment.user?.login !== 'boat1994' || comment.author_association !== 'OWNER' ||
      comment.created_at !== comment.updated_at) {
    errors.push('pinned Review 7 source metadata is missing or inconsistent')
  }
  if (!body.match(/^##\s+REVIEW_VERDICT\s*$/m) || !body.includes('CORRECTION REQUIRED') ||
      !body.includes(String(authority.correction_base ?? '')) || !body.includes(`/pull/${prNumber}`) || !body.includes(findingId)) {
    errors.push('pinned Review 7 content does not bind the PR, correction base, and finding')
  }
  const threadUrl = extractFindingThreadUrl(body, findingId, defaultRepo, prNumber)
  if (!threadUrl) {
    errors.push('pinned Review 7 does not pin the original finding thread')
  }
  return { ok: errors.length === 0, errors, body, threadUrl }
}

function parseFindingFromThread(body: string | null | undefined, findingId: string): {
  id: string
  severity: string
  canonical_summary: string
} | null {
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

export function validatePinnedFindingThread({
  authority,
  source,
  threadUrl,
}: {
  authority: AuthorityRecord
  source: PullReviewCommentFetchSuccess
  threadUrl: string | null
}): ValidationResult & { finding: PinnedFinding | null } {
  const errors: string[] = []
  const comment = source.comment
  const findingId = (authority.finding_ids ?? [])[0] ?? ''
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
          expected_areas: [] as string[],
          prohibited_areas: [] as string[],
        }
      : null,
  }
}

export function reconcilePinnedCurrentPr({
  dispatch,
  state,
  defaultRepo,
  fetchPrByReference,
  analyzeExactHeadCi,
  cwd,
  env,
}: {
  dispatch: DispatchRecord
  state: MissionControlStateValue
  defaultRepo: string
  fetchPrByReference: FetchPrByReference
  analyzeExactHeadCi: AnalyzeExactHeadCi
  cwd: string
  env: NodeJS.ProcessEnv
}): ValidationResult & { pr?: LivePullRequestEvidence } {
  if (!/^#[1-9]\d*$/.test(String(dispatch.active_pr ?? ''))) {
    return { ok: false, errors: [`BLOCKED_EXTERNAL: required Active PR evidence is unavailable: ${dispatch.active_pr ?? 'missing'}`] }
  }
  const prNumber = String(dispatch.active_pr).slice(1)
  const result = fetchPrByReference(cwd, `${defaultRepo}#${prNumber}`, env)
  if (!result.ok) {
    const reason = 'reason' in result ? result.reason : 'GitHub PR lookup failed.'
    return { ok: false, errors: [`live PR evidence is unavailable: ${reason}`] }
  }
  const pr: LivePullRequestEvidence = result.pr
  const parsedUrl = parseCompleteGitHubPullUrl(String(pr.url ?? ''))
  const errors: string[] = []
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
    const ancestry = run('git', ['merge-base', '--is-ancestor', String(dispatch.authorized_replacement_base ?? ''), String(implementationHead ?? '')], { cwd, env })
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

export function validateReplacementDispatchSource({
  authority,
  decision,
  dispatch,
  comments,
  issueNumber,
  defaultRepo,
}: {
  authority: AuthorityRecord
  decision: DecisionRecord
  dispatch: DispatchRecord
  comments: GitHubIssueComment[]
  issueNumber: number
  defaultRepo: string
}): ValidationResult {
  const errors: string[] = []
  const comment = findExactlyOnePinnedComment(comments, String(dispatch.handoff_comment_id ?? ''))
  const body = String(comment?.body ?? '')
  if (!comment || comment.author !== 'boat1994' ||
      String(comment.url ?? '').toLowerCase() !==
        `https://github.com/${defaultRepo}/issues/${issueNumber}#issuecomment-${dispatch.handoff_comment_id}`.toLowerCase()) {
    errors.push('STATE CONFLICT: current replacement HANDOFF source identity is missing or inconsistent')
  }
  const requiredValues = [
    '## HANDOFF',
    '**Target:** Dev / Correction Builder',
    `**Repository:** \`${defaultRepo}\``,
    `**Issue:** #${issueNumber}`,
    `**Superseded PR:** ${authority.pr}`,
    `**Exact correction base:** \`${dispatch.correction_base}\``,
    `**Finding scope:** exactly \`${(authority.finding_ids ?? [])[0] ?? ''}\``,
    `**Founder migration authority:** ${authority.comment_id}`,
    `**Specification RESULT:** ${authority.specification_result_comment_id}`,
    `**Review 7 verdict:** ${authority.review_7_verdict_comment_id}`,
    '**Historical Review 3 evidence:** consumed lineage evidence only',
    '**Review 8:** No Review 8 is authorized or started',
  ]
  for (const value of requiredValues) {
    if (!body.includes(value)) errors.push(`STATE CONFLICT: current replacement HANDOFF is missing semantic binding ${value}`)
  }
  if (!String(decision.action ?? '').includes(String(authority.pr ?? '')) ||
      !String(decision.action ?? '').includes(String(dispatch.correction_base ?? '')) ||
      !String(decision.action ?? '').includes(String((authority.finding_ids ?? [])[0] ?? ''))) {
    errors.push('STATE CONFLICT: Founder base-change action does not bind the old PR, current head, and finding')
  }
  return { ok: errors.length === 0, errors }
}

export function validateHistoricalAuthority({
  state,
  authority,
  comments,
  historicalHandoff,
  historicalReviewThree,
  issueNumber,
  defaultRepo,
}: {
  state: MissionControlStateValue
  authority: AuthorityRecord
  comments: GitHubIssueComment[]
  historicalHandoff: IssueCommentFetchSuccess
  historicalReviewThree: IssueCommentFetchSuccess
  issueNumber: number
  defaultRepo: string
}): ValidationResult {
  const errors: string[] = []
  const historicalValue = state.founder_correction_authorization
  const reviewThree = findExactlyOnePinnedComment(comments, String(authority.historical_review_3_source_comment_id ?? ''))
  const expectedHandoffUrl = `https://github.com/${defaultRepo}/issues/${issueNumber}#issuecomment-${authority.historical_handoff_comment_id}`
  if (!historicalValue || readLegacyField(historicalValue, 'authorization_id') !== authority.historical_authorization_id ||
      readLegacyField(historicalValue, 'reviewed_head') !== authority.historical_reviewed_head ||
      readLegacyField(historicalValue, 'action') !== authority.historical_action ||
      readLegacyField(historicalValue, 'authorized_at') !== authority.historical_authorized_at ||
      readLegacyField(historicalValue, 'handoff_comment_id') !== authority.historical_handoff_comment_id ||
      JSON.stringify(readLegacyField(historicalValue, 'finding_ids')) !== JSON.stringify(authority.historical_finding_ids)) {
    errors.push('STATE CONFLICT: historical Review 3 authorization does not match the pinned migration authority')
  }
  if (!reviewThree || !String(reviewThree.url ?? '').endsWith(`#issuecomment-${authority.historical_review_3_source_comment_id}`)) {
    errors.push('STATE CONFLICT: pinned historical Review 3 source identity is missing or inconsistent')
  }
  const reviewThreeComment = historicalReviewThree.comment
  const reviewThreeBody = String(reviewThreeComment?.body ?? '')
  if (String(reviewThreeComment?.id) !== String(authority.historical_review_3_source_comment_id) ||
      !/^##\s+REVIEW_VERDICT\s*$/m.test(reviewThreeBody) ||
      !reviewThreeBody.includes('Phase: Bounded Delta Review 3') ||
      !reviewThreeBody.includes('BLOCKED FOR FOUNDER DECISION') ||
      !reviewThreeBody.includes(`/pull/${String(authority.pr).slice(1)}`) ||
      !reviewThreeBody.includes(String(authority.historical_reviewed_head ?? '')) ||
      !(authority.historical_finding_ids ?? []).every((findingId) => reviewThreeBody.includes(findingId)) ||
      !/Do not start Review 4/i.test(reviewThreeBody)) {
    errors.push('STATE CONFLICT: pinned historical Review 3 source is semantically inconsistent')
  }
  const handoff = historicalHandoff.comment
  const handoffBody = String(handoff?.body ?? '')
  if (String(handoff.id) !== String(authority.historical_handoff_comment_id) || handoff.html_url !== expectedHandoffUrl ||
      handoff.user?.login !== 'boat1994' || handoff.author_association !== 'OWNER' ||
      readLegacyField(historicalValue, 'handoff_url') !== expectedHandoffUrl || !handoffBody.match(/^##\s+HANDOFF\s*$/m)) {
    errors.push('STATE CONFLICT: pinned historical HANDOFF source identity is missing or inconsistent')
  }
  const bindingValue = readLegacyField(historicalValue, 'handoff_binding')
  const binding = isPlainObject(bindingValue) ? bindingValue : null
  const phase = handoffBody.match(/^\* Phase:\s*(.+)$/m)?.[1]?.trim() ?? null
  const target = handoffBody.match(/^\*\*Target:\*\*\s*(.+)$/m)?.[1]?.trim() ?? null
  const scope = handoffBody.match(/^\*\*Scope:\*\*\s*(.+)$/m)?.[1]?.trim() ?? null
  const taskIssue = handoffBody.match(/^\* Task \/ Issue:\s*(#[1-9]\d*)$/m)?.[1] ?? null
  const heads = [...new Set([...handoffBody.matchAll(/\bPR head\s+`([0-9a-f]{40})`/gi)].map((match) => match[1]))]
  const prs = [...new Set([...handoffBody.matchAll(/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/gi)]
    .map((match) => `${match[1]}#${match[2]}`))]
  const findings = [...new Set(handoffBody.match(/MC-R[0-9A-Za-z-]+/g) ?? [])]
  const correctionScope = scope && /Bind the planning contract/i.test(scope) && /canonical repository/i.test(scope) &&
    /protected branch/i.test(scope) && /preserve/i.test(scope)
  if (phase !== 'Founder-authorized correction after Review 3' || target !== 'Dev / Correction Builder' ||
      !correctionScope || taskIssue !== `#${issueNumber}` ||
      JSON.stringify(heads) !== JSON.stringify([authority.historical_reviewed_head]) ||
      JSON.stringify(prs) !== JSON.stringify([`${defaultRepo}#${String(authority.pr).slice(1)}`]) ||
      JSON.stringify(findings) !== JSON.stringify(authority.historical_finding_ids) ||
      !/prohibition on Review 4/i.test(handoffBody) || !/Do not[^\n.]*start Review 4/i.test(handoffBody)) {
    errors.push('STATE CONFLICT: historical HANDOFF Phase, Target, Scope, issue, PR, head, finding set, or Review 4 prohibition is inconsistent')
  }
  const expectedSnapshot = {
    authorization_id: readLegacyField(historicalValue, 'authorization_id'),
    authority: 'Founder',
    status: 'authorized',
    action: readLegacyField(historicalValue, 'action'),
    authorized_at: readLegacyField(historicalValue, 'authorized_at'),
    scope: 'correction',
    for_review_number: 3,
    reviewed_head: readLegacyField(historicalValue, 'reviewed_head'),
    finding_ids: readLegacyField(historicalValue, 'finding_ids'),
  }
  const expectedBinding = {
    authorization_id: readLegacyField(historicalValue, 'authorization_id'),
    target: 'Dev / Correction Builder',
    active_pr: authority.pr,
    exact_head: readLegacyField(historicalValue, 'reviewed_head'),
    correction_base: readLegacyField(historicalValue, 'reviewed_head'),
    review_number: 3,
    scope: 'correction',
    finding_ids: readLegacyField(historicalValue, 'finding_ids'),
    handoff_comment_id: String(authority.historical_handoff_comment_id),
    handoff_created_at: handoff.created_at,
    handoff_updated_at: handoff.updated_at,
  }
  if (!binding || JSON.stringify(binding.authorization_snapshot) !== JSON.stringify(expectedSnapshot) ||
      Object.entries(expectedBinding).some(([key, value]) => JSON.stringify(binding[key]) !== JSON.stringify(value))) {
    errors.push('STATE CONFLICT: historical HANDOFF binding does not preserve the complete authorization semantics and timestamps')
  } else {
    if (binding.content_sha256 !== createHash('sha256').update(handoffBody).digest('hex')) {
      errors.push('STATE CONFLICT: historical HANDOFF content hash does not match the pinned source')
    }
    const { binding_sha256: recordedFingerprint, ...bindingPayload } = binding
    if (recordedFingerprint !== createHash('sha256').update(JSON.stringify(bindingPayload)).digest('hex')) {
      errors.push('STATE CONFLICT: historical HANDOFF binding fingerprint is invalid')
    }
  }
  return { ok: errors.length === 0, errors }
}
