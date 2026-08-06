import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { afterEach, describe, expect, it } from 'vitest'

import {
  resolvePlanningAuthorizationBaseSha,
  verifyPlanningNoPrDurableProofs,
} from '../../scripts/agent-issue/planning-no-pr-lineage.mjs'
import * as planningNoPrLineageModule from '../../scripts/agent-issue/planning-no-pr-lineage.mjs'
import * as reconcileModule from '../../scripts/mission-control-reconcile.mjs'
import {
  normalizeWorkflowMode,
  populateOrPreservePlanningAuthorizationBaseSha,
  parseMissionControlState,
  renderMissionControlState,
} from '../../scripts/mission-control-state.mjs'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped runtime .mjs boundary */
const { proposeDeliveryReconciliation } = reconcileModule as unknown as Record<string, (...args: any[]) => any>
const compareProtectedBaseTrees = planningNoPrLineageModule.compareProtectedBaseTrees as unknown as (input: Record<string, unknown>) => Record<string, unknown>
const CoordinatorClass = reconcileModule.Coordinator as unknown as new (transports: Record<string, unknown>) => {
  integrateHandoff: (input: Record<string, unknown>) => Promise<Record<string, unknown>>
  integrateResult: (input: Record<string, unknown>) => Promise<Record<string, unknown>>
  reconcileReviewVerdict: (input: Record<string, unknown>) => Promise<Record<string, unknown>>
}

/**
 * WF-01..WF-12 traceability (IMPORTANT-2)
 *
 * | WF    | Test name | Production seam | Lineage injected? | Pos/Neg |
 * |-------|-----------|-----------------|-------------------|---------|
 * | WF-01 | WF-01: native population through real HANDOFF production transition | Coordinator.integrateHandoff → _coordinatorOwnedRouting | explicit planningAuthorizationBaseSha seam (not guide_source_sha) | + populates; − guide_source_sha alone fails closed |
 * | WF-02 | WF-02: planning branch created before protected policy advance | verifyPlanningNoPrDurableProofs | fixture state | + pass with B0 ancestor |
 * | WF-03 | WF-03: policy provenance differs from ancestry base | integrateHandoff + verify proofs | explicit B0; guide_source_sha=D3 | + lineage=B0; − not equal to policy tip |
 * | WF-04 | WF-04: non-planning HANDOFF does not populate lineage | integrateHandoff | N/A (implementation_pr / absent) | − no planning_authorization_base_sha |
 * | WF-05 | WF-05: duplicate replay preserves original lineage | populateOrPreserve + integrateHandoff replay | same SHA | + preserve; populated=false |
 * | WF-06 | WF-06: conflicting lineage fails closed | populateOrPreserve + integrateHandoff | conflicting SHA | − STATE_CONFLICT |
 * | WF-07 | WF-07: legacy missing lineage returns migration-required | verifyPlanningNoPrDurableProofs | absent | − STATE_MIGRATION_REQUIRED |
 * | WF-08 | WF-08: child dev protected-base topology works | verifyPlanningNoPrDurableProofs | fixture on `dev` | + pass |
 * | WF-09 | WF-09: valid lineage does not bypass other correction guards | verifyPlanningNoPrDurableProofs | valid lineage + active_pr set | − active_pr guard still blocks |
 * | WF-10 | WF-10: review projection preserves lineage | reconcileReviewVerdict | pre-set lineage | + preserved |
 * | WF-11 | WF-11: RESULT/reconciliation preserve lineage | proposeDeliveryReconciliation + integrateResult | pre-set lineage | + preserved |
 * | WF-12 | WF-12: child-sync inventory includes implementation and tests | sync-boilerplate managedPaths | N/A | + paths present |
 *
 * Pre-correction (guide_source_sha assignment) fails WF-01/WF-03: policy tip D3 would be locked as lineage and fail ancestry against H1.
 */

const tempRoots: string[] = []

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

function runGit(cwd: string, args: string[]) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  expect(result.status, `${args.join(' ')}\n${result.stderr}`).toBe(0)
  return result.stdout.trim()
}

function createRepo(initialBranch = 'main') {
  const root = mkdtempSync(join(tmpdir(), 'bemoat-planning-lineage-'))
  tempRoots.push(root)
  spawnSync('git', ['init', '-b', initialBranch], { cwd: root, encoding: 'utf8' })
  spawnSync('git', ['config', 'user.email', 'lineage@test'], { cwd: root, encoding: 'utf8' })
  spawnSync('git', ['config', 'user.name', 'Lineage Test'], { cwd: root, encoding: 'utf8' })
  return root
}

