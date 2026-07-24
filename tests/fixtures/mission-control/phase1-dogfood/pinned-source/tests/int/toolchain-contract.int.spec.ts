import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
    }).some((item: { rule: string }) => item.rule === 'missing-harness-project-file')).toBe(true)
  })

  it('fails when the root pnpm importer resolves a different TypeScript version', async () => {
    const mod = await import('../../scripts/guard-toolchain-contract.mjs')
    const packageJSON = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'))
    const lockfile = readFileSync(resolve(process.cwd(), 'pnpm-lock.yaml'), 'utf8')
      .replace('specifier: 6.0.3\n        version: 6.0.3', 'specifier: 5.8.0\n        version: 5.8.0')

    expect(mod.scanToolchainContract({
      root: process.cwd(),
      readFile: (path: string) => {
        if (path.endsWith('package.json')) return JSON.stringify(packageJSON)
        if (path.endsWith('pnpm-lock.yaml')) return lockfile
        return readFileSync(path, 'utf8')
      },
    }).some((item: { rule: string }) => item.rule === 'typescript-lockfile-importer')).toBe(true)
  })

  it('fails when only a later workspace importer declares the approved TypeScript', async () => {
    const mod = await import('../../scripts/guard-toolchain-contract.mjs')
    const lockfile = readFileSync(resolve(process.cwd(), 'pnpm-lock.yaml'), 'utf8')
      .replace(/\n      typescript:\n        specifier: 6\.0\.3\n        version: 6\.0\.3/, '')
      .replace('\npackages:', '\n\n  packages/child:\n    devDependencies:\n      typescript:\n        specifier: 6.0.3\n        version: 6.0.3\n\npackages:')

    expect(mod.scanToolchainContract({
      root: process.cwd(),
      readFile: (path: string) => path.endsWith('pnpm-lock.yaml') ? lockfile : readFileSync(path, 'utf8'),
    }).some((item: { rule: string }) => item.rule === 'typescript-lockfile-importer')).toBe(true)
  })

  it('uses the starter-only nullability exception only for the contract root', async () => {
    const mod = await import('../../scripts/guard-toolchain-contract.mjs')
    const contract = JSON.parse(readFileSync(resolve(process.cwd(), '.bemoat/toolchain-contract.json'), 'utf8'))

    expect(mod.getExpectedRootStrictNullChecks({
      root: '/tmp/starter',
      contractRoot: '/tmp/starter',
      contract,
      packageJSON: { name: 'bemoat-web-starter' },
    })).toBe(false)
    expect(mod.getExpectedRootStrictNullChecks({
      root: '/tmp/child',
      contractRoot: '/tmp/starter',
      contract,
      packageJSON: { name: 'child-project' },
    })).toBe(true)
    expect(mod.getExpectedRootStrictNullChecks({
      root: '/tmp/cloned-source',
      contractRoot: '/tmp/cloned-source',
      contract,
      packageJSON: { name: 'child-project' },
    })).toBe(true)
  })

  it('fails when an inherited exclusion removes a managed harness root', async () => {
    const mod = await import('../../scripts/guard-toolchain-contract.mjs')
    const strictConfig = JSON.parse(readFileSync(resolve(process.cwd(), 'tsconfig.harness-strict.json'), 'utf8'))
    strictConfig.exclude = ['tests/int/toolchain-contract.int.spec.ts']

    expect(mod.scanToolchainContract({
      root: process.cwd(),
      readFile: (path: string) => path.endsWith('tsconfig.harness-strict.json')
        ? JSON.stringify(strictConfig)
        : readFileSync(path, 'utf8'),
    }).some((item: { rule: string }) => item.rule === 'missing-harness-project-file')).toBe(true)
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

  it('treats a divergent public bemoat:typecheck script as blocking sync drift', async () => {
    const drift = await import('../../scripts/check-boilerplate-drift.mjs')
    const fixtureRoot = resolve(process.cwd(), '.tmp-toolchain-script-drift')
    const sourceRoot = resolve(fixtureRoot, 'source')
    const targetRoot = resolve(fixtureRoot, 'target')

    rmSync(fixtureRoot, { recursive: true, force: true })
    mkdirSync(resolve(sourceRoot, '.bemoat'), { recursive: true })
    mkdirSync(targetRoot, { recursive: true })
    writeFileSync(resolve(sourceRoot, '.bemoat/toolchain-contract.json'), readFileSync(resolve(process.cwd(), '.bemoat/toolchain-contract.json')))
    writeFileSync(resolve(targetRoot, 'package.json'), JSON.stringify({
      devDependencies: { typescript: '6.0.3' },
      scripts: { 'bemoat:typecheck': 'echo bypassed' },
    }))
    writeFileSync(resolve(targetRoot, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true } }))

    expect(drift.compareToolchainContractDrift({ sourceRoot, targetRoot })).toContain(
      'package.json bemoat:typecheck must match the managed toolchain contract',
    )
    rmSync(fixtureRoot, { recursive: true, force: true })
  })
})
