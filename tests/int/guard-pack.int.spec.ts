import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const fixturesRoot = resolve(process.cwd(), 'tests/fixtures/guard')

describe('central guard pack', () => {
  it('exports all v1 guards in deterministic order', async () => {
    const mod = await import('../../scripts/guard-pack.mjs')

    expect(mod.GUARD_PACK.map((guard: { id: string }) => guard.id)).toEqual([
      'repo-safety',
      'harness-contract',
      'build-script-contract',
      'package-manager',
      'env-placeholder',
      'cloudflare-config',
      'frontend-seo',
    ])
  })

  it('passes on the current repository', async () => {
    const mod = await import('../../scripts/guard-pack.mjs')

    const results = mod.runGuardPack()
    const violations = mod.flattenGuardPackViolations(results)

    expect(mod.getGuardPackExitCode(results)).toBe(0)
    expect(violations).toEqual([])
  })

  it('is wired to bemoat:guard:safety and bemoat:guard:pack scripts', async () => {
    const packageJSON = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'))

    expect(packageJSON.scripts['bemoat:guard:safety']).toBe('node scripts/guard-pack.mjs')
    expect(packageJSON.scripts['bemoat:guard:pack']).toBe('node scripts/guard-pack.mjs')
    expect(packageJSON.scripts['guard:safety']).toBe('node scripts/guard-pack.mjs')
  })

  it('is listed in managedPaths for boilerplate sync', async () => {
    const syncMod = await import('../../scripts/sync-boilerplate.mjs')

    expect(syncMod.managedPaths).toContain('scripts/guard-pack.mjs')
    expect(syncMod.managedPaths).toContain('scripts/guard-build-script-contract.mjs')
    expect(syncMod.managedPaths).toContain('scripts/guard-package-manager.mjs')
    expect(syncMod.managedPaths).toContain('scripts/guard-env-placeholder.mjs')
    expect(syncMod.managedPaths).toContain('scripts/guard-frontend-seo.mjs')
    expect(syncMod.managedPaths).toContain('docs/guard-pack.md')
    expect(syncMod.managedPackageScripts).toContain('bemoat:guard:pack')
  })
})

describe('destructive SQL fixture', () => {
  it('flags unapproved destructive migration fixture', async () => {
    const repoSafety = await import('../../scripts/guard-repo-safety.mjs')
    const content = readFileSync(resolve(fixturesRoot, 'destructive-migration-unapproved.ts'), 'utf8')

    const violations = repoSafety.scanDestructiveMigration(
      'src/migrations/destructive-migration-unapproved.ts',
      content,
    )

    expect(violations).toHaveLength(1)
    expect(violations[0]?.rule).toBe('drop-table')
    expect(violations[0]?.message).toContain('bemoat:destructive-migration-approved')
  })

  it('allows approved destructive migration fixture', async () => {
    const repoSafety = await import('../../scripts/guard-repo-safety.mjs')
    const content = readFileSync(resolve(fixturesRoot, 'destructive-migration-approved.ts'), 'utf8')

    const violations = repoSafety.scanDestructiveMigration(
      'src/migrations/destructive-migration-approved.ts',
      content,
    )

    expect(violations).toEqual([])
  })
})

describe('direct script call fixtures', () => {
  it('flags forbidden raw script fixture', async () => {
    const harness = await import('../../scripts/guard-harness-contract.mjs')
    const content = readFileSync(resolve(fixturesRoot, 'harness-with-forbidden-scripts.yml'), 'utf8')

    const violations = harness.scanChildFacingHarnessFile('.github/workflows/ci.yml', content)

    expect(violations).toHaveLength(1)
    expect(violations[0]?.rule).toBe('lint')
    expect(violations[0]?.message).toContain('bemoat:*')
  })

  it('passes bemoat-only harness fixture', async () => {
    const harness = await import('../../scripts/guard-harness-contract.mjs')
    const content = readFileSync(resolve(fixturesRoot, 'harness-with-bemoat-scripts.yml'), 'utf8')

    const violations = harness.scanChildFacingHarnessFile('.github/workflows/ci.yml', content)

    expect(violations).toEqual([])
  })
})

describe('package manager guard', () => {
  it('flags alternate lockfiles and npm commands in harness content', async () => {
    const mod = await import('../../scripts/guard-package-manager.mjs')

    expect(mod.scanTrackedLockfiles(['package-lock.json', 'pnpm-lock.yaml'])).toHaveLength(1)

    const violations = mod.scanPackageManagerFile(
      '.github/workflows/ci.yml',
      'run: npm install\nrun: pnpm run bemoat:guard:safety',
    )

    expect(violations).toHaveLength(1)
    expect(violations[0]?.rule).toBe('non-pnpm-command')
  })
})

describe('env placeholder guard', () => {
  it('passes empty .env.example values', async () => {
    const mod = await import('../../scripts/guard-env-placeholder.mjs')

    const violations = mod.scanEnvExampleContent('PAYLOAD_SECRET=\nDATABASE_URL=')

    expect(violations).toEqual([])
  })

  it('flags real-looking secrets in .env.example', async () => {
    const mod = await import('../../scripts/guard-env-placeholder.mjs')

    const violations = mod.scanEnvExampleContent(
      'PAYLOAD_SECRET=super-secret-production-value-should-not-be-here',
    )

    expect(violations).toHaveLength(1)
    expect(violations[0]?.rule).toBe('non-placeholder-value')
  })
})

describe('build script contract fixtures', () => {
  it('flags recursive OpenNext build script fixture', async () => {
    const mod = await import('../../scripts/guard-build-script-contract.mjs')
    const pkg = JSON.parse(readFileSync(resolve(fixturesRoot, 'package-recursive-build.json'), 'utf8'))

    const violations = mod.scanBuildScriptContract(pkg.scripts, 'package.json')

    expect(violations.some((item: { rule: string }) => item.rule === 'build-must-not-call-opennext')).toBe(
      true,
    )
    expect(violations.some((item: { rule: string }) => item.rule === 'missing-cf-build')).toBe(true)
    expect(violations.some((item: { rule: string }) => item.rule === 'build-must-call-wrapper')).toBe(true)
  })

  it('passes correct build script fixture', async () => {
    const mod = await import('../../scripts/guard-build-script-contract.mjs')
    const pkg = JSON.parse(readFileSync(resolve(fixturesRoot, 'package-correct-build.json'), 'utf8'))

    const violations = mod.scanBuildScriptContract(pkg.scripts, 'package.json')

    expect(violations).toEqual([])
  })
})

describe('frontend SEO guard', () => {
  it('requires metadata title and description in frontend layout', async () => {
    const mod = await import('../../scripts/guard-frontend-seo.mjs')

    const violations = mod.scanFrontendLayoutMetadata(`
export const metadata = { title: 'Example' }
`)

    expect(violations.some((item: { rule: string }) => item.rule === 'missing-metadata-description')).toBe(
      true,
    )
  })

  it('validates optional sitemap and robots exports when present', async () => {
    const mod = await import('../../scripts/guard-frontend-seo.mjs')

    expect(mod.scanOptionalSeoFile('src/app/sitemap.ts', 'export const dynamic = "force-static"')).toHaveLength(
      1,
    )
    expect(
      mod.scanOptionalSeoFile('src/app/robots.ts', 'export default function robots() { return {} }'),
    ).toEqual([])
  })
})
