import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const repoRoot = process.cwd()
const acceptanceFixtureRoot = resolve(repoRoot, 'tests/fixtures/acceptance/child-project')
const guardFixturesRoot = resolve(repoRoot, 'tests/fixtures/guard')
const tempChildRoot = resolve(repoRoot, '.tmp-starter-acceptance-child')

/** Child-facing bemoat:* scripts sync must be able to add when missing. */
const REQUIRED_CHILD_BEMOAT_SCRIPTS = [
  'bemoat:guard:safety',
  'bemoat:test:int',
  'bemoat:boilerplate:sync',
  'bemoat:boilerplate:check',
] as const

const OPTIONAL_CHILD_BEMOAT_SCRIPTS = ['bemoat:guard:pack'] as const

const ESSENTIAL_MANAGED_HARNESS_PATHS = [
  '.github/workflows/ci.yml',
  '.githooks',
  'scripts/guard-pack.mjs',
  'scripts/guard-harness-contract.mjs',
  'scripts/sync-boilerplate.mjs',
  'scripts/check-boilerplate-drift.mjs',
  'vitest.config.mts',
  'docs/harness-sync-contract.md',
  'docs/guard-pack.md',
] as const

const CHILD_OWNED_PATHS = ['package.json', 'wrangler.jsonc', 'README.md', 'pnpm-lock.yaml'] as const

function copyDirectory(source: string, target: string) {
  mkdirSync(target, { recursive: true })
  cpSync(source, target, { recursive: true })
}

