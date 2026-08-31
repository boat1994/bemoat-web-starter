import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  buildScriptImportGraph,
  listRootScripts,
  validateArchitectureContract,
} from '../../scripts/guards/scripts-architecture.ts'
import * as architectureGuard from '../../scripts/guards/scripts-architecture.ts'
import architectureContract from '../../scripts/architecture-contract.json'

const tempRoots: string[] = []

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

function createTempRoot(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix))
  tempRoots.push(root)
  return root
}

function writeScript(root: string, relativePath: string, source: string) {
  const absolutePath = join(root, relativePath)
  mkdirSync(join(absolutePath, '..'), { recursive: true })
  writeFileSync(absolutePath, source)
}

function writeContract(
  root: string,
  contract: {
    cycleNodes?: unknown
    cycleEdges?: unknown
    adapters?: Record<string, { importers?: string[] }>
    rootScripts?: Array<{
      path: string
      facade_disposition: string
      internal_destination: string
      owning_slice: number
      migration_status: string
    }>
    transitionalDirectories?: Array<{ path: string; migration_status: string }>
  },
) {
  mkdirSync(join(root, 'scripts'), { recursive: true })
  writeFileSync(join(root, 'scripts/architecture-contract.json'), `${JSON.stringify(contract, null, 2)}\n`)
}

