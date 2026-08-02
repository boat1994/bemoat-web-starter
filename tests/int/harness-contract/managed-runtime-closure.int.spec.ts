import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

const tempRoots: string[] = []

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

async function loadClosure() {
  return import('../../../scripts/harness-contract/managed-runtime-closure.mjs')
}

describe('harness-contract managed-runtime-closure', () => {
  it('exports MANAGED_RUNTIME_ROOT_PREFIX', async () => {
    const mod = await loadClosure()
    expect(mod.MANAGED_RUNTIME_ROOT_PREFIX).toBe('scripts')
  })

  it('reports missing-managed-runtime-source for absent explicit managed .mjs paths', async () => {
    const mod = await loadClosure()
    const root = mkdtempSync(join(tmpdir(), 'bemoat-240-missing-source-'))
    tempRoots.push(root)
    mkdirSync(join(root, 'scripts'), { recursive: true })

    expect(
      mod.scanManagedRuntimeDeliveryClosure({
        root,
        managedPaths: ['scripts/missing.mjs'],
      }),
    ).toEqual([
      {
        type: 'missing-managed-runtime-source',
        importer: 'managedPaths',
        callee: 'scripts/missing.mjs',
        specifier: 'scripts/missing.mjs',
      },
    ])
  })

  it('reports missing-relative-runtime-dependency when a callee file is absent', async () => {
    const mod = await loadClosure()
    const root = mkdtempSync(join(tmpdir(), 'bemoat-240-missing-rel-'))
    tempRoots.push(root)
    mkdirSync(join(root, 'scripts'), { recursive: true })
    writeFileSync(join(root, 'scripts/root.mjs'), "import './missing.mjs'\n")

    expect(
      mod.scanManagedRuntimeDeliveryClosure({
        root,
        managedPaths: ['scripts/root.mjs'],
      }),
    ).toEqual([
      {
        type: 'missing-relative-runtime-dependency',
        importer: 'scripts/root.mjs',
        callee: 'scripts/missing.mjs',
        specifier: './missing.mjs',
      },
    ])
  })

  it('reports unmanaged-relative-runtime-dependency for unmanaged callees', async () => {
    const mod = await loadClosure()
    const root = mkdtempSync(join(tmpdir(), 'bemoat-240-unmanaged-'))
    tempRoots.push(root)
    mkdirSync(join(root, 'scripts'), { recursive: true })
    writeFileSync(join(root, 'scripts/root.mjs'), "import './hidden.mjs'\n")
    writeFileSync(join(root, 'scripts/hidden.mjs'), 'export const value = 1\n')

    expect(
      mod.scanManagedRuntimeDeliveryClosure({
        root,
        managedPaths: ['scripts/root.mjs'],
      }),
    ).toEqual([
      {
        type: 'unmanaged-relative-runtime-dependency',
        importer: 'scripts/root.mjs',
        callee: 'scripts/hidden.mjs',
        specifier: './hidden.mjs',
      },
    ])
  })

  it('reports unverifiable-dynamic-runtime-import for computed dynamic imports', async () => {
    const mod = await loadClosure()
    const root = mkdtempSync(join(tmpdir(), 'bemoat-240-unverifiable-'))
    tempRoots.push(root)
    mkdirSync(join(root, 'scripts'), { recursive: true })
    writeFileSync(join(root, 'scripts/root.mjs'), 'const bad = await import(spec)\n')

    expect(
      mod.scanManagedRuntimeDeliveryClosure({
        root,
        managedPaths: ['scripts/root.mjs'],
      }),
    ).toEqual([
      {
        type: 'unverifiable-dynamic-runtime-import',
        importer: 'scripts/root.mjs',
        callee: '<unresolved>',
        specifier: 'import(spec)',
      },
    ])
  })

  it('fails closed for escaped ../ relative paths as unverifiable', async () => {
    const mod = await loadClosure()
    const root = mkdtempSync(join(tmpdir(), 'bemoat-240-escaped-'))
    tempRoots.push(root)
    mkdirSync(join(root, 'scripts'), { recursive: true })
    writeFileSync(join(root, 'scripts/root.mjs'), "import '../../outside.mjs'\n")

    const resolved = mod.resolveRelativeRuntimeCallee('scripts/root.mjs', '../../outside.mjs')
    expect(resolved).toEqual({ kind: 'escaped', callee: '../outside.mjs' })

    expect(
      mod.scanManagedRuntimeDeliveryClosure({
        root,
        managedPaths: ['scripts/root.mjs'],
      }),
    ).toEqual([
      {
        type: 'unverifiable-dynamic-runtime-import',
        importer: 'scripts/root.mjs',
        callee: '<unresolved>',
        specifier: '../../outside.mjs',
      },
    ])
  })

  it('sorts violations deterministically by importer, type, callee, then specifier', async () => {
    const mod = await loadClosure()
    const root = mkdtempSync(join(tmpdir(), 'bemoat-240-order-'))
    tempRoots.push(root)
    mkdirSync(join(root, 'scripts'), { recursive: true })
    writeFileSync(
      join(root, 'scripts/b.mjs'),
      "import './missing-b.mjs'\nconst bad = await import(spec)\n",
    )
    writeFileSync(join(root, 'scripts/a.mjs'), "import './missing-a.mjs'\n")

    expect(
      mod.scanManagedRuntimeDeliveryClosure({
        root,
        managedPaths: ['scripts/b.mjs', 'scripts/a.mjs', 'scripts/ghost.mjs'],
      }),
    ).toEqual([
      {
        type: 'missing-managed-runtime-source',
        importer: 'managedPaths',
        callee: 'scripts/ghost.mjs',
        specifier: 'scripts/ghost.mjs',
      },
      {
        type: 'missing-relative-runtime-dependency',
        importer: 'scripts/a.mjs',
        callee: 'scripts/missing-a.mjs',
        specifier: './missing-a.mjs',
      },
      {
        type: 'missing-relative-runtime-dependency',
        importer: 'scripts/b.mjs',
        callee: 'scripts/missing-b.mjs',
        specifier: './missing-b.mjs',
      },
      {
        type: 'unverifiable-dynamic-runtime-import',
        importer: 'scripts/b.mjs',
        callee: '<unresolved>',
        specifier: 'import(spec)',
      },
    ])
  })

  it('throws ManagedRuntimeDeliveryClosureError with attached formatted diagnostics', async () => {
    const mod = await loadClosure()
    const root = mkdtempSync(join(tmpdir(), 'bemoat-240-assert-'))
    tempRoots.push(root)
    mkdirSync(join(root, 'scripts'), { recursive: true })
    writeFileSync(join(root, 'scripts/root.mjs'), "import './missing.mjs'\n")

    expect(() =>
      mod.assertManagedRuntimeDeliveryClosure({
        root,
        managedPaths: ['scripts/root.mjs'],
      }),
    ).toThrow(mod.ManagedRuntimeDeliveryClosureError)

    try {
      mod.assertManagedRuntimeDeliveryClosure({
        root,
        managedPaths: ['scripts/root.mjs'],
      })
      expect.unreachable('expected assertManagedRuntimeDeliveryClosure to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(mod.ManagedRuntimeDeliveryClosureError)
      const closureError = error as {
        violations: unknown[]
        formatted: string[]
      }
      expect(closureError.violations).toHaveLength(1)
      expect(closureError.formatted).toEqual([
        'Harness contract guard failed:',
        '',
        'Managed runtime delivery closure must resolve only managed local dependencies.',
        'See docs/harness-sync-contract.md.',
        '',
        '- [missing-relative-runtime-dependency] importer="scripts/root.mjs" -> callee="scripts/missing.mjs" specifier="./missing.mjs"',
      ])
    }
  })

  it('treats directory-managed descendants as managed runtime roots', async () => {
    const mod = await loadClosure()

    const roots = mod.collectManagedRuntimeScriptRoots(process.cwd(), [
      'scripts/agent-issue',
      'scripts/post-role-comment.mjs',
    ])

    expect(roots).toContain('scripts/agent-issue/github-evidence.mjs')
    expect(roots).toContain('scripts/post-role-comment.mjs')
  })

  it('ignores Node built-ins and package imports', async () => {
    const mod = await loadClosure()
    const root = mkdtempSync(join(tmpdir(), 'bemoat-240-builtins-'))
    tempRoots.push(root)
    mkdirSync(join(root, 'scripts'), { recursive: true })
    writeFileSync(
      join(root, 'scripts/root.mjs'),
      "import { readFileSync } from 'node:fs'\nimport payload from 'payload'\n",
    )

    expect(
      mod.scanManagedRuntimeDeliveryClosure({
        root,
        managedPaths: ['scripts/root.mjs'],
      }),
    ).toEqual([])
    expect(mod.isBuiltinOrPackageSpecifier('node:fs')).toBe(true)
    expect(mod.isBuiltinOrPackageSpecifier('payload')).toBe(true)
    expect(mod.isBuiltinOrPackageSpecifier('./local.mjs')).toBe(false)
  })
})
