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

    // Wipe only the isolated test persist root (see vitest.setup.ts) — never dev `.wrangler/state`.
    const testPersistRoot = process.env.BEMOAT_TEST_WRANGLER_PERSIST ?? '.wrangler-test/state/v3'
    rmSync(resolve(testPersistRoot), { recursive: true, force: true })

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