function seedCommit(root: string, relativePath: string, content: string, message: string) {
  const absolute = join(root, relativePath)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, content)
  runGit(root, ['add', relativePath])
  runGit(root, ['commit', '-m', message])
  return runGit(root, ['rev-parse', 'HEAD'])
}

function managedIssueBody(fields: Record<string, string | number | null>) {
  const yamlLines = Object.entries({
    schema_version: 1,
    state: 'CORRECTION_REQUIRED_2',
    review_cycle: 2,
    full_review_count: 1,
    approved_base: 'main',
    active_task_issue: '"#92"',
    active_pr: null,
    current_head: null,
    last_reviewed_head: null,
    guide_version: '1.2.0',
    guide_source_ref: 'main',
    guide_source_sha: null,
    open_blockers: '[]',
    follow_up_issues: '[]',
    next_permitted_action: '"bounded planning correction"',
    material_change_status: 'none',
    updated_at: '"2026-07-31T00:00:00.000Z"',
    updated_by: '"Mission Control"',
    ...fields,
  }).map(([key, value]) => {
    if (value === null) return `${key}: null`
    if (typeof value === 'number') return `${key}: ${value}`
    if (typeof value === 'string' && (value.startsWith('"') || value === '[]' || value === 'null')) {
      return `${key}: ${value}`
    }
    return `${key}: ${JSON.stringify(value)}`
  })

  return `## Status

<!-- bemoat-mission-control-state:start -->
\`\`\`yaml
${yamlLines.join('\n')}
\`\`\`
<!-- bemoat-mission-control-state:end -->
`
}

/**
 * Finance #92 sibling-history topology (synthetic SHAs):
 *
 *               H1  planning reviewed head
 *              /
 *   B0 lineage base
 *              \
 *               D1 -- D2 -- D3  protected policy advances
 */
function buildSiblingHistoryGraph(protectedBranch = 'main') {
  const root = createRepo(protectedBranch)
  const lineageBase = seedCommit(root, 'README.md', 'finance baseline B0', 'B0 finance baseline')

  runGit(root, ['checkout', '-b', 'docs/92-planning'])
  const reviewedHead = seedCommit(root, 'docs/plan.md', 'planning H1', 'H1 planning reviewed head')

  runGit(root, ['checkout', protectedBranch])
  seedCommit(root, 'harness-d1.txt', 'D1', 'D1 harness advance')
  seedCommit(root, 'harness-d2.txt', 'D2', 'D2 harness advance')
  const policyHead = seedCommit(root, 'harness-d3.txt', 'D3', 'D3 harness advance')

  runGit(root, ['checkout', 'docs/92-planning'])
  expect(runGit(root, ['rev-parse', 'HEAD'])).toBe(reviewedHead)

  const ancestryPolicyToReviewed = spawnSync(
    'git',
    ['merge-base', '--is-ancestor', policyHead, reviewedHead],
    { cwd: root, encoding: 'utf8' },
  )
  expect(ancestryPolicyToReviewed.status).not.toBe(0)

  const ancestryLineageToReviewed = spawnSync(
    'git',
    ['merge-base', '--is-ancestor', lineageBase, reviewedHead],
    { cwd: root, encoding: 'utf8' },
  )
  expect(ancestryLineageToReviewed.status).toBe(0)

  return { root, lineageBase, reviewedHead, policyHead, protectedBranch }
}

const planningHandoffBody = `## HANDOFF

### Task log
- Timestamp: 2026-07-31T00:00:00Z
- Task / Issue: #92
- Phase: Planning
- Executing role: Mission Control

**Target:** Dev / Builder
**Objective:** Author planning artifacts from the authorized lineage base.
**Links:** Issue #92
**Next:** Dev posts planning ## RESULT
`

function readyPlanningState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    state: 'READY',
    review_cycle: 0,
    full_review_count: 0,
    approved_base: 'main',
    active_task_issue: '"#92"',
    active_pr: null as string | null,
    current_head: null as string | null,
    last_reviewed_head: null as string | null,
    workflow_mode: 'planning_no_pr',
    guide_version: '1.2.0',
    guide_source_ref: 'main',
    guide_source_sha: null as string | null,
    open_blockers: [] as string[],
    follow_up_issues: [] as string[],
    next_permitted_action: 'Mission Control posts HANDOFF',
    material_change_status: 'none',
    updated_at: '2026-07-31T00:00:00.000Z',
    updated_by: 'Mission Control',
    ...overrides,
  }
}

