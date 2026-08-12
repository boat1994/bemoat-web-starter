import { existsSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('PR identity extraction seam', () => {
  it('keeps the pure domain module as the sole PR identity implementation', async () => {
    expect(existsSync('scripts/pr-identity.mjs')).toBe(false)
    expect(existsSync('scripts/mission-control/domain/pr-identity.mjs')).toBe(true)

    const domain = await import('../../scripts/mission-control/domain/pr-identity.mjs')
    expect(domain.parseCompleteGitHubPullUrl('https://github.com/boat1994/bemoat-web-starter/pull/335'))
      .toEqual({
        ok: true,
        identity: {
          owner: 'boat1994',
          repo: 'bemoat-web-starter',
          number: '335',
          key: 'boat1994/bemoat-web-starter#335',
        },
      })
  })
})
