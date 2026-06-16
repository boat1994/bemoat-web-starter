import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const fixturesRoot = resolve(process.cwd(), 'tests/fixtures/guard')

describe('build script contract guard', () => {
  it('passes on the current repository package.json', async () => {
    const mod = await import('../../scripts/guard-build-script-contract.mjs')

    const violations = mod.runBuildScriptContractGuard()

    expect(mod.getBuildScriptContractExitCode(violations)).toBe(0)
    expect(violations).toEqual([])
  })

  it('flags recursive OpenNext build script fixture', async () => {
    const mod = await import('../../scripts/guard-build-script-contract.mjs')
    const pkg = JSON.parse(readFileSync(resolve(fixturesRoot, 'package-recursive-build.json'), 'utf8'))

    const violations = mod.scanBuildScriptContract(pkg.scripts, 'package.json')

    expect(violations.some((item: { rule: string }) => item.rule === 'build-must-not-call-opennext')).toBe(
      true,
    )
    expect(violations.some((item: { rule: string }) => item.rule === 'missing-cf-build')).toBe(true)
    expect(violations.some((item: { rule: string }) => item.rule === 'build-must-call-next-build')).toBe(
      true,
    )
  })

  it('passes correct build script fixture', async () => {
    const mod = await import('../../scripts/guard-build-script-contract.mjs')
    const pkg = JSON.parse(readFileSync(resolve(fixturesRoot, 'package-correct-build.json'), 'utf8'))

    const violations = mod.scanBuildScriptContract(pkg.scripts, 'package.json')

    expect(violations).toEqual([])
  })

  it('is listed in managedPaths for boilerplate sync', async () => {
    const syncMod = await import('../../scripts/sync-boilerplate.mjs')

    expect(syncMod.managedPaths).toContain('scripts/guard-build-script-contract.mjs')
    expect(syncMod.managedPaths).toContain('tests/int/build-script-contract-guard.int.spec.ts')
  })
})
