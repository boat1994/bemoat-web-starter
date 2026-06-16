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
    expect(violations.some((item: { rule: string }) => item.rule === 'build-must-call-wrapper')).toBe(
      true,
    )
    expect(violations.some((item: { rule: string }) => item.rule === 'build-next-must-call-next-build')).toBe(
      true,
    )
    expect(
      violations.some((item: { rule: string }) => item.rule === 'build-cloudflare-must-call-opennext'),
    ).toBe(true)
  })

  it('passes correct build script fixture', async () => {
    const mod = await import('../../scripts/guard-build-script-contract.mjs')
    const pkg = JSON.parse(readFileSync(resolve(fixturesRoot, 'package-correct-build.json'), 'utf8'))

    const violations = mod.scanBuildScriptContract(pkg.scripts, 'package.json')

    expect(violations).toEqual([])
  })

  it('flags a missing build wrapper file', async () => {
    const mod = await import('../../scripts/guard-build-script-contract.mjs')

    const violations = mod.scanBuildWrapperContract({
      root: fixturesRoot,
      fileExists: () => false,
    })

    expect(violations.some((item: { rule: string }) => item.rule === 'missing-build-wrapper')).toBe(true)
  })

  it('flags a build wrapper missing the OpenNext re-entry marker', async () => {
    const mod = await import('../../scripts/guard-build-script-contract.mjs')

    const violations = mod.scanBuildWrapperContract({
      root: process.cwd(),
      readFile: () => 'export function resolveBuildScript() { return "build:cloudflare" }',
    })

    expect(
      violations.some((item: { rule: string }) => item.rule === 'build-wrapper-missing-context-marker'),
    ).toBe(true)
  })

  it('flags a recursive open-next.config.ts fixture', async () => {
    const mod = await import('../../scripts/guard-build-script-contract.mjs')

    const violations = mod.scanOpenNextConfigContract({
      root: fixturesRoot,
      configPath: 'open-next-recursive.config.ts',
    })

    expect(
      violations.some((item: { rule: string }) => item.rule === 'open-next-must-not-call-opennext-build'),
    ).toBe(true)
    expect(
      violations.some((item: { rule: string }) => item.rule === 'open-next-missing-reentry-context'),
    ).toBe(true)
    expect(
      violations.some((item: { rule: string }) => item.rule === 'open-next-missing-universal-build'),
    ).toBe(true)
  })

  it('passes the starter open-next.config.ts contract', async () => {
    const mod = await import('../../scripts/guard-build-script-contract.mjs')

    const violations = mod.scanOpenNextConfigContract({ root: process.cwd() })

    expect(violations).toEqual([])
  })

  it('is listed in managedPaths for boilerplate sync', async () => {
    const syncMod = await import('../../scripts/sync-boilerplate.mjs')

    expect(syncMod.managedPaths).toContain('scripts/guard-build-script-contract.mjs')
    expect(syncMod.managedPaths).toContain('scripts/build.mjs')
    expect(syncMod.managedPaths).toContain('tests/int/build-script-contract-guard.int.spec.ts')
    expect(syncMod.managedPaths).toContain('tests/int/build-wrapper.int.spec.ts')
  })
})
