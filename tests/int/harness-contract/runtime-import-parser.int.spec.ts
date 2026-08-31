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

async function loadParser() {
  return import('../../../scripts/harness-contract/runtime-import-parser.ts')
}

describe('harness-contract runtime-import-parser', () => {
  it('parses static import … from specifiers', async () => {
    const mod = await loadParser()

    expect(mod.parseRuntimeImportSpecifiers("import value, { helper } from './hidden.mjs'\n")).toEqual({
      specifiers: [{ specifier: './hidden.mjs', sourceExpression: './hidden.mjs' }],
      unverifiable: [],
    })
  })

  it('parses export … from re-exports', async () => {
    const mod = await loadParser()

    expect(mod.parseRuntimeImportSpecifiers("export { helper } from './leaf.mjs'\n")).toEqual({
      specifiers: [{ specifier: './leaf.mjs', sourceExpression: './leaf.mjs' }],
      unverifiable: [],
    })
  })

  it.each(VERIFIABLE_DYNAMIC_IMPORT_CASES)(
    'classifies %s dynamic imports as verifiable',
    async (_label, invocation, specifier) => {
      const mod = await loadParser()
      const parsed = mod.parseRuntimeImportSpecifiers(`const module = await ${invocation}\n`)

      expect(parsed.specifiers).toEqual([{ specifier, sourceExpression: invocation }])
      expect(parsed.unverifiable).toEqual([])
    },
  )

  it.each(UNVERIFIABLE_DYNAMIC_IMPORT_CASES)(
    'fails closed for %s dynamic imports',
    async (_label, invocation, sourceExpression) => {
      const mod = await loadParser()
      const parsed = mod.parseRuntimeImportSpecifiers(`const module = await ${invocation}\n`)

      expect(parsed.specifiers).toEqual([])
      expect(parsed.unverifiable).toEqual([{ specifier: sourceExpression, sourceExpression }])
    },
  )

  it.each(DYNAMIC_IMPORT_KEYWORD_GAP_CASES)(
    'parses literal and computed imports across a %s keyword gap',
    async (_label, gap, normalizedGap) => {
      const mod = await loadParser()
      const literalSourceExpression = `import${normalizedGap}('./leaf.mjs')`
      const computedSourceExpression = `import${normalizedGap}(prefix + './leaf.mjs')`

      const parsed = mod.parseRuntimeImportSpecifiers(
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
    },
  )

  it('preserves baseline regex behavior for import-like text in comments', async () => {
    const mod = await loadParser()

    // Regex-based parsing can still observe import-like text inside comments.
    // Slice 2 preserves that baseline rather than inventing comment stripping.
    expect(
      mod.parseRuntimeImportSpecifiers(
        "// import('./hidden.mjs')\n/* import('./hidden.mjs') */\nexport const ok = 1\n",
      ),
    ).toEqual({
      specifiers: [
        { specifier: './hidden.mjs', sourceExpression: "import('./hidden.mjs')" },
        { specifier: './hidden.mjs', sourceExpression: "import('./hidden.mjs')" },
      ],
      unverifiable: [],
    })
  })

  it('rejects escaped strings inside dynamic import literals as unverifiable', async () => {
    const mod = await loadParser()

    expect(mod.parseRuntimeImportSpecifiers("const bad = await import('foo\\'bar')\n")).toEqual({
      specifiers: [],
      unverifiable: [
        {
          specifier: "import('foo\\'bar')",
          sourceExpression: "import('foo\\'bar')",
        },
      ],
    })
  })

  it('collects static imports, then export-from, then dynamic imports rather than source order', async () => {
    const mod = await loadParser()

    expect(
      mod.parseRuntimeImportSpecifiers(
        "const d = await import('./dyn.mjs')\nimport s from './stat.mjs'\nexport { x } from './exp.mjs'\n",
      ),
    ).toEqual({
      specifiers: [
        { specifier: './stat.mjs', sourceExpression: './stat.mjs' },
        { specifier: './exp.mjs', sourceExpression: './exp.mjs' },
        { specifier: './dyn.mjs', sourceExpression: "import('./dyn.mjs')" },
      ],
      unverifiable: [],
    })
  })

  it('parses side-effect imports, import type, export *, and export * as', async () => {
    const mod = await loadParser()

    expect(mod.parseRuntimeImportSpecifiers("import './side.mjs'\n")).toEqual({
      specifiers: [{ specifier: './side.mjs', sourceExpression: './side.mjs' }],
      unverifiable: [],
    })
    expect(mod.parseRuntimeImportSpecifiers("import type { X } from './t.mjs'\n")).toEqual({
      specifiers: [{ specifier: './t.mjs', sourceExpression: './t.mjs' }],
      unverifiable: [],
    })
    expect(mod.parseRuntimeImportSpecifiers("export * from './star.mjs'\n")).toEqual({
      specifiers: [{ specifier: './star.mjs', sourceExpression: './star.mjs' }],
      unverifiable: [],
    })
    expect(mod.parseRuntimeImportSpecifiers("export * as ns from './star-as.mjs'\n")).toEqual({
      specifiers: [{ specifier: './star-as.mjs', sourceExpression: './star-as.mjs' }],
      unverifiable: [],
    })
    expect(mod.parseRuntimeImportSpecifiers("export { default } from './x.mjs'\n")).toEqual({
      specifiers: [{ specifier: './x.mjs', sourceExpression: './x.mjs' }],
      unverifiable: [],
    })
  })

  it('does not observe export type { } from re-exports', async () => {
    const mod = await loadParser()

    expect(mod.parseRuntimeImportSpecifiers("export type { Bar } from './y.mjs'\n")).toEqual({
      specifiers: [],
      unverifiable: [],
    })
  })

  it('treats whitespace-padded exact dynamic import literals as verifiable', async () => {
    const mod = await loadParser()

    expect(mod.parseRuntimeImportSpecifiers("const m = await import( './leaf.mjs' )\n")).toEqual({
      specifiers: [
        { specifier: './leaf.mjs', sourceExpression: "import( './leaf.mjs' )" },
      ],
      unverifiable: [],
    })
  })

  it('ignores empty content and import.meta, and fails closed for unclosed dynamic imports', async () => {
    const mod = await loadParser()

    expect(mod.parseRuntimeImportSpecifiers('')).toEqual({ specifiers: [], unverifiable: [] })
    expect(mod.parseRuntimeImportSpecifiers('const u = import.meta.url\n')).toEqual({
      specifiers: [],
      unverifiable: [],
    })
    expect(mod.parseRuntimeImportSpecifiers("const m = await import('./x.mjs'")).toEqual({
      specifiers: [],
      unverifiable: [
        {
          specifier: "import('./x.mjs'",
          sourceExpression: "import('./x.mjs'",
        },
      ],
    })
  })
})
