import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strict as assert } from 'node:assert'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const EXPECTED_DOCS_FILES = 85
const EXPECTED_DOCS_LINES = 12236
const EXPECTED_DOCS_BYTES = 557938

const EXPECTED_MANAGED_FILES = 49
const EXPECTED_MANAGED_LINES = 7173
const EXPECTED_MANAGED_BYTES = 333061

function runBuffer(args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'buffer', stdio: ['pipe', 'pipe', 'ignore'] })
  } catch (_err) {
    return null
  }
}

function runString(args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim()
  } catch (_err) {
    return null
  }
}

const inputRef = process.argv[2] || 'HEAD'
const sha = runString(['rev-parse', inputRef])

if (!sha) {
  console.error(`Could not resolve git ref: ${inputRef}`)
  process.exit(1)
}

function getFileContentBuffer(filePath) {
  return runBuffer(['show', `${sha}:${filePath}`])
}

function countLines(buffer) {
  if (!buffer) return 0
  let lines = 0
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === 0x0a) lines++
  }
  return lines
}

function getTreePaths(treeSha = sha, prefix = '') {
  const buf = runBuffer(['ls-tree', '-z', '-r', treeSha])
  if (!buf) return []
  const paths = []
  let start = 0
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0) {
      const entry = buf.subarray(start, i).toString('utf-8')
      const tabIdx = entry.indexOf('\t')
      if (tabIdx !== -1) {
        paths.push(prefix + entry.slice(tabIdx + 1))
      }
      start = i + 1
    }
  }
  return paths
}

const allPaths = getTreePaths()

// 1. Mandatory startup bundle
const guidePath = 'docs/mission-control/mission-control-guide.md'
const overridesPath = '.bemoat/mission-control-overrides.md'
const mandatoryPaths = [guidePath]
if (getFileContentBuffer(overridesPath)) {
  mandatoryPaths.push(overridesPath)
}

let mandatoryLines = 0
let mandatoryBytes = 0
for (const p of mandatoryPaths) {
  const buf = getFileContentBuffer(p)
  if (buf) {
    mandatoryLines += countLines(buf)
    mandatoryBytes += buf.length
  }
}

const tokens = Math.round(mandatoryBytes / 4)

// Role-specific on-demand bundle (e.g. chatgpt-project-loader, agent-issue scripts, etc)
const roleSpecificPaths = [
  'prompts/mission-control/chatgpt-project-loader.md',
  'docs/agent-loop/role-handoff-contract.md',
  'docs/mission-control/handoff-template.md',
  'docs/mission-control/result-template.md',
]
const existingRoleSpecificPaths = roleSpecificPaths.filter(p => getFileContentBuffer(p) !== null)

// Transitive reference-only files (e.g. READMEs linking back)
const transitiveReferencePaths = [
  'AGENTS.md',
  'docs/mission-control/README.md',
  'docs/mission-control/project-overrides.example.md'
]
const existingTransitivePaths = transitiveReferencePaths.filter(p => getFileContentBuffer(p) !== null)

// All harness docs (docs/ directory, not just .md)
const docsPaths = allPaths.filter(p => p.startsWith('docs/'))
let totalDocsLines = 0
let totalDocsBytes = 0
for (const p of docsPaths) {
  const buf = getFileContentBuffer(p)
  if (buf) {
    totalDocsLines += countLines(buf)
    totalDocsBytes += buf.length
  }
}

// Sync-managed documentation
const manifestBuf = getFileContentBuffer('.bemoat/boilerplate-sync-manifest.json')
let managedPathsResolved = []
if (manifestBuf) {
  try {
    const manifest = JSON.parse(manifestBuf.toString('utf-8'))
    const declaredPaths = manifest.managedPaths || []
    const expanded = new Set()
    for (const declared of declaredPaths) {
      if (allPaths.includes(declared)) {
        expanded.add(declared)
      } else {
        // Could be a directory
        const prefix = declared.endsWith('/') ? declared : declared + '/'
        for (const p of allPaths) {
          if (p.startsWith(prefix)) expanded.add(p)
        }
      }
    }
    // Filter to only documentation files for this specific count (starts with docs/)
    managedPathsResolved = Array.from(expanded).filter(p => p.startsWith('docs/')).sort()
  } catch (_e) {
    // Ignore parse error
  }
}

let managedFilesCount = 0
let managedLinesCount = 0
let managedBytesCount = 0
for (const p of managedPathsResolved) {
  const buf = getFileContentBuffer(p)
  if (buf) {
    managedFilesCount++
    managedLinesCount += countLines(buf)
    managedBytesCount += buf.length
  }
}

// Invariants in guide
const guideBuf = getFileContentBuffer(guidePath)
let invariantsCount = 0
if (guideBuf) {
  const guideStr = guideBuf.toString('utf-8')
  invariantsCount = (guideStr.match(/<!-- bemoat-mc:invariant:[a-z0-9-]+ -->/g) || []).length
}

