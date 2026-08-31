import { spawnSync } from 'node:child_process'
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  compareFileSystemSnapshots,
  snapshotDirectory,
} from '../helpers/cli-boundary-harness'

const fixtureRoot = resolve(
  process.cwd(),
  'tests/fixtures/boilerplate-sync/legacy-intercepted-child',
)
const temporaryRoots: string[] = []

function createLegacyChildFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'bemoat-legacy-sync-child-'))
  temporaryRoots.push(root)
  cpSync(fixtureRoot, root, { recursive: true })
  return root
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('legacy child sync bootstrap', () => {
  it('characterizes retired Mission Control interception before local help without mutation', () => {
    const childRoot = createLegacyChildFixture()
    const before = snapshotDirectory(childRoot)
    const packageJson = JSON.parse(
      readFileSync(join(childRoot, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> }

    expect(packageJson.scripts['bemoat:boilerplate:sync']).toBe(
      'node scripts/sync-boilerplate.mjs',
    )

    const result = spawnSync(
      process.execPath,
      ['scripts/sync-boilerplate.mjs', '--help', '--json'],
      { cwd: childRoot, encoding: 'utf8' },
    )
    const after = snapshotDirectory(childRoot)

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain(
      'legacy Mission Control gate requires historical Issue and HANDOFF state',
    )
    expect(compareFileSystemSnapshots(before, after)).toBe(true)
  })
})
