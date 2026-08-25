import { describe, expect, it } from 'vitest'

import { routeContext } from '../../scripts/context/router.ts'
import type { NormalizedContextEvidence } from '../../scripts/context/model.ts'

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
      activePr: prEvidence({ state: 'MERGED', merged: true }),
      currentHeadVerification: verification({
        reviews: { required: true, approved: true, exactHead: true },
      }),
    }))

    expect(decision.route).toBe('COMPLETE')
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
})
