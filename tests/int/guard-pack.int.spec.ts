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
  it('exports all v1 guards in deterministic order', async () => {
    const mod = await import('../../scripts/guard-pack.mjs')

    expect(mod.GUARD_PACK.map((guard: { id: string }) => guard.id)).toEqual([
      'repo-safety',
      'harness-contract',
      'build-script-contract',
      'package-manager',
      'toolchain-contract',
      'env-placeholder',
      'cloudflare-config',
      'frontend-seo',
      'mission-control-contract',
      'planning-contract',
      'mission-control-drift',
      'structural-protection',
      'scripts-architecture',
    ])
  })

  it('registers planning-contract with summary metadata', async () => {
    const mod = await import('../../scripts/guard-pack.mjs')

    const planningGuard = mod.GUARD_PACK.find((guard: { id: string }) => guard.id === 'planning-contract')

    expect(planningGuard).toEqual({
      id: 'planning-contract',
      summary: 'Planning task-identity and execution-base contract across paired spec/plan files',
      run: expect.any(Function),
      format: expect.any(Function),
    })
  })

  it('passes on the current repository', async () => {
    const mod = await import('../../scripts/guard-pack.mjs')

    const results = mod.runGuardPack()
    const violations = mod.flattenGuardPackViolations(results)

    expect(mod.getGuardPackExitCode(results)).toBe(0)
    expect(violations).toEqual([])
  })

  it('enforces the complete Mission Control state/counter and Review 3 matrices', async () => {
    const mod = await import('../../scripts/guard-mission-control-drift.mjs')

    expect(mod.MISSION_CONTROL_STATE_COUNTER_MATRIX).toHaveLength(13 * 4 * 2)
    expect(mod.MISSION_CONTROL_REVIEW_MATRIX.filter((entry: { cycle: number }) => entry.cycle === 2))
      .toEqual([
        expect.objectContaining({ verdict: 'CORRECTION REQUIRED', expected: 'STATE_CONFLICT' }),
        expect.objectContaining({ verdict: 'ELIGIBLE FOR FOUNDER REVIEW', expected: 'ELIGIBLE_FOR_FOUNDER_REVIEW' }),
        expect.objectContaining({ verdict: 'BLOCKED FOR FOUNDER DECISION', expected: 'BLOCKED_FOR_FOUNDER_DECISION' }),
        expect.objectContaining({ verdict: 'BLOCKED EXTERNAL', expected: 'BLOCKED_EXTERNAL' }),
        expect.objectContaining({ verdict: 'STATE CONFLICT', expected: 'STATE_CONFLICT' }),
      ])
  })

  it('detects semantic reconciler tampering assembled dynamically', async () => {
    const mod = await import('../../scripts/guard-mission-control-drift.mjs')
    const canonical = await import('../../scripts/mission-control-reconcile.mjs')

    const tamperedReconcile = (input: Record<string, unknown>) => {
      const proposal = canonical.proposeReviewReconciliation(input)
      return {
        ...proposal,
        state: ['CORRECTION', '_REQUIRED_3'].join(''),
        full_review_count: 2,
      }
    }
    const violations = mod.runMissionControlDriftGuard({
      proposeReviewReconciliation: tamperedReconcile,
    })

    expect(violations.some((item: { rule: string }) => item.rule === 'MC-DRIFT-001')).toBe(true)
    expect(violations.some((item: { rule: string }) => item.rule === 'MC-DRIFT-003')).toBe(true)
    expect(violations.some((item: { rule: string }) => item.rule === 'MC-DRIFT-004')).toBe(true)
  })

  it('detects a parser tampered to accept invalid state/counter combinations', async () => {
    const mod = await import('../../scripts/guard-mission-control-drift.mjs')
    const violations = mod.runMissionControlDriftGuard({
      parseMissionControlState: () => ({ present: true, valid: true, state: null }),
    })

    expect(violations.some((item: { rule: string }) => item.rule === 'MC-DRIFT-005')).toBe(true)
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
    expect(syncMod.managedPaths).toContain('scripts/guards/structural-protection.mjs')
    expect(syncMod.managedPaths).toContain('scripts/structural-protection-manifest.json')
    expect(syncMod.managedPaths).toContain('tests/int/structural-protection.int.spec.ts')
    expect(syncMod.managedPaths).toContain('scripts/guard-build-script-contract.mjs')
    expect(syncMod.managedPaths).toContain('scripts/guard-package-manager.mjs')
    expect(syncMod.managedPaths).toContain('scripts/guard-toolchain-contract.mjs')
    expect(syncMod.managedPaths).toContain('tsconfig.harness-strict.json')
    expect(syncMod.managedPackageScripts).toContain('bemoat:typecheck')
    expect(syncMod.managedPaths).toContain('scripts/guard-env-placeholder.mjs')
    expect(syncMod.managedPaths).toContain('scripts/guard-frontend-seo.mjs')
    expect(syncMod.managedPaths).toContain('scripts/guard-mission-control-contract.mjs')
    expect(syncMod.managedPaths).toContain('docs/guard-pack.md')
    expect(syncMod.managedPackageScripts).toContain('bemoat:guard:pack')
    expect(syncMod.managedPackageScripts).toContain('bemoat:guard:mission-control-contract')
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

describe('planning contract guard pack integration', () => {
  it('surfaces planning-contract violations through runGuardPack', async () => {
    const mod = await import('../../scripts/guard-pack.mjs')
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
    expect(planningViolations.some((item: { rule: string }) => item.rule.startsWith('PLAN'))).toBe(true)
    expect(planningViolations.some((item: { rule: string }) => item.rule === 'PLAN004')).toBe(true)
    expect(mod.getGuardPackExitCode(results)).toBe(1)

    const output = mod.formatGuardPackResults(results).join('\n')
    expect(output).toContain('Found:')
    expect(output).toContain('Reason:')
    expect(output).toContain('Corrective action:')
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
