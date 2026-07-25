#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const GUIDE_PATH = 'docs/mission-control/mission-control-guide.md'
export const LOADER_PATH = 'prompts/mission-control/chatgpt-project-loader.md'
export const HANDOFF_PATH = 'docs/mission-control/handoff-template.md'
export const RESULT_PATH = 'docs/mission-control/result-template.md'
export const ROLE_HANDOFF_PATH = 'docs/agent-loop/role-handoff-contract.md'
export const README_PATH = 'docs/mission-control/README.md'
export const OVERRIDE_EXAMPLE_PATH = 'docs/mission-control/project-overrides.example.md'
export const LIVE_OVERRIDE_PATH = '.bemoat/mission-control-overrides.md'
export const AGENTS_PATH = 'AGENTS.md'
export const MANIFEST_PATH = '.bemoat/boilerplate-sync-manifest.json'
export const SYNC_SCRIPT_PATH = 'scripts/sync-boilerplate.mjs'
export const RECONCILE_SCRIPT_PATH = 'scripts/mission-control-reconcile.mjs'
export const RECONCILE_TEST_PATH = 'tests/int/mission-control-reconcile.int.spec.ts'
export const GUARD_SCRIPT_PATH = 'scripts/guard-mission-control-contract.mjs'
export const INT_TEST_PATH = 'tests/int/mission-control-contract.int.spec.ts'
export const FIXTURES_PATH = 'tests/fixtures/mission-control'

export const MODULE_PROCEDURES_PATH = 'docs/mission-control/modules/procedures.md'
export const MODULE_CHECKLISTS_PATH = 'docs/mission-control/modules/checklists.md'
export const MODULE_TEMPLATES_PATH = 'docs/mission-control/modules/templates-examples.md'
export const MODULE_TROUBLESHOOTING_PATH = 'docs/mission-control/modules/troubleshooting.md'
export const MODULE_MIGRATION_PATH = 'docs/mission-control/modules/migration-guidance.md'
export const MODULE_CHILD_SYNC_PATH = 'docs/mission-control/modules/child-sync-operations.md'

export const MC_MANAGED_MODULES = [
  MODULE_PROCEDURES_PATH,
  MODULE_CHECKLISTS_PATH,
  MODULE_TEMPLATES_PATH,
  MODULE_TROUBLESHOOTING_PATH,
  MODULE_MIGRATION_PATH,
  MODULE_CHILD_SYNC_PATH,
]


export const MC_MANAGED_PATHS = [
  README_PATH,
  GUIDE_PATH,
  HANDOFF_PATH,
  RESULT_PATH,
  OVERRIDE_EXAMPLE_PATH,
  LOADER_PATH,
  GUARD_SCRIPT_PATH,
  RECONCILE_SCRIPT_PATH,
  INT_TEST_PATH,
  RECONCILE_TEST_PATH,
    FIXTURES_PATH,
  MODULE_PROCEDURES_PATH,
  MODULE_CHECKLISTS_PATH,
  MODULE_TEMPLATES_PATH,
  MODULE_TROUBLESHOOTING_PATH,
  MODULE_MIGRATION_PATH,
  MODULE_CHILD_SYNC_PATH,
]

export const MODULE_SECTION_MAP = {
  [GUIDE_PATH]: [
    '## Purpose',
    '## Applicability and preflight outcomes',
    '## Workflow profiles',
    '## Operational-stage minimization and state necessity',
    '## Roles and authority boundaries',
    '## Responsibility/source-of-truth model',
    '## Protocol compression',
    '## Brainstorming Response Profile',
    '## Integration boundaries',
    '## Durable Mission Control state schema',
    '## State machine and allowed transitions',
    '## Review-cycle budget',
    '## Cost-aware review routing',
    '## Full-review rules',
    '## Delta-review rules',
    '## Blocker-verification rules',
    '## Finding severity and evidence requirements',
    '## Material-change rules',
    '## Lean Founder Decision',
    '## Reopening rules',
    '## Handoff contract',
    '## RESULT contract',
    '## Follow-up issue policy',
    '## Scope-control rules',
    '## Stop conditions',
  ],
  [MODULE_PROCEDURES_PATH]: [
    '## Double-Loop Review Gate',
    '## Execution roles and atomic completions',
    '## Role-owned durable state updates',
    '## Deterministic reconciliation',
    '## Bootstrap and state reconstruction',
  ],
  [MODULE_CHECKLISTS_PATH]: [
    '## Completion gate',
  ],
  [MODULE_TEMPLATES_PATH]: [
    '## Compact transition examples',
    '## Worked examples',
  ],
  [MODULE_TROUBLESHOOTING_PATH]: [
    '## Conflict behavior',
  ],
  [MODULE_MIGRATION_PATH]: [
    '## Existing-task migration behavior',
  ],
  [MODULE_CHILD_SYNC_PATH]: [
    '## Repository-specific override behavior',
  ],
}

