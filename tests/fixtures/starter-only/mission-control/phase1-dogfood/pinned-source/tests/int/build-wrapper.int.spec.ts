import { describe, expect, it } from 'vitest'

describe('build wrapper', () => {
  it('routes top-level builds to build:cloudflare', async () => {
    const mod = await import('../../scripts/build.mjs')

    expect(mod.resolveBuildScript({ ...process.env, BEMOAT_BUILD_CONTEXT: undefined })).toBe(
      'build:cloudflare',
    )
    expect(mod.resolveBuildScript({ ...process.env, BEMOAT_BUILD_CONTEXT: 'other' })).toBe(
      'build:cloudflare',
    )
  })

  it('routes OpenNext re-entry to build:next', async () => {
    const mod = await import('../../scripts/build.mjs')

    expect(
      mod.resolveBuildScript({ ...process.env, BEMOAT_BUILD_CONTEXT: 'opennext-next-build' }),
    ).toBe('build:next')
  })
})
