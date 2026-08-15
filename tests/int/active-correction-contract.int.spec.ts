import { describe, expect, it } from 'vitest'

import * as facade from '../../scripts/mission-control/domain/active-correction-contract.ts'
import * as domain from '../../scripts/mission-control/domain/active-correction-contract.ts'
import { isIdenticalCompletedProjection } from '../../scripts/mission-control/domain/adopt-finding-projection.mjs'
import { fingerprintCorrectionContract } from '../../scripts/mission-control/domain/correction-contract-fingerprint.mjs'

type Finding = {
  id: string
  canonical_summary: string
  source_thread: string
  required_evidence: string[]
  expected_areas: string[]
  prohibited_areas: string[]
}

type Contract = {
  schema_version: number
  mode: 'implementation_pr'
  reviewed_head: string
  findings: Finding[]
}

function finding(id: string): Finding {
  return {
    id,
    canonical_summary: `${id} summary`,
    source_thread: `https://github.com/acme/repo/pull/12#discussion_${id}`,
    required_evidence: ['focused regression'],
    expected_areas: ['scripts/mission-control'],
    prohibited_areas: ['scripts/unrelated'],
  }
}

function contract(reviewedHead = 'a'.repeat(40), ids = ['MC-R1-001']): Contract {
  return {
    schema_version: 1,
    mode: 'implementation_pr',
    reviewed_head: reviewedHead,
    findings: ids.map(finding),
  }
}

function identityFor(candidate: Contract): Record<string, unknown> {
  return {
    schema_version: 1,
    kind: 'founder-adopted-finding',
    predecessor_comment_id: '1001',
    predecessor_body_sha256: 'b'.repeat(64),
    predecessor_contract_fingerprint: 'c'.repeat(64),
    founder_authorization_comment_id: '1002',
    founder_authorization_body_sha256: 'd'.repeat(64),
    founder_author_login: 'boat1994',
    non_superseded: true,
    adoption_head: 'e'.repeat(40),
    reviewed_head: candidate.reviewed_head,
    repository: 'acme/repo',
    task_issue: 333,
    pr: 339,
    base: 'main',
    base_sha: 'f'.repeat(40),
    contract_fingerprint: fingerprintCorrectionContract(candidate),
    adopted_finding_id: candidate.findings.at(-1)?.id,
    authorization_id: 'MC-AUTH-001',
    contract: structuredClone(candidate),
  }
}

function verdictBody(candidate: Contract): string {
  const fence = '`'.repeat(3)
  return `## REVIEW_VERDICT
**Verdict:** CORRECTION REQUIRED

${fence}json
${JSON.stringify(candidate)}
${fence}
`
}

describe('active correction-contract authority boundary', () => {
  it('keeps the logic-free facade export surface exactly aligned with the TypeScript domain', () => {
    expect(Object.keys(facade).sort()).toEqual(Object.keys(domain).sort())
  })

  it('gives a valid active identity precedence over the latest correction verdict', () => {
    const active = contract('1'.repeat(40), ['MC-R1-001', 'MC-R1-002'])
    const fallback = contract('2'.repeat(40), ['MC-R1-003'])

    const result = domain.resolveAuthoritativeCorrectionContract({
      managedState: {
        active_correction_contract_identity: identityFor(active),
      },
      latestCorrectionVerdictBody: verdictBody(fallback),
    })

    expect(result).toEqual({
      ok: true,
      source: 'active_correction_contract_identity',
      contract: active,
      identity: expect.objectContaining({ contract_fingerprint: fingerprintCorrectionContract(active) }),
    })
  })

  it('reads active identity from the same property-container shapes as the legacy resolver', () => {
    const active = contract('1'.repeat(40), ['MC-R1-001'])
    const identity = identityFor(active)
    const callableState = Object.assign(function callableState(): undefined { return undefined }, {
      active_correction_contract_identity: identity,
    })

    expect(domain.resolveAuthoritativeCorrectionContract({
      managedState: callableState,
      latestCorrectionVerdictBody: verdictBody(contract('2'.repeat(40), ['MC-R1-002'])),
    })).toEqual(expect.objectContaining({
      ok: true,
      source: 'active_correction_contract_identity',
      contract: active,
    }))
  })

  it('fails closed for an invalid active identity instead of falling back', () => {
    const active = identityFor(contract())
    active.contract_fingerprint = 'invalid'

    const result = domain.resolveAuthoritativeCorrectionContract({
      managedState: { active_correction_contract_identity: active },
      latestCorrectionVerdictBody: verdictBody(contract('2'.repeat(40), ['MC-R1-002'])),
    })

    expect(result).toEqual({
      ok: false,
      errors: ['active correction-contract identity.contract_fingerprint does not match the embedded contract'],
    })
  })

  it('falls back only when active identity is absent and rejects missing authority', () => {
    const fallback = contract('2'.repeat(40))
    expect(domain.resolveAuthoritativeCorrectionContract({
      managedState: {},
      latestCorrectionVerdictBody: verdictBody(fallback),
    })).toEqual({ ok: true, source: 'review_verdict', contract: fallback, identity: null })

    expect(domain.resolveAuthoritativeCorrectionContract({ managedState: {} })).toEqual({
      ok: false,
      errors: ['no authoritative correction contract is available'],
    })
  })

  it('preserves sameValue quirks and append-only ordered union semantics', () => {
    expect(domain.sameValue(new Date(0), {})).toBe(true)
    const left = { stable: true, [Symbol('ignored')]: 'left' }
    const right = { stable: true, [Symbol('ignored')]: 'right' }
    expect(domain.sameValue(left, right)).toBe(true)

    const predecessorContract = contract('1'.repeat(40), ['MC-R1-001'])
    const adoptedFinding = finding('MC-R1-002')
    const result = domain.buildReconciledCorrectionContract({ predecessorContract, adoptedFinding })
    expect(result).toEqual({
      ok: true,
      contract: {
        ...predecessorContract,
        findings: [predecessorContract.findings[0], adoptedFinding],
      },
    })
    if (result.ok) {
      expect(result.contract.findings[0]).not.toBe(predecessorContract.findings[0])
      expect(result.contract.findings[1]).not.toBe(adoptedFinding)
    }

    expect(domain.buildReconciledCorrectionContract({
      predecessorContract,
      adoptedFinding: finding('MC-R1-001'),
    })).toEqual({
      ok: false,
      errors: ['adopted finding MC-R1-001 already exists in the predecessor contract'],
    })
  })

  it('keeps the adoption projection consumer readback pure and idempotent', () => {
    const active = contract('1'.repeat(40), ['MC-R1-001'])
    const identity = identityFor(active)
    const state = { active_correction_contract_identity: structuredClone(identity) }
    identity.adoption_head = 'f'.repeat(40)

    expect(isIdenticalCompletedProjection({
      state,
      identity,
      options: {
        authorizationComment: '1002',
        predecessorComment: '1001',
        expectedAdoptionHead: 'F'.repeat(40),
      },
      authorization: { body_sha256: 'd'.repeat(64) },
    })).toBe(false)

    identity.adoption_head = 'e'.repeat(40)
    expect(isIdenticalCompletedProjection({
      state,
      identity,
      options: {
        authorizationComment: '1002',
        predecessorComment: '1001',
        expectedAdoptionHead: 'E'.repeat(40),
      },
      authorization: { body_sha256: 'd'.repeat(64) },
    })).toBe(true)
    expect(state).toEqual({ active_correction_contract_identity: expect.any(Object) })
  })
})