export const REQUIRED_HANDOFF_FIELDS = [
  'Repository:',
  'Approved base:',
  'Active Task Issue:',
  'Active PR:',
  'Current head SHA:',
  'Guide version/ref/SHA:',
  'Assigned role:',
  'Execution role:',
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

export const DOUBLE_LOOP_FAILURE_CLASSES = [
  'IMPLEMENTATION',
  'SPECIFICATION',
  'VALIDATION',
  'DECOMPOSITION',
  'TOOL_OR_MODEL',
  'ENVIRONMENT',
  'UNKNOWN',
]

export const DOUBLE_LOOP_ALLOWED_DECISIONS = [
  'CONTINUE_IMPLEMENTATION',
  'REVISE_SPECIFICATION',
  'REVISE_VALIDATION',
  'SPLIT_OR_REDECOMPOSE_TASK',
  'CHANGE_TOOL_OR_MODEL',
  'REPAIR_ENVIRONMENT',
  'BLOCKED_EXTERNAL',
  'BLOCKED_FOR_FOUNDER_DECISION',
  'CREATE_FOLLOW_UP_ISSUE',
]

export const REQUIRED_DOUBLE_LOOP_TRANSPORT_FIELDS = [
  '**Loop gate:**',
  '**Failure class:**',
  '**Invalidated assumptions:**',
  '**Decision:**',
  '**Next experiment:**',
  '**Material difference:**',
  '**Allowed / prohibited:**',
  '**Verify / stop:**',
]

/** Stable capability/risk routing invariants; runtime model names stay replaceable. */
export const REQUIRED_COST_AWARE_GUIDE_PHRASES = [
  'A durable state transition does not itself require or authorize a separate model run.',
  'Keep a distinct durable state only when it changes execution authority or owner, next permitted action, required evidence, failure-handling path, or a Founder/human approval requirement.',
  'Mechanical verification uses deterministic scripts, or a low-reasoning coordinator when automation is unavailable; it is not a high-reasoning semantic review.',
  'A changed commit or head alone is not a trigger for another Full Semantic Review.',
  'Review routing depends on capability and proven risk; runtime model names remain replaceable configuration.',
  'Delta Review uses the lowest reasoning level that can reliably verify the bounded change.',
  'FAST defaults to focused verification without independent high-reasoning review.',
  'STANDARD defaults to one risk-adjusted semantic review: Medium for bounded normal-risk work and High only for material ambiguity or significant connected risk.',
  'MANAGED defaults to one independent High Full Semantic Review, followed by bounded Delta Review.',
  'A Full Semantic Review escalation requires at least one explicit proven trigger.',
]

/** Lean Founder Decision UX invariants for BLOCKED_FOR_FOUNDER_DECISION stops. */
export const REQUIRED_LEAN_FOUNDER_DECISION_PHRASES = [
  'Founder Decision stops stay lean by default',
  'the two available actions: **Approve** or **Decline**',
  'Do not include Suggested model, Ready-to-paste prompts',
  '`ELIGIBLE_FOR_FOUNDER_REVIEW` merge authorization stays on the existing',
  'BLOCKED_FOR_FOUNDER_DECISION -> IN_PROGRESS',
  'BLOCKED_FOR_FOUNDER_DECISION -> DONE',
]

/** Immutable correction finding / capsule invariants (Minimal Hybrid). */
export const REQUIRED_CORRECTION_GUIDE_PHRASES = [
  'Reviewers own immutable finding identity',
  'Correction agents may not rename, reinterpret, regroup, substitute, add, or omit findings',
  'Correction delivery does not resolve original PR review threads',
  'File names, test names, and green CI alone never prove semantic completion',
]

/** Brainstorming Response Profile invariants (#144). */
export const REQUIRED_BRAINSTORMING_GUIDE_PHRASES = [
  'formatting and routing guidance only',
  'not a durable Mission Control state, GitHub comment type, review counter, or authorization channel',
  'Use exactly one profile marker heading: `## BRAINSTORMING` or `## DESIGN RESULT`',
  'It **does not** authorize implementation, branch creation, commits, PR',
  'remain in brainstorming/design mode and ask exactly one clarification question',
  'brainstorming output must not mutate managed state',
  'normal Mission Control response contract resumes on the next agent invocation',
]

export const REQUIRED_CORRECTION_HANDOFF_PHRASES = [
  '### Immutable correction finding contract',
  '### Correction RESULT evidence map',
  'pnpm run bemoat:agent:issue -- <issue-number> --phase correction',
  'Playback verified:',
  '"status": "CLAIMED_RESOLVED"',
  '"status": "UNPROVEN"',
]

export const REQUIRED_LEAN_FOUNDER_LOADER_PHRASES = [
  'Lean Founder Decision when state is `BLOCKED_FOR_FOUNDER_DECISION`',
  'Actions: **Approve** | **Decline**',
  'Do not include Suggested model, Ready-to-paste',
  'After **Approve** only: durable GitHub authorization + compact HANDOFF',
  'After **Decline**: minimal stop/closure only',
  'Keep `ELIGIBLE_FOR_FOUNDER_REVIEW` on the default merge path',
  'Founder Decision stops stay lean',
]

export const LOADER_MAX_LINES = 80
export const LOADER_FORBIDDEN_TITLES = ['## Review-cycle budget', '## Finding severity']

/** Bare legacy Core verdict option list — must not appear as an allowed enum. */
export const LEGACY_BARE_CORE_VERDICT_RE = /\bPASS\s*\|\s*BLOCKED\b/

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
export function scanModuleContent(relativePath, content) {
  const violations = []
  if (content == null) {
    violations.push(violation('MC013', relativePath, 'Required module is missing'))
    return violations
  }
  const sectionMap = MODULE_SECTION_MAP[relativePath]
  if (sectionMap) {
    for (const heading of sectionMap) {
      if (!content.includes(heading)) {
        violations.push(violation('MC005', relativePath, `Required module section missing: ${heading}`))
      }
    }
  }
  
  if (relativePath === MODULE_PROCEDURES_PATH) {
    if (!content.includes('AWAITING_REVIEW_1 state block')) {
      violations.push(
        violation('MC012', relativePath, 'Module must require atomic delivery to AWAITING_REVIEW_1'),
      )
    }
    if (!content.includes('must never increment `review_cycle` or `full_review_count`')) {
      violations.push(
        violation('MC012', relativePath, 'Module must forbid Dev from incrementing review counters'),
      )
    }
    for (const failureClass of DOUBLE_LOOP_FAILURE_CLASSES) {
      if (!content.includes(failureClass)) {
        violations.push(
          violation('MC012', relativePath, `Module missing Double-Loop failure class: ${failureClass}`),
        )
      }
    }
    for (const decision of DOUBLE_LOOP_ALLOWED_DECISIONS) {
      if (!content.includes(decision)) {
        violations.push(
          violation('MC012', relativePath, `Module missing Double-Loop decision: ${decision}`),
        )
      }
    }
    if (!content.includes('`UNKNOWN` must not authorize another materially similar edit.')) {
      violations.push(
        violation('MC012', relativePath, 'Module must prohibit UNKNOWN from authorizing a similar edit'),
      )
    }
    if (!content.includes('no-code diagnostic checkpoint')) {
      violations.push(
        violation('MC012', relativePath, 'Module must define the Double-Loop gate as a no-code checkpoint'),
      )
    }
  }
  
  return violations
}

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

  const sectionMap = MODULE_SECTION_MAP[relativePath]
  if (sectionMap) {
    for (const heading of sectionMap) {
      if (!content.includes(heading)) {
        violations.push(violation('MC005', relativePath, `Required guide section missing: ${heading}`))
      }
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
  if (!content.includes('<!-- bemoat-mc:invariant:delivery-owns-awaiting-review-1 -->')) {
    violations.push(
      violation('MC012', relativePath, 'Guide missing delivery-owns-awaiting-review-1 invariant marker'),
    )
  }
  if (!content.includes('<!-- bemoat-mc:invariant:reviewer-owns-counters -->')) {
    violations.push(
      violation('MC012', relativePath, 'Guide missing reviewer-owns-counters invariant marker'),
    )
  }
  if (!content.includes('<!-- bemoat-mc:invariant:deterministic-reconciliation-not-conflict -->')) {
    violations.push(
      violation(
        'MC012',
        relativePath,
        'Guide missing deterministic-reconciliation-not-conflict invariant marker',
      ),
    )
  }

  if (!content.includes('must not autonomously start Review 4')) {
    violations.push(violation('MC012', relativePath, 'Guide must forbid autonomous Review 4'))
  }
  if (!content.includes('Minor/Nit findings must not block')) {
    violations.push(violation('MC012', relativePath, 'Guide must state Minor/Nit findings must not block'))
  }

  for (const phrase of REQUIRED_COST_AWARE_GUIDE_PHRASES) {
    if (!content.includes(phrase)) {
      violations.push(
        violation('MC012', relativePath, `Guide missing cost-aware routing invariant: ${phrase}`),
      )
    }
  }
  for (const phrase of REQUIRED_LEAN_FOUNDER_DECISION_PHRASES) {
    if (!content.includes(phrase)) {
      violations.push(
        violation('MC012', relativePath, `Guide missing lean Founder Decision invariant: ${phrase}`),
      )
    }
  }

  for (const phrase of REQUIRED_CORRECTION_GUIDE_PHRASES) {
    if (!content.includes(phrase)) {
      violations.push(
        violation('MC012', relativePath, `Guide missing immutable correction invariant: ${phrase}`),
      )
    }
  }

  for (const phrase of REQUIRED_BRAINSTORMING_GUIDE_PHRASES) {
    if (!content.includes(phrase)) {
      violations.push(
        violation('MC012', relativePath, `Guide missing brainstorming profile invariant: ${phrase}`),
      )
    }
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

  for (const phrase of REQUIRED_LEAN_FOUNDER_LOADER_PHRASES) {
    if (!content.includes(phrase)) {
      violations.push(
        violation('MC007', relativePath, `Loader missing lean Founder Decision invariant: ${phrase}`),
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
  if (!content.includes('AWAITING_REVIEW_1')) {
    violations.push(
      violation('MC011', relativePath, 'RESULT template must document AWAITING_REVIEW_1 delivery state'),
    )
  }
  for (const verdict of REQUIRED_VERDICTS) {
    if (!content.includes(verdict)) {
      violations.push(violation('MC011', relativePath, `RESULT template missing verdict: ${verdict}`))
    }
  }
  return violations
}

/**
 * Core MC-gated review transport must list the canonical verdict enum and must
 * not offer bare legacy `PASS | BLOCKED` as allowed Core verdict options.
 */
export function scanRoleHandoffContract(relativePath, content) {
  const violations = []
  if (content == null) {
    violations.push(violation('MC011', relativePath, 'Role handoff contract is missing'))
    return violations
  }
  for (const verdict of REQUIRED_VERDICTS) {
    if (!content.includes(verdict)) {
      violations.push(
        violation(
          'MC011',
          relativePath,
          `Role handoff contract missing Core verdict: ${verdict}`,
        ),
      )
    }
  }
  if (LEGACY_BARE_CORE_VERDICT_RE.test(content)) {
    violations.push(
      violation(
        'MC011',
        relativePath,
        'Role handoff contract must not use bare legacy Core verdicts (PASS | BLOCKED)',
      ),
    )
  }
  for (const field of REQUIRED_DOUBLE_LOOP_TRANSPORT_FIELDS) {
    if (!content.includes(field)) {
      violations.push(
        violation('MC011', relativePath, `Role handoff contract missing Double-Loop field: ${field}`),
      )
    }
  }
  for (const phrase of REQUIRED_CORRECTION_HANDOFF_PHRASES) {
    if (!content.includes(phrase)) {
      violations.push(
        violation(
          'MC011',
          relativePath,
          `Role handoff contract missing immutable correction transport: ${phrase}`,
        ),
      )
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

  
  let guide = readOptional(root, GUIDE_PATH, readFile) || '';
  
  for (const modPath of MC_MANAGED_MODULES) {
    const modContent = readOptional(root, modPath, readFile);
    if (!modContent) {
      violations.push(violation('MC013', modPath, 'Required module is missing'));
    } else {
      violations.push(...scanModuleContent(modPath, modContent));
    }
  }

  violations.push(...scanGuideContent(GUIDE_PATH, guide))

  const loader = readOptional(root, LOADER_PATH, readFile)
  violations.push(...scanLoaderContent(LOADER_PATH, loader))

  const agents = readOptional(root, AGENTS_PATH, readFile)
  violations.push(...scanAgentsPointer(AGENTS_PATH, agents))

  const handoff = readOptional(root, HANDOFF_PATH, readFile)
  violations.push(...scanHandoffTemplate(HANDOFF_PATH, handoff))

  const result = readOptional(root, RESULT_PATH, readFile)
  violations.push(...scanResultTemplate(RESULT_PATH, result))

  const roleHandoff = readOptional(root, ROLE_HANDOFF_PATH, readFile)
  violations.push(...scanRoleHandoffContract(ROLE_HANDOFF_PATH, roleHandoff))

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