describe('scripts architecture ratchet', () => {
  it('keeps the stable root facade exports backed by the guard-owned module', () => {
    expect(buildScriptImportGraph).toBe(architectureGuard.buildScriptImportGraph)
    expect(listRootScripts).toBe(architectureGuard.listRootScripts)
    expect(validateArchitectureContract).toBe(architectureGuard.validateArchitectureContract)
  })

  it('validates architecture contract (no unallowed cycles or edges, adapter constraints)', () => {
    const violations = validateArchitectureContract(process.cwd())
    expect(violations).toEqual([])
  })

  it('preserves the approved current cycle baseline in the contract', () => {
    expect(architectureContract.cycleNodes).toHaveLength(0)
    expect(architectureContract.cycleEdges).toHaveLength(0)
  })

  it('maps every root script exactly once with destination vocabulary and transitional harness-contract', () => {
    const actual = listRootScripts(process.cwd())
    const mapped = architectureContract.rootScripts.map((entry) => entry.path)
    expect(mapped).toEqual(actual)
    expect(new Set(mapped).size).toBe(mapped.length)

    for (const entry of architectureContract.rootScripts) {
      expect(['stable_facade', 'composition_root', 'tooling_entrypoint']).toContain(entry.facade_disposition)
      expect(['unmapped', 'planned', 'transitional', 'migrated', 'retained']).toContain(entry.migration_status)
      expect(entry.owning_slice).toBeGreaterThanOrEqual(1)
      expect(entry.owning_slice).toBeLessThanOrEqual(7)
      expect(
        [
          'scripts/context/',
          'scripts/handoff/',
          'scripts/boilerplate/',
          'scripts/guards/',
          'scripts/adapters/',
          'scripts/tooling/',
          'scripts/shared/',
        ].some((prefix) => entry.internal_destination.startsWith(prefix)),
      ).toBe(true)
    }

    const harness = architectureContract.transitionalDirectories.find(
      (entry) => entry.path === 'scripts/harness-contract/',
    )
    expect(harness?.migration_status).toBe('transitional')
  })

  it('accepts native TypeScript root scripts in the architecture contract', () => {
    const root = createTempRoot('bemoat-arch-typescript-root-')
    writeContract(root, {
      cycleNodes: [],
      cycleEdges: [],
      adapters: {},
      rootScripts: [
        {
          path: 'scripts/example.ts',
          facade_disposition: 'composition_root',
          internal_destination: 'scripts/guards/',
          owning_slice: 7,
          migration_status: 'migrated',
        },
      ],
      transitionalDirectories: [{ path: 'scripts/harness-contract/', migration_status: 'transitional' }],
    })
    writeScript(root, 'scripts/example.ts', 'export const example = true\n')

    expect(validateArchitectureContract(root)).toEqual([])
  })

  it('rejects non-array cycleNodes and cycleEdges instead of treating them as empty', () => {
    const root = createTempRoot('bemoat-arch-malformed-cycles-')
    writeContract(root, {
      cycleNodes: { allowed: 'scripts/example.ts' },
      cycleEdges: 'scripts/example.ts -> scripts/other.ts',
      adapters: {},
    })

    expect(validateArchitectureContract(root)).toEqual(
      expect.arrayContaining([
        'architecture-contract.json cycleNodes must be an array',
        'architecture-contract.json cycleEdges must be an array',
      ]),
    )
  })

  it('captures side-effect static imports in the production architecture graph (F-SLICE1-02)', () => {
    const root = createTempRoot('bemoat-arch-side-effect-')
    writeContract(root, { cycleNodes: [], cycleEdges: [], adapters: {} })
    writeScript(root, 'scripts/alpha.mjs', "import './beta.mjs'\n")
    writeScript(root, 'scripts/beta.mjs', "import './alpha.mjs'\n")

    const graph = buildScriptImportGraph(root)
    expect([...graph.get('scripts/alpha.mjs') ?? []]).toEqual(['scripts/beta.mjs'])
    expect([...graph.get('scripts/beta.mjs') ?? []]).toEqual(['scripts/alpha.mjs'])

    const violations = validateArchitectureContract(root)
    expect(violations).toEqual(
      expect.arrayContaining([
        'Unallowed cycle node: scripts/alpha.mjs',
        'Unallowed cycle node: scripts/beta.mjs',
        'Unallowed cycle edge: scripts/alpha.mjs -> scripts/beta.mjs',
        'Unallowed cycle edge: scripts/beta.mjs -> scripts/alpha.mjs',
      ]),
    )
  })

  it('rejects unexpected CommandRunner importers (F-SLICE1-03)', () => {
    const root = createTempRoot('bemoat-arch-importer-unexpected-')
    writeContract(root, {
      cycleNodes: [],
      cycleEdges: [],
      adapters: {
        'scripts/adapters/command-runner.ts': {
          importers: ['scripts/example-adapter.mjs'],
        },
      },
    })
    writeScript(root, 'scripts/adapters/command-runner.ts', 'export const run = () => {}\n')
    writeScript(root, 'scripts/rogue.mjs', "import { run } from './adapters/command-runner.ts'\n")

    const violations = validateArchitectureContract(root)
    expect(violations).toContain(
      'Unallowed importer for adapter scripts/adapters/command-runner.ts: scripts/rogue.mjs',
    )
  })

  it('rejects missing expected CommandRunner importers (F-SLICE1-03)', () => {
    const root = createTempRoot('bemoat-arch-importer-missing-')
    writeContract(root, {
      cycleNodes: [],
      cycleEdges: [],
      adapters: {
        'scripts/adapters/command-runner.ts': {
          importers: ['scripts/example-adapter.mjs'],
        },
      },
    })
    writeScript(root, 'scripts/adapters/command-runner.ts', 'export const run = () => {}\n')

    const violations = validateArchitectureContract(root)
    expect(violations).toContain(
      'Missing expected importer for adapter scripts/adapters/command-runner.ts: scripts/example-adapter.mjs',
    )
  })

  it('retains self-import edges and rejects unallowlisted self-loops (F-SLICE1-04)', () => {
    const root = createTempRoot('bemoat-arch-self-loop-')
    writeContract(root, { cycleNodes: [], cycleEdges: [], adapters: {} })
    writeScript(root, 'scripts/lonely.mjs', "import './lonely.mjs'\n")

    const graph = buildScriptImportGraph(root)
    expect([...graph.get('scripts/lonely.mjs') ?? []]).toEqual(['scripts/lonely.mjs'])

    const violations = validateArchitectureContract(root)
    expect(violations).toEqual(
      expect.arrayContaining([
        'Unallowed cycle node: scripts/lonely.mjs',
        'Unallowed cycle edge: scripts/lonely.mjs -> scripts/lonely.mjs',
      ]),
    )
  })
})
