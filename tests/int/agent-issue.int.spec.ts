import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

import { afterEach, describe, expect, it } from 'vitest'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped runtime .mjs boundary */
import * as agentIssueModule from '../../scripts/agent-issue.mjs'

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
const tempRoots: string[] = []

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
    seedTrackedFile(root, planPath, '# Implementation Plan\n\n## Slice B — Acquisition Handoff\n')

    const pathValue = withStubbedGh(
      root,
      `#!/usr/bin/env sh
case "$*" in
  *"issue view 121"*)
    printf '%s' '{"title":"Slice B task","url":"https://github.com/boat1994/bemoat-web-starter/issues/121","body":"Main Issue: #106\\nImplementation Plan: \`docs/superpowers/plans/sample/implementation-plan.md\`\\nActive PR: #122\\n\\n## Current Stage\\n- Current Slice: Slice B\\n- Relevant plan section: Slice B — Acquisition Handoff\\n\\n## Next Permitted Action\\nFinish the review gate.","labels":[]}'
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

  it('permits repeated references that normalize to the same canonical PR identity (MC-R1-002)', () => {
    const root = createRepo('feature/136-immutable-correction-contract')
    const verdictBody = `## REVIEW_VERDICT
**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/200 · \`main\` · \`abc1234\`
**Verdict:** CORRECTION REQUIRED
**Findings:** Important: boundary bug · PR #200 · https://github.com/boat1994/bemoat-web-starter/pull/200
**Gates:** exact-head CI https://example.test/ci → pass
**Next:** Dev posts correction RESULT for PR #200

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
    expect(result.stdout).toContain('Playback verified: 1/1 canonical findings')
    expect(result.stdout).toContain('Edit authorization: granted')
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
})