function createCoordinator(initialState: Record<string, unknown>, comments: any[] = []) {
  let state = structuredClone(initialState)
  const coordinator = new CoordinatorClass({
    readState: async () => state,
    writeState: async (next: any) => {
      state = structuredClone(next)
      return state
    },
    listComments: async () => comments,
    postComment: async (body: string) => {
      const posted = { id: String(comments.length + 1), body }
      comments.push(posted)
      return posted
    },
  })
  return {
    coordinator,
    getState: () => state,
    comments,
  }
}

describe('planning_no_pr lineage Option A', () => {
  it('resolvePlanningAuthorizationBaseSha rejects non-SHA mutable refs', () => {
    expect(resolvePlanningAuthorizationBaseSha({ planning_authorization_base_sha: 'main' })).toEqual({
      sha: null,
      missing: false,
      invalid: true,
    })
    expect(resolvePlanningAuthorizationBaseSha({})).toEqual({
      sha: null,
      missing: true,
      invalid: false,
    })
  })

  it('normalizeWorkflowMode accepts only durable enum values', () => {
    expect(normalizeWorkflowMode('planning_no_pr')).toEqual({ ok: true, value: 'planning_no_pr' })
    expect(normalizeWorkflowMode('implementation_pr')).toEqual({ ok: true, value: 'implementation_pr' })
    expect(normalizeWorkflowMode(null)).toEqual({ ok: true, value: null })
    expect(normalizeWorkflowMode('docs/92-planning')).toMatchObject({ ok: false })
    expect(normalizeWorkflowMode('planning')).toMatchObject({ ok: false })
  })

  it('Issue #255: tree-identical protected-base advance is repairable and a changed tree conflicts', () => {
    const root = createRepo('main')
    const protectedBase = seedCommit(root, 'README.md', 'protected policy', 'protected baseline')
    const treeIdenticalAdvance = runGit(root, ['commit', '--allow-empty', '-m', 'protected ref advance'])
      && runGit(root, ['rev-parse', 'HEAD'])
    const changedTree = seedCommit(root, 'README.md', 'changed protected policy', 'changed protected tree')

    expect(compareProtectedBaseTrees({
      cwd: root,
      previousSha: protectedBase,
      currentSha: treeIdenticalAdvance,
    })).toMatchObject({
      sameTree: true,
      classification: 'REPAIRABLE_DRIFT',
    })
    expect(compareProtectedBaseTrees({
      cwd: root,
      previousSha: protectedBase,
      currentSha: changedTree,
    })).toMatchObject({
      sameTree: false,
      classification: 'STATE_CONFLICT',
    })
  })

  it('1: protected policy base unchanged — lineage base ancestor of reviewed head — pass', () => {
    const root = createRepo('main')
    const lineageBase = seedCommit(root, 'README.md', 'baseline', 'baseline')
    runGit(root, ['checkout', '-b', 'docs/92-planning'])
    const reviewedHead = seedCommit(root, 'docs/plan.md', 'plan', 'planning head')

    const issueBody = managedIssueBody({
      approved_base: 'main',
      guide_source_sha: `"${lineageBase}"`,
      planning_authorization_base_sha: `"${lineageBase}"`,
      last_reviewed_head: `"${reviewedHead}"`,
    })

    const result = verifyPlanningNoPrDurableProofs({
      cwd: root,
      env: process.env,
      issueBody,
      issueNumber: 92,
      contractReviewedHead: reviewedHead,
      branchName: 'docs/92-planning',
      verdictBase: 'main',
    })

    expect(result).toEqual({ ok: true, errors: [] })
  })

  it('rejects branch-name values stuffed into planning_authorization_base_sha', () => {
    const { root, reviewedHead, policyHead } = buildSiblingHistoryGraph()

    const issueBody = managedIssueBody({
      approved_base: 'main',
      guide_source_sha: `"${policyHead}"`,
      planning_authorization_base_sha: '"main"',
      last_reviewed_head: `"${reviewedHead}"`,
    })

    const result = verifyPlanningNoPrDurableProofs({
      cwd: root,
      env: process.env,
      issueBody,
      issueNumber: 92,
      contractReviewedHead: reviewedHead,
      branchName: 'docs/92-planning',
      verdictBase: 'main',
    })

    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(
      /STATE CONFLICT: managed Mission Control state block is missing or invalid for planning_no_pr authorization|planning_authorization_base_sha must be an exact full commit SHA/,
    )
  })
})

