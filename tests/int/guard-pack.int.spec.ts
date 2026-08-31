import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

const fixturesRoot = resolve(process.cwd(), 'tests/fixtures/guard')
const planningFixturesRoot = resolve(process.cwd(), 'tests/fixtures/planning')
const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('central guard pack', () => {
  it('keeps the public facade re-exporting the inward composition module', async () => {
    const facade = await import('../../scripts/guard-pack.ts')
    const destination = await import('../../scripts/guards/pack.ts')

    expect(Object.keys(destination).sort()).toEqual([
      'GUARD_PACK',
      'flattenGuardPackViolations',
      'formatGuardPackResults',
      'getGuardPackExitCode',
      'runGuardPack',
    ])
    expect(facade.GUARD_PACK).toBe(destination.GUARD_PACK)
    expect(facade.runGuardPack).toBe(destination.runGuardPack)
    expect(facade.flattenGuardPackViolations).toBe(destination.flattenGuardPackViolations)
    expect(facade.getGuardPackExitCode).toBe(destination.getGuardPackExitCode)
    expect(facade.formatGuardPackResults).toBe(destination.formatGuardPackResults)
  })

  it('keeps the harness-contract pack entry wired to stable facade exports', async () => {
    const destination = await import('../../scripts/guards/pack.ts')
    const harnessFacade = await import('../../scripts/guard-harness-contract.ts')
    const harnessContractGuard = destination.GUARD_PACK.find(
      (guard: { id: string }) => guard.id === 'harness-contract',
    )

    expect([harnessContractGuard?.run, harnessContractGuard?.format]).toEqual([
      harnessFacade.runHarnessContractGuard,
      harnessFacade.formatHarnessContractViolations,
    ])
  })

  it('exports all v1 guards in deterministic order', async () => {
    const mod = await import('../../scripts/guard-pack.ts')

    expect(mod.GUARD_PACK.map((guard: { id: string }) => guard.id)).toEqual([
      'repo-safety',
      'harness-contract',
      'build-script-contract',
      'package-manager',
      'toolchain-contract',
      'env-placeholder',
      'cloudflare-config',
      'frontend-seo',
      'planning-contract',
      'structural-protection',
      'scripts-architecture',
    ])
  })

  it('registers planning-contract with summary metadata', async () => {
    const mod = await import('../../scripts/guard-pack.ts')

    const planningGuard = mod.GUARD_PACK.find((guard: { id: string }) => guard.id === 'planning-contract')

    expect(planningGuard).toEqual({
      id: 'planning-contract',
      summary: 'Planning task-identity and execution-base contract across paired spec/plan files',
      run: expect.any(Function),
      format: expect.any(Function),
    })
  })

  it('passes on the current repository', async () => {
    const mod = await import('../../scripts/guard-pack.ts')

    const results = mod.runGuardPack()
    const violations = mod.flattenGuardPackViolations(results)

    expect(mod.getGuardPackExitCode(results)).toBe(0)
    expect(violations).toEqual([])
  })

  it('is wired to bemoat:guard:safety and bemoat:guard:pack scripts', async () => {
    const packageJSON = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'))

    expect(packageJSON.scripts['bemoat:guard:safety']).toBe('node scripts/guard-pack.ts')
    expect(packageJSON.scripts['bemoat:guard:pack']).toBe('node scripts/guard-pack.ts')
    expect(packageJSON.scripts['guard:safety']).toBe('node scripts/guard-pack.ts')
  })

  it('is listed in managedPaths for boilerplate sync', async () => {
    const syncMod = await import('../../scripts/sync-boilerplate.ts')

    expect(syncMod.managedPaths).toContain('scripts/guard-pack.ts')
    expect(syncMod.managedPaths).toContain('scripts/guards/pack.ts')
    expect(syncMod.managedPaths).toContain('scripts/guards/repo-safety.ts')
    expect(syncMod.managedPaths).toContain('scripts/guards/structural-protection.ts')
    expect(syncMod.managedPaths).toContain('scripts/structural-protection-manifest.json')
    expect(syncMod.managedPaths).toContain('tests/int/structural-protection.int.spec.ts')
    expect(syncMod.managedPaths).toContain('scripts/guards/build-script-contract.ts')
    expect(syncMod.managedPaths).toContain('scripts/guards/package-manager.ts')
    expect(syncMod.managedPaths).toContain('scripts/guards/toolchain-contract.ts')
    expect(syncMod.managedPaths).toContain('tsconfig.harness-strict.json')
    expect(syncMod.managedPackageScripts).toContain('bemoat:typecheck')
    expect(syncMod.managedPaths).toContain('scripts/guards/env-placeholder.ts')
    expect(syncMod.managedPaths).toContain('scripts/guards/frontend-seo.ts')
    expect(syncMod.managedPaths.filter((path: string) => path.endsWith('.mjs'))).toEqual([
      'scripts/deploy-smoke-test.mjs',
      'scripts/build.mjs',
    ])
    expect(syncMod.managedPaths).toContain('docs/guard-pack.md')
    expect(syncMod.managedPackageScripts).toContain('bemoat:guard:pack')
  })
})

