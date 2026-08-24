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
    body: `## REVIEW_VERDICT\n**Verdict:** ELIGIBLE FOR FOUNDER REVIEW\n**PR / base / head:** PR #411 · \`main\` · \`${headSha}\``,
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
    body: `## REVIEW_VERDICT\n**Verdict:** ELIGIBLE FOR FOUNDER REVIEW\n**PR / base / head:** PR #411 · \`main\` · \`c${'c'.repeat(39)}\``,
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
    body: `## REVIEW_VERDICT\n**Verdict:** ELIGIBLE FOR FOUNDER REVIEW\n**PR / base / head:** PR #411 · \`wrongbase\` · \`${headSha}\``,
    createdAt: '2026-08-01T00:00:00Z',
    url: 'https://github.com/boat1994/bemoat-web-starter/issues/410#issuecomment-105',
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
