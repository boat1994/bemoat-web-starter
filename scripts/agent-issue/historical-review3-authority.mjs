import { createHash } from 'node:crypto'
import { findLatestRoleComment } from '../mission-control-reconcile.mjs'
import { parseMissionControlState } from '../mission-control-state.mjs'
import { validatePinnedFounderDecision } from './current-post-budget-authority.mjs'

export function parseHandoffCommentSemanticPayload(body, expectedRepo, expectedIssue) {
  const lines = body.split('\n')
  const payload = {}
  const stateKeys = new Set()
  const errors = []

  const addKey = (key, value) => {
    if (stateKeys.has(key)) {
      errors.push(`STATE CONFLICT: duplicate ${key} in HANDOFF`)
    } else {
      stateKeys.add(key)
      payload[key] = value
    }
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    let match

    if ((match = trimmed.match(/^[* -]?\s*Phase:\s*(.+)$/i))) {
      addKey('phase', match[1].trim())
      continue
    }

    if ((match = trimmed.match(/^[* -]?\s*Authorization:\s*`([^`]+)`$/i))) {
      addKey('authorization_id', match[1].trim())
      continue
    }

    if ((match = trimmed.match(/^[* -]?\s*Task \/ Issue:\s*(.+)$/i))) {
      addKey('task_issue', match[1].trim())
      continue
    }

    if ((match = trimmed.match(/^\*\*Target:\*\*\s*(.+)$/i))) {
      addKey('target', match[1].trim())
      continue
    }

    if ((match = trimmed.match(/^\*\*Scope:\*\*\s*(.+)$/i))) {
      addKey('scope', match[1].trim())
      continue
    }

    if ((match = trimmed.match(/^PR head\s+`([a-fA-F0-9]{40})`$/i))) {
      addKey('exact_reviewed_head', match[1])
      continue
    }

    if ((match = trimmed.match(/^finding\s+`([A-Z0-9-]+)`$/i))) {
      if (!payload.findings) {
        payload.findings = []
        stateKeys.add('findings')
      }
      if (payload.findings.includes(match[1])) {
        errors.push(`STATE CONFLICT: duplicate finding ${match[1]} in HANDOFF`)
      } else {
        payload.findings.push(match[1])
      }
      continue
    }

    if (/^prohibition on Review 4$/i.test(trimmed)) {
      addKey('review_4_prohibition', true)
      continue
    }

    if ((match = trimmed.match(/^github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)$/i))) {
      addKey('pr_repository', match[1])
      addKey('pr_number', match[2])
      continue
    }
    if ((match = trimmed.match(/^PR\s+#(\d+)$/i))) {
      addKey('pr_repository', expectedRepo)
      addKey('pr_number', match[1])
      continue
    }
  }

  if (!stateKeys.has('exact_reviewed_head')) {
    const heads = [...body.matchAll(/\bPR head\s+`([a-fA-F0-9]{40})`/gi)].map((match) => match[1])
    const uniqueHeads = [...new Set(heads)]
    if (uniqueHeads.length === 1) addKey('exact_reviewed_head', uniqueHeads[0])
    if (uniqueHeads.length > 1) errors.push('STATE CONFLICT: conflicting exact_reviewed_head values in HANDOFF')
  }

  if (!stateKeys.has('findings')) {
    const findings = [...new Set(body.match(/MC-R[0-9A-Za-z-]+/g) ?? [])]
    if (findings.length > 0) {
      stateKeys.add('findings')
      payload.findings = findings
    }
  }

  if (!stateKeys.has('review_4_prohibition') &&
      (/prohibition on Review 4/i.test(body) || /Do not[^\n.]*start Review 4/i.test(body))) {
    addKey('review_4_prohibition', true)
  }

  if (!stateKeys.has('pr_repository')) {
    const pullIdentities = [...body.matchAll(/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/gi)]
      .map((match) => `${match[1]}#${match[2]}`)
    const uniquePullIdentities = [...new Set(pullIdentities)]
    if (uniquePullIdentities.length === 1) {
      const [repository, prNumber] = uniquePullIdentities[0].split('#')
      addKey('pr_repository', repository)
      addKey('pr_number', prNumber)
    }
    if (uniquePullIdentities.length > 1) errors.push('STATE CONFLICT: conflicting PR identities in HANDOFF')
  }

  const requiredKeys = ['phase', 'authorization_id', 'task_issue', 'target', 'scope', 'exact_reviewed_head', 'findings', 'review_4_prohibition', 'pr_repository', 'pr_number']
  for (const key of requiredKeys) {
    if (!stateKeys.has(key)) {
      errors.push(`STATE CONFLICT: missing ${key} in HANDOFF`)
    }
  }

  if (errors.length > 0) return { ok: false, errors }

  if (payload.task_issue !== expectedIssue) {
    errors.push(`STATE CONFLICT: HANDOFF issue ${payload.task_issue} does not match expected ${expectedIssue}`)
  }

  if (payload.pr_repository !== expectedRepo) {
    errors.push(`STATE CONFLICT: PR identity repository ${payload.pr_repository} does not match canonical repository ${expectedRepo}`)
  }

  payload.pr_identity = `github.com/${payload.pr_repository}/pull/${payload.pr_number}`

  if (errors.length > 0) return { ok: false, errors }

  return { ok: true, payload }
}

export function verifyReviewThreeCorrectionAuthorization({
  issueBody,
  contract,
  comments,
  issueNumber,
  defaultRepo,
  cwd,
  env,
  fetchIssueCommentById,
}) {
  const parsed = parseMissionControlState(issueBody ?? '')
  const managedRequired = /Mission\s+Control\s+mode:\s*required/i.test(issueBody ?? '')
  if (!parsed.present || !parsed.valid || !parsed.state) {
    if (managedRequired || parsed.present) {
      return { ok: false, errors: ['STATE CONFLICT: managed Mission Control state is missing or invalid for correction authorization'] }
    }
    return { ok: true, errors: [], reviewThree: false }
  }
  const state = parsed.state
  const authorization = state.founder_correction_authorization
  const requiresReviewThreeAuthority = Boolean(authorization) || state.review_cycle === 3 ||
    (state.full_review_count === 1 && state.state === 'IN_PROGRESS')
  if (!requiresReviewThreeAuthority) return { ok: true, errors: [], reviewThree: false }

  if (state.review_cycle !== 3 || state.full_review_count !== 1) {
    return { ok: false, errors: ['STATE CONFLICT: Review 3 correction must preserve counters 3/1'] }
  }
  if (state.state !== 'IN_PROGRESS' || !authorization || authorization.status !== 'consumed') {
    return { ok: false, errors: ['STATE CONFLICT: Review 3 correction requires a consumed Founder correction authorization'] }
  }

  const s8 = state.founder_migration_authority
  if (authorization.schema_version === 2 && !s8) {
    return { ok: false, errors: ['STATE MIGRATION REQUIRED: historical authorization action and timestamp lack immutable Founder approval'] }
  }
  if (s8) {
    const s8StateErrors = []
    if (s8.schema_version !== 3 || s8.status !== 'consumed' || s8.authority !== 'Founder' || s8.scope !== 'correction') {
      s8StateErrors.push('STATE CONFLICT: historical migration proof must be a consumed Founder schema-version 3 correction authority')
    }
    if (s8.canonical_repository !== defaultRepo || s8.issue !== `#${issueNumber}` || s8.pr !== state.active_pr) {
      s8StateErrors.push('STATE CONFLICT: historical migration proof does not bind the canonical repository, issue, and PR')
    }
    if (!/^[0-9a-f]{64}$/.test(String(s8.content_sha256 ?? '')) ||
        !/^[1-9]\d*$/.test(String(s8.comment_id ?? '')) ||
        !/^[1-9]\d*$/.test(String(s8.specification_result_comment_id ?? '')) ||
        !/^[1-9]\d*$/.test(String(s8.review_7_verdict_comment_id ?? '')) ||
        !/^[1-9]\d*$/.test(String(s8.historical_review_3_source_comment_id ?? '')) ||
        String(s8.historical_handoff_comment_id) !== String(authorization.handoff_comment_id)) {
      s8StateErrors.push('STATE CONFLICT: historical migration proof is missing an immutable source ID or content hash')
    }
    if (s8.historical_authorization_id !== authorization.authorization_id ||
        s8.historical_reviewed_head !== authorization.reviewed_head ||
        s8.historical_action !== authorization.action || s8.historical_authorized_at !== authorization.authorized_at ||
        JSON.stringify(s8.historical_finding_ids) !== JSON.stringify(authorization.finding_ids) ||
        JSON.stringify(s8.finding_ids) !== JSON.stringify(contract.findings.map((finding) => finding.id))) {
      s8StateErrors.push('STATE CONFLICT: historical migration proof does not bind the exact Review 3 authorization and finding set')
    }
    if (s8StateErrors.length > 0) return { ok: false, errors: s8StateErrors }
    if (typeof fetchIssueCommentById !== 'function') {
      return { ok: false, errors: ['STATE CONFLICT: historical migration proof source lookup is unavailable'] }
    }
    const s8Source = fetchIssueCommentById(cwd, s8.comment_id, env)
    if (!s8Source.ok) {
      return { ok: false, errors: ['STATE CONFLICT: pinned Founder migration authority source is unavailable'] }
    }
    const sourceCheck = validatePinnedFounderDecision({ authority: s8, source: s8Source, issueNumber, defaultRepo })
    if (!sourceCheck.ok) return { ok: false, errors: sourceCheck.errors }

    const reviewThreeSource = fetchIssueCommentById(cwd, s8.historical_review_3_source_comment_id, env)
    const reviewThreeBody = String(reviewThreeSource.comment?.body ?? '')
    if (!reviewThreeSource.ok ||
        String(reviewThreeSource.comment?.id) !== String(s8.historical_review_3_source_comment_id) ||
        !/^##\s+REVIEW_VERDICT\s*$/m.test(reviewThreeBody) ||
        !reviewThreeBody.includes('Phase: Bounded Delta Review 3') ||
        !reviewThreeBody.includes('BLOCKED FOR FOUNDER DECISION') ||
        !reviewThreeBody.includes(`/pull/${String(s8.pr).slice(1)}`) ||
        !reviewThreeBody.includes(s8.historical_reviewed_head) ||
        !s8.historical_finding_ids.every((findingId) => reviewThreeBody.includes(findingId)) ||
        !/Do not start Review 4/i.test(reviewThreeBody)) {
      return { ok: false, errors: ['STATE CONFLICT: pinned historical Review 3 source is missing or semantically inconsistent'] }
    }
  }

  if (authorization.for_review_number !== 3 || authorization.reviewed_head !== contract.reviewed_head ||
      authorization.reviewed_head !== state.last_reviewed_head || authorization.reviewed_head !== state.current_head) {
    return { ok: false, errors: ['STATE CONFLICT: Founder correction authorization does not bind the Review 3 exact head'] }
  }
  const authorizedIds = [...authorization.finding_ids ?? []].sort()
  const contractIds = contract.findings.map((finding) => finding.id).sort()
  if (JSON.stringify(authorizedIds) !== JSON.stringify(contractIds)) {
    return { ok: false, errors: ['STATE CONFLICT: Founder correction authorization finding IDs do not match the immutable contract'] }
  }

  const latestHandoff = findLatestRoleComment(comments, 'HANDOFF')
  const handoff = comments.find((comment) => String(comment.id) === String(authorization.handoff_comment_id))

  if (!handoff || String(latestHandoff?.comment?.id) !== String(authorization.handoff_comment_id) ||
      !/##\s+HANDOFF\s*$/m.test(handoff.body ?? '')) {
    return { ok: false, errors: ['STATE CONFLICT: Founder correction authorization is not bound to its exact active HANDOFF'] }
  }

  const binding = authorization.handoff_binding

  if (authorization.schema_version === 2 || authorization.schema_version === 3) {
    const handoffBody = handoff.body ?? ''
    const contentSha256 = createHash('sha256').update(handoffBody).digest('hex')

    const parsedHandoff = parseHandoffCommentSemanticPayload(handoffBody, defaultRepo, `#${issueNumber}`)
    if (!parsedHandoff.ok) {
      return { ok: false, errors: parsedHandoff.errors }
    }
    const payload = parsedHandoff.payload

    const expectedPr = state.active_pr
    const expectedPrMatch = expectedPr ? expectedPr.match(/(\d+)$/) : null
    const expectedPrNumber = expectedPrMatch ? expectedPrMatch[1] : null
    if (expectedPrNumber && payload.pr_number !== expectedPrNumber) {
      return { ok: false, errors: [`STATE CONFLICT: HANDOFF PR identity does not match active PR ${expectedPr} in ${defaultRepo}`] }
    }
    if (payload.authorization_id !== authorization.authorization_id) {
      return { ok: false, errors: ['STATE CONFLICT: HANDOFF authorization ID must occur exactly once and match historical authorization'] }
    }

    if (payload.phase !== 'Founder-authorized correction after Review 3') {
      return { ok: false, errors: ['STATE CONFLICT: HANDOFF Phase does not match Founder-authorized correction after Review 3'] }
    }
    if (payload.target !== binding?.target) {
      return { ok: false, errors: ['STATE CONFLICT: HANDOFF Target does not match the immutable dispatch target'] }
    }
    const correctionScope = payload.scope === 'correction' ||
      (/Bind the planning contract/i.test(payload.scope) && /canonical repository/i.test(payload.scope) &&
       /protected branch/i.test(payload.scope) && /preserve/i.test(payload.scope))
    if (!correctionScope) {
      return { ok: false, errors: ['STATE CONFLICT: HANDOFF Scope does not describe the authorized correction scope'] }
    }
    if (payload.exact_reviewed_head !== authorization.reviewed_head) {
      return { ok: false, errors: ['STATE CONFLICT: HANDOFF exact head does not match the historical Review 3 authorization'] }
    }
    if (JSON.stringify(payload.findings) !== JSON.stringify(authorization.finding_ids)) {
      return { ok: false, errors: ['STATE CONFLICT: HANDOFF finding set does not match the exact historical authorization finding set'] }
    }
    if (payload.review_4_prohibition !== true) {
      return { ok: false, errors: ['STATE CONFLICT: HANDOFF does not preserve the Review 4 prohibition'] }
    }

    if (s8) {
      if (s8.historical_authorization_id !== payload.authorization_id) {
        return { ok: false, errors: ['STATE CONFLICT: authorization snapshot authority does not match HANDOFF Founder-authorized phase'] }
      }
      if (s8.historical_reviewed_head !== payload.exact_reviewed_head) {
        return { ok: false, errors: ['STATE CONFLICT: authorization snapshot review number does not match Review 3 HANDOFF'] }
      }
      if (s8.historical_action !== authorization.action) {
        return { ok: false, errors: ['STATE CONFLICT: authorization snapshot action does not match Founder-approved migration'] }
      }
      if (s8.historical_authorized_at !== authorization.authorized_at) {
        return { ok: false, errors: ['STATE CONFLICT: authorization snapshot timestamp does not match Founder-approved migration'] }
      }
    }

    if (!binding) {
      return { ok: false, errors: ['STATE CONFLICT: immutable Founder correction HANDOFF binding does not match live content'] }
    }

    const expectedSnapshot = {
      authorization_id: authorization.authorization_id,
      authority: 'Founder',
      status: 'authorized',
      action: authorization.action,
      authorized_at: authorization.authorized_at,
      scope: 'correction',
      for_review_number: 3,
      reviewed_head: authorization.reviewed_head,
      finding_ids: authorization.finding_ids,
    }
    if (JSON.stringify(binding.authorization_snapshot) !== JSON.stringify(expectedSnapshot)) {
      return { ok: false, errors: ['STATE CONFLICT: authorization snapshot does not match the complete historical Founder authorization'] }
    }
    const expectedBindingFields = {
      authorization_id: authorization.authorization_id,
      target: payload.target,
      active_pr: state.active_pr,
      exact_head: authorization.reviewed_head,
      correction_base: authorization.reviewed_head,
      review_number: 3,
      scope: 'correction',
      finding_ids: authorization.finding_ids,
      handoff_comment_id: String(authorization.handoff_comment_id),
    }
    for (const [key, value] of Object.entries(expectedBindingFields)) {
      if (JSON.stringify(binding[key]) !== JSON.stringify(value)) {
        return { ok: false, errors: [`STATE CONFLICT: HANDOFF binding ${key} does not match the historical authorization` ] }
      }
    }

    if (binding.content_sha256 !== contentSha256) {
      return { ok: false, errors: ['STATE CONFLICT: historical Review 3 correction HANDOFF content hash does not match live HANDOFF'] }
    }

    const liveUpdatedAt = handoff.updatedAt ?? handoff.updated_at ?? null
    if (binding.handoff_created_at !== (handoff.createdAt ?? handoff.created_at ?? null)) {
      return { ok: false, errors: ['STATE CONFLICT: bound HANDOFF creation timestamp does not match live comment metadata'] }
    }
    if (binding.handoff_updated_at !== liveUpdatedAt) {
      return { ok: false, errors: ['STATE CONFLICT: bound HANDOFF update timestamp does not match live comment metadata'] }
    }

    if (binding.protected_base && binding.protected_base !== 'refs/heads/main' && state.approved_base === 'main') {
      return { ok: false, errors: ['STATE CONFLICT: protected base does not match Review 3 and live PR base main'] }
    }

    const { binding_sha256: recordedFingerprint, ...bindingPayload } = binding
    const actualFingerprint = createHash('sha256').update(JSON.stringify(bindingPayload)).digest('hex')
    if (recordedFingerprint !== actualFingerprint) {
      return { ok: false, errors: ['STATE CONFLICT: Founder correction HANDOFF binding fingerprint is invalid'] }
    }
  }
  return { ok: true, errors: [], reviewThree: true }
}
