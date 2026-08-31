import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import architectureContract from '../../../scripts/architecture-contract.json'

const BASELINE_FACADE_EXPORTS = [
  'CHILD_FACING_HARNESS_PATHS',
  'FORBIDDEN_RAW_SCRIPTS',
  'MANAGED_RUNTIME_ROOT_PREFIX',
  'ManagedRuntimeDeliveryClosureError',
  'extractPnpmRunScripts',
  'findForbiddenRawScriptCalls',
  'scanChildFacingHarnessFile',
  'isManagedPath',
  'isBuiltinOrPackageSpecifier',
  'resolveRelativeRuntimeCallee',
  'parseRuntimeImportSpecifiers',
  'collectManagedRuntimeScriptRoots',
  'collectExplicitManagedRuntimeScriptPaths',
  'scanManagedRuntimeDeliveryClosure',
  'formatManagedRuntimeDeliveryViolations',
  'assertManagedRuntimeDeliveryClosure',
  'runHarnessContractGuard',
  'getHarnessContractExitCode',
  'formatHarnessContractViolations',
  'loadManagedPathsFromManifest',
  'isDirectExecution',
] as const

const PRODUCTION_IMPORTERS = [
  {
    path: 'scripts/guard-pack.ts',
    symbols: ['formatHarnessContractViolations', 'runHarnessContractGuard'],
  },
  {
    path: 'scripts/guards/package-manager.ts',
    facadeImport: '../guard-harness-contract.ts',
    symbols: ['CHILD_FACING_HARNESS_PATHS'],
  },
  {
    path: 'scripts/sync-boilerplate.ts',
    facadeImport: './guard-harness-contract.ts',
    symbols: ['assertManagedRuntimeDeliveryClosure'],
  },
] as const

const SCC_NODES = new Set<string>(architectureContract.cycleNodes as string[])
const tempRoots: string[] = []

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

function listHarnessContractModules() {
  return readdirSync(join(process.cwd(), 'scripts/harness-contract'))
    .filter((name) => name.endsWith('.ts'))
    .map((name) => `scripts/harness-contract/${name}`)
    .sort()
}

function collectRelativeImports(source: string) {
  const imports = new Set<string>()
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[^;]*?\sfrom\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+(?:\{[^}]*\}|\*(?:\s+as\s+[\w$]+)?)\s+from\s+['"]([^'"]+)['"]/g,
  ]

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      imports.add(match[1])
    }
  }

  return [...imports]
}

describe('harness-contract facade exports', () => {
  it('exports exactly the baseline public symbol set', async () => {
    const facade = await import('../../../scripts/guard-harness-contract.ts')
    const exportNames = Object.keys(facade).sort()

    expect(exportNames).toEqual([...BASELINE_FACADE_EXPORTS].sort())
  })

  it('keeps production importers resolving identical facade symbols', async () => {
    const facade = await import('../../../scripts/guard-harness-contract.ts')

    for (const importer of PRODUCTION_IMPORTERS) {
      const source = readFileSync(join(process.cwd(), importer.path), 'utf8')
      const facadeImport = 'facadeImport' in importer
        ? importer.facadeImport
        : './guard-harness-contract.ts'
      expect(source).toContain(`${facadeImport}'`)

      for (const symbol of importer.symbols) {
        expect(source).toContain(symbol)
        expect(facade[symbol], `${importer.path} expects ${symbol}`).toBeTypeOf(
          symbol === 'CHILD_FACING_HARNESS_PATHS' ? 'object' : 'function',
        )
      }
    }
  })

  it('keeps extracted harness-contract modules acyclic and outside the approved SCC', () => {
    const modules = listHarnessContractModules()
    expect(modules.length).toBeGreaterThan(0)

    const edges: string[] = []

    for (const modulePath of modules) {
      expect(SCC_NODES.has(modulePath), `${modulePath} must not be an SCC node`).toBe(false)

      const source = readFileSync(join(process.cwd(), modulePath), 'utf8')
      for (const specifier of collectRelativeImports(source)) {
        if (!specifier.startsWith('.')) continue

        const normalized = posix.normalize(posix.join(posix.dirname(modulePath), specifier))

        expect(
          SCC_NODES.has(normalized),
          `${modulePath} must not import SCC node ${normalized}`,
        ).toBe(false)

        if (normalized.startsWith('scripts/harness-contract/')) {
          const facadeReExport =
            modulePath.endsWith('.mjs') &&
            normalized.endsWith('.ts') &&
            modulePath.slice(0, -4) === normalized.slice(0, -3)
          if (!facadeReExport) {
            edges.push(`${modulePath} -> ${normalized}`)
          }
        } else {
          expect.fail(`${modulePath} must not import outside harness-contract: ${specifier}`)
        }
      }
    }

    expect(edges).toEqual([
      'scripts/harness-contract/managed-runtime-closure.ts -> scripts/harness-contract/runtime-import-parser.ts',
    ])
  })
})

