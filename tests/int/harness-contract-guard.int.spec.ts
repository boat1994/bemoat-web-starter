import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('harness contract guard', () => {
  it('exports child-facing paths and forbidden raw scripts', async () => {
    const mod = await import('../../scripts/guard-harness-contract.mjs')

    expect(mod.CHILD_FACING_HARNESS_PATHS).toContain('.github/workflows/ci.yml')
    expect(mod.CHILD_FACING_HARNESS_PATHS).toContain('.githooks/pre-commit')
    expect(mod.CHILD_FACING_HARNESS_PATHS).toContain('.githooks/pre-push')
    expect(mod.FORBIDDEN_RAW_SCRIPTS).toContain('lint')
    expect(mod.FORBIDDEN_RAW_SCRIPTS).toContain('build')
    expect(mod.FORBIDDEN_RAW_SCRIPTS).not.toContain('bemoat:guard:safety')
  })

  it('detects forbidden raw script calls in harness content', async () => {
    const mod = await import('../../scripts/guard-harness-contract.mjs')

    const violations = mod.scanChildFacingHarnessFile(
      '.github/workflows/ci.yml',
      'run: pnpm run lint\nrun: pnpm run bemoat:guard:safety',
    )

    expect(violations).toHaveLength(1)
    expect(violations[0].rule).toBe('lint')
  })

  it('passes when only bemoat:* scripts are called', async () => {
    const mod = await import('../../scripts/guard-harness-contract.mjs')

    const violations = mod.runHarnessContractGuard({
      root: process.cwd(),
      readFile: (filePath) => readFileSync(filePath, 'utf8'),
    })

    expect(violations).toEqual([])
    expect(mod.getHarnessContractExitCode(violations)).toBe(0)
  })

  it('is listed in managedPaths for boilerplate sync', async () => {
    const syncMod = await import('../../scripts/sync-boilerplate.mjs')

    expect(syncMod.managedPaths).toContain('scripts/check-branch-safety.sh')
    expect(syncMod.managedPaths).toContain('scripts/guard-harness-contract.mjs')
    expect(syncMod.managedPaths).toContain('scripts/github-comment-projection.mjs')
    expect(syncMod.managedPackageScripts).toContain('bemoat:branch:check')
    expect(syncMod.managedPackageScripts).toContain('bemoat:guard:harness-contract')
  })
})

describe('harness contract guard on disk', () => {
  it('validates synced CI workflow and hooks', async () => {
    const mod = await import('../../scripts/guard-harness-contract.mjs')

    for (const relativePath of mod.CHILD_FACING_HARNESS_PATHS) {
      const content = readFileSync(resolve(process.cwd(), relativePath), 'utf8')
      const violations = mod.scanChildFacingHarnessFile(relativePath, content)

      expect(
        violations,
        `${relativePath} must not call raw scripts: ${violations.map((item: { rule: string }) => item.rule).join(', ')}`,
      ).toEqual([])
    }
  })
})

