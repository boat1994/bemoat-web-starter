import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  buildScriptImportGraph,
  validateArchitectureContract,
} from '../../scripts/guard-scripts-architecture.mjs'
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
    cycleNodes?: string[]
    cycleEdges?: string[]
    adapters?: Record<string, { importers?: string[] }>
  },
) {
  mkdirSync(join(root, 'scripts'), { recursive: true })
  writeFileSync(join(root, 'scripts/architecture-contract.json'), `${JSON.stringify(contract, null, 2)}\n`)
}

describe('scripts architecture ratchet', () => {
  it('validates architecture contract (no unallowed cycles or edges, adapter constraints)', () => {
    const violations = validateArchitectureContract(process.cwd())
    expect(violations).toEqual([])
  })

  it('preserves the approved nine-node sixteen-edge baseline SCC in the contract', () => {
    expect(architectureContract.cycleNodes).toHaveLength(9)
    expect(architectureContract.cycleEdges).toHaveLength(16)
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
        'scripts/adapters/command-runner.mjs': {
          importers: ['scripts/command-runner.mjs'],
        },
      },
    })
    writeScript(root, 'scripts/adapters/command-runner.mjs', 'export const run = () => {}\n')
    writeScript(root, 'scripts/command-runner.mjs', "import { run } from './adapters/command-runner.mjs'\n")
    writeScript(root, 'scripts/rogue.mjs', "import { run } from './adapters/command-runner.mjs'\n")

    const violations = validateArchitectureContract(root)
    expect(violations).toContain(
      'Unallowed importer for adapter scripts/adapters/command-runner.mjs: scripts/rogue.mjs',
    )
  })

  it('rejects missing expected CommandRunner importers (F-SLICE1-03)', () => {
    const root = createTempRoot('bemoat-arch-importer-missing-')
    writeContract(root, {
      cycleNodes: [],
      cycleEdges: [],
      adapters: {
        'scripts/adapters/command-runner.mjs': {
          importers: ['scripts/command-runner.mjs', 'scripts/mission-control-review.mjs'],
        },
      },
    })
    writeScript(root, 'scripts/adapters/command-runner.mjs', 'export const run = () => {}\n')
    writeScript(root, 'scripts/command-runner.mjs', "import { run } from './adapters/command-runner.mjs'\n")

    const violations = validateArchitectureContract(root)
    expect(violations).toContain(
      'Missing expected importer for adapter scripts/adapters/command-runner.mjs: scripts/mission-control-review.mjs',
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
