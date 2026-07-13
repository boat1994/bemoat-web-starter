import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

import { afterEach, describe, expect, it } from 'vitest'

import {
  analyzeExactHeadCi,
  analyzeProgressTracking,
  parseDurableProgress,
  parseIssueDeclarations,
  parseIssueReference,
  runAgentIssuePreflight,
  validatePlanPath,
} from '../../scripts/agent-issue.mjs'

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
    const exactHead = analyzeExactHeadCi({
      headRefOid: 'abc123def456',
      statusCheckRollup: {
        contexts: [{ state: 'SUCCESS', targetUrl: 'https://github.com/runs/abc123def456' }],
      },
    })
    const olderSha = analyzeExactHeadCi({
      headRefOid: 'currentheadsha111',
      statusCheckRollup: {
        contexts: [{ state: 'SUCCESS', targetUrl: 'https://github.com/runs/oldsha999' }],
      },
    })

    expect(exactHead.exactHeadVerified).toBe(true)
    expect(olderSha.exactHeadVerified).toBe(false)
    expect(olderSha.olderShaSuccess).toBe(true)
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
    printf '%s' '{"title":"Slice B PR","url":"https://github.com/boat1994/bemoat-web-starter/pull/122","headRefName":"feature/121-slice-b","baseRefName":"main","headRefOid":"abc123def456","state":"OPEN","statusCheckRollup":{"contexts":[{"state":"SUCCESS","targetUrl":"https://github.com/runs/abc123def456"}]},"commits":[]}'
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
    expect(result.stdout).toContain('Exact-head CI: Exact-head CI verified for abc123d.')
    expect(result.stdout).not.toContain('Hard blockers:')
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
})
