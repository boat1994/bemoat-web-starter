import { describe, expect, it } from 'vitest'

import * as facade from '../../scripts/mission-control/domain/recover-state-evidence.mjs'
import {
  assertNoCompetingEvidence,
  normalizeId,
  normalizeSha,
  parseAdoptionAuthorization,
  parseImplementationResult,
  parseImplementationReview,
  parsePredecessor,
} from '../../scripts/mission-control/domain/recover-state-evidence.ts'
import { hashExactBody } from '../../scripts/mission-control/domain/correction-contract-fingerprint.mjs'

const REPOSITORY = 'boat1994/bemoat-web-starter'
const ISSUE = '333'
const PR = '339'
const BASE = 'main'
const BASE_SHA = 'b'.repeat(40)
const REVIEWED_HEAD = 'a'.repeat(40)
const CURRENT_HEAD = 'c'.repeat(40)
const HISTORICAL_HEAD = 'd'.repeat(40)
const PREDECESSOR_COMMENT = '7001'
const AUTHORIZATION_COMMENT = '7002'
const RESULT_COMMENT = '7003'
const REVIEW_COMMENT = '7004'
const TRUSTED_FOUNDERS = ['boat1994']
const ISSUE_URL = `https://api.github.com/repos/${REPOSITORY}/issues/${ISSUE}`

type Comment = {
  id: string
  body: string
  issue_url?: string
  user?: { login?: string }
  author_association?: string
  created_at?: string
  updated_at?: string
}

type Options = {
  repo: string
  issueNumber: string
  expectedPr: string
  expectedBase: string
  expectedBaseSha: string
  expectedBranch: string
  expectedHead: string
  expectedReviewedHead: string
  expectedAdoptionHead: string
  predecessorComment: string
  adoptionAuthorizationComment: string
  implementationResultComment: string
  implementationReviewComment: string
}

const options: Options = {
  repo: REPOSITORY,
  issueNumber: ISSUE,
  expectedPr: PR,
  expectedBase: BASE,
  expectedBaseSha: BASE_SHA,
  expectedBranch: 'refactor/333-campaign-normalize',
  expectedHead: CURRENT_HEAD,
  expectedReviewedHead: REVIEWED_HEAD,
  expectedAdoptionHead: CURRENT_HEAD,
  predecessorComment: PREDECESSOR_COMMENT,
  adoptionAuthorizationComment: AUTHORIZATION_COMMENT,
  implementationResultComment: RESULT_COMMENT,
  implementationReviewComment: REVIEW_COMMENT,
}

function predecessorBody(overrides: { reviewCycle?: number; reviewedHead?: string; task?: string; pr?: string } = {}) {
  const reviewCycle = overrides.reviewCycle ?? 1
  const reviewedHead = overrides.reviewedHead ?? REVIEWED_HEAD
  return `## REVIEW_VERDICT

**Verdict:** CORRECTION REQUIRED
- Task / Issue: \`#${overrides.task ?? ISSUE}\`
- Reviewed PR: \`#${overrides.pr ?? PR}\`
- Exact head reviewed: \`${reviewedHead}\`
- Approved base: \`${BASE}@${BASE_SHA}\`
- Timestamp: \`2026-08-14T10:00:00+07:00\`
- review_cycle: ${reviewCycle}
- full_review_count: 1

\`\`\`json
{
  "schema_version": 1,
  "mode": "implementation_pr",
  "reviewed_head": "${reviewedHead}",
  "findings": [
    {
      "id": "MC-TEST-001",
      "canonical_summary": "immutable finding",
      "source_thread": "https://github.com/${REPOSITORY}/issues/${ISSUE}",
      "required_evidence": ["focused evidence test"],
      "expected_areas": [],
      "prohibited_areas": []
    }
  ]
}
\`\`\`
`
}

