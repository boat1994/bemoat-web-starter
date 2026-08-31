import { spawnSync } from 'node:child_process'
import {
  cpSync,
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
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
  const fixtureSource = join(root, 'scripts/sync-boilerplate.source.txt')
  copyFileSync(fixtureSource, join(root, 'scripts/sync-boilerplate.mjs'))
  rmSync(fixtureSource)
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

  it('discovers the current registered sync contract before legacy-child mutation', () => {
    const childRoot = createLegacyChildFixture()
    const before = snapshotDirectory(childRoot)
    const entrypoint = resolve(process.cwd(), 'scripts/sync-boilerplate.ts')

    const result = spawnSync(
      process.execPath,
      [entrypoint, '--help', '--json'],
      { cwd: childRoot, encoding: 'utf8' },
    )
    const after = snapshotDirectory(childRoot)

    expect(result.status, result.stderr).toBe(0)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toMatchObject({
      command: 'bemoat:boilerplate:sync',
      mode: 'help',
      classification: 'HELP',
      tier: 'A',
    })
    expect(compareFileSystemSnapshots(before, after)).toBe(true)
  })

  it('fails closed on an unrecognized sync mapping before package mutation', async () => {
    const childRoot = createLegacyChildFixture()
    const sourceRoot = mkdtempSync(join(tmpdir(), 'bemoat-current-sync-source-'))
    temporaryRoots.push(sourceRoot)
    const childPackagePath = join(childRoot, 'package.json')
    const childPackage = JSON.parse(readFileSync(childPackagePath, 'utf8')) as {
      scripts: Record<string, string>
    }
    childPackage.scripts['bemoat:boilerplate:sync'] = 'echo custom-sync'
    writeFileSync(childPackagePath, `${JSON.stringify(childPackage, null, 2)}\n`)
    writeFileSync(
      join(sourceRoot, 'package.json'),
      `${JSON.stringify({
        scripts: {
          'bemoat:boilerplate:sync': 'node scripts/sync-boilerplate.ts',
        },
      })}\n`,
    )
    const before = snapshotDirectory(childRoot)
    const sync = await import('../../scripts/sync-boilerplate.ts')

    expect(() => sync.syncPackageManifest({
      sourceRootPath: sourceRoot,
      targetRootPath: childRoot,
      bootstrapLegacyChild: true,
    })).toThrow(
      'UNSUPPORTED_PRE_STATE: legacy-child bootstrap requires bemoat:boilerplate:sync',
    )
    expect(compareFileSystemSnapshots(before, snapshotDirectory(childRoot))).toBe(true)
  })

  it.each([
    ['--bootstrap-legacy-child', '--full'],
    ['--bootstrap-legacy-child', '--harness-only', '--apply-build-contract'],
  ])('rejects unsupported bootstrap combinations before I/O: %j', (...argv: string[]) => {
    const childRoot = createLegacyChildFixture()
    const before = snapshotDirectory(childRoot)
    const entrypoint = resolve(process.cwd(), 'scripts/sync-boilerplate.ts')
    const result = spawnSync(process.execPath, [entrypoint, ...argv, '--json'], {
      cwd: childRoot,
      encoding: 'utf8',
    })
    const envelope = JSON.parse(result.stdout)

    expect(result.status).toBe(2)
    expect(envelope).toMatchObject({
      command: 'bemoat:boilerplate:sync',
      classification: 'INVALID_INVOCATION',
      mutation_performed: false,
    })
    expect(compareFileSystemSnapshots(before, snapshotDirectory(childRoot))).toBe(true)
  })
})
