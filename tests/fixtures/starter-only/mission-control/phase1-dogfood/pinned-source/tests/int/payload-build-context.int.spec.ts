import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { isPayloadBuildContext } from '../../src/lib/payloadBuildContext'

describe('Payload build context detection', () => {
  it('detects npm lifecycle build events', () => {
    expect(isPayloadBuildContext({ npm_lifecycle_event: 'build' })).toBe(true)
    expect(isPayloadBuildContext({ npm_lifecycle_event: 'build:next' })).toBe(true)
    expect(isPayloadBuildContext({ npm_lifecycle_event: 'dev' })).toBe(false)
  })

  it('detects OpenNext re-entry and Next production phase markers', () => {
    expect(
      isPayloadBuildContext({
        BEMOAT_BUILD_CONTEXT: 'opennext-next-build',
      }),
    ).toBe(true)
    expect(
      isPayloadBuildContext({
        NEXT_PHASE: 'phase-production-build',
      }),
    ).toBe(true)
  })

  it('detects argv entries ending in build', () => {
    expect(isPayloadBuildContext({}, ['/repo/node_modules/.bin/next', 'build'])).toBe(true)
    expect(isPayloadBuildContext({}, ['pnpm', 'run', 'dev'])).toBe(false)
  })

  it('starter payload.config.ts uses the shared build context helper', () => {
    const payloadConfig = readFileSync(resolve(process.cwd(), 'src/payload.config.ts'), 'utf8')

    expect(payloadConfig).toContain("from './lib/payloadBuildContext'")
    expect(payloadConfig).toContain('isPayloadBuildContext()')
  })
})
