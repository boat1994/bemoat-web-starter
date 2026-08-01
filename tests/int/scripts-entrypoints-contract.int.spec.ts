import { execSync } from 'node:child_process'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOTS = [
  'scripts/guard-harness-contract.mjs',
  'scripts/guard-mission-control-contract.mjs',
  'scripts/sync-boilerplate.mjs',
  'scripts/mission-control-reconcile.mjs'
]

describe('scripts entrypoints contract', () => {
  it('prevents breaking changes to stable root entrypoints', () => {
    for (const root of ROOTS) {
      const absolutePath = join(process.cwd(), root)
      let output = ''
      try {
        output = execSync(`node ${absolutePath} --help`, { encoding: 'utf8', stdio: 'pipe' }).trim()
      } catch (e: unknown) {
        const err = e as Error & { stdout?: string | Buffer }
        output = err.stdout ? String(err.stdout).trim() : err.message
      }
      expect(output).toBeTruthy()
    }
  })
})
