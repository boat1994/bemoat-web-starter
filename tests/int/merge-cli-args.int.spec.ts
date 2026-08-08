import { describe, expect, it } from 'vitest'

import { parseMergeCliArgs } from '../../scripts/mission-control/domain/merge-cli-args.mjs'

describe('merge CLI argument parsing', () => {
  it('parses the task, repository, and authorization comment options', () => {
    expect(parseMergeCliArgs([
      '222',
      '--repo',
      'boat1994/bemoat-web-starter',
      '--authorization-comment',
      '6000000001',
    ])).toEqual({
      issueNumber: 222,
      repo: 'boat1994/bemoat-web-starter',
      authorizationCommentId: '6000000001',
    })
  })
})