describe('managed runtime delivery closure', () => {
  it('passes the live starter closure including github-comment-projection', async () => {
    const guardMod = await import('../../scripts/guard-harness-contract.mjs')
    const syncMod = await import('../../scripts/sync-boilerplate.mjs')

    const violations = guardMod.scanManagedRuntimeDeliveryClosure({
      root: process.cwd(),
      managedPaths: syncMod.managedPaths,
    })

    expect(violations).toEqual([])
    expect(
      guardMod.formatManagedRuntimeDeliveryViolations(violations),
    ).toEqual(['Harness contract guard passed.'])
  })

  it('treats directory-managed script descendants as managed runtime roots', async () => {
    const guardMod = await import('../../scripts/guard-harness-contract.mjs')

    const roots = guardMod.collectManagedRuntimeScriptRoots(process.cwd(), [
      'scripts/agent-issue',
      'scripts/post-role-comment.mjs',
    ])

    expect(roots).toContain('scripts/agent-issue/github-evidence.mjs')
    expect(roots).toContain('scripts/post-role-comment.mjs')
  })

  it('ignores Node built-ins and package imports', async () => {
    const guardMod = await import('../../scripts/guard-harness-contract.mjs')

    const specifiers = guardMod.parseRuntimeImportSpecifiers(`
      import { readFileSync } from 'node:fs'
      import { Buffer } from 'buffer'
      import { spawnSync } from 'node:child_process'
      import payload from 'payload'
    `)

    for (const entry of specifiers.specifiers) {
      expect(guardMod.isBuiltinOrPackageSpecifier(entry.specifier)).toBe(true)
    }
    expect(specifiers.unverifiable).toEqual([])
  })

  it('traverses literal dynamic imports and rejects computed dynamic imports', async () => {
    const guardMod = await import('../../scripts/guard-harness-contract.mjs')
    const tempRoot = mkdtempSync(join(tmpdir(), 'bemoat-182-closure-'))

    try {
      mkdirSync(join(tempRoot, 'scripts'), { recursive: true })
      writeFileSync(
        join(tempRoot, 'scripts/root.mjs'),
        `const ok = await import('./leaf.mjs')\nconst bad = await import(spec)\n`,
      )
      writeFileSync(join(tempRoot, 'scripts/leaf.mjs'), 'export const leaf = 1\n')

      const violations = guardMod.scanManagedRuntimeDeliveryClosure({
        root: tempRoot,
        managedPaths: ['scripts/root.mjs', 'scripts/leaf.mjs'],
      })

      expect(violations).toEqual([
        {
          type: 'unverifiable-dynamic-runtime-import',
          importer: 'scripts/root.mjs',
          callee: '<unresolved>',
          specifier: 'import(spec)',
        },
      ])
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('does not traverse tests or fixtures as runtime roots', async () => {
    const guardMod = await import('../../scripts/guard-harness-contract.mjs')

    const roots = guardMod.collectManagedRuntimeScriptRoots(process.cwd(), [
      'tests/int/github-comment-projection.int.spec.ts',
      'tests/fixtures/agent-issue',
    ])

    expect(roots).toEqual([])
  })

  it('fails closed for a missing managed runtime source', async () => {
    const guardMod = await import('../../scripts/guard-harness-contract.mjs')
    const tempRoot = mkdtempSync(join(tmpdir(), 'bemoat-182-missing-source-'))

    try {
      const violations = guardMod.scanManagedRuntimeDeliveryClosure({
        root: tempRoot,
        managedPaths: ['scripts/github-comment-projection.mjs'],
      })

      expect(violations).toEqual([
        {
          type: 'missing-managed-runtime-source',
          importer: 'managedPaths',
          callee: 'scripts/github-comment-projection.mjs',
          specifier: 'scripts/github-comment-projection.mjs',
        },
      ])
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('fails closed for a missing relative runtime dependency', async () => {
    const guardMod = await import('../../scripts/guard-harness-contract.mjs')
    const tempRoot = mkdtempSync(join(tmpdir(), 'bemoat-182-missing-relative-'))

    try {
      mkdirSync(join(tempRoot, 'scripts'), { recursive: true })
      writeFileSync(
        join(tempRoot, 'scripts/importer.mjs'),
        "import { projectComments } from './missing-projection.mjs'\n",
      )

      const violations = guardMod.scanManagedRuntimeDeliveryClosure({
        root: tempRoot,
        managedPaths: ['scripts/importer.mjs'],
      })

      expect(violations).toEqual([
        {
          type: 'missing-relative-runtime-dependency',
          importer: 'scripts/importer.mjs',
          callee: 'scripts/missing-projection.mjs',
          specifier: './missing-projection.mjs',
        },
      ])
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('fails closed for a renamed dependency still referenced by a managed importer', async () => {
    const guardMod = await import('../../scripts/guard-harness-contract.mjs')
    const tempRoot = mkdtempSync(join(tmpdir(), 'bemoat-182-renamed-'))

    try {
      mkdirSync(join(tempRoot, 'scripts'), { recursive: true })
      writeFileSync(
        join(tempRoot, 'scripts/importer.mjs'),
        "import { projectComments } from './github-comment-projection.mjs'\n",
      )
      writeFileSync(join(tempRoot, 'scripts/github-comment-projection-renamed.mjs'), 'export {}\n')

      const violations = guardMod.scanManagedRuntimeDeliveryClosure({
        root: tempRoot,
        managedPaths: ['scripts/importer.mjs', 'scripts/github-comment-projection.mjs'],
      })

      expect(violations).toEqual([
        {
          type: 'missing-managed-runtime-source',
          importer: 'managedPaths',
          callee: 'scripts/github-comment-projection.mjs',
          specifier: 'scripts/github-comment-projection.mjs',
        },
        {
          type: 'missing-relative-runtime-dependency',
          importer: 'scripts/importer.mjs',
          callee: 'scripts/github-comment-projection.mjs',
          specifier: './github-comment-projection.mjs',
        },
      ])
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('fails closed for a deleted callee still referenced by a managed importer', async () => {
    const guardMod = await import('../../scripts/guard-harness-contract.mjs')
    const tempRoot = mkdtempSync(join(tmpdir(), 'bemoat-182-deleted-'))

    try {
      mkdirSync(join(tempRoot, 'scripts'), { recursive: true })
      writeFileSync(
        join(tempRoot, 'scripts/post-role-comment.mjs'),
        "import { projectComments } from './github-comment-projection.mjs'\n",
      )

      const violations = guardMod.scanManagedRuntimeDeliveryClosure({
        root: tempRoot,
        managedPaths: ['scripts/post-role-comment.mjs', 'scripts/github-comment-projection.mjs'],
      })

      expect(violations).toEqual([
        {
          type: 'missing-managed-runtime-source',
          importer: 'managedPaths',
          callee: 'scripts/github-comment-projection.mjs',
          specifier: 'scripts/github-comment-projection.mjs',
        },
        {
          type: 'missing-relative-runtime-dependency',
          importer: 'scripts/post-role-comment.mjs',
          callee: 'scripts/github-comment-projection.mjs',
          specifier: './github-comment-projection.mjs',
        },
      ])
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('fails closed for a newly introduced unmanaged relative runtime dependency', async () => {
    const guardMod = await import('../../scripts/guard-harness-contract.mjs')
    const tempRoot = mkdtempSync(join(tmpdir(), 'bemoat-182-unmanaged-'))

    try {
      mkdirSync(join(tempRoot, 'scripts'), { recursive: true })
      writeFileSync(
        join(tempRoot, 'scripts/github-comment-projection.mjs'),
        "import { helper } from './unmanaged-helper.mjs'\nexport const projectComments = () => []\n",
      )
      writeFileSync(join(tempRoot, 'scripts/unmanaged-helper.mjs'), 'export const helper = 1\n')

      const violations = guardMod.scanManagedRuntimeDeliveryClosure({
        root: tempRoot,
        managedPaths: ['scripts/github-comment-projection.mjs'],
      })

      expect(violations).toEqual([
        {
          type: 'unmanaged-relative-runtime-dependency',
          importer: 'scripts/github-comment-projection.mjs',
          callee: 'scripts/unmanaged-helper.mjs',
          specifier: './unmanaged-helper.mjs',
        },
      ])
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('sorts violations deterministically by importer, type, callee, and specifier', async () => {
    const guardMod = await import('../../scripts/guard-harness-contract.mjs')
    const tempRoot = mkdtempSync(join(tmpdir(), 'bemoat-182-sorted-'))

    try {
      mkdirSync(join(tempRoot, 'scripts'), { recursive: true })
      writeFileSync(join(tempRoot, 'scripts/a.mjs'), "import './z.mjs'\n")
      writeFileSync(join(tempRoot, 'scripts/b.mjs'), "import './y.mjs'\n")

      const violations = guardMod.scanManagedRuntimeDeliveryClosure({
        root: tempRoot,
        managedPaths: ['scripts/a.mjs', 'scripts/b.mjs', 'scripts/z.mjs'],
      })

      expect(violations.map((entry: { importer: string }) => entry.importer)).toEqual([
        'managedPaths',
        'scripts/a.mjs',
        'scripts/b.mjs',
      ])
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })
})
