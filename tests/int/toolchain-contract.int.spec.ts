import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import * as guard from '../../scripts/guards/toolchain-contract.mjs'

describe('toolchain contract', () => {
  it('keeps the owned destination authoritative after root facade removal', () => {
    expect(existsSync(resolve(process.cwd(), 'scripts/guard-toolchain-contract.mjs'))).toBe(false)
    expect(Object.keys(guard).sort()).toEqual([
      'TOOLCHAIN_CONTRACT_PATH',
      'formatToolchainContractViolations',
      'getExpectedRootStrictNullChecks',
      'getToolchainContractExitCode',
      'scanToolchainContract',
    ])
  })

  it('requires the approved TypeScript, Node, and compiler invariants', async () => {
    const mod = guard
    const contract = JSON.parse(
      readFileSync(resolve(process.cwd(), '.bemoat/toolchain-contract.json'), 'utf8'),
    )

    expect(contract.typescript).toBe('6.0.3')
    expect(contract.node).toBe('24.15.0')
    expect(contract.compiler.strict).toBe(true)
    expect(contract.compiler.childStrictNullChecks).toBe(true)
    expect(contract.compiler.harnessRoots).toContain('scripts/context/**/*.ts')
    expect(JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')).scripts.typecheck)
      .toBe('node scripts/bemoat-typecheck.mjs')
    expect(mod.scanToolchainContract()).toEqual([])
  })

  it('fails closed when a required harness root is omitted', async () => {
    const mod = guard
    const config = JSON.parse(readFileSync(resolve(process.cwd(), 'tsconfig.harness-strict.json'), 'utf8'))
    config.include = config.include.filter((path: string) => path !== 'cloudflare-env.d.ts')

    expect(mod.scanToolchainContract({
      root: process.cwd(),
      readFile: (path: string) => path.endsWith('tsconfig.harness-strict.json') ? JSON.stringify(config) : readFileSync(path, 'utf8'),
    }).some((item: { rule: string }) => item.rule === 'missing-harness-project-file')).toBe(true)
  })

  it('fails when the root pnpm importer resolves a different TypeScript version', async () => {
    const mod = guard
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
    const mod = guard
    const lockfile = readFileSync(resolve(process.cwd(), 'pnpm-lock.yaml'), 'utf8')
      .replace(/\n      typescript:\n        specifier: 6\.0\.3\n        version: 6\.0\.3/, '')
      .replace('\npackages:', '\n\n  packages/child:\n    devDependencies:\n      typescript:\n        specifier: 6.0.3\n        version: 6.0.3\n\npackages:')

    expect(mod.scanToolchainContract({
      root: process.cwd(),
      readFile: (path: string) => path.endsWith('pnpm-lock.yaml') ? lockfile : readFileSync(path, 'utf8'),
    }).some((item: { rule: string }) => item.rule === 'typescript-lockfile-importer')).toBe(true)
  })

  it('uses the starter-only nullability exception only for the contract root', async () => {
    const mod = guard
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
    const mod = guard
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

  it('preserves quoted comment-like sequences while stripping real JSONC comments', async () => {
    const drift = await import('../../scripts/check-boilerplate-drift.mjs')

    const stripped = drift.stripJsoncComments(`{
  // line comment
  "paths": {
    "@/*": ["./src/*"],
    "url": "https://example.com/path//keep",
    "slashy": "has // inside",
    "quote": "say \\"hi\\" then /* keep */",
    "backslash": "tail\\\\"
  },
  "ok": true, /* block comment */
}`)

    expect(stripped).toContain('"@/*"')
    expect(stripped).toContain('"https://example.com/path//keep"')
    expect(stripped).toContain('"has // inside"')
    expect(stripped).toContain('"say \\"hi\\" then /* keep */"')
    expect(stripped).toContain('"tail\\\\"')
    expect(stripped).not.toMatch(/^\s*\/\/ /m)
    expect(stripped).not.toContain('/* block comment */')
    expect(stripped).not.toContain('// line comment')

    const parsed = JSON.parse(stripped)
    expect(parsed.paths['@/*']).toEqual(['./src/*'])
    expect(parsed.paths.url).toBe('https://example.com/path//keep')
    expect(parsed.paths.slashy).toBe('has // inside')
    expect(parsed.paths.quote).toBe('say "hi" then /* keep */')
    expect(parsed.paths.backslash).toBe('tail\\')
    expect(parsed.ok).toBe(true)
  })

  it('parses child-shaped tsconfig path aliases during toolchain drift checks', async () => {
    const drift = await import('../../scripts/check-boilerplate-drift.mjs')
    const fixtureRoot = resolve(process.cwd(), '.tmp-toolchain-jsonc-paths')
    const sourceRoot = resolve(fixtureRoot, 'source')
    const targetRoot = resolve(fixtureRoot, 'target')

    rmSync(fixtureRoot, { recursive: true, force: true })
    mkdirSync(resolve(sourceRoot, '.bemoat'), { recursive: true })
    mkdirSync(targetRoot, { recursive: true })
    writeFileSync(resolve(sourceRoot, '.bemoat/toolchain-contract.json'), readFileSync(resolve(process.cwd(), '.bemoat/toolchain-contract.json')))
    writeFileSync(resolve(targetRoot, 'package.json'), JSON.stringify({
      devDependencies: { typescript: '6.0.3' },
      scripts: { 'bemoat:typecheck': 'node scripts/bemoat-typecheck.mjs' },
    }))
    writeFileSync(resolve(targetRoot, 'tsconfig.json'), `{
  // child-shaped path alias fixture
  "compilerOptions": {
    "strict": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  } /* trailing block */
}
`)

    expect(drift.compareToolchainContractDrift({ sourceRoot, targetRoot })).toEqual([])
    rmSync(fixtureRoot, { recursive: true, force: true })
  })

  it('still reports genuine toolchain drift after JSONC-safe parsing', async () => {
    const drift = await import('../../scripts/check-boilerplate-drift.mjs')
    const fixtureRoot = resolve(process.cwd(), '.tmp-toolchain-jsonc-drift')
    const sourceRoot = resolve(fixtureRoot, 'source')
    const targetRoot = resolve(fixtureRoot, 'target')

    rmSync(fixtureRoot, { recursive: true, force: true })
    mkdirSync(resolve(sourceRoot, '.bemoat'), { recursive: true })
    mkdirSync(targetRoot, { recursive: true })
    writeFileSync(resolve(sourceRoot, '.bemoat/toolchain-contract.json'), readFileSync(resolve(process.cwd(), '.bemoat/toolchain-contract.json')))
    writeFileSync(resolve(targetRoot, 'package.json'), JSON.stringify({
      devDependencies: { typescript: '5.8.0' },
      scripts: { 'bemoat:typecheck': 'node scripts/bemoat-typecheck.mjs' },
    }))
    writeFileSync(resolve(targetRoot, 'tsconfig.json'), `{
  "compilerOptions": {
    "strict": false,
    "paths": { "@/*": ["./src/*"] }
  }
}
`)

    expect(drift.compareToolchainContractDrift({ sourceRoot, targetRoot })).toEqual([
      'package.json TypeScript must pin 6.0.3',
      'tsconfig.json must preserve strict mode and effective strictNullChecks',
    ])
    rmSync(fixtureRoot, { recursive: true, force: true })
  })

  it('MC-R1-001 preserves quoted trailing-comma lookalikes and removes structural trailing commas', async () => {
    const drift = await import('../../scripts/check-boilerplate-drift.mjs')

    expect(JSON.parse(drift.stripJsoncComments('{"value": ",}"}')).value).toBe(',}')
    expect(JSON.parse(drift.stripJsoncComments('{"value": ",]"}')).value).toBe(',]')
    expect(JSON.parse(drift.stripJsoncComments('{"value": ",   }"}')).value).toBe(',   }')
    expect(JSON.parse(drift.stripJsoncComments('{"value": ",   ]"}')).value).toBe(',   ]')
    expect(JSON.parse(drift.stripJsoncComments('{"value": ",\\n}"}')).value).toBe(',\n}')
    expect(JSON.parse(drift.stripJsoncComments('{"value": ",\\n]"}')).value).toBe(',\n]')
    expect(JSON.parse(drift.stripJsoncComments('{"value": "say \\",}\\" near"}')).value).toBe('say ",}" near')
    expect(JSON.parse(drift.stripJsoncComments('{"value": "tail\\\\,}"}')).value).toBe('tail\\,}')

    expect(JSON.parse(drift.stripJsoncComments('{"a":1,"b":2,}')).b).toBe(2)
    expect(JSON.parse(drift.stripJsoncComments('{"nested":{"a":1,},"b":[1,2,],}')).nested.a).toBe(1)
    expect(JSON.parse(drift.stripJsoncComments('[1,2,3,]')).length).toBe(3)
    expect(JSON.parse(drift.stripJsoncComments('{"a":1, /* keep */ }')).a).toBe(1)
    expect(JSON.parse(drift.stripJsoncComments('{"a":1, // keep\n}')).a).toBe(1)
    expect(JSON.parse(drift.stripJsoncComments('[1, /* c */ ]'))).toEqual([1])
  })

  it('MC-R1-002 rejects unterminated block comments while preserving valid JSONC', async () => {
    const drift = await import('../../scripts/check-boilerplate-drift.mjs')

    expect(() => drift.stripJsoncComments('{"compilerOptions":{"strict":true}}/* no closing')).toThrow(SyntaxError)
    expect(() => drift.stripJsoncComments('{"compilerOptions":{"strict":true}}/* no closing')).toThrow(/unterminated block comment/i)
    expect(() => drift.stripJsoncComments('{"a":1 /* still open')).toThrow(SyntaxError)
    expect(() => drift.stripJsoncComments('{"a":1 /* still open')).toThrow(/unterminated block comment/i)

    expect(JSON.parse(drift.stripJsoncComments('{"a":1} /* closed */')).a).toBe(1)
    expect(JSON.parse(drift.stripJsoncComments('{"a":1}/*one*//*two*/')).a).toBe(1)
    expect(JSON.parse(drift.stripJsoncComments('{\n  /* multi\n     line */\n  "a": 1\n}')).a).toBe(1)

    const childShaped = drift.stripJsoncComments(`{
  // real line comment
  "paths": { "@/*": ["./src/*"] }
  /* real block comment */
}`)
    expect(JSON.parse(childShaped).paths['@/*']).toEqual(['./src/*'])
    expect(childShaped).not.toContain('// real line comment')
    expect(childShaped).not.toContain('/* real block comment */')
  })
})
