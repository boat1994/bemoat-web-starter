import { readFileSync, readdirSync } from 'node:fs'
import { join, posix } from 'node:path'

import { describe, expect, it } from 'vitest'

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
    path: 'scripts/guard-pack.mjs',
    symbols: ['formatHarnessContractViolations', 'runHarnessContractGuard'],
  },
  {
    path: 'scripts/guard-package-manager.mjs',
    symbols: ['CHILD_FACING_HARNESS_PATHS'],
  },
  {
    path: 'scripts/sync-boilerplate.mjs',
    symbols: ['assertManagedRuntimeDeliveryClosure'],
  },
] as const

const SCC_NODES = new Set(architectureContract.cycleNodes)

function listHarnessContractModules() {
  return readdirSync(join(process.cwd(), 'scripts/harness-contract'))
    .filter((name) => name.endsWith('.mjs'))
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
    const facade = await import('../../../scripts/guard-harness-contract.mjs')
    const exportNames = Object.keys(facade).sort()

    expect(exportNames).toEqual([...BASELINE_FACADE_EXPORTS].sort())
  })

  it('keeps production importers resolving identical facade symbols', async () => {
    const facade = await import('../../../scripts/guard-harness-contract.mjs')

    for (const importer of PRODUCTION_IMPORTERS) {
      const source = readFileSync(join(process.cwd(), importer.path), 'utf8')
      expect(source).toContain("./guard-harness-contract.mjs'")

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
          edges.push(`${modulePath} -> ${normalized}`)
        } else {
          expect.fail(`${modulePath} must not import outside harness-contract: ${specifier}`)
        }
      }
    }

    expect(edges).toEqual([
      'scripts/harness-contract/managed-runtime-closure.mjs -> scripts/harness-contract/runtime-import-parser.mjs',
    ])
  })
})
