import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('planning contract pure boundary', () => {
  it('exports identity parsing and static validation without orchestration dependencies', async () => {
    const source = readFileSync('scripts/guards/planning-contract.ts', 'utf8')
    const mod = await import('../../scripts/guards/planning-contract.ts')

    expect(mod.parseTaskIdentityBlock).toBeTypeOf('function')
    expect(mod.validateStaticContract).toBeTypeOf('function')
    expect(mod.validatePairedContracts).toBeTypeOf('function')
    expect(source).not.toMatch(/node:fs|node:child_process|from ['"]\.\/mission-control-state\.mjs['"]|from ['"]node:path['"]|from ['"]node:url['"]|from ['"]node:os['"]/)
  })
})
