import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

import { afterEach, describe, expect, it } from 'vitest'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped runtime .mjs boundary */
import * as agentIssueModule from '../../scripts/agent-issue.mjs'
import * as reconcileModule from '../../scripts/mission-control-reconcile.mjs'
import * as missionControlStateModule from '../../scripts/mission-control-state.mjs'

// Shared .mjs scripts expose runtime behavior, not TypeScript declarations. Keep
// the strict-project boundary explicit without changing the production API.
const {
  analyzeExactHeadCi,
  analyzeProgressTracking,
  deriveWorkflowProfile,
  isCheckSuccessful,
  normalizeStatusChecks,
  parseDurableProgress,
  parseIssueDeclarations,
  parseIssueReference,
  parseMissionControlState,
  runAgentIssuePreflight,
  validatePlanPath,
} = agentIssueModule as unknown as Record<string, (...args: any[]) => any>
const { buildCorrectionHandoffBinding } = reconcileModule as unknown as Record<string, (...args: any[]) => any>
const { renderMissionControlState } = missionControlStateModule as unknown as Record<string, (...args: any[]) => any>

const PRODUCTION_PR103_ROLLUP = [
  {
    __typename: 'CheckRun',
    completedAt: '2026-07-13T13:48:20Z',
    conclusion: 'SUCCESS',
    detailsUrl:
      'https://github.com/boat1994/bemoat-web-starter/actions/runs/29255089356/job/86833152417',
    name: 'starter-ci',
    startedAt: '2026-07-13T13:46:10Z',
    status: 'COMPLETED',
    workflowName: 'CI (starter strict)',
  },
  {
    __typename: 'CheckRun',
    completedAt: '2026-07-13T13:46:45Z',
    conclusion: 'SUCCESS',
    detailsUrl:
      'https://github.com/boat1994/bemoat-web-starter/actions/runs/29255089357/job/86833152618',
    name: 'ci',
    startedAt: '2026-07-13T13:46:10Z',
    status: 'COMPLETED',
    workflowName: 'CI',
  },
]

const repoRoot = process.cwd()
const scriptPath = resolve(repoRoot, 'scripts/agent-issue.mjs')
const planningFixturesRoot = resolve(repoRoot, 'tests/fixtures/planning')
const tempRoots: string[] = []

function readPlanningFixture(name: string) {
  return readFileSync(join(planningFixturesRoot, name), 'utf8')
}

function planWithTaskIdentity(sections: string, overrides: Record<string, string> = {}) {
  const fields: Record<string, string> = {
    schema_version: '1',
    main_issue: 'null',
    task_key: '"slice b"',
    task_issue_strategy: '"existing_dedicated_issue"',
    active_task_issue: '"#121"',
    branch_template: '"feature/121-slice-b"',
    transition_target: '"AWAITING_REVIEW_1"',
    planning_base_sha: '"2489c7bf6d10ad8c2a724a7920bd83350102ee03"',
    execution_base_rule: '"resolve_live_protected_base_at_dispatch"',
    paired_spec: 'null',
    paired_plan: 'null',
    ...overrides,
  }

  const identityBlock = `<!-- bemoat-task-identity:start -->
${Object.entries(fields)
  .map(([key, value]) => `${key}: ${value}`)
  .join('\n')}
<!-- bemoat-task-identity:end -->`

  return `# Implementation Plan\n\n${identityBlock}\n\n${sections}`
}

function createRepo(branch: string) {
  const root = mkdtempSync(join(tmpdir(), 'bemoat-agent-issue-'))
  tempRoots.push(root)

  const init = spawnSync('git', ['init', '-b', branch], {
    cwd: root,
    encoding: 'utf8',
  })

  expect(init.status, init.stderr).toBe(0)

  const remote = spawnSync(
    'git',
    ['remote', 'add', 'origin', 'https://github.com/boat1994/bemoat-web-starter.git'],
    {
      cwd: root,
      encoding: 'utf8',
    },
  )

  expect(remote.status, remote.stderr).toBe(0)

  spawnSync('git', ['config', 'user.email', 'agent-issue@test'], { cwd: root, encoding: 'utf8' })
  spawnSync('git', ['config', 'user.name', 'Agent Issue Test'], { cwd: root, encoding: 'utf8' })

  return root
}

function seedTrackedFile(root: string, relativePath: string, content: string) {
  const absolute = join(root, relativePath)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, content)
  spawnSync('git', ['add', relativePath], { cwd: root, encoding: 'utf8' })
  spawnSync('git', ['commit', '-m', 'seed fixture'], { cwd: root, encoding: 'utf8' })
}

function writeExecutable(filePath: string, content: string) {
  writeFileSync(filePath, content)
  chmodSync(filePath, 0o755)
}

function withStubbedGh(root: string, content: string) {
  const binDir = mkdtempSync(join(tmpdir(), 'bemoat-agent-issue-bin-'))
  const ghPath = join(binDir, 'gh')

  tempRoots.push(binDir)
  mkdirSync(binDir, { recursive: true })
  writeExecutable(ghPath, content)

  return `${binDir}:${process.env.PATH ?? ''}`
}

function managedState(overrides: Record<string, string> = {}) {
  const fields: Record<string, string> = {
    schema_version: '1',
    state: 'IN_PROGRESS',
    review_cycle: '0',
    full_review_count: '0',
    approved_base: 'main',
    active_task_issue: '"115"',
    active_pr: '"116"',
    current_head: 'newhead',
    last_reviewed_head: 'null',
    guide_version: '1.0.0',
    guide_source_ref: 'main',
    guide_source_sha: 'null',
    open_blockers: '[]',
    follow_up_issues: '[]',
    next_permitted_action: 'Implement',
    material_change_status: 'none',
    updated_at: 'null',
    updated_by: 'null',
    ...overrides,
  }

  return `<!-- bemoat-mission-control-state:start -->\n${Object.entries(fields)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n')}\n<!-- bemoat-mission-control-state:end -->`
}

function runAgentIssue(root: string, args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  })
}

const MATRIX_OWNER = 'boat1994'
const MATRIX_REPO = 'bemoat-web-starter'
const MATRIX_PR = '200'
const MATRIX_HEAD = 'abc1234'
const MATRIX_CANONICAL = `https://github.com/${MATRIX_OWNER}/${MATRIX_REPO}/pull/${MATRIX_PR}`

type LiveUrlMatrixCase = {
  id: number
  name: string
  expected: 'ACCEPT' | 'REJECT'
  liveUrl?: string | null
  livePrExtra?: Record<string, unknown>
  omitUrl?: boolean
  prNumber?: string
  verdictPrUrl?: string
  verdictFindingsExtra?: string
  verdictOnly?: boolean
}

/**
 * Drive correction preflight against one closed live-PR URL contract row.
 * Fixture JSON is written to disk so whitespace/control/encoding bytes survive.
 */
function runLiveUrlMatrixCase(matrixCase: LiveUrlMatrixCase) {
  const root = createRepo('feature/136-immutable-correction-contract')
  // Keep fixture files outside the git work tree so correction preflight stays clean.
  const fixtureDir = mkdtempSync(join(tmpdir(), 'bemoat-agent-issue-fixtures-'))
  tempRoots.push(fixtureDir)
  const prNumber = matrixCase.prNumber ?? MATRIX_PR
  const verdictPrUrl =
    matrixCase.verdictPrUrl ??
    `https://github.com/${MATRIX_OWNER}/${MATRIX_REPO}/pull/${prNumber}`
  const findingsExtra = matrixCase.verdictFindingsExtra ?? ''
  const verdictBody = `## REVIEW_VERDICT
**PR / base / head:** ${verdictPrUrl} · \`main\` · \`${MATRIX_HEAD}\`
**Verdict:** CORRECTION REQUIRED
**Findings:** Important: boundary bug${findingsExtra}
**Gates:** exact-head CI https://example.test/ci → pass
**Next:** Dev posts correction RESULT

\`\`\`json
{
  "schema_version": 1,
  "reviewed_head": "${MATRIX_HEAD}",
  "findings": [
    {
      "id": "MC-R1-001",
      "canonical_summary": "supplied-timezone month boundaries are incorrect",
      "source_thread": "https://github.com/${MATRIX_OWNER}/${MATRIX_REPO}/pull/${prNumber}#discussion_r1",
      "required_evidence": ["Bangkok exact UTC boundary"]
    }
  ]
}
\`\`\`
`
  const commentsPath = join(fixtureDir, 'comments.json')
  writeFileSync(commentsPath, JSON.stringify({
    comments: [{ body: verdictBody, createdAt: '2026-07-20T10:00:00+07:00' }],
  }))

  const livePr: Record<string, unknown> = {
    title: 'Correction PR',
    headRefName: 'feature/136',
    baseRefName: 'main',
    headRefOid: MATRIX_HEAD,
    state: 'OPEN',
    statusCheckRollup: [],
    commits: [],
    ...matrixCase.livePrExtra,
  }
  if (!matrixCase.omitUrl && !matrixCase.verdictOnly) {
    if (matrixCase.liveUrl === null) {
      livePr.url = null
    } else if (matrixCase.liveUrl !== undefined) {
      livePr.url = matrixCase.liveUrl
    } else {
      livePr.url = MATRIX_CANONICAL
    }
  } else if (matrixCase.omitUrl) {
    // intentionally no url
  } else if (matrixCase.verdictOnly) {
    livePr.url = MATRIX_CANONICAL
  }

  const prPath = join(fixtureDir, 'pr.json')
  writeFileSync(prPath, JSON.stringify(livePr))

  const issuePath = join(fixtureDir, 'issue.json')
  writeFileSync(
    issuePath,
    JSON.stringify({
      title: 'Immutable correction contract',
      url: 'https://github.com/boat1994/bemoat-web-starter/issues/136',
      body: '',
      labels: [],
    }),
  )

  return runAgentIssue(root, ['136', '--phase', 'correction'], {
    PATH: withStubbedGh(
      root,
      `#!/usr/bin/env sh
case "$*" in
  *"issue view 136"*"title,url,body,labels"*)
    cat "${issuePath}"
    ;;
  *"issue view 136"*"comments"*)
    cat "${commentsPath}"
    ;;
  *"pr view ${prNumber}"*|*"pr view 201"*|*"pr view 0"*|*"pr view 0123"*)
    cat "${prPath}"
    ;;
  *)
    echo "unexpected gh call: $*" >&2
    exit 1
    ;;
esac
`,
    ),
  })
}

