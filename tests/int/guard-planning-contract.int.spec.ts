import { readFileSync } from 'node:fs'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'

import { describe, expect, it } from 'vitest'

const fixturesRoot = resolve(process.cwd(), 'tests/fixtures/planning')

function readFixture(name: string) {
  return readFileSync(join(fixturesRoot, name), 'utf8')
}

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
})