describe('starter acceptance suite v1', () => {
  describe('child-facing bemoat:* scripts', () => {
    it('exposes required managed scripts in package.json', () => {
      const packageJSON = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'))

      for (const scriptName of REQUIRED_CHILD_BEMOAT_SCRIPTS) {
        expect(packageJSON.scripts[scriptName], `missing ${scriptName}`).toBeTruthy()
      }

      for (const scriptName of OPTIONAL_CHILD_BEMOAT_SCRIPTS) {
        expect(packageJSON.scripts[scriptName], `missing optional ${scriptName}`).toBeTruthy()
      }

      expect(packageJSON.scripts['bemoat:guard:safety']).toBe('node scripts/guard-pack.mjs')
      expect(packageJSON.scripts['bemoat:test:int']).toContain('vitest run')
    })

    it('lists required scripts in managedPackageScripts for boilerplate sync', async () => {
      const syncMod = await import('../../scripts/sync-boilerplate.mjs')

      for (const scriptName of REQUIRED_CHILD_BEMOAT_SCRIPTS) {
        expect(syncMod.managedPackageScripts).toContain(scriptName)
      }

      for (const scriptName of OPTIONAL_CHILD_BEMOAT_SCRIPTS) {
        expect(syncMod.managedPackageScripts).toContain(scriptName)
      }
    })
  })

  describe('child-facing automation uses only bemoat:* commands', () => {
    it('passes harness contract guard on synced CI and pre-push', async () => {
      const harness = await import('../../scripts/guard-harness-contract.mjs')

      const violations = harness.runHarnessContractGuard({
        root: repoRoot,
        readFile: (filePath) => readFileSync(filePath, 'utf8'),
      })

      expect(violations).toEqual([])
    })

    it('documents child-facing harness paths for CI and pre-push', async () => {
      const harness = await import('../../scripts/guard-harness-contract.mjs')

      expect(harness.CHILD_FACING_HARNESS_PATHS).toEqual([
        '.github/workflows/ci.yml',
        '.githooks/pre-push',
      ])
    })
  })

  describe('guard pack execution path', () => {
    it('passes on the current repository with understandable success output', async () => {
      const guardPack = await import('../../scripts/guard-pack.mjs')

      const results = guardPack.runGuardPack()
      const output = guardPack.formatGuardPackResults(results).join('\n')

      expect(guardPack.getGuardPackExitCode(results)).toBe(0)
      expect(output).toContain('Central guard pack passed')
      expect(output).toContain('✓ repo-safety')
      expect(output).toContain('✓ harness-contract')
    })
  })

  describe('harness contract failure output', () => {
    it('reports file path, forbidden script, and bemoat:* guidance', async () => {
      const harness = await import('../../scripts/guard-harness-contract.mjs')
      const content = readFileSync(
        resolve(guardFixturesRoot, 'harness-with-forbidden-scripts.yml'),
        'utf8',
      )

      const violations = harness.scanChildFacingHarnessFile('.github/workflows/ci.yml', content)
      const output = harness.formatHarnessContractViolations(violations).join('\n')

      expect(violations).toHaveLength(1)
      expect(violations[0]?.rule).toBe('lint')
      expect(output).toContain('Harness contract guard failed')
      expect(output).toContain('.github/workflows/ci.yml')
      expect(output).toContain('lint')
      expect(output).toContain('bemoat:*')
      expect(output).toContain('docs/harness-sync-contract.md')
    })

    it('surfaces harness-contract failures through guard pack formatting', async () => {
      const guardPack = await import('../../scripts/guard-pack.mjs')
      const harness = await import('../../scripts/guard-harness-contract.mjs')
      const content = readFileSync(
        resolve(guardFixturesRoot, 'harness-with-forbidden-scripts.yml'),
        'utf8',
      )

      const harnessViolations = harness.scanChildFacingHarnessFile('.github/workflows/ci.yml', content)
      const results = guardPack.runGuardPack()
      const harnessResult = results.find((result) => result.id === 'harness-contract')

      expect(harnessResult).toBeDefined()

      const simulatedResults = results.map((result) =>
        result.id === 'harness-contract'
          ? { ...result, violations: harnessViolations }
          : result,
      )

      const output = guardPack.formatGuardPackResults(simulatedResults).join('\n')

      expect(output).toContain('Central guard pack failed')
      expect(output).toContain('bemoat:guard:pack')
      expect(output).toContain('docs/guard-pack.md')
      expect(output).toContain('.github/workflows/ci.yml')
      expect(output).toContain('lint')
    })
  })

  describe('simulated child project minimal harness path', () => {
    it('adds missing bemoat:* scripts and passes harness contract on fixture CI/hooks', async () => {
      const syncMod = await import('../../scripts/sync-boilerplate.mjs')
      const harness = await import('../../scripts/guard-harness-contract.mjs')

      rmSync(tempChildRoot, { recursive: true, force: true })
      copyDirectory(acceptanceFixtureRoot, tempChildRoot)

      const starterPackage = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'))
      const childPackage = JSON.parse(readFileSync(join(tempChildRoot, 'package.json'), 'utf8'))

      const { addedScripts, packageJSON } = syncMod.applyManagedPackageScripts(
        starterPackage,
        childPackage,
      )

      writeFileSync(join(tempChildRoot, 'package.json'), `${JSON.stringify(packageJSON, null, 2)}\n`)

      expect(addedScripts).toEqual(expect.arrayContaining([...REQUIRED_CHILD_BEMOAT_SCRIPTS]))
      expect(packageJSON.scripts.deploy).toBe('pnpm run custom-deploy')
      expect(packageJSON.scripts.lint).toBeUndefined()
      expect(packageJSON.scripts.check).toBeUndefined()

      const violations = harness.runHarnessContractGuard({
        root: tempChildRoot,
        readFile: (filePath) => readFileSync(filePath, 'utf8'),
      })

      expect(violations).toEqual([])

      rmSync(tempChildRoot, { recursive: true, force: true })
    })

    it('copies managed harness files in harness-only sync without seeding product code', async () => {
      const syncMod = await import('../../scripts/sync-boilerplate.mjs')

      rmSync(tempChildRoot, { recursive: true, force: true })
      mkdirSync(join(tempChildRoot, 'src/collections'), { recursive: true })

      const result = syncMod.syncPathsFromSource({
        sourceRootPath: repoRoot,
        targetRootPath: tempChildRoot,
        mode: syncMod.SYNC_MODES.HARNESS_ONLY,
        onWarn: () => {},
        onLog: () => {},
      })

      expect(result.seedOnlyPathsSkipped).toBe(true)
      expect(result.seededFiles).toEqual([])
      expect(result.syncedManaged).toContain('scripts/guard-pack.mjs')
      expect(result.syncedManaged).toContain('.github/workflows/ci.yml')

      rmSync(tempChildRoot, { recursive: true, force: true })
    })
  })

  describe('sync boundary contracts', () => {
    it('includes essential harness paths in managedPaths but not seed-only or child-owned paths', async () => {
      const syncMod = await import('../../scripts/sync-boilerplate.mjs')

      for (const path of ESSENTIAL_MANAGED_HARNESS_PATHS) {
        expect(syncMod.managedPaths, `managedPaths missing ${path}`).toContain(path)
      }

      for (const path of CHILD_OWNED_PATHS) {
        expect(syncMod.managedPaths, `${path} must stay child-owned`).not.toContain(path)
      }

      for (const path of syncMod.seedOnlyPaths) {
        expect(syncMod.managedPaths, `seed path ${path} must not be managed`).not.toContain(path)
      }

      expect(syncMod.seedOnlyPaths).toContain('src/payload.config.ts')
      expect(syncMod.seedOnlyPaths).toContain('src/app/(frontend)')
    })

    it('syncs acceptance suite files as shared harness coverage', async () => {
      const syncMod = await import('../../scripts/sync-boilerplate.mjs')

      expect(syncMod.managedPaths).toContain('tests/int/starter-acceptance.int.spec.ts')
      expect(syncMod.managedPaths).toContain('tests/fixtures/acceptance')
      expect(syncMod.managedPaths).toContain('docs/starter-acceptance-tests.md')
    })
  })
})
