import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { afterEach, describe, expect, it } from 'vitest'

import {
  formatPlanningContractViolations,
  runPlanningContractGuard,
} from '../../scripts/guards/planning-contract-runtime.ts'

const tempRoots: string[] = []

function violationRules(violations: Array<{ rule: string }>) {
  return violations.map((item) => item.rule)
}

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
  it('does not revalidate historical planning files after a same-tree dev-to-main squash promotion', () => {
    const root = mkdtempSync(join(tmpdir(), 'planning-contract-squash-promotion-'))
    tempRoots.push(root)

    expect(spawnSync('git', ['init', '-b', 'main'], { cwd: root, encoding: 'utf8' }).status).toBe(0)
    expect(
      spawnSync('git', ['config', 'user.email', 'agent@example.com'], { cwd: root, encoding: 'utf8' })
        .status,
    ).toBe(0)
    expect(
      spawnSync('git', ['config', 'user.name', 'Agent'], { cwd: root, encoding: 'utf8' }).status,
    ).toBe(0)

    writeFileSync(join(root, 'README.md'), '# shared tree\n', 'utf8')
    expect(spawnSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' }).status).toBe(0)
    expect(spawnSync('git', ['commit', '-m', 'common ancestor'], { cwd: root, encoding: 'utf8' }).status).toBe(0)
    const commonAncestor = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim()

    const legacyPlan = join(root, 'docs/superpowers/plans/bogus/legacy/implementation-plan.md')
    expect(
      spawnSync('mkdir', ['-p', join(root, 'docs/superpowers/plans/bogus/legacy')], { encoding: 'utf8' }).status,
    ).toBe(0)
    writeFileSync(legacyPlan, '# Legacy plan without identity\n', 'utf8')
    expect(spawnSync('git', ['checkout', '-b', 'dev'], { cwd: root, encoding: 'utf8' }).status).toBe(0)
    expect(spawnSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' }).status).toBe(0)
    expect(spawnSync('git', ['commit', '-m', 'dev planning content'], { cwd: root, encoding: 'utf8' }).status).toBe(0)
    const devTip = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim()

    expect(spawnSync('git', ['checkout', 'main'], { cwd: root, encoding: 'utf8' }).status).toBe(0)
    expect(
      spawnSync('mkdir', ['-p', join(root, 'docs/superpowers/plans/bogus/legacy')], { encoding: 'utf8' }).status,
    ).toBe(0)
    writeFileSync(legacyPlan, '# Legacy plan without identity\n', 'utf8')
    expect(spawnSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' }).status).toBe(0)
    expect(
      spawnSync('git', ['commit', '-m', 'squashed main planning content'], { cwd: root, encoding: 'utf8' }).status,
    ).toBe(0)
    const mainTip = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim()

    expect(mainTip).not.toBe(devTip)
    expect(
      spawnSync('git', ['remote', 'add', 'origin', root], { cwd: root, encoding: 'utf8' }).status,
    ).toBe(0)
    expect(
      spawnSync('git', ['update-ref', 'refs/remotes/origin/dev', devTip], {
        cwd: root,
        encoding: 'utf8',
      }).status,
    ).toBe(0)
    expect(
      spawnSync('git', ['merge-base', 'HEAD', 'origin/dev'], { cwd: root, encoding: 'utf8' }).stdout.trim(),
    ).toBe(commonAncestor)
    expect(
      spawnSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf8' }).stdout.trim(),
    ).toBe(spawnSync('git', ['rev-parse', 'origin/dev^{tree}'], { cwd: root, encoding: 'utf8' }).stdout.trim())

    const violations = runPlanningContractGuard({ root })
    expect(violationRules(violations)).not.toContain('PLAN001')

    writeFileSync(legacyPlan, '# Changed planning content without identity\n', 'utf8')
    const modifiedViolations = runPlanningContractGuard({ root })
    expect(violationRules(modifiedViolations)).toContain('PLAN001')
  })

  it('falls through an unusable stale origin/dev to usable local dev and preserves PLAN001', () => {
    const root = mkdtempSync(join(tmpdir(), 'planning-contract-stale-origin-dev-'))
    tempRoots.push(root)

    expect(spawnSync('git', ['init', '-b', 'main'], { cwd: root, encoding: 'utf8' }).status).toBe(0)
    expect(
      spawnSync('git', ['config', 'user.email', 'agent@example.com'], { cwd: root, encoding: 'utf8' })
        .status,
    ).toBe(0)
    expect(
      spawnSync('git', ['config', 'user.name', 'Agent'], { cwd: root, encoding: 'utf8' }).status,
    ).toBe(0)

    writeFileSync(join(root, 'README.md'), '# shared tree\n', 'utf8')
    expect(spawnSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' }).status).toBe(0)
    expect(spawnSync('git', ['commit', '-m', 'common ancestor'], { cwd: root, encoding: 'utf8' }).status).toBe(0)
    const commonAncestor = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim()

    expect(spawnSync('git', ['checkout', '-b', 'dev'], { cwd: root, encoding: 'utf8' }).status).toBe(0)
    expect(spawnSync('git', ['checkout', '-b', 'topic'], { cwd: root, encoding: 'utf8' }).status).toBe(0)
    const invalidPlan = join(root, 'docs/superpowers/plans/bogus/stale/implementation-plan.md')
    expect(
      spawnSync('mkdir', ['-p', join(root, 'docs/superpowers/plans/bogus/stale')], { encoding: 'utf8' }).status,
    ).toBe(0)
    writeFileSync(invalidPlan, '# Committed invalid planning file\n', 'utf8')
    expect(spawnSync('git', ['add', invalidPlan], { cwd: root, encoding: 'utf8' }).status).toBe(0)
    expect(spawnSync('git', ['commit', '-m', 'invalid planning file'], { cwd: root, encoding: 'utf8' }).status).toBe(0)

    expect(spawnSync('git', ['checkout', '--orphan', 'stale-origin'], { cwd: root, encoding: 'utf8' }).status).toBe(0)
    expect(spawnSync('git', ['rm', '-rf', '.'], { cwd: root, encoding: 'utf8' }).status).toBe(0)
    writeFileSync(join(root, 'unrelated.txt'), 'unrelated stale ref\n', 'utf8')
    expect(spawnSync('git', ['add', 'unrelated.txt'], { cwd: root, encoding: 'utf8' }).status).toBe(0)
    expect(spawnSync('git', ['commit', '-m', 'unrelated stale ref'], { cwd: root, encoding: 'utf8' }).status).toBe(0)
    const staleTip = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim()

    expect(spawnSync('git', ['checkout', 'topic'], { cwd: root, encoding: 'utf8' }).status).toBe(0)
    expect(spawnSync('git', ['remote', 'add', 'origin', root], { cwd: root, encoding: 'utf8' }).status).toBe(0)
    expect(
      spawnSync('git', ['update-ref', 'refs/remotes/origin/dev', staleTip], {
        cwd: root,
        encoding: 'utf8',
      }).status,
    ).toBe(0)
    expect(spawnSync('git', ['rev-parse', 'origin/dev^{commit}'], { cwd: root, encoding: 'utf8' }).status).toBe(0)
    expect(spawnSync('git', ['rev-parse', 'dev^{commit}'], { cwd: root, encoding: 'utf8' }).status).toBe(0)
    expect(spawnSync('git', ['merge-base', 'HEAD', 'origin/dev'], { cwd: root, encoding: 'utf8' }).status).not.toBe(0)
    expect(
      spawnSync('git', ['merge-base', 'HEAD', 'dev'], { cwd: root, encoding: 'utf8' }).stdout.trim(),
    ).toBe(commonAncestor)

    const violations = runPlanningContractGuard({ root })
    expect(violationRules(violations)).toContain('PLAN001')
    expect(violations).toEqual([
      expect.objectContaining({ rule: 'PLAN001', file: 'docs/superpowers/plans/bogus/stale/implementation-plan.md' }),
    ])
  })
})
