import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const repoRoot = process.cwd()
const childShapeRoot = resolve(repoRoot, 'tests/fixtures/child-shape')
const processEnvFixtureRoot = join(childShapeRoot, 'process-env')

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
    output: String(result.stdout ?? '') + String(result.stderr ?? ''),
  }
}

describe('child portability safety', () => {
  it('child package exposes only the namespaced sync command', () => {
    const childPackage = JSON.parse(readFileSync(join(childShapeRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }

    expect(childPackage.scripts['bemoat:boilerplate:sync']).toBe('node scripts/sync-boilerplate.mjs')
    expect(childPackage.scripts['boilerplate:sync']).toBeUndefined()
    expect(() => mirrorsUpstreamChildSyncPackageGate(childPackage)).not.toThrow()
  })

  it('augmented ProcessEnv fixtures compile with strict child settings', () => {
    const { status, output } = runChildAugmentedProcessEnvTypecheck()

    expect(output).not.toMatch(/error TS2352/)
    expect(status).toBe(0)
  })
})
