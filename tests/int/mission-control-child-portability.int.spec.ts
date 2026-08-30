import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const repoRoot = process.cwd()
const childShapeRoot = resolve(repoRoot, 'tests/fixtures/mission-control-child-shape')
const processEnvFixtureRoot = join(childShapeRoot, 'process-env')

const STARTER_ONLY_DOGFOOD_PATH = 'docs/mission-control/dogfood'
const STARTER_ONLY_CAPTURE_BASELINE_PATH = 'scripts/tooling/capture-baseline.mjs'

function readSource(path: string): string {
  return readFileSync(path, 'utf8')
}

function referencesStarterOnlyDogfood(source: string): boolean {
  return source.includes(STARTER_ONLY_DOGFOOD_PATH)
}

function referencesCaptureBaselineScript(source: string): boolean {
  return source.includes(STARTER_ONLY_CAPTURE_BASELINE_PATH)
}

function hasExistsSyncGuardForPath(source: string, pathFragment: string): boolean {
  const escaped = pathFragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`existsSync\\([^)]*${escaped}`).test(source)
}

function hasStarterOnlyGatingMechanism(source: string): boolean {
  if (!/existsSync/.test(source)) {
    return false
  }

  if (/describe\.skipIf|it\.skipIf/.test(source)) {
    return true
  }

  if (/if\s*\(\s*!existsSync/.test(source)) {
    return true
  }

  return false
}

/**
 * Structural contract: when characterization references starter-only corpus paths,
 * it must guard both dependencies with existsSync and gate the starter-only block.
 * Keyword comments alone cannot satisfy this contract.
 */
function satisfiesChildPortableStarterCorpusContract(source: string): boolean {
  const usesDogfood = referencesStarterOnlyDogfood(source)
  const usesCaptureBaseline = referencesCaptureBaselineScript(source)

  if (!usesDogfood && !usesCaptureBaseline) {
    return true
  }

  const dogfoodGuarded = !usesDogfood || hasExistsSyncGuardForPath(source, STARTER_ONLY_DOGFOOD_PATH)
  const captureGuarded = !usesCaptureBaseline || hasExistsSyncGuardForPath(source, STARTER_ONLY_CAPTURE_BASELINE_PATH)

  return dogfoodGuarded && captureGuarded && hasStarterOnlyGatingMechanism(source)
}

function mirrorsUpstreamChildSyncPackageGate(packageJson: { scripts?: Record<string, string> }) {
  const scripts = packageJson.scripts ?? {}
  expect(scripts['bemoat:boilerplate:sync']).toBe('node scripts/sync-boilerplate.mjs')
  if (scripts['boilerplate:sync'] !== undefined) {
    expect(scripts['boilerplate:sync']).toBe('node scripts/sync-boilerplate.mjs')
  }
}

function runChildAugmentedProcessEnvTypecheck(): { status: number | null, output: string } {
  const result = spawnSync(
    'pnpm',
    ['exec', 'tsc', '--noEmit', '-p', processEnvFixtureRoot],
    { cwd: repoRoot, encoding: 'utf8' },
  )

  return {
    status: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  }
}

describe('Mission Control child portability regressions (Issue #216)', () => {
  describe('defect 1: starter-only corpus dependency', () => {
    it('child shape lacks dogfood corpus and capture-baseline.mjs while managed tests are present', () => {
      expect(existsSync(join(childShapeRoot, 'docs/mission-control/dogfood'))).toBe(false)
      expect(existsSync(join(childShapeRoot, STARTER_ONLY_CAPTURE_BASELINE_PATH))).toBe(false)
    })

    it('negative control: keyword comments alone do not satisfy starter-only gating contract', () => {
      const decoySource = `
        // starter-only corpus must be child-portable with childShape skipStarterCorpus
        // isStarterRepository whenStarterCorpusPresent skip starter-only dogfood
        const dogfoodRoot = resolve(process.cwd(), '${STARTER_ONLY_DOGFOOD_PATH}')
        readFileSync(join(dogfoodRoot, 'issue-150-baseline.json'), 'utf8')
        execFileSync(process.execPath, ['${STARTER_ONLY_CAPTURE_BASELINE_PATH}', '--classify-loader', fixturePath])
      `

      expect(referencesStarterOnlyDogfood(decoySource)).toBe(true)
      expect(referencesCaptureBaselineScript(decoySource)).toBe(true)
      expect(satisfiesChildPortableStarterCorpusContract(decoySource)).toBe(false)
    })
  })

  describe('defect 2: child-owned package alias', () => {
    it('child package exposes only bemoat:boilerplate:sync', () => {
      const childPackage = JSON.parse(readFileSync(join(childShapeRoot, 'package.json'), 'utf8')) as {
        scripts: Record<string, string>
      }

      expect(childPackage.scripts['bemoat:boilerplate:sync']).toBe('node scripts/sync-boilerplate.mjs')
      expect(childPackage.scripts['boilerplate:sync']).toBeUndefined()
    })

    it('portable child-sync gate accepts child-owned package scripts', () => {
      const childPackage = JSON.parse(readFileSync(join(childShapeRoot, 'package.json'), 'utf8')) as {
        scripts: Record<string, string>
      }

      expect(() => mirrorsUpstreamChildSyncPackageGate(childPackage)).not.toThrow()
    })
  })

  describe('defect 3: augmented ProcessEnv compile boundary', () => {
    it('managed partial env fixtures compile with child augmented ProcessEnv', () => {
      const { status, output } = runChildAugmentedProcessEnvTypecheck()

      expect(output).not.toMatch(/error TS2352/)
      expect(status).toBe(0)
    })
  })
})
