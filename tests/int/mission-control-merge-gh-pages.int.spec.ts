import { describe, expect, it } from 'vitest'

import { flattenGhPages } from '../../scripts/mission-control/domain/merge-gh-pages.ts'

describe('merge GitHub page normalization', () => {
  it('flattens nested pages and keeps only object entries', () => {
    const objectEntry = { id: 1 }
    const nestedObjectEntry = { id: 2 }

    expect(flattenGhPages([
      [objectEntry, null, 'ignored'],
      [[nestedObjectEntry], undefined, { id: 3 }],
    ])).toEqual([objectEntry, nestedObjectEntry, { id: 3 }])
  })

  it('returns an empty list for non-array or empty pagination results', () => {
    expect(flattenGhPages(null)).toEqual([])
    expect(flattenGhPages({ page: 1 })).toEqual([])
    expect(flattenGhPages([])).toEqual([])
  })
})
