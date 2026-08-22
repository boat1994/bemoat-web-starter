import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const tempRoots: string[] = []

afterEach(() => {
  tempRoots.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }))
})

async function loadIssueDeclarations() {
  return import('../../../scripts/agent-issue/issue-declarations.mjs')
}

describe('Cluster D characterization (issue #333) — issue-declarations', () => {
  it('deriveWorkflowProfile matrix and null argument TypeError', async () => {
    const { deriveWorkflowProfile } = await loadIssueDeclarations()
    expect(
      deriveWorkflowProfile({
        taskSize: 'core',
        missionControlMode: 'required',
      }),
    ).toMatchObject({ name: 'MANAGED' })

    expect(
      deriveWorkflowProfile({
        taskSize: 'small',
        missionControlMode: null,
      }),
    ).toMatchObject({ name: 'STANDARD' })

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

    expect(deriveWorkflowProfile({})).toBeNull()
    expect(() => deriveWorkflowProfile(null as never)).toThrow(TypeError)
  })

  it('parseIssueDeclarations non-string body TypeError and last-writer-wins', async () => {
    const { parseIssueDeclarations } = await loadIssueDeclarations()
    expect(() => parseIssueDeclarations(42 as unknown as string)).toThrow(TypeError)

    const body = `
Main Issue: boat1994/bemoat-web-starter#1
### Main Issue
boat1994/bemoat-web-starter#2
## Parent

None — not a main issue line
`
    const declarations = parseIssueDeclarations(body)
    expect(declarations.mainIssueRef).toBe('boat1994/bemoat-web-starter#2')
    expect(declarations.declaresMainIssue).toBe(true)
  })

  it('parses the live Task tier Core declaration for optional STANDARD Issues', async () => {
    const { deriveWorkflowProfile, parseIssueDeclarations } = await loadIssueDeclarations()
    const declarations = parseIssueDeclarations(`
Task tier: Core
Mission Control mode: optional
Expected profile: STANDARD
`)

    expect(declarations.taskSize).toBe('core')
    expect(declarations.missionControlMode).toBe('optional')
    expect(deriveWorkflowProfile(declarations)).toMatchObject({ name: 'STANDARD' })
  })

  it('retains the existing task declaration aliases', async () => {
    const { parseIssueDeclarations } = await loadIssueDeclarations()
    for (const declaration of ['Task size: Core', 'Tier: Core', 'This is a Core']) {
      expect(parseIssueDeclarations(declaration).taskSize).toBe('core')
    }
  })

  it('parseDurableProgress malformed detection and fenced stripping', async () => {
    const { parseDurableProgress } = await loadIssueDeclarations()
    expect(parseDurableProgress('no section')).toEqual({
      hasChecklist: false,
      milestones: [],
      firstIncomplete: null,
      malformed: false,
    })

    const malformed = parseDurableProgress('## Durable Progress\n\njust prose no checkbox\n')
    expect(malformed.malformed).toBe(true)
    expect(malformed.milestones).toHaveLength(0)

    const body = `
## Durable Progress
\`\`\`
- [ ] ignored in fence
\`\`\`
### Slice A
- [x] done
- [ ] todo
`
    const progress = parseDurableProgress(body)
    expect(progress.hasChecklist).toBe(true)
    expect(progress.firstIncomplete?.label).toBe('todo')
    expect(progress.firstIncomplete?.slice).toBe('Slice A')
  })

  it('isPreReviewPlanningNoPrState strict null vs undefined heads', async () => {
    const { isPreReviewPlanningNoPrState } = await loadIssueDeclarations()
    const base = {
      workflow_mode: 'planning_no_pr',
      state: 'BLOCKED_FOR_FOUNDER_DECISION',
      review_cycle: 0,
      full_review_count: 0,
      active_pr: null as null,
      current_head: null as null,
      last_reviewed_head: null as null,
    }
    expect(isPreReviewPlanningNoPrState(base)).toBe(true)
    expect(isPreReviewPlanningNoPrState(null as never)).toBe(false)
    expect(isPreReviewPlanningNoPrState({ ...base, active_pr: undefined })).toBe(false)
    expect(isPreReviewPlanningNoPrState({ ...base, full_review_count: '0' as never })).toBe(false)
  })

  it('stateRequiresPrEvidence respects planning-no-pr and named states', async () => {
    const { stateRequiresPrEvidence } = await loadIssueDeclarations()
    expect(
      stateRequiresPrEvidence({
        workflow_mode: 'planning_no_pr',
        state: 'BLOCKED_FOR_FOUNDER_DECISION',
        review_cycle: 0,
        full_review_count: 0,
        active_pr: null,
        current_head: null,
        last_reviewed_head: null,
      }),
    ).toBe(false)
    expect(stateRequiresPrEvidence('AWAITING_REVIEW_1')).toBe(true)
    expect(stateRequiresPrEvidence({ state: 'READY' })).toBe(false)
  })

  it('validatePlanPath handles missing path, file, and section', async () => {
    const { validatePlanPath } = await loadIssueDeclarations()
    const root = mkdtempSync(join(tmpdir(), 'issue-declarations-plan-'))
    tempRoots.push(root)

    expect(validatePlanPath(root, null)).toEqual({
      ok: false,
      reason: 'No Implementation Plan path declared.',
    })

    expect(validatePlanPath(root, 'missing.md')).toMatchObject({
      ok: false,
      reason: 'Implementation Plan path does not exist: missing.md',
    })

    const planPath = 'plan.md'
    writeFileSync(join(root, planPath), '# Implementation\n\n## Target Section\n\nbody\n')
    expect(validatePlanPath(root, planPath, null)).toEqual({
      ok: true,
      planPath,
      absolutePath: join(root, planPath),
    })
    expect(validatePlanPath(root, planPath, 'Target Section').ok).toBe(true)
    expect(validatePlanPath(root, planPath, 'Missing Section').ok).toBe(false)
    expect(existsSync(join(root, planPath))).toBe(true)
  })
})
