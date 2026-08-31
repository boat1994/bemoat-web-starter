import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const VERIFIABLE_DYNAMIC_IMPORT_CASES = [
  ["single-quoted literal", "import('./leaf.mjs')", './leaf.mjs'],
  ['double-quoted literal', 'import("./leaf.mjs")', './leaf.mjs'],
  ['substitution-free template literal', 'import(`./leaf.mjs`)', './leaf.mjs'],
] as const

const UNVERIFIABLE_DYNAMIC_IMPORT_CASES = [
  ['identifier', 'import(specifier)', 'import(specifier)'],
  ['left literal concatenation', "import('./hidden' + suffix)", "import('./hidden' + suffix)"],
  ['right literal concatenation', "import(prefix + './hidden')", "import(prefix + './hidden')"],
  ['concat call with one argument', "import('./hidden'.concat('.mjs'))", "import('./hidden'.concat('.mjs'))"],
  [
    'concat call with multiple arguments',
    "import('./hidden'.concat('.mjs', suffix))",
    "import('./hidden'.concat('.mjs', suffix))",
  ],
  ['interpolated template', 'import(`./hidden/${name}.mjs`)', 'import(`./hidden/${name}.mjs`)'],
  [
    'interpolated template concatenated on the left',
    "import(`./hidden/${name}` + '.mjs')",
    "import(`./hidden/${name}` + '.mjs')",
  ],
  [
    'interpolated template concatenated on the right',
    "import('./hidden/' + `${name}.mjs`)",
    "import('./hidden/' + `${name}.mjs`)",
  ],
  [
    'conditional expression',
    "import(condition ? './present.mjs' : './hidden.mjs')",
    "import(condition ? './present.mjs' : './hidden.mjs')",
  ],
  ['function call', 'import(resolveSpecifier())', 'import(resolveSpecifier())'],
  ['parenthesized expression', "import(('./hidden.mjs'))", "import(('./hidden.mjs'))"],
  [
    'multiline computed expression',
    "import(\n  prefix +\n  '.mjs'\n)",
    "import( prefix + '.mjs' )",
  ],
] as const

const DYNAMIC_IMPORT_KEYWORD_GAP_CASES = [
  ['block comment', ' /* gap */ ', ' /* gap */ '],
  ['multiline block comment', ' /* multiline\n    gap */ ', ' /* multiline gap */ '],
  ['line comment', ' // gap\n    ', ' // gap '],
] as const

describe('harness contract guard', () => {
  it('exports child-facing paths and forbidden raw scripts', async () => {
    const mod = await import('../../scripts/guard-harness-contract.ts')

    expect(mod.CHILD_FACING_HARNESS_PATHS).toContain('.github/workflows/ci.yml')
    expect(mod.CHILD_FACING_HARNESS_PATHS).toContain('.githooks/pre-commit')
    expect(mod.CHILD_FACING_HARNESS_PATHS).toContain('.githooks/pre-push')
    expect(mod.FORBIDDEN_RAW_SCRIPTS).toContain('lint')
    expect(mod.FORBIDDEN_RAW_SCRIPTS).toContain('build')
    expect(mod.FORBIDDEN_RAW_SCRIPTS).not.toContain('bemoat:guard:safety')
  })

  it('detects forbidden raw script calls in harness content', async () => {
    const mod = await import('../../scripts/guard-harness-contract.ts')

    const violations = mod.scanChildFacingHarnessFile(
      '.github/workflows/ci.yml',
      'run: pnpm run lint\nrun: pnpm run bemoat:guard:safety',
    )

    expect(violations).toHaveLength(1)
    expect(violations[0].rule).toBe('lint')
  })

  it('passes when only bemoat:* scripts are called', async () => {
    const mod = await import('../../scripts/guard-harness-contract.ts')

    const violations = mod.runHarnessContractGuard({
      root: process.cwd(),
      readFile: (filePath) => readFileSync(filePath, 'utf8'),
    })

    expect(violations).toEqual([])
    expect(mod.getHarnessContractExitCode(violations)).toBe(0)
  })

  it('is listed in managedPaths for boilerplate sync', async () => {
    const syncMod = await import('../../scripts/sync-boilerplate.ts')

    expect(syncMod.managedPaths).toContain('scripts/check-branch-safety.sh')
    expect(syncMod.managedPaths).toContain('scripts/guard-harness-contract.ts')
    expect(syncMod.managedPaths).toContain('scripts/harness-contract')
    expect(syncMod.managedPaths).toContain('tests/int/harness-contract/facade-exports.int.spec.ts')
    expect(syncMod.managedPaths).toContain('scripts/guards/legacy-managed-state.ts')
    expect(syncMod.managedPackageScripts).toContain('bemoat:branch:check')
    expect(syncMod.managedPackageScripts).toContain('bemoat:guard:harness-contract')
  })
})

