import { describe, expect, it } from 'vitest'

import {
  reconstructReviewEligibilityState,
} from '../../scripts/mission-control/domain/review-eligibility-recovery.mjs'
import { runRecoverReviewEligibility } from '../../scripts/mission-control/workflows/recover-review-eligibility.mjs'

const repository = 'boat1994/bemoat-web-starter'
const issueNumber = 380
const prNumber = 390
const base = 'main'
const branch = 'fix/380-mission-control-stabilization'
const protectedMainSha = '6c056f1e51e68f59d0afb7c42e3d311a0454b581'
const recordedPrBaseSha = '114ec8dbe8aecc65276a2426e655ee544d72aad3'
const head = 'ba0c4e7b9915acc202b981fa08a3b7590b7b53ac'
const resultHead = '7f99bf4667cf678137b57174d92ab248393b76e7'
const policySha = '56443e2b8e07b8d8325d6b5fdef7b49f305b1e1f'

function resultComment(overrides: Record<string, unknown> = {}) {
  return {
    id: '5366535740',
    body: `## RESULT\n\nTask / Issue: #${issueNumber}\nPR: https://github.com/${repository}/pull/${prNumber}\nBase: ${base}\nHead: ${resultHead}\nCompleted: structural inventory synchronization only.`,
    user: { login: 'boat1994' },
    issue_url: `https://api.github.com/repos/${repository}/issues/${issueNumber}`,
    created_at: '2026-08-21T07:21:32Z',
    updated_at: '2026-08-21T07:21:32Z',
    ...overrides,
  }
}

function input(overrides: Record<string, unknown> = {}) {
  const result = resultComment()
  return {
    repository,
    issueNumber,
    expectedPr: prNumber,
    expectedBase: base,
    expectedBaseSha: recordedPrBaseSha,
    expectedHead: head,
    expectedBranch: branch,
    issueBody: 'Issue prose without a managed state block.\n',
    comments: [result],
    resultComment: result,
    pullRequest: {
      number: prNumber,
      state: 'OPEN',
      isDraft: false,
      baseRefName: base,
      baseRefOid: recordedPrBaseSha,
      headRefName: branch,
      headRefOid: head,
    },
    policy: {
      ref: base,
      commitSha: protectedMainSha,
      sha: policySha,
      guideVersion: '1.3.0',
    },
    ci: {
      ci: { conclusion: 'success', head_sha: head },
      'starter-ci': { conclusion: 'success', head_sha: head },
    },
    mechanicalCorrection: {
      fromHead: resultHead,
      toHead: head,
      files: [{ filename: 'tests/int/structural-protection.int.spec.ts', status: 'modified', additions: 1, deletions: 1, patch: '-    expect(scriptInventory(root)).toBe(263)\n+    expect(scriptInventory(root)).toBe(264)' }],
    },
    ...overrides,
  }
}

