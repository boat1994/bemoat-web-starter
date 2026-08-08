import { describe, expect, it } from 'vitest'

import { commentSupersedesId } from '../../scripts/mission-control/domain/merge-comment-supersession.mjs'

describe('commentSupersedesId', () => {
  it('classifies explicit supersession markers and structured authorization references', () => {
    expect(commentSupersedesId('supersedes: 42', 42)).toBe(true)
    expect(commentSupersedesId('superseded_comment_id: 42', '42')).toBe(true)
    expect(commentSupersedesId('Comment 42 is not authoritative', 42)).toBe(true)
    expect(commentSupersedesId(JSON.stringify({ supersedes_comment_ids: [42] }), 42)).toBe(true)
    expect(commentSupersedesId(JSON.stringify({ supersedes_comment_id: 42 }), 42)).toBe(true)
  })

  it('rejects unrelated, malformed, or differently identified comments', () => {
    expect(commentSupersedesId('supersedes: 41', 42)).toBe(false)
    expect(commentSupersedesId('Comment 42 is authoritative', 42)).toBe(false)
    expect(commentSupersedesId('{not-json}', 42)).toBe(false)
    expect(commentSupersedesId(null, 42)).toBe(false)
  })
})
