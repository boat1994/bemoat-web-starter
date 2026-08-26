import { describe, expect, it } from 'vitest'

import { routeContext } from '../../scripts/context/router.ts'
import type { NormalizedContextEvidence } from '../../scripts/context/model.ts'
import {
  classifyMergeReviewVerdict,
  parseProductionMergeReviewVerdict,
  resolveMergeReviewVerdictBinding,
} from '../../scripts/mission-control/domain/merge-review-verdict.ts'

const sha = 'a'.repeat(40)
const headSha = 'b'.repeat(40)

function baseEvidence(
  overrides: Partial<NormalizedContextEvidence> = {},
): NormalizedContextEvidence {
  return {
    repository: {
      owner: 'boat1994',
      name: 'bemoat-web-starter',
      nameWithOwner: 'boat1994/bemoat-web-starter',
      url: 'https://github.com/boat1994/bemoat-web-starter',
    },
    protectedBase: {
      branch: 'main',
      sha,
      source: 'live GitHub ref',
      url: 'https://github.com/boat1994/bemoat-web-starter/tree/main',
    },
    policy: {
      path: 'docs/mission-control/mission-control-guide.md',
      policyId: 'bemoat-mission-control',
      version: '1.3.0',
      sourceSha: sha,
      url: 'https://github.com/boat1994/bemoat-web-starter/blob/main/docs/mission-control/mission-control-guide.md',
    },
    issue: {
      number: '410',
      title: 'context protocol',
      state: 'OPEN',
      url: 'https://github.com/boat1994/bemoat-web-starter/issues/410',
      objective: 'Implement context.',
      scope: 'Context only.',
      acceptanceCriteria: ['The command is read-only.'],
      dependencies: [],
      taskSize: 'core',
      missionControlMode: 'optional',
      workflowProfile: 'STANDARD',
    },
    localGit: {
      branch: 'feature/410-context',
      head: headSha,
      upstream: 'origin/feature/410-context',
      originRepository: 'boat1994/bemoat-web-starter',
      clean: true,
      detached: false,
      pushed: true,
      durable: true,
      reasons: [],
    },
    activePr: null,
    currentHeadVerification: null,
    durableContext: {
      latestHandoff: null,
      historicalResults: [],
    },
    evidenceErrors: [],
    ...overrides,
  }
}

function prEvidence(overrides: Record<string, unknown> = {}) {
  return {
    number: '411',
    state: 'OPEN',
    draft: false,
    url: 'https://github.com/boat1994/bemoat-web-starter/pull/411',
    baseBranch: 'main',
    baseSha: sha,
    headBranch: 'feature/410-context',
    headSha,
    merged: false,
    mergeCommitSha: null as string | null,
    ...overrides,
  }
}

function verification(overrides: Record<string, unknown> = {}) {
  return {
    exactHead: headSha,
    checks: {
      status: 'SUCCESS',
      complete: true,
      failed: false,
      pending: false,
      required: true,
    },
    reviews: {
      required: true,
      approved: false,
      exactHead: false,
      approvedCount: 0,
      exactHeadApprovedCount: 0,
    },
    protection: {
      available: true,
      requiredChecks: ['CI'],
      requiredApprovals: 1,
    },
    ...overrides,
  }
}

function nativeReview(overrides: Record<string, unknown> = {}) {
  return {
    id: 200,
    state: 'COMMENTED',
    commitId: headSha,
    body: `## REVIEW_VERDICT
**Repository:** \`boat1994/bemoat-web-starter\`
**Task / Issue:** #410
**PR / base / head:** PR #411 · \`main\` · \`${headSha}\`
**Verdict:** ELIGIBLE FOR FOUNDER REVIEW`,
    ...overrides,
  }
}

function nativeBlockingReview(overrides: Record<string, unknown> = {}) {
  return nativeReview({
    body: `## REVIEW_VERDICT
**Repository:** \`boat1994/bemoat-web-starter\`
**Task / Issue:** #410
**PR / base / head:** PR #411 · \`main\` · \`${headSha}\`
**Verdict:** CORRECTION REQUIRED

### Immutable finding disposition
\`\`\`json
{ "schema_version": 1, "mode": "implementation_pr", "reviewed_head": "${headSha}", "findings": [{ "id": "CTX-001", "canonical_summary": "Fix it", "source_thread": "https://github.com/boat1994/bemoat-web-starter/pull/411#discussion_r1", "required_evidence": ["Evidence"] }] }
\`\`\``,
    ...overrides,
  })
}

