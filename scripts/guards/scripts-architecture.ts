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

interface RootScriptMapping {
  path: string
  facade_disposition: string
  internal_destination: string
  owning_slice: number
  migration_status: string
}

type RootScriptMappingResult =
  | { valid: true; record: RootScriptMapping }
  | { valid: false; reason: string }

interface AdapterContract {
  importers?: string[]
}

interface ArchitectureContract {
  cycleNodes?: unknown
  cycleEdges?: unknown
  adapters?: Record<string, AdapterContract>
  rootScripts?: unknown
  transitionalDirectories?: unknown
}

type ScriptImportGraph = Map<string, Set<string>>

type CycleListKey = 'cycleNodes' | 'cycleEdges'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readCycleList(
  contract: ArchitectureContract,
  key: CycleListKey,
  violations: string[],
): string[] {
  if (!Object.hasOwn(contract, key)) return []
  const value = contract[key]
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    const detail = Array.isArray(value) ? ' entries must be strings' : ' must be an array'
    violations.push(`architecture-contract.json ${key}${detail}`)
    return []
  }
  return value
}

function validateRootScriptMappingRecord(recordInput: unknown): RootScriptMappingResult {
  if (!isRecord(recordInput)) {
    return { valid: false, reason: 'root script mapping must be a mapping' }
  }
  const path = recordInput.path
  if (typeof path !== 'string' || !/^scripts\/[^/]+\.(mjs|ts|sh)$/.test(path)) {
    return { valid: false, reason: 'root script path must be scripts/<file>.(mjs|ts|sh)' }
  }
  const facadeDisposition = recordInput.facade_disposition
  if (typeof facadeDisposition !== 'string' || !FACADE_DISPOSITIONS.has(facadeDisposition)) {
    return { valid: false, reason: 'facade_disposition is invalid' }
  }
  const internalDestination = recordInput.internal_destination
  if (typeof internalDestination !== 'string' || internalDestination.length === 0) {
    return { valid: false, reason: 'internal_destination is required' }
  }
  if (!INTERNAL_DESTINATION_PREFIXES.some((prefix) => internalDestination.startsWith(prefix))) {
    return {
      valid: false,
      reason: `internal_destination must use destination vocabulary: ${INTERNAL_DESTINATION_PREFIXES.join(', ')}`,
    }
  }
  const migrationStatus = recordInput.migration_status
  if (typeof migrationStatus !== 'string' || !MIGRATION_STATUSES.has(migrationStatus)) {
    return { valid: false, reason: 'migration_status is invalid' }
  }
  if (
    typeof recordInput.owning_slice !== 'number' ||
    !Number.isInteger(recordInput.owning_slice) ||
    recordInput.owning_slice < 1 ||
    recordInput.owning_slice > 7
  ) {
    return { valid: false, reason: 'owning_slice must be an integer 1–7' }
  }
  return {
    valid: true,
    record: {
      path,
      facade_disposition: facadeDisposition,
      internal_destination: internalDestination,
      owning_slice: recordInput.owning_slice,
      migration_status: migrationStatus,
    },
  }
}

export class ArchitectureContractError extends Error {
  readonly violations: string[]

  constructor(violations: string[]) {
    super('Scripts architecture contract validation failed')
    this.name = 'ArchitectureContractError'
    this.violations = violations
  }
}

const FROM_RE = /\bfrom\s+['"](\.\.?\/[^'"]+\.(mjs|ts))['"]/g
const SIDE_EFFECT_IMPORT_RE = /\bimport\s+['"](\.\.?\/[^'"]+\.(mjs|ts))['"]/g
const DYNAMIC_RE = /\bimport\s*\(\s*['"](\.\.?\/[^'"]+\.(mjs|ts))['"]\s*\)/g

function listScriptFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const absolutePath = join(dir, entry)
    const stat = statSync(absolutePath)
    if (stat.isDirectory()) {
      listScriptFiles(absolutePath, out)
      continue
    }
    if (/\.(mjs|ts)$/.test(entry)) out.push(absolutePath)
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
  for (const pattern of [FROM_RE, SIDE_EFFECT_IMPORT_RE, DYNAMIC_RE]) {
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(cleaned))) {
      specs.push(match[1])
    }
  }
  return specs
}

