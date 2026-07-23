#!/usr/bin/env node
import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const EXPECTED_DOCS_FILES = 85
const EXPECTED_DOCS_LINES = 12236
const EXPECTED_DOCS_BYTES = 557938
const EXPECTED_MANAGED_FILES = 49
const EXPECTED_MANAGED_LINES = 7173
const EXPECTED_MANAGED_BYTES = 333061
const LOADER_PATH = 'prompts/mission-control/chatgpt-project-loader.md'

function runBuffer(args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'buffer', stdio: ['pipe', 'pipe', 'ignore'] })
  } catch {
    return null
  }
}

function runString(args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

function countLines(buffer) {
  if (!buffer) return 0
  let lines = 0
  for (const byte of buffer) if (byte === 0x0a) lines += 1
  return lines
}

/** Derive the executable loading contract from the canonical Project loader. */
export function classifyPolicyLoaderContent(content) {
  const startupSection = content.match(/## Startup\s+([\s\S]*?)(?=\n## |\n1\. Merged canonical guide)/)?.[1] ?? ''
  const mandatoryRepositoryPolicy = [...startupSection.matchAll(/`([^`]+\.md)`/g)].map((match) => match[1])
  const orderStart = content.search(/^1\. Merged canonical guide on approved base\s*$/m)
  const loadingOrder = orderStart < 0
    ? []
    : content
        .slice(orderStart)
        .split('\n')
        .map((line) => line.match(/^(\d+)\.\s+(.+)$/))
        .filter(Boolean)
        .slice(0, 5)
        .map((match) => ({ position: Number(match[1]), source_text: match[2] }))
  const roleTransportText = loadingOrder.find((item) => item.position === 4)?.source_text ?? ''
  const commentTypes = [...roleTransportText.matchAll(/## (HANDOFF|RESULT|REVIEW_VERDICT)/g)].map((match) => match[1])
  const liveGithubEvidence = loadingOrder.find((item) => item.position === 5)?.source_text ?? ''
  const durableArtifacts = loadingOrder.find((item) => item.position === 3)?.source_text ?? ''

  if (mandatoryRepositoryPolicy.length < 2 || loadingOrder.length !== 5 || commentTypes.length !== 3) {
    throw new Error('Canonical loader is missing a complete startup, loading-order, or role-transport contract.')
  }

  return {
    mandatory_repository_policy: mandatoryRepositoryPolicy,
    loading_order: loadingOrder,
    durable_artifacts: durableArtifacts,
    role_transport: { source_text: roleTransportText, comment_types: commentTypes },
    live_github_evidence: liveGithubEvidence,
  }
}

export function captureBaseline(inputRef = 'HEAD') {
  const sha = runString(['rev-parse', inputRef])
  if (!sha) throw new Error(`Could not resolve git ref: ${inputRef}`)

  const getFileContentBuffer = (filePath) => runBuffer(['show', `${sha}:${filePath}`])
  const treeBuffer = runBuffer(['ls-tree', '-z', '-r', sha])
  const allPaths = []
  if (treeBuffer) {
    let start = 0
    for (let index = 0; index < treeBuffer.length; index += 1) {
      if (treeBuffer[index] !== 0) continue
      const entry = treeBuffer.subarray(start, index).toString('utf8')
      const tabIndex = entry.indexOf('\t')
      if (tabIndex !== -1) allPaths.push(entry.slice(tabIndex + 1))
      start = index + 1
    }
  }

  const loaderBuffer = getFileContentBuffer(LOADER_PATH)
  assert(loaderBuffer, `Missing canonical loader at ${sha}:${LOADER_PATH}`)
  const loaderClassification = classifyPolicyLoaderContent(loaderBuffer.toString('utf8'))
  const mandatoryPaths = loaderClassification.mandatory_repository_policy.filter(
    (filePath) => getFileContentBuffer(filePath) !== null,
  )

  const measurePaths = (paths) => paths.reduce(
    (totals, filePath) => {
      const buffer = getFileContentBuffer(filePath)
      if (!buffer) return totals
      totals.files += 1
      totals.lines += countLines(buffer)
      totals.bytes += buffer.length
      return totals
    },
    { files: 0, lines: 0, bytes: 0 },
  )

  const startupMetrics = measurePaths(mandatoryPaths)
  const loaderMetrics = measurePaths([LOADER_PATH])
  const docsPaths = allPaths.filter((filePath) => filePath.startsWith('docs/'))
  const docsMetrics = measurePaths(docsPaths)

  const manifestBuffer = getFileContentBuffer('.bemoat/boilerplate-sync-manifest.json')
  const managedPathsResolved = []
  if (manifestBuffer) {
    const manifest = JSON.parse(manifestBuffer.toString('utf8'))
    const expanded = new Set()
    for (const declaredPath of manifest.managedPaths ?? []) {
      if (allPaths.includes(declaredPath)) {
        expanded.add(declaredPath)
        continue
      }
      const prefix = declaredPath.endsWith('/') ? declaredPath : `${declaredPath}/`
      for (const filePath of allPaths) if (filePath.startsWith(prefix)) expanded.add(filePath)
    }
    managedPathsResolved.push(...[...expanded].filter((filePath) => filePath.startsWith('docs/')).sort())
  }
  const managedMetrics = measurePaths(managedPathsResolved)

  const guideBuffer = getFileContentBuffer('docs/mission-control/mission-control-guide.md')
  const invariants = guideBuffer
    ? (guideBuffer.toString('utf8').match(/<!-- bemoat-mc:invariant:[a-z0-9-]+ -->/g) ?? []).length
    : 0

  return {
    sha,
    schema_version: 1,
    measurement_method: 'scripts/capture-baseline.mjs (byte-preserving git show + recursive git ls-tree -z)',
    loading_contract: {
      derived_from: { path: LOADER_PATH, ref: sha },
      ...loaderClassification,
    },
    bundles: {
      project_instructions: { paths: [LOADER_PATH], ...loaderMetrics },
      mandatory_repository_policy: {
        paths: mandatoryPaths,
        optional_paths_absent: loaderClassification.mandatory_repository_policy.filter(
          (filePath) => !mandatoryPaths.includes(filePath),
        ),
        ...startupMetrics,
        estimated_tokens: Math.round(startupMetrics.bytes / 4),
      },
      durable_task_context: { source_text: loaderClassification.durable_artifacts },
      role_transport: loaderClassification.role_transport,
      live_github_evidence: { source_text: loaderClassification.live_github_evidence },
    },
    totals: {
      docs_files: docsMetrics.files,
      docs_lines: docsMetrics.lines,
      docs_bytes: docsMetrics.bytes,
      sync_managed_docs_files: managedMetrics.files,
      sync_managed_docs_lines: managedMetrics.lines,
      sync_managed_docs_bytes: managedMetrics.bytes,
    },
    invariants,
    duplicates_measurable: 'Defaults repeated at approved-base guide lines 102–115 (1 duplicate block known)',
    limitations: 'actual model token usage, reasoning tokens consumed',
    sync_managed_resolved_paths: managedPathsResolved,
  }
}

function writeBaselineArtifacts(baseline) {
  const outputRoot = join(root, 'docs/mission-control/dogfood')
  writeFileSync(join(outputRoot, 'issue-150-baseline.json'), `${JSON.stringify(baseline, null, 2)}\n`)
  const policy = baseline.bundles.mandatory_repository_policy
  const markdown = [
    '# Mission Control Baseline',
    `- exact approved-base SHA: ${baseline.sha}`,
    `- measurement schema version: ${baseline.schema_version}`,
    `- exact commands/method: ${baseline.measurement_method}`,
    `- loading contract source: ${baseline.loading_contract.derived_from.path} at ${baseline.loading_contract.derived_from.ref}`,
    `- project-instruction bundle: ${baseline.bundles.project_instructions.paths.join(', ')} (${baseline.bundles.project_instructions.lines} lines, ${baseline.bundles.project_instructions.bytes} bytes)`,
    `- mandatory repository-policy bundle: ${policy.paths.join(', ')} (${policy.lines} lines, ${policy.bytes} bytes)`,
    `- optional policy paths absent at approved SHA: ${policy.optional_paths_absent.join(', ') || 'none'}`,
    `- durable artifact stage: ${baseline.bundles.durable_task_context.source_text}`,
    `- role transport stage: ${baseline.bundles.role_transport.source_text}`,
    `- live GitHub evidence stage: ${baseline.bundles.live_github_evidence.source_text}`,
    `- total harness documentation: ${baseline.totals.docs_files} files, ${baseline.totals.docs_lines} lines, ${baseline.totals.docs_bytes} bytes`,
    `- recursive sync-managed documentation: ${baseline.totals.sync_managed_docs_files} files, ${baseline.totals.sync_managed_docs_lines} lines, ${baseline.totals.sync_managed_docs_bytes} bytes`,
    `- invariant marker count: ${baseline.invariants}`,
    `- unavailable metric limitations: ${baseline.limitations}`,
  ]
  writeFileSync(join(outputRoot, 'issue-150-baseline.md'), `${markdown.join('\n')}\n`)
}

export function isDirectExecution() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
}

function main() {
  if (process.argv[2] === '--classify-loader') {
    const loaderPath = process.argv[3]
    if (!loaderPath) throw new Error('--classify-loader requires a file path')
    console.log(JSON.stringify(classifyPolicyLoaderContent(readFileSync(loaderPath, 'utf8'))))
    return
  }

  const baseline = captureBaseline(process.argv[2] || 'HEAD')
  writeBaselineArtifacts(baseline)
  assert.equal(baseline.totals.docs_files, EXPECTED_DOCS_FILES)
  assert.equal(baseline.totals.docs_lines, EXPECTED_DOCS_LINES)
  assert.equal(baseline.totals.docs_bytes, EXPECTED_DOCS_BYTES)
  assert.equal(baseline.totals.sync_managed_docs_files, EXPECTED_MANAGED_FILES)
  assert.equal(baseline.totals.sync_managed_docs_lines, EXPECTED_MANAGED_LINES)
  assert.equal(baseline.totals.sync_managed_docs_bytes, EXPECTED_MANAGED_BYTES)
  console.log('Baseline measurements and derived loading contract match the immutable approved-base fixture.')
}

if (isDirectExecution()) main()
