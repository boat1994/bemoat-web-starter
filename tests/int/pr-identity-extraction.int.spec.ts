import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('PR identity extraction seam', () => {
  it('keeps the root module as a stable facade over the pure domain module', async () => {
    const facadeSource = readFileSync('scripts/pr-identity.mjs', 'utf8')
    expect(facadeSource).toBe("export * from './mission-control/domain/pr-identity.mjs'\n")
    expect(existsSync('scripts/mission-control/domain/pr-identity.mjs')).toBe(true)

    const facade = await import('../../scripts/pr-identity.mjs')
    const domain = await import('../../scripts/mission-control/domain/pr-identity.mjs')
    expect(Object.keys(facade).sort()).toEqual(Object.keys(domain).sort())
    expect(facade.parseCompleteGitHubPullUrl('https://github.com/boat1994/bemoat-web-starter/pull/335'))
      .toEqual(domain.parseCompleteGitHubPullUrl('https://github.com/boat1994/bemoat-web-starter/pull/335'))
  })
})