function expectMatrixOutcome(
  result: ReturnType<typeof runAgentIssue>,
  expected: 'ACCEPT' | 'REJECT',
  name: string,
) {
  if (expected === 'ACCEPT') {
    expect(result.status, `${name}\n${result.stderr || result.stdout}`).toBe(0)
    expect(result.stdout, name).toContain('Playback verified:')
    expect(result.stdout, name).toContain('Edit authorization: granted')
  } else {
    expect(result.status, `${name}\n${result.stderr || result.stdout}`).not.toBe(0)
    expect(result.stdout, name).not.toContain('Edit authorization: granted')
    expect(result.stdout, name).not.toMatch(/Playback verified:/)
  }
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('agent issue parsing helpers', () => {
  it('parses declared Main Issue, plan path, and current stage fields', () => {
    const body = `
Main Issue: #106
Implementation Plan: \`docs/superpowers/plans/bogus/growth/ads-line-v1/task-d-growth-v1-implementation-plan.md\`

## Current Stage
- Current Slice: Slice B
- Current Task or gate: Task 3
- Active Task Issue: #121
- Active PR: #122
- Relevant plan section: Slice B — Acquisition Handoff

## Next Permitted Action
Open the review gate issue.
`

    const declarations = parseIssueDeclarations(body)

    expect(declarations.declaresMainIssue).toBe(true)
    expect(declarations.mainIssueRef).toBe('#106')
    expect(declarations.declaresImplementationPlan).toBe(true)
    expect(declarations.implementationPlanPath).toBe(
      'docs/superpowers/plans/bogus/growth/ads-line-v1/task-d-growth-v1-implementation-plan.md',
    )
    expect(declarations.currentStage).toMatchObject({
      current_slice: 'Slice B',
      active_pr: '#122',
    })
    expect(declarations.nextPermittedAction).toBe('Open the review gate issue.')
  })

  it('parses GitHub issue template ### headings from agent-task form fields', () => {
    const body = `
### Main Issue (Core / multi-stage)

#106

### Implementation Plan path (Core / multi-stage)

docs/superpowers/plans/sample/implementation-plan.md

### Active PR

#122
`

    const declarations = parseIssueDeclarations(body)

    expect(declarations.declaresMainIssue).toBe(true)
    expect(declarations.mainIssueRef).toBe('#106')
    expect(declarations.declaresImplementationPlan).toBe(true)
    expect(declarations.implementationPlanPath).toBe(
      'docs/superpowers/plans/sample/implementation-plan.md',
    )
    expect(declarations.activePrRef).toBe('#122')
  })

  it('does not treat Parent section prose as a declared Main Issue', () => {
    const body = `## Parent

None — this is an upstream harness-standard issue.`

    const declarations = parseIssueDeclarations(body)

    expect(declarations.declaresMainIssue).toBe(false)
  })

  it('ignores durable progress examples inside fenced code blocks', () => {
    const body = `
Recommended form:

\`\`\`md
## Durable Progress
- [ ] Example only
\`\`\`

## Acceptance Criteria
- [ ] Real criterion
`

    const progress = parseDurableProgress(body)

    expect(progress.hasChecklist).toBe(false)
    expect(progress.firstIncomplete).toBeNull()
  })

  it('finds the first incomplete durable milestone', () => {
    const body = `
## Durable Progress

### Slice A — Foundation
- [x] Task 1 implementation complete
- [ ] Exact-head CI passed

### Slice B — Acquisition Handoff
- [ ] Task 3 implementation complete
`

    const progress = parseDurableProgress(body)

    expect(progress.firstIncomplete?.label).toBe('Exact-head CI passed')
    expect(progress.firstIncomplete?.slice).toBe('Slice A — Foundation')
  })

  it('parses owner/repo issue references', () => {
    expect(parseIssueReference('boat1994/bogus-jewelry#106')).toEqual({
      repo: 'boat1994/bogus-jewelry',
      number: '106',
    })
    expect(parseIssueReference('#119', 'boat1994/bemoat-web-starter')).toEqual({
      repo: 'boat1994/bemoat-web-starter',
      number: '119',
    })
  })

  it('validates plan paths and relevant sections', () => {
    const root = createRepo('feature/101-agent-issue')
    const planPath = 'docs/superpowers/plans/sample/implementation-plan.md'
    const absolute = join(root, planPath)
    mkdirSync(join(root, 'docs/superpowers/plans/sample'), { recursive: true })
    writeFileSync(
      absolute,
      '# Implementation Plan\n\n## Slice A — Foundation\n\nDetails.\n',
    )

    expect(validatePlanPath(root, planPath, 'Slice A — Foundation').ok).toBe(true)
    expect(validatePlanPath(root, planPath, 'Missing Slice').ok).toBe(false)
    expect(validatePlanPath(root, 'docs/missing-plan.md').ok).toBe(false)
  })

  it('distinguishes exact-head CI from older successful CI evidence', () => {
    const production = analyzeExactHeadCi({
      headRefOid: '0e02e42e9c6953bd4a18e8f78f44ca6044e4b5d2',
      statusCheckRollup: PRODUCTION_PR103_ROLLUP,
    })
    const legacyExactHead = analyzeExactHeadCi({
      headRefOid: 'abc123def456',
      statusCheckRollup: {
        contexts: [{ state: 'SUCCESS', targetUrl: 'https://github.com/runs/abc123def456' }],
      },
    })
    const legacyOlderSha = analyzeExactHeadCi({
      headRefOid: 'currentheadsha111',
      statusCheckRollup: {
        contexts: [{ state: 'SUCCESS', targetUrl: 'https://github.com/runs/oldsha999' }],
      },
    })

    expect(normalizeStatusChecks(PRODUCTION_PR103_ROLLUP)).toHaveLength(2)
    expect(isCheckSuccessful(PRODUCTION_PR103_ROLLUP[0])).toBe(true)
    expect(production.exactHeadVerified).toBe(true)
    expect(production.summary).toContain('Exact-head CI verified for 0e02e42')
    expect(legacyExactHead.exactHeadVerified).toBe(true)
    expect(legacyOlderSha.exactHeadVerified).toBe(false)
    expect(legacyOlderSha.olderShaSuccess).toBe(true)
  })
})

describe('agent issue preflight', () => {
  it('exits non-zero when the issue number is missing', () => {
    const root = createRepo('feature/83-agent-issue')
    const result = runAgentIssue(root, [])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Usage: pnpm run bemoat:agent:issue -- <issue-number>')
  })

  it('passes on a clean implementation branch and prints GitHub issue metadata when available', () => {
    const root = createRepo('feature/83-agent-issue')
    const pathValue = withStubbedGh(
      root,
      `#!/usr/bin/env sh
case "$*" in
  *"--json"*"title,url,body,labels"*)
    printf '%s' '{"title":"Minimal bemoat:agent:issue contract for issue-driven AI workflow","url":"https://github.com/boat1994/bemoat-web-starter/issues/83","body":"## Goal\\nSmall standalone task.","labels":[]}'
    ;;
  *)
    echo "unexpected gh call: $*" >&2
    exit 1
    ;;
esac
`,
    )

    const result = runAgentIssue(root, ['83'], { PATH: pathValue })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Current branch: feature/83-agent-issue')
    expect(result.stdout).toContain('Git status --short:\n<clean>')
    expect(result.stdout).toContain('Title: Minimal bemoat:agent:issue contract for issue-driven AI workflow')
    expect(result.stdout).toContain('URL: https://github.com/boat1994/bemoat-web-starter/issues/83')
    expect(result.stdout).toContain(
      'Suggested branch default: feature/83-minimal-bemoat-agent-issue-contract-for-issue-dr',
    )
    expect(result.stdout).toContain('Progress tracking:')
    expect(result.stdout).toContain('No Main Issue declared — expected for valid Small or standalone tasks.')
    expect(result.stdout).toContain('Validation guidance:')
    expect(result.stdout).toContain('- Follow the validation tier in AGENTS.md.')
    expect(result.stdout).toContain('Next manual step: Read the listed docs')
    expect(result.stdout).toContain('docs/agent-loop/project-progress-tracking.md')
  })

  it('accepts the documented pnpm argument separator before the issue number', () => {
    const root = createRepo('feature/83-agent-issue')
    const pathValue = withStubbedGh(
      root,
      `#!/usr/bin/env sh
printf '%s' '{"title":"Minimal bemoat:agent:issue contract for issue-driven AI workflow","url":"https://github.com/boat1994/bemoat-web-starter/issues/83","body":"","labels":[]}'
`,
    )

    const result = runAgentIssue(root, ['--', '83'], { PATH: pathValue })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Issue number: 83')
    expect(result.stdout).toContain('Title: Minimal bemoat:agent:issue contract for issue-driven AI workflow')
  })

  it('fails on main and suggests a topic branch command without mutating the repo', () => {
    const root = createRepo('main')
    const pathValue = withStubbedGh(
      root,
      `#!/usr/bin/env sh
printf '%s' '{"title":"Minimal bemoat:agent:issue contract for issue-driven AI workflow","url":"https://github.com/boat1994/bemoat-web-starter/issues/83","body":"","labels":[]}'
`,
    )

    const beforeBranches = spawnSync('git', ['branch', '--list'], {
      cwd: root,
      encoding: 'utf8',
    }).stdout

    const result = runAgentIssue(root, ['83'], { PATH: pathValue })

    const afterBranches = spawnSync('git', ['branch', '--list'], {
      cwd: root,
      encoding: 'utf8',
    }).stdout

    expect(result.status).toBe(1)
    expect(result.stdout).toContain('main is protected and read-only for direct coding')
    expect(result.stdout).toContain(
      "Next manual step: Create a topic branch from the repo's current integration baseline.",
    )
    expect(afterBranches).toBe(beforeBranches)
  })

  it('fails on dev without the integration maintenance bypass', () => {
    const root = createRepo('dev')
    const pathValue = withStubbedGh(
      root,
      `#!/usr/bin/env sh
printf '%s' '{"title":"Minimal bemoat:agent:issue contract for issue-driven AI workflow","url":"https://github.com/boat1994/bemoat-web-starter/issues/83","body":"","labels":[]}'
`,
    )

    const result = runAgentIssue(root, ['83'], { PATH: pathValue })

    expect(result.status).toBe(1)
    expect(result.stdout).toContain('dev is an integration branch, not a routine implementation branch')
  })

  it('fails when the working tree is dirty', () => {
    const root = createRepo('feature/83-agent-issue')
    const pathValue = withStubbedGh(
      root,
      `#!/usr/bin/env sh
echo 'offline test gh stub' >&2
exit 1
`,
    )
    writeFileSync(join(root, 'dirty.txt'), 'pending change\n')

    const result = runAgentIssue(root, ['83'], { PATH: pathValue })

    expect(result.status).toBe(1)
    expect(result.stdout).toContain('Git status --short:\n?? dirty.txt')
    expect(result.stdout).toContain('Working tree: not clean.')
    expect(result.stdout).toContain('Metadata unavailable: offline test gh stub')
    expect(result.stdout).toContain('Report the dirty working tree blocker and do not edit files.')
  })

  it('falls back gracefully when GitHub metadata is unavailable', () => {
    const root = createRepo('feature/83-agent-issue')
    const pathValue = withStubbedGh(
      root,
      `#!/usr/bin/env sh
echo 'authentication required' >&2
exit 1
`,
    )

    const result = runAgentIssue(root, ['83'], { PATH: pathValue })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Metadata unavailable: authentication required')
    expect(result.stdout).toContain(
      'Best-effort issue URL: https://github.com/boat1994/bemoat-web-starter/issues/83',
    )
  })

  it('reports linked Main Issue milestones and next action', () => {
    const root = createRepo('feature/121-agent-issue')
    const planPath = 'docs/superpowers/plans/sample/implementation-plan.md'
    seedTrackedFile(
      root,
      planPath,
      planWithTaskIdentity('## Slice B — Acquisition Handoff\n'),
    )

    const pathValue = withStubbedGh(
      root,
      `#!/usr/bin/env sh
case "$*" in
  *"auth status"*) exit 0 ;;
  *"--version"*) exit 0 ;;
  *"issue view 121"*)
    printf '%s' '{"title":"Slice B task","url":"https://github.com/boat1994/bemoat-web-starter/issues/121","body":"Main Issue: #106\\nImplementation Plan: \`docs/superpowers/plans/sample/implementation-plan.md\`\\nActive PR: #122\\n\\n## Current Stage\\n- Current Slice: Slice B\\n- Relevant plan section: Slice B — Acquisition Handoff\\n\\n## Next Permitted Action\\nFinish the review gate.","labels":[],"state":"OPEN"}'
    ;;
  *"issue view 106"*)
    printf '%s' '{"title":"Growth V1 Main Issue","url":"https://github.com/boat1994/bogus-jewelry/issues/106","body":"## Durable Progress\\n\\n### Slice A — Foundation\\n- [x] Task 1 implementation complete\\n\\n### Slice B — Acquisition Handoff\\n- [ ] Exact-head CI passed","state":"OPEN"}'
    ;;
  *"pr view 122"*)
    printf '%s' '{"title":"Slice B PR","url":"https://github.com/boat1994/bemoat-web-starter/pull/122","headRefName":"feature/121-slice-b","baseRefName":"main","headRefOid":"abc123def456","state":"OPEN","statusCheckRollup":[{"__typename":"CheckRun","conclusion":"SUCCESS","detailsUrl":"https://github.com/boat1994/bemoat-web-starter/actions/runs/1/job/1","name":"ci","status":"COMPLETED","workflowName":"CI"}],"commits":[]}'
    ;;
  *)
    echo "unexpected gh call: $*" >&2
    exit 1
    ;;
esac
`,
    )

    const result = runAgentIssue(root, ['121'], { PATH: pathValue })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Declared Main Issue: #106')
    expect(result.stdout).toContain('First incomplete milestone: Slice B — Acquisition Handoff — Exact-head CI passed')
    expect(result.stdout).toContain('Relevant plan section: Slice B — Acquisition Handoff')
    expect(result.stdout).toContain('Next permitted action: Finish the review gate.')
    expect(result.stdout).toContain('Exact-head CI: Exact-head CI verified for abc123d (1 successful check(s)).')
    expect(result.stdout).not.toContain('Hard blockers:')
  })

  it('blocks whenever a declared Active PR cannot be resolved', () => {
    const root = createRepo('feature/210-agent-issue')
    const analysis = analyzeProgressTracking({
      cwd: root,
      activeIssueBody: 'Active PR: #999\n\n## Goal\nImplement something small.',
      env: {
        ...process.env,
        PATH: withStubbedGh(
          root,
          `#!/usr/bin/env sh
case "$*" in
  *"pr view 999"*)
    echo 'not found' >&2
    exit 1
    ;;
  *)
    echo "unexpected gh call: $*" >&2
    exit 1
    ;;
esac
`,
        ),
      },
    })

    expect(analysis.blockers.join(' ')).toContain('Declared Active PR could not be identified: #999')
  })

  it('blocks when the active task targets a later slice than the Main Issue prerequisite', () => {
    const root = createRepo('feature/211-agent-issue')
    const analysis = analyzeProgressTracking({
      cwd: root,
      activeIssueBody: `
Main Issue: #106

## Current Stage
- Current Slice: Slice C — Checkout
`,
      env: {
        ...process.env,
        PATH: withStubbedGh(
          root,
          `#!/usr/bin/env sh
case "$*" in
  *"issue view 106"*)
    printf '%s' '{"title":"Growth V1 Main Issue","url":"https://github.com/boat1994/bogus-jewelry/issues/106","body":"## Durable Progress\\n\\n### Slice B — Acquisition Handoff\\n- [ ] Exact-head CI passed","state":"OPEN"}'
    ;;
  *)
    echo "unexpected gh call: $*" >&2
    exit 1
    ;;
esac
`,
        ),
      },
    })

    expect(analysis.blockers.join(' ')).toContain(
      'Main Issue prerequisite milestone remains incomplete in Slice B — Acquisition Handoff',
    )
  })

  it('blocks when linked Main Issue reports blocking findings', () => {
    const root = createRepo('feature/212-agent-issue')
    const analysis = analyzeProgressTracking({
      cwd: root,
      activeIssueBody: 'Main Issue: #106',
      env: {
        ...process.env,
        PATH: withStubbedGh(
          root,
          `#!/usr/bin/env sh
case "$*" in
  *"issue view 106"*)
    printf '%s' '{"title":"Growth V1 Main Issue","url":"https://github.com/boat1994/bogus-jewelry/issues/106","body":"## Current Stage\\n- Blocking findings: Critical auth regression open\\n\\n## Durable Progress\\n- [ ] Exact-head CI passed","state":"OPEN"}'
    ;;
  *)
    echo "unexpected gh call: $*" >&2
    exit 1
    ;;
esac
`,
        ),
      },
    })

    expect(analysis.blockers.join(' ')).toContain(
      'Unresolved Critical or Important findings on Main Issue block dependent work',
    )
  })

  it('blocks when a declared Main Issue or Implementation Plan cannot be resolved', () => {
    const root = createRepo('feature/200-agent-issue')
    const pathValue = withStubbedGh(
      root,
      `#!/usr/bin/env sh
case "$*" in
  *"issue view 200"*)
    printf '%s' '{"title":"Broken linkage","url":"https://github.com/boat1994/bemoat-web-starter/issues/200","body":"Main Issue: #999\\nImplementation Plan: \`docs/missing-plan.md\`","labels":[]}'
    ;;
  *"issue view 999"*)
    echo 'Could not resolve to an issue' >&2
    exit 1
    ;;
  *)
    echo "unexpected gh call: $*" >&2
    exit 1
    ;;
esac
`,
    )

    const result = runAgentIssue(root, ['200'], { PATH: pathValue })

    expect(result.status).toBe(1)
    expect(result.stdout).toContain('Hard blockers:')
    expect(result.stdout).toContain('Declared Main Issue could not be found: #999')
    expect(result.stdout).toContain('Implementation Plan path does not exist: docs/missing-plan.md')
    expect(result.stdout).toContain(
      'Resolve the progress-tracking blockers above before continuing implementation.',
    )
  })

  it('warns when older CI exists but exact-head verification is not confirmed', () => {
    const root = createRepo('feature/201-agent-issue')
    const analysis = analyzeProgressTracking({
      cwd: root,
      activeIssueBody: `
Active PR: #130

## Durable Progress
- [ ] Exact-head CI passed
`,
      env: {
        ...process.env,
        PATH: withStubbedGh(
          root,
          `#!/usr/bin/env sh
case "$*" in
  *"pr view 130"*)
    printf '%s' '{"title":"Older CI PR","url":"https://github.com/boat1994/bemoat-web-starter/pull/130","headRefName":"feature/201","baseRefName":"main","headRefOid":"currentheadsha111","state":"OPEN","statusCheckRollup":{"contexts":[{"state":"SUCCESS","targetUrl":"https://github.com/runs/oldsha999"}]},"commits":[]}'
    ;;
  *)
    echo "unexpected gh call: $*" >&2
    exit 1
    ;;
esac
`,
        ),
      },
    })

    expect(analysis.warnings.join(' ')).toContain('older SHA')
    expect(analysis.report.exactHeadCi?.exactHeadVerified).toBe(false)
  })

  it('keeps preflight read-only through the exported runner', () => {
    const root = createRepo('feature/101-agent-issue')
    const beforeStatus = spawnSync('git', ['status', '--short'], {
      cwd: root,
      encoding: 'utf8',
    }).stdout

    const report = runAgentIssuePreflight({
      cwd: root,
      argv: ['101'],
      env: {
        ...process.env,
        PATH: withStubbedGh(
          root,
          `#!/usr/bin/env sh
printf '%s' '{"title":"Harness task","url":"https://github.com/boat1994/bemoat-web-starter/issues/101","body":"Small task","labels":[]}'
`,
        ),
      },
    })

    const afterStatus = spawnSync('git', ['status', '--short'], {
      cwd: root,
      encoding: 'utf8',
    }).stdout

    expect(report.ok).toBe(true)
    expect(beforeStatus).toBe(afterStatus)
  })

  it('warns, rather than blocks, when a standalone Core task has no managed state', () => {
    const root = createRepo('feature/115-standalone-core')
    const analysis = analyzeProgressTracking({
      cwd: root,
      activeIssueBody: 'Task size: Core\n\n## Goal\nBounded standalone correction.',
    })

    expect(analysis.blockers).toEqual([])
    expect(analysis.warnings.join(' ')).toContain('Mission Control state is absent')
  })

  it('requires managed state for an explicitly required task and rejects malformed state', () => {
    const root = createRepo('feature/115-malformed-state')
    const analysis = analyzeProgressTracking({
      cwd: root,
      activeIssueBody: `
Task size: Core
Mission Control mode: required
<!-- bemoat-mission-control-state:start -->
schema_version: 1
state: NOT_A_STATE
<!-- bemoat-mission-control-state:end -->`,
    })

    expect(analysis.blockers.join(' ')).toContain('STATE_MIGRATION_REQUIRED')
  })

  it('requires a state block for legacy Core tasks with both Main Issue and Implementation Plan', () => {
    const root = createRepo('feature/115-legacy-state')
    const planPath = 'docs/superpowers/plans/sample/implementation-plan.md'
    seedTrackedFile(root, planPath, '# Implementation Plan\n')
    const analysis = analyzeProgressTracking({
      cwd: root,
      activeIssueBody: `Task size: Core
Main Issue: #106
Implementation Plan: \`${planPath}\``,
      env: {
        ...process.env,
        PATH: withStubbedGh(
          root,
          `#!/usr/bin/env sh
printf '%s' '{"title":"Main","url":"https://github.com/boat1994/bemoat-web-starter/issues/106","body":"","state":"OPEN"}'
`,
        ),
      },
    })

    expect(analysis.blockers.join(' ')).toContain('STATE_MIGRATION_REQUIRED')
  })

  it('blocks state conflicts when the recorded PR head disagrees with live evidence', () => {
    const root = createRepo('feature/115-state-conflict')
    const analysis = analyzeProgressTracking({
      cwd: root,
      activeIssueBody: `
Task size: Core
Mission Control mode: required
<!-- bemoat-mission-control-state:start -->
schema_version: 1
state: IN_PROGRESS
review_cycle: 0
full_review_count: 0
approved_base: main
active_task_issue: "115"
active_pr: "116"
current_head: oldhead
last_reviewed_head: null
guide_version: 1.0.0
guide_source_ref: main
guide_source_sha: null
open_blockers: []
follow_up_issues: []
next_permitted_action: "Implement"
material_change_status: none
updated_at: null
updated_by: null
<!-- bemoat-mission-control-state:end -->`,
      env: {
        ...process.env,
        PATH: withStubbedGh(
          root,
          `#!/usr/bin/env sh
case "$*" in
  *"pr view 116"*) printf '%s' '{"title":"PR","url":"https://github.com/boat1994/bemoat-web-starter/pull/116","headRefName":"feature/115","baseRefName":"main","headRefOid":"newhead","state":"OPEN","statusCheckRollup":[],"commits":[]}' ;;
  *) echo "unexpected gh call: $*" >&2; exit 1 ;;
esac
`,
        ),
      },
    })

    expect(analysis.blockers.join(' ')).toContain('STATE_CONFLICT')
  })

  it('does not warn for a future Founder milestone after the current incomplete task', () => {
    const root = createRepo('feature/115-founder-ordering')
    const analysis = analyzeProgressTracking({
      cwd: root,
      activeIssueBody: `
## Durable Progress
### Slice A
- [ ] Implement current task
### Slice B
- [ ] Founder merge approval

## Current Stage
- Current Task or gate: Implement current task`,
    })

    expect(analysis.warnings.join(' ')).not.toContain('Founder gate remains open')
  })

  it('parses required mode and Core tier from GitHub Issue Form headings', () => {
    const declarations = parseIssueDeclarations(`
### Task size

core

### Mission Control mode

required`)

    expect(declarations.taskSize).toBe('core')
    expect(declarations.missionControlMode).toBe('required')
  })

  it('derives FAST, STANDARD, and MANAGED profiles from the declared tier and mode', () => {
    expect(
      deriveWorkflowProfile({
        taskSize: 'small',
        missionControlMode: 'optional',
      }),
    ).toMatchObject({ name: 'FAST' })
    expect(
      deriveWorkflowProfile({
        taskSize: 'medium',
        missionControlMode: 'optional',
      }),
    ).toMatchObject({ name: 'STANDARD' })
    expect(
      deriveWorkflowProfile({
        taskSize: 'core',
        missionControlMode: 'required',
      }),
    ).toMatchObject({ name: 'MANAGED' })
    expect(
      deriveWorkflowProfile({
        taskSize: 'core',
        missionControlMode: 'optional',
        declaresMainIssue: true,
        declaresImplementationPlan: true,
      }),
    ).toMatchObject({ name: 'MANAGED' })
    expect(
      deriveWorkflowProfile({
        taskSize: 'small',
        missionControlMode: 'unsure',
      }),
    ).toMatchObject({ name: 'STANDARD' })
  })

  it('parses bullet-style Tier and not required mode, then reports a compact FAST preflight next action', () => {
    const declarations = parseIssueDeclarations(`
- Tier: Small
- Mission Control mode: not required`)

    expect(declarations.taskSize).toBe('small')
    expect(declarations.missionControlMode).toBe('optional')

    const root = createRepo('feature/119-fast-profile')
    const report = runAgentIssuePreflight({
      cwd: root,
      argv: ['119'],
      env: {
        ...process.env,
        PATH: withStubbedGh(
          root,
          `#!/usr/bin/env sh
printf '%s' '{"title":"FAST profile","url":"https://github.com/boat1994/bemoat-web-starter/issues/119","body":"- Tier: Small\\n- Mission Control mode: not required","labels":[]}'`,
        ),
      },
    })

    expect(report.output).toContain('Workflow profile: FAST')
    expect(report.output.join('\n')).toContain(
      'Profile next action: Follow the FAST lifecycle: focused implementation and verification',
    )
  })

  it('parses unsure Mission Control mode for deterministic conservative routing', () => {
    const declarations = parseIssueDeclarations(`
- Tier: Small
- Mission Control mode: unsure`)

    expect(declarations.missionControlMode).toBe('unsure')
    expect(deriveWorkflowProfile(declarations)).toMatchObject({ name: 'STANDARD' })
  })

  it('requires state for a form-created managed task', () => {
    const analysis = analyzeProgressTracking({
      activeIssueBody: `### Task size

core

### Mission Control mode

required`,
    })

    expect(analysis.blockers.join(' ')).toContain('STATE_MIGRATION_REQUIRED')
  })

  it('accepts a valid v1 state block with non-empty YAML lists', () => {
    const state = parseMissionControlState(managedState({
      open_blockers: '\n  - await exact-head CI',
      follow_up_issues: '\n  - "#117"',
    }))

    expect(state.valid).toBe(true)
    expect(state.state?.open_blockers).toEqual(['await exact-head CI'])
    expect(state.state?.follow_up_issues).toEqual(['#117'])
  })

  it('rejects duplicate or unbalanced state marker blocks', () => {
    expect(parseMissionControlState(`${managedState()}\n<!-- bemoat-mission-control-state:start -->`)).toMatchObject({
      valid: false,
      reason: expect.stringContaining('exactly one balanced'),
    })
    expect(parseMissionControlState('<!-- bemoat-mission-control-state:end -->')).toMatchObject({
      valid: false,
      reason: expect.stringContaining('exactly one balanced'),
    })
  })

  it('rejects unsupported schemas and impossible review counters', () => {
    expect(parseMissionControlState(managedState({ schema_version: '2' }))).toMatchObject({
      valid: false,
      reason: 'unsupported schema_version',
    })
    expect(parseMissionControlState(managedState({
      state: 'AWAITING_REVIEW_2',
      review_cycle: '1',
      full_review_count: '0',
      last_reviewed_head: 'oldhead',
    }))).toMatchObject({
      valid: false,
      reason: expect.stringContaining('full_review_count'),
    })
  })

  it('accepts mandatory preflight for a completed Review 4 followed by a Founder-authorized correction', () => {
    const root = createRepo('feature/155-github-comment-projection')
    const analysis = analyzeProgressTracking({
      cwd: root,
      activeIssueNumber: '155',
      activeIssueBody: `Task size: Core
Mission Control mode: required
${managedState({
  state: 'IN_PROGRESS',
  review_cycle: '3',
  full_review_count: '1',
  active_task_issue: '"155"',
  active_pr: '"157"',
  current_head: 'correction-head',
  last_reviewed_head: 'review-4-head',
  post_budget_reviews: `
  - review_number: 4
    reviewed_head: review-4-head
    verdict: BLOCKED FOR FOUNDER DECISION
    authorization:
      status: approved
      authority: Founder
      scope: review
      review_number: 4
      reviewed_head: review-4-head
      action: "Authorize bounded Review 4"
      authorized_at: "2026-07-23T15:00:00Z"
    finding_dispositions:
      - finding_id: MC-R1-002
        disposition: open`,
  founder_decision: `
  status: approved
  authority: Founder
  scope: correction
  for_review_number: 4
  reviewed_head: review-4-head
  finding_ids:
    - MC-R1-002
  action: "Authorize one bounded correction for MC-R1-002"
  authorized_at: "2026-07-23T16:00:00Z"`,
  open_blockers: '\n  - MC-R1-002',
  next_permitted_action: '"Dev executes only the authorized MC-R1-002 correction"',
})}`,
      env: {
        ...process.env,
        PATH: withStubbedGh(root, `#!/usr/bin/env sh
case "$*" in
  *"issue view 155"*) printf '%s' '{"comments":[]}' ;;
  *"pr view 157"*) printf '%s' '{"title":"PR","url":"https://github.com/boat1994/bemoat-web-starter/pull/157","headRefName":"feature/155-github-comment-projection","baseRefName":"main","headRefOid":"correction-head","state":"OPEN","statusCheckRollup":[],"commits":[]}' ;;
  *) echo "unexpected gh call: $*" >&2; exit 1 ;;
esac
`),
      },
    })

    expect(analysis.report.missionControlState).toMatchObject({ valid: true })
    expect(analysis.blockers).toEqual([])
    expect(analysis.report.pr).toMatchObject({
      url: 'https://github.com/boat1994/bemoat-web-starter/pull/157',
      headRefOid: 'correction-head',
    })
  })

  it('blocks a task, PR, base, and head mismatch against live state', () => {
    const root = createRepo('feature/115-live-conflicts')
    const analysis = analyzeProgressTracking({
      cwd: root,
      activeIssueNumber: '115',
      activeIssueBody: `Mission Control mode: required
Active PR: #117
${managedState({ active_task_issue: '"114"', approved_base: 'dev', current_head: 'oldhead' })}`,
      env: {
        ...process.env,
        PATH: withStubbedGh(root, `#!/usr/bin/env sh
case "$*" in
  *"pr view 117"*) printf '%s' '{"title":"PR","url":"https://github.com/boat1994/bemoat-web-starter/pull/117","headRefName":"feature/115","baseRefName":"main","headRefOid":"newhead","state":"OPEN","statusCheckRollup":[],"commits":[]}' ;;
  *) echo "unexpected gh call: $*" >&2; exit 1 ;;
esac
`),
      },
    })

    expect(analysis.blockers.filter((blocker: string) => blocker.includes('STATE_CONFLICT'))).toHaveLength(5)
  })

  it('blocks DONE when its active PR is not merged', () => {
    const root = createRepo('feature/115-terminal-conflict')
    const analysis = analyzeProgressTracking({
      cwd: root,
      activeIssueNumber: '115',
      activeIssueBody: `Mission Control mode: required
${managedState({ state: 'DONE', review_cycle: '1', full_review_count: '1', last_reviewed_head: 'newhead' })}`,
      env: {
        ...process.env,
        PATH: withStubbedGh(root, `#!/usr/bin/env sh
printf '%s' '{"title":"PR","url":"https://github.com/boat1994/bemoat-web-starter/pull/116","headRefName":"feature/115","baseRefName":"main","headRefOid":"newhead","state":"OPEN","statusCheckRollup":[],"commits":[]}'
`),
      },
    })

    expect(analysis.blockers.join(' ')).toContain('STATE_CONFLICT')
  })

  it('classifies closed Issue plus merged exact reviewed PR as terminal repair instead of STATE_CONFLICT', () => {
    const root = createRepo('feature/155-terminal-repair')
    const analysis = analyzeProgressTracking({
      cwd: root,
      activeIssueNumber: '155',
      activeIssueState: 'closed',
      activeIssueBody: `Mission Control mode: required
${managedState({
  state: 'ELIGIBLE_FOR_FOUNDER_REVIEW',
  review_cycle: '3',
  full_review_count: '1',
  active_task_issue: '"#155"',
  active_pr: '"#157"',
  current_head: 'reviewed-head',
  last_reviewed_head: 'reviewed-head',
  open_blockers: '[]',
})}`,
      env: {
        ...process.env,
        PATH: withStubbedGh(root, `#!/usr/bin/env sh
printf '%s' '{"title":"PR","url":"https://github.com/boat1994/bemoat-web-starter/pull/157","headRefName":"feature/155-terminal-repair","baseRefName":"main","headRefOid":"reviewed-head","state":"MERGED","mergeCommit":{"oid":"merge-commit"},"statusCheckRollup":[{"name":"ci","conclusion":"SUCCESS"}],"commits":[]}'
`),
      },
    })

    expect(analysis.blockers).not.toContain(expect.stringContaining('merged PR completion'))
    expect(analysis.report.reconciliation).toMatchObject({
      classification: { outcome: 'TERMINAL_REPAIR' },
      proposal: { type: 'terminal', fields: { state: 'DONE' } },
    })
  })

  it('keeps an already-DONE task terminal when current_head stores the merge commit', () => {
    const root = createRepo('feature/155-terminal-noop')
    const analysis = analyzeProgressTracking({
      cwd: root,
      activeIssueNumber: '155',
      activeIssueState: 'closed',
      activeIssueBody: `Mission Control mode: required
${managedState({
  state: 'DONE',
  review_cycle: '3',
  full_review_count: '1',
  active_task_issue: '"#155"',
  active_pr: '"#157"',
  current_head: 'merge-commit',
  last_reviewed_head: 'reviewed-head',
  open_blockers: '[]',
})}`,
      env: {
        ...process.env,
        PATH: withStubbedGh(root, `#!/usr/bin/env sh
printf '%s' '{"title":"PR","url":"https://github.com/boat1994/bemoat-web-starter/pull/157","headRefName":"feature/155-terminal-noop","baseRefName":"main","headRefOid":"reviewed-head","state":"MERGED","mergeCommit":{"oid":"merge-commit"},"statusCheckRollup":[{"name":"ci","conclusion":"SUCCESS"}],"commits":[]}'
`),
      },
    })

    expect(analysis.blockers).not.toContain(expect.stringContaining('STATE_CONFLICT'))
    expect(analysis.report.reconciliation).toMatchObject({
      classification: { outcome: 'NO_OP' },
      proposal: null,
    })
  })

  it('surfaces recorded terminal classifications and unavailable required PR evidence as blockers', () => {
    const root = createRepo('feature/115-external-state')
    const conflict = analyzeProgressTracking({
      cwd: root,
      activeIssueBody: `Mission Control mode: required
${managedState({ state: 'STATE_CONFLICT', active_pr: 'null', current_head: 'null' })}`,
    })
    const unavailable = analyzeProgressTracking({
      cwd: root,
      activeIssueBody: `Mission Control mode: required
${managedState({ state: 'AWAITING_REVIEW_1' })}`,
      env: { ...process.env, PATH: withStubbedGh(root, '#!/usr/bin/env sh\necho offline >&2\nexit 1\n') },
    })

    expect(conflict.blockers.join(' ')).toContain('STATE_CONFLICT')
    expect(unavailable.blockers.join(' ')).toContain('BLOCKED_EXTERNAL')
  })

  it('routes repairable recorded legacy state through production reconciliation without treating it as contradictory authority', () => {
    const root = createRepo('feature/155-legacy-reconcile')
    const analysis = analyzeProgressTracking({
      cwd: root,
      activeIssueNumber: '155',
      activeIssueBody: `Mission Control mode: required
${managedState({
  state: 'STATE_CONFLICT', review_cycle: '1', full_review_count: '1', last_reviewed_head: 'reviewed-head',
  active_task_issue: '"155"', active_pr: '"157"', current_head: 'reviewed-head',
  post_budget_review_history: '[]',
})}`,
      env: {
        ...process.env,
        PATH: withStubbedGh(root, `#!/usr/bin/env sh
case "$*" in
  *"pr view 157"*) printf '%s' '{"title":"PR","url":"https://github.com/boat1994/bemoat-web-starter/pull/157","headRefName":"feature/155","baseRefName":"main","headRefOid":"reviewed-head","state":"OPEN","statusCheckRollup":[{"name":"ci","conclusion":"SUCCESS"}],"commits":[]}' ;;
  *) echo "unexpected gh call: $*" >&2; exit 1 ;;
esac
`),
      },
    })

    expect(analysis.blockers.join(' ')).not.toContain('recorded Mission Control state requires reconciliation')
    expect(analysis.report.reconciliation).toMatchObject({ classification: { outcome: 'DETERMINISTIC_MIGRATION' } })
  })

  it('propagates unavailable required production evidence into reconciliation as BLOCKED_EXTERNAL', () => {
    const root = createRepo('feature/160-blocked-external')
    const analysis = analyzeProgressTracking({
      cwd: root,
      activeIssueNumber: '160',
      activeIssueBody: `Mission Control mode: required
${managedState({ state: 'AWAITING_REVIEW_2', review_cycle: '1', full_review_count: '1', last_reviewed_head: 'reviewed-head' })}`,
      env: {
        ...process.env,
        PATH: withStubbedGh(root, `#!/usr/bin/env sh
case "$*" in
  *"issue view 160"*"comments"*) printf '%s' '{"comments":[]}' ;;
  *"pr view 116"*) echo offline >&2; exit 1 ;;
  *) echo "unexpected gh call: $*" >&2; exit 1 ;;
esac
`),
      },
    })

    expect(analysis.blockers.join(' ')).toContain('BLOCKED_EXTERNAL')
    expect(analysis.report.reconciliation).toMatchObject({ classification: { outcome: 'BLOCKED_EXTERNAL' } })
  })

  it('blocks when the declared current stage is a Founder gate', () => {
    const analysis = analyzeProgressTracking({
      activeIssueBody: `## Current Stage
- Current Task or gate: Founder merge approval`,
    })

    expect(analysis.blockers.join(' ')).toContain('Founder gate remains open')
  })

  it('surfaces deterministic delivery reconciliation for stale post-RESULT state', () => {
    const root = createRepo('feature/120-delivery-reconcile')
    const resultComment = [
      '## RESULT',
      '',
      '**Completed:** Dev (implementation)',
      '**State:** branch `feature/120` · base `main` · head `abc1234`',
      '**PR:** https://github.com/boat1994/bemoat-web-starter/pull/121',
      '**Summary:** delivery complete',
      '**Next:** Reviewer ## REVIEW_VERDICT',
    ].join('\n')
    const commentsPayload = JSON.stringify({
      comments: [{ body: resultComment, createdAt: '2026-07-17T10:00:00+07:00' }],
    }).replace(/'/g, `'\"'\"'`)

    const analysis = analyzeProgressTracking({
      cwd: root,
      activeIssueNumber: '120',
      activeIssueBody: `Mission Control mode: required
${managedState({ state: 'IN_PROGRESS', active_pr: 'null', current_head: 'null', active_task_issue: '"120"' })}`,
      env: {
        ...process.env,
        PATH: withStubbedGh(
          root,
          `#!/usr/bin/env sh
case "$*" in
  *"issue view 120"*"comments"*) printf '%s' '${commentsPayload}' ;;
  *"pr view 121"*) printf '%s' '{"title":"PR","url":"https://github.com/boat1994/bemoat-web-starter/pull/121","headRefName":"feature/120","baseRefName":"main","headRefOid":"abc1234","state":"OPEN","statusCheckRollup":[{"__typename":"CheckRun","conclusion":"SUCCESS","status":"COMPLETED","name":"ci"}],"commits":[]}' ;;
  *) echo "unexpected gh call: $*" >&2; exit 1 ;;
esac
`,
        ),
      },
    })

    expect(analysis.blockers.filter((blocker: string) => blocker.includes('STATE_CONFLICT'))).toHaveLength(0)
    expect(analysis.report.reconciliation?.proposal?.type).toBe('delivery')
    expect(analysis.warnings.join(' ')).toContain('Deterministic delivery reconciliation available')
  })

  it('blocks when RESULT PR provenance does not match the live Active PR', () => {
    const root = createRepo('feature/120-delivery-pr-mismatch')
    const resultComment = [
      '## RESULT',
      '',
      '**Completed:** Dev (implementation)',
      '**State:** branch `feature/120` · base `main` · head `abc1234`',
      '**PR:** https://github.com/boat1994/bemoat-web-starter/pull/121',
      '**Summary:** delivery complete',
      '**Next:** Reviewer ## REVIEW_VERDICT',
    ].join('\n')
    const commentsPayload = JSON.stringify({
      comments: [{ body: resultComment, createdAt: '2026-07-17T10:00:00+07:00' }],
    }).replace(/'/g, `'\"'\"'`)

    const analysis = analyzeProgressTracking({
      cwd: root,
      activeIssueNumber: '120',
      activeIssueBody: `Mission Control mode: required
${managedState({ state: 'IN_PROGRESS', active_pr: '"123"', current_head: 'null', active_task_issue: '"120"' })}`,
      env: {
        ...process.env,
        PATH: withStubbedGh(
          root,
          `#!/usr/bin/env sh
case "$*" in
  *"issue view 120"*"comments"*) printf '%s' '${commentsPayload}' ;;
  *"pr view 123"*) printf '%s' '{"title":"PR","url":"https://github.com/boat1994/bemoat-web-starter/pull/123","headRefName":"feature/120","baseRefName":"main","headRefOid":"abc1234","state":"OPEN","statusCheckRollup":[{"__typename":"CheckRun","conclusion":"SUCCESS","status":"COMPLETED","name":"ci"}],"commits":[]}' ;;
  *) echo "unexpected gh call: $*" >&2; exit 1 ;;
esac
`,
        ),
      },
    })

    expect(analysis.blockers.join(' ')).toContain('STATE_CONFLICT: RESULT PR does not match live PR')
    expect(analysis.report.reconciliation?.proposal).toBeNull()
  })

  it('blocks when RESULT omits a PR identifier', () => {
    const root = createRepo('feature/120-delivery-pr-missing')
    const resultComment = [
      '## RESULT',
      '',
      '**Completed:** Dev (implementation)',
      '**State:** branch `feature/120` · base `main` · head `abc1234`',
      '**Summary:** delivery complete',
      '**Next:** Reviewer ## REVIEW_VERDICT',
    ].join('\n')
    const commentsPayload = JSON.stringify({
      comments: [{ body: resultComment, createdAt: '2026-07-17T10:00:00+07:00' }],
    }).replace(/'/g, `'\"'\"'`)

    const analysis = analyzeProgressTracking({
      cwd: root,
      activeIssueNumber: '120',
      activeIssueBody: `Mission Control mode: required
${managedState({ state: 'IN_PROGRESS', active_pr: '"123"', current_head: 'null', active_task_issue: '"120"' })}`,
      env: {
        ...process.env,
        PATH: withStubbedGh(
          root,
          `#!/usr/bin/env sh
case "$*" in
  *"issue view 120"*"comments"*) printf '%s' '${commentsPayload}' ;;
  *"pr view 123"*) printf '%s' '{"title":"PR","url":"https://github.com/boat1994/bemoat-web-starter/pull/123","headRefName":"feature/120","baseRefName":"main","headRefOid":"abc1234","state":"OPEN","statusCheckRollup":[{"__typename":"CheckRun","conclusion":"SUCCESS","status":"COMPLETED","name":"ci"}],"commits":[]}' ;;
  *) echo "unexpected gh call: $*" >&2; exit 1 ;;
esac
`,
        ),
      },
    })

    expect(analysis.blockers.join(' ')).toContain('STATE_CONFLICT: RESULT PR identifier missing')
    expect(analysis.report.reconciliation?.proposal).toBeNull()
  })

  it('prints a compact correction capsule when --phase correction reconstructs canonical findings', () => {
    const root = createRepo('feature/136-immutable-correction-contract')
    const verdictBody = `## REVIEW_VERDICT
**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/200 · \`main\` · \`abc1234\`
**Verdict:** CORRECTION REQUIRED
**Findings:** Important: boundary bug
**Gates:** exact-head CI https://example.test/ci → pass
**Next:** Dev posts correction RESULT

\`\`\`json
{
  "schema_version": 1,
  "reviewed_head": "abc1234",
  "findings": [
    {
      "id": "MC-R1-001",
      "canonical_summary": "supplied-timezone month boundaries are incorrect",
      "source_thread": "https://github.com/boat1994/bemoat-web-starter/pull/200#discussion_r1",
      "required_evidence": ["Bangkok exact UTC boundary"],
      "expected_areas": ["month boundary calculation"],
      "prohibited_areas": ["src/unrelated/reversal.ts"]
    }
  ]
}
\`\`\`
`
    const commentsPayload = JSON.stringify({
      comments: [{ body: verdictBody, createdAt: '2026-07-20T10:00:00+07:00' }],
    }).replace(/'/g, `'\"'\"'`)

    const result = runAgentIssue(root, ['136', '--phase', 'correction'], {
      PATH: withStubbedGh(
        root,
        `#!/usr/bin/env sh
case "$*" in
  *"issue view 136"*"title,url,body,labels"*)
    printf '%s' '{"title":"Immutable correction contract","url":"https://github.com/boat1994/bemoat-web-starter/issues/136","body":"## Goal\\nImplement Minimal Hybrid.","labels":[]}'
    ;;
  *"issue view 136"*"comments"*)
    printf '%s' '${commentsPayload}'
    ;;
  *"pr view 200"*)
    printf '%s' '{"title":"Correction PR","url":"https://github.com/boat1994/bemoat-web-starter/pull/200","headRefName":"feature/136","baseRefName":"main","headRefOid":"abc1234","state":"OPEN","statusCheckRollup":[],"commits":[]}'
    ;;
  *)
    echo "unexpected gh call: $*" >&2
    exit 1
    ;;
esac
`,
      ),
    })

    expect(result.status, result.stderr || result.stdout).toBe(0)
    expect(result.stdout).toContain('Correction capsule')
    expect(result.stdout).toContain('Playback verified: 1/1 canonical findings')
    expect(result.stdout).toContain('MC-R1-001: supplied-timezone month boundaries are incorrect')
    expect(result.stdout).not.toContain('Docs to read before implementation:')
  })

  it.each([
    ['missing', 'Mission Control mode: required\n'],
    ['malformed', 'Mission Control mode: required\n<!-- bemoat-mission-control-state:start -->\n```yaml\nstate: IN_PROGRESS\n```\n'],
  ])('fails closed when managed state is %s during correction preflight', (_name, issueBody) => {
    const root = createRepo('feature/136-immutable-correction-contract')
    const verdictBody = `## REVIEW_VERDICT
**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/200 · \`main\` · \`abc1234\`
**Verdict:** CORRECTION REQUIRED
\`\`\`json
{"schema_version":1,"reviewed_head":"abc1234","findings":[{"id":"MC-R1-001","canonical_summary":"boundary bug","source_thread":"https://github.com/boat1994/bemoat-web-starter/pull/200#discussion_r1","required_evidence":["executable negative"]}]}
\`\`\``
    const fixtureDir = mkdtempSync(join(tmpdir(), 'bemoat-agent-issue-state-'))
    tempRoots.push(fixtureDir)
    const issuePath = join(fixtureDir, 'issue.json')
    const commentsPath = join(fixtureDir, 'comments.json')
    writeFileSync(issuePath, JSON.stringify({ title: 'Managed correction', url: 'https://github.com/boat1994/bemoat-web-starter/issues/136', body: issueBody, labels: [] }))
    writeFileSync(commentsPath, JSON.stringify({ comments: [{ id: '2', body: verdictBody, createdAt: '2026-07-20T10:00:00Z' }] }))
    const result = runAgentIssue(root, ['136', '--phase', 'correction'], {
      PATH: withStubbedGh(root, `#!/usr/bin/env sh
case "$*" in
  *"issue view 136"*"title,url,body,labels"*) cat "${issuePath}" ;;
  *"issue view 136"*"comments"*) cat "${commentsPath}" ;;
  *) echo "unexpected gh call: $*" >&2; exit 1 ;;
esac
`),
    })

    expect(result.status).toBe(1)
    expect(result.stdout).toMatch(/managed Mission Control state.*missing or invalid/i)
    expect(result.stdout).not.toContain('Edit authorization: granted')
  })

  it.each([
    ['valid', (_comments: any[], _authorization: any): void => undefined, 0],
    ['edited', (comments: any[], _authorization: any) => { comments[0].body += '\nsubstituted content' }, 1],
    ['deleted', (comments: any[], _authorization: any) => { comments.shift() }, 1],
    ['superseded', (comments: any[], _authorization: any) => { comments.push({ id: '3', body: '## HANDOFF\n\n**Target:** Dev\n**Objective:** superseding correction', createdAt: '2026-07-20T10:30:00Z', updatedAt: '2026-07-20T10:30:00Z' }) }, 1],
    ['missing authority snapshot', (_comments: any[], authorization: any) => { delete authorization.handoff_binding.authorization_snapshot }, 1],
  ])('handles a %s bound HANDOFF through the executable correction preflight', (_name, mutate, expectedStatus) => {
    const root = createRepo('feature/136-immutable-correction-contract')
    const authorization: any = {
      schema_version: 2, authorization_id: 'founder-r3-abc', status: 'consumed', authority: 'Founder',
      scope: 'correction', for_review_number: 3, reviewed_head: 'abc1234', finding_ids: ['MC-R1-001'],
      action: 'Authorize one bounded correction', authorized_at: '2026-07-20T09:00:00Z', handoff_comment_id: '1',
    }
    const state: any = {
      schema_version: 1, state: 'IN_PROGRESS', review_cycle: 3, full_review_count: 1,
      approved_base: 'main', active_task_issue: '#136', active_pr: '#200', current_head: 'abc1234',
      last_reviewed_head: 'abc1234', post_budget_reviews: [], founder_correction_authorization: authorization,
      guide_version: '1.2.0', guide_source_ref: 'main', guide_source_sha: null, open_blockers: ['MC-R1-001'],
      follow_up_issues: [], next_permitted_action: 'Execute bounded correction', material_change_status: 'none',
      updated_at: '2026-07-20T09:00:00Z', updated_by: 'Mission Control',
    }
    const handoff = {
      id: '1', body: '## HANDOFF\n\n**Target:** Dev / Integration Builder\n**Objective:** bounded correction\n**Founder correction authorization:** `founder-r3-abc`',
      createdAt: '2026-07-20T10:00:00Z', updatedAt: '2026-07-20T10:00:00Z',
    }
    authorization.handoff_binding = buildCorrectionHandoffBinding({ authorization, state, handoffBody: handoff.body, handoff })
    const verdict = {
      id: '2', createdAt: '2026-07-20T10:10:00Z', updatedAt: '2026-07-20T10:10:00Z',
      body: `## REVIEW_VERDICT
**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/200 · \`main\` · \`abc1234\`
**Verdict:** CORRECTION REQUIRED
\`\`\`json
{"schema_version":1,"reviewed_head":"abc1234","findings":[{"id":"MC-R1-001","canonical_summary":"boundary bug","source_thread":"https://github.com/boat1994/bemoat-web-starter/pull/200#discussion_r1","required_evidence":["executable negative"]}]}
\`\`\``,
    }
    const comments = [handoff, verdict]
    mutate(comments, authorization)
    const fixtureDir = mkdtempSync(join(tmpdir(), 'bemoat-agent-issue-binding-'))
    tempRoots.push(fixtureDir)
    const issuePath = join(fixtureDir, 'issue.json')
    const commentsPath = join(fixtureDir, 'comments.json')
    writeFileSync(issuePath, JSON.stringify({
      title: 'Managed correction', url: 'https://github.com/boat1994/bemoat-web-starter/issues/136',
      body: `Mission Control mode: required\n\n${renderMissionControlState(state)}`, labels: [],
    }))
    writeFileSync(commentsPath, JSON.stringify({ comments }))
    const result = runAgentIssue(root, ['136', '--phase', 'correction'], {
      PATH: withStubbedGh(root, `#!/usr/bin/env sh
case "$*" in
  *"issue view 136"*"title,url,body,labels"*) cat "${issuePath}" ;;
  *"issue view 136"*"comments"*) cat "${commentsPath}" ;;
  *"pr view 200"*) printf '%s' '{"title":"Correction PR","url":"https://github.com/boat1994/bemoat-web-starter/pull/200","headRefName":"feature/136","baseRefName":"main","headRefOid":"abc1234","state":"OPEN","statusCheckRollup":[{"name":"ci","workflowName":"CI","status":"COMPLETED","conclusion":"SUCCESS","detailsUrl":"https://ci/1"},{"name":"starter-ci","workflowName":"CI (starter strict)","status":"COMPLETED","conclusion":"SUCCESS","detailsUrl":"https://ci/2"}],"commits":[]}' ;;
  *) echo "unexpected gh call: $*" >&2; exit 1 ;;
esac
`),
    })
    expect(result.status, result.stderr || result.stdout).toBe(expectedStatus)
    if (expectedStatus === 0) {
      expect(result.stdout).toContain('Edit authorization: granted')
    } else {
      expect(result.stdout).toMatch(/HANDOFF|binding|edited/i)
      expect(result.stdout).not.toContain('Edit authorization: granted')
    }
  })

  it('fails closed when the verdict PR/base/head line contradicts the immutable contract reviewed_head (MC-R1-002)', () => {
    const root = createRepo('feature/136-immutable-correction-contract')
    const verdictBody = `## REVIEW_VERDICT
**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/200 · \`main\` · \`deadbeef00\`
**Verdict:** CORRECTION REQUIRED
**Findings:** Important: boundary bug
**Gates:** exact-head CI https://example.test/ci → pass
**Next:** Dev posts correction RESULT

\`\`\`json
{
  "schema_version": 1,
  "reviewed_head": "abc1234",
  "findings": [
    {
      "id": "MC-R1-001",
      "canonical_summary": "supplied-timezone month boundaries are incorrect",
      "source_thread": "https://github.com/boat1994/bemoat-web-starter/pull/200#discussion_r1",
      "required_evidence": ["Bangkok exact UTC boundary"]
    }
  ]
}
\`\`\`
`
    const commentsPayload = JSON.stringify({
      comments: [{ body: verdictBody, createdAt: '2026-07-20T10:00:00+07:00' }],
    }).replace(/'/g, `'\"'\"'`)

    const result = runAgentIssue(root, ['136', '--phase', 'correction'], {
      PATH: withStubbedGh(
        root,
        `#!/usr/bin/env sh
case "$*" in
  *"issue view 136"*"title,url,body,labels"*)
    printf '%s' '{"title":"Immutable correction contract","url":"https://github.com/boat1994/bemoat-web-starter/issues/136","body":"","labels":[]}'
    ;;
  *"issue view 136"*"comments"*)
    printf '%s' '${commentsPayload}'
    ;;
  *)
    echo "unexpected gh call: $*" >&2
    exit 1
    ;;
esac
`,
      ),
    })

    expect(result.status).toBe(1)
    expect(result.stdout).toMatch(/contract reviewed_head|contradict/i)
    expect(result.stdout).not.toContain('Edit authorization: granted')
  })

  it('fails closed when live PR evidence is unavailable before correction edit authorization (MC-R1-002)', () => {
    const root = createRepo('feature/136-immutable-correction-contract')
    const verdictBody = `## REVIEW_VERDICT
**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/200 · \`main\` · \`abc1234\`
**Verdict:** CORRECTION REQUIRED
**Findings:** Important: boundary bug
**Gates:** exact-head CI https://example.test/ci → pass
**Next:** Dev posts correction RESULT

\`\`\`json
{
  "schema_version": 1,
  "reviewed_head": "abc1234",
  "findings": [
    {
      "id": "MC-R1-001",
      "canonical_summary": "supplied-timezone month boundaries are incorrect",
      "source_thread": "https://github.com/boat1994/bemoat-web-starter/pull/200#discussion_r1",
      "required_evidence": ["Bangkok exact UTC boundary"]
    }
  ]
}
\`\`\`
`
    const commentsPayload = JSON.stringify({
      comments: [{ body: verdictBody, createdAt: '2026-07-20T10:00:00+07:00' }],
    }).replace(/'/g, `'\"'\"'`)

    const result = runAgentIssue(root, ['136', '--phase', 'correction'], {
      PATH: withStubbedGh(
        root,
        `#!/usr/bin/env sh
case "$*" in
  *"issue view 136"*"title,url,body,labels"*)
    printf '%s' '{"title":"Immutable correction contract","url":"https://github.com/boat1994/bemoat-web-starter/issues/136","body":"","labels":[]}'
    ;;
  *"issue view 136"*"comments"*)
    printf '%s' '${commentsPayload}'
    ;;
  *"pr view 200"*)
    echo "not found" >&2
    exit 1
    ;;
  *)
    echo "unexpected gh call: $*" >&2
    exit 1
    ;;
esac
`,
      ),
    })

    expect(result.status).toBe(1)
    expect(result.stdout).toMatch(/live PR evidence is unavailable/i)
    expect(result.stdout).not.toContain('Edit authorization: granted')
  })

  it('fails closed when the live PR head disagrees with the immutable contract reviewed_head (MC-R1-002)', () => {
    const root = createRepo('feature/136-immutable-correction-contract')
    const verdictBody = `## REVIEW_VERDICT
**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/200 · \`main\` · \`abc1234\`
**Verdict:** CORRECTION REQUIRED
**Findings:** Important: boundary bug
**Gates:** exact-head CI https://example.test/ci → pass
**Next:** Dev posts correction RESULT

\`\`\`json
{
  "schema_version": 1,
  "reviewed_head": "abc1234",
  "findings": [
    {
      "id": "MC-R1-001",
      "canonical_summary": "supplied-timezone month boundaries are incorrect",
      "source_thread": "https://github.com/boat1994/bemoat-web-starter/pull/200#discussion_r1",
      "required_evidence": ["Bangkok exact UTC boundary"]
    }
  ]
}
\`\`\`
`
    const commentsPayload = JSON.stringify({
      comments: [{ body: verdictBody, createdAt: '2026-07-20T10:00:00+07:00' }],
    }).replace(/'/g, `'\"'\"'`)

    const result = runAgentIssue(root, ['136', '--phase', 'correction'], {
      PATH: withStubbedGh(
        root,
        `#!/usr/bin/env sh
case "$*" in
  *"issue view 136"*"title,url,body,labels"*)
    printf '%s' '{"title":"Immutable correction contract","url":"https://github.com/boat1994/bemoat-web-starter/issues/136","body":"","labels":[]}'
    ;;
  *"issue view 136"*"comments"*)
    printf '%s' '${commentsPayload}'
    ;;
  *"pr view 200"*)
    printf '%s' '{"title":"Correction PR","url":"https://github.com/boat1994/bemoat-web-starter/pull/200","headRefName":"feature/136","baseRefName":"main","headRefOid":"movedaheadhash","state":"OPEN","statusCheckRollup":[],"commits":[]}'
    ;;
  *)
    echo "unexpected gh call: $*" >&2
    exit 1
    ;;
esac
`,
      ),
    })

    expect(result.status).toBe(1)
    expect(result.stdout).toMatch(/live PR head does not match/i)
    expect(result.stdout).not.toContain('Edit authorization: granted')
  })

  it('fails closed when the live PR base disagrees with the REVIEW_VERDICT approved base (MC-R1-002)', () => {
    const root = createRepo('feature/136-immutable-correction-contract')
    const verdictBody = `## REVIEW_VERDICT
**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/200 · \`main\` · \`abc1234\`
**Verdict:** CORRECTION REQUIRED
**Findings:** Important: boundary bug
**Gates:** exact-head CI https://example.test/ci → pass
**Next:** Dev posts correction RESULT

\`\`\`json
{
  "schema_version": 1,
  "reviewed_head": "abc1234",
  "findings": [
    {
      "id": "MC-R1-001",
      "canonical_summary": "supplied-timezone month boundaries are incorrect",
      "source_thread": "https://github.com/boat1994/bemoat-web-starter/pull/200#discussion_r1",
      "required_evidence": ["Bangkok exact UTC boundary"]
    }
  ]
}
\`\`\`
`
    const commentsPayload = JSON.stringify({
      comments: [{ body: verdictBody, createdAt: '2026-07-20T10:00:00+07:00' }],
    }).replace(/'/g, `'\"'\"'`)

    const result = runAgentIssue(root, ['136', '--phase', 'correction'], {
      PATH: withStubbedGh(
        root,
        `#!/usr/bin/env sh
case "$*" in
  *"issue view 136"*"title,url,body,labels"*)
    printf '%s' '{"title":"Immutable correction contract","url":"https://github.com/boat1994/bemoat-web-starter/issues/136","body":"","labels":[]}'
    ;;
  *"issue view 136"*"comments"*)
    printf '%s' '${commentsPayload}'
    ;;
  *"pr view 200"*)
    printf '%s' '{"title":"Correction PR","url":"https://github.com/boat1994/bemoat-web-starter/pull/200","headRefName":"feature/136","baseRefName":"dev","headRefOid":"abc1234","state":"OPEN","statusCheckRollup":[],"commits":[]}'
    ;;
  *)
    echo "unexpected gh call: $*" >&2
    exit 1
    ;;
esac
`,
      ),
    })

    expect(result.status).toBe(1)
    expect(result.stdout).toMatch(/live PR base does not match/i)
    expect(result.stdout).not.toContain('Edit authorization: granted')
  })

  it('fails closed when the live PR is no longer open before correction edit authorization (MC-R1-002)', () => {
    const root = createRepo('feature/136-immutable-correction-contract')
    const verdictBody = `## REVIEW_VERDICT
**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/200 · \`main\` · \`abc1234\`
**Verdict:** CORRECTION REQUIRED
**Findings:** Important: boundary bug
**Gates:** exact-head CI https://example.test/ci → pass
**Next:** Dev posts correction RESULT

\`\`\`json
{
  "schema_version": 1,
  "reviewed_head": "abc1234",
  "findings": [
    {
      "id": "MC-R1-001",
      "canonical_summary": "supplied-timezone month boundaries are incorrect",
      "source_thread": "https://github.com/boat1994/bemoat-web-starter/pull/200#discussion_r1",
      "required_evidence": ["Bangkok exact UTC boundary"]
    }
  ]
}
\`\`\`
`
    const commentsPayload = JSON.stringify({
      comments: [{ body: verdictBody, createdAt: '2026-07-20T10:00:00+07:00' }],
    }).replace(/'/g, `'\"'\"'`)

    const result = runAgentIssue(root, ['136', '--phase', 'correction'], {
      PATH: withStubbedGh(
        root,
        `#!/usr/bin/env sh
case "$*" in
  *"issue view 136"*"title,url,body,labels"*)
    printf '%s' '{"title":"Immutable correction contract","url":"https://github.com/boat1994/bemoat-web-starter/issues/136","body":"","labels":[]}'
    ;;
  *"issue view 136"*"comments"*)
    printf '%s' '${commentsPayload}'
    ;;
  *"pr view 200"*)
    printf '%s' '{"title":"Correction PR","url":"https://github.com/boat1994/bemoat-web-starter/pull/200","headRefName":"feature/136","baseRefName":"main","headRefOid":"abc1234","state":"MERGED","statusCheckRollup":[],"commits":[]}'
    ;;
  *)
    echo "unexpected gh call: $*" >&2
    exit 1
    ;;
esac
`,
      ),
    })

    expect(result.status).toBe(1)
    expect(result.stdout).toMatch(/live PR state is MERGED, not OPEN/i)
    expect(result.stdout).not.toContain('Edit authorization: granted')
  })

  it('fails closed when the verdict PR URL is in a foreign repository (MC-R1-002)', () => {
    const root = createRepo('feature/136-immutable-correction-contract')
    const verdictBody = `## REVIEW_VERDICT
**PR / base / head:** https://github.com/other/repository/pull/200 · \`main\` · \`abc1234\`
**Verdict:** CORRECTION REQUIRED
**Findings:** Important: boundary bug
**Gates:** exact-head CI https://example.test/ci → pass
**Next:** Dev posts correction RESULT

\`\`\`json
{
  "schema_version": 1,
  "reviewed_head": "abc1234",
  "findings": [
    {
      "id": "MC-R1-001",
      "canonical_summary": "supplied-timezone month boundaries are incorrect",
      "source_thread": "https://github.com/other/repository/pull/200#discussion_r1",
      "required_evidence": ["Bangkok exact UTC boundary"]
    }
  ]
}
\`\`\`
`
    const commentsPayload = JSON.stringify({
      comments: [{ body: verdictBody, createdAt: '2026-07-20T10:00:00+07:00' }],
    }).replace(/'/g, `'\"'\"'`)

    const result = runAgentIssue(root, ['136', '--phase', 'correction'], {
      PATH: withStubbedGh(
        root,
        `#!/usr/bin/env sh
case "$*" in
  *"issue view 136"*"title,url,body,labels"*)
    printf '%s' '{"title":"Immutable correction contract","url":"https://github.com/boat1994/bemoat-web-starter/issues/136","body":"","labels":[]}'
    ;;
  *"issue view 136"*"comments"*)
    printf '%s' '${commentsPayload}'
    ;;
  *"pr view 200"*)
    printf '%s' '{"title":"Wrong repo PR","url":"https://github.com/boat1994/bemoat-web-starter/pull/200","headRefName":"feature/136","baseRefName":"main","headRefOid":"abc1234","state":"OPEN","statusCheckRollup":[],"commits":[]}'
    ;;
  *)
    echo "unexpected gh call: $*" >&2
    exit 1
    ;;
esac
`,
      ),
    })

    expect(result.status).toBe(1)
    expect(result.stdout).toMatch(/PR identity|repository|foreign|mismatch/i)
    expect(result.stdout).not.toContain('Edit authorization: granted')
    expect(result.stdout).not.toContain('Playback verified')
  })

  it('fails closed when the verdict contains two distinct PR URLs (MC-R1-002)', () => {
    const root = createRepo('feature/136-immutable-correction-contract')
    const verdictBody = `## REVIEW_VERDICT
**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/200 · \`main\` · \`abc1234\`
**Verdict:** CORRECTION REQUIRED
**Findings:** Important: boundary bug
**Gates:** exact-head CI https://example.test/ci → pass
**Also:** https://github.com/boat1994/bemoat-web-starter/pull/201
**Next:** Dev posts correction RESULT

\`\`\`json
{
  "schema_version": 1,
  "reviewed_head": "abc1234",
  "findings": [
    {
      "id": "MC-R1-001",
      "canonical_summary": "supplied-timezone month boundaries are incorrect",
      "source_thread": "https://github.com/boat1994/bemoat-web-starter/pull/200#discussion_r1",
      "required_evidence": ["Bangkok exact UTC boundary"]
    }
  ]
}
\`\`\`
`
    const commentsPayload = JSON.stringify({
      comments: [{ body: verdictBody, createdAt: '2026-07-20T10:00:00+07:00' }],
    }).replace(/'/g, `'\"'\"'`)

    const result = runAgentIssue(root, ['136', '--phase', 'correction'], {
      PATH: withStubbedGh(
        root,
        `#!/usr/bin/env sh
case "$*" in
  *"issue view 136"*"title,url,body,labels"*)
    printf '%s' '{"title":"Immutable correction contract","url":"https://github.com/boat1994/bemoat-web-starter/issues/136","body":"","labels":[]}'
    ;;
  *"issue view 136"*"comments"*)
    printf '%s' '${commentsPayload}'
    ;;
  *"pr view 200"*|*"pr view 201"*)
    printf '%s' '{"title":"Correction PR","url":"https://github.com/boat1994/bemoat-web-starter/pull/200","headRefName":"feature/136","baseRefName":"main","headRefOid":"abc1234","state":"OPEN","statusCheckRollup":[],"commits":[]}'
    ;;
  *)
    echo "unexpected gh call: $*" >&2
    exit 1
    ;;
esac
`,
      ),
    })

    expect(result.status).toBe(1)
    expect(result.stdout).toMatch(/distinct PR|multiple PR|conflicting PR identity|PR identity/i)
    expect(result.stdout).not.toContain('Edit authorization: granted')
    expect(result.stdout).not.toContain('Playback verified')
  })

  it('fails closed when a canonical PR URL conflicts with a different PR #N shorthand (MC-R1-002)', () => {
    const root = createRepo('feature/136-immutable-correction-contract')
    const verdictBody = `## REVIEW_VERDICT
**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/200 · \`main\` · \`abc1234\`
**Verdict:** CORRECTION REQUIRED
**Findings:** Important: boundary bug · see PR #201
**Gates:** exact-head CI https://example.test/ci → pass
**Next:** Dev posts correction RESULT

\`\`\`json
{
  "schema_version": 1,
  "reviewed_head": "abc1234",
  "findings": [
    {
      "id": "MC-R1-001",
      "canonical_summary": "supplied-timezone month boundaries are incorrect",
      "source_thread": "https://github.com/boat1994/bemoat-web-starter/pull/200#discussion_r1",
      "required_evidence": ["Bangkok exact UTC boundary"]
    }
  ]
}
\`\`\`
`
    const commentsPayload = JSON.stringify({
      comments: [{ body: verdictBody, createdAt: '2026-07-20T10:00:00+07:00' }],
    }).replace(/'/g, `'\"'\"'`)

    const result = runAgentIssue(root, ['136', '--phase', 'correction'], {
      PATH: withStubbedGh(
        root,
        `#!/usr/bin/env sh
case "$*" in
  *"issue view 136"*"title,url,body,labels"*)
    printf '%s' '{"title":"Immutable correction contract","url":"https://github.com/boat1994/bemoat-web-starter/issues/136","body":"","labels":[]}'
    ;;
  *"issue view 136"*"comments"*)
    printf '%s' '${commentsPayload}'
    ;;
  *"pr view 200"*|*"pr view 201"*)
    printf '%s' '{"title":"Correction PR","url":"https://github.com/boat1994/bemoat-web-starter/pull/200","headRefName":"feature/136","baseRefName":"main","headRefOid":"abc1234","state":"OPEN","statusCheckRollup":[],"commits":[]}'
    ;;
  *)
    echo "unexpected gh call: $*" >&2
    exit 1
    ;;
esac
`,
      ),
    })

    expect(result.status).toBe(1)
    expect(result.stdout).toMatch(/distinct PR|multiple PR|conflicting PR identity|PR identity/i)
    expect(result.stdout).not.toContain('Edit authorization: granted')
    expect(result.stdout).not.toContain('Playback verified')
  })

  it('fails closed when repeated same PR identity appears as verdict URL and PR #N (MC-R1-002 matrix #51)', () => {
    const result = runLiveUrlMatrixCase({
      id: 51,
      name: 'repeated same verdict URL/PR #N',
      expected: 'REJECT',
      verdictFindingsExtra: ' · PR #200 · https://github.com/boat1994/bemoat-web-starter/pull/200',
      verdictOnly: true,
    })
    expectMatrixOutcome(result, 'REJECT', 'matrix #51 repeated same verdict URL/PR #N')
  })

  describe('MC-R1-002 malformed secondary identity-like verdict candidates', () => {
    const malformedSecondaryCases: Array<{
      name: string
      verdictFindingsExtra: string
    }> = [
      {
        name: 'valid canonical + junk-suffixed pull URL',
        verdictFindingsExtra: `\n**Also:** https://github.com/${MATRIX_OWNER}/${MATRIX_REPO}/pull/${MATRIX_PR}junk`,
      },
      {
        name: 'valid canonical + relative /pull/extra path',
        verdictFindingsExtra: `\n**Also:** /pull/${MATRIX_PR}/extra`,
      },
      {
        name: 'valid canonical + authority-confusion candidate',
        verdictFindingsExtra: `\n**Also:** https://github.com@evil.example/${MATRIX_OWNER}/${MATRIX_REPO}/pull/${MATRIX_PR}`,
      },
      {
        name: 'valid canonical + malformed foreign-repository candidate',
        verdictFindingsExtra: `\n**Also:** https://github.com/other/repository/pull/${MATRIX_PR}junk`,
      },
      {
        name: 'valid canonical + malformed same-identity prefix/suffix candidate',
        verdictFindingsExtra: `\n**Also:** https://github.com/${MATRIX_OWNER}/${MATRIX_REPO}/pull/${MATRIX_PR}%2Fextra`,
      },
    ]

    it.each(malformedSecondaryCases)(
      'fails closed for $name (MC-R1-002)',
      ({ name, verdictFindingsExtra }) => {
        const result = runLiveUrlMatrixCase({
          id: 0,
          name,
          expected: 'REJECT',
          verdictFindingsExtra,
          verdictOnly: true,
        })
        expectMatrixOutcome(result, 'REJECT', name)
        expect(result.stdout, name).toMatch(
          /malformed PR identity|malformed.*identity|identity-like|conflicting.*identity|PR identity/i,
        )
      },
    )

    it('still authorizes when the only secondary pull URL is a #discussion source_thread pointer (MC-R1-002)', () => {
      const result = runLiveUrlMatrixCase({
        id: 0,
        name: 'discussion source_thread excluded',
        expected: 'ACCEPT',
        verdictFindingsExtra: `\n**Threads:** https://github.com/${MATRIX_OWNER}/${MATRIX_REPO}/pull/${MATRIX_PR}#discussion_r1`,
        verdictOnly: true,
      })
      expectMatrixOutcome(result, 'ACCEPT', 'discussion source_thread excluded')
    })

    describe('MC-R1-002 structural #discussion source-thread classification', () => {
      const discussionAdversarialCases: Array<{
        name: string
        expected: 'ACCEPT' | 'REJECT'
        verdictFindingsExtra: string
      }> = [
        {
          name: 'conflicting pull number with #discussion fragment must fail closed',
          expected: 'REJECT',
          verdictFindingsExtra: `\n**Also:** https://github.com/${MATRIX_OWNER}/${MATRIX_REPO}/pull/999#discussion_r1`,
        },
        {
          name: 'foreign repository pull URL with #discussion fragment must fail closed',
          expected: 'REJECT',
          verdictFindingsExtra: `\n**Also:** https://github.com/other/repository/pull/${MATRIX_PR}#discussion_r1`,
        },
        {
          name: 'malformed junk-suffix pull path with #discussion fragment must fail closed',
          expected: 'REJECT',
          verdictFindingsExtra: `\n**Also:** https://github.com/${MATRIX_OWNER}/${MATRIX_REPO}/pull/${MATRIX_PR}junk#discussion_r1`,
        },
        {
          name: 'canonical same-PR #discussion_r source-thread pointer remains excluded',
          expected: 'ACCEPT',
          verdictFindingsExtra: `\n**Threads:** https://github.com/${MATRIX_OWNER}/${MATRIX_REPO}/pull/${MATRIX_PR}#discussion_r3612092679`,
        },
        {
          name: 'arbitrary fragment containing discussion substring must not qualify as source-thread',
          expected: 'REJECT',
          verdictFindingsExtra: `\n**Also:** https://github.com/${MATRIX_OWNER}/${MATRIX_REPO}/pull/${MATRIX_PR}#discussion_extra`,
        },
      ]

      it.each(discussionAdversarialCases)(
        '$expected for $name (MC-R1-002)',
        ({ name, expected, verdictFindingsExtra }) => {
          const result = runLiveUrlMatrixCase({
            id: 0,
            name,
            expected,
            verdictFindingsExtra,
            verdictOnly: true,
          })
          expectMatrixOutcome(result, expected, name)
          if (expected === 'REJECT') {
            expect(result.stdout, name).toMatch(
              /malformed PR identity|malformed.*identity|identity-like|conflicting.*identity|multiple distinct PR|PR identity/i,
            )
          }
        },
      )
    })
  })

  it('fails closed when successful live PR evidence omits the identity URL (MC-R1-002)', () => {
    const root = createRepo('feature/136-immutable-correction-contract')
    const verdictBody = `## REVIEW_VERDICT
**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/200 · \`main\` · \`abc1234\`
**Verdict:** CORRECTION REQUIRED
**Findings:** Important: boundary bug
**Gates:** exact-head CI https://example.test/ci → pass
**Next:** Dev posts correction RESULT

\`\`\`json
{
  "schema_version": 1,
  "reviewed_head": "abc1234",
  "findings": [
    {
      "id": "MC-R1-001",
      "canonical_summary": "supplied-timezone month boundaries are incorrect",
      "source_thread": "https://github.com/boat1994/bemoat-web-starter/pull/200#discussion_r1",
      "required_evidence": ["Bangkok exact UTC boundary"]
    }
  ]
}
\`\`\`
`
    const commentsPayload = JSON.stringify({
      comments: [{ body: verdictBody, createdAt: '2026-07-20T10:00:00+07:00' }],
    }).replace(/'/g, `'\"'\"'`)

    const result = runAgentIssue(root, ['136', '--phase', 'correction'], {
      PATH: withStubbedGh(
        root,
        `#!/usr/bin/env sh
case "$*" in
  *"issue view 136"*"title,url,body,labels"*)
    printf '%s' '{"title":"Immutable correction contract","url":"https://github.com/boat1994/bemoat-web-starter/issues/136","body":"","labels":[]}'
    ;;
  *"issue view 136"*"comments"*)
    printf '%s' '${commentsPayload}'
    ;;
  *"pr view 200"*)
    printf '%s' '{"title":"Correction PR","headRefName":"feature/136","baseRefName":"main","headRefOid":"abc1234","state":"OPEN","statusCheckRollup":[],"commits":[]}'
    ;;
  *)
    echo "unexpected gh call: $*" >&2
    exit 1
    ;;
esac
`,
      ),
    })

    expect(result.status).toBe(1)
    expect(result.stdout).toMatch(/live PR (evidence is missing|identity).*url|missing.*identity URL|repository-qualified identity/i)
    expect(result.stdout).not.toContain('Edit authorization: granted')
    expect(result.stdout).not.toContain('Playback verified')
  })

  it('fails closed when successful live PR evidence has an unparseable identity URL (MC-R1-002)', () => {
    const root = createRepo('feature/136-immutable-correction-contract')
    const verdictBody = `## REVIEW_VERDICT
**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/200 · \`main\` · \`abc1234\`
**Verdict:** CORRECTION REQUIRED
**Findings:** Important: boundary bug
**Gates:** exact-head CI https://example.test/ci → pass
**Next:** Dev posts correction RESULT

\`\`\`json
{
  "schema_version": 1,
  "reviewed_head": "abc1234",
  "findings": [
    {
      "id": "MC-R1-001",
      "canonical_summary": "supplied-timezone month boundaries are incorrect",
      "source_thread": "https://github.com/boat1994/bemoat-web-starter/pull/200#discussion_r1",
      "required_evidence": ["Bangkok exact UTC boundary"]
    }
  ]
}
\`\`\`
`
    const commentsPayload = JSON.stringify({
      comments: [{ body: verdictBody, createdAt: '2026-07-20T10:00:00+07:00' }],
    }).replace(/'/g, `'\"'\"'`)

    const result = runAgentIssue(root, ['136', '--phase', 'correction'], {
      PATH: withStubbedGh(
        root,
        `#!/usr/bin/env sh
case "$*" in
  *"issue view 136"*"title,url,body,labels"*)
    printf '%s' '{"title":"Immutable correction contract","url":"https://github.com/boat1994/bemoat-web-starter/issues/136","body":"","labels":[]}'
    ;;
  *"issue view 136"*"comments"*)
    printf '%s' '${commentsPayload}'
    ;;
  *"pr view 200"*)
    printf '%s' '{"title":"Correction PR","url":"not-a-github-pull-request-url","headRefName":"feature/136","baseRefName":"main","headRefOid":"abc1234","state":"OPEN","statusCheckRollup":[],"commits":[]}'
    ;;
  *)
    echo "unexpected gh call: $*" >&2
    exit 1
    ;;
esac
`,
      ),
    })

    expect(result.status).toBe(1)
    expect(result.stdout).toMatch(/unparseable|malformed|live PR identity/i)
    expect(result.stdout).not.toContain('Edit authorization: granted')
    expect(result.stdout).not.toContain('Playback verified')
  })

  describe('MC-R1-002 closed 56-case live PR URL contract matrix', () => {
    const matrixCases: LiveUrlMatrixCase[] = [
      { id: 1, name: 'exact canonical identity', expected: 'ACCEPT', liveUrl: MATRIX_CANONICAL },
      { id: 2, name: 'canonical + trailing slash', expected: 'REJECT', liveUrl: `${MATRIX_CANONICAL}/` },
      { id: 3, name: 'canonical + query', expected: 'REJECT', liveUrl: `${MATRIX_CANONICAL}?x=1` },
      { id: 4, name: 'canonical + fragment', expected: 'REJECT', liveUrl: `${MATRIX_CANONICAL}#discussion` },
      {
        id: 5,
        name: 'mixed-case hostname',
        expected: 'ACCEPT',
        liveUrl: `https://GitHub.COM/${MATRIX_OWNER}/${MATRIX_REPO}/pull/${MATRIX_PR}`,
      },
      {
        id: 6,
        name: 'owner case variant',
        expected: 'ACCEPT',
        liveUrl: `https://github.com/Boat1994/${MATRIX_REPO}/pull/${MATRIX_PR}`,
      },
      {
        id: 7,
        name: 'repository case variant',
        expected: 'ACCEPT',
        liveUrl: `https://github.com/${MATRIX_OWNER}/Bemoat-Web-Starter/pull/${MATRIX_PR}`,
      },
      {
        id: 8,
        name: 'percent-encoded pull token',
        expected: 'REJECT',
        liveUrl: `https://github.com/${MATRIX_OWNER}/${MATRIX_REPO}/pul%6C/${MATRIX_PR}`,
      },
      {
        id: 9,
        name: 'GitHub Enterprise host',
        expected: 'REJECT',
        liveUrl: `https://github.enterprise.example/${MATRIX_OWNER}/${MATRIX_REPO}/pull/${MATRIX_PR}`,
      },
      {
        id: 10,
        name: 'api.github.com pulls URL',
        expected: 'REJECT',
        liveUrl: `https://api.github.com/repos/${MATRIX_OWNER}/${MATRIX_REPO}/pulls/${MATRIX_PR}`,
      },
      { id: 11, name: 'number with junk suffix', expected: 'REJECT', liveUrl: `${MATRIX_CANONICAL}junk` },
      { id: 12, name: 'extra path segment', expected: 'REJECT', liveUrl: `${MATRIX_CANONICAL}/extra` },
      { id: 13, name: 'number with trailing dot', expected: 'REJECT', liveUrl: `${MATRIX_CANONICAL}.` },
      {
        id: 14,
        name: 'plus-prefixed number',
        expected: 'REJECT',
        liveUrl: `https://github.com/${MATRIX_OWNER}/${MATRIX_REPO}/pull/+${MATRIX_PR}`,
      },
      {
        id: 15,
        name: 'minus-prefixed number',
        expected: 'REJECT',
        liveUrl: `https://github.com/${MATRIX_OWNER}/${MATRIX_REPO}/pull/-${MATRIX_PR}`,
      },
      {
        id: 16,
        name: 'zero PR number with matching adversarial evidence',
        expected: 'REJECT',
        prNumber: '0',
        verdictPrUrl: `https://github.com/${MATRIX_OWNER}/${MATRIX_REPO}/pull/0`,
        liveUrl: `https://github.com/${MATRIX_OWNER}/${MATRIX_REPO}/pull/0`,
      },
      {
        id: 17,
        name: 'leading-zero PR number with matching adversarial evidence',
        expected: 'REJECT',
        prNumber: '0123',
        verdictPrUrl: `https://github.com/${MATRIX_OWNER}/${MATRIX_REPO}/pull/0123`,
        liveUrl: `https://github.com/${MATRIX_OWNER}/${MATRIX_REPO}/pull/0123`,
      },
      {
        id: 18,
        name: 'userinfo authority confusion',
        expected: 'REJECT',
        liveUrl: `https://github.com@evil.example/${MATRIX_OWNER}/${MATRIX_REPO}/pull/${MATRIX_PR}`,
      },
      {
        id: 19,
        name: 'host suffix confusion',
        expected: 'REJECT',
        liveUrl: `https://github.com.evil.example/${MATRIX_OWNER}/${MATRIX_REPO}/pull/${MATRIX_PR}`,
      },
      {
        id: 20,
        name: 'http scheme',
        expected: 'REJECT',
        liveUrl: `http://github.com/${MATRIX_OWNER}/${MATRIX_REPO}/pull/${MATRIX_PR}`,
      },
      {
        id: 21,
        name: 'uppercase HTTPS scheme',
        expected: 'REJECT',
        liveUrl: `HTTPS://github.com/${MATRIX_OWNER}/${MATRIX_REPO}/pull/${MATRIX_PR}`,
      },
      {
        id: 22,
        name: 'missing scheme',
        expected: 'REJECT',
        liveUrl: `github.com/${MATRIX_OWNER}/${MATRIX_REPO}/pull/${MATRIX_PR}`,
      },
      {
        id: 23,
        name: 'protocol-relative URL',
        expected: 'REJECT',
        liveUrl: `//github.com/${MATRIX_OWNER}/${MATRIX_REPO}/pull/${MATRIX_PR}`,
      },
      {
        id: 24,
        name: 'explicit port 443',
        expected: 'REJECT',
        liveUrl: `https://github.com:443/${MATRIX_OWNER}/${MATRIX_REPO}/pull/${MATRIX_PR}`,
      },
      {
        id: 25,
        name: 'encoded slash in owner',
        expected: 'REJECT',
        liveUrl: `https://github.com/boat%2F1994/${MATRIX_REPO}/pull/${MATRIX_PR}`,
      },
      { id: 26, name: 'encoded slash suffix after number', expected: 'REJECT', liveUrl: `${MATRIX_CANONICAL}%2Fextra` },
      { id: 27, name: 'encoded backslash suffix after number', expected: 'REJECT', liveUrl: `${MATRIX_CANONICAL}%5Cextra` },
      {
        id: 28,
        name: 'double-encoded separator suffix',
        expected: 'REJECT',
        liveUrl: `${MATRIX_CANONICAL}%252Fextra`,
      },
      {
        id: 29,
        name: 'dot segment before pull',
        expected: 'REJECT',
        liveUrl: `https://github.com/${MATRIX_OWNER}/${MATRIX_REPO}/./pull/${MATRIX_PR}`,
      },
      {
        id: 30,
        name: 'encoded dot segment before pull',
        expected: 'REJECT',
        liveUrl: `https://github.com/${MATRIX_OWNER}/${MATRIX_REPO}/%2e/pull/${MATRIX_PR}`,
      },
      { id: 31, name: 'dot-dot segment after number', expected: 'REJECT', liveUrl: `${MATRIX_CANONICAL}/../extra` },
      {
        id: 32,
        name: 'encoded dot-dot segment after number',
        expected: 'REJECT',
        liveUrl: `${MATRIX_CANONICAL}/%2e%2e/extra`,
      },
      {
        id: 33,
        name: 'literal backslashes throughout',
        expected: 'REJECT',
        liveUrl: `https:\\\\github.com\\${MATRIX_OWNER}\\${MATRIX_REPO}\\pull\\${MATRIX_PR}`,
      },
      { id: 34, name: 'canonical plus backslash extra', expected: 'REJECT', liveUrl: `${MATRIX_CANONICAL}\\extra` },
      { id: 35, name: 'leading ASCII whitespace', expected: 'REJECT', liveUrl: ` ${MATRIX_CANONICAL}` },
      { id: 36, name: 'trailing ASCII whitespace', expected: 'REJECT', liveUrl: `${MATRIX_CANONICAL} ` },
      {
        id: 37,
        name: 'control before and after canonical URL',
        expected: 'REJECT',
        liveUrl: `\n${MATRIX_CANONICAL}\u007f`,
      },
      {
        id: 38,
        name: 'control inside path before number',
        expected: 'REJECT',
        liveUrl: `https://github.com/${MATRIX_OWNER}/${MATRIX_REPO}/pull/\t${MATRIX_PR}`,
      },
      { id: 39, name: 'canonical followed by punctuation', expected: 'REJECT', liveUrl: `${MATRIX_CANONICAL}).` },
      { id: 40, name: 'canonical followed by junk text', expected: 'REJECT', liveUrl: `${MATRIX_CANONICAL} more-text` },
      {
        id: 41,
        name: 'canonical followed by another URL',
        expected: 'REJECT',
        liveUrl: `${MATRIX_CANONICAL}https://github.com/${MATRIX_OWNER}/${MATRIX_REPO}/pull/201`,
      },
      {
        id: 42,
        name: 'query containing conflicting PR identity',
        expected: 'REJECT',
        liveUrl: `${MATRIX_CANONICAL}?other=https://github.com/${MATRIX_OWNER}/${MATRIX_REPO}/pull/201`,
      },
      {
        id: 43,
        name: 'fragment containing conflicting PR identity',
        expected: 'REJECT',
        liveUrl: `${MATRIX_CANONICAL}#https://github.com/${MATRIX_OWNER}/${MATRIX_REPO}/pull/201`,
      },
      {
        id: 44,
        name: 'Unicode confusable hostname',
        expected: 'REJECT',
        liveUrl: `https://githuḃ.com/${MATRIX_OWNER}/${MATRIX_REPO}/pull/${MATRIX_PR}`,
      },
      {
        id: 45,
        name: 'Unicode confusable owner token',
        expected: 'REJECT',
        liveUrl: `https://github.com/bοat1994/${MATRIX_REPO}/pull/${MATRIX_PR}`,
      },
      {
        id: 46,
        name: 'foreign owner',
        expected: 'REJECT',
        liveUrl: `https://github.com/other-owner/${MATRIX_REPO}/pull/${MATRIX_PR}`,
      },
      {
        id: 47,
        name: 'foreign repository',
        expected: 'REJECT',
        liveUrl: `https://github.com/${MATRIX_OWNER}/other-repo/pull/${MATRIX_PR}`,
      },
      {
        id: 48,
        name: 'wrong PR number',
        expected: 'REJECT',
        liveUrl: `https://github.com/${MATRIX_OWNER}/${MATRIX_REPO}/pull/201`,
      },
      {
        id: 49,
        name: 'repeated same canonical URL in live url value',
        expected: 'REJECT',
        liveUrl: `${MATRIX_CANONICAL}${MATRIX_CANONICAL}`,
      },
      {
        id: 50,
        name: 'canonical plus conflicting second identity in live url',
        expected: 'REJECT',
        liveUrl: `${MATRIX_CANONICAL} https://github.com/${MATRIX_OWNER}/${MATRIX_REPO}/pull/201`,
      },
      {
        id: 51,
        name: 'repeated same PR identity in verdict URL/PR #N evidence',
        expected: 'REJECT',
        verdictFindingsExtra: ' · PR #200',
        verdictOnly: true,
      },
      {
        id: 52,
        name: 'conflicting distinct verdict PR URLs',
        expected: 'REJECT',
        verdictFindingsExtra: `\n**Also:** https://github.com/${MATRIX_OWNER}/${MATRIX_REPO}/pull/201`,
        verdictOnly: true,
      },
      {
        id: 53,
        name: 'valid url plus conflicting injected number field',
        expected: 'REJECT',
        liveUrl: MATRIX_CANONICAL,
        livePrExtra: { number: 201 },
      },
      {
        id: 54,
        name: 'missing url plus html_url fallback',
        expected: 'REJECT',
        omitUrl: true,
        livePrExtra: {
          html_url: MATRIX_CANONICAL,
          number: Number(MATRIX_PR),
        },
      },
      {
        id: 55,
        name: 'canonical embedded with junk prefix and suffix',
        expected: 'REJECT',
        liveUrl: `junk${MATRIX_CANONICAL}junk`,
      },
      {
        id: 56,
        name: 'canonical substring embedded in foreign URL path',
        expected: 'REJECT',
        liveUrl: `https://evil.example/${MATRIX_CANONICAL}junk`,
      },
    ]

    it.each(matrixCases)(
      'matrix #$id $name → $expected',
      (matrixCase) => {
        const result = runLiveUrlMatrixCase(matrixCase)
        expectMatrixOutcome(result, matrixCase.expected, `#${matrixCase.id} ${matrixCase.name}`)
      },
    )
  })

  it('fails closed in correction mode when canonical findings are missing', () => {
    const root = createRepo('feature/136-immutable-correction-contract')
    const commentsPayload = JSON.stringify({
      comments: [
        {
          body: `## REVIEW_VERDICT
**Verdict:** CORRECTION REQUIRED
**Findings:** Important: boundary bug
**Gates:** exact-head CI → pass
**Next:** Dev
`,
          createdAt: '2026-07-20T10:00:00+07:00',
        },
      ],
    }).replace(/'/g, `'\"'\"'`)

    const result = runAgentIssue(root, ['136', '--phase', 'correction'], {
      PATH: withStubbedGh(
        root,
        `#!/usr/bin/env sh
case "$*" in
  *"issue view 136"*"title,url,body,labels"*)
    printf '%s' '{"title":"Immutable correction contract","url":"https://github.com/boat1994/bemoat-web-starter/issues/136","body":"","labels":[]}'
    ;;
  *"issue view 136"*"comments"*)
    printf '%s' '${commentsPayload}'
    ;;
  *)
    echo "unexpected gh call: $*" >&2
    exit 1
    ;;
esac
`,
      ),
    })

    expect(result.status).toBe(1)
    expect(result.stdout).toContain('canonical finding evidence is missing')
  })

  describe('planning_no_pr correction preflight mode', () => {
    function planningManagedState(reviewedHead: string, overrides: Record<string, string> = {}) {
      return managedState({
        state: 'CORRECTION_REQUIRED_1',
        review_cycle: '1',
        full_review_count: '1',
        approved_base: 'main',
        active_task_issue: '"#145"',
        active_pr: 'null',
        current_head: 'null',
        last_reviewed_head: `"${reviewedHead}"`,
        guide_version: '1.2.0',
        guide_source_ref: 'main',
        guide_source_sha: '"5b37817101c1e1451b70d25168142f6b03cacca0"',
        open_blockers: '[]',
        follow_up_issues: '[]',
        next_permitted_action: '"bounded planning correction"',
        material_change_status: 'none',
        updated_at: '"2026-07-22T22:50:00+07:00"',
        updated_by: '"Mission Control"',
        ...overrides,
      })
    }

    function setupPlanningCorrectionRepo(
      headOverride?: { verdictHead?: string; contractHead?: string },
      verdictBodyExtra: string = '',
      ghStubExtra: string = '',
      stateOverrides: Record<string, string> = {},
    ) {
      const root = mkdtempSync(join(tmpdir(), 'bemoat-agent-issue-'))
      tempRoots.push(root)
      spawnSync('git', ['init', '-b', 'main'], { cwd: root, encoding: 'utf8' })
      spawnSync('git', ['remote', 'add', 'origin', 'https://github.com/boat1994/bemoat-web-starter.git'], {
        cwd: root,
        encoding: 'utf8',
      })
      spawnSync('git', ['config', 'user.email', 'agent-issue@test'], { cwd: root, encoding: 'utf8' })
      spawnSync('git', ['config', 'user.name', 'Agent Issue Test'], { cwd: root, encoding: 'utf8' })
      seedTrackedFile(root, 'README.md', 'initial seed')
      spawnSync('git', ['checkout', '-b', 'feature/145-planning-no-pr-correction'], { cwd: root, encoding: 'utf8' })
      const actualHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim()
      const verdictHead = headOverride?.verdictHead ?? actualHead
      const contractHead = headOverride?.contractHead ?? actualHead
      const issueBody = planningManagedState(contractHead, {
        approved_base: 'main',
        ...stateOverrides,
      })

      const commentsPayload = JSON.stringify({
        comments: [
          {
            body: `## REVIEW_VERDICT
**Verdict:** CORRECTION REQUIRED
**PR / base / head:** none · base main · head ${verdictHead}
**Next:** Dev posts correction RESULT
${verdictBodyExtra}

\`\`\`json
{
  "schema_version": 1,
  "mode": "planning_no_pr",
  "reviewed_head": "${contractHead}",
  "findings": [
    {
      "id": "MC-R1-001",
      "canonical_summary": "design spec missing exact error boundary",
      "source_thread": "https://github.com/boat1994/bemoat-web-starter/pull/12#discussion_r1",
      "required_evidence": ["updated design.md"],
      "expected_areas": ["docs/superpowers/specs/bogus/catalog/minimal-luxury-detail/design.md"],
      "prohibited_areas": []
    }
  ]
}
\`\`\``,
            createdAt: '2026-07-20T10:00:00+07:00',
          },
        ],
      }).replace(/'/g, `'\"'\"'`)

      const issueViewPayload = JSON.stringify({
        title: 'Immutable correction contract',
        url: 'https://github.com/boat1994/bemoat-web-starter/issues/145',
        body: issueBody,
        labels: [],
      }).replace(/'/g, `'\"'\"'`)

      const ghStub = `#!/usr/bin/env sh
case "$*" in
  *"issue view 145"*"title,url,body,labels"*)
    printf '%s' '${issueViewPayload}'
    ;;
  *"issue view 145"*"comments"*)
    printf '%s' '${commentsPayload}'
    ;;
${ghStubExtra}
  *"pr list --state open"*)
    printf '%s' '[]'
    ;;
  *)
    echo "unexpected gh call: $*" >&2
    exit 1
    ;;
esac
`
      return { root, ghStub, actualHead, contractHead, issueBody, mainHead: actualHead }
    }

    it('TEST-PLAN-01: accepts valid planning-only no-PR correction preflight', () => {
      const { root, ghStub } = setupPlanningCorrectionRepo()
      const result = runAgentIssue(root, ['145', '--phase', 'correction'], {
        PATH: withStubbedGh(root, ghStub),
      })

      expect(result.status).toBe(0)
      expect(result.stdout).toContain('Mode: planning_no_pr')
      expect(result.stdout).toContain('Edit authorization: granted for the immutable finding set only across canonical planning artifacts (docs/superpowers/specs/bogus/catalog/minimal-luxury-detail/design.md).')
    })

    it('TEST-PLAN-02: fails closed when ambiguous PR token exists inside planning verdict', () => {
      const { root, ghStub } = setupPlanningCorrectionRepo(
        undefined,
        'Check PR https://github.com/boat1994/bemoat-web-starter/pull/99 for details.',
      )
      const result = runAgentIssue(root, ['145', '--phase', 'correction'], {
        PATH: withStubbedGh(root, ghStub),
      })

      expect(result.status).toBe(1)
      expect(result.stdout).toContain('STATE CONFLICT: PR identity references found inside verdict under no-PR planning mode')
    })

    it('TEST-PLAN-03: fails closed when ghost open PR exists on GitHub during planning', () => {
      const { root, ghStub } = setupPlanningCorrectionRepo(
        undefined,
        '',
        `  *"--head feature/145-planning-no-pr-correction"*)
    printf '%s' '[{"number":145,"title":"Ghost PR","headRefName":"feature/145-planning-no-pr-correction","url":"https://github.com/boat1994/bemoat-web-starter/pull/145","closingIssuesReferences":[{"number":145}]}]'
    ;;`,
      )
      const result = runAgentIssue(root, ['145', '--phase', 'correction'], {
        PATH: withStubbedGh(root, ghStub),
      })

      expect(result.status).toBe(1)
      expect(result.stdout).toContain('STATE CONFLICT: open PR #145 exists on GitHub for this planning issue under no-PR contract')
    })

    it('TEST-PLAN-04: fails closed when prohibited scope touched during planning correction diff', () => {
      const { root, ghStub } = setupPlanningCorrectionRepo()
      seedTrackedFile(root, 'src/app/page.tsx', 'export default () => <div>illegal change</div>')
      const result = runAgentIssue(root, ['145', '--phase', 'correction'], {
        PATH: withStubbedGh(root, ghStub),
      })

      expect(result.status).toBe(1)
      expect(result.stdout).toContain('prohibited scope present in correction diff: src/app/page.tsx (outside canonical planning-artifact allowlist)')
    })

    it('TEST-HEAD-01: fails closed when verdict head contradicts reviewed_head', () => {
      const { root, ghStub } = setupPlanningCorrectionRepo({
        verdictHead: 'e9f8d7ce9f8d7ce9f8d7ce9f8d7ce9f8d7ce9f8d',
      })
      const result = runAgentIssue(root, ['145', '--phase', 'correction'], {
        PATH: withStubbedGh(root, ghStub),
      })

      expect(result.status).toBe(1)
      expect(result.stdout).toContain('REVIEW_VERDICT head contradicts the immutable contract reviewed_head')
    })

    it('TEST-DIRTY-01: fails closed when working tree is dirty during planning correction preflight', () => {
      const { root, ghStub } = setupPlanningCorrectionRepo()
      writeFileSync(join(root, 'README.md'), 'dirty content', 'utf8')
      const result = runAgentIssue(root, ['145', '--phase', 'correction'], {
        PATH: withStubbedGh(root, ghStub),
      })

      expect(result.status).toBe(1)
      expect(result.stdout).toContain('Stop: dirty working tree blocks correction edit authorization.')
    })

    it('MC-R1-001: fails closed when managed state active_pr conflicts with planning_no_pr', () => {
      const { root, ghStub } = setupPlanningCorrectionRepo(undefined, '', '', {
        active_pr: '"#148"',
      })
      const result = runAgentIssue(root, ['145', '--phase', 'correction'], {
        PATH: withStubbedGh(root, ghStub),
      })

      expect(result.status).toBe(1)
      expect(result.stdout).toContain('planning_no_pr durable authorization proofs failed')
      expect(result.stdout).toContain('active_pr: null')
    })

    it('MC-R1-001: fails closed when managed state last_reviewed_head is stale', () => {
      const { root, ghStub, contractHead } = setupPlanningCorrectionRepo(undefined, '', '', {
        last_reviewed_head: '"deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"',
      })
      expect(contractHead).not.toBe('deadbeefdeadbeefdeadbeefdeadbeefdeadbeef')
      const result = runAgentIssue(root, ['145', '--phase', 'correction'], {
        PATH: withStubbedGh(root, ghStub),
      })

      expect(result.status).toBe(1)
      expect(result.stdout).toContain('last_reviewed_head does not match the immutable contract reviewed_head')
    })

    it('MC-R1-003: fails closed when malformed GitHub PR list evidence is returned', () => {
      const { root, ghStub } = setupPlanningCorrectionRepo(
        undefined,
        '',
        `  *"pr list --state open"*)
    printf '%s' 'not-json'
    ;;`,
      )
      const result = runAgentIssue(root, ['145', '--phase', 'correction'], {
        PATH: withStubbedGh(root, ghStub),
      })

      expect(result.status).toBe(1)
      expect(result.stdout).toContain('malformed GitHub PR list JSON')
    })

    it('MC-R1-003: allows unrelated open PRs while blocking issue-linked ghost PRs', () => {
      const { root, actualHead, issueBody } = setupPlanningCorrectionRepo()
      const issueViewPayload = JSON.stringify({
        title: 'Immutable correction contract',
        url: 'https://github.com/boat1994/bemoat-web-starter/issues/145',
        body: issueBody,
        labels: [],
      }).replace(/'/g, `'\"'\"'`)
      const commentsPayload = JSON.stringify({
        comments: [
          {
            body: `## REVIEW_VERDICT
**Verdict:** CORRECTION REQUIRED
**PR / base / head:** none · base main · head ${actualHead}
**Next:** Dev posts correction RESULT

\`\`\`json
{
  "schema_version": 1,
  "mode": "planning_no_pr",
  "reviewed_head": "${actualHead}",
  "findings": [
    {
      "id": "MC-R1-001",
      "canonical_summary": "design spec missing exact error boundary",
      "source_thread": "https://github.com/boat1994/bemoat-web-starter/pull/12#discussion_r1",
      "required_evidence": ["updated design.md"],
      "expected_areas": ["docs/superpowers/specs/bogus/catalog/minimal-luxury-detail/design.md"],
      "prohibited_areas": []
    }
  ]
}
\`\`\``,
            createdAt: '2026-07-20T10:00:00+07:00',
          },
        ],
      }).replace(/'/g, `'\"'\"'`)

      const ghostPrStub = `#!/usr/bin/env sh
case "$*" in
  *"issue view 145"*"title,url,body,labels"*)
    printf '%s' '${issueViewPayload}'
    ;;
  *"issue view 145"*"comments"*)
    printf '%s' '${commentsPayload}'
    ;;
  *"--head feature/145-planning-no-pr-correction"*)
    printf '%s' '[{"number":145,"title":"Ghost PR","headRefName":"feature/145-planning-no-pr-correction","url":"https://github.com/boat1994/bemoat-web-starter/pull/145","closingIssuesReferences":[{"number":145}]}]'
    ;;
  *"closes #145"*)
    printf '%s' '[]'
    ;;
  *"pr list --state open"*)
    printf '%s' '[]'
    ;;
  *)
    echo "unexpected gh call: $*" >&2
    exit 1
    ;;
esac
`
      const blocked = runAgentIssue(root, ['145', '--phase', 'correction'], {
        PATH: withStubbedGh(root, ghostPrStub),
      })
      expect(blocked.status).toBe(1)
      expect(blocked.stdout).toContain('STATE CONFLICT: open PR #145 exists on GitHub for this planning issue under no-PR contract')

      const unrelatedOnlyStub = `#!/usr/bin/env sh
case "$*" in
  *"issue view 145"*"title,url,body,labels"*)
    printf '%s' '${issueViewPayload}'
    ;;
  *"issue view 145"*"comments"*)
    printf '%s' '${commentsPayload}'
    ;;
  *"--head feature/145-planning-no-pr-correction"*)
    printf '%s' '[{"number":999,"title":"Unrelated PR","headRefName":"feature/unrelated","url":"https://github.com/boat1994/bemoat-web-starter/pull/999","closingIssuesReferences":[]}]'
    ;;
  *"closes #145"*)
    printf '%s' '[]'
    ;;
  *"pr list --state open"*)
    printf '%s' '[]'
    ;;
  *)
    echo "unexpected gh call: $*" >&2
    exit 1
    ;;
esac
`
      const allowed = runAgentIssue(root, ['145', '--phase', 'correction'], {
        PATH: withStubbedGh(root, unrelatedOnlyStub),
      })
      expect(allowed.status).toBe(0)
      expect(allowed.stdout).toContain('Edit authorization: granted')
    })

    it('MC-R1-004: rejects unrelated same-repository discussion URLs under planning_no_pr', () => {
      const { root, ghStub } = setupPlanningCorrectionRepo(
        undefined,
        'See https://github.com/boat1994/bemoat-web-starter/pull/99#discussion_r1 for context.',
      )
      const result = runAgentIssue(root, ['145', '--phase', 'correction'], {
        PATH: withStubbedGh(root, ghStub),
      })

      expect(result.status).toBe(1)
      expect(result.stdout).toContain('PR identity references found inside verdict under no-PR planning mode')
    })

    it('MC-R1-004: accepts only declared finding source_thread discussion pointers under planning_no_pr', () => {
      const { root, ghStub } = setupPlanningCorrectionRepo(
        undefined,
        'Thread pointer: https://github.com/boat1994/bemoat-web-starter/pull/12#discussion_r1',
      )
      const result = runAgentIssue(root, ['145', '--phase', 'correction'], {
        PATH: withStubbedGh(root, ghStub),
      })

      expect(result.status).toBe(0)
      expect(result.stdout).toContain('Edit authorization: granted')
    })

    it('TEST-PR-01: preserves exact existing behavioral divergence for implementation_pr mode', () => {
      const root = createRepo('feature/136-immutable-correction-contract')
      const commentsPayload = JSON.stringify({
        comments: [
          {
            body: `## REVIEW_VERDICT
**Verdict:** CORRECTION REQUIRED
**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/200 · main · abc1234
**Findings:** Important: boundary bug
**Gates:** exact-head CI → pass
**Next:** Dev posts correction RESULT

\`\`\`json
{
  "schema_version": 1,
  "reviewed_head": "abc1234",
  "findings": [
    {
      "id": "MC-R1-001",
      "canonical_summary": "supplied-timezone month boundaries are incorrect",
      "source_thread": "https://github.com/boat1994/bemoat-web-starter/pull/200#discussion_r1",
      "required_evidence": ["pnpm run test:int"],
      "expected_areas": ["src/lib/date.ts"],
      "prohibited_areas": ["src/unrelated/reversal.ts"]
    }
  ]
}
\`\`\``,
            createdAt: '2026-07-20T10:00:00+07:00',
          },
        ],
      }).replace(/'/g, `'\"'\"'`)

      const result = runAgentIssue(root, ['136', '--phase', 'correction'], {
        PATH: withStubbedGh(
          root,
          `#!/usr/bin/env sh
case "$*" in
  *"issue view 136"*"title,url,body,labels"*)
    printf '%s' '{"title":"Immutable correction contract","url":"https://github.com/boat1994/bemoat-web-starter/issues/136","body":"","labels":[]}'
    ;;
  *"issue view 136"*"comments"*)
    printf '%s' '${commentsPayload}'
    ;;
  *"pr view 200"*)
    printf '%s' '{"title":"Correction PR","url":"https://github.com/boat1994/bemoat-web-starter/pull/200","headRefName":"feature/136","baseRefName":"main","headRefOid":"abc1234","state":"OPEN","statusCheckRollup":[],"commits":[]}'
    ;;
  *)
    echo "unexpected gh call: $*" >&2
    exit 1
    ;;
esac
`,
        ),
      })

      expect(result.status).toBe(0)
      expect(result.stdout).toContain('Correction capsule')
      expect(result.stdout).not.toContain('Mode: planning_no_pr')
      expect(result.stdout).toContain('Edit authorization: granted for the immutable finding set only.')
    })
  })

  describe('planning contract preflight integration', () => {
    const planningPlanPath = 'docs/superpowers/plans/test/implementation-plan.md'

    function runPlanningPreflight(
      root: string,
      issueNumber: string,
      issueBody: string,
      planContent: string,
      ghStub: string,
    ) {
      seedTrackedFile(root, planningPlanPath, planContent)
      return runAgentIssue(root, [issueNumber], {
        PATH: withStubbedGh(root, ghStub),
      })
    }

    it('blocks preflight with structured PLAN001 when the declared plan lacks a task identity block', () => {
      const root = createRepo('feature/140-planning-contract')
      const result = runPlanningPreflight(
        root,
        '140',
        `Implementation Plan path: \`${planningPlanPath}\``,
        '# Implementation Plan\n\n## Slice A\n',
        `#!/usr/bin/env sh
case "$*" in
  *"--json"*"title,url,body,labels"*)
    printf '%s' '{"title":"Planning contract task","url":"https://github.com/boat1994/bemoat-web-starter/issues/140","body":"Implementation Plan path: \`${planningPlanPath}\`","labels":[]}'
    ;;
  *)
    echo "unexpected gh call: $*" >&2
    exit 1
    ;;
esac
`,
      )

      expect(result.status).toBe(1)
      expect(result.stdout).toContain('Hard blockers:')
      expect(result.stdout).toMatch(/\[PLAN001\] docs\/superpowers\/plans\/test\/implementation-plan\.md:/)
    })

    it('blocks preflight with PLAN005 when create_before_execution has no active_task_issue', () => {
      const root = createRepo('feature/140-create-before-execution')
      const result = runPlanningPreflight(
        root,
        '140',
        `Implementation Plan path: \`${planningPlanPath}\``,
        readPlanningFixture('valid-create-before-execution.md'),
        `#!/usr/bin/env sh
case "$*" in
  *"--json"*"title,url,body,labels"*)
    printf '%s' '{"title":"Planning contract task","url":"https://github.com/boat1994/bemoat-web-starter/issues/140","body":"Implementation Plan path: \`${planningPlanPath}\`","labels":[]}'
    ;;
  *)
    echo "unexpected gh call: $*" >&2
    exit 1
    ;;
esac
`,
      )

      expect(result.status).toBe(1)
      expect(result.stdout).toContain('Hard blockers:')
      expect(result.stdout).toContain('Create dedicated task issue before launching implementation.')
      expect(result.stdout).toContain('switch task_issue_strategy to existing_dedicated_issue')
    })

    it('passes preflight after switching from create_before_execution to existing_dedicated_issue with an open task issue', () => {
      const root = createRepo('feature/141-task-14-slug')
      const blocked = runPlanningPreflight(
        root,
        '140',
        `Implementation Plan path: \`${planningPlanPath}\``,
        readPlanningFixture('valid-create-before-execution.md'),
        `#!/usr/bin/env sh
case "$*" in
  *"--json"*"title,url,body,labels"*)
    printf '%s' '{"title":"Planning contract task","url":"https://github.com/boat1994/bemoat-web-starter/issues/140","body":"Implementation Plan path: \`${planningPlanPath}\`","labels":[]}'
    ;;
  *)
    echo "unexpected gh call: $*" >&2
    exit 1
    ;;
esac
`,
      )

      expect(blocked.status).toBe(1)
      expect(blocked.stdout).toContain('Hard blockers:')
      expect(blocked.stdout).toContain('switch task_issue_strategy to existing_dedicated_issue')

      const dedicatedIssueBody = `${managedState({ active_task_issue: '"#141"' })}\nDedicated task issue for task-14`
      const dedicatedIssuePayload = JSON.stringify({
        title: '[task-14] Dedicated implementation task',
        state: 'OPEN',
        body: dedicatedIssueBody,
        url: 'https://github.com/boat1994/bemoat-web-starter/issues/141',
      }).replace(/'/g, `'\"'\"'`)
      const passed = runPlanningPreflight(
        root,
        '140',
        `Implementation Plan path: \`${planningPlanPath}\``,
        planWithTaskIdentity('', {
          task_key: '"task-14"',
          task_issue_strategy: '"existing_dedicated_issue"',
          active_task_issue: '"#141"',
          branch_template: '"feature/141-task-14-slug"',
        }),
        `#!/usr/bin/env sh
case "$*" in
  *"auth status"*) exit 0 ;;
  *"--version"*) exit 0 ;;
  *"--json"*"title,url,body,labels"*)
    printf '%s' '{"title":"Planning contract task","url":"https://github.com/boat1994/bemoat-web-starter/issues/140","body":"Implementation Plan path: \`${planningPlanPath}\`","labels":[]}'
    ;;
  *"issue view 141"*)
    printf '%s' '${dedicatedIssuePayload}'
    ;;
  *)
    echo "unexpected gh call: $*" >&2
    exit 1
    ;;
esac
`,
      )

      expect(passed.status).toBe(0)
      expect(passed.stdout).not.toContain('Hard blockers:')
    })

    it('blocks preflight with PLAN008 when closed issue #169 is reused for live task identity', () => {
      const root = createRepo('feature/140-closed-169-reuse')
      const result = runPlanningPreflight(
        root,
        '140',
        `Implementation Plan path: \`${planningPlanPath}\``,
        readPlanningFixture('closed-issue-169-reuse.md'),
        `#!/usr/bin/env sh
case "$*" in
  *"auth status"*) exit 0 ;;
  *"--version"*) exit 0 ;;
  *"--json"*"title,url,body,labels"*)
    printf '%s' '{"title":"Planning contract task","url":"https://github.com/boat1994/bemoat-web-starter/issues/140","body":"Implementation Plan path: \`${planningPlanPath}\`","labels":[]}'
    ;;
  *"issue view 169"*)
    printf '%s' '{"title":"[Task 10] Homepage Foundation task-11","state":"CLOSED","body":"historical task","url":"https://github.com/boat1994/bemoat-web-starter/issues/169"}'
    ;;
  *)
    echo "unexpected gh call: $*" >&2
    exit 1
    ;;
esac
`,
      )

      expect(result.status).toBe(1)
      expect(result.stdout).toContain('Hard blockers:')
      expect(result.stdout).toMatch(/\[PLAN008\] docs\/superpowers\/plans\/test\/implementation-plan\.md:/)
      expect(result.stdout).toContain("Found: state 'CLOSED'")
    })

    it('fails closed when live task identity verification is offline', () => {
      const root = createRepo('feature/140-offline-live-verify')
      const result = runPlanningPreflight(
        root,
        '140',
        `Implementation Plan path: \`${planningPlanPath}\``,
        planWithTaskIdentity('', {
          task_key: '"issue-140"',
          active_task_issue: '"#140"',
          branch_template: '"feature/140-offline-live-verify"',
        }),
        `#!/usr/bin/env sh
case "$*" in
  *"--json"*"title,url,body,labels"*)
    printf '%s' '{"title":"Planning contract task","url":"https://github.com/boat1994/bemoat-web-starter/issues/140","body":"Implementation Plan path: \`${planningPlanPath}\`","labels":[]}'
    ;;
  *"auth status"*|*"--version"*)
    echo 'offline gh stub' >&2
    exit 1
    ;;
  *)
    echo "unexpected gh call: $*" >&2
    exit 1
    ;;
esac
`,
      )

      expect(result.status).toBe(1)
      expect(result.stdout).toContain('Hard blockers:')
      expect(result.stdout).toMatch(/gh auth login/i)
      expect(result.stdout).toMatch(/live task identity verification unavailable/i)
    })
  })

  describe('bounded harness workflow simplification (#146)', () => {
    it('routes missing (null/undefined) or ambiguous Mission Control mode to STANDARD until authority is resolved (MC-R1-001)', () => {
      expect(
        deriveWorkflowProfile({
          taskSize: 'small',
          missionControlMode: null,
        }),
      ).toMatchObject({
        name: 'STANDARD',
        nextAction: 'Use STANDARD safeguards and resolve the Mission Control mode before treating work as FAST.',
      })

      expect(
        deriveWorkflowProfile({
          taskSize: 'small',
          missionControlMode: undefined,
        }),
      ).toMatchObject({
        name: 'STANDARD',
        nextAction: 'Use STANDARD safeguards and resolve the Mission Control mode before treating work as FAST.',
      })

      expect(
        deriveWorkflowProfile({
          taskSize: 'small',
          missionControlMode: 'ambiguous-mode',
        }),
      ).toMatchObject({
        name: 'STANDARD',
        nextAction: 'Use STANDARD safeguards and resolve the Mission Control mode before treating work as FAST.',
      })

      expect(
        deriveWorkflowProfile({
          taskSize: 'small',
          missionControlMode: 'optional',
        }),
      ).toMatchObject({ name: 'FAST' })

      expect(deriveWorkflowProfile({})).toBeNull()
    })

    it('replays #145-style bounded defect deterministically proving direct dispatch without planning/HANDOFF, duplicate Founder gates, or intermediate state-only runs (MC-R1-002)', () => {
      const root = createRepo('feature/145-correction-preflight-defect')
      const envWithStubbedGh = {
        ...process.env,
        PATH: withStubbedGh(
          root,
          `#!/usr/bin/env sh
case "$*" in
  *"api --paginate graphql"*|*"issue view 145 --json comments"*)
    printf '%s' '{"comments":[{"body":"## RESULT\\n\\n**PR:** https://github.com/boat1994/bemoat-web-starter/pull/123\\n**Summary:** Planning result from earlier phase","createdAt":"2026-07-22T13:21:34Z"}]}'
    ;;
  *)
    echo "unexpected gh call: $*" >&2
    exit 1
    ;;
esac
`,
        ),
      }

      const readyAnalysis = analyzeProgressTracking({
        cwd: root,
        activeIssueNumber: '145',
        activeIssueBody: `### Task size
medium

### Mission Control mode
required

${managedState({
  state: 'READY',
  active_task_issue: '"145"',
  approved_base: 'dev',
  active_pr: 'null',
  current_head: 'null',
  review_cycle: '0',
  full_review_count: '0',
  next_permitted_action: '"Implement — post exactly one implementation HANDOFF to Dev / Builder"',
  updated_at: '2026-07-22T20:27:04+07:00',
})}`,
        env: envWithStubbedGh,
      })

      expect(readyAnalysis.blockers).toEqual([])
      expect(readyAnalysis.report.declarations.declaresImplementationPlan).toBe(false)
      expect(readyAnalysis.report.plan).toBeNull()
      expect(readyAnalysis.report.currentStageSummary.founderGate).toBeNull()
      expect(readyAnalysis.report.reconciliation?.proposal).toBeNull()
      expect(readyAnalysis.report.workflowProfile).toMatchObject({
        name: 'MANAGED',
        nextAction: 'Use the managed-state workflow and its required bounded role transition.',
      })
      expect(readyAnalysis.report.nextPermittedAction).toBe(
        'Implement — post exactly one implementation HANDOFF to Dev / Builder',
      )

      const inProgressAnalysis = analyzeProgressTracking({
        cwd: root,
        activeIssueNumber: '145',
        activeIssueBody: `### Task size
medium

### Mission Control mode
required

${managedState({
  state: 'IN_PROGRESS',
  active_task_issue: '"145"',
  approved_base: 'dev',
  active_pr: 'null',
  current_head: 'null',
  review_cycle: '0',
  full_review_count: '0',
  next_permitted_action: '"Implement — post exactly one implementation HANDOFF to Dev / Builder"',
  updated_at: '2026-07-22T20:27:04+07:00',
})}`,
        env: envWithStubbedGh,
      })

      expect(inProgressAnalysis.blockers).toEqual([])
      expect(inProgressAnalysis.report.declarations.declaresImplementationPlan).toBe(false)
      expect(inProgressAnalysis.report.plan).toBeNull()
      expect(inProgressAnalysis.report.currentStageSummary.founderGate).toBeNull()
      expect(inProgressAnalysis.report.currentStageSummary.activePr).toBeNull()
      expect(inProgressAnalysis.report.reconciliation?.proposal).toBeNull()
      expect(inProgressAnalysis.report.workflowProfile).toMatchObject({
        name: 'MANAGED',
        nextAction: 'Use the managed-state workflow and its required bounded role transition.',
      })
      expect(inProgressAnalysis.report.nextPermittedAction).toBe(
        'Implement — post exactly one implementation HANDOFF to Dev / Builder',
      )
    })

    it('preserves role comments when createdAt or state.updated_at is absent or malformed instead of treating as epoch zero (MC-R1-003)', () => {
      const root = createRepo('feature/146-timestamp-invalid')
      const analysis = analyzeProgressTracking({
        cwd: root,
        activeIssueNumber: '146',
        activeIssueBody: `### Task size
medium

### Mission Control mode
required

${managedState({
  state: 'IN_PROGRESS',
  active_task_issue: '"146"',
  approved_base: 'dev',
  active_pr: 'null',
  current_head: 'null',
  review_cycle: '0',
  full_review_count: '0',
  updated_at: '2026-07-22T20:27:04+07:00',
})}`,
        env: {
          ...process.env,
          PATH: withStubbedGh(
            root,
            `#!/usr/bin/env sh
case "$*" in
  *"api --paginate graphql"*|*"issue view 146 --json comments"*)
    printf '%s' '{"comments":[{"body":"## RESULT\\n\\n**PR:** https://github.com/boat1994/bemoat-web-starter/pull/999\\n**Summary:** Comment with malformed timestamp","createdAt":"invalid-timestamp"}]}'
    ;;
  *)
    echo "unexpected gh call: $*" >&2
    exit 1
    ;;
esac
`,
          ),
        },
      })

      expect(analysis.report.currentStageSummary.activePr).toBe('#999')
    })
  })
})
