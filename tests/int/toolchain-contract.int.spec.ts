import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('toolchain contract', () => {
  it('requires the approved TypeScript, Node, and compiler invariants', async () => {
    const mod = await import('../../scripts/guard-toolchain-contract.mjs')
    const contract = JSON.parse(
      readFileSync(resolve(process.cwd(), '.bemoat/toolchain-contract.json'), 'utf8'),
    )

    expect(contract.typescript).toBe('6.0.3')
    expect(contract.node).toBe('24.15.0')
    expect(contract.compiler.strict).toBe(true)
    expect(contract.compiler.childStrictNullChecks).toBe(true)
    expect(mod.scanToolchainContract()).toEqual([])
  })

  it('fails closed when a required harness root is omitted', async () => {
    const mod = await import('../../scripts/guard-toolchain-contract.mjs')
    const config = JSON.parse(readFileSync(resolve(process.cwd(), 'tsconfig.harness-strict.json'), 'utf8'))
    config.include = config.include.filter((path: string) => path !== 'cloudflare-env.d.ts')

    expect(mod.scanToolchainContract({
      root: process.cwd(),
      readFile: (path: string) => path.endsWith('tsconfig.harness-strict.json') ? JSON.stringify(config) : readFileSync(path, 'utf8'),
    }).some((item: { rule: string }) => item.rule === 'missing-harness-root')).toBe(true)
  })

  it('treats a child TypeScript mismatch as blocking sync drift', async () => {
    const drift = await import('../../scripts/check-boilerplate-drift.mjs')
    const report = {
      managed: { missing: [] as string[], changed: [] as string[] },
      seed: { missingSeed: [] as string[] },
      mergeKeep: { missing: [] as string[], changed: [] as string[] },
      toolchain: ['package.json TypeScript must pin 6.0.3'],
    }

    expect(drift.getDriftExitCode(report)).toBe(1)
  })
})