function authorizationBody(overrides: { predecessorComment?: string; reviewedHead?: string; adoptionHead?: string; finding?: string } = {}) {
  return `## FOUNDER AUTHORIZATION — MC-CORRECTION-FINDING-ADOPTION-001

### Approved canonical transport

\`bemoat:mission-control:adopt-finding\`

- Repository: \`${REPOSITORY}\`
- Issue: \`#${ISSUE}\`
- PR: \`#${PR}\`
- Base: \`${BASE}@${BASE_SHA}\`
- Live adoption head: \`${overrides.adoptionHead ?? CURRENT_HEAD}\`
- Predecessor contract: Issue comment \`${overrides.predecessorComment ?? PREDECESSOR_COMMENT}\`
- Predecessor reviewed head: \`${overrides.reviewedHead ?? REVIEWED_HEAD}\`
- Existing immutable findings:
  - \`MC-TEST-001\`
- Authorized appended finding:
  - \`${overrides.finding ?? 'MC-CORRECTION-FINDING-ADOPTION-001'}\`
`
}

function resultBody(overrides: { head?: string; executionLine?: string } = {}) {
  return `## RESULT

- Task / Issue: #${ISSUE}
- PR: https://github.com/${REPOSITORY}/pull/${PR}
- Head: \`${overrides.head ?? HISTORICAL_HEAD}\`
- Branch: \`${options.expectedBranch}\`
- Command: \`bemoat:mission-control:adopt-finding\`
- ${overrides.executionLine ?? 'The live adoption execution did not run; the operation remained unexecuted.'}
`
}

function reviewBody(overrides: { head?: string } = {}) {
  return `## REVIEW_VERDICT

- Verdict: ELIGIBLE FOR FOUNDER REVIEW
- Task / Issue: #${ISSUE}
- Reviewed PR: #${PR}
- Exact head reviewed: \`${overrides.head ?? HISTORICAL_HEAD}\`
- Approved base: ${BASE}@${BASE_SHA}
- Finding: MC-CORRECTION-FINDING-ADOPTION-001
- Next action: bemoat:mission-control:adopt-finding
`
}

function comment(id: string, body: string, overrides: Partial<Comment> = {}): Comment {
  return {
    id,
    body,
    issue_url: ISSUE_URL,
    user: { login: 'boat1994' },
    author_association: 'OWNER',
    ...overrides,
  }
}

function baseComments(): Comment[] {
  return [
    comment(PREDECESSOR_COMMENT, predecessorBody()),
    comment(AUTHORIZATION_COMMENT, authorizationBody()),
    comment(RESULT_COMMENT, resultBody()),
    comment(REVIEW_COMMENT, reviewBody()),
  ]
}

function parsedPredecessor(overrides: { comments?: Comment[]; body?: string } = {}) {
  const originalComments = overrides.comments ?? baseComments()
  const selected = originalComments.find((entry) => entry.id === PREDECESSOR_COMMENT) ?? comment(PREDECESSOR_COMMENT, predecessorBody())
  const comments = overrides.body === undefined
    ? originalComments
    : originalComments.map((entry) => entry.id === PREDECESSOR_COMMENT ? { ...entry, body: overrides.body } : entry)
  return parsePredecessor({
    comment: overrides.body === undefined ? selected : { ...selected, body: overrides.body },
    comments,
    options,
    trustedFounderLogins: TRUSTED_FOUNDERS,
  })
}

