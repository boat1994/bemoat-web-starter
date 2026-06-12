import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('boilerplate sync managed paths', () => {
  it('includes repository agent instructions and Cursor rules', () => {
    const script = readFileSync(resolve(process.cwd(), 'scripts/sync-boilerplate.mjs'), 'utf8')

    expect(script).toContain("'AGENTS.md'")
    expect(script).toContain("'.cursor/rules'")
  })
})