describe('WF-01..WF-12 planning_no_pr lineage evidence matrix', () => {
  it('WF-01: native population through real HANDOFF production transition', () => {
    const lineageBase = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const policyTip = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    
    const root = mkdtempSync(join(tmpdir(), 'bemoat-dispatch-test-'))
    tempRoots.push(root)
    const ghPath = join(root, 'gh')
    const statePath = join(root, 'state.json')
    const initialBody = renderMissionControlState(readyPlanningState({ guide_source_sha: policyTip }))
    writeFileSync(statePath, JSON.stringify({ body: initialBody, comments: [] }))
    
    const ghMock = `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
const statePath = ${JSON.stringify(statePath)}
const args = process.argv.slice(2)
const state = JSON.parse(readFileSync(statePath, 'utf8'))
const phantomHandoff = process.env.BEMOAT_PHANTOM_HANDOFF === '1'
if (args[0] === 'repo' && args[1] === 'view') {
  console.log(JSON.stringify({ nameWithOwner: 'boat1994/test' }))
} else if (args[0] === 'issue' && args[1] === 'view') {
  console.log(JSON.stringify({ body: state.body }))
} else if (args[0] === 'api' && args.some(a => a.includes('comments')) && !args.includes('POST')) {
  console.log(JSON.stringify(state.comments))
} else if (args[0] === 'api' && args.some(a => a.includes('comments')) && args.includes('POST')) {
  const input = JSON.parse(readFileSync(args[args.indexOf('--input') + 1], 'utf8'))
  const comment = {
    id: 100,
    body: input.body,
    user: { login: 'boat1994' },
    author_association: 'OWNER',
    html_url: 'https://github.com/boat1994/test/issues/92#issuecomment-100',
  }
  if (!phantomHandoff) {
    state.comments.push(comment)
    writeFileSync(statePath, JSON.stringify(state))
  }
  console.log(JSON.stringify(comment))
} else if (args[0] === 'issue' && args[1] === 'comment') {
  const body = readFileSync(args[args.indexOf('--body-file') + 1], 'utf8')
  const comment = { id: 100, body, user: { login: 'boat1994' }, author_association: 'OWNER' }
  state.comments.push(comment)
  writeFileSync(statePath, JSON.stringify(state))
} else if (args[0] === 'issue' && args[1] === 'edit') {
  const body = readFileSync(args[args.indexOf('--body-file') + 1], 'utf8')
  state.body = body
  writeFileSync(statePath, JSON.stringify(state))
} else if (args[0] === 'api' && args.some(a => a.includes('/contents/'))) {
  // mock for lease store
  if (args.includes('PUT') || args.includes('-X')) {
    console.log(JSON.stringify({ content: { sha: 'new_sha' } }))
  } else {
    // 404 for read
    process.stderr.write('404 Not Found')
    process.exit(1)
  }
}
`
    writeFileSync(ghPath, ghMock)
    chmodSync(ghPath, 0o755)

    const dispatchScript = join(process.cwd(), 'scripts/mission-control-dispatch.mjs')
    const handoffPath = join(root, 'handoff.md')
    writeFileSync(handoffPath, planningHandoffBody)

    // Test without seam
    const withoutSeam = spawnSync(process.execPath, [dispatchScript, '92', '--repo', 'boat1994/test', '--body-file', handoffPath], {
      env: { ...process.env, PATH: `${root}:${process.env.PATH}`, GITHUB_REPOSITORY_OWNER: 'boat1994' },
      encoding: 'utf8',
    })
    expect(withoutSeam.status).not.toBe(0)
    expect(withoutSeam.stderr || withoutSeam.stdout).toMatch(/planning_no_pr HANDOFF requires explicit planning_authorization_base_sha/)

    // Reset state for retry
    writeFileSync(statePath, JSON.stringify({ body: initialBody, comments: [] }))

    // Test with seam
    const result = spawnSync(process.execPath, [dispatchScript, '92', '--repo', 'boat1994/test', '--body-file', handoffPath, '--workflow-mode', 'planning_no_pr', '--planning-base-sha', lineageBase], {
      env: { ...process.env, PATH: `${root}:${process.env.PATH}`, GITHUB_REPOSITORY_OWNER: 'boat1994' },
      encoding: 'utf8',
    })
    if (result.status !== 0) {
      console.error(result.stderr || result.stdout)
    }
    expect(result.status).toBe(0)

    const finalState = JSON.parse(readFileSync(statePath, 'utf8'))
    const parsed = parseMissionControlState(finalState.body)
    expect(parsed.state).toBeTruthy()
    if (!parsed.state) throw new Error('State must be populated')
    expect(parsed.state.planning_authorization_base_sha).toBe(lineageBase)
    expect(parsed.state.planning_authorization_base_sha).not.toBe(policyTip)
    expect(parsed.state.guide_source_sha).toBe(policyTip)
    expect(parsed.state.workflow_mode).toBe('planning_no_pr')

    writeFileSync(statePath, JSON.stringify({ body: initialBody, comments: [] }))
    const phantom = spawnSync(process.execPath, [dispatchScript, '92', '--repo', 'boat1994/test', '--body-file', handoffPath, '--workflow-mode', 'planning_no_pr', '--planning-base-sha', lineageBase], {
      env: {
        ...process.env,
        PATH: `${root}:${process.env.PATH}`,
        GITHUB_REPOSITORY_OWNER: 'boat1994',
        BEMOAT_PHANTOM_HANDOFF: '1',
      },
      encoding: 'utf8',
    })
    expect(phantom.status, phantom.stderr || phantom.stdout).toBe(4)
    const phantomState = JSON.parse(readFileSync(statePath, 'utf8'))
    expect(parseMissionControlState(phantomState.body).state?.state).toBe('READY')
    expect(phantomState.comments).toEqual([])
  })

  it('WF-02: planning branch created before protected policy advance', () => {
    const { root, lineageBase, reviewedHead, policyHead } = buildSiblingHistoryGraph()
    expect(policyHead).not.toBe(lineageBase)

    const issueBody = managedIssueBody({
      approved_base: 'main',
      guide_source_sha: `"${policyHead}"`,
      planning_authorization_base_sha: `"${lineageBase}"`,
      last_reviewed_head: `"${reviewedHead}"`,
    })

    const result = verifyPlanningNoPrDurableProofs({
      cwd: root,
      env: process.env,
      issueBody,
      issueNumber: 92,
      contractReviewedHead: reviewedHead,
      branchName: 'docs/92-planning',
      verdictBase: 'main',
    })
    expect(result).toEqual({ ok: true, errors: [] })
  })

  it('WF-03: policy provenance differs from ancestry base', async () => {
    const { root, lineageBase, reviewedHead, policyHead } = buildSiblingHistoryGraph()
    expect(policyHead).not.toBe(lineageBase)

    const { coordinator, getState } = createCoordinator(
      readyPlanningState({
        guide_source_sha: policyHead,
        approved_base: 'main',
      }),
    )
    await coordinator.integrateHandoff({
      handoffBody: planningHandoffBody,
      planningAuthorizationBaseSha: lineageBase,
    })
    expect(getState().planning_authorization_base_sha).toBe(lineageBase)
    expect(getState().guide_source_sha).toBe(policyHead)
    expect(getState().planning_authorization_base_sha).not.toBe(getState().guide_source_sha)

    const proofs = verifyPlanningNoPrDurableProofs({
      cwd: root,
      env: process.env,
      issueBody: managedIssueBody({
        approved_base: 'main',
        guide_source_sha: `"${policyHead}"`,
        planning_authorization_base_sha: `"${lineageBase}"`,
        last_reviewed_head: `"${reviewedHead}"`,
      }),
      issueNumber: 92,
      contractReviewedHead: reviewedHead,
      branchName: 'docs/92-planning',
      verdictBase: 'main',
    })
    expect(proofs.ok).toBe(true)
  })

  it('WF-04: non-planning HANDOFF does not populate lineage', async () => {
    const policyTip = 'cccccccccccccccccccccccccccccccccccccccc'
    const forImpl = createCoordinator(
      readyPlanningState({
        workflow_mode: 'implementation_pr',
        guide_source_sha: policyTip,
        active_pr: '"#230"',
      }),
    )
    await forImpl.coordinator.integrateHandoff({
      handoffBody: planningHandoffBody,
      planningAuthorizationBaseSha: 'dddddddddddddddddddddddddddddddddddddddd',
    })
    expect(forImpl.getState()).not.toHaveProperty('planning_authorization_base_sha')

    const absentModeState = readyPlanningState({ guide_source_sha: policyTip })
    delete (absentModeState as { workflow_mode?: string }).workflow_mode
    const rebuilt = createCoordinator(absentModeState)
    await rebuilt.coordinator.integrateHandoff({ handoffBody: planningHandoffBody })
    expect(rebuilt.getState()).not.toHaveProperty('planning_authorization_base_sha')
    expect(rebuilt.getState().guide_source_sha).toBe(policyTip)
  })

  it('WF-05: duplicate replay preserves original lineage', async () => {
    const lineageBase = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    const { coordinator, getState, comments } = createCoordinator(
      readyPlanningState({ planning_authorization_base_sha: lineageBase }),
    )
    await coordinator.integrateHandoff({
      handoffBody: planningHandoffBody,
      planningAuthorizationBaseSha: lineageBase,
    })
    expect(getState().planning_authorization_base_sha).toBe(lineageBase)

    const preserved = populateOrPreservePlanningAuthorizationBaseSha(getState(), lineageBase)
    expect(preserved.ok).toBe(true)
    if (!preserved.ok) return
    expect(preserved.populated).toBe(false)
    expect(preserved.state.planning_authorization_base_sha).toBe(lineageBase)

    // Replay against already-IN_PROGRESS is rejected by precondition; resume-style
    // preserve path uses the same populateOrPreserve helper exercised above.
    expect(comments).toHaveLength(1)
  })

  it('WF-06: conflicting lineage fails closed', async () => {
    const original = 'ffffffffffffffffffffffffffffffffffffffff'
    const conflict = '1111111111111111111111111111111111111111'
    const direct = populateOrPreservePlanningAuthorizationBaseSha(
      readyPlanningState({ planning_authorization_base_sha: original }),
      conflict,
    )
    expect(direct.ok).toBe(false)

    const { coordinator } = createCoordinator(
      readyPlanningState({ planning_authorization_base_sha: original }),
    )
    await expect(
      coordinator.integrateHandoff({
        handoffBody: planningHandoffBody,
        planningAuthorizationBaseSha: conflict,
      }),
    ).rejects.toThrow(/immutable once authorized|conflicts with the requested lineage/)
  })

  it('WF-07: legacy missing lineage returns migration-required', () => {
    const { root, reviewedHead, policyHead } = buildSiblingHistoryGraph()
    const issueBody = managedIssueBody({
      approved_base: 'main',
      guide_source_sha: `"${policyHead}"`,
      last_reviewed_head: `"${reviewedHead}"`,
    })
    const result = verifyPlanningNoPrDurableProofs({
      cwd: root,
      env: process.env,
      issueBody,
      issueNumber: 92,
      contractReviewedHead: reviewedHead,
      branchName: 'docs/92-planning',
      verdictBase: 'main',
    })
    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.startsWith('STATE_MIGRATION_REQUIRED:'))).toBe(true)
    expect(result.errors.join('\n')).toContain('planning_authorization_base_sha')
    expect(result.errors.join('\n')).toContain('mutable approved_base')
  })

  it('WF-08: child dev protected-base topology works', () => {
    const { root, lineageBase, reviewedHead, policyHead, protectedBranch } =
      buildSiblingHistoryGraph('dev')
    expect(protectedBranch).toBe('dev')

    const issueBody = managedIssueBody({
      approved_base: 'dev',
      guide_source_ref: 'dev',
      guide_source_sha: `"${policyHead}"`,
      planning_authorization_base_sha: `"${lineageBase}"`,
      last_reviewed_head: `"${reviewedHead}"`,
    })
    const result = verifyPlanningNoPrDurableProofs({
      cwd: root,
      env: process.env,
      issueBody,
      issueNumber: 92,
      contractReviewedHead: reviewedHead,
      branchName: 'docs/92-planning',
      verdictBase: 'dev',
    })
    expect(result).toEqual({ ok: true, errors: [] })
  })

  it('WF-09: valid lineage does not bypass other correction guards', () => {
    const { root, lineageBase, reviewedHead, policyHead } = buildSiblingHistoryGraph()
    const issueBody = managedIssueBody({
      approved_base: 'main',
      guide_source_sha: `"${policyHead}"`,
      planning_authorization_base_sha: `"${lineageBase}"`,
      last_reviewed_head: `"${reviewedHead}"`,
      active_pr: '"#196"',
    })
    const result = verifyPlanningNoPrDurableProofs({
      cwd: root,
      env: process.env,
      issueBody,
      issueNumber: 92,
      contractReviewedHead: reviewedHead,
      branchName: 'docs/92-planning',
      verdictBase: 'main',
    })
    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.includes('active_pr: null'))).toBe(true)
    expect(result.errors.join('\n')).not.toContain('planning_authorization_base_sha')
  })

  it('WF-10: review projection preserves lineage', async () => {
    const lineageBase = '2222222222222222222222222222222222222222'
    const head = '3333333333333333333333333333333333333333'
    const verdictBody = `## REVIEW_VERDICT

### Task log
- Timestamp: 2026-07-31T00:00:00Z
- Task / Issue: #92
- Phase: Reviewer
- Executing role: Reviewer

**PR / base / head:** PR #230 · \`main\` · \`${head}\`
**Verdict:** CORRECTION REQUIRED
**Findings:** Critical: None · Important: None
**Gates:** exact-head CI pass
**Next:** Dev corrects
`
    let state: any = {
      ...readyPlanningState({
        state: 'AWAITING_REVIEW_1',
        review_cycle: 0,
        full_review_count: 0,
        active_pr: '"#230"',
        current_head: head,
        planning_authorization_base_sha: lineageBase,
        workflow_mode: 'planning_no_pr',
      }),
    }
    const comments = [{ id: 'rv-1', body: verdictBody }]
    const coordinator = new CoordinatorClass({
      readState: async () => state,
      writeState: async (next: any) => {
        state = structuredClone(next)
        return state
      },
      listComments: async () => comments,
      postComment: async () => {
        throw new Error('should not post')
      },
    })
    const result = await coordinator.reconcileReviewVerdict({
      verdictBody,
      projectReview: (original: any) => ({
        ...original,
        state: 'CORRECTION_REQUIRED_1',
        review_cycle: 1,
        full_review_count: 1,
        last_reviewed_head: head,
        open_blockers: ['CRITICAL-1'],
      }),
    })
    expect(result.outcome).toBe('RECONCILED')
    expect(state.planning_authorization_base_sha).toBe(lineageBase)
    expect(state.workflow_mode).toBe('planning_no_pr')
  })

  it('WF-11: RESULT/reconciliation preserve lineage', async () => {
    const lineageBase = '4444444444444444444444444444444444444444'
    const head = '5555555555555555555555555555555555555555'
    const managedState = {
      ...readyPlanningState({
        state: 'CORRECTION_REQUIRED_2',
        review_cycle: 2,
        full_review_count: 1,
        active_pr: '"#230"',
        current_head: 'oldheadoldheadoldheadoldheadoldheadoldhe',
        last_reviewed_head: '9ffda4e45ad0a8c8e67bfc3de84b580a69f7abe4',
        planning_authorization_base_sha: lineageBase,
        open_blockers: ['CRITICAL-2'],
      }),
    }
    const proposed = proposeDeliveryReconciliation({
      managedState,
      livePr: { number: 230, headRefOid: head, baseRefName: 'main' },
      activeTaskIssue: '229',
      approvedBase: 'main',
      latestResult: { parsed: { headSha: head, prNumber: '230', base: 'main' } },
      updatedAt: '2026-07-31T00:00:00.000Z',
      updatedBy: 'Mission Control',
    })
    expect(proposed.state).toBe('AWAITING_REVIEW_3')
    expect(proposed.planning_authorization_base_sha).toBe(lineageBase)
    expect(proposed.review_cycle).toBe(2)
    expect(proposed.full_review_count).toBe(1)
    expect(proposed.last_reviewed_head).toBe('9ffda4e45ad0a8c8e67bfc3de84b580a69f7abe4')

    const resultBody = `## RESULT

### Task log
- Timestamp: 2026-07-31T00:00:00Z
- Task / Issue: #229
- Phase: Correction 2
- Executing role: Dev / Builder

**Completed:** Correction 2
**State:** branch \`fix/229-planning-no-pr-lineage-base\` · base \`main\` · head \`${head}\`
**PR:** https://github.com/boat1994/bemoat-web-starter/pull/230
**Summary:** lineage correction
**Next:** Review 3
`
    let state: any = structuredClone(managedState)
    const comments: any[] = []
    const coordinator = new CoordinatorClass({
      readState: async () => state,
      writeState: async (next: any) => {
        state = structuredClone(next)
        return state
      },
      listComments: async () => comments,
      postComment: async (body: string) => {
        const posted = { id: 'result-1', body }
        comments.push(posted)
        return posted
      },
    })
    const delivered = await coordinator.integrateResult({
      resultBody,
      projectState: () => proposed,
    })
    expect(delivered.outcome).toBe('DELIVERED')
    expect(state.planning_authorization_base_sha).toBe(lineageBase)
    expect(state.state).toBe('AWAITING_REVIEW_3')
  })

  it('WF-12: child-sync inventory includes implementation and tests', async () => {
    const sync = await import('../../scripts/sync-boilerplate.mjs')
    const required = [
      'scripts/mission-control-state.mjs',
      'scripts/mission-control-reconcile.mjs',
      'scripts/agent-issue',
      'tests/int/planning-no-pr-lineage.int.spec.ts',
    ]
    for (const path of required) {
      expect(sync.managedPaths, `${path} must sync to children`).toContain(path)
    }
  })
})

