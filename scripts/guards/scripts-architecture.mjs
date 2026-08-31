import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, normalize, relative, resolve } from 'node:path'

const FACADE_DISPOSITIONS = new Set(['stable_facade', 'composition_root', 'tooling_entrypoint'])
const MIGRATION_STATUSES = new Set(['unmapped', 'planned', 'transitional', 'migrated', 'retained'])
const INTERNAL_DESTINATION_PREFIXES = Object.freeze([
  'scripts/context/',
  'scripts/handoff/',
  'scripts/boilerplate/',
  'scripts/guards/',
  'scripts/adapters/',
  'scripts/tooling/',
  'scripts/shared/',
])

function validateRootScriptMappingRecord(recordInput) {
  if (!recordInput || typeof recordInput !== 'object' || Array.isArray(recordInput)) {
    return { valid: false, reason: 'root script mapping must be a mapping' }
  }
  const record = recordInput
  if (typeof record.path !== 'string' || !/^scripts\/[^/]+\.(mjs|sh)$/.test(record.path)) {
    return { valid: false, reason: 'root script path must be scripts/<file>.(mjs|sh)' }
  }
  if (!FACADE_DISPOSITIONS.has(record.facade_disposition)) {
    return { valid: false, reason: 'facade_disposition is invalid' }
  }
  if (typeof record.internal_destination !== 'string' || record.internal_destination.length === 0) {
    return { valid: false, reason: 'internal_destination is required' }
  }
  if (!INTERNAL_DESTINATION_PREFIXES.some((prefix) => record.internal_destination.startsWith(prefix))) {
    return {
      valid: false,
      reason: `internal_destination must use destination vocabulary: ${INTERNAL_DESTINATION_PREFIXES.join(', ')}`,
    }
  }
  if (!MIGRATION_STATUSES.has(record.migration_status)) {
    return { valid: false, reason: 'migration_status is invalid' }
  }
  if (
    typeof record.owning_slice !== 'number' ||
    !Number.isInteger(record.owning_slice) ||
    record.owning_slice < 1 ||
    record.owning_slice > 7
  ) {
    return { valid: false, reason: 'owning_slice must be an integer 1–7' }
  }
  return {
    valid: true,
    record: {
      path: record.path,
      facade_disposition: record.facade_disposition,
      internal_destination: record.internal_destination,
      owning_slice: record.owning_slice,
      migration_status: record.migration_status,
    },
  }
}

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

export function listRootScripts(root) {
  const scriptsRoot = join(root, 'scripts')
  if (!existsSync(scriptsRoot)) return []
  return readdirSync(scriptsRoot)
    .filter((entry) => {
      const absolutePath = join(scriptsRoot, entry)
      return statSync(absolutePath).isFile() && /\.(mjs|sh)$/.test(entry)
    })
    .map((entry) => `scripts/${entry}`)
    .sort()
}

export function validateRootScriptMap(contract, root) {
  const violations = []
  const hasRootScripts = Object.hasOwn(contract, 'rootScripts')
  const hasTransitional = Object.hasOwn(contract, 'transitionalDirectories')

  // Temp architecture fixtures may omit the root-script map.
  // Production contracts include both keys and are enforced completely.
  if (!hasRootScripts && !hasTransitional) return violations

  const rootScripts = contract.rootScripts
  if (!Array.isArray(rootScripts)) {
    violations.push('architecture-contract.json rootScripts must be an array')
    return violations
  }

  const actual = listRootScripts(root)
  const mappedPaths = rootScripts.map((entry) => entry?.path)
  const sortedMapped = [...mappedPaths].sort()

  if (JSON.stringify(mappedPaths) !== JSON.stringify(sortedMapped)) {
    violations.push('rootScripts must be ordered deterministically by path')
  }

  const seen = new Set()
  for (const entry of rootScripts) {
    const validated = validateRootScriptMappingRecord(entry)
    if (!validated.valid) {
      violations.push(`Invalid rootScripts entry for ${entry?.path ?? '<missing>'}: ${validated.reason}`)
      continue
    }
    if (seen.has(validated.record.path)) {
      violations.push(`Duplicate rootScripts mapping: ${validated.record.path}`)
    }
    seen.add(validated.record.path)
    if (!FACADE_DISPOSITIONS.has(validated.record.facade_disposition)) {
      violations.push(`Invalid facade_disposition for ${validated.record.path}`)
    }
    if (!MIGRATION_STATUSES.has(validated.record.migration_status)) {
      violations.push(`Invalid migration_status for ${validated.record.path}`)
    }
    if (!INTERNAL_DESTINATION_PREFIXES.some((prefix) => validated.record.internal_destination.startsWith(prefix))) {
      violations.push(`Invalid internal_destination vocabulary for ${validated.record.path}`)
    }
  }

  for (const path of actual) {
    if (!seen.has(path)) {
      violations.push(`Missing rootScripts mapping for ${path}`)
    }
  }
  for (const path of seen) {
    if (!actual.includes(path)) {
      violations.push(`rootScripts mapping references missing root script: ${path}`)
    }
  }

  const transitional = contract.transitionalDirectories
  if (!Array.isArray(transitional)) {
    violations.push('architecture-contract.json transitionalDirectories must be an array')
    return violations
  }

  const harness = transitional.find((entry) => entry?.path === 'scripts/harness-contract/')
  if (!harness) {
    violations.push('transitionalDirectories must record scripts/harness-contract/')
  } else if (harness.migration_status !== 'transitional') {
    violations.push('scripts/harness-contract/ must remain migration_status transitional')
  }

  for (const entry of transitional) {
    if (typeof entry?.path !== 'string' || !entry.path.startsWith('scripts/')) {
      violations.push('transitionalDirectories entries require a scripts/ path')
      continue
    }
    if (entry.migration_status !== 'transitional') {
      violations.push(`transitionalDirectories ${entry.path} must use migration_status transitional`)
    }
    // Transitional directories are not destination vocabulary and must not be treated as approved target tree.
    if (INTERNAL_DESTINATION_PREFIXES.some((prefix) => entry.path === prefix || entry.path === prefix.slice(0, -1))) {
      violations.push(`transitionalDirectories must not reclassify destination vocabulary path ${entry.path}`)
    }
  }

  return violations
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

  violations.push(...validateRootScriptMap(contract, root))

  return violations
}

export function assertArchitectureContract(root = process.cwd()) {
  const violations = validateArchitectureContract(root)
  if (violations.length > 0) {
    throw new ArchitectureContractError(violations)
  }
}
