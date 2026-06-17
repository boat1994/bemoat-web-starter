// @vitest-environment node

import { rmSync } from 'node:fs'
import { resolve } from 'node:path'

import { getPayload, type Payload } from 'payload'

import { describe, it, beforeAll, afterAll, expect } from 'vitest'

let payload: Payload

describe('API', () => {
  beforeAll(async () => {
    Object.assign(process.env, { NODE_ENV: 'test' })
    process.env.PAYLOAD_MIGRATE_REMOTE = 'false'

    // Use a fresh local D1 binding so dev schema push does not prompt against persisted remote data.
    rmSync(resolve('.wrangler/state/v3/d1'), { recursive: true, force: true })

    const { default: config } = await import('@/payload.config')
    const payloadConfig = await config
    payload = await getPayload({ config: payloadConfig })
  })

  afterAll(async () => {
    await payload?.destroy()
  })

  it('fetches users', async () => {
    const users = await payload.find({
      collection: 'users',
    })
    expect(users).toBeDefined()
  })
})