export function buildScriptImportGraph(root: string): ScriptImportGraph {
  const scriptsRoot = join(root, 'scripts')
  const graph = new Map()

  for (const absolutePath of listScriptFiles(scriptsRoot)) {
    const importer = toRepoPath(root, absolutePath)
    if (!graph.has(importer)) graph.set(importer, new Set())

    const specs = extractRelativeSpecs(readFileSync(absolutePath, 'utf8'))
    for (const spec of specs) {
      const targetAbsolute = normalize(resolve(dirname(absolutePath), spec))
      if (!existsSync(targetAbsolute)) continue
      const target = toRepoPath(root, targetAbsolute)
      graph.get(importer)?.add(target)
      if (!graph.has(target)) graph.set(target, new Set())
    }
  }

  return graph
}

export function findStronglyConnectedComponents(graph: ScriptImportGraph): string[][] {
  let nextIndex = 0
  const indices = new Map<string, number>()
  const lowlink = new Map<string, number>()
  const stack: string[] = []
  const onStack = new Set<string>()
  const components: string[][] = []

  function strongConnect(vertex: string): void {
    indices.set(vertex, nextIndex)
    lowlink.set(vertex, nextIndex)
    nextIndex += 1
    stack.push(vertex)
    onStack.add(vertex)

    for (const neighbor of graph.get(vertex) ?? []) {
      if (!indices.has(neighbor)) {
        strongConnect(neighbor)
        lowlink.set(vertex, Math.min(lowlink.get(vertex) ?? 0, lowlink.get(neighbor) ?? 0))
      } else if (onStack.has(neighbor)) {
        lowlink.set(vertex, Math.min(lowlink.get(vertex) ?? 0, indices.get(neighbor) ?? 0))
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

export function collectInternalEdges(graph: ScriptImportGraph, component: Set<string>): Set<string> {
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

function componentHasSelfEdge(graph: ScriptImportGraph, component: string[]): boolean {
  return component.some((node) => (graph.get(node) ?? new Set()).has(node))
}

export function listRootScripts(root: string): string[] {
  const scriptsRoot = join(root, 'scripts')
  if (!existsSync(scriptsRoot)) return []
  return readdirSync(scriptsRoot)
    .filter((entry) => {
      const absolutePath = join(scriptsRoot, entry)
      return statSync(absolutePath).isFile() && /\.(mjs|ts|sh)$/.test(entry)
    })
    .map((entry) => `scripts/${entry}`)
    .sort()
}

export function validateRootScriptMap(contract: ArchitectureContract, root: string): string[] {
  const violations: string[] = []
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
  const mappedPaths = rootScripts.map((entry: unknown) => isRecord(entry) ? entry.path : undefined)
  const sortedMapped = [...mappedPaths].sort()

  if (JSON.stringify(mappedPaths) !== JSON.stringify(sortedMapped)) {
    violations.push('rootScripts must be ordered deterministically by path')
  }

  const seen = new Set<string>()
  for (const entry of rootScripts) {
    const validated = validateRootScriptMappingRecord(entry)
    if (validated.valid === false) {
      const path = isRecord(entry) && typeof entry.path === 'string' ? entry.path : '<missing>'
      violations.push(`Invalid rootScripts entry for ${path}: ${validated.reason}`)
      continue
    }
    if (seen.has(validated.record.path)) {
      violations.push(`Duplicate rootScripts mapping: ${validated.record.path}`)
    }
    seen.add(validated.record.path)
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

  const harness = transitional.find((entry: unknown) => isRecord(entry) && entry.path === 'scripts/harness-contract/')
  if (!harness) {
    violations.push('transitionalDirectories must record scripts/harness-contract/')
  } else if (harness.migration_status !== 'transitional') {
    violations.push('scripts/harness-contract/ must remain migration_status transitional')
  }

  for (const entry of transitional) {
    if (!isRecord(entry) || typeof entry.path !== 'string' || !entry.path.startsWith('scripts/')) {
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

export function validateArchitectureContract(root: string): string[] {
  const contractPath = join(root, 'scripts/architecture-contract.json')
  const contract = JSON.parse(readFileSync(contractPath, 'utf8')) as ArchitectureContract
  const violations: string[] = []
  const cycleNodesAllowed = new Set(readCycleList(contract, 'cycleNodes', violations))
  const cycleEdgesAllowed = new Set(readCycleList(contract, 'cycleEdges', violations))

  const graph = buildScriptImportGraph(root)

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

export function assertArchitectureContract(root = process.cwd()): void {
  const violations = validateArchitectureContract(root)
  if (violations.length > 0) {
    throw new ArchitectureContractError(violations)
  }
}