describe('review-eligibility missing-state recovery', () => {
  function workflowHarness(overrides: Record<string, unknown> = {}) {
    const fixture = input(overrides)
    let body = String(fixture.issueBody)
    let writes = 0
    const deps = {
      readManagedIssue: async () => ({ number: issueNumber, state: 'OPEN', body }),
      readPullRequest: async () => fixture.pullRequest,
      readIssueComments: async () => fixture.comments,
      readProtectedPolicy: async (_repo: string, _expectedBase: string) => fixture.policy,
      readExactHeadChecks: async () => fixture.ci,
      readCommitDelta: async () => fixture.mechanicalCorrection,
      writeIssueBody: async ({ expectedBody, nextBody }: { expectedBody: string; nextBody: string }) => {
        writes += 1
        if (body !== expectedBody) throw new Error('stale Issue body')
        body = nextBody
      },
    }
    return { deps, get body() { return body }, get writes() { return writes } }
  }

  it('derives AWAITING_REVIEW_1 without replaying a verdict or incrementing counters', () => {
    const state = reconstructReviewEligibilityState(input())

    expect(state).toMatchObject({
      state: 'AWAITING_REVIEW_1',
      review_cycle: 0,
      full_review_count: 0,
      active_task_issue: '#380',
      active_pr: '#390',
      current_head: head,
      last_reviewed_head: null,
      latest_review_verdict_comment_id: null,
      open_blockers: [],
      next_permitted_action: expect.stringContaining('bemoat:mission-control:review'),
      recovery_base_binding: {
        recorded_pr_base_sha: recordedPrBaseSha,
        protected_main_sha: protectedMainSha,
      },
    })
  })

  it('fails closed for an existing, malformed, or ambiguous state projection', () => {
    expect(() => reconstructReviewEligibilityState(input({ issueBody: '<!-- bemoat-mission-control-state:start -->' }))).toThrow(/STATE_CONFLICT/)
    expect(() => reconstructReviewEligibilityState(input({ issueBody: '<!-- bemoat-mission-control-state:start -->\n<!-- bemoat-mission-control-state:end -->' }))).toThrow(/STATE_CONFLICT/)
    expect(() => reconstructReviewEligibilityState(input({ issueBody: '<!-- bemoat-mission-control-state:start -->\n```yaml\nschema_version: 1\nstate: AWAITING_REVIEW_1\n```\n<!-- bemoat-mission-control-state:end -->' }))).toThrow(/STATE_CONFLICT/)
    expect(() => reconstructReviewEligibilityState(input({ comments: [resultComment(), resultComment({ id: '5366535741' })] }))).toThrow(/EVIDENCE_CONFLICT/)
  })

  it('fails closed for conflicting PR/base/head/policy/CI evidence', () => {
    expect(() => reconstructReviewEligibilityState(input({ pullRequest: { ...input().pullRequest, headRefOid: '1'.repeat(40) } }))).toThrow(/HEAD_DRIFT/)
    expect(() => reconstructReviewEligibilityState(input({ pullRequest: { ...input().pullRequest, baseRefOid: protectedMainSha } }))).toThrow(/HEAD_DRIFT/)
    expect(() => reconstructReviewEligibilityState(input({ ci: { ci: { conclusion: 'failure', head_sha: head }, 'starter-ci': { conclusion: 'success', head_sha: head } } }))).toThrow(/BLOCKED_EXTERNAL/)
    expect(() => reconstructReviewEligibilityState(input({ comments: [resultComment(), { id: '5366535742', body: `## REVIEW_VERDICT\nTask / Issue: #${issueNumber}\nPR: #${prNumber}\nHead: ${head}`, user: { login: 'boat1994' }, created_at: '2026-08-21T07:22:00Z', updated_at: '2026-08-21T07:22:00Z' }] }))).toThrow(/STATE_CONFLICT/)
  })

  it('fails closed for edited, wrong, superseded, or missing RESULT evidence', () => {
    expect(() => reconstructReviewEligibilityState(input({ resultComment: resultComment({ updated_at: '2026-08-21T07:23:00Z' }) }))).toThrow(/EVIDENCE_CONFLICT/)
    expect(() => reconstructReviewEligibilityState(input({ resultComment: resultComment({ body: '## RESULT\nTask / Issue: #381' }) }))).toThrow(/EVIDENCE_CONFLICT/)
    expect(() => reconstructReviewEligibilityState(input({ comments: [resultComment(), { id: '5366535743', body: JSON.stringify({ supersedes_comment_id: '5366535740' }), user: { login: 'boat1994' }, created_at: '2026-08-21T07:24:00Z', updated_at: '2026-08-21T07:24:00Z' }] }))).toThrow(/AUTHORITY_CONFLICT/)
    expect(() => reconstructReviewEligibilityState(input({ resultComment: undefined, comments: [] }))).toThrow(/EVIDENCE_CONFLICT/)
  })

  it('writes one CAS-protected state block, reads it back, and identical retry is safe', async () => {
    const harness = workflowHarness()
    const options = { ...input(), resultComment: '5366535740' }
    const first = await runRecoverReviewEligibility({ options, deps: harness.deps })
    expect(first.classification).toBe('SUCCESS')
    expect(harness.writes).toBe(1)
    expect(first.nextAction.command).toBe('bemoat:mission-control:review')

    const retry = await runRecoverReviewEligibility({ options, deps: harness.deps })
    expect(retry.classification).toBe('NO_OP_IDENTICAL_RETRY')
    expect(harness.writes).toBe(1)
  })
})
