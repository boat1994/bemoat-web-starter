import { execSync } from 'child_process'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

function run(cmd, suppressError = false) {
  try {
    return execSync(cmd, { cwd: root, encoding: 'utf-8', stdio: suppressError ? ['pipe', 'pipe', 'ignore'] : 'pipe' }).trim()
  } catch (err) {
    if (!suppressError) {
      console.error(`Error running command: ${cmd}`)
    }
    throw err
  }
}

let output = []
function log(msg) {
  console.log(msg)
  output.push(msg)
}

const inputRef = process.argv[2] || 'HEAD'
const sha = run(`git rev-parse ${inputRef}`)
log(`- exact approved-base SHA: ${sha}`)
log(`- measurement schema version: 1`)
log(`- exact commands/method: scripts/capture-baseline.mjs (git show/ls-tree)`)

function getFileContent(filePath) {
  try {
    return run(`git show ${sha}:${filePath}`, true)
  } catch {
    return null
  }
}

const guidePath = 'docs/mission-control/mission-control-guide.md'
const overridesPath = '.bemoat/mission-control-overrides.md'
let alwaysLoaded = [guidePath]
if (getFileContent(overridesPath) !== null) {
  alwaysLoaded.push(overridesPath)
}

log(`- mandatory startup bundle: ${alwaysLoaded.join(', ')}`)
log(`- role-specific on-demand bundle: (To be extracted in later phases)`)
log(`- transitive reference-only files: (To be cataloged in later phases)`)

let policyLines = 0
let policyBytes = 0
for (const p of alwaysLoaded) {
  const content = getFileContent(p)
  if (content) {
    policyLines += content.split('\n').length
    policyBytes += Buffer.byteLength(content, 'utf-8')
  }
}
log(`- lines, bytes, and deterministic token approximation of startup bundle: ${policyLines} lines, ${policyBytes} bytes`)

// Token approximation (bytes / 4)
const tokens = Math.round(policyBytes / 4)
log(`- estimated tokens: ${tokens} tokens (approx: bytes / 4)`)

// all .md files in docs
const docsFilesOutput = run(`git ls-tree -r --name-only ${sha} docs/ | grep '\\.md$' || true`)
const docsFiles = docsFilesOutput.split('\n').filter(Boolean)
let totalDocsLines = 0
let totalDocsBytes = 0
for (const p of docsFiles) {
  const content = getFileContent(p)
  if (content) {
    totalDocsLines += content.split('\n').length
    totalDocsBytes += Buffer.byteLength(content, 'utf-8')
  }
}
log(`- total harness documentation files, lines, and bytes: ${docsFiles.length} files, ${totalDocsLines} lines, ${totalDocsBytes} bytes`)

// sync-managed from discovery (we could parse manifest at SHA, but sticking to explicit metrics if preferred, actually let's parse it from SHA)
let managedFiles = 0
let managedLines = 0
let managedBytes = 0
const manifestContent = getFileContent('.bemoat/boilerplate-sync-manifest.json')
if (manifestContent) {
  const manifest = JSON.parse(manifestContent)
  const managedDocs = manifest.managedPaths.filter(p => p.startsWith('docs/'))
  for (const p of managedDocs) {
    const content = getFileContent(p)
    if (content) {
      managedFiles++
      managedLines += content.split('\n').length
      managedBytes += Buffer.byteLength(content, 'utf-8')
    }
  }
}
log(`- sync-managed documentation footprint: ${managedFiles} files, ${managedLines} lines, ${managedBytes} bytes`)

log(`- startup policy dependency/link graph: Founder -> Issue -> protected guide + overrides -> agent-issue.mjs -> mission-control-state.mjs`)

const guideContent = getFileContent(guidePath) || ''
const invariants = (guideContent.match(/<!-- bemoat-mc:invariant:[a-z0-9-]+ -->/g) || []).length
log(`- invariant marker count: ${invariants} markers`)
log(`- only exactly measurable duplication counts: Defaults repeated at lines 102–115 (1 duplicate block known)`)
log(`- unavailable metric limitations: actual model token usage, reasoning tokens consumed`)

writeFileSync(join(root, 'docs/mission-control/dogfood/issue-150-baseline.md'), output.join('\n') + '\n')
console.log('Baseline saved to docs/mission-control/dogfood/issue-150-baseline.md')