describe('harness contract guard on disk', () => {
  it('validates synced CI workflow and hooks', async () => {
    const mod = await import('../../scripts/guard-harness-contract.ts')

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
  it('passes the live starter managed runtime closure', async () => {
    const guardMod = await import('../../scripts/guard-harness-contract.ts')
    const syncMod = await import('../../scripts/sync-boilerplate.ts')

    const violations = guardMod.scanManagedRuntimeDeliveryClosure({
      root: process.cwd(),
      managedPaths: syncMod.managedPaths,
    })

    expect(violations).toEqual([])
    expect(
      guardMod.formatManagedRuntimeDeliveryViolations(violations),
    ).toEqual(['Harness contract guard passed.'])
  })

  it('ignores Node built-ins and package imports', async () => {
    const guardMod = await import('../../scripts/guard-harness-contract.ts')

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

  it('parses combined static imports and literal dynamic imports', async () => {
    const guardMod = await import('../../scripts/guard-harness-contract.ts')

    const combined = guardMod.parseRuntimeImportSpecifiers(
      "import value, { helper } from './hidden.mjs'\n",
    )
    expect(combined.specifiers).toEqual([
      { specifier: './hidden.mjs', sourceExpression: './hidden.mjs' },
    ])
    expect(combined.unverifiable).toEqual([])

    const literalDynamic = guardMod.parseRuntimeImportSpecifiers(
      "const ok = await import('./leaf.mjs')\n",
    )
    expect(literalDynamic.specifiers).toEqual([
      { specifier: './leaf.mjs', sourceExpression: "import('./leaf.mjs')" },
    ])
    expect(literalDynamic.unverifiable).toEqual([])
  })

  it('classifies computed template and concatenated dynamic imports as unverifiable', async () => {
    const guardMod = await import('../../scripts/guard-harness-contract.ts')

    const template = guardMod.parseRuntimeImportSpecifiers(
      'const bad = await import(`./hidden/${name}.mjs`)\n',
    )
    expect(template.specifiers).toEqual([])
    expect(template.unverifiable).toEqual([
      {
        specifier: 'import(`./hidden/${name}.mjs`)',
        sourceExpression: 'import(`./hidden/${name}.mjs`)',
      },
    ])

    const concatenated = guardMod.parseRuntimeImportSpecifiers(
      "const bad = await import('./hidden' + '.mjs')\n",
    )
    expect(concatenated.specifiers).toEqual([])
    expect(concatenated.unverifiable).toEqual([
      {
        specifier: "import('./hidden' + '.mjs')",
        sourceExpression: "import('./hidden' + '.mjs')",
      },
    ])
  })

  it.each(VERIFIABLE_DYNAMIC_IMPORT_CASES)(
    'classifies %s dynamic imports as verifiable',
    async (_label, invocation, specifier) => {
      const guardMod = await import('../../scripts/guard-harness-contract.ts')

      const parsed = guardMod.parseRuntimeImportSpecifiers(`const module = await ${invocation}\n`)

      expect(parsed.specifiers).toEqual([{ specifier, sourceExpression: invocation }])
      expect(parsed.unverifiable).toEqual([])
    },
  )

  it.each(UNVERIFIABLE_DYNAMIC_IMPORT_CASES)(
    'fails closed once with deterministic diagnostics for %s dynamic imports',
    async (_label, invocation, sourceExpression) => {
      const guardMod = await import('../../scripts/guard-harness-contract.ts')
      const tempRoot = mkdtempSync(join(tmpdir(), 'bemoat-182-exhaustive-dynamic-import-'))

      try {
        mkdirSync(join(tempRoot, 'scripts'), { recursive: true })
        writeFileSync(join(tempRoot, 'scripts/root.mjs'), `const module = await ${invocation}\n`)

        const parsed = guardMod.parseRuntimeImportSpecifiers(`const module = await ${invocation}\n`)
        expect(parsed.specifiers).toEqual([])
        expect(parsed.unverifiable).toEqual([{ specifier: sourceExpression, sourceExpression }])

        const violations = guardMod.scanManagedRuntimeDeliveryClosure({
          root: tempRoot,
          managedPaths: ['scripts/root.mjs'],
        })

        expect(violations).toEqual([
          {
            type: 'unverifiable-dynamic-runtime-import',
            importer: 'scripts/root.mjs',
            callee: '<unresolved>',
            specifier: sourceExpression,
          },
        ])
        expect(guardMod.formatManagedRuntimeDeliveryViolations(violations)).toEqual([
          'Harness contract guard failed:',
          '',
          'Managed runtime delivery closure must resolve only managed local dependencies.',
          'See docs/harness-sync-contract.md.',
          '',
          `- [unverifiable-dynamic-runtime-import] importer="scripts/root.mjs" -> callee="<unresolved>" specifier="${sourceExpression}"`,
        ])
      } finally {
        rmSync(tempRoot, { recursive: true, force: true })
      }
    },
  )

  it.each(DYNAMIC_IMPORT_KEYWORD_GAP_CASES)(
    'classifies literal and computed imports once across a %s keyword gap',
    async (_label, gap, normalizedGap) => {
      const guardMod = await import('../../scripts/guard-harness-contract.ts')
      const tempRoot = mkdtempSync(join(tmpdir(), 'bemoat-182-comment-gap-dynamic-import-'))
      const literalSourceExpression = `import${normalizedGap}('./leaf.mjs')`
      const computedSourceExpression = `import${normalizedGap}(prefix + './leaf.mjs')`

      try {
        mkdirSync(join(tempRoot, 'scripts'), { recursive: true })
        writeFileSync(
          join(tempRoot, 'scripts/root.mjs'),
          `const literal = await import${gap}('./leaf.mjs')\nconst computed = await import${gap}(prefix + './leaf.mjs')\n`,
        )
        writeFileSync(join(tempRoot, 'scripts/leaf.mjs'), 'export const value = 1\n')

        const parsed = guardMod.parseRuntimeImportSpecifiers(
          `const literal = await import${gap}('./leaf.mjs')\nconst computed = await import${gap}(prefix + './leaf.mjs')\n`,
        )

        expect(parsed.specifiers).toEqual([
          { specifier: './leaf.mjs', sourceExpression: literalSourceExpression },
        ])
        expect(parsed.unverifiable).toEqual([
          {
            specifier: computedSourceExpression,
            sourceExpression: computedSourceExpression,
          },
        ])
        expect(parsed.specifiers).toHaveLength(1)
        expect(parsed.unverifiable).toHaveLength(1)

        const violations = guardMod.scanManagedRuntimeDeliveryClosure({
          root: tempRoot,
          managedPaths: ['scripts/root.mjs', 'scripts/leaf.mjs'],
        })

        expect(violations).toEqual([
          {
            type: 'unverifiable-dynamic-runtime-import',
            importer: 'scripts/root.mjs',
            callee: '<unresolved>',
            specifier: computedSourceExpression,
          },
        ])
      } finally {
        rmSync(tempRoot, { recursive: true, force: true })
      }
    },
  )

  it('classifies multiple comment-separated dynamic imports exactly once', async () => {
    const guardMod = await import('../../scripts/guard-harness-contract.ts')
    const parsed = guardMod.parseRuntimeImportSpecifiers(
      "const a = import /* gap */ ('./a.mjs'); const b = import /* multiline\n gap */ (name); const c = import // gap\n (`./c.mjs`)\n",
    )

    expect(parsed.specifiers).toEqual([
      { specifier: './a.mjs', sourceExpression: "import /* gap */ ('./a.mjs')" },
      { specifier: './c.mjs', sourceExpression: 'import // gap (`./c.mjs`)' },
    ])
    expect(parsed.unverifiable).toEqual([
      {
        specifier: 'import /* multiline gap */ (name)',
        sourceExpression: 'import /* multiline gap */ (name)',
      },
    ])
    expect(parsed.specifiers).toHaveLength(2)
    expect(parsed.unverifiable).toHaveLength(1)
  })

  it('fails closed for combined static imports to unmanaged callees', async () => {
    const guardMod = await import('../../scripts/guard-harness-contract.ts')
    const tempRoot = mkdtempSync(join(tmpdir(), 'bemoat-182-combined-static-'))

    try {
      mkdirSync(join(tempRoot, 'scripts'), { recursive: true })
      writeFileSync(
        join(tempRoot, 'scripts/importer.mjs'),
        "import value, { helper } from './hidden.mjs'\n",
      )
      writeFileSync(join(tempRoot, 'scripts/hidden.mjs'), 'export const value = 1\nexport const helper = 2\n')

      const violations = guardMod.scanManagedRuntimeDeliveryClosure({
        root: tempRoot,
        managedPaths: ['scripts/importer.mjs'],
      })

      expect(violations).toEqual([
        {
          type: 'unmanaged-relative-runtime-dependency',
          importer: 'scripts/importer.mjs',
          callee: 'scripts/hidden.mjs',
          specifier: './hidden.mjs',
        },
      ])
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('fails closed for template-interpolated dynamic imports', async () => {
    const guardMod = await import('../../scripts/guard-harness-contract.ts')
    const tempRoot = mkdtempSync(join(tmpdir(), 'bemoat-182-template-dynamic-'))

    try {
      mkdirSync(join(tempRoot, 'scripts'), { recursive: true })
      writeFileSync(
        join(tempRoot, 'scripts/root.mjs'),
        'const bad = await import(`./hidden/${name}.mjs`)\n',
      )

      const violations = guardMod.scanManagedRuntimeDeliveryClosure({
        root: tempRoot,
        managedPaths: ['scripts/root.mjs'],
      })

      expect(violations).toEqual([
        {
          type: 'unverifiable-dynamic-runtime-import',
          importer: 'scripts/root.mjs',
          callee: '<unresolved>',
          specifier: 'import(`./hidden/${name}.mjs`)',
        },
      ])
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('fails closed for concatenated dynamic imports', async () => {
    const guardMod = await import('../../scripts/guard-harness-contract.ts')
    const tempRoot = mkdtempSync(join(tmpdir(), 'bemoat-182-concat-dynamic-'))

    try {
      mkdirSync(join(tempRoot, 'scripts'), { recursive: true })
      writeFileSync(
        join(tempRoot, 'scripts/root.mjs'),
        "const bad = await import('./hidden' + '.mjs')\n",
      )

      const violations = guardMod.scanManagedRuntimeDeliveryClosure({
        root: tempRoot,
        managedPaths: ['scripts/root.mjs'],
      })

      expect(violations).toEqual([
        {
          type: 'unverifiable-dynamic-runtime-import',
          importer: 'scripts/root.mjs',
          callee: '<unresolved>',
          specifier: "import('./hidden' + '.mjs')",
        },
      ])
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('fails closed when the Context review parser is missing from managed delivery', async () => {
    const guardMod = await import('../../scripts/guard-harness-contract.ts')
    const tempRoot = mkdtempSync(join(tmpdir(), 'bemoat-182-missing-context-review-parser-'))

    try {
      mkdirSync(join(tempRoot, 'scripts/context'), { recursive: true })
      writeFileSync(
        join(tempRoot, 'scripts/agent-context.ts'),
        "import { parseProductionMergeReviewVerdict } from './context/merge-review-verdict.ts'\nexport {}\n",
      )

      const violations = guardMod.scanManagedRuntimeDeliveryClosure({
        root: tempRoot,
        managedPaths: ['scripts/agent-context.ts', 'scripts/context/merge-review-verdict.ts'],
      })

      expect(violations).toEqual([
        {
          type: 'missing-managed-runtime-source',
          importer: 'managedPaths',
          callee: 'scripts/context/merge-review-verdict.ts',
          specifier: 'scripts/context/merge-review-verdict.ts',
        },
        {
          type: 'missing-relative-runtime-dependency',
          importer: 'scripts/agent-context.ts',
          callee: 'scripts/context/merge-review-verdict.ts',
          specifier: './context/merge-review-verdict.ts',
        },
      ])
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('traverses literal dynamic imports and rejects computed dynamic imports', async () => {
    const guardMod = await import('../../scripts/guard-harness-contract.ts')
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
    const guardMod = await import('../../scripts/guard-harness-contract.ts')

    const roots = guardMod.collectManagedRuntimeScriptRoots(process.cwd(), [
      'tests/int/context-parser.int.spec.ts',
    ])

    expect(roots).toEqual([])
  })

  it('fails closed for a missing managed runtime source', async () => {
    const guardMod = await import('../../scripts/guard-harness-contract.ts')
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
    const guardMod = await import('../../scripts/guard-harness-contract.ts')
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
    const guardMod = await import('../../scripts/guard-harness-contract.ts')
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
    const guardMod = await import('../../scripts/guard-harness-contract.ts')
    const tempRoot = mkdtempSync(join(tmpdir(), 'bemoat-182-deleted-'))

    try {
      mkdirSync(join(tempRoot, 'scripts'), { recursive: true })
      writeFileSync(
        join(tempRoot, 'scripts/importer.mjs'),
        "import { projectComments } from './github-comment-projection.mjs'\n",
      )

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

  it('fails closed for a newly introduced unmanaged relative runtime dependency', async () => {
    const guardMod = await import('../../scripts/guard-harness-contract.ts')
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
    const guardMod = await import('../../scripts/guard-harness-contract.ts')
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
