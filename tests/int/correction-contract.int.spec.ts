import { describe, expect, it } from 'vitest'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped runtime .mjs boundary */
import * as correctionContractModule from '../../scripts/mission-control/domain/correction-contract.ts'
import * as correctionContractDomain from '../../scripts/mission-control/domain/correction-contract.ts'

const {
  parseCorrectionContract,
  parseCorrectionEvidenceMap,
  validateFindingIdentity,
  buildCorrectionCapsule,
  validateFindingEvidence,
  validateCorrectionScope,
  isCorrectionPhaseResult,
  validateCorrectionRoleComment,
  extractJsonObjects,
  isCorrectionEligibleVerdict,
  findingsFieldDeclaresUnresolvedImplementationFindings,
  requiresCorrectionFindingContract,
  parseReviewVerdictContractFindings,
  CORRECTION_EVIDENCE_CONTRACT,
  CORRECTION_EVIDENCE_SCHEMA_VERSION,
} = correctionContractModule as unknown as {
  parseCorrectionContract: (...args: any[]) => any
  parseCorrectionEvidenceMap: (...args: any[]) => any
  validateFindingIdentity: (...args: any[]) => any
  buildCorrectionCapsule: (...args: any[]) => any
  validateFindingEvidence: (...args: any[]) => any
  validateCorrectionScope: (...args: any[]) => any
  isCorrectionPhaseResult: (...args: any[]) => any
  validateCorrectionRoleComment: (...args: any[]) => any
  extractJsonObjects: (...args: any[]) => any
  isCorrectionEligibleVerdict: (...args: any[]) => any
  findingsFieldDeclaresUnresolvedImplementationFindings: (...args: any[]) => any
  requiresCorrectionFindingContract: (...args: any[]) => any
  parseReviewVerdictContractFindings: (...args: any[]) => any
  CORRECTION_EVIDENCE_CONTRACT: {
    canonical_example: string
    schema_version: number
    finding_results: { status_enum: string[] }
  }
  CORRECTION_EVIDENCE_SCHEMA_VERSION: number
}

const reviewedHead = 'abc1234deadbeef'

const findings = [
  {
    id: 'MC-R1-001',
    canonical_summary: 'supplied-timezone month boundaries are incorrect',
    source_thread: 'https://github.com/acme/repo/pull/12#discussion_r1',
    required_evidence: ['Bangkok exact UTC boundary', 'negative-offset DST boundary'],
    expected_areas: ['monthly exception boundary calculation'],
    prohibited_areas: ['src/unrelated/reversal.ts'],
  },
  {
    id: 'MC-R1-002',
    canonical_summary: 'missing focused regression for DST edge',
    source_thread: 'https://github.com/acme/repo/pull/12#discussion_r2',
    required_evidence: ['focused DST regression test'],
    expected_areas: ['timezone tests'],
    prohibited_areas: [],
  },
]

function contractJson(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    reviewed_head: reviewedHead,
    findings,
    ...overrides,
  }
}

function verdictBody(contract = contractJson()) {
  return `## REVIEW_VERDICT
### Task log
- Timestamp: 2026-07-20T12:00:00+07:00
- Task / Issue: #136
- Phase: Reviewer
- Executing role: Reviewer
**PR / base / head:** https://github.com/acme/repo/pull/12 · \`main\` · \`${reviewedHead}\`
**Verdict:** CORRECTION REQUIRED
**Findings:** Important: timezone boundaries
**Gates:** exact-head CI https://example.test/ci → pass
**Next:** Dev posts correction RESULT

\`\`\`json
${JSON.stringify(contract, null, 2)}
\`\`\`
`
}

function evidenceMap(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 2,
    correction_base: reviewedHead,
    finding_results: {
      'MC-R1-001': {
        changed_files: ['src/lib/month-boundary.ts'],
        tests: ['pnpm exec vitest run tests/int/month-boundary.int.spec.ts'],
        status: 'CLAIMED_RESOLVED',
      },
      'MC-R1-002': {
        changed_files: ['tests/int/month-boundary.int.spec.ts'],
        tests: ['pnpm exec vitest run tests/int/month-boundary.int.spec.ts'],
        status: 'CLAIMED_RESOLVED',
      },
    },
    ...overrides,
  }
}