describe('harness-contract manifest', () => {
  async function loadManifest() {
    return import('../../../scripts/harness-contract/manifest.ts')
  }

  function writeManifest(root: string, body: string) {
    mkdirSync(join(root, '.bemoat'), { recursive: true })
    writeFileSync(join(root, '.bemoat/boilerplate-sync-manifest.json'), body)
  }

  it('returns the live starter managedPaths array when the canonical manifest exists', async () => {
    const mod = await loadManifest()
    const managedPaths = mod.loadManagedPathsFromManifest()

    expect(Array.isArray(managedPaths)).toBe(true)
    expect(managedPaths).toContain('scripts/harness-contract')
  })

  it('returns null when the manifest file is missing', async () => {
    const mod = await loadManifest()
    const root = mkdtempSync(join(tmpdir(), 'bemoat-333-manifest-missing-'))
    tempRoots.push(root)

    expect(mod.loadManagedPathsFromManifest(root)).toBeNull()
  })

  it('returns managedPaths when it is an array, including mixed element types', async () => {
    const mod = await loadManifest()
    const root = mkdtempSync(join(tmpdir(), 'bemoat-333-manifest-array-'))
    tempRoots.push(root)

    writeManifest(root, JSON.stringify({ managedPaths: ['a', 'b'] }))
    expect(mod.loadManagedPathsFromManifest(root)).toEqual(['a', 'b'])

    writeManifest(root, JSON.stringify({ managedPaths: [] }))
    expect(mod.loadManagedPathsFromManifest(root)).toEqual([])

    writeManifest(root, JSON.stringify({ managedPaths: [1, { x: 1 }, 'ok'] }))
    expect(mod.loadManagedPathsFromManifest(root)).toEqual([1, { x: 1 }, 'ok'])
  })

  it('returns null when managedPaths is missing or not an array', async () => {
    const mod = await loadManifest()
    const root = mkdtempSync(join(tmpdir(), 'bemoat-333-manifest-nullish-'))
    tempRoots.push(root)

    writeManifest(root, JSON.stringify({}))
    expect(mod.loadManagedPathsFromManifest(root)).toBeNull()

    writeManifest(root, JSON.stringify({ managedPaths: 'nope' }))
    expect(mod.loadManagedPathsFromManifest(root)).toBeNull()

    writeManifest(root, 'true')
    expect(mod.loadManagedPathsFromManifest(root)).toBeNull()

    writeManifest(root, '0')
    expect(mod.loadManagedPathsFromManifest(root)).toBeNull()

    writeManifest(root, '[]')
    expect(mod.loadManagedPathsFromManifest(root)).toBeNull()
  })

  it('throws SyntaxError for invalid JSON and TypeError when JSON null is parsed', async () => {
    const mod = await loadManifest()
    const root = mkdtempSync(join(tmpdir(), 'bemoat-333-manifest-throw-'))
    tempRoots.push(root)

    writeManifest(root, '{')
    expect(() => mod.loadManagedPathsFromManifest(root)).toThrow(SyntaxError)

    writeManifest(root, '')
    expect(() => mod.loadManagedPathsFromManifest(root)).toThrow(SyntaxError)

    writeManifest(root, 'null')
    expect(() => mod.loadManagedPathsFromManifest(root)).toThrow(TypeError)
  })
})
