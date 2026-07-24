import { chmodSync, readFileSync } from 'node:fs'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'

import { afterEach, describe, expect, it } from 'vitest'

const fixturesRoot = resolve(process.cwd(), 'tests/fixtures/planning')
const tempRoots: string[] = []

function readFixture(name: string) {
  return readFileSync(join(fixturesRoot, name), 'utf8')
}

function createRepo() {
  const root = mkdtempSync(join(tmpdir(), 'planning-contract-live-'))
  tempRoots.push(root)

  expect(spawnSync('git', ['init', '-b', 'main'], { cwd: root, encoding: 'utf8' }).status).toBe(0)
  expect(
    spawnSync(
      'git',
      ['remote', 'add', 'origin', 'https://github.com/boat1994/bemoat-web-starter.git'],
      { cwd: root, encoding: 'utf8' },
    ).status,
  ).toBe(0)

  return root
}

function writeExecutable(filePath: string, content: string) {
  writeFileSync(filePath, content)
  chmodSync(filePath, 0o755)
}

function withStubbedGh(root: string, content: string) {
  const binDir = mkdtempSync(join(tmpdir(), 'planning-contract-gh-bin-'))
  tempRoots.push(binDir)
  mkdirSync(binDir, { recursive: true })
  writeExecutable(join(binDir, 'gh'), content)
  return `${binDir}:${process.env.PATH ?? ''}`
}

function managedState(overrides: Record<string, string> = {}) {
  const fields: Record<string, string> = {
    schema_version: '1',
    state: 'IN_PROGRESS',
    review_cycle: '0',
    full_review_count: '0',
    approved_base: 'main',
    active_task_issue: '"#140"',
    active_pr: 'null',
    current_head: 'null',
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

function baseContract(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    main_issue: null as null,
    task_key: 'issue-140',
    task_issue_strategy: 'existing_dedicated_issue',
    active_task_issue: '#140',
    branch_template: 'feature/140-valid-existing',
    transition_target: 'DONE',
    planning_base_sha: '2489c7bf6d10ad8c2a724a7920bd83350102ee03',
    execution_base_rule: 'resolve_live_protected_base_at_dispatch',
    paired_spec: null as null,
    paired_plan: null as null,
    ...overrides,
  }
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) {
      spawnSync('rm', ['-rf', root], { encoding: 'utf8' })
    }
  }
})

function violationRules(
  violations: Array<{ rule: string }>,
) {
  return violations.map((item) => item.rule)
}

