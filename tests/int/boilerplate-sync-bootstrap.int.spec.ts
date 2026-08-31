import { spawnSync } from 'node:child_process'
import {
  cpSync,
  copyFileSync,
  mkdirSync,
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
import { getCommandContract } from '../../scripts/cli/command-contract.ts'

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

  it('declares and applies an explicit legacy-child bootstrap without touching product files', async () => {
    const contract = getCommandContract('bemoat:boilerplate:sync')
    expect(contract?.optional_flags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'bootstrap_legacy_child',
          syntax: '--bootstrap-legacy-child',
          value_type: 'boolean',
        }),
      ]),
    )

    const childRoot = createLegacyChildFixture()
    const sourceRoot = mkdtempSync(join(tmpdir(), 'bemoat-current-sync-source-'))
    temporaryRoots.push(sourceRoot)
    mkdirSync(join(sourceRoot, 'scripts'), { recursive: true })
    writeFileSync(
      join(sourceRoot, 'package.json'),
      `${JSON.stringify({
        scripts: {
          'bemoat:boilerplate:sync': 'node scripts/sync-boilerplate.ts',
          'bemoat:boilerplate:check': 'node scripts/check-boilerplate-drift.ts',
          'bemoat:typecheck': 'node scripts/bemoat-typecheck.ts',
          'bemoat:guard:cloudflare-env': 'node scripts/guard-cloudflare-env.ts',
          'bemoat:guard:harness-contract': 'node scripts/guard-harness-contract.ts',
          'bemoat:guard:pack': 'node scripts/guard-pack.ts',
          'bemoat:guard:safety': 'node scripts/guard-pack.ts',
          'bemoat:hooks:install': 'node scripts/install-git-hooks.ts',
        },
      })}\n`,
    )
    writeFileSync(
      join(sourceRoot, 'scripts/sync-boilerplate.ts'),
      '// current source-owned sync CLI fixture\n',
    )
    const productBefore = readFileSync(
      join(childRoot, 'src/product-owned.txt'),
      'utf8',
    )

    const sync = await import('../../scripts/sync-boilerplate.ts')
    const pathResult = sync.syncPathsFromSource({
      sourceRootPath: sourceRoot,
      targetRootPath: childRoot,
      mode: 'harness-only',
      syncConfig: {
        managedPaths: ['scripts/sync-boilerplate.ts'],
        seedOnlyPaths: ['src'],
        mergeKeepPaths: [],
        managedPackageScripts: ['bemoat:boilerplate:sync'],
        suggestedPackageScripts: [],
        buildContractPackageScripts: [],
        buildContractFilePaths: [],
        suggestedPackageSections: [],
      },
    })
    const packageResult = sync.syncPackageManifest({
      sourceRootPath: sourceRoot,
      targetRootPath: childRoot,
      bootstrapLegacyChild: true,
    })
    const childPackage = JSON.parse(
      readFileSync(join(childRoot, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> }

    expect(pathResult.seedOnlyPathsSkipped).toBe(true)
    expect(pathResult.seededFiles).toEqual([])
    expect(packageResult.updatedManagedScripts).toEqual([
      'bemoat:boilerplate:sync',
      'bemoat:boilerplate:check',
      'bemoat:typecheck',
      'bemoat:guard:cloudflare-env',
      'bemoat:guard:harness-contract',
      'bemoat:guard:pack',
      'bemoat:guard:safety',
      'bemoat:hooks:install',
    ])
    expect(childPackage.scripts['bemoat:boilerplate:sync']).toBe(
      'node scripts/sync-boilerplate.ts',
    )
    expect(childPackage.scripts.build).toBe('child-owned-build')
    expect(readFileSync(join(childRoot, 'src/product-owned.txt'), 'utf8')).toBe(
      productBefore,
    )
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

  it('keeps a current child on the normal add-only package path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bemoat-current-sync-child-'))
    temporaryRoots.push(root)
    const sourceRoot = join(root, 'source')
    const childRoot = join(root, 'child')
    mkdirSync(sourceRoot, { recursive: true })
    mkdirSync(childRoot, { recursive: true })
    const packageJson = {
      scripts: {
        'bemoat:boilerplate:sync': 'node scripts/sync-boilerplate.ts',
        build: 'child-owned-build',
      },
    }
    writeFileSync(join(sourceRoot, 'package.json'), `${JSON.stringify(packageJson)}\n`)
    writeFileSync(join(childRoot, 'package.json'), `${JSON.stringify(packageJson)}\n`)
    const sync = await import('../../scripts/sync-boilerplate.ts')

    const result = sync.syncPackageManifest({
      sourceRootPath: sourceRoot,
      targetRootPath: childRoot,
    })
    const written = JSON.parse(readFileSync(join(childRoot, 'package.json'), 'utf8'))

    expect(result.updatedManagedScripts).toEqual([])
    expect(result.packageChanged).toBe(false)
    expect(written).toEqual(packageJson)
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

  it('preserves the prior sync timestamp only for an identical retry projection', async () => {
    const filesystem = await import('../../scripts/boilerplate/filesystem.ts')
    const input = {
      repo: 'example/starter',
      ref: 'main',
      syncMode: 'harness-only' as const,
      seedOnlyPathsSkipped: true,
      syncedManaged: ['AGENTS.md'],
    }
    const previous = filesystem.buildSyncMetadata({
      ...input,
      syncedAt: '2026-08-31T00:00:00.000Z',
    })
    const identicalRetry = filesystem.buildSyncMetadata({
      ...input,
      syncedAt: '2026-08-31T01:00:00.000Z',
    })
    const changedRetry = filesystem.buildSyncMetadata({
      ...input,
      syncedManaged: ['AGENTS.md', 'scripts/sync-boilerplate.ts'],
      syncedAt: '2026-08-31T01:00:00.000Z',
    })

    expect(filesystem.preserveIdenticalSyncTimestamp(previous, identicalRetry).syncedAt).toBe(
      previous.syncedAt,
    )
    expect(filesystem.preserveIdenticalSyncTimestamp(previous, changedRetry).syncedAt).toBe(
      changedRetry.syncedAt,
    )
  })
})
