import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

type BuildSyncMetadataParams = Parameters<
  (typeof import('../../scripts/sync-boilerplate.mjs'))['buildSyncMetadata']
>[0]

const scratchRoots: string[] = []

function createScratchRoot() {
  const root = mkdtempSync(join(tmpdir(), 'bemoat-boilerplate-filesystem-'))
  scratchRoots.push(root)
  return root
}

function writeFixtureFile(root: string, relativePath: string, content: string) {
  const filePath = join(root, relativePath)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, { encoding: 'utf8', flush: true })
}

afterEach(() => {
  for (const root of scratchRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function loadFilesystem() {
  return import('../../scripts/boilerplate/filesystem.mjs')
}

function buildSyncMetadataInput(input: unknown): BuildSyncMetadataParams {
  return input as BuildSyncMetadataParams
}

describe('boilerplate filesystem seam characterization', () => {
  it('overwrites managed paths and seeds only absent child files', async () => {
    const filesystem = await loadFilesystem()
    const root = createScratchRoot()
    const sourceRoot = join(root, 'source')
    const targetRoot = join(root, 'target')

    writeFixtureFile(sourceRoot, 'managed.txt', 'starter managed\n')
    writeFixtureFile(targetRoot, 'managed.txt', 'child managed\n')
    writeFixtureFile(sourceRoot, 'src/example/new.ts', 'starter new\n')
    writeFixtureFile(sourceRoot, 'src/example/existing.ts', 'starter existing\n')
    writeFixtureFile(targetRoot, 'src/example/existing.ts', 'child existing\n')

    expect(filesystem.copyManagedPath(sourceRoot, targetRoot, 'managed.txt')).toEqual({ copied: true })
    expect(readFileSync(join(targetRoot, 'managed.txt'), 'utf8')).toBe('starter managed\n')
    expect(filesystem.copySeedOnlyPath(sourceRoot, targetRoot, 'src/example')).toEqual({
      seeded: ['src/example/new.ts'],
      skipped: ['src/example/existing.ts'],
    })
    expect(readFileSync(join(targetRoot, 'src/example/new.ts'), 'utf8')).toBe('starter new\n')
    expect(readFileSync(join(targetRoot, 'src/example/existing.ts'), 'utf8')).toBe('child existing\n')
  })

  it('merges gitignore rules without discarding child rules and preserves metadata shape', async () => {
    const filesystem = await loadFilesystem()
    const root = createScratchRoot()
    const sourceRoot = join(root, 'source')
    const targetRoot = join(root, 'target')
    const syncConfig = {
      managedPaths: ['managed.txt'],
      seedOnlyPaths: ['src/example'],
      mergeKeepPaths: ['.gitignore'],
      managedPackageScripts: ['bemoat:check'],
      suggestedPackageScripts: ['check'],
      buildContractPackageScripts: ['build'],
      buildContractFilePaths: ['open-next.config.ts'],
      suggestedPackageSections: ['dependencies'],
    }

    writeFixtureFile(sourceRoot, '.gitignore', 'dist\n.cache\n')
    writeFixtureFile(targetRoot, '.gitignore', 'child-only\ndist\n')

    expect(filesystem.mergeKeepPath(sourceRoot, targetRoot, '.gitignore')).toEqual({
      merged: true,
      addedLines: ['.cache'],
      changed: true,
      created: false,
    })
    expect(readFileSync(join(targetRoot, '.gitignore'), 'utf8')).toBe(
      'child-only\ndist\n# Added by bemoat boilerplate sync\n.cache\n',
    )
    expect(filesystem.buildSyncMetadata(buildSyncMetadataInput({
      repo: 'example/starter',
      ref: 'abc123',
      syncMode: 'full',
      seedOnlyPathsSkipped: false,
      syncedManaged: ['managed.txt'],
      seededFiles: ['src/example/new.ts'],
      skippedSeedFiles: ['src/example/existing.ts'],
      mergedFiles: ['.gitignore'],
      packageSync: {
        addedScripts: ['bemoat:check'],
        appliedBuildContractScripts: ['build'],
        updatedBuildContractScripts: [],
        proposalPath: '.bemoat/package-sync-proposal.md',
      },
      buildContractFiles: { applied: ['open-next.config.ts'], updated: [], skipped: [] },
      syncedAt: '2026-08-02T00:00:00.000Z',
      syncConfig,
    }))).toEqual({
      repo: 'example/starter',
      ref: 'abc123',
      syncMode: 'full',
      seedOnlyPathsSkipped: false,
      syncedAt: '2026-08-02T00:00:00.000Z',
      managedPaths: ['managed.txt'],
      seedOnlyPaths: ['src/example'],
      mergeKeepPaths: ['.gitignore'],
      managedPackageScripts: ['bemoat:check'],
      suggestedPackageScripts: ['check'],
      buildContractPackageScripts: ['build'],
      buildContractFilePaths: ['open-next.config.ts'],
      suggestedPackageSections: ['dependencies'],
      lastSyncedManagedPaths: ['managed.txt'],
      seededFiles: ['src/example/new.ts'],
      skippedSeedFiles: ['src/example/existing.ts'],
      mergedFiles: ['.gitignore'],
      packageSync: {
        addedScripts: ['bemoat:check'],
        appliedBuildContractScripts: ['build'],
        updatedBuildContractScripts: [],
        proposalPath: '.bemoat/package-sync-proposal.md',
      },
      buildContractFiles: { applied: ['open-next.config.ts'], updated: [], skipped: [] },
    })
  })

  it('adds only missing managed scripts, applies build contracts, and reports proposal-only drift', async () => {
    const filesystem = await loadFilesystem()
    const sourcePackage = {
      scripts: {
        'bemoat:check': 'starter check',
        'bemoat:new': 'starter new',
        build: 'starter build',
        deploy: 'starter deploy',
      },
      dependencies: { 'starter-dependency': '1.0.0' },
    }
    const targetPackage = {
      scripts: {
        'bemoat:check': 'child check',
        build: 'child build',
      },
      dependencies: { 'starter-dependency': '0.9.0' },
    }

    expect(filesystem.applyManagedPackageScripts(sourcePackage, targetPackage, [
      'bemoat:check',
      'bemoat:new',
    ])).toEqual({
      packageJSON: {
        scripts: {
          'bemoat:check': 'child check',
          build: 'child build',
          'bemoat:new': 'starter new',
        },
        dependencies: { 'starter-dependency': '0.9.0' },
      },
      addedScripts: ['bemoat:new'],
    })
    expect(filesystem.applyBuildContractScripts(sourcePackage, targetPackage, ['build', 'deploy'])).toEqual({
      packageJSON: {
        scripts: {
          'bemoat:check': 'child check',
          build: 'starter build',
          deploy: 'starter deploy',
        },
        dependencies: { 'starter-dependency': '0.9.0' },
      },
      addedScripts: ['deploy'],
      updatedScripts: ['build'],
    })

    const proposal = filesystem.buildPackageSyncProposal(sourcePackage, targetPackage, {
      managedPackageScripts: ['bemoat:check'],
      suggestedPackageScripts: ['deploy'],
      suggestedPackageSections: ['dependencies'],
    })
    expect(proposal).toEqual({
      missingScripts: [{ name: 'deploy', value: 'starter deploy' }],
      differentScripts: [],
      differentBemoatScripts: [{ name: 'bemoat:check', source: 'starter check', target: 'child check' }],
      missingSectionEntries: {},
      differentSectionEntries: {
        dependencies: [{ name: 'starter-dependency', source: '1.0.0', target: '0.9.0' }],
      },
    })
    expect(filesystem.formatPackageSyncProposal({
      repo: 'example/starter',
      ref: 'abc123',
      proposal,
      suggestedPackageSections: ['dependencies'],
    })).toContain('Do not apply these changes automatically')
  })

  it('fails closed before package proposal output when an exact managed script diverges', async () => {
    const filesystem = await loadFilesystem()
    const root = createScratchRoot()
    const sourceRoot = join(root, 'source')
    const targetRoot = join(root, 'target')
    const syncConfig = {
      managedPaths: [] as string[],
      seedOnlyPaths: [] as string[],
      mergeKeepPaths: [] as string[],
      managedPackageScripts: ['bemoat:typecheck'],
      suggestedPackageScripts: [] as string[],
      suggestedPackageSections: [] as string[],
      buildContractPackageScripts: [] as string[],
      buildContractFilePaths: [] as string[],
    }

    writeFixtureFile(sourceRoot, 'package.json', `${JSON.stringify({ scripts: { 'bemoat:typecheck': 'starter typecheck' } })}\n`)
    writeFixtureFile(targetRoot, 'package.json', `${JSON.stringify({ scripts: { 'bemoat:typecheck': 'child typecheck' } })}\n`)

    expect(() => filesystem.syncPackageManifest({
      sourceRootPath: sourceRoot,
      targetRootPath: targetRoot,
      syncConfig,
    })).toThrow('bemoat:typecheck')
    expect(existsSync(join(targetRoot, '.bemoat/package-sync-proposal.md'))).toBe(false)
    expect(readFileSync(join(targetRoot, 'package.json'), 'utf8')).toBe(
      `${JSON.stringify({ scripts: { 'bemoat:typecheck': 'child typecheck' } })}\n`,
    )
  })
})
