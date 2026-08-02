import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('mission-control managed-path and composition boundaries', () => {
  it('extracts managed paths in source order', async () => {
    const { extractManagedPathsFromSyncScript } = await import(
      '../../scripts/guards/mission-control-contract/managed-paths.mjs'
    )

    expect(extractManagedPathsFromSyncScript("export const managedPaths = ['a', 'b']")).toEqual([
      'a',
      'b',
    ])
  })

  it('prefers the extracted inventory and falls back to legacy root inventory', async () => {
    const { extractManagedPaths } = await import(
      '../../scripts/guards/mission-control-contract/managed-paths.mjs'
    )

    const inventory = `
      export const syncManifestPath = '.bemoat/boilerplate-sync-manifest.json'
      export const managedPaths = [
        // Agent and workflow rails
        syncManifestPath, 'scripts/boilerplate'
      ]
    `
    const legacySync = "export const managedPaths = ['AGENTS.md', 'scripts/sync-boilerplate.mjs']"

    expect(extractManagedPaths({ inventory, legacySync })).toEqual([
      '.bemoat/boilerplate-sync-manifest.json',
      'scripts/boilerplate',
    ])
    expect(extractManagedPaths({ inventory: null, legacySync })).toEqual([
      'AGENTS.md',
      'scripts/sync-boilerplate.mjs',
    ])
    expect(extractManagedPaths({ inventory: 'export const managedPaths = [unknownPath]', legacySync })).toEqual([])
  })

  it('rejects the live override path through the managed-path scanner', async () => {
    const managedPaths = await import('../../scripts/guards/mission-control-contract/managed-paths.mjs')
    const inventory = await import('../../scripts/guards/mission-control-contract/inventory.mjs')

    const violations = managedPaths.scanManagedPathsContract([
      ...inventory.MC_MANAGED_PATHS,
      inventory.LIVE_OVERRIDE_PATH,
    ])

    expect(violations).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: 'MC010' })]),
    )
  })

  it('keeps runner composition fail-closed for an empty repository root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bemoat-mc-runner-'))
    tempRoots.push(root)
    const { runMissionControlContractGuard } = await import(
      '../../scripts/guards/mission-control-contract/runner.mjs'
    )

    const violations = runMissionControlContractGuard({ root })

    expect(violations.some((violation) => violation.rule === 'MC013')).toBe(true)
    expect(violations.some((violation) => violation.rule === 'MC002')).toBe(true)
  })

  it('keeps diagnostic formatting and exit mapping stable', async () => {
    const diagnostics = await import('../../scripts/guards/mission-control-contract/diagnostics.mjs')

    expect(diagnostics.getMissionControlContractExitCode([])).toBe(0)
    expect(diagnostics.getMissionControlContractExitCode([{ rule: 'MC001' }])).toBe(1)
    expect(diagnostics.formatMissionControlContractViolations([])).toEqual([
      'Mission Control contract guard passed.',
    ])
  })
})
