import { describe, expect, it } from 'vitest'

import { classifyMergeability } from '../../scripts/mission-control/domain/merge-mergeability.ts'

describe('classifyMergeability', () => {
  it('accepts a verified MERGEABLE pull request', () => {
    expect(classifyMergeability({ mergeable: 'MERGEABLE' })).toEqual({
      valid: true,
      reason: null,
    })
  })

  it.each([
    ['missing', {}],
    ['conflicting', { mergeable: 'CONFLICTING' }],
    ['unknown', { mergeable: 'UNKNOWN' }],
  ])('rejects a %s mergeability result', (_label, pullRequest) => {
    expect(classifyMergeability(pullRequest)).toEqual({
      valid: false,
      reason: 'PR mergeability changed or is not verified as MERGEABLE',
    })
  })
})