describe('bemoat:context pure routing', () => {
  const validVerdict = {
    id: 100,
    body: `## REVIEW_VERDICT\n**Verdict:** ELIGIBLE FOR FOUNDER REVIEW\n**Task:** Issue #410\n**Repository:** \`boat1994/bemoat-web-starter\`\n**PR / base / head:** PR #411 · \`main\` · \`${headSha}\``,
    createdAt: '2026-08-01T00:00:00Z',
    url: 'https://github.com/boat1994/bemoat-web-starter/issues/410#issuecomment-100',
  }
  const correctionVerdict = {
    id: 101,
    body: `## REVIEW_VERDICT\n**Verdict:** CORRECTION REQUIRED\n**PR / base / head:** PR #411 · \`main\` · \`${headSha}\``,
    createdAt: '2026-08-01T00:00:00Z',
    url: 'https://github.com/boat1994/bemoat-web-starter/issues/410#issuecomment-101',
  }
  const staleVerdict = {
    id: 102,
    body: `## REVIEW_VERDICT\n**Verdict:** ELIGIBLE FOR FOUNDER REVIEW\n**Task:** Issue #410\n**Repository:** \`boat1994/bemoat-web-starter\`\n**PR / base / head:** PR #411 · \`main\` · \`c${'c'.repeat(39)}\``,
    createdAt: '2026-08-01T00:00:00Z',
    url: 'https://github.com/boat1994/bemoat-web-starter/issues/410#issuecomment-102',
  }
  const malformedVerdict = {
    id: 103,
    body: `## REVIEW_VERDICT\n**Verdict:** ELIGIBLE FOR FOUNDER REVIEW`,
    createdAt: '2026-08-01T00:00:00Z',
    url: 'https://github.com/boat1994/bemoat-web-starter/issues/410#issuecomment-103',
  }
  const wrongIssueVerdict = {
    id: 104,
    body: `## REVIEW_VERDICT\n**Verdict:** ELIGIBLE FOR FOUNDER REVIEW\n**PR / base / head:** PR #999 · \`main\` · \`${headSha}\``,
    createdAt: '2026-08-01T00:00:00Z',
    url: 'https://github.com/boat1994/bemoat-web-starter/issues/410#issuecomment-104',
  }
  const wrongBaseVerdict = {
    id: 105,
    body: `## REVIEW_VERDICT\n**Verdict:** ELIGIBLE FOR FOUNDER REVIEW\n**Task:** Issue #410\n**Repository:** \`boat1994/bemoat-web-starter\`\n**PR / base / head:** PR #411 · \`wrongbase\` · \`${headSha}\``,
    createdAt: '2026-08-01T00:00:00Z',
    url: 'https://github.com/boat1994/bemoat-web-starter/issues/410#issuecomment-105',
  }

  const genuineWrongIssueVerdict = {
    id: 106,
    body: `## REVIEW_VERDICT\n**Verdict:** ELIGIBLE FOR FOUNDER REVIEW\n**Task:** Issue #999\n**Repository:** \`boat1994/bemoat-web-starter\`\n**PR / base / head:** PR #411 · \`main\` · \`${headSha}\``,
    createdAt: '2026-08-01T00:00:00Z',
    url: 'https://github.com/boat1994/bemoat-web-starter/issues/410#issuecomment-106',
  }

  const genuineWrongRepoVerdict = {
    id: 107,
    body: `## REVIEW_VERDICT\n**Verdict:** ELIGIBLE FOR FOUNDER REVIEW\n**Task:** Issue #410\n**Repository:** \`other/repository\`\n**PR / base / head:** PR #411 · \`main\` · \`${headSha}\``,
    createdAt: '2026-08-01T00:00:00Z',
    url: 'https://github.com/boat1994/bemoat-web-starter/issues/410#issuecomment-107',
  }

  function actual421ReviewVerdictBody(reviewedHead: string): string {
    return `## REVIEW_VERDICT

### Task log
- Timestamp: 2026-08-25T14:00:00+07:00
- Task / Issue: #421
- Phase: Founder-authorized post-budget Review 4
- Executing role: Reviewer

### Review identity
- Repository: \`boat1994/bemoat-web-starter\`
- Task / Issue: #421
- PR / base / head: PR #422 · \`main\` · \`${reviewedHead}\`

**Task / Issue:** #421
**Repository:** \`boat1994/bemoat-web-starter\`
**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/422 · \`main\` · \`${reviewedHead}\`
**Verdict:** ELIGIBLE FOR FOUNDER REVIEW`
  }

  it('routes clean durable work without a PR to IMPLEMENT', () => {
    expect(routeContext(baseEvidence()).route).toBe('IMPLEMENT')
  })

  it('fails closed for non-durable local work', () => {
    const decision = routeContext(baseEvidence({
      localGit: {
        ...baseEvidence().localGit,
        clean: false,
        pushed: false,
        durable: false,
        reasons: ['LOCAL_STATE_NOT_DURABLE: working tree is dirty and unpushed'],
      },
    }))

    expect(decision.route).toBe('STOP')
    expect(decision.reasons).toContain('LOCAL_STATE_NOT_DURABLE: working tree is dirty and unpushed')
  })

  it('routes failed exact-head checks to FIX', () => {
    const decision = routeContext(baseEvidence({
      activePr: prEvidence(),
      currentHeadVerification: verification({
        checks: {
          status: 'FAILURE',
          complete: true,
          failed: true,
          pending: false,
          required: true,
        },
      }),
    }))

    expect(decision.route).toBe('FIX')
  })

  it('routes incomplete exact-head checks to VERIFY', () => {
    const decision = routeContext(baseEvidence({
      activePr: prEvidence(),
      currentHeadVerification: verification({
        checks: {
          status: 'PENDING',
          complete: false,
          failed: false,
          pending: true,
          required: true,
        },
      }),
    }))

    expect(decision.route).toBe('VERIFY')
  })

  it('routes green exact-head work without approval to REVIEW', () => {
    const decision = routeContext(baseEvidence({
      activePr: prEvidence(),
      currentHeadVerification: verification(),
    }))

    expect(decision.route).toBe('REVIEW')
  })

  it('routes green exact-head approved work to FOUNDER_GATE', () => {
    const decision = routeContext(baseEvidence({
      activePr: prEvidence(),
      currentHeadVerification: verification({
        reviews: { required: true, approved: true, exactHead: true, approvedCount: 1, exactHeadApprovedCount: 1 },
      }),
      durableContext: {
        latestHandoff: null,
        historicalResults: [validVerdict],
      },
    }))

    expect(decision.route).toBe('FOUNDER_GATE')
  })

  describe('semantic review policies', () => {
    it('routes STANDARD + zero native approvals + no semantic review to REVIEW', () => {
      const decision = routeContext(baseEvidence({
        issue: { ...baseEvidence().issue, workflowProfile: 'STANDARD' },
        activePr: prEvidence(),
        currentHeadVerification: verification({
          reviews: { required: false, approved: true, exactHead: true, approvedCount: 0, exactHeadApprovedCount: 0 },
        }),
      }))
      expect(decision.route).toBe('REVIEW')
      expect(decision.reasons.join(' ')).toMatch(/STANDARD semantic review is missing/i)
    })

    it('routes STANDARD + valid exact-head semantic review to FOUNDER_GATE', () => {
      const decision = routeContext(baseEvidence({
        issue: { ...baseEvidence().issue, workflowProfile: 'STANDARD' },
        activePr: prEvidence(),
        currentHeadVerification: verification({
          reviews: { required: false, approved: true, exactHead: true, approvedCount: 1, exactHeadApprovedCount: 1 },
        }),
        durableContext: {
          latestHandoff: null,
          historicalResults: [validVerdict],
        },
      }))
      expect(decision.route).toBe('FOUNDER_GATE')
    })

    it('routes a clean exact-head native COMMENTED review to FOUNDER_GATE', () => {
      const currentHeadVerification = verification({
        reviews: {
          required: false,
          approved: true,
          exactHead: true,
          approvedCount: 0,
          exactHeadApprovedCount: 0,
          nativeReviews: [nativeReview()],
        },
      })
      const decision = routeContext(baseEvidence({
        issue: { ...baseEvidence().issue, workflowProfile: 'STANDARD' },
        activePr: prEvidence(),
        currentHeadVerification,
      }))

      expect(decision.route).toBe('FOUNDER_GATE')
    })

    it('routes an exact-head native CORRECTION REQUIRED review with a usable finding to FIX', () => {
      const currentHeadVerification = verification({
        reviews: {
          required: false,
          approved: true,
          exactHead: true,
          approvedCount: 0,
          exactHeadApprovedCount: 0,
          nativeReviews: [nativeBlockingReview()],
        },
      })
      const decision = routeContext(baseEvidence({
        issue: { ...baseEvidence().issue, workflowProfile: 'STANDARD' },
        activePr: prEvidence(),
        currentHeadVerification,
      }))

      expect(decision.route).toBe('FIX')
    })

    const nativeReviewCases: Array<[string, Record<string, unknown>, { duplicate?: boolean }?]> = [
      ['stale commit binding', { commitId: 'c'.repeat(40) }],
      ['wrong reviewed head', { body: nativeReview().body.replace(headSha, 'c'.repeat(40)) }],
      ['malformed body', { body: '## REVIEW_VERDICT\n**Verdict:** ELIGIBLE FOR FOUNDER REVIEW' }],
      ['ambiguous exact-head reviews', { id: 201 }, { duplicate: true }],
      ['competing exact-head verdicts', { body: nativeBlockingReview().body }, { duplicate: true }],
    ]
    it.each(nativeReviewCases)('keeps native review evidence fail-closed for %s', (_label, reviewOverrides, options = {}) => {
      const body = typeof reviewOverrides.body === 'string' ? reviewOverrides.body : undefined
      const reviews = options.duplicate
        ? [nativeReview(reviewOverrides), nativeReview({ id: 201, ...(body ? { body } : {}) })]
        : [nativeReview(reviewOverrides)]
      const currentHeadVerification = verification({
        reviews: {
          required: false,
          approved: true,
          exactHead: true,
          approvedCount: 0,
          exactHeadApprovedCount: 0,
          nativeReviews: reviews,
        },
      })
      const decision = routeContext(baseEvidence({
        issue: { ...baseEvidence().issue, workflowProfile: 'STANDARD' },
        activePr: prEvidence(),
        currentHeadVerification,
      }))

      expect(decision.route).toBe('REVIEW')
    })

    it('selects the live verdict from historical predecessor REVIEW_VERDICT records', () => {
      const liveBaseSha = '832782c585eb4c122ea05404fc1a615b865d68bb'
      const liveHeadSha = '346c2f2817adc33757a4934aac7184e12c142ca1'
      const predecessorHeadSha = '7f4ffbcc6582ee676341abf09fb55799875833b6'
      const predecessorVerdict = {
        id: 5400718189,
        body: `## REVIEW_VERDICT\n**Verdict:** ELIGIBLE FOR FOUNDER REVIEW\n**Task:** Issue #421\n**Repository:** \`boat1994/bemoat-web-starter\`\n**PR / base / head:** PR #422 · \`main\` · \`${predecessorHeadSha}\``,
        createdAt: '2026-08-24T20:08:50Z',
        url: 'https://github.com/boat1994/bemoat-web-starter/issues/421#issuecomment-5400718189',
      }
      const liveVerdict = {
        id: 5406699778,
        body: `## REVIEW_VERDICT\n**Verdict:** ELIGIBLE FOR FOUNDER REVIEW\n**Task:** Issue #421\n**Repository:** \`boat1994/bemoat-web-starter\`\n**PR / base / head:** PR #422 · \`main\` · \`${liveHeadSha}\``,
        createdAt: '2026-08-25T06:58:56Z',
        url: 'https://github.com/boat1994/bemoat-web-starter/issues/421#issuecomment-5406699778',
      }
      const decision = routeContext(baseEvidence({
        protectedBase: { ...baseEvidence().protectedBase, sha: liveBaseSha },
        issue: {
          ...baseEvidence().issue,
          number: '421',
          url: 'https://github.com/boat1994/bemoat-web-starter/issues/421',
          workflowProfile: 'STANDARD',
        },
        localGit: { ...baseEvidence().localGit, branch: 'fix/421-standard-semantic-review', head: liveHeadSha },
        activePr: prEvidence({
          number: '422',
          url: 'https://github.com/boat1994/bemoat-web-starter/pull/422',
          headBranch: 'fix/421-standard-semantic-review',
          headSha: liveHeadSha,
          baseSha: liveBaseSha,
        }),
        currentHeadVerification: {
          ...verification({
            exactHead: liveHeadSha,
          }),
          reviews: { required: false, approved: true, exactHead: true, approvedCount: 0, exactHeadApprovedCount: 0 },
        },
        durableContext: {
          latestHandoff: null,
          historicalResults: [predecessorVerdict, liveVerdict],
        },
      }))

      expect(decision.route).toBe('FOUNDER_GATE')
    })

    it('ignores malformed stale #421 predecessor evidence when a valid live-head verdict exists', () => {
      const liveBaseSha = '832782c585eb4c122ea05404fc1a615b865d68bb'
      const liveHeadSha = 'bbc264e9fa437c57a733f2a7f8a947001655405b'
      const stalePredecessorHeadSha = '346c2f2817adc33757a4934aac7184e12c142ca1'
      const liveVerdict = {
        id: 900,
        body: `## REVIEW_VERDICT\n**Task:** Issue #421\n**Repository:** \`boat1994/bemoat-web-starter\`\n**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/422 · \`main\` · \`${liveHeadSha}\`\n**Verdict:** ELIGIBLE FOR FOUNDER REVIEW`,
        createdAt: '2026-08-25T15:30:00Z',
        url: 'https://github.com/boat1994/bemoat-web-starter/issues/421#issuecomment-900',
      }
      const decision = routeContext(baseEvidence({
        protectedBase: { ...baseEvidence().protectedBase, sha: liveBaseSha },
        issue: {
          ...baseEvidence().issue,
          number: '421',
          url: 'https://github.com/boat1994/bemoat-web-starter/issues/421',
          workflowProfile: 'STANDARD',
        },
        localGit: { ...baseEvidence().localGit, branch: 'fix/421-standard-semantic-review', head: liveHeadSha },
        activePr: prEvidence({
          number: '422',
          url: 'https://github.com/boat1994/bemoat-web-starter/pull/422',
          headBranch: 'fix/421-standard-semantic-review',
          headSha: liveHeadSha,
          baseSha: liveBaseSha,
        }),
        currentHeadVerification: {
          ...verification({ exactHead: liveHeadSha }),
          reviews: { required: false, approved: true, exactHead: true, approvedCount: 0, exactHeadApprovedCount: 0 },
        },
        durableContext: {
          latestHandoff: null,
          historicalResults: [
            {
              id: 5406699778,
              body: actual421ReviewVerdictBody(stalePredecessorHeadSha),
              createdAt: '2026-08-25T06:58:56Z',
              url: 'https://github.com/boat1994/bemoat-web-starter/issues/421#issuecomment-5406699778',
            },
            liveVerdict,
          ],
        },
      }))

      expect(decision.route).toBe('FOUNDER_GATE')
    })

    it('keeps malformed live-head #421 evidence fail-closed', () => {
      const liveBaseSha = '832782c585eb4c122ea05404fc1a615b865d68bb'
      const liveHeadSha = 'bbc264e9fa437c57a733f2a7f8a947001655405b'
      const decision = routeContext(baseEvidence({
        protectedBase: { ...baseEvidence().protectedBase, sha: liveBaseSha },
        issue: {
          ...baseEvidence().issue,
          number: '421',
          url: 'https://github.com/boat1994/bemoat-web-starter/issues/421',
          workflowProfile: 'STANDARD',
        },
        localGit: { ...baseEvidence().localGit, branch: 'fix/421-standard-semantic-review', head: liveHeadSha },
        activePr: prEvidence({
          number: '422',
          url: 'https://github.com/boat1994/bemoat-web-starter/pull/422',
          headBranch: 'fix/421-standard-semantic-review',
          headSha: liveHeadSha,
          baseSha: liveBaseSha,
        }),
        currentHeadVerification: {
          ...verification({ exactHead: liveHeadSha }),
          reviews: { required: false, approved: true, exactHead: true, approvedCount: 0, exactHeadApprovedCount: 0 },
        },
        durableContext: {
          latestHandoff: null,
          historicalResults: [{
            id: 5407357001,
            body: actual421ReviewVerdictBody(liveHeadSha),
            createdAt: '2026-08-25T08:05:39Z',
            url: 'https://github.com/boat1994/bemoat-web-starter/issues/421#issuecomment-5407357001',
          }],
        },
      }))

      expect(decision.route).toBe('REVIEW')
    })

    it('routes CORRECTION REQUIRED REVIEW_VERDICT to REVIEW (does not satisfy gate)', () => {
      const decision = routeContext(baseEvidence({
        issue: { ...baseEvidence().issue, workflowProfile: 'STANDARD' },
        activePr: prEvidence(),
        currentHeadVerification: verification({
          reviews: { required: false, approved: true, exactHead: true, approvedCount: 1, exactHeadApprovedCount: 1 },
        }),
        durableContext: {
          latestHandoff: null,
          historicalResults: [correctionVerdict],
        },
      }))
      expect(decision.route).toBe('REVIEW')
    })

    it('routes durable STANDARD blocking review evidence to FIX without accepting reconciliation attempts', () => {
      const reviewedHead = '0d7c77995e92391b49e042e182b54af2d561c87c'
      const reviewBody = `## REVIEW_VERDICT

### Task log
- Phase: Independent Standard Semantic Review
- Executing role: Reviewer
- Review type: Full semantic review

**Repository:** \`boat1994/bemoat-web-starter\`
**Task / Issue:** #423
**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/424 · \`main\` · \`${reviewedHead}\`
**Verdict:** CORRECTION REQUIRED

### Immutable finding disposition
\`source_thread\`: https://github.com/boat1994/bemoat-web-starter/blob/${reviewedHead}/scripts/context/github.ts#L348-L352

\`\`\`json
{ "schema_version": 1, "mode": "implementation_pr", "reviewed_head": "${reviewedHead}", "findings": [{ "id": "CTX-423-001", "canonical_summary": "Conflicting PR state and merge-commit evidence is accepted as merged terminal evidence.", "source_thread": "https://github.com/boat1994/bemoat-web-starter/blob/${reviewedHead}/scripts/context/github.ts#L348-L352", "required_evidence": ["Require authoritative merged-state evidence to agree with mergeCommit evidence."] }] }
\`\`\``
      const reconciliationBody = reviewBody.replace(
        'Independent Standard Semantic Review',
        'Evidence reconciliation (no semantic re-review)',
      )

      const decision = routeContext(baseEvidence({
        protectedBase: {
          ...baseEvidence().protectedBase,
          sha: '6e09b0464d696dad97bf757f8a189fe81d2b74ec',
        },
        issue: {
          ...baseEvidence().issue,
          number: '423',
          url: 'https://github.com/boat1994/bemoat-web-starter/issues/423',
          workflowProfile: 'STANDARD',
        },
        localGit: {
          ...baseEvidence().localGit,
          branch: 'fix/423-post-merge-terminal-reconstruction',
          head: reviewedHead,
        },
        activePr: prEvidence({
          number: '424',
          url: 'https://github.com/boat1994/bemoat-web-starter/pull/424',
          headBranch: 'fix/423-post-merge-terminal-reconstruction',
          headSha: reviewedHead,
          baseSha: '6e09b0464d696dad97bf757f8a189fe81d2b74ec',
        }),
        currentHeadVerification: {
          ...verification({ exactHead: reviewedHead }),
          reviews: { required: false, approved: true, exactHead: true, approvedCount: 0, exactHeadApprovedCount: 0 },
        },
        durableContext: {
          latestHandoff: null,
          historicalResults: [
            { id: 5409353625, body: reviewBody, createdAt: '2026-08-25T10:54:48Z', url: 'https://github.com/boat1994/bemoat-web-starter/issues/423#issuecomment-5409353625' },
            { id: 5409520379, body: reconciliationBody, createdAt: '2026-08-25T11:11:32Z', url: 'https://github.com/boat1994/bemoat-web-starter/issues/423#issuecomment-5409520379' },
            { id: 5409533378, body: reconciliationBody, createdAt: '2026-08-25T11:12:41Z', url: 'https://github.com/boat1994/bemoat-web-starter/issues/423#issuecomment-5409533378' },
            { id: 5409552460, body: reconciliationBody, createdAt: '2026-08-25T11:14:23Z', url: 'https://github.com/boat1994/bemoat-web-starter/issues/423#issuecomment-5409552460' },
          ],
        },
      }))

      expect(decision.route).toBe('FIX')
      expect(decision.nextAction.description).toMatch(/bounded correction/i)
    })

    it('uses exact-head current-protocol evidence without role-marker prose', () => {
      const reviewedHead = headSha
      const reviewBody = `## REVIEW_VERDICT
**Repository:** \`boat1994/bemoat-web-starter\`
**Task / Issue:** #410
**PR / base / head:** PR #411 · \`main\` · \`${reviewedHead}\`
**Verdict:** CORRECTION REQUIRED

### Immutable finding disposition
\`\`\`json
{ "schema_version": 1, "mode": "implementation_pr", "reviewed_head": "${reviewedHead}", "findings": [{ "id": "CTX-001", "canonical_summary": "Fix it", "source_thread": "https://github.com/boat1994/bemoat-web-starter/pull/411#discussion_r1", "required_evidence": ["Evidence"] }] }
\`\`\``
      const decision = routeContext(baseEvidence({
        activePr: prEvidence(),
        currentHeadVerification: verification({
          reviews: { required: false, approved: true, exactHead: true, approvedCount: 1, exactHeadApprovedCount: 1 },
        }),
        durableContext: { latestHandoff: null, historicalResults: [{ ...correctionVerdict, body: reviewBody }] },
      }))

      expect(decision.route).toBe('FIX')
    })

    it('keeps an exact-bound CORRECTION REQUIRED verdict without a blocking finding on REVIEW', () => {
      const reviewedHead = '0d7c77995e92391b49e042e182b54af2d561c87c'
      const decision = routeContext(baseEvidence({
        issue: {
          ...baseEvidence().issue,
          number: '423',
          url: 'https://github.com/boat1994/bemoat-web-starter/issues/423',
          workflowProfile: 'STANDARD',
        },
        activePr: prEvidence({
          number: '424',
          url: 'https://github.com/boat1994/bemoat-web-starter/pull/424',
          headBranch: 'fix/423-post-merge-terminal-reconstruction',
          headSha: reviewedHead,
          baseSha: sha,
        }),
        currentHeadVerification: {
          ...verification({ exactHead: reviewedHead }),
          reviews: { required: false, approved: true, exactHead: true, approvedCount: 0, exactHeadApprovedCount: 0 },
        },
        durableContext: {
          latestHandoff: null,
          historicalResults: [{
            id: 5409353625,
            body: `## REVIEW_VERDICT\n### Task log\n- Phase: Independent Standard Semantic Review\n- Executing role: Reviewer\n- Review type: Full semantic review\n**Repository:** \`boat1994/bemoat-web-starter\`\n**Task / Issue:** #423\n**PR / base / head:** PR #424 · \`main\` · \`${reviewedHead}\`\n**Verdict:** CORRECTION REQUIRED\n### Immutable finding disposition\n\`{ "schema_version": 1, "mode": "implementation_pr", "reviewed_head": "${reviewedHead}", "findings": [] }\``,
            createdAt: '2026-08-25T10:54:48Z',
            url: 'https://github.com/boat1994/bemoat-web-starter/issues/410#issuecomment-5409353625',
          }],
        },
      }))

      expect(decision.route).toBe('REVIEW')
    })

    it.each([
      ['missing schema version', (head: string) => '{ "reviewed_head": "' + head + '", "findings": [{ "id": "CTX-001", "canonical_summary": "Fix it", "source_thread": "thread", "required_evidence": ["Evidence"] }] }'],
      ['missing reviewed head', () => '{ "schema_version": 1, "findings": [{ "id": "CTX-001", "canonical_summary": "Fix it", "source_thread": "thread", "required_evidence": ["Evidence"] }] }'],
      ['wrong reviewed head', () => '{ "schema_version": 1, "reviewed_head": "' + 'c'.repeat(40) + '", "findings": [{ "id": "CTX-001", "canonical_summary": "Fix it", "source_thread": "thread", "required_evidence": ["Evidence"] }] }'],
      ['missing source thread', (head: string) => '{ "schema_version": 1, "reviewed_head": "' + head + '", "findings": [{ "id": "CTX-001", "canonical_summary": "Fix it", "required_evidence": ["Evidence"] }] }'],
    ])('keeps CORRECTION REQUIRED with %s on REVIEW', (_label, serializedFinding) => {
      const reviewedHead = headSha
      const reviewBody = [
        '## REVIEW_VERDICT',
        '- Phase: Independent Standard Semantic Review',
        '- Executing role: Reviewer',
        '**Repository:** \x60boat1994/bemoat-web-starter\x60',
        '**Task / Issue:** #410',
        '**PR / base / head:** PR #411 · \x60main\x60 · \x60' + reviewedHead + '\x60',
        '**Verdict:** CORRECTION REQUIRED',
        '### Immutable finding disposition',
        '\x60\x60\x60json',
        serializedFinding(reviewedHead),
        '\x60\x60\x60',
      ].join('\n')
      const decision = routeContext(baseEvidence({
        activePr: prEvidence(),
        currentHeadVerification: verification(),
        durableContext: { latestHandoff: null, historicalResults: [{ ...correctionVerdict, body: reviewBody }] },
      }))

      expect(decision.route).toBe('REVIEW')
    })

    it.each([
      ['duplicate finding IDs', `{ "schema_version": 1, "mode": "implementation_pr", "reviewed_head": "${headSha}", "findings": [{ "id": "CTX-001", "canonical_summary": "Fix it", "source_thread": "thread-1", "required_evidence": ["Evidence"] }, { "id": "CTX-001", "canonical_summary": "Fix it twice", "source_thread": "thread-2", "required_evidence": ["Evidence"] }] }`],
      ['multiple fenced correction contracts', `{ "schema_version": 1, "mode": "implementation_pr", "reviewed_head": "${headSha}", "findings": [{ "id": "CTX-001", "canonical_summary": "Fix it", "source_thread": "thread", "required_evidence": ["Evidence"] }] }\n\n\`\`\`json\n{ "schema_version": 1, "mode": "implementation_pr", "reviewed_head": "${headSha}", "findings": [{ "id": "CTX-002", "canonical_summary": "Fix that", "source_thread": "thread", "required_evidence": ["Evidence"] }] }\n\`\`\``],
    ])('keeps CORRECTION REQUIRED with %s on REVIEW', (_label, findingBlocks) => {
      const reviewBody = [
        '## REVIEW_VERDICT',
        '**Repository:** \x60boat1994/bemoat-web-starter\x60',
        '**Task / Issue:** #410',
        '**PR / base / head:** PR #411 · \x60main\x60 · \x60' + headSha + '\x60',
        '**Verdict:** CORRECTION REQUIRED',
        '### Immutable finding disposition',
        '\x60\x60\x60json',
        findingBlocks,
        '\x60\x60\x60',
      ].join('\n')
      const decision = routeContext(baseEvidence({
        activePr: prEvidence(),
        currentHeadVerification: verification(),
        durableContext: { latestHandoff: null, historicalResults: [{ ...correctionVerdict, body: reviewBody }] },
      }))

      expect(decision.route).toBe('REVIEW')
    })

    it('routes STANDARD + stale/wrong-head review to REVIEW', () => {
      const decision = routeContext(baseEvidence({
        issue: { ...baseEvidence().issue, workflowProfile: 'STANDARD' },
        activePr: prEvidence(),
        currentHeadVerification: verification({
          reviews: { required: false, approved: true, exactHead: true, approvedCount: 1, exactHeadApprovedCount: 1 },
        }),
        durableContext: {
          latestHandoff: null,
          historicalResults: [staleVerdict],
        },
      }))
      expect(decision.route).toBe('REVIEW')
    })

    it('routes STANDARD + wrong PR review to REVIEW (fail closed)', () => {
      const decision = routeContext(baseEvidence({
        issue: { ...baseEvidence().issue, workflowProfile: 'STANDARD' },
        activePr: prEvidence(),
        currentHeadVerification: verification({
          reviews: { required: false, approved: true, exactHead: true, approvedCount: 1, exactHeadApprovedCount: 1 },
        }),
        durableContext: {
          latestHandoff: null,
          historicalResults: [wrongIssueVerdict],
        },
      }))
      expect(decision.route).toBe('REVIEW')
    })

    it('routes STANDARD + wrong base review to REVIEW (fail closed)', () => {
      const decision = routeContext(baseEvidence({
        issue: { ...baseEvidence().issue, workflowProfile: 'STANDARD' },
        activePr: prEvidence(),
        currentHeadVerification: verification({
          reviews: { required: false, approved: true, exactHead: true, approvedCount: 1, exactHeadApprovedCount: 1 },
        }),
        durableContext: {
          latestHandoff: null,
          historicalResults: [wrongBaseVerdict],
        },
      }))
      expect(decision.route).toBe('REVIEW')
    })

    it('routes STANDARD + genuine wrong Issue review to REVIEW (fail closed)', () => {
      const decision = routeContext(baseEvidence({
        issue: { ...baseEvidence().issue, workflowProfile: 'STANDARD' },
        activePr: prEvidence(),
        currentHeadVerification: verification({
          reviews: { required: false, approved: true, exactHead: true, approvedCount: 1, exactHeadApprovedCount: 1 },
        }),
        durableContext: {
          latestHandoff: null,
          historicalResults: [genuineWrongIssueVerdict],
        },
      }))
      expect(decision.route).toBe('REVIEW')
    })

    it('routes STANDARD + genuine wrong repository review to REVIEW (fail closed)', () => {
      const decision = routeContext(baseEvidence({
        issue: { ...baseEvidence().issue, workflowProfile: 'STANDARD' },
        activePr: prEvidence(),
        currentHeadVerification: verification({
          reviews: { required: false, approved: true, exactHead: true, approvedCount: 1, exactHeadApprovedCount: 1 },
        }),
        durableContext: {
          latestHandoff: null,
          historicalResults: [genuineWrongRepoVerdict],
        },
      }))
      expect(decision.route).toBe('REVIEW')
    })

    it('routes malformed or ambiguous competing verdict evidence to REVIEW (fail closed)', () => {
      const decisionAmbiguous = routeContext(baseEvidence({
        issue: { ...baseEvidence().issue, workflowProfile: 'STANDARD' },
        activePr: prEvidence(),
        currentHeadVerification: verification({
          reviews: { required: false, approved: true, exactHead: true, approvedCount: 1, exactHeadApprovedCount: 1 },
        }),
        durableContext: {
          latestHandoff: null,
          historicalResults: [validVerdict, validVerdict],
        },
      }))
      expect(decisionAmbiguous.route).toBe('REVIEW')

      const decisionMalformed = routeContext(baseEvidence({
        issue: { ...baseEvidence().issue, workflowProfile: 'STANDARD' },
        activePr: prEvidence(),
        currentHeadVerification: verification({
          reviews: { required: false, approved: true, exactHead: true, approvedCount: 1, exactHeadApprovedCount: 1 },
        }),
        durableContext: {
          latestHandoff: null,
          historicalResults: [malformedVerdict],
        },
      }))
      expect(decisionMalformed.route).toBe('REVIEW')
    })

    it('routes FAST + zero native approvals directly to FOUNDER_GATE without semantic review', () => {
      const decision = routeContext(baseEvidence({
        issue: { ...baseEvidence().issue, workflowProfile: 'FAST' },
        activePr: prEvidence(),
        currentHeadVerification: verification({
          reviews: { required: false, approved: true, exactHead: true, approvedCount: 0, exactHeadApprovedCount: 0 },
        }),
      }))
      expect(decision.route).toBe('FOUNDER_GATE')
    })

    it('preserves MANAGED regression behavior (requires review if standard dictates, or follows native)', () => {
      const decision = routeContext(baseEvidence({
        issue: { ...baseEvidence().issue, workflowProfile: 'MANAGED' },
        activePr: prEvidence(),
        currentHeadVerification: verification({
          reviews: { required: false, approved: true, exactHead: true, approvedCount: 0, exactHeadApprovedCount: 0 },
        }),
      }))
      // In current logic, MANAGED falls through to FOUNDER_GATE if no native review is required,
      // as only 'STANDARD' is checked for semanticReviewRequired.
      expect(decision.route).toBe('FOUNDER_GATE')
    })
  })

  it('stops when verification is bound to a stale or different PR head', () => {
    const decision = routeContext(baseEvidence({
      activePr: prEvidence(),
      currentHeadVerification: verification({ exactHead: 'c'.repeat(40) }),
    }))

    expect(decision.route).toBe('STOP')
    expect(decision.reasons.join(' ')).toMatch(/exact-head/i)
  })

  it('routes a merged PR to COMPLETE', () => {
    const decision = routeContext(baseEvidence({
      issue: { ...baseEvidence().issue, state: 'CLOSED' },
      activePr: prEvidence({ state: 'MERGED', merged: true, mergeCommitSha: 'd'.repeat(40) }),
      currentHeadVerification: verification({
        reviews: { required: true, approved: true, exactHead: true },
      }),
    }))

    expect(decision.route).toBe('COMPLETE')
  })

  it('fails closed when OPEN state contradicts merge-commit evidence instead of routing COMPLETE', () => {
    const decision = routeContext(baseEvidence({
      issue: { ...baseEvidence().issue, state: 'OPEN' },
      protectedBase: { ...baseEvidence().protectedBase, sha: 'a'.repeat(40) },
      activePr: prEvidence({
        state: 'OPEN',
        merged: true,
        baseSha: 'c'.repeat(40),
        mergeCommitSha: 'd'.repeat(40),
      }),
      currentHeadVerification: verification({
        reviews: { required: true, approved: true, exactHead: true },
      }),
    }))

    expect(decision.route).toBe('STOP')
    expect(decision.reasons.join(' ')).toMatch(/state and merge commit|base identity/i)
  })

  it('routes a merged PR to COMPLETE with its historical base and non-durable local checkout', () => {
    const decision = routeContext(baseEvidence({
      issue: { ...baseEvidence().issue, state: 'CLOSED' },
      protectedBase: { ...baseEvidence().protectedBase, sha: 'c'.repeat(40) },
      localGit: {
        ...baseEvidence().localGit,
        clean: true,
        detached: true,
        pushed: false,
        durable: false,
        reasons: ['LOCAL_STATE_NOT_DURABLE: repository is detached'],
      },
      activePr: prEvidence({
        state: 'MERGED',
        merged: true,
        baseSha: sha,
        mergeCommitSha: 'd'.repeat(40),
      }),
      currentHeadVerification: verification({
        reviews: { required: true, approved: true, exactHead: true },
      }),
    }))

    expect(decision.route).toBe('COMPLETE')
  })

  it('fails closed when merged PR evidence omits its merge commit', () => {
    const decision = routeContext(baseEvidence({
      issue: { ...baseEvidence().issue, state: 'CLOSED' },
      activePr: prEvidence({ state: 'MERGED', merged: true, mergeCommitSha: null }),
      currentHeadVerification: verification({
        reviews: { required: true, approved: true, exactHead: true },
      }),
    }))

    expect(decision.route).toBe('STOP')
    expect(decision.reasons.join(' ')).toMatch(/merge commit/i)
  })

  it('stops for missing required evidence and competing PRs', () => {
    const missing = routeContext(baseEvidence({
      evidenceErrors: ['EVIDENCE_CONFLICT: canonical policy source unavailable'],
    }))
    expect(missing.route).toBe('STOP')

    const competing = routeContext(baseEvidence({
      activePr: [prEvidence({ number: '411' }), prEvidence({ number: '412' })] as never,
    }))
    expect(competing.route).toBe('STOP')
    expect(competing.reasons.join(' ')).toMatch(/competing|ambiguous/i)
  })

  describe('story-first Context Story Matrix transitions', () => {
    const advancedBaseSha = 'c'.repeat(40)

    it.each([
      {
        story: 'a closed Issue without terminal PR evidence',
        evidence: baseEvidence({ issue: { ...baseEvidence().issue, state: 'CLOSED' } }),
        reason: /closed.*merged PR/i,
      },
      {
        story: 'an active PR targeting the wrong base branch',
        evidence: baseEvidence({ activePr: prEvidence({ baseBranch: 'release' }), currentHeadVerification: verification() }),
        reason: /base identity/i,
      },
      {
        story: 'a merged PR with a malformed merge commit',
        evidence: baseEvidence({
          issue: { ...baseEvidence().issue, state: 'CLOSED' },
          activePr: prEvidence({ state: 'MERGED', merged: true, mergeCommitSha: 'malformed' }),
          currentHeadVerification: verification(),
        }),
        reason: /merge commit/i,
      },
    ])('fails closed for $story', ({ evidence, reason }) => {
      const decision = routeContext(evidence)

      expect(decision.route).toBe('STOP')
      expect(decision.reasons.join(' ')).toMatch(reason)
    })

    it.each([
      {
        story: 'failed CI cannot outrank a stale active PR base',
        headVerification: verification({
          checks: { status: 'FAILURE', complete: true, failed: true, pending: false, required: true },
        }),
        durableContext: baseEvidence().durableContext,
      },
      {
        story: 'pending CI cannot outrank a stale active PR base',
        headVerification: verification({
          checks: { status: 'PENDING', complete: false, failed: false, pending: true, required: true },
        }),
        durableContext: baseEvidence().durableContext,
      },
      {
        story: 'green CI and clean review cannot outrank a stale active PR base',
        headVerification: verification({
          reviews: { required: true, approved: true, exactHead: true, approvedCount: 1, exactHeadApprovedCount: 1 },
        }),
        durableContext: { latestHandoff: null, historicalResults: [validVerdict] },
      },
    ])('$story', ({ headVerification, durableContext }) => {
      const decision = routeContext(baseEvidence({
        protectedBase: { ...baseEvidence().protectedBase, sha: advancedBaseSha },
        activePr: prEvidence({ baseSha: sha }),
        currentHeadVerification: headVerification,
        durableContext,
      }))

      expect(decision.route).toBe('STOP')
      expect(decision.reasons.join(' ')).toMatch(/base identity/i)
    })

    it('stops when a sibling merge advances protected main under an active PR', () => {
      const beforeSiblingMerge = routeContext(baseEvidence({
        activePr: prEvidence(),
        currentHeadVerification: verification({
          checks: { status: 'PENDING', complete: false, failed: false, pending: true, required: true },
        }),
      }))
      const afterSiblingMerge = routeContext(baseEvidence({
        protectedBase: { ...baseEvidence().protectedBase, sha: advancedBaseSha },
        activePr: prEvidence({ baseSha: sha }),
        currentHeadVerification: verification({
          checks: { status: 'PENDING', complete: false, failed: false, pending: true, required: true },
        }),
      }))

      expect(beforeSiblingMerge.route).toBe('VERIFY')
      expect(afterSiblingMerge.route).toBe('STOP')
    })

    it('invalidates old CI and review evidence across a PR head transition', () => {
      const newHeadSha = 'd'.repeat(40)
      const beforeCommit = routeContext(baseEvidence({
        activePr: prEvidence(),
        currentHeadVerification: verification({
          reviews: { required: true, approved: true, exactHead: true, approvedCount: 1, exactHeadApprovedCount: 1 },
        }),
        durableContext: { latestHandoff: null, historicalResults: [validVerdict] },
      }))
      const staleCiAfterCommit = routeContext(baseEvidence({
        localGit: { ...baseEvidence().localGit, head: newHeadSha },
        activePr: prEvidence({ headSha: newHeadSha }),
        currentHeadVerification: verification(),
        durableContext: { latestHandoff: null, historicalResults: [validVerdict] },
      }))
      const freshCiStaleReview = routeContext(baseEvidence({
        localGit: { ...baseEvidence().localGit, head: newHeadSha },
        activePr: prEvidence({ headSha: newHeadSha }),
        currentHeadVerification: verification({
          exactHead: newHeadSha,
          reviews: { required: false, approved: true, exactHead: true, approvedCount: 0, exactHeadApprovedCount: 0 },
        }),
        durableContext: { latestHandoff: null, historicalResults: [validVerdict] },
      }))

      expect(beforeCommit.route).toBe('FOUNDER_GATE')
      expect(staleCiAfterCommit.route).toBe('STOP')
      expect(freshCiStaleReview.route).toBe('REVIEW')
    })

    it('reconstructs a Founder manual merge as terminal despite historical base and local checkout', () => {
      const beforeMerge = routeContext(baseEvidence({
        activePr: prEvidence(),
        currentHeadVerification: verification({
          reviews: { required: true, approved: true, exactHead: true, approvedCount: 1, exactHeadApprovedCount: 1 },
        }),
        durableContext: { latestHandoff: null, historicalResults: [validVerdict] },
      }))
      const afterManualMerge = routeContext(baseEvidence({
        issue: { ...baseEvidence().issue, state: 'CLOSED' },
        protectedBase: { ...baseEvidence().protectedBase, sha: advancedBaseSha },
        localGit: {
          ...baseEvidence().localGit,
          branch: '<detached>',
          detached: true,
          pushed: false,
          durable: false,
          reasons: ['LOCAL_STATE_NOT_DURABLE: repository is detached'],
        },
        activePr: prEvidence({
          state: 'MERGED',
          merged: true,
          baseSha: sha,
          mergeCommitSha: 'e'.repeat(40),
        }),
        currentHeadVerification: verification(),
      }))

      expect(beforeMerge.route).toBe('FOUNDER_GATE')
      expect(afterManualMerge.route).toBe('COMPLETE')
    })
  })
})

