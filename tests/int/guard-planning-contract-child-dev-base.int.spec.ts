import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { afterEach, describe, expect, it } from 'vitest'

import {
  formatPlanningContractViolations,
  runPlanningContractGuard,
} from '../../scripts/guards/planning-contract-runtime.ts'

const tempRoots: string[] = []

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) spawnSync('rm', ['-rf', root], { encoding: 'utf8' })
  }
})

describe('guard-planning-contract child dev-base discovery', () => {
  it('scopes validation to planning files changed since origin/dev on child repos', () => {
    const root = mkdtempSync(join(tmpdir(), 'planning-contract-child-dev-'))
    tempRoots.push(root)

    expect(spawnSync('git', ['init', '-b', 'dev'], { cwd: root, encoding: 'utf8' }).status).toBe(0)
    expect(
      spawnSync('git', ['config', 'user.email', 'agent@example.com'], { cwd: root, encoding: 'utf8' })
        .status,
    ).toBe(0)
    expect(
      spawnSync('git', ['config', 'user.name', 'Agent'], { cwd: root, encoding: 'utf8' }).status,
    ).toBe(0)

    const legacyPlan = join(
      root,
      'docs/superpowers/plans/bogus/legacy/implementation-plan.md',
    )
    spawnSync('mkdir', ['-p', join(root, 'docs/superpowers/plans/bogus/legacy')], {
      encoding: 'utf8',
    })
    spawnSync('sh', ['-c', `printf '%s\\n' '# Legacy plan without identity' > '${legacyPlan}'`], {
      encoding: 'utf8',
    })
    expect(spawnSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' }).status).toBe(0)
    expect(spawnSync('git', ['commit', '-m', 'legacy plan'], { cwd: root, encoding: 'utf8' }).status).toBe(0)

    const devTip = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim()
    expect(
      spawnSync('git', ['branch', '-M', 'dev'], { cwd: root, encoding: 'utf8' }).status,
    ).toBe(0)
    expect(
      spawnSync('git', ['remote', 'add', 'origin', root], { cwd: root, encoding: 'utf8' }).status,
    ).toBe(0)
    expect(
      spawnSync('git', ['update-ref', 'refs/remotes/origin/dev', devTip], {
        cwd: root,
        encoding: 'utf8',
      }).status,
    ).toBe(0)

    const changedPlan = join(
      root,
      'docs/superpowers/plans/bogus/current/implementation-plan.md',
    )
    spawnSync('mkdir', ['-p', join(root, 'docs/superpowers/plans/bogus/current')], {
      encoding: 'utf8',
    })
    const identity = `<!-- bemoat-task-identity:start -->
\`\`\`yaml
schema_version: 1
main_issue: null
task_key: "task-current"
task_issue_strategy: "create_before_execution"
active_task_issue: null
branch_template: "feature/current-slug"
transition_target: "AWAITING_REVIEW_1"
planning_base_sha: "${devTip}"
execution_base_rule: "resolve_live_protected_base_at_dispatch"
paired_spec: null
paired_plan: null
\`\`\`
<!-- bemoat-task-identity:end -->
`
    spawnSync('sh', ['-c', `printf '%s' '${identity.replace(/'/g, "'\\''")}' > '${changedPlan}'`], {
      encoding: 'utf8',
    })
    expect(spawnSync('git', ['add', changedPlan], { cwd: root, encoding: 'utf8' }).status).toBe(0)
    expect(
      spawnSync('git', ['commit', '-m', 'current plan'], { cwd: root, encoding: 'utf8' }).status,
    ).toBe(0)

    const violations = runPlanningContractGuard({ root })
    expect(formatPlanningContractViolations(violations)).toEqual(['Planning contract guard passed.'])
  })
})
