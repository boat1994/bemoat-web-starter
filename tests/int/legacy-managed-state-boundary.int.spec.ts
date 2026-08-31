import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'
import ts from 'typescript'

const domainPath = resolve(process.cwd(), 'scripts/guards/legacy-managed-state.ts')
const canonicalDomainPath = resolve(process.cwd(), 'scripts/guards/legacy-managed-state.ts')
function listProductionScriptFiles(directory: string, files: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name)
    if (entry.isDirectory()) {
      listProductionScriptFiles(absolutePath, files)
    } else if (/\.(?:mjs|ts)$/.test(entry.name)) {
      files.push(absolutePath)
    }
  }
  return files
}

type ProductionImportEdge = {
  importer: string
  specifier: string
  target: string | null
}

function resolveProductionImport(
  importer: string,
  specifier: string,
  productionFiles: Set<string>,
): string | null {
  if (!specifier.startsWith('.')) return null

  const base = resolve(dirname(importer), specifier)
  const withoutSourceExtension = base.replace(/\.(?:js|mjs|ts)$/, '')
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.mjs`,
    `${withoutSourceExtension}.ts`,
    `${withoutSourceExtension}.mjs`,
    join(base, 'index.ts'),
    join(base, 'index.mjs'),
  ]
  return candidates.find((candidate) => productionFiles.has(candidate)) ?? null
}

function collectProductionImportEdges(): ProductionImportEdge[] {
  const productionFiles = new Set(
    listProductionScriptFiles(resolve(process.cwd(), 'scripts')),
  )
  const edges: ProductionImportEdge[] = []

  for (const importer of productionFiles) {
    const source = readFileSync(importer, 'utf8')
    const sourceFile = ts.createSourceFile(
      importer,
      source,
      ts.ScriptTarget.Latest,
      true,
      importer.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS,
    )

    function record(specifierNode: ts.StringLiteralLike) {
      const specifier = specifierNode.text
      edges.push({
        importer,
        specifier,
        target: resolveProductionImport(importer, specifier, productionFiles),
      })
    }

    function visit(node: ts.Node) {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        record(node.moduleSpecifier)
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        record(node.moduleSpecifier)
      } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
        const expression = node.moduleReference.expression
        if (expression && ts.isStringLiteral(expression)) record(expression)
      } else if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
        const expression = node.expression
        if (
          expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(expression) && expression.text === 'require')
        ) {
          record(node.arguments[0])
        }
      }
      ts.forEachChild(node, visit)
    }

    visit(sourceFile)
  }

  return edges
}

describe('legacy managed-state planning boundary', () => {
  it('retains only the read-only parser seam after managed-state compatibility cleanup', async () => {
    const domainTaskState = await import(/* @vite-ignore */ `file://${domainPath}`)
    const domainExports = domainTaskState as unknown as Record<string, unknown>

    expect(domainPath).toContain('scripts/guards/legacy-managed-state.ts')
    expect(domainExports.parseLegacyManagedStateIdentity).toBeTypeOf('function')
    expect(Object.keys(domainExports)).toEqual(['parseLegacyManagedStateIdentity'])
    expect(readFileSync(canonicalDomainPath, 'utf8')).not.toMatch(
      /(?:from|import|export)\s+[^\n]*(?:task-state-authorization|review-verdict-binding|transition-|comment-|coordinator|reconciliation|projection|authorization|counter|budget)/,
    )
    const canonicalTaskState = await import(/* @vite-ignore */ `file://${canonicalDomainPath}`)
    expect(canonicalTaskState.parseLegacyManagedStateIdentity)
      .toBe(domainExports.parseLegacyManagedStateIdentity)

    const parserConsumers = collectProductionImportEdges()
      .filter((edge) => edge.target === canonicalDomainPath)
      .map((edge) => relative(process.cwd(), edge.importer).split('\\').join('/'))
      .sort()
    expect(parserConsumers).toEqual(['scripts/guards/planning-contract-runtime.mjs'])

    const parserEdges = collectProductionImportEdges().filter(
      (edge) => edge.target === canonicalDomainPath,
    )
    expect(parserEdges).toHaveLength(1)
    expect(parserEdges[0]?.specifier).toBe('./legacy-managed-state.ts')

    const planningRuntime = resolve(process.cwd(), 'scripts/guards/planning-contract-runtime.mjs')
    const planningSource = ts.createSourceFile(
      planningRuntime,
      readFileSync(planningRuntime, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    )
    const parserBindings: string[] = []
    const parserCalls: ts.CallExpression[] = []
    function isIssueBody(node: ts.Node): boolean {
      return ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'issue' &&
        node.name.text === 'body'
    }

    function visitPlanning(node: ts.Node) {
      if (ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
        for (const element of node.importClause.namedBindings.elements) {
          if (element.name.text === 'parseLegacyManagedStateIdentity') parserBindings.push(element.name.text)
        }
      }
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'parseLegacyManagedStateIdentity' &&
        node.arguments.length === 1 &&
        ts.isBinaryExpression(node.arguments[0]) &&
        node.arguments[0].operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken &&
        isIssueBody(node.arguments[0].left) &&
        ts.isStringLiteral(node.arguments[0].right) &&
        node.arguments[0].right.text === ''
      ) {
        parserCalls.push(node)
      }
      ts.forEachChild(node, visitPlanning)
    }
    visitPlanning(planningSource)
    expect(parserBindings).toEqual(['parseLegacyManagedStateIdentity'])
    expect(parserCalls).toHaveLength(1)
  })

  it('fails closed for malformed marker/YAML input used by planning safety', async () => {
    const { parseLegacyManagedStateIdentity } = await import(/* @vite-ignore */ `file://${domainPath}`)

    expect(parseLegacyManagedStateIdentity('## MISSION_CONTROL_STATE\nstate: DONE')).toMatchObject({
      present: true,
      valid: false,
    })
    expect(parseLegacyManagedStateIdentity([
      '<!-- bemoat-mission-control-state:start -->',
      'schema_version: 1',
      'state: IN_PROGRESS',
      'state: DONE',
      '<!-- bemoat-mission-control-state:end -->',
    ].join('\n'))).toMatchObject({
      present: true,
      valid: false,
    })
    expect(parseLegacyManagedStateIdentity([
      '<!-- bemoat-mission-control-state:start -->',
      'schema_version: 1',
      'state: IN_PROGRESS',
      'active_task_issue: garbage',
      '<!-- bemoat-mission-control-state:end -->',
    ].join('\n'))).toMatchObject({
      present: true,
      valid: false,
    })
  })
})
