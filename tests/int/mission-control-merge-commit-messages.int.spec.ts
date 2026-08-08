import { describe, expect, it } from 'vitest'

import { normalizePaginatedCommitMessages } from '../../scripts/mission-control/domain/merge-commit-messages.mjs'

describe('merge commit message normalization', () => {
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
})