describe('guard-planning-contract static validation', () => {
  it('passes valid paired spec and plan fixtures', async () => {
    const mod = await import('../../scripts/guard-planning-contract.mjs')

    const violations = mod.runPlanningContractGuard({
      root: process.cwd(),
      files: [
        'tests/fixtures/planning/valid-existing-issue.md',
        'tests/fixtures/planning/valid-paired-plan.md',
      ],
    })

    expect(violations).toEqual([])
  })

  it('flags closed issue #169 reuse with terminal transition conflicts', async () => {
    const mod = await import('../../scripts/guard-planning-contract.mjs')

    const violations = mod.runPlanningContractGuard({
      root: process.cwd(),
      files: ['tests/fixtures/planning/closed-issue-169-reuse.md'],
    })

    expect(violationRules(violations)).toContain('PLAN004')
  })

  it('flags mismatched active_task_issue across paired documents with PLAN002', async () => {
    const mod = await import('../../scripts/guard-planning-contract.mjs')
    const tempRoot = mkdtempSync(join(tmpdir(), 'planning-contract-'))
    const designPath = 'docs/superpowers/specs/test/design.md'
    const planPath = 'docs/superpowers/plans/test/implementation-plan.md'

    const specContent = readFixture('mismatched-issue-numbers.md')
      .replaceAll('tests/fixtures/planning/mismatched-issue-numbers.md', designPath)
      .replaceAll('tests/fixtures/planning/mismatched-issue-numbers-plan.md', planPath)
    const planContent = specContent
      .replace('active_task_issue: "#170"', 'active_task_issue: "#171"')
      .replace('paired_spec: "docs/superpowers/specs/test/design.md"', 'paired_spec: "docs/superpowers/specs/test/design.md"')
      .replace('paired_plan: "docs/superpowers/plans/test/implementation-plan.md"', 'paired_plan: "docs/superpowers/plans/test/implementation-plan.md"')

    mkdirSync(dirname(join(tempRoot, designPath)), { recursive: true })
    mkdirSync(dirname(join(tempRoot, planPath)), { recursive: true })
    writeFileSync(join(tempRoot, designPath), specContent, 'utf8')
    writeFileSync(join(tempRoot, planPath), planContent, 'utf8')

    const violations = mod.runPlanningContractGuard({
      root: tempRoot,
      files: [designPath, planPath],
    })

    const plan002 = violations.find((item: { rule: string }) => item.rule === 'PLAN002')
    expect(plan002).toBeDefined()
    expect(mod.formatPlanningContractViolations([plan002!])[0]).toContain(
      "Found '#171' in implementation-plan.md but '#170' in design.md",
    )
  })

  it('flags unrelated branch prefix with PLAN003', async () => {
    const mod = await import('../../scripts/guard-planning-contract.mjs')

    const violations = mod.runPlanningContractGuard({
      root: process.cwd(),
      files: ['tests/fixtures/planning/unrelated-branch-prefix.md'],
    })

    expect(violationRules(violations)).toContain('PLAN003')
  })

  it('flags terminal transition target conflicts with PLAN004', async () => {
    const mod = await import('../../scripts/guard-planning-contract.mjs')

    const violations = mod.runPlanningContractGuard({
      root: process.cwd(),
      files: ['tests/fixtures/planning/terminal-transition-target.md'],
    })

    expect(violationRules(violations)).toContain('PLAN004')
  })

  it('flags missing task_issue_strategy with PLAN006', async () => {
    const mod = await import('../../scripts/guard-planning-contract.mjs')

    const violations = mod.runPlanningContractGuard({
      root: process.cwd(),
      files: ['tests/fixtures/planning/missing-strategy.md'],
    })

    expect(violationRules(violations)).toContain('PLAN006')
  })

  it('flags unconditional planning base SHA rule with PLAN007', async () => {
    const mod = await import('../../scripts/guard-planning-contract.mjs')

    const violations = mod.runPlanningContractGuard({
      root: process.cwd(),
      files: ['tests/fixtures/planning/unconditional-planning-sha.md'],
    })

    expect(violationRules(violations)).toContain('PLAN007')
  })

  it('passes create_before_execution strategy with null active_task_issue', async () => {
    const mod = await import('../../scripts/guard-planning-contract.mjs')

    const violations = mod.runPlanningContractGuard({
      root: process.cwd(),
      files: ['tests/fixtures/planning/valid-create-before-execution.md'],
    })

    expect(violations.filter((item: { rule: string }) => item.rule === 'PLAN005')).toEqual([])
    expect(violations.filter((item: { rule: string }) => item.rule === 'PLAN006')).toEqual([])
    expect(violations).toEqual([])
  })

  it('allows historical issue references outside identity block', async () => {
    const mod = await import('../../scripts/guard-planning-contract.mjs')

    const violations = mod.runPlanningContractGuard({
      root: process.cwd(),
      files: ['tests/fixtures/planning/valid-historical-references.md'],
    })

    expect(violations).toEqual([])
  })

  it('allows old planning_base_sha with live protected base resolution', async () => {
    const mod = await import('../../scripts/guard-planning-contract.mjs')

    const violations = mod.runPlanningContractGuard({
      root: process.cwd(),
      files: ['tests/fixtures/planning/valid-old-provenance-live-base.md'],
    })

    expect(violations.filter((item: { rule: string }) => item.rule === 'PLAN007')).toEqual([])
    expect(violations).toEqual([])
  })

  it('formats violations with structured diagnostics', async () => {
    const mod = await import('../../scripts/guard-planning-contract.mjs')

    const violations = mod.runPlanningContractGuard({
      root: process.cwd(),
      files: ['tests/fixtures/planning/missing-strategy.md'],
    })

    const formatted = mod.formatPlanningContractViolations(violations)
    expect(formatted[0]).toMatch(
      /^\[PLAN006\] .+: .+\. Found: .+\. Reason: .+\. Corrective action: .+$/,
    )
  })

  it('ignores marker mentions in prose and inline code when parsing identity blocks', async () => {
    const mod = await import('../../scripts/guard-planning-contract.mjs')
    const tempRoot = mkdtempSync(join(tmpdir(), 'planning-contract-prose-'))
    const designPath = 'docs/superpowers/specs/test/design.md'
    const absolutePath = join(tempRoot, designPath)

    mkdirSync(dirname(absolutePath), { recursive: true })
    writeFileSync(
      absolutePath,
      `# Design with prose marker mentions

The block uses \`<!-- bemoat-task-identity:start -->\` and \`<!-- bemoat-task-identity:end -->\` markers.

\`\`\`markdown
<!-- bemoat-task-identity:start -->
example only
<!-- bemoat-task-identity:end -->
\`\`\`

Also mention <!-- bemoat-task-identity:start --> in plain prose.

<!-- bemoat-task-identity:start -->
\`\`\`yaml
schema_version: 1
main_issue: null
task_key: "task-prose"
task_issue_strategy: "create_before_execution"
active_task_issue: null
branch_template: "feature/99-task-prose"
transition_target: "AWAITING_REVIEW_1"
planning_base_sha: "2489c7bf6d10ad8c2a724a7920bd83350102ee03"
execution_base_rule: "resolve_live_protected_base_at_dispatch"
paired_spec: null
paired_plan: null
\`\`\`
<!-- bemoat-task-identity:end -->
`,
      'utf8',
    )

    const violations = mod.runPlanningContractGuard({
      root: tempRoot,
      files: [designPath],
    })

    expect(violationRules(violations)).not.toContain('PLAN001')
    expect(violations).toEqual([])
  })

  it('discovers committed branch planning files on a clean working tree', async () => {
    const mod = await import('../../scripts/guard-planning-contract.mjs')
    const root = mkdtempSync(join(tmpdir(), 'planning-contract-branch-'))
    tempRoots.push(root)
    const planPath = 'docs/superpowers/plans/test/implementation-plan.md'
    const absolutePlanPath = join(root, planPath)

    expect(spawnSync('git', ['init', '-b', 'main'], { cwd: root, encoding: 'utf8' }).status).toBe(0)
    spawnSync('git', ['config', 'user.email', 'planning-contract@test'], { cwd: root, encoding: 'utf8' })
    spawnSync('git', ['config', 'user.name', 'Planning Contract Test'], { cwd: root, encoding: 'utf8' })
    mkdirSync(dirname(absolutePlanPath), { recursive: true })
    writeFileSync(absolutePlanPath, '# placeholder\n', 'utf8')
    expect(spawnSync('git', ['add', planPath], { cwd: root, encoding: 'utf8' }).status).toBe(0)
    expect(
      spawnSync('git', ['commit', '-m', 'seed main'], { cwd: root, encoding: 'utf8' }).status,
    ).toBe(0)
    expect(
      spawnSync('git', ['checkout', '-b', 'feature/140-branch-discovery'], {
        cwd: root,
        encoding: 'utf8',
      }).status,
    ).toBe(0)

    writeFileSync(
      absolutePlanPath,
      readFixture('closed-issue-169-reuse.md').replace(
        '# Closed issue #169 reuse fixture',
        '# Committed invalid planning file',
      ),
      'utf8',
    )
    expect(spawnSync('git', ['add', planPath], { cwd: root, encoding: 'utf8' }).status).toBe(0)
    expect(
      spawnSync('git', ['commit', '-m', 'add invalid planning file'], {
        cwd: root,
        encoding: 'utf8',
      }).status,
    ).toBe(0)

    const cleanStatus = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })
    expect(cleanStatus.stdout.trim()).toBe('')

    const violations = mod.runPlanningContractGuard({
      root,
      approvedBase: 'main',
    })

    expect(violationRules(violations)).toContain('PLAN004')
  })
})