function resultBody(map: Record<string, unknown> = evidenceMap(), extras = '') {
  return `## RESULT
### Task log
- Timestamp: 2026-07-20T13:00:00+07:00
- Task / Issue: #136
- Phase: Dev (correction)
- Executing role: Dev / Builder
**Completed:** Correction
**Summary:** Addressed immutable findings with explicit evidence.
**Next:** Delta Reviewer posts REVIEW_VERDICT
${extras}
\`\`\`json
${JSON.stringify(map, null, 2)}
\`\`\`
`
}

describe('correction-contract pure module', () => {
  it('keeps the stable facade exports backed by the Slice 5 domain module', () => {
    expect(Object.keys(correctionContractDomain).sort()).toEqual(Object.keys(correctionContractModule).sort())
    expect(Object.keys(correctionContractDomain).sort()).toEqual([
      'CORRECTION_CONTRACT_SCHEMA_VERSION',
      'CORRECTION_EVIDENCE_CONTRACT',
      'CORRECTION_EVIDENCE_SCHEMA_VERSION',
      'FINDING_STATUS',
      'buildCorrectionCapsule',
      'derivePlanningArtifactAllowlist',
      'extractJsonObjects',
      'findingsFieldDeclaresUnresolvedImplementationFindings',
      'isCorrectionEligibleVerdict',
      'isCorrectionPhaseResult',
      'parseCorrectionContract',
      'parseCorrectionEvidenceMap',
      'parseReviewVerdictContractFindings',
      'requiresCorrectionFindingContract',
      'validateCorrectionRoleComment',
      'validateCorrectionScope',
      'validateFindingEvidence',
      'validateFindingIdentity',
    ])
    expect(correctionContractDomain.parseCorrectionContract(verdictBody()).ok).toBe(true)
  })

  it('keeps the public correction evidence contract aligned with runtime validation', () => {
    const publicExample = JSON.parse(
      CORRECTION_EVIDENCE_CONTRACT.canonical_example.match(/```json\n([\s\S]*?)\n```/)?.[1] ?? '{}',
    )
    const contract = {
      reviewed_head: publicExample.correction_base,
      findings: Object.keys(publicExample.finding_results).map((id) => ({
        id,
        canonical_summary: `canonical summary for ${id}`,
      })),
    }
    const result = validateCorrectionRoleComment({
      role: 'RESULT',
      body: resultBody(publicExample),
      diffFiles: ['src/lib/month-boundary.ts', 'tests/int/month-boundary.int.spec.ts'],
      canonicalContract: contract,
    })

    expect(result.ok).toBe(true)
    expect(CORRECTION_EVIDENCE_CONTRACT.finding_results.status_enum).toEqual(['CLAIMED_RESOLVED', 'UNPROVEN'])
    expect(CORRECTION_EVIDENCE_CONTRACT.schema_version).toBe(CORRECTION_EVIDENCE_SCHEMA_VERSION)
  })

  it('rejects a public correction evidence example that violates a documented invariant', () => {
    const publicExample = JSON.parse(
      CORRECTION_EVIDENCE_CONTRACT.canonical_example.match(/```json\n([\s\S]*?)\n```/)?.[1] ?? '{}',
    )
    publicExample.finding_results['MC-R1-001'].changed_files = []
    const contract = {
      reviewed_head: publicExample.correction_base,
      findings: Object.keys(publicExample.finding_results).map((id) => ({
        id,
        canonical_summary: `canonical summary for ${id}`,
      })),
    }
    const result = validateCorrectionRoleComment({
      role: 'RESULT',
      body: resultBody(publicExample),
      diffFiles: ['src/lib/month-boundary.ts', 'tests/int/month-boundary.int.spec.ts'],
      canonicalContract: contract,
    })

    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toMatch(/changed_files|evidence/i)
  })

  it('accepts schema-v2 correction RESULT evidence while keeping the immutable verdict contract at v1', () => {
    expect(parseCorrectionContract(verdictBody()).contract.schema_version).toBe(1)
    const parsed = parseCorrectionEvidenceMap(resultBody())
    expect(parsed.ok).toBe(true)
    expect(parsed.evidence.schema_version).toBe(2)
  })
  it('parses exact canonical identity from a REVIEW_VERDICT block', () => {
    const parsed = parseCorrectionContract(verdictBody())
    expect(parsed.ok).toBe(true)
    expect(parsed.contract.reviewed_head).toBe(reviewedHead)
    expect(parsed.contract.findings.map((finding: { id: string }) => finding.id)).toEqual([
      'MC-R1-001',
      'MC-R1-002',
    ])
    expect(parsed.contract.findings[0].canonical_summary).toBe(
      'supplied-timezone month boundaries are incorrect',
    )
  })

  it('rejects changed canonical summaries before editing', () => {
    const canonical = parseCorrectionContract(verdictBody()).contract
    const candidate = structuredClone(canonical)
    candidate.findings[0].canonical_summary = 'timezone handling needs a different approach'

    const identity = validateFindingIdentity(canonical, candidate)
    expect(identity.ok).toBe(false)
    expect(identity.errors.join(' ')).toMatch(/canonical_summary|reinterpret|changed summary/i)
  })

  it('rejects finding rename, addition, omission, and substitution', () => {
    const canonical = parseCorrectionContract(verdictBody()).contract

    const renamed = structuredClone(canonical)
    renamed.findings[0].id = 'MC-R1-099'
    expect(validateFindingIdentity(canonical, renamed).ok).toBe(false)

    const added = structuredClone(canonical)
    added.findings.push({
      id: 'MC-R1-003',
      canonical_summary: 'extra finding',
      source_thread: 'https://example.test/r3',
      required_evidence: ['x'],
    })
    expect(validateFindingIdentity(canonical, added).ok).toBe(false)

    const omitted = structuredClone(canonical)
    omitted.findings = omitted.findings.slice(0, 1)
    expect(validateFindingIdentity(canonical, omitted).ok).toBe(false)

    const substituted = structuredClone(canonical)
    substituted.findings[1] = {
      id: 'MC-R1-002',
      canonical_summary: 'totally different defect',
      source_thread: 'https://example.test/r2',
      required_evidence: ['y'],
    }
    expect(validateFindingIdentity(canonical, substituted).ok).toBe(false)
  })

  it('rejects explicitly prohibited scope present in the correction diff', () => {
    const contract = parseCorrectionContract(verdictBody()).contract
    const map = evidenceMap()
    const validation = validateFindingEvidence(contract, map, [
      'src/lib/month-boundary.ts',
      'tests/int/month-boundary.int.spec.ts',
      'src/unrelated/reversal.ts',
    ])

    expect(validation.ok).toBe(false)
    expect(validation.errors.join(' ')).toMatch(/prohibited/i)
  })

  it('keeps partial corrections UNPROVEN instead of Done', () => {
    const contract = parseCorrectionContract(verdictBody()).contract
    const map = evidenceMap({
      finding_results: {
        'MC-R1-001': {
          changed_files: ['src/lib/month-boundary.ts'],
          tests: ['pnpm exec vitest run tests/int/month-boundary.int.spec.ts'],
          status: 'CLAIMED_RESOLVED',
        },
        'MC-R1-002': {
          changed_files: [],
          tests: [],
          status: 'UNPROVEN',
        },
      },
    })

    const validation = validateFindingEvidence(contract, map, [
      'src/lib/month-boundary.ts',
    ], { body: resultBody(map, '**AC audit:** Done\n') })

    expect(validation.ok).toBe(false)
    expect(validation.errors.join(' ')).toMatch(/UNPROVEN|Done/i)
  })

  it('allows an alternative valid implementation area with explicit evidence', () => {
    const contract = parseCorrectionContract(verdictBody()).contract
    const map = evidenceMap({
      finding_results: {
        'MC-R1-001': {
          changed_files: ['src/lib/calendar/boundary-engine.ts'],
          tests: ['pnpm exec vitest run tests/int/boundary-engine.int.spec.ts'],
          status: 'CLAIMED_RESOLVED',
        },
        'MC-R1-002': {
          changed_files: ['tests/int/boundary-engine.int.spec.ts'],
          tests: ['pnpm exec vitest run tests/int/boundary-engine.int.spec.ts'],
          status: 'CLAIMED_RESOLVED',
        },
      },
    })

    const validation = validateFindingEvidence(contract, map, [
      'src/lib/calendar/boundary-engine.ts',
      'tests/int/boundary-engine.int.spec.ts',
    ])

    expect(validation.ok).toBe(true)
  })

  it('does not treat green CI or file names as semantic proof for a substituted objective', () => {
    const contract = parseCorrectionContract(verdictBody()).contract
    const map = evidenceMap({
      finding_results: {
        'MC-R1-001': {
          changed_files: ['src/lib/unrelated-feature.ts'],
          tests: ['CI green on substituted objective'],
          status: 'CLAIMED_RESOLVED',
        },
        'MC-R1-099': {
          changed_files: ['src/lib/unrelated-feature.ts'],
          tests: ['pnpm run check'],
          status: 'CLAIMED_RESOLVED',
        },
      },
    })

    const validation = validateFindingEvidence(contract, map, ['src/lib/unrelated-feature.ts'])
    expect(validation.ok).toBe(false)
    expect(validation.errors.join(' ')).toMatch(/unknown|omitted|substituted|missing/i)
  })

  it('reconstructs the same immutable finding set for a fresh session capsule', () => {
    const first = parseCorrectionContract(verdictBody())
    const second = parseCorrectionContract(verdictBody())
    expect(first.ok && second.ok).toBe(true)

    const identity = validateFindingIdentity(first.contract, second.contract)
    expect(identity.ok).toBe(true)

    const capsule = buildCorrectionCapsule(first.contract, {
      issueNumber: '136',
      prUrl: 'https://github.com/acme/repo/pull/12',
    })
    expect(capsule.lines.join('\n')).toContain('MC-R1-001')
    expect(capsule.lines.join('\n')).toContain('supplied-timezone month boundaries are incorrect')
    expect(capsule.playbackLine).toBe('Playback verified: 2/2 canonical findings')
    expect(capsule.lines.join('\n')).not.toMatch(/full Issue body|command transcript/i)
  })

  it('preserves the legacy undefined playback count for lengthless iterable findings', () => {
    const contract = parseCorrectionContract(verdictBody()).contract
    const capsule = buildCorrectionCapsule({ ...contract, findings: new Set(contract.findings) })

    expect(capsule.lines.join('\n')).toContain('MC-R1-001')
    expect(capsule.findingCount).toBeUndefined()
    expect(capsule.playbackLine).toBe('Playback verified: undefined/undefined canonical findings')
  })

  it('leaves non-correction comments untouched', () => {
    const normalResult = `## RESULT
### Task log
- Timestamp: 2026-07-20T13:00:00+07:00
- Task / Issue: #136
- Phase: Dev (implementation)
- Executing role: Dev / Builder
**Completed:** Implementation
**Summary:** Bounded change.
**Next:** Reviewer posts REVIEW_VERDICT
`
    expect(isCorrectionPhaseResult(normalResult)).toBe(false)
    expect(parseCorrectionContract(normalResult).ok).toBe(false)
    expect(parseCorrectionEvidenceMap(normalResult).ok).toBe(false)
  })

  it('rejects CLAIMED_RESOLVED without changed-file or test evidence', () => {
    const contract = parseCorrectionContract(verdictBody()).contract
    const map = evidenceMap({
      finding_results: {
        'MC-R1-001': {
          changed_files: [],
          tests: ['pnpm exec vitest run tests/int/month-boundary.int.spec.ts'],
          status: 'CLAIMED_RESOLVED',
        },
        'MC-R1-002': {
          changed_files: ['tests/int/month-boundary.int.spec.ts'],
          tests: [],
          status: 'CLAIMED_RESOLVED',
        },
      },
    })

    const validation = validateFindingEvidence(contract, map, [
      'tests/int/month-boundary.int.spec.ts',
    ])
    expect(validation.ok).toBe(false)
    expect(validation.errors.join(' ')).toMatch(/CLAIMED_RESOLVED|evidence/i)
  })

  it('rejects referenced changed files absent from the correction diff', () => {
    const contract = parseCorrectionContract(verdictBody()).contract
    const map = evidenceMap()
    const validation = validateFindingEvidence(contract, map, ['src/lib/month-boundary.ts'])
    expect(validation.ok).toBe(false)
    expect(validation.errors.join(' ')).toMatch(/absent|not in|diff/i)
  })

  it('rejects whitespace-colliding finding IDs instead of silently accepting duplicates (MC-R1-003)', () => {
    const contract = contractJson({
      findings: [
        findings[0],
        { ...findings[1], id: `${findings[0].id} ` },
      ],
    })

    const parsed = parseCorrectionContract(verdictBody(contract))
    expect(parsed.ok).toBe(false)
    expect(parsed.errors.join(' ')).toMatch(/duplicate finding id/i)
  })

  it('rejects a malformed non-string entry in expected_areas instead of silently filtering it (MC-R1-003)', () => {
    const contract = contractJson({
      findings: [
        { ...findings[0], expected_areas: ['valid/area', 42] },
        findings[1],
      ],
    })

    const parsed = parseCorrectionContract(verdictBody(contract))
    expect(parsed.ok).toBe(false)
    expect(parsed.errors.join(' ')).toMatch(/expected_areas/i)
  })

  it('rejects an empty-string entry in prohibited_areas instead of silently filtering it (MC-R1-003)', () => {
    const contract = contractJson({
      findings: [
        findings[0],
        { ...findings[1], prohibited_areas: ['   '] },
      ],
    })

    const parsed = parseCorrectionContract(verdictBody(contract))
    expect(parsed.ok).toBe(false)
    expect(parsed.errors.join(' ')).toMatch(/prohibited_areas/i)
  })

  it('fails closed without a canonical contract instead of bypassing correction RESULT identity, base, and diff validation (MC-R1-001)', () => {
    const map = evidenceMap({
      correction_base: 'wrong-base',
      finding_results: {
        'MC-R1-099': {
          changed_files: ['src/unrelated/reversal.ts'],
          tests: ['pnpm run check'],
          status: 'CLAIMED_RESOLVED',
        },
      },
    })

    const result = validateCorrectionRoleComment({
      role: 'RESULT',
      body: resultBody(map),
      diffFiles: ['src/unrelated/reversal.ts'],
      canonicalContract: null,
    })

    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toMatch(/canonical (correction )?contract/i)
  })

  it('builds a planning_no_pr correction capsule with planning scope authorization and default prohibition', () => {
    const contract = {
      schema_version: 1,
      mode: 'planning_no_pr' as const,
      reviewed_head: '3d0e83e',
      findings: [
        {
          id: 'MC-R1-001',
          canonical_summary: 'design spec missing exact error boundary',
          source_thread: 'https://github.com/boat1994/bemoat-web-starter/pull/12#discussion_r1',
          required_evidence: ['updated design.md'],
          expected_areas: ['docs/superpowers/specs/bogus/catalog/minimal-luxury-detail/design.md'],
          prohibited_areas: [] as string[],
        },
      ],
    }

    const capsule = buildCorrectionCapsule(contract, {
      issueNumber: '145',
      prUrl: 'none',
      mode: 'planning_no_pr',
    })

    const text = capsule.lines.join('\n')
    expect(text).toContain('Mode: planning_no_pr')
    expect(text).toContain('PR: none')
    expect(text).toContain('prohibited_areas: planning canonical-artifact allowlist only (docs/superpowers/specs/bogus/catalog/minimal-luxury-detail/design.md)')
    expect(text).toContain('Authorized scope: only the immutable finding set above within canonical planning artifacts (docs/superpowers/specs/bogus/catalog/minimal-luxury-detail/design.md)')
  })

  it('parses mode from correction contract JSON and validates shape', () => {
    const verdictWithMode = `## REVIEW_VERDICT
**Verdict:** CORRECTION REQUIRED
**PR / base / head:** none · base main · head 3d0e83e
**Next:** Dev posts correction RESULT

\`\`\`json
{
  "schema_version": 1,
  "mode": "planning_no_pr",
  "reviewed_head": "3d0e83e",
  "findings": [
    {
      "id": "MC-R1-001",
      "canonical_summary": "design spec missing exact error boundary",
      "source_thread": "https://github.com/boat1994/bemoat-web-starter/pull/12#discussion_r1",
      "required_evidence": ["updated design.md"]
    }
  ]
}
\`\`\``

    const parsed = parseCorrectionContract(verdictWithMode)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect((parsed.contract as any).mode).toBe('planning_no_pr')
    }
  })

  it('rejects unrelated docs paths outside the canonical planning-artifact allowlist (MC-R1-002)', () => {
    const contract = {
      schema_version: 1,
      mode: 'planning_no_pr' as const,
      reviewed_head: '3d0e83e',
      findings: [
        {
          id: 'MC-R1-001',
          canonical_summary: 'design spec missing exact error boundary',
          source_thread: 'https://github.com/boat1994/bemoat-web-starter/pull/12#discussion_r1',
          required_evidence: ['updated design.md'],
          expected_areas: ['docs/superpowers/specs/bogus/catalog/minimal-luxury-detail/design.md'],
          prohibited_areas: [] as string[],
        },
      ],
    }

    const result = validateCorrectionScope(
      contract,
      ['docs/agent-loop/README.md'],
      { mode: 'planning_no_pr' },
    )

    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('outside canonical planning-artifact allowlist')
  })

  it('enforces planning default prohibition in validateFindingEvidence when mode is planning_no_pr', () => {
    const contract = {
      schema_version: 1,
      mode: 'planning_no_pr' as const,
      reviewed_head: '3d0e83e',
      findings: [
        {
          id: 'MC-R1-001',
          canonical_summary: 'design spec missing exact error boundary',
          source_thread: 'https://github.com/boat1994/bemoat-web-starter/pull/12#discussion_r1',
          required_evidence: ['updated design.md'],
          expected_areas: ['docs/superpowers/specs/bogus/catalog/minimal-luxury-detail/design.md'],
          prohibited_areas: [] as string[],
        },
      ],
    }

    const result = validateFindingEvidence(
      contract,
      {
        finding_results: {
          'MC-R1-001': {
            changed_files: ['src/app/page.tsx', 'docs/superpowers/specs/bogus/catalog/minimal-luxury-detail/design.md'],
            tests: ['pnpm run check'],
            status: 'CLAIMED_RESOLVED',
          },
        },
      },
      ['src/app/page.tsx', 'docs/superpowers/specs/bogus/catalog/minimal-luxury-detail/design.md'],
      { mode: 'planning_no_pr' },
    )

    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('prohibited scope present in correction diff: src/app/page.tsx (outside canonical planning-artifact allowlist)')
  })

  it('parses only fenced JSON objects and preserves unknown decoded keys only until normalization', () => {
    const object = {
      schema_version: 1,
      reviewed_head: reviewedHead,
      findings,
      ignored: { nested: true },
    }
    const fenced = `before {"bare":true}\n\n\`\`\`json\n${JSON.stringify(object)}\n\`\`\``

    expect(extractJsonObjects(fenced)).toHaveLength(1)
    expect(parseCorrectionContract(fenced)).toEqual({
      ok: true,
      contract: {
        schema_version: 1,
        mode: 'implementation_pr',
        reviewed_head: reviewedHead,
        findings: findings.map(({ id, canonical_summary, source_thread, required_evidence, expected_areas, prohibited_areas }) => ({
          id,
          canonical_summary,
          source_thread,
          required_evidence,
          expected_areas,
          prohibited_areas,
        })),
      },
    })
    expect(parseCorrectionContract('{"findings":[]}').ok).toBe(false)
    expect(extractJsonObjects('```json\n[1,2]\n```')).toEqual([])
    expect(extractJsonObjects('```yaml\na: b\n```')).toEqual([])
  })

  it('keeps native TypeError boundaries for null and non-string raw text', () => {
    expect(() => extractJsonObjects(null)).toThrow(TypeError)
    expect(() => parseCorrectionContract(null)).toThrow(TypeError)
    expect(() => parseCorrectionEvidenceMap(42)).toThrow(TypeError)
  })

  it('keeps JSON.parse duplicate-key behavior and exact matching-block multiplicity errors', () => {
    const duplicateEvidenceBody = `\`\`\`json
{"schema_version":2,"correction_base":"${reviewedHead}","finding_results":{},"finding_results":${JSON.stringify(evidenceMap().finding_results)}}
\`\`\``
    expect(parseCorrectionEvidenceMap(duplicateEvidenceBody).ok).toBe(true)
    expect(parseCorrectionContract(`${verdictBody()}\n${verdictBody()}`)).toEqual({
      ok: false,
      errors: ['multiple correction finding contract JSON blocks are not allowed'],
    })
    expect(parseCorrectionEvidenceMap(`${resultBody()}\n${resultBody()}`)).toEqual({
      ok: false,
      errors: ['multiple correction finding evidence map JSON blocks are not allowed'],
    })
  })

  it('accepts evidence schema 1 and 2 while retaining undefined optional mode', () => {
    const schemaOne = parseCorrectionEvidenceMap(resultBody({ ...evidenceMap(), schema_version: 1 }))
    expect(schemaOne).toEqual({
      ok: true,
      evidence: expect.objectContaining({ schema_version: 1, mode: undefined }),
    })
    const schemaTwo = parseCorrectionEvidenceMap(resultBody({ ...evidenceMap(), mode: '  implementation_pr  ' }))
    expect(schemaTwo.ok).toBe(true)
    if (schemaTwo.ok) expect(schemaTwo.evidence.mode).toBe('implementation_pr')
  })

  it('keeps direct validator bypass quirks and stable fail-closed ordering', () => {
    const contract = parseCorrectionContract(verdictBody()).contract
    const bypassed = validateFindingEvidence(
      contract,
      {
        correction_base: null,
        finding_results: {
          'MC-R1-001': { changed_files: [], tests: [], status: 'CLAIMED_RESOLVED' },
          'MC-R1-002': { changed_files: [], tests: [], status: 'UNPROVEN' },
        },
      },
      [],
    )

    expect(bypassed.errors).toEqual([
      'CLAIMED_RESOLVED requires non-empty changed_files and tests evidence for MC-R1-001',
    ])
    expect(validateFindingEvidence(contract, {
      finding_results: {
        'MC-R1-001': { changed_files: [], tests: [], status: 'LEGACY_UNKNOWN_STATUS' },
        'MC-R1-002': { changed_files: [], tests: [], status: 'UNPROVEN' },
      },
    }, []).ok).toBe(true)
    expect(validateFindingEvidence(contract, null, []).errors).toEqual(['finding_results are required'])
  })

  it('preserves legacy direct-call TypeError boundaries and iteration failures', () => {
    const contract = parseCorrectionContract(verdictBody()).contract
    const result = evidenceMap()

    expect(() => buildCorrectionCapsule(contract, null)).toThrow(TypeError)
    expect(() => buildCorrectionCapsule({ ...contract, findings: {} }, {})).toThrow(TypeError)
    expect(() => validateFindingIdentity({ ...contract, findings: {} }, contract)).toThrow(TypeError)
    expect(() => validateFindingEvidence(contract, result, null)).toThrow(TypeError)
    expect(() => validateCorrectionScope(contract, [], null)).toThrow(TypeError)
    expect(() => validateCorrectionScope({ ...contract, findings: {} }, [])).toThrow(TypeError)

    expect(parseReviewVerdictContractFindings(null, 'OTHER')).toEqual({ ok: true, findings: [] })
  })

  it('forwards validateFindingEvidence options unchanged to preserve legacy result checks', () => {
    const contract = parseCorrectionContract(verdictBody()).contract
    const options = { body: '**AC audit:** Done\n', mode: 'implementation_pr' }
    const result = validateFindingEvidence(contract, {
      finding_results: {
        'MC-R1-001': { changed_files: [], tests: [], status: 'UNPROVEN' },
        'MC-R1-002': { changed_files: [], tests: [], status: 'UNPROVEN' },
      },
    }, [], options)

    expect(result.ok).toBe(false)
    expect(result.errors).toContain('unsupported free-form Done claim conflicts with UNPROVEN finding evidence')
    expect(() => validateFindingEvidence(contract, evidenceMap(), [], null)).toThrow(TypeError)
  })

  it('preserves direct scope method boundaries for malformed findings and prohibited areas', () => {
    const contract = parseCorrectionContract(verdictBody()).contract

    expect(() => validateCorrectionScope({ ...contract, findings: 'legacy-string' }, [])).toThrow(TypeError)
    expect(() => validateCorrectionScope({
      ...contract,
      findings: [{ ...contract.findings[0], prohibited_areas: 'legacy-string' }],
    }, ['src/private/file.ts'])).toThrow(TypeError)
  })

  it('does not bind correction identity to issue, PR, base SHA, or source-thread metadata', () => {
    const canonical = parseCorrectionContract(verdictBody()).contract
    const candidate = {
      findings: canonical.findings.map((finding: Record<string, unknown>) => ({
        id: finding.id,
        canonical_summary: finding.canonical_summary,
        source_thread: 'different source thread',
        required_evidence: ['different evidence'],
      })),
    }

    expect(validateFindingIdentity(canonical, candidate).ok).toBe(true)
  })

  it('keeps exact scope matching without path canonicalization or trimming', () => {
    const contract = {
      ...parseCorrectionContract(verdictBody()).contract,
      findings: [{ ...findings[0], prohibited_areas: ['src/private/file.ts', 'docs/'] }],
    }

    expect(validateCorrectionScope(contract, ['src/private/file.ts']).ok).toBe(false)
    expect(validateCorrectionScope(contract, ['src/private/file.ts.bak']).ok).toBe(false)
    expect(validateCorrectionScope(contract, ['src/private/ file.ts']).ok).toBe(true)
    expect(validateCorrectionScope(contract, ['docs/notes.md']).ok).toBe(false)
  })

  it('keeps verdict and findings-field parsing independent from contract metadata', () => {
    const body = '**Verdict:** BLOCKED FOR FOUNDER DECISION\n**Findings:** Critical: None · Important: None'
    expect(isCorrectionEligibleVerdict('**Verdict:** CORRECTION REQUIRED')).toBe(true)
    expect(isCorrectionEligibleVerdict('**Verdict:** BLOCKED FOR FOUNDER DECISION')).toBe(false)
    expect(findingsFieldDeclaresUnresolvedImplementationFindings(body)).toBe(false)
    expect(requiresCorrectionFindingContract(body)).toBe(false)
    expect(parseReviewVerdictContractFindings(body)).toEqual({ ok: true, findings: [] })
  })
})