describe('destructive SQL fixture', () => {
  it('flags unapproved destructive migration fixture', async () => {
    const repoSafety = await import('../../scripts/guards/repo-safety.ts')
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
    const repoSafety = await import('../../scripts/guards/repo-safety.ts')
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
    const harness = await import('../../scripts/guard-harness-contract.ts')
    const content = readFileSync(resolve(fixturesRoot, 'harness-with-forbidden-scripts.yml'), 'utf8')

    const violations = harness.scanChildFacingHarnessFile('.github/workflows/ci.yml', content)

    expect(violations).toHaveLength(1)
    expect(violations[0]?.rule).toBe('lint')
    expect(violations[0]?.message).toContain('bemoat:*')
  })

  it('passes bemoat-only harness fixture', async () => {
    const harness = await import('../../scripts/guard-harness-contract.ts')
    const content = readFileSync(resolve(fixturesRoot, 'harness-with-bemoat-scripts.yml'), 'utf8')

    const violations = harness.scanChildFacingHarnessFile('.github/workflows/ci.yml', content)

    expect(violations).toEqual([])
  })
})

describe('package manager guard', () => {
  it('flags alternate lockfiles and npm commands in harness content', async () => {
    const mod = await import('../../scripts/guards/package-manager.ts')

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
    const mod = await import('../../scripts/guards/env-placeholder.ts')

    const violations = mod.scanEnvExampleContent('PAYLOAD_SECRET=\nDATABASE_URL=')

    expect(violations).toEqual([])
  })

  it('flags real-looking secrets in .env.example', async () => {
    const mod = await import('../../scripts/guards/env-placeholder.ts')

    const violations = mod.scanEnvExampleContent(
      'PAYLOAD_SECRET=super-secret-production-value-should-not-be-here',
    )

    expect(violations).toHaveLength(1)
    expect(violations[0]?.rule).toBe('non-placeholder-value')
  })
})

describe('build script contract fixtures', () => {
  it('flags recursive OpenNext build script fixture', async () => {
    const mod = await import('../../scripts/guards/build-script-contract.ts')
    const pkg = JSON.parse(readFileSync(resolve(fixturesRoot, 'package-recursive-build.json'), 'utf8'))

    const violations = mod.scanBuildScriptContract(pkg.scripts, 'package.json')

    expect(violations.some((item: { rule: string }) => item.rule === 'build-must-not-call-opennext')).toBe(
      true,
    )
    expect(violations.some((item: { rule: string }) => item.rule === 'missing-cf-build')).toBe(true)
    expect(violations.some((item: { rule: string }) => item.rule === 'build-must-call-wrapper')).toBe(true)
  })

  it('passes correct build script fixture', async () => {
    const mod = await import('../../scripts/guards/build-script-contract.ts')
    const pkg = JSON.parse(readFileSync(resolve(fixturesRoot, 'package-correct-build.json'), 'utf8'))

    const violations = mod.scanBuildScriptContract(pkg.scripts, 'package.json')

    expect(violations).toEqual([])
  })
})

