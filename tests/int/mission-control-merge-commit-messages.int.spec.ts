import { describe, expect, it } from 'vitest'

import { mergeCommitOid } from '../../scripts/mission-control/domain/merge-commit-oid.mjs'
import { normalizePaginatedCommitMessages } from '../../scripts/mission-control/domain/merge-commit-messages.mjs'
import { renderFinalResultBody } from '../../scripts/mission-control/domain/merge-final-result.mjs'
import { normalizeIssueState } from '../../scripts/mission-control/domain/merge-issue-state.mjs'

describe('merge domain normalization', () => {
  it('resolves the first available merge commit identity', () => {
    expect(mergeCommitOid(
      { mergeCommit: { oid: 'pr-oid', sha: 'pr-sha' } },
      { mergeCommit: { oid: 'result-oid', sha: 'result-sha' } },
    )).toBe('pr-oid')
    expect(mergeCommitOid(
      { mergeCommit: { sha: 'pr-sha' } },
      { mergeCommit: { oid: 'result-oid' } },
    )).toBe('pr-sha')
    expect(mergeCommitOid(
      null,
      { mergeCommit: { sha: 'result-sha' } },
    )).toBe('result-sha')
    expect(mergeCommitOid(null, null)).toBeNull()
  })

  it('flattens pages and preserves headline, multiline body, and empty messages', () => {
    expect(normalizePaginatedCommitMessages([
      [{ commit: { message: 'Subject\n\nFirst body line\nSecond body line' } }],
      [{ commit: {} }, {}],
    ])).toEqual([
      {
        messageHeadline: 'Subject',
        messageBody: '\nFirst body line\nSecond body line',
      },
      { messageHeadline: '', messageBody: '' },
      { messageHeadline: '', messageBody: '' },
    ])
  })

  it('fails closed when paginated results contain an incomplete page', () => {
    expect(() => normalizePaginatedCommitMessages([[], null])).toThrow(
      'BLOCKED_EXTERNAL: GitHub PR commit pagination did not return complete page arrays',
    )
  })

  it('normalizes Issue states and fails closed for missing Issues', () => {
    expect(normalizeIssueState({ state: 'closed' })).toBe('CLOSED')
    expect(normalizeIssueState({ state: 'OPEN' })).toBe('OPEN')
    expect(normalizeIssueState({})).toBe('')
    expect(normalizeIssueState(null)).toBe('')
  })

  it('renders campaign slice and blocker-resolution final RESULT bodies', () => {
    expect(renderFinalResultBody({
      issueNumber: 222,
      prNumber: 223,
      reviewedHead: '527a48cb83364a7fbde0fad5f88f5c9d1244d0ab',
      mergeCommit: '8df91686d715a0ddf0ddf258bf9fa5b060a4af29',
      base: 'main',
      policyVersion: '1.3.0',
      nextAction: 'select Slice 4',
      projectionKind: 'campaign-slice',
    })).toContain('**Next:** select Slice 4')

    expect(renderFinalResultBody({
      issueNumber: 254,
      prNumber: 255,
      reviewedHead: 'a'.repeat(40),
      mergeCommit: 'b'.repeat(40),
      base: 'main',
      policyVersion: '1.3.0',
      nextAction: null,
      projectionKind: 'blocker-resolution',
      campaignIssue: 215,
      campaignBlockerId: 'issue-254-planning-correction-1',
    })).toContain([
      '**Projection:** blocker-resolution',
      '**Campaign blocker:** #215 · `issue-254-planning-correction-1`',
    ].join('\n'))
  })
})
