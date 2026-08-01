import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, normalize, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

type ImportGraph = Map<string, Set<string>>

const BASELINE_CYCLE_NODES = new Set([
  'scripts/agent-issue.mjs',
  'scripts/agent-issue/correction-pr-reconciliation.mjs',
  'scripts/agent-issue/correction-preflight.mjs',
  'scripts/agent-issue/github-evidence.mjs',
  'scripts/agent-issue/historical-review3-authority.mjs',
  'scripts/agent-issue/issue-preflight.mjs',
  'scripts/agent-issue/progress-tracking.mjs',
  'scripts/github-comment-projection.mjs',
  'scripts/mission-control-reconcile.mjs',
])

const BASELINE_CYCLE_EDGES = new Set([
  'scripts/agent-issue.mjs -> scripts/agent-issue/issue-preflight.mjs',
  'scripts/agent-issue.mjs -> scripts/agent-issue/progress-tracking.mjs',
  'scripts/agent-issue/correction-pr-reconciliation.mjs -> scripts/agent-issue/github-evidence.mjs',
  'scripts/agent-issue/correction-preflight.mjs -> scripts/agent-issue/correction-pr-reconciliation.mjs',
  'scripts/agent-issue/correction-preflight.mjs -> scripts/agent-issue/github-evidence.mjs',
  'scripts/agent-issue/correction-preflight.mjs -> scripts/agent-issue/historical-review3-authority.mjs',
  'scripts/agent-issue/correction-preflight.mjs -> scripts/mission-control-reconcile.mjs',
  'scripts/agent-issue/github-evidence.mjs -> scripts/github-comment-projection.mjs',
  'scripts/agent-issue/historical-review3-authority.mjs -> scripts/mission-control-reconcile.mjs',
  'scripts/agent-issue/issue-preflight.mjs -> scripts/agent-issue/correction-preflight.mjs',
  'scripts/agent-issue/issue-preflight.mjs -> scripts/agent-issue/github-evidence.mjs',
  'scripts/agent-issue/issue-preflight.mjs -> scripts/agent-issue/progress-tracking.mjs',
  'scripts/agent-issue/progress-tracking.mjs -> scripts/agent-issue/github-evidence.mjs',
  'scripts/agent-issue/progress-tracking.mjs -> scripts/mission-control-reconcile.mjs',
  'scripts/github-comment-projection.mjs -> scripts/mission-control-reconcile.mjs',
  'scripts/mission-control-reconcile.mjs -> scripts/agent-issue.mjs',
])

const ADAPTER_PATH = 'scripts/adapters/command-runner.mjs'
const ADAPTER_IMPORTERS = new Set([
  'scripts/command-runner.mjs',
  'scripts/mission-control-review.mjs',
])

const FROM_RE = /\bfrom\s+['"](\.\.?\/[^'"]+\.mjs)['"]/g
const DYNAMIC_RE = /\bimport\s*\(\s*['"](\.\.?\/[^'"]+\.mjs)['"]\s*\)/g

function listMjsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const absolutePath = join(dir, entry)
    const stat = statSync(absolutePath)
    if (stat.isDirectory()) {
      listMjsFiles(absolutePath, out)
      continue
    }
    if (entry.endsWith('.mjs')) out.push(absolutePath)
  }
  return out
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function toRepoPath(root: string, absolutePath: string): string {
  return relative(root, absolutePath).split('\\').join('/')
}

function extractRelativeSpecs(source: string): string[] {
  const specs: string[] = []
  const cleaned = stripComments(source)
  for (const pattern of [FROM_RE, DYNAMIC_RE]) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(cleaned))) {
      specs.push(match[1])
    }
  }
  return specs
}

function buildScriptImportGraph(root: string): ImportGraph {
  const scriptsRoot = join(root, 'scripts')
  const graph: ImportGraph = new Map()

  for (const absolutePath of listMjsFiles(scriptsRoot)) {
    const importer = toRepoPath(root, absolutePath)
    if (!graph.has(importer)) graph.set(importer, new Set())

    const specs = extractRelativeSpecs(readFileSync(absolutePath, 'utf8'))
    for (const spec of specs) {
      const targetAbsolute = normalize(resolve(dirname(absolutePath), spec))
      if (!existsSync(targetAbsolute)) continue
      const target = toRepoPath(root, targetAbsolute)
      if (target === importer) continue
      graph.get(importer)!.add(target)
      if (!graph.has(target)) graph.set(target, new Set())
    }
  }

  return graph
}

function findStronglyConnectedComponents(graph: ImportGraph): string[][] {
  let nextIndex = 0
  const indices = new Map<string, number>()
  const lowlink = new Map<string, number>()
  const stack: string[] = []
  const onStack = new Set<string>()
  const components: string[][] = []

  function strongConnect(vertex: string) {
    indices.set(vertex, nextIndex)
    lowlink.set(vertex, nextIndex)
    nextIndex += 1
    stack.push(vertex)
    onStack.add(vertex)

    for (const neighbor of graph.get(vertex) ?? []) {
      if (!indices.has(neighbor)) {
        strongConnect(neighbor)
        lowlink.set(vertex, Math.min(lowlink.get(vertex)!, lowlink.get(neighbor)!))
      } else if (onStack.has(neighbor)) {
        lowlink.set(vertex, Math.min(lowlink.get(vertex)!, indices.get(neighbor)!))
      }
    }

    if (lowlink.get(vertex) === indices.get(vertex)) {
      const component: string[] = []
      let member: string | undefined
      do {
        member = stack.pop()
        if (!member) break
        onStack.delete(member)
        component.push(member)
      } while (member !== vertex)
      components.push(component.sort())
    }
  }

  for (const vertex of [...graph.keys()].sort()) {
    if (!indices.has(vertex)) strongConnect(vertex)
  }

  return components
}

function collectInternalEdges(graph: ImportGraph, component: ReadonlySet<string>): Set<string> {
  const edges = new Set<string>()
  for (const importer of component) {
    for (const target of graph.get(importer) ?? []) {
      if (component.has(target)) {
        edges.add(`${importer} -> ${target}`)
      }
    }
  }
  return edges
}

describe('scripts architecture ratchet', () => {
  it('rejects new or expanded dependency cycles beyond the recorded nine-node baseline', () => {
    const graph = buildScriptImportGraph(process.cwd())

    for (const component of findStronglyConnectedComponents(graph)) {
      if (component.length < 2) continue

      expect(component.every((path) => BASELINE_CYCLE_NODES.has(path))).toBe(true)

      const edges = collectInternalEdges(graph, new Set(component))
      for (const edge of edges) {
        expect(BASELINE_CYCLE_EDGES.has(edge)).toBe(true)
      }
    }
  })

  it('keeps the CommandRunner adapter free of repository imports and limited to the allowlisted importers', () => {
    const graph = buildScriptImportGraph(process.cwd())
    const adapterAbsolute = join(process.cwd(), ADAPTER_PATH)

    expect(existsSync(adapterAbsolute)).toBe(true)
    expect([...(graph.get(ADAPTER_PATH) ?? [])]).toEqual([])

    const importers = [...graph.entries()]
      .filter(([, targets]) => targets.has(ADAPTER_PATH))
      .map(([importer]) => importer)
      .sort()

    expect(importers).toEqual([...ADAPTER_IMPORTERS].sort())
  })
})
