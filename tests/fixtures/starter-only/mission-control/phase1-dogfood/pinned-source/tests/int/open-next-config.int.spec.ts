import openNextConfig from '../../open-next.config'

import { describe, expect, it } from 'vitest'

describe('OpenNext config', () => {
  it('re-enters the universal build wrapper for the Next.js phase', () => {
    expect(openNextConfig.buildCommand).toBe(
      'cross-env BEMOAT_BUILD_CONTEXT=opennext-next-build pnpm run build',
    )
    expect(openNextConfig.buildCommand).not.toContain('opennextjs-cloudflare build')
  })
})