describe('retained REVIEW_VERDICT Issue identity compatibility', () => {
  const head = 'a'.repeat(40)
  const valid = (issueFields: string) => `## REVIEW_VERDICT
**Repository:** \`boat1994/bemoat-web-starter\`
${issueFields}
**PR / base / head:** PR #435 · \`main\` · \`${head}\`
**Verdict:** ELIGIBLE FOR FOUNDER REVIEW`

  it('A: retains one valid Task / Issue field', () => {
    expect(resolveMergeReviewVerdictBinding(valid('**Task / Issue:** #434')).issue).toBe('434')
  })

  it('B: normalizes identical valid duplicate Task / Issue fields', () => {
    expect(resolveMergeReviewVerdictBinding(valid('**Task / Issue:** #434\n- Task / Issue: #434')).issue).toBe('434')
  })

  it('C: rejects conflicting valid Issue identities', () => {
    expect(() => resolveMergeReviewVerdictBinding(valid('**Task / Issue:** #434\n- Task / Issue: #999'))).toThrow(/duplicated or ambiguous/)
  })

  it('D: rejects a malformed recognized duplicate beside valid evidence', () => {
    expect(() => resolveMergeReviewVerdictBinding(valid('**Task / Issue:** #434\n- Task / Issue: not-an-issue'))).toThrow(/malformed|ambiguous/)
  })

  it('E: reconstructs the durable repeated-identity shape of comment 5426416809', () => {
    const body = valid(`### Review identity\n- Task / Issue: #434\n\n**Task / Issue:** #434`)
    expect(parseProductionMergeReviewVerdict(body, '5426416809').issue).toBe('434')
  })

  it('F: rejects a parsed Issue that differs from the caller expected Issue', () => {
    const parsed = parseProductionMergeReviewVerdict(valid('**Task / Issue:** #434'), '5426416809')
    expect(classifyMergeReviewVerdict({
      reviewVerdict: parsed,
      expected: {
        commentId: '5426416809',
        exactHead: head,
        pr: '435',
        base: 'main',
        repository: 'boat1994/bemoat-web-starter',
        issue: '436',
      },
    }).valid).toBe(false)
  })
})
