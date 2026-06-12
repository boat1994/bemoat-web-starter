import openNextConfig from '../../open-next.config'

import { describe, expect, it } from 'vitest'

describe('OpenNext config', () => {
  it('builds the Next.js app without recursing into the Cloudflare adapter build', () => {
    expect(openNextConfig.buildCommand).toBe('pnpm exec next build')
    expect(openNextConfig.buildCommand).not.toContain('opennextjs-cloudflare build')
  })
})
