import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { afterEach, describe, expect, it } from 'vitest'

import {
  resolvePlanningAuthorizationBaseSha,
  verifyPlanningNoPrDurableProofs,
} from '../../scripts/agent-issue/planning-no-pr-lineage.mjs'

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
 *              \\
 *               D1 -- D2 -- D3  protected policy advances
 */
function buildSiblingHistoryGraph() {
  const root = createRepo('main')
  const lineageBase = seedCommit(root, 'README.md', 'finance baseline B0', 'B0 finance baseline')

  runGit(root, ['checkout', '-b', 'docs/92-planning'])
  const reviewedHead = seedCommit(root, 'docs/plan.md', 'planning H1', 'H1 planning reviewed head')

  runGit(root, ['checkout', 'main'])
  seedCommit(root, 'harness-d1.txt', 'D1', 'D1 harness advance')
  seedCommit(root, 'harness-d2.txt', 'D2', 'D2 harness advance')
  const policyHead = seedCommit(root, 'harness-d3.txt', 'D3', 'D3 harness advance')

  // Planning branch stays at H1; protected tip is D3 on sibling history.
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

  return { root, lineageBase, reviewedHead, policyHead }
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

  it('2: sibling-history policy advance — lineage ancestor; current policy tip NOT ancestor — pass', () => {
    const { root, lineageBase, reviewedHead, policyHead } = buildSiblingHistoryGraph()

    const issueBody = managedIssueBody({
      approved_base: 'main',
      guide_source_ref: 'main',
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

    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    // Topology mirrors Finance #92: policy tip is not an ancestor of reviewed head.
    expect(policyHead).not.toBe(lineageBase)
    expect(policyHead).not.toBe(reviewedHead)
  })

  it('3: claimed lineage base is not an ancestor of arbitrary stale planning head — fail', () => {
    const { root, lineageBase, policyHead } = buildSiblingHistoryGraph()
    // Stale/unrelated head on the protected tip side — not descended from lineage via planning path.
    // Use a commit that does not have lineageBase as ancestor... actually policyHead DOES descend from lineageBase.
    // Create an orphan commit that does not descend from lineageBase.
    runGit(root, ['checkout', '--orphan', 'orphan-stale'])
    runGit(root, ['rm', '-rf', '.'])
    const staleHead = seedCommit(root, 'orphan.txt', 'unrelated', 'orphan stale planning head')

    const issueBody = managedIssueBody({
      approved_base: 'main',
      guide_source_sha: `"${policyHead}"`,
      planning_authorization_base_sha: `"${lineageBase}"`,
      last_reviewed_head: `"${staleHead}"`,
    })

    const result = verifyPlanningNoPrDurableProofs({
      cwd: root,
      env: process.env,
      issueBody,
      issueNumber: 92,
      contractReviewedHead: staleHead,
      branchName: 'docs/92-planning',
      verdictBase: 'main',
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toContain(
      'STATE CONFLICT: reviewed_head is not safely descended from planning_authorization_base_sha',
    )
  })

  it('4: missing immutable lineage base with mutable branch present — fail closed as migration', () => {
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
    expect(result.errors.join('\n')).not.toContain(
      'reviewed_head is not safely descended from approved_base',
    )
  })

  it('5: dirty/diverged local protected ref does not alter exact-SHA lineage authority', () => {
    const { root, lineageBase, reviewedHead, policyHead } = buildSiblingHistoryGraph()

    // Make local main ahead of the recorded policy tip, then return to planning.
    runGit(root, ['checkout', 'main'])
    seedCommit(root, 'local-ahead.txt', 'local ahead', 'local main ahead of origin tip')
    const localMain = runGit(root, ['rev-parse', 'HEAD'])
    expect(localMain).not.toBe(policyHead)
    runGit(root, ['checkout', 'docs/92-planning'])
    // Untracked dirt in the planning worktree must not change exact-SHA authority.
    writeFileSync(join(root, 'scratch.txt'), 'uncommitted', 'utf8')

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
    expect(runGit(root, ['rev-parse', 'main'])).not.toBe(policyHead)
  })

  it('6: lineage passes but another required proof fails — still blocked', () => {
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
    expect(result.errors).toContain(
      'STATE CONFLICT: planning_authorization_base_sha must be an exact full commit SHA (immutable lineage base)',
    )
  })
})