const baselineJson = {
  sha,
  schema_version: 1,
  measurement_method: "scripts/capture-baseline.mjs (git show/ls-tree -z)",
  bundles: {
    mandatory_startup: {
      paths: mandatoryPaths,
      lines: mandatoryLines,
      bytes: mandatoryBytes,
      estimated_tokens: tokens,
    },
    role_specific: {
      paths: existingRoleSpecificPaths
    },
    transitive_reference: {
      paths: existingTransitivePaths
    }
  },
  totals: {
    docs_files: docsPaths.length,
    docs_lines: totalDocsLines,
    docs_bytes: totalDocsBytes,
    sync_managed_docs_files: managedFilesCount,
    sync_managed_docs_lines: managedLinesCount,
    sync_managed_docs_bytes: managedBytesCount,
  },
  dependency_graph: "Founder -> Issue -> protected guide + overrides -> agent-issue.mjs -> mission-control-state.mjs",
  invariants: invariantsCount,
  duplicates_measurable: "Defaults repeated at lines 102–115 (1 duplicate block known)",
  limitations: "actual model token usage, reasoning tokens consumed",
  sync_managed_resolved_paths: managedPathsResolved,
}

writeFileSync(join(root, 'docs/mission-control/dogfood/issue-150-baseline.json'), JSON.stringify(baselineJson, null, 2) + '\n')

const md = [
  `# Mission Control Baseline`,
  `- exact approved-base SHA: ${baselineJson.sha}`,
  `- measurement schema version: ${baselineJson.schema_version}`,
  `- exact commands/method: ${baselineJson.measurement_method}`,
  `- mandatory startup bundle: ${baselineJson.bundles.mandatory_startup.paths.join(', ')}`,
  `- role-specific on-demand bundle: ${baselineJson.bundles.role_specific.paths.join(', ')}`,
  `- transitive reference-only files: ${baselineJson.bundles.transitive_reference.paths.join(', ')}`,
  `- lines, bytes, and deterministic token approximation of startup bundle: ${baselineJson.bundles.mandatory_startup.lines} lines, ${baselineJson.bundles.mandatory_startup.bytes} bytes`,
  `- estimated tokens: ${baselineJson.bundles.mandatory_startup.estimated_tokens} tokens (approx: bytes / 4)`,
  `- total harness documentation files, lines, and bytes: ${baselineJson.totals.docs_files} files, ${baselineJson.totals.docs_lines} lines, ${baselineJson.totals.docs_bytes} bytes`,
  `- sync-managed documentation footprint: ${baselineJson.totals.sync_managed_docs_files} files, ${baselineJson.totals.sync_managed_docs_lines} lines, ${baselineJson.totals.sync_managed_docs_bytes} bytes`,
  `- startup policy dependency/link graph: ${baselineJson.dependency_graph}`,
  `- invariant marker count: ${baselineJson.invariants} markers`,
  `- only exactly measurable duplication counts: ${baselineJson.duplicates_measurable}`,
  `- unavailable metric limitations: ${baselineJson.limitations}`,
]

writeFileSync(join(root, 'docs/mission-control/dogfood/issue-150-baseline.md'), md.join('\n') + '\n')
console.log('Baseline saved to JSON and MD')

// Assert against expected totals
assert.equal(baselineJson.totals.docs_files, EXPECTED_DOCS_FILES, `Expected ${EXPECTED_DOCS_FILES} docs files, got ${baselineJson.totals.docs_files}`)
assert.equal(baselineJson.totals.docs_lines, EXPECTED_DOCS_LINES, `Expected ${EXPECTED_DOCS_LINES} docs lines, got ${baselineJson.totals.docs_lines}`)
assert.equal(baselineJson.totals.docs_bytes, EXPECTED_DOCS_BYTES, `Expected ${EXPECTED_DOCS_BYTES} docs bytes, got ${baselineJson.totals.docs_bytes}`)
assert.equal(baselineJson.totals.sync_managed_docs_files, EXPECTED_MANAGED_FILES, `Expected ${EXPECTED_MANAGED_FILES} managed docs files, got ${baselineJson.totals.sync_managed_docs_files}`)
assert.equal(baselineJson.totals.sync_managed_docs_lines, EXPECTED_MANAGED_LINES, `Expected ${EXPECTED_MANAGED_LINES} managed docs lines, got ${baselineJson.totals.sync_managed_docs_lines}`)
assert.equal(baselineJson.totals.sync_managed_docs_bytes, EXPECTED_MANAGED_BYTES, `Expected ${EXPECTED_MANAGED_BYTES} managed docs bytes, got ${baselineJson.totals.sync_managed_docs_bytes}`)

console.log('Baseline measurements exactly match expected immutable totals.')