describe('recover-state-evidence boundary', () => {
  it('keeps exactly seven facade exports with identity to the TypeScript implementation', () => {
    expect(Object.keys(facade).sort()).toEqual([
      'assertNoCompetingEvidence',
      'normalizeId',
      'normalizeSha',
      'parseAdoptionAuthorization',
      'parseImplementationResult',
      'parseImplementationReview',
      'parsePredecessor',
    ])
    expect(facade.assertNoCompetingEvidence).toBe(assertNoCompetingEvidence)
    expect(facade.normalizeId).toBe(normalizeId)
    expect(facade.normalizeSha).toBe(normalizeSha)
    expect(facade.parseAdoptionAuthorization).toBe(parseAdoptionAuthorization)
    expect(facade.parseImplementationResult).toBe(parseImplementationResult)
    expect(facade.parseImplementationReview).toBe(parseImplementationReview)
    expect(facade.parsePredecessor).toBe(parsePredecessor)
  })

  it('preserves normalization coercion and string-only SHA rules', () => {
    expect([normalizeSha(` ${'0'.repeat(41)} `), normalizeSha(REVIEWED_HEAD), normalizeSha(1), normalizeSha(null)])
      .toEqual([null, REVIEWED_HEAD, null, null])
    expect(normalizeSha(` ${'A'.repeat(40)} `)).toBe(REVIEWED_HEAD)
    expect(normalizeId('#333')).toBe('333')
    expect(normalizeId('333')).toBe('333')
    expect(normalizeId(333)).toBe('333')
    expect(normalizeId(' 333')).toBeNull()
    expect(normalizeId('333 ')).toBeNull()
    expect(normalizeId(0)).toBeNull()
    expect(normalizeId(null)).toBeNull()
  })

  it('preserves labeled parsing, URL fallback, partial timestamps, hashes, and return shapes', () => {
    const body = predecessorBody()
      .replace('- Task / Issue: `#333`', '- **Task / Issue:** `#333`')
      .replace('- Reviewed PR: `#339`', '- Reviewed PR: https://github.com/boat1994/bemoat-web-starter/pull/339')
      .replace('- Timestamp: `2026-08-14T10:00:00+07:00`', '')
    const result = parsedPredecessor({ body })
    expect(result).toMatchObject({
      body,
      bodyHash: hashExactBody(body),
      reviewedHead: REVIEWED_HEAD,
      findingIds: ['MC-TEST-001'],
      updatedAt: null,
      counters: {
        reviewCycle: 1,
        fullReviewCount: 1,
        sourceCommentIds: [PREDECESSOR_COMMENT],
        sourceBodyHashes: [hashExactBody(body)],
      },
    })
    expect(result.contract).toEqual(expect.objectContaining({ mode: 'implementation_pr', reviewed_head: REVIEWED_HEAD }))
  })

  it('accepts missing issue_url and trusted Founder MEMBER association', () => {
    const comments = baseComments().map((entry) => (
      entry.id === PREDECESSOR_COMMENT
        ? { ...entry, issue_url: undefined, author_association: 'MEMBER' }
        : entry
    ))
    expect(parsedPredecessor({ comments }).reviewedHead).toBe(REVIEWED_HEAD)
  })

  it('rejects edited, missing, duplicate, conflicting, superseded, and untrusted evidence fail-closed', () => {
    const edited = baseComments().map((entry) => (
      entry.id === PREDECESSOR_COMMENT
        ? { ...entry, created_at: '2026-08-14T03:00:00Z', updated_at: '2026-08-14T03:01:00Z' }
        : entry
    ))
    expect(() => parsedPredecessor({ comments: edited })).toThrow('EVIDENCE_CONFLICT: predecessorComment has an edited GitHub comment snapshot')

    expect(() => parsedPredecessor({ comments: baseComments().filter((entry) => entry.id !== PREDECESSOR_COMMENT) }))
      .toThrow('EVIDENCE_CONFLICT: predecessorComment is missing or changed in the live Issue comments')

    expect(() => parsedPredecessor({ comments: [...baseComments(), comment(PREDECESSOR_COMMENT, predecessorBody())] }))
      .toThrow(/EVIDENCE_CONFLICT/)

    expect(() => parsedPredecessor({ comments: baseComments().map((entry) => entry.id === PREDECESSOR_COMMENT ? { ...entry, user: { login: 'other' } } : entry) }))
      .toThrow('AUTHORITY_CONFLICT: predecessor correction contract author is not a trusted Founder login')

    expect(() => parsedPredecessor({ comments: baseComments().map((entry) => entry.id === PREDECESSOR_COMMENT ? { ...entry, author_association: 'COLLABORATOR' } : entry) }))
      .toThrow('AUTHORITY_CONFLICT: predecessor correction contract author association is not trusted')

    expect(() => parsedPredecessor({ comments: baseComments().map((entry) => entry.id === PREDECESSOR_COMMENT ? { ...entry, issue_url: 'https://api.github.com/repos/other/repo/issues/333' } : entry) }))
      .toThrow('EVIDENCE_CONFLICT: predecessor correction contract is not attached to the Task Issue')

    expect(() => parsedPredecessor({ comments: [...baseComments(), comment('7010', `supersedes: ${PREDECESSOR_COMMENT}`)] }))
      .toThrow('AUTHORITY_CONFLICT: predecessor correction contract is superseded by comment 7010')

    const conflictingCounter = comment('7005', `## REVIEW_VERDICT\n\n- Verdict: CORRECTION REQUIRED\n- Task / Issue: #${ISSUE}\n- Reviewed PR: #${PR}\n- Exact head reviewed: ${REVIEWED_HEAD}\n- review_cycle: 2`)
    expect(() => parsedPredecessor({ comments: [...baseComments(), conflictingCounter] }))
      .toThrow(/EVIDENCE_CONFLICT: evidence contains conflicting review counters/)
  })

  it('binds adoption authorization to predecessor identity and preserves exact result hashes', () => {
    const comments = baseComments()
    const authorization = comments.find((entry) => entry.id === AUTHORIZATION_COMMENT)
    if (!authorization) throw new Error('missing authorization fixture')
    const predecessor = parsedPredecessor({ comments })
    const result = parseAdoptionAuthorization({
      comment: authorization,
      comments,
      options,
      predecessor,
      trustedFounderLogins: TRUSTED_FOUNDERS,
    })
    expect(result).toMatchObject({
      predecessor_comment_id: PREDECESSOR_COMMENT,
      predecessor_reviewed_head: REVIEWED_HEAD,
      existing_finding_ids: ['MC-TEST-001'],
      adoption_head: CURRENT_HEAD,
      body_sha256: hashExactBody(authorization.body),
    })

    expect(() => parseAdoptionAuthorization({
      comment: authorization,
      comments,
      options: { ...options, predecessorComment: '9999' },
      predecessor,
      trustedFounderLogins: TRUSTED_FOUNDERS,
    })).toThrow(/EVIDENCE_CONFLICT/)

    expect(() => parseAdoptionAuthorization({
      comment: authorization,
      comments: [...comments, comment('7011', authorizationBody())],
      options,
      predecessor,
      trustedFounderLogins: TRUSTED_FOUNDERS,
    })).toThrow('AUTHORITY_CONFLICT: Founder finding-adoption authorization is ambiguous or has competing immutable authority')
  })

  it('binds implementation RESULT and REVIEW to historical heads and rejects execution false positives', () => {
    const comments = baseComments()
    const resultComment = comments.find((entry) => entry.id === RESULT_COMMENT)
    const reviewComment = comments.find((entry) => entry.id === REVIEW_COMMENT)
    if (!resultComment || !reviewComment) throw new Error('missing implementation fixture')
    expect(parseImplementationResult({
      comment: resultComment,
      comments,
      options,
      trustedFounderLogins: TRUSTED_FOUNDERS,
      expectedHead: HISTORICAL_HEAD,
    })).toEqual({ body: resultComment.body, bodyHash: hashExactBody(resultComment.body), head: HISTORICAL_HEAD })
    expect(parseImplementationReview({
      comment: reviewComment,
      comments,
      options,
      trustedFounderLogins: TRUSTED_FOUNDERS,
      expectedHead: HISTORICAL_HEAD,
    })).toEqual({ body: reviewComment.body, bodyHash: hashExactBody(reviewComment.body), head: HISTORICAL_HEAD })

    expect(() => parseImplementationResult({
      comment: { ...resultComment, body: resultBody({ executionLine: 'The live adoption was executed successfully.' }) },
      comments,
      options,
      trustedFounderLogins: TRUSTED_FOUNDERS,
      expectedHead: HISTORICAL_HEAD,
    })).toThrow('EVIDENCE_CONFLICT: implementationResultComment is missing or changed in the live Issue comments')

    const executed = comment(RESULT_COMMENT, resultBody({ executionLine: 'The live adoption did not execute.\nThe live adoption executed successfully.' }))
    const executedComments = comments.map((entry) => entry.id === RESULT_COMMENT ? executed : entry)
    expect(() => parseImplementationResult({
      comment: executed,
      comments: executedComments,
      options,
      trustedFounderLogins: TRUSTED_FOUNDERS,
      expectedHead: HISTORICAL_HEAD,
    })).toThrow('AUTHORITY_CONFLICT: adopt-finding implementation RESULT claims that the live operation was executed')
    expect(() => parseImplementationReview({
      comment: reviewComment,
      comments,
      options,
      trustedFounderLogins: TRUSTED_FOUNDERS,
      expectedHead: CURRENT_HEAD,
    })).toThrow('HEAD_DRIFT: adopt-finding implementation review head does not match its bound historical head')
  })

  it('scans competing evidence in the legacy order and preserves literal-backslash supersession behavior', () => {
    const predecessor = parsedPredecessor()
    const selectedIds = {
      predecessor: PREDECESSOR_COMMENT,
      authorization: AUTHORIZATION_COMMENT,
      result: RESULT_COMMENT,
      review: REVIEW_COMMENT,
    }
    expect(assertNoCompetingEvidence({
      comments: baseComments(),
      selectedIds,
      options,
      predecessor,
      historicalHead: HISTORICAL_HEAD,
    })).toBeUndefined()

    expect(() => assertNoCompetingEvidence({
      comments: [...baseComments(), comment('7020', reviewBody({ head: CURRENT_HEAD }))],
      selectedIds,
      options,
      predecessor,
      historicalHead: HISTORICAL_HEAD,
    })).toThrow('EVIDENCE_CONFLICT: competing current-head REVIEW_VERDICT evidence exists')

    expect(() => assertNoCompetingEvidence({
      comments: [...baseComments(), comment('7021', resultBody({ head: CURRENT_HEAD }))],
      selectedIds,
      options,
      predecessor,
      historicalHead: HISTORICAL_HEAD,
    })).toThrow('EVIDENCE_CONFLICT: competing adopt-finding implementation RESULT evidence exists')

    expect(() => assertNoCompetingEvidence({
      comments: [...baseComments(), comment('7022', 'The live adoption was executed.')],
      selectedIds,
      options,
      predecessor,
      historicalHead: HISTORICAL_HEAD,
    })).toThrow('AUTHORITY_CONFLICT: unknown evidence claims live finding adoption was executed')

    expect(() => parsedPredecessor({ comments: [...baseComments(), comment('7023', `superseded: ${PREDECESSOR_COMMENT}`)] }))
      .not.toThrow()
  })

  it('preserves native wrong-type and null/undefined behavior without input mutation or side effects', () => {
    const comments = baseComments()
    const before = structuredClone(comments)
    expect(() => parsePredecessor(null)).toThrow(
      "Cannot destructure property 'comment' of 'object null' as it is null.",
    )
    expect(() => parsePredecessor(undefined)).toThrow(
      "Cannot destructure property 'comment' of 'undefined' as it is undefined.",
    )
    expect(() => normalizeId(Symbol('id'))).not.toThrow()
    expect(() => parsePredecessor({
      comment: comments[0],
      comments: null,
      options,
      trustedFounderLogins: TRUSTED_FOUNDERS,
    })).toThrow("Cannot read properties of null (reading 'filter')")
    expect(() => parsePredecessor({
      comment: comments[0],
      comments: { filter: (): null => null },
      options,
      trustedFounderLogins: TRUSTED_FOUNDERS,
    })).toThrow("Cannot read properties of null (reading 'length')")
    expect(() => assertNoCompetingEvidence({
      comments: 'not-an-array',
      selectedIds: {},
      options,
      predecessor: { reviewedHead: REVIEWED_HEAD },
      historicalHead: HISTORICAL_HEAD,
    })).toThrow(TypeError)
    expect(comments).toEqual(before)
  })
})
