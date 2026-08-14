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

  it('matches managed paths by exact entry or descendant prefix with a slash', async () => {
    const mod = await loadClosure()

    expect(mod.isManagedPath('scripts/foo.mjs', ['scripts/foo.mjs'])).toBe(true)
    expect(mod.isManagedPath('scripts/foo/bar.mjs', ['scripts/foo'])).toBe(true)
    expect(mod.isManagedPath('scripts/foobar.mjs', ['scripts/foo'])).toBe(false)
    expect(mod.isManagedPath('scripts/foo', ['scripts/foo.mjs'])).toBe(false)
  })

  it('collects explicit managed runtime .mjs paths under scripts/ in sorted order', async () => {
    const mod = await loadClosure()

    expect(
      mod.collectExplicitManagedRuntimeScriptPaths([
        'scripts/b.mjs',
        'AGENTS.md',
        'scripts/agent-issue',
        'docs/x.md',
        'scripts/a.mjs',
        'tests/foo.mjs',
      ]),
    ).toEqual(['scripts/a.mjs', 'scripts/b.mjs'])
  })

  it('treats empty specifiers as built-in and skips absolute specifiers as external', async () => {
    const mod = await loadClosure()
    const root = mkdtempSync(join(tmpdir(), 'bemoat-333-empty-abs-'))
    tempRoots.push(root)
    mkdirSync(join(root, 'scripts'), { recursive: true })
    writeFileSync(join(root, 'scripts/empty.mjs'), "import ''\n")
    writeFileSync(join(root, 'scripts/abs.mjs'), "import '/tmp/x.mjs'\n")

    expect(mod.isBuiltinOrPackageSpecifier('')).toBe(true)
    expect(mod.isBuiltinOrPackageSpecifier(null)).toBe(true)
    expect(mod.isBuiltinOrPackageSpecifier('#internal')).toBe(true)
    expect(mod.isBuiltinOrPackageSpecifier('/abs.mjs')).toBe(false)
    expect(mod.resolveRelativeRuntimeCallee('scripts/root.mjs', '/abs.mjs')).toEqual({
      kind: 'external',
      callee: null,
    })
    expect(
      mod.scanManagedRuntimeDeliveryClosure({
        root,
        managedPaths: ['scripts/empty.mjs', 'scripts/abs.mjs'],
      }),
    ).toEqual([])
  })

  it('returns an empty array from assertManagedRuntimeDeliveryClosure when the nested closure is clean', async () => {
    const mod = await loadClosure()
    const root = mkdtempSync(join(tmpdir(), 'bemoat-333-assert-ok-'))
    tempRoots.push(root)
    mkdirSync(join(root, 'scripts/nested'), { recursive: true })
    writeFileSync(join(root, 'scripts/root.mjs'), "import './nested/leaf.mjs'\n")
    writeFileSync(join(root, 'scripts/nested/leaf.mjs'), "import { readFileSync } from 'node:fs'\n")

    expect(
      mod.assertManagedRuntimeDeliveryClosure({
        root,
        managedPaths: ['scripts/root.mjs', 'scripts/nested/leaf.mjs'],
      }),
    ).toEqual([])
  })

  it('treats a directory whose name ends in .mjs as missing-managed-runtime-source', async () => {
    const mod = await loadClosure()
    const root = mkdtempSync(join(tmpdir(), 'bemoat-333-dir-mjs-'))
    tempRoots.push(root)
    mkdirSync(join(root, 'scripts/not-a-file.mjs'), { recursive: true })

    expect(
      mod.scanManagedRuntimeDeliveryClosure({
        root,
        managedPaths: ['scripts/not-a-file.mjs'],
      }),
    ).toEqual([
      {
        type: 'missing-managed-runtime-source',
        importer: 'managedPaths',
        callee: 'scripts/not-a-file.mjs',
        specifier: 'scripts/not-a-file.mjs',
      },
    ])
  })

  it('scans nothing when managedPaths is omitted and reports unmanaged non-mjs callees', async () => {
    const mod = await loadClosure()
    const root = mkdtempSync(join(tmpdir(), 'bemoat-333-default-unmanaged-'))
    tempRoots.push(root)
    mkdirSync(join(root, 'scripts'), { recursive: true })
    writeFileSync(join(root, 'scripts/root.mjs'), "import './leaf.json'\n")
    writeFileSync(join(root, 'scripts/leaf.json'), '{}\n')

    expect(mod.scanManagedRuntimeDeliveryClosure({ root })).toEqual([])
    expect(
      mod.scanManagedRuntimeDeliveryClosure({
        root,
        managedPaths: ['scripts/root.mjs'],
      }),
    ).toEqual([
      {
        type: 'unmanaged-relative-runtime-dependency',
        importer: 'scripts/root.mjs',
        callee: 'scripts/leaf.json',
        specifier: './leaf.json',
      },
    ])
  })
})