describe('guard-planning-contract live verification', () => {
  it('emits PLAN008 when active task issue #169 is closed', async () => {
    const mod = await import('../../scripts/guard-planning-contract.mjs')
    const cwd = createRepo()
    const pathValue = withStubbedGh(
      cwd,
      `#!/usr/bin/env sh
case "$*" in
  *"auth status"*) exit 0 ;;
  *"--version"*) exit 0 ;;
  *"issue view 169"*)
    printf '%s' '{"title":"[Task 10] Homepage Foundation","state":"CLOSED","body":"historical task","url":"https://github.com/boat1994/bemoat-web-starter/issues/169"}'
    ;;
  *)
    echo "unexpected gh call: $*" >&2
    exit 1
    ;;
esac
`,
    )

    const result = mod.verifyLiveTaskIdentity({
      cwd,
      filePath: 'tests/fixtures/planning/closed-issue-169-reuse.md',
      contract: baseContract({
        task_key: 'task-11',
        active_task_issue: '#169',
      }),
      env: { ...process.env, PATH: pathValue },
    })

    expect(result.ok).toBe(false)
    expect(result.degradedOffline).toBe(false)
    expect(result.violations).toHaveLength(1)
    expect(result.violations[0].rule).toBe('PLAN008')
    expect(mod.formatPlanningContractViolations(result.violations)[0]).toContain("Found: state 'CLOSED'")
    expect(mod.formatPlanningContractViolations(result.violations)[0]).toContain(
      'Reason: Active task issue #169 is closed/terminal. Corrective action: Reopen issue #169 or create a new dedicated open task issue',
    )
  })

  it('emits PLAN008 when gh issue lookup fails for repository mismatch', async () => {
    const mod = await import('../../scripts/guard-planning-contract.mjs')
    const cwd = createRepo()
    const pathValue = withStubbedGh(
      cwd,
      `#!/usr/bin/env sh
case "$*" in
  *"auth status"*) exit 0 ;;
  *"--version"*) exit 0 ;;
  *"issue view 170"*)
    echo 'GraphQL: Could not resolve to a Repository' >&2
    exit 1
    ;;
  *)
    echo "unexpected gh call: $*" >&2
    exit 1
    ;;
esac
`,
    )

    const result = mod.verifyLiveTaskIdentity({
      cwd,
      filePath: 'tests/fixtures/planning/valid-existing-issue.md',
      contract: baseContract({ active_task_issue: '#170', task_key: 'task-11' }),
      env: { ...process.env, PATH: pathValue },
    })

    expect(result.ok).toBe(false)
    expect(result.violations[0].rule).toBe('PLAN008')
  })

  it('emits PLAN008 when gh returns an issue URL from a different repository', async () => {
    const mod = await import('../../scripts/guard-planning-contract.mjs')
    const cwd = createRepo()
    const pathValue = withStubbedGh(
      cwd,
      `#!/usr/bin/env sh
case "$*" in
  *"auth status"*) exit 0 ;;
  *"--version"*) exit 0 ;;
  *"issue view 170"*)
    printf '%s' '{"title":"[task-11] Billing API","state":"OPEN","body":"task-11","url":"https://github.com/other-org/other-repo/issues/170"}'
    ;;
  *)
    echo "unexpected gh call: $*" >&2
    exit 1
    ;;
esac
`,
    )

    const result = mod.verifyLiveTaskIdentity({
      cwd,
      filePath: 'tests/fixtures/planning/valid-existing-issue.md',
      contract: baseContract({ active_task_issue: '#170', task_key: 'task-11' }),
      env: { ...process.env, PATH: pathValue },
    })

    expect(result.ok).toBe(false)
    expect(result.violations[0].rule).toBe('PLAN008')
  })

  it('emits PLAN009 when open issue title/body does not identify task_key', async () => {
    const mod = await import('../../scripts/guard-planning-contract.mjs')
    const cwd = createRepo()
    const pathValue = withStubbedGh(
      cwd,
      `#!/usr/bin/env sh
case "$*" in
  *"auth status"*) exit 0 ;;
  *"--version"*) exit 0 ;;
  *"issue view 170"*)
    printf '%s' '{"title":"[Task 12] Billing API","state":"OPEN","body":"Task 12 billing work","url":"https://github.com/boat1994/bemoat-web-starter/issues/170"}'
    ;;
  *)
    echo "unexpected gh call: $*" >&2
    exit 1
    ;;
esac
`,
    )

    const result = mod.verifyLiveTaskIdentity({
      cwd,
      filePath: 'tests/fixtures/planning/valid-existing-issue.md',
      contract: baseContract({ active_task_issue: '#170', task_key: 'task-11' }),
      env: { ...process.env, PATH: pathValue },
    })

    expect(result.ok).toBe(false)
    expect(result.violations[0].rule).toBe('PLAN009')
    expect(mod.formatPlanningContractViolations(result.violations)[0]).toContain('Found: task key mismatch')
    expect(mod.formatPlanningContractViolations(result.violations)[0]).toContain(
      'Reason: Issue #170 title/body does not identify task-11. Corrective action: Update active_task_issue to point to the issue for task-11',
    )
  })

  it('emits PLAN010 when managed Mission Control state is DONE', async () => {
    const mod = await import('../../scripts/guard-planning-contract.mjs')
    const cwd = createRepo()
    const body = `${managedState({
      state: 'DONE',
      review_cycle: '1',
      full_review_count: '1',
      current_head: 'deadbeef',
      last_reviewed_head: 'deadbeef',
      active_task_issue: '"#170"',
    })}\nTask issue for task-11`
    const pathValue = withStubbedGh(
      cwd,
      `#!/usr/bin/env sh
case "$*" in
  *"auth status"*) exit 0 ;;
  *"--version"*) exit 0 ;;
  *"issue view 170"*)
    printf '%s' '{"title":"[task-11] Billing API","state":"OPEN","body":${JSON.stringify(body)},"url":"https://github.com/boat1994/bemoat-web-starter/issues/170"}'
    ;;
  *)
    echo "unexpected gh call: $*" >&2
    exit 1
    ;;
esac
`.replace('${JSON.stringify(body)}', JSON.stringify(body)),
    )

    const result = mod.verifyLiveTaskIdentity({
      cwd,
      filePath: 'tests/fixtures/planning/valid-existing-issue.md',
      contract: baseContract({ active_task_issue: '#170', task_key: 'task-11' }),
      env: { ...process.env, PATH: pathValue },
    })

    expect(result.ok).toBe(false)
    expect(result.violations[0].rule).toBe('PLAN010')
    expect(mod.formatPlanningContractViolations(result.violations)[0]).toContain(
      'Found: incompatible Mission Control state',
    )
    expect(mod.formatPlanningContractViolations(result.violations)[0]).toContain(
      'Reason: recorded state is DONE or conflicts with task issue. Corrective action: Reconcile Mission Control state on issue #170',
    )
  })

  it('emits PLAN010 when managed active_task_issue conflicts with contract', async () => {
    const mod = await import('../../scripts/guard-planning-contract.mjs')
    const cwd = createRepo()
    const body = `${managedState({ active_task_issue: '"#999"' })}\nDedicated task issue for task-11`
    const pathValue = withStubbedGh(
      cwd,
      `#!/usr/bin/env sh
case "$*" in
  *"auth status"*) exit 0 ;;
  *"--version"*) exit 0 ;;
  *"issue view 170"*)
    printf '%s' '${JSON.stringify({
      title: '[task-11] Billing API',
      state: 'OPEN',
      body,
      url: 'https://github.com/boat1994/bemoat-web-starter/issues/170',
    })}'
    ;;
  *)
    echo "unexpected gh call: $*" >&2
    exit 1
    ;;
esac
`,
    )

    const result = mod.verifyLiveTaskIdentity({
      cwd,
      filePath: 'tests/fixtures/planning/valid-existing-issue.md',
      contract: baseContract({ active_task_issue: '#170', task_key: 'task-11' }),
      env: { ...process.env, PATH: pathValue },
    })

    expect(result.ok).toBe(false)
    expect(result.violations[0].rule).toBe('PLAN010')
  })

  it('passes live verification for a valid open managed issue #140', async () => {
    const mod = await import('../../scripts/guard-planning-contract.mjs')
    const cwd = createRepo()
    const body = `${managedState()}\nPlanning package for issue-140`
    const pathValue = withStubbedGh(
      cwd,
      `#!/usr/bin/env sh
case "$*" in
  *"auth status"*) exit 0 ;;
  *"--version"*) exit 0 ;;
  *"issue view 140"*)
    printf '%s' '${JSON.stringify({
      title: '[issue-140] Planning Task Identity Guard',
      state: 'OPEN',
      body,
      url: 'https://github.com/boat1994/bemoat-web-starter/issues/140',
    })}'
    ;;
  *)
    echo "unexpected gh call: $*" >&2
    exit 1
    ;;
esac
`,
    )

    const result = mod.verifyLiveTaskIdentity({
      cwd,
      filePath: 'tests/fixtures/planning/valid-existing-issue.md',
      contract: baseContract(),
      env: { ...process.env, PATH: pathValue },
    })

    expect(result).toEqual({
      ok: true,
      degradedOffline: false,
      violations: [],
      issueMetadata: {
        number: '140',
        state: 'OPEN',
        title: '[issue-140] Planning Task Identity Guard',
        body,
      },
    })
  })

  it('passes create_before_execution without calling gh issue view', async () => {
    const mod = await import('../../scripts/guard-planning-contract.mjs')
    const cwd = createRepo()
    let issueViewCalled = false
    const pathValue = withStubbedGh(
      cwd,
      `#!/usr/bin/env sh
case "$*" in
  *"auth status"*) exit 0 ;;
  *"--version"*) exit 0 ;;
  *"issue view"*)
    echo "issue view should not be called" >&2
    exit 1
    ;;
  *)
    exit 0
    ;;
esac
`,
    )

    const result = mod.verifyLiveTaskIdentity({
      cwd,
      filePath: 'tests/fixtures/planning/valid-create-before-execution.md',
      contract: baseContract({
        task_key: 'task-14',
        task_issue_strategy: 'create_before_execution',
        active_task_issue: null,
      }),
      env: { ...process.env, PATH: pathValue },
      runGh: (args, options) => {
        if (args.join(' ').includes('issue view')) {
          issueViewCalled = true
        }
        return mod.defaultRunGh(args, options)
      },
    })

    expect(issueViewCalled).toBe(false)
    expect(result).toEqual({
      ok: true,
      degradedOffline: false,
      violations: [],
    })
  })

  it('degrades offline when offline mode is requested', async () => {
    const mod = await import('../../scripts/guard-planning-contract.mjs')
    const cwd = createRepo()

    const result = mod.verifyLiveTaskIdentity({
      cwd,
      filePath: 'tests/fixtures/planning/valid-existing-issue.md',
      contract: baseContract(),
      offline: true,
    })

    expect(result).toEqual({
      ok: true,
      degradedOffline: true,
      violations: [],
    })
  })

  it('degrades offline when gh auth status is unavailable', async () => {
    const mod = await import('../../scripts/guard-planning-contract.mjs')
    const cwd = createRepo()
    const pathValue = withStubbedGh(
      cwd,
      `#!/usr/bin/env sh
case "$*" in
  *"--version"*) exit 0 ;;
  *"auth status"*) exit 4 ;;
  *)
    echo "unexpected gh call: $*" >&2
    exit 1
    ;;
esac
`,
    )

    const result = mod.verifyLiveTaskIdentity({
      cwd,
      filePath: 'tests/fixtures/planning/valid-existing-issue.md',
      contract: baseContract(),
      env: { ...process.env, PATH: pathValue },
    })

    expect(result).toEqual({
      ok: true,
      degradedOffline: true,
      violations: [],
    })
  })
})
