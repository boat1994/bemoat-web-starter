#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const GUIDE_PATH = 'docs/mission-control/mission-control-guide.md'
export const LOADER_PATH = 'prompts/mission-control/chatgpt-project-loader.md'
export const HANDOFF_PATH = 'docs/mission-control/handoff-template.md'
export const RESULT_PATH = 'docs/mission-control/result-template.md'
export const README_PATH = 'docs/mission-control/README.md'
export const OVERRIDE_EXAMPLE_PATH = 'docs/mission-control/project-overrides.example.md'
export const LIVE_OVERRIDE_PATH = '.bemoat/mission-control-overrides.md'
export const AGENTS_PATH = 'AGENTS.md'
export const MANIFEST_PATH = '.bemoat/boilerplate-sync-manifest.json'
export const SYNC_SCRIPT_PATH = 'scripts/sync-boilerplate.mjs'
export const GUARD_SCRIPT_PATH = 'scripts/guard-mission-control-contract.mjs'
export const INT_TEST_PATH = 'tests/int/mission-control-contract.int.spec.ts'
export const FIXTURES_PATH = 'tests/fixtures/mission-control'

export const MC_MANAGED_PATHS = [
  README_PATH,
  GUIDE_PATH,
  HANDOFF_PATH,
  RESULT_PATH,
  OVERRIDE_EXAMPLE_PATH,
  LOADER_PATH,
  GUARD_SCRIPT_PATH,
  INT_TEST_PATH,
  FIXTURES_PATH,
]

export const REQUIRED_GUIDE_SECTIONS = [
  '## Purpose',
  '## Roles and authority boundaries',
  '## Responsibility/source-of-truth model',
  '## Bootstrap and state reconstruction',
  '## Durable Mission Control state schema',
  '## State machine and allowed transitions',
  '## Review-cycle budget',
  '## Full-review rules',
  '## Delta-review rules',
  '## Blocker-verification rules',
  '## Finding severity and evidence requirements',
  '## Material-change rules',
  '## Completion gate',
  '## Reopening rules',
  '## Handoff contract',
  '## RESULT contract',
  '## Follow-up issue policy',
  '## Scope-control rules',
  '## Stop conditions',
  '## Existing-task migration behavior',
  '## Repository-specific override behavior',
  '## Worked examples',
]

export const REQUIRED_HANDOFF_FIELDS = [
  'Repository:',
  'Approved base:',
  'Active Task Issue:',
  'Active PR:',
  'Current head SHA:',
  'Guide version/ref/SHA:',
  'Assigned role:',
  'Review type:',
  'Review cycle:',
  'Model/reasoning guidance:',
  'Exact scope:',
  'Out of scope:',
  'Acceptance Criteria:',
  'Open findings:',
  'Required checks:',
  'Required manual QA:',
  'Stop condition:',
  'Expected RESULT format:',
]

export const REQUIRED_RESULT_FIELDS = [
  'Role:',
  'Action completed:',
  'Repository/branch:',
  'Previous head:',
  'Current exact head:',
  'Files changed or reviewed:',
  'Acceptance Criteria audit:',
  'Commands/checks and outcomes:',
  'Manual QA evidence:',
  'Findings and dispositions:',
  'Review cycle/verdict:',
  'Durable GitHub state updated:',
  'Blockers:',
  'Follow-up Issues created:',
  'Next permitted action:',
  'Stop confirmation:',
]

export const REQUIRED_VERDICTS = [
  'CORRECTION REQUIRED',
  'ELIGIBLE FOR FOUNDER REVIEW',
  'BLOCKED FOR FOUNDER DECISION',
  'BLOCKED EXTERNAL',
  'STATE CONFLICT',
]

export const LOADER_MAX_LINES = 160
export const LOADER_FORBIDDEN_TITLES = ['## Review-cycle budget', '## Finding severity']

const REQUIRED_FRONTMATTER_KEYS = [
  'policy_id',
  'version',
  'scope',
  'canonical_repository',
  'max_review_cycles',
]

const SEMVER_RE = /^\d+\.\d+\.\d+$/

function readOptional(root, relativePath, readFile) {
  const absolutePath = resolve(root, relativePath)
  if (!existsSync(absolutePath)) return null
  return readFile(absolutePath)
}

function parseFrontmatter(content) {
  if (!content.startsWith('---\n')) return null
  const end = content.indexOf('\n---\n', 4)
  if (end === -1) return null
  const block = content.slice(4, end)
  const data = {}
  for (const line of block.split('\n')) {
    const match = line.match(/^([a-z_]+):\s*(.+)$/)
    if (match) data[match[1]] = match[2].trim()
  }
  return data
}

