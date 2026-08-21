import { describe, expect, it } from 'vitest'

import { selectLiveReviewVerdictComment } from '../../scripts/mission-control/review-verdict-binding.mjs'

const head = 'e'.repeat(40)
const staleHead = 'd'.repeat(40)
const livePr = { number: 101, baseRefName: 'main', headRefOid: head }

function selectStandard(options: Record<string, unknown>) {
  return selectLiveReviewVerdictComment({
    ...options,
    requireExactIssueBinding: true,
    requireNonSuperseded: true,
    requireImmutableCommentId: true,
    rejectNonExactTargets: true,
  } as Parameters<typeof selectLiveReviewVerdictComment>[0])
}

function verdict(id: string, reviewedHead = head, extra = '') {
  return {
    id,
    body: `## REVIEW_VERDICT

**Task / Issue:** #100
**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**PR / base / head:** PR #101 · \`main\` · \`${reviewedHead}\`
${extra}`,
  }
}

describe('STANDARD/non-managed REVIEW_VERDICT selection', () => {
  it('selects the one active exact-target verdict and preserves its immutable ID', () => {
    expect(selectStandard({
      comments: [verdict('777')],
      issueNumber: 100,
      livePr,
      exactHead: head,
    })).toMatchObject({ id: '777' })
  })

  it('selects exact target and ignores historical verdicts for older heads', () => {
    expect(selectStandard({
      comments: [
        verdict('775', 'a'.repeat(40)),
        verdict('776', staleHead),
        verdict('777', head),
      ],
      issueNumber: 100,
      livePr,
      exactHead: head,
    })).toMatchObject({ id: '777' })
  })


  it('rejects duplicate exact-target verdicts', () => {
    expect(() => selectStandard({
      comments: [verdict('777'), verdict('778')],
      issueNumber: 100,
      livePr,
      exactHead: head,
    })).toThrow(/competing|unique/i)
  })

  it('rejects a superseded exact-target verdict', () => {
    expect(() => selectStandard({
      comments: [verdict('777', head, '**Superseded:** true')],
      issueNumber: 100,
      livePr,
      exactHead: head,
    })).toThrow(/superseded|eligible|unique/i)
  })

  it('rejects stale or wrong-Issue evidence when no exact eligible verdict exists', () => {
    expect(() => selectStandard({
      comments: [verdict('777', staleHead)],
      issueNumber: 100,
      livePr,
      exactHead: head,
    })).toThrow(/exact|review/i)
    expect(() => selectStandard({
      comments: [
        {
          ...verdict('778'),
          body: verdict('778').body.replace('#100', '#999'),
        },
      ],
      issueNumber: 100,
      livePr,
      exactHead: head,
    })).toThrow(/exact|Issue|review/i)
  })

  it('rejects wrong PR, base, and missing immutable comment ID evidence', () => {
    expect(() => selectStandard({
      comments: [{
        ...verdict('777'),
        body: verdict('777').body.replace('PR #101', 'PR #999'),
      }],
      issueNumber: 100,
      livePr,
      exactHead: head,
    })).toThrow(/target|PR|exact/i)
    expect(() => selectStandard({
      comments: [{
        ...verdict('777'),
        body: verdict('777').body.replace('`main`', '`dev`'),
      }],
      issueNumber: 100,
      livePr,
      exactHead: head,
    })).toThrow(/target|base|exact/i)
    expect(() => selectStandard({
      comments: [verdict('')],
      issueNumber: 100,
      livePr,
      exactHead: head,
    })).toThrow(/comment ID|immutable/i)
  })
})