describe('planning contract guard pack integration', () => {
  it('surfaces planning-contract violations through runGuardPack', async () => {
    const mod = await import('../../scripts/guard-pack.ts')
    const tempRoot = mkdtempSync(join(tmpdir(), 'guard-pack-planning-'))
    tempRoots.push(tempRoot)

    const planPath = 'docs/superpowers/plans/bad/plan.md'
    const absolutePlanPath = join(tempRoot, planPath)
    mkdirSync(dirname(absolutePlanPath), { recursive: true })
    writeFileSync(absolutePlanPath, readFileSync(join(planningFixturesRoot, 'closed-issue-169-reuse.md'), 'utf8'))

    mkdirSync(join(tempRoot, 'scripts'), { recursive: true })
    writeFileSync(
      join(tempRoot, 'scripts/architecture-contract.json'),
      readFileSync(resolve(process.cwd(), 'scripts/architecture-contract.json'), 'utf8')
    )

    const results = mod.runGuardPack({
      root: tempRoot,
      files: [planPath],
    })
    const planningResult = results.find((result: { id: string }) => result.id === 'planning-contract')
    const planningViolations = planningResult?.violations ?? []

    expect(planningResult).toBeDefined()
    expect(planningViolations.length).toBeGreaterThan(0)
    const hasRule = (item: unknown, rule: string): boolean =>
      item !== null && typeof item === 'object' && 'rule' in item && typeof item.rule === 'string' &&
      (rule.endsWith('*') ? item.rule.startsWith(rule.slice(0, -1)) : item.rule === rule)
    expect(planningViolations.some((item) => hasRule(item, 'PLAN*'))).toBe(true)
    expect(planningViolations.some((item) => hasRule(item, 'PLAN004'))).toBe(true)
    expect(mod.getGuardPackExitCode(results)).toBe(1)

    const output = mod.formatGuardPackResults(results).join('\n')
    expect(output).toContain('Found:')
    expect(output).toContain('Reason:')
    expect(output).toContain('Corrective action:')
  })
})

describe('frontend SEO guard', () => {
  it('requires metadata title and description in frontend layout', async () => {
    const mod = await import('../../scripts/guards/frontend-seo.ts')

    const violations = mod.scanFrontendLayoutMetadata(`
export const metadata = { title: 'Example' }
`)

    expect(violations.some((item: { rule: string }) => item.rule === 'missing-metadata-description')).toBe(
      true,
    )
  })

  it('validates optional sitemap and robots exports when present', async () => {
    const mod = await import('../../scripts/guards/frontend-seo.ts')

    expect(mod.scanOptionalSeoFile('src/app/sitemap.ts', 'export const dynamic = "force-static"')).toHaveLength(
      1,
    )
    expect(
      mod.scanOptionalSeoFile('src/app/robots.ts', 'export default function robots() { return {} }'),
    ).toEqual([])
  })
})

describe('package manager guard destination boundary', () => {
  it('preserves the destination export surface and direct-execution boundary', async () => {
    const destination = await import('../../scripts/guards/package-manager.ts')

    expect(Object.keys(destination).sort()).toEqual([
      'FORBIDDEN_LOCKFILES',
      'PACKAGE_MANAGER_SCAN_PATHS',
      'findNonPnpmCommands',
      'formatPackageManagerViolations',
      'getPackageManagerGuardExitCode',
      'isDirectExecution',
      'runPackageManagerGuard',
      'scanPackageJsonEngines',
      'scanPackageManagerFile',
      'scanTrackedLockfiles',
    ])
    expect(destination.isDirectExecution).toBeTypeOf('function')
  })

  it('keeps package-manager policy diagnostics and exit mapping stable', async () => {
    const destination = await import('../../scripts/guards/package-manager.ts')
    const violations = destination.runPackageManagerGuard({
      files: ['package.json', 'package-lock.json'] as unknown as null,
      readFile: () => JSON.stringify({}),
    })

    expect(violations.map((item: { rule: string }) => item.rule)).toEqual([
      'forbidden-lockfile',
      'missing-pnpm-engine',
    ])
    expect(destination.getPackageManagerGuardExitCode([])).toBe(0)
    expect(destination.getPackageManagerGuardExitCode(violations)).toBe(1)
    expect(destination.formatPackageManagerViolations([])).toEqual(['Package manager guard passed.'])
    expect(destination.formatPackageManagerViolations(violations)[0]).toBe('Package manager guard failed:')
    expect(destination.scanPackageManagerFile('.github/workflows/ci.yml', 'npm run check')).toEqual([
      expect.objectContaining({ rule: 'non-pnpm-command', file: '.github/workflows/ci.yml' }),
    ])
  })
})
