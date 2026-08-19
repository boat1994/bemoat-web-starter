import { describe, expect, it } from 'vitest'

import { createProductionMergeDeps } from '../../scripts/mission-control/adapters/merge-github.mjs'

describe('mission-control merge GitHub adapter', () => {
  it('preserves exact-head merge command construction through the injected transport', async () => {
    const calls: string[][] = []
    const expectedHead = 'a'.repeat(40)
    const deps = createProductionMergeDeps({
      runGh(args: string[]) {
        calls.push(args)
        return ''
      },
    })

    await deps.mergePullRequest({
      prNumber: 223,
      repo: 'boat1994/bemoat-web-starter',
      expectedHead,
    })

    expect(calls).toEqual([[
      'pr',
      'merge',
      '223',
      '--repo',
      'boat1994/bemoat-web-starter',
      '--merge',
      '--match-head-commit',
      expectedHead,
    ]])
  })

  it('reads the live protected base ref through the canonical GitHub adapter', async () => {
    const calls: string[][] = []
    const deps = createProductionMergeDeps({
      runGh(args: string[]) {
        calls.push(args)
        return JSON.stringify({ object: { sha: 'e'.repeat(40) } })
      },
    })

    await expect(deps.readProtectedRef('boat1994/bemoat-web-starter', 'main')).resolves.toEqual({
      object: { sha: 'e'.repeat(40) },
    })
    expect(calls).toEqual([['api', 'repos/boat1994/bemoat-web-starter/git/ref/heads/main']])
  })

  it('maps a concrete GitHub transport failure to BLOCKED_EXTERNAL', async () => {
    const originalPath = process.env.PATH
    process.env.PATH = ''
    try {
      const deps = createProductionMergeDeps()
      await expect(deps.mergePullRequest({
        prNumber: 223,
        repo: 'boat1994/bemoat-web-starter',
        expectedHead: 'a'.repeat(40),
      })).rejects.toMatchObject({ classification: 'BLOCKED_EXTERNAL' })
    } finally {
      process.env.PATH = originalPath
    }
  })
})