function extractManagedPathsFromSyncScript(content) {
  const match = content.match(/export const managedPaths = \[([\s\S]*?)\]/)
  if (!match) return []
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
}

function violation(rule, file, message) {
  return { type: 'mission-control-contract', rule, file, message }
}

/**
 * Scan a guide file body (already loaded). Exported for fixtures/tests.
 */
export function scanGuideContent(relativePath, content) {
  const violations = []

  if (content == null) {
    violations.push(violation('MC001', relativePath, 'Canonical Mission Control guide is missing'))
    return violations
  }

  const frontmatter = parseFrontmatter(content)
  if (!frontmatter) {
    violations.push(violation('MC002', relativePath, 'Required frontmatter missing or invalid'))
    return violations
  }

  for (const key of REQUIRED_FRONTMATTER_KEYS) {
    if (!(key in frontmatter)) {
      violations.push(violation('MC002', relativePath, `Required frontmatter key missing: ${key}`))
    }
  }

  if (frontmatter.policy_id !== 'bemoat-mission-control') {
    violations.push(violation('MC002', relativePath, 'policy_id must be bemoat-mission-control'))
  }

  if (!SEMVER_RE.test(frontmatter.version ?? '')) {
    violations.push(violation('MC003', relativePath, 'guide version is not valid semver'))
  }

  if (frontmatter.max_review_cycles !== '3') {
    violations.push(
      violation('MC004', relativePath, 'max_review_cycles is missing or not 3'),
    )
  }

  for (const heading of REQUIRED_GUIDE_SECTIONS) {
    if (!content.includes(heading)) {
      violations.push(violation('MC005', relativePath, `Required guide section missing: ${heading}`))
    }
  }

  if (!content.includes('<!-- bemoat-mc:invariant:no-autonomous-review-4 -->')) {
    violations.push(
      violation('MC012', relativePath, 'Guide missing no-autonomous-Review-4 invariant marker'),
    )
  }
  if (!content.includes('<!-- bemoat-mc:invariant:no-silent-reset -->')) {
    violations.push(violation('MC012', relativePath, 'Guide missing no-silent-reset invariant marker'))
  }
  if (!content.includes('<!-- bemoat-mc:invariant:minor-nit-non-blocking -->')) {
    violations.push(
      violation('MC012', relativePath, 'Guide missing Minor/Nit non-blocking invariant marker'),
    )
  }
  if (!content.includes('must not autonomously start Review 4')) {
    violations.push(violation('MC012', relativePath, 'Guide must forbid autonomous Review 4'))
  }
  if (!content.includes('Minor/Nit findings must not block')) {
    violations.push(violation('MC012', relativePath, 'Guide must state Minor/Nit findings must not block'))
  }

  return violations
}

export function scanLoaderContent(relativePath, content) {
  const violations = []

  if (content == null) {
    violations.push(violation('MC006', relativePath, 'ChatGPT Mission Control loader is missing'))
    return violations
  }

  if (!content.includes(GUIDE_PATH)) {
    violations.push(
      violation('MC006', relativePath, 'Loader must point to docs/mission-control/mission-control-guide.md'),
    )
  }

  const lineCount = content.split('\n').length
  if (lineCount > LOADER_MAX_LINES) {
    violations.push(
      violation(
        'MC007',
        relativePath,
        `Loader exceeds thin bootstrap limit (${lineCount} > ${LOADER_MAX_LINES} lines)`,
      ),
    )
  }

  for (const title of LOADER_FORBIDDEN_TITLES) {
    if (content.includes(title)) {
      violations.push(
        violation('MC007', relativePath, `Loader duplicates long-form policy heading: ${title}`),
      )
    }
  }

  return violations
}

export function scanAgentsPointer(relativePath, content) {
  const violations = []
  if (content == null) {
    violations.push(violation('MC008', relativePath, 'AGENTS.md is missing'))
    return violations
  }
  if (!content.includes(GUIDE_PATH) || !content.includes(LOADER_PATH)) {
    violations.push(
      violation('MC008', relativePath, 'AGENTS.md lacks the canonical Mission Control pointer'),
    )
  }
  return violations
}

export function scanHandoffTemplate(relativePath, content) {
  const violations = []
  if (content == null) {
    violations.push(violation('MC011', relativePath, 'Handoff template is missing'))
    return violations
  }
  for (const field of REQUIRED_HANDOFF_FIELDS) {
    if (!content.includes(field)) {
      violations.push(violation('MC011', relativePath, `Handoff template missing field: ${field}`))
    }
  }
  return violations
}

