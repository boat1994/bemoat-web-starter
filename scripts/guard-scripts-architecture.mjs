#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, normalize, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export class ArchitectureContractError extends Error {
  constructor(violations) {
    super('Scripts architecture contract validation failed')
    this.name = 'ArchitectureContractError'
    this.violations = violations
  }
}

const FROM_RE = /\bfrom\s+['"](\.\.?\/[^'"]+\.mjs)['"]/g
const SIDE_EFFECT_IMPORT_RE = /\bimport\s+['"](\.\.?\/[^'"]+\.mjs)['"]/g
const DYNAMIC_RE = /\bimport\s*\(\s*['"](\.\.?\/[^'"]+\.mjs)['"]\s*\)/g

function listMjsFiles(dir, out = []) {
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

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function toRepoPath(root, absolutePath) {
  return relative(root, absolutePath).split('\\').join('/')
}

function extractRelativeSpecs(source) {
  const specs = []
  const cleaned = stripComments(source)
  for (const pattern of [FROM_RE, SIDE_EFFECT_IMPORT_RE, DYNAMIC_RE]) {
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(cleaned))) {
      specs.push(match[1])
    }
  }
  return specs
}

export function buildScriptImportGraph(root) {
  const scriptsRoot = join(root, 'scripts')
  const graph = new Map()

  for (const absolutePath of listMjsFiles(scriptsRoot)) {
    const importer = toRepoPath(root, absolutePath)
    if (!graph.has(importer)) graph.set(importer, new Set())

    const specs = extractRelativeSpecs(readFileSync(absolutePath, 'utf8'))
    for (const spec of specs) {
      const targetAbsolute = normalize(resolve(dirname(absolutePath), spec))
      if (!existsSync(targetAbsolute)) continue
      const target = toRepoPath(root, targetAbsolute)
      graph.get(importer).add(target)
      if (!graph.has(target)) graph.set(target, new Set())
    }
  }

  return graph
}

export function findStronglyConnectedComponents(graph) {
  let nextIndex = 0
  const indices = new Map()
  const lowlink = new Map()
  const stack = []
  const onStack = new Set()
  const components = []

  function strongConnect(vertex) {
    indices.set(vertex, nextIndex)
    lowlink.set(vertex, nextIndex)
    nextIndex += 1
    stack.push(vertex)
    onStack.add(vertex)

    for (const neighbor of graph.get(vertex) ?? []) {
      if (!indices.has(neighbor)) {
        strongConnect(neighbor)
        lowlink.set(vertex, Math.min(lowlink.get(vertex), lowlink.get(neighbor)))
      } else if (onStack.has(neighbor)) {
        lowlink.set(vertex, Math.min(lowlink.get(vertex), indices.get(neighbor)))
      }
    }

    if (lowlink.get(vertex) === indices.get(vertex)) {
      const component = []
      let member
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

export function collectInternalEdges(graph, component) {
  const edges = new Set()
  for (const importer of component) {
    for (const target of graph.get(importer) ?? []) {
      if (component.has(target)) {
        edges.add(`${importer} -> ${target}`)
      }
    }
  }
  return edges
}

function componentHasSelfEdge(graph, component) {
  return component.some((node) => (graph.get(node) ?? new Set()).has(node))
}

export function validateArchitectureContract(root) {
  const contractPath = join(root, 'scripts/architecture-contract.json')
  const contract = JSON.parse(readFileSync(contractPath, 'utf8'))
  const cycleNodesAllowed = new Set(contract.cycleNodes)
  const cycleEdgesAllowed = new Set(contract.cycleEdges)

  const graph = buildScriptImportGraph(root)
  const violations = []

  for (const component of findStronglyConnectedComponents(graph)) {
    const isCyclic = component.length >= 2 || componentHasSelfEdge(graph, component)
    if (!isCyclic) continue

    for (const path of component) {
      if (!cycleNodesAllowed.has(path)) {
        violations.push(`Unallowed cycle node: ${path}`)
      }
    }

    const edges = collectInternalEdges(graph, new Set(component))
    for (const edge of edges) {
      if (!cycleEdgesAllowed.has(edge)) {
        violations.push(`Unallowed cycle edge: ${edge}`)
      }
    }
  }

  for (const [adapterPath, config] of Object.entries(contract.adapters || {})) {
    const absoluteAdapterPath = join(root, adapterPath)
    if (!existsSync(absoluteAdapterPath)) {
      violations.push(`Missing adapter file: ${adapterPath}`)
      continue
    }

    const adapterTargets = [...(graph.get(adapterPath) ?? [])]
    if (adapterTargets.length > 0) {
      violations.push(`Adapter ${adapterPath} has repository imports: ${adapterTargets.join(', ')}`)
    }

    const expectedImporters = new Set(config.importers || [])
    const actualImporters = new Set(
      [...graph.entries()]
        .filter(([, targets]) => targets.has(adapterPath))
        .map(([importer]) => importer),
    )

    for (const importer of actualImporters) {
      if (!expectedImporters.has(importer)) {
        violations.push(`Unallowed importer for adapter ${adapterPath}: ${importer}`)
      }
    }
    for (const importer of expectedImporters) {
      if (!actualImporters.has(importer)) {
        violations.push(`Missing expected importer for adapter ${adapterPath}: ${importer}`)
      }
    }
  }

  return violations
}

export function assertArchitectureContract(root = process.cwd()) {
  const violations = validateArchitectureContract(root)
  if (violations.length > 0) {
    throw new ArchitectureContractError(violations)
  }
}

export function isDirectExecution() {
  const entrypoint = process.argv[1]
  if (!entrypoint) return false
  return import.meta.url === pathToFileURL(resolve(entrypoint)).href
}

function main() {
  const root = process.cwd()
  const violations = validateArchitectureContract(root)

  if (violations.length > 0) {
    console.error('Scripts architecture contract validation failed:')
    for (const violation of violations) {
      console.error(`- ${violation}`)
    }
    process.exit(1)
  } else {
    console.log('Scripts architecture contract validation passed.')
    process.exit(0)
  }
}

if (isDirectExecution()) main()