describe('planning_authorization_base_sha durable schema support', () => {
  it('parse/render preserves an exact lineage SHA intentionally (not only unknown-field pass-through)', async () => {
    const lineageSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const body = renderMissionControlState({
      schema_version: 1,
      state: 'CORRECTION_REQUIRED_1',
      review_cycle: 1,
      full_review_count: 1,
      approved_base: 'main',
      active_task_issue: '"#229"',
      active_pr: null as string | null,
      current_head: null as string | null,
      last_reviewed_head: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      workflow_mode: 'planning_no_pr',
      planning_authorization_base_sha: lineageSha,
      guide_version: '1.2.0',
      guide_source_ref: 'main',
      guide_source_sha: null as string | null,
      open_blockers: [] as string[],
      follow_up_issues: [] as string[],
      next_permitted_action: 'bounded planning correction',
      material_change_status: 'none',
      updated_at: '2026-07-31T00:00:00.000Z',
      updated_by: 'Mission Control',
    })

    expect(body).toContain('planning_authorization_base_sha:')
    expect(body).toContain('workflow_mode:')
    const parsed = parseMissionControlState(body)
    expect(parsed.valid).toBe(true)
    expect(parsed.state?.planning_authorization_base_sha).toBe(lineageSha)
    expect(parsed.state?.workflow_mode).toBe('planning_no_pr')

    const roundTrip = parseMissionControlState(renderMissionControlState(parsed.state ?? {}))
    expect(roundTrip.valid).toBe(true)
    expect(roundTrip.state?.planning_authorization_base_sha).toBe(lineageSha)
  })

  it('fails closed on malformed planning_authorization_base_sha values', async () => {
    const body = renderMissionControlState({
      schema_version: 1,
      state: 'READY',
      review_cycle: 0,
      full_review_count: 0,
      approved_base: 'main',
      active_task_issue: '"#229"',
      active_pr: null as string | null,
      current_head: null as string | null,
      last_reviewed_head: null as string | null,
      planning_authorization_base_sha: 'main',
      guide_version: '1.2.0',
      guide_source_ref: 'main',
      guide_source_sha: null as string | null,
      open_blockers: [] as string[],
      follow_up_issues: [] as string[],
      next_permitted_action: 'authorize planning lineage',
      material_change_status: 'none',
      updated_at: '2026-07-31T00:00:00.000Z',
      updated_by: 'Mission Control',
    })
    const parsed = parseMissionControlState(body)
    expect(parsed.valid).toBe(false)
    expect(parsed.reason).toContain('planning_authorization_base_sha')
  })

  it('populateOrPreservePlanningAuthorizationBaseSha is the deterministic write path for new planning tasks', async () => {
    const lineageSha = 'cccccccccccccccccccccccccccccccccccccccc'
    const base: Record<string, unknown> = {
      schema_version: 1,
      state: 'READY',
      review_cycle: 0,
      full_review_count: 0,
      approved_base: 'main',
      active_task_issue: '"#229"',
      active_pr: null,
      current_head: null,
      last_reviewed_head: null,
      workflow_mode: 'planning_no_pr',
      guide_version: '1.2.0',
      guide_source_ref: 'main',
      guide_source_sha: null,
      open_blockers: [],
      follow_up_issues: [],
      next_permitted_action: 'authorize planning lineage',
      material_change_status: 'none',
      updated_at: '2026-07-31T00:00:00.000Z',
      updated_by: 'Mission Control',
    }

    const populated = populateOrPreservePlanningAuthorizationBaseSha(base, lineageSha)
    expect(populated.ok).toBe(true)
    if (!populated.ok) return
    expect(populated.populated).toBe(true)
    expect(populated.state.planning_authorization_base_sha).toBe(lineageSha)

    const preserved = populateOrPreservePlanningAuthorizationBaseSha(populated.state, lineageSha)
    expect(preserved.ok).toBe(true)
    if (!preserved.ok) return
    expect(preserved.populated).toBe(false)

    const conflict = populateOrPreservePlanningAuthorizationBaseSha(
      populated.state,
      'dddddddddddddddddddddddddddddddddddddddd',
    )
    expect(conflict.ok).toBe(false)

    const rendered = renderMissionControlState(populated.state)
    const parsed = parseMissionControlState(rendered)
    expect(parsed.valid).toBe(true)
    expect(parsed.state?.planning_authorization_base_sha).toBe(lineageSha)
  })
})