export function scanResultTemplate(relativePath, content) {
  const violations = []
  if (content == null) {
    violations.push(violation('MC011', relativePath, 'RESULT template is missing'))
    return violations
  }
  for (const field of REQUIRED_RESULT_FIELDS) {
    if (!content.includes(field)) {
      violations.push(violation('MC011', relativePath, `RESULT template missing field: ${field}`))
    }
  }
  for (const verdict of REQUIRED_VERDICTS) {
    if (!content.includes(verdict)) {
      violations.push(violation('MC011', relativePath, `RESULT template missing verdict: ${verdict}`))
    }
  }
  return violations
}

export function scanManagedPathsContract(managedPaths) {
  const violations = []
  const paths = managedPaths ?? []

  for (const path of MC_MANAGED_PATHS) {
    if (!paths.includes(path)) {
      violations.push(
        violation('MC009', SYNC_SCRIPT_PATH, `Mission Control managed path missing from managedPaths: ${path}`),
      )
    }
  }

  if (paths.includes(LIVE_OVERRIDE_PATH)) {
    violations.push(
      violation(
        'MC010',
        SYNC_SCRIPT_PATH,
        'Live child override path must not be included in managedPaths',
      ),
    )
  }

  return violations
}

export function runMissionControlContractGuard({
  root = process.cwd(),
  readFile = (filePath) => readFileSync(filePath, 'utf8'),
  managedPaths,
} = {}) {
  const violations = []

  const guide = readOptional(root, GUIDE_PATH, readFile)
  violations.push(...scanGuideContent(GUIDE_PATH, guide))

  const loader = readOptional(root, LOADER_PATH, readFile)
  violations.push(...scanLoaderContent(LOADER_PATH, loader))

  const agents = readOptional(root, AGENTS_PATH, readFile)
  violations.push(...scanAgentsPointer(AGENTS_PATH, agents))

  const handoff = readOptional(root, HANDOFF_PATH, readFile)
  violations.push(...scanHandoffTemplate(HANDOFF_PATH, handoff))

  const result = readOptional(root, RESULT_PATH, readFile)
  violations.push(...scanResultTemplate(RESULT_PATH, result))

  let paths = managedPaths
  if (!paths) {
    const syncSource = readOptional(root, SYNC_SCRIPT_PATH, readFile)
    paths = syncSource ? extractManagedPathsFromSyncScript(syncSource) : []

    const manifestRaw = readOptional(root, MANIFEST_PATH, readFile)
    if (manifestRaw) {
      try {
        const manifest = JSON.parse(manifestRaw)
        const manifestPaths = Array.isArray(manifest.managedPaths) ? manifest.managedPaths : []
        const syncSet = new Set(paths)
        const manifestSet = new Set(manifestPaths)
        for (const path of MC_MANAGED_PATHS) {
          if (syncSet.has(path) !== manifestSet.has(path)) {
            violations.push(
              violation(
                'MC009',
                MANIFEST_PATH,
                `Mission Control path parity mismatch for ${path}`,
              ),
            )
          }
        }
      } catch {
        violations.push(violation('MC009', MANIFEST_PATH, 'Could not parse boilerplate sync manifest'))
      }
    }
  }

  violations.push(...scanManagedPathsContract(paths))

  return violations
}

export function getMissionControlContractExitCode(violations) {
  return violations.length > 0 ? 1 : 0
}

export function formatMissionControlContractViolations(violations) {
  if (violations.length === 0) {
    return ['Mission Control contract guard passed.']
  }

  const lines = [
    'Mission Control contract guard failed:',
    '',
    'Fix the violations below, then rerun `pnpm run guard:mission-control-contract` or `pnpm run bemoat:guard:safety`.',
    'See docs/guard-pack.md and docs/mission-control/README.md.',
    '',
  ]

  for (const item of violations) {
    lines.push(`- [${item.rule}] ${item.file}: ${item.message}`)
  }

  return lines
}

export function isDirectExecution() {
  const entrypoint = process.argv[1]
  if (!entrypoint) return false
  return import.meta.url === pathToFileURL(resolve(entrypoint)).href
}

function main() {
  const violations = runMissionControlContractGuard()
  const lines = formatMissionControlContractViolations(violations)

  for (const line of lines) console.log(line)

  process.exit(getMissionControlContractExitCode(violations))
}

if (isDirectExecution()) main()
