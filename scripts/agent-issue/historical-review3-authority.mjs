import { createHash } from 'node:crypto'

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function sortedFindingIds(findings = []) {
  return findings.map((finding) => finding.id).sort()
}

function handoffDatabaseId(handoff) {
  const explicit = handoff?.databaseId ?? handoff?.database_id ?? handoff?.id
  if (explicit != null && /^[1-9]\d*$/.test(String(explicit))) return String(explicit)
  const url = handoff?.url ?? handoff?.html_url ?? ''
  return String(url).match(/#issuecomment-(\d+)$/)?.[1] ?? null
}

export function verifyHistoricalReview3Authority({
  authorization,
  activePr,
  handoff,
  contract,
  reviewVerdict = null,
  reviewVerdictDatabaseId = null,
  expectedPrNumber = null,
  requireCanonicalMetadata = false,
}) {
  if (!authorization || authorization.status !== 'consumed' || authorization.for_review_number !== 3) {
    return {
      ok: false,
      errors: ['STATE CONFLICT: Review 3 correction requires a consumed Founder correction authorization'],
      proof: null,
    }
  }
  if (authorization.reviewed_head !== contract?.reviewed_head) {
    return {
      ok: false,
      errors: ['STATE CONFLICT: Founder correction authorization does not bind the Review 3 exact head'],
      proof: null,
    }
  }

  const authorizedIds = [...authorization.finding_ids ?? []].sort()
  const contractIds = sortedFindingIds(contract?.findings)
  if (!sameJson(authorizedIds, contractIds)) {
    return {
      ok: false,
      errors: ['STATE CONFLICT: Founder correction authorization finding IDs do not match the immutable contract'],
      proof: null,
    }
  }

  const exactHandoffId = handoffDatabaseId(handoff)
  if (!handoff || exactHandoffId !== String(authorization.handoff_comment_id) ||
      !/##\s+HANDOFF\s*$/m.test(handoff.body ?? '') ||
      !(handoff.body ?? '').includes(authorization.authorization_id)) {
    return {
      ok: false,
      errors: ['STATE CONFLICT: Founder correction authorization is not bound to its exact active HANDOFF'],
      proof: null,
    }
  }

  if (requireCanonicalMetadata && (
    !handoff.author || handoff.authorAssociation !== 'OWNER' || !handoff.createdAt || !handoff.updatedAt
  )) {
    return {
      ok: false,
      errors: ['STATE CONFLICT: historical HANDOFF canonical metadata is missing or inconsistent'],
      proof: null,
    }
  }

  let exactReviewVerdictId = null
  if (reviewVerdict || reviewVerdictDatabaseId) {
    exactReviewVerdictId = handoffDatabaseId(reviewVerdict)
    const verdictBody = reviewVerdict?.body ?? ''
    const prNumber = verdictBody.match(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/(\d+)/)?.[1] ?? null
    const verdictHead = verdictBody.match(/\*\*PR\s*\/\s*base\s*\/\s*head:\*\*[^\n]*·\s*`([0-9a-f]{7,40})`/i)?.[1] ?? null
    if (exactReviewVerdictId !== String(reviewVerdictDatabaseId) ||
        !/^##\s+REVIEW_VERDICT\s*$/m.test(verdictBody) ||
        !/\*\*Verdict:\*\*\s*BLOCKED FOR FOUNDER DECISION/i.test(verdictBody) ||
        verdictHead !== authorization.reviewed_head ||
        (expectedPrNumber != null && prNumber !== String(expectedPrNumber)) ||
        !/cycle\s+`3`[^\n]*full_review_count\s+`1`/i.test(verdictBody)) {
      return {
        ok: false,
        errors: ['STATE CONFLICT: historical Review 3 verdict evidence is missing or inconsistent'],
        proof: null,
      }
    }
    if (requireCanonicalMetadata && (
      !reviewVerdict.author || reviewVerdict.authorAssociation !== 'OWNER' ||
      !reviewVerdict.createdAt || !reviewVerdict.updatedAt
    )) {
      return {
        ok: false,
        errors: ['STATE CONFLICT: historical Review 3 canonical metadata is missing or inconsistent'],
        proof: null,
      }
    }
  }

  if (authorization.schema_version === 2) {
    const binding = authorization.handoff_binding
    const contentSha256 = createHash('sha256').update(handoff.body ?? '').digest('hex')
    const expectedFields = {
      authorization_snapshot: {
        authorization_id: authorization.authorization_id,
        authority: authorization.authority,
        status: 'authorized',
        action: authorization.action,
        authorized_at: authorization.authorized_at,
        scope: authorization.scope,
        for_review_number: authorization.for_review_number,
        reviewed_head: authorization.reviewed_head,
        finding_ids: authorization.finding_ids,
      },
      authorization_id: authorization.authorization_id,
      active_pr: activePr,
      exact_head: authorization.reviewed_head,
      correction_base: authorization.reviewed_head,
      review_number: authorization.for_review_number,
      scope: authorization.scope,
      finding_ids: authorization.finding_ids,
      handoff_comment_id: String(authorization.handoff_comment_id),
    }
    const liveTarget = (handoff.body ?? '').match(/^\*\*Target:\*\*\s*(.+?)\s*$/m)?.[1]?.trim() ?? null
    if (!binding || binding.content_sha256 !== contentSha256 ||
        binding.target !== liveTarget ||
        Object.entries(expectedFields).some(([key, value]) => !sameJson(binding[key], value))) {
      return {
        ok: false,
        errors: ['STATE CONFLICT: immutable Founder correction HANDOFF binding does not match live content'],
        proof: null,
      }
    }
    const { binding_sha256: recordedFingerprint, ...payload } = binding
    const actualFingerprint = createHash('sha256').update(JSON.stringify(payload)).digest('hex')
    if (recordedFingerprint !== actualFingerprint) {
      return {
        ok: false,
        errors: ['STATE CONFLICT: immutable Founder correction HANDOFF fingerprint is invalid'],
        proof: null,
      }
    }
    const liveCreatedAt = handoff.createdAt ?? handoff.created_at ?? null
    if (binding.handoff_created_at !== liveCreatedAt) {
      return {
        ok: false,
        errors: ['STATE CONFLICT: historical Founder correction HANDOFF creation timestamp is inconsistent'],
        proof: null,
      }
    }
    const liveUpdatedAt = handoff.updatedAt ?? handoff.updated_at ?? null
    if (binding.handoff_updated_at !== liveUpdatedAt) {
      return {
        ok: false,
        errors: ['STATE CONFLICT: bound Founder correction HANDOFF was edited after dispatch'],
        proof: null,
      }
    }
  }

  return {
    ok: true,
    errors: [],
    proof: Object.freeze({
      kind: 'historical_review_3',
      authorizationId: authorization.authorization_id,
      reviewNumber: 3,
      reviewedHead: authorization.reviewed_head,
      findingIds: Object.freeze([...authorization.finding_ids]),
      handoffDatabaseId: exactHandoffId,
      reviewVerdictDatabaseId: exactReviewVerdictId,
      handoffContentSha256: createHash('sha256').update(handoff.body ?? '').digest('hex'),
    }),
  }
}
