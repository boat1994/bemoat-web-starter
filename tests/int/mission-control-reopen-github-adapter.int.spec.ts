import { describe, expect, it } from 'vitest'

import { createProductionReopenTransport } from '../../scripts/mission-control/adapters/reopen-github.mjs'
import { runReopen } from '../../scripts/mission-control/workflows/reopen.mjs'
import {
  parseMissionControlState,
  renderMissionControlState,
} from '../../scripts/mission-control/domain/task-state.ts'

type GhRunOptions = { allowNotFound?: boolean }
type TestState = Record<string, unknown>

describe('reopen GitHub transport adapter', () => {
  const repo = 'boat1994/bemoat-web-starter'

  it('maps non-zero gh exits and process failures to BLOCKED_EXTERNAL', async () => {
    const nonZero = createProductionReopenTransport({
      runGh: () => {
        throw new Error('gh: exit status 1')
      },
    })
    await expect(nonZero.readComment(repo, '7')).rejects.toThrow(/^BLOCKED_EXTERNAL:/)

    const processFailure = createProductionReopenTransport({
      runGh: () => {
        const error = Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' })
        error.code = 'ENOENT'
        throw error
      },
    })
    await expect(processFailure.readComment(repo, '7')).rejects.toThrow(/^BLOCKED_EXTERNAL:/)
  })

  it('classifies incomplete paginated comments as BLOCKED_EXTERNAL', async () => {
    const transport = createProductionReopenTransport({
      runGh: () => JSON.stringify([{ id: 1 }, []]),
    })
    await expect(transport.readIssueComments(repo, 328)).rejects.toThrow(
      'BLOCKED_EXTERNAL: live Issue comment pagination is incomplete',
    )
  })

  it('preserves allowNotFound as null for a GitHub 404', async () => {
    const calls: Array<{ args: string[]; options?: { allowNotFound?: boolean } }> = []
    const transport = createProductionReopenTransport({
      runGh: (args: string[], options?: GhRunOptions) => {
        calls.push({ args, options })
        return null
      },
    })
    await expect(transport.readOptionalComment(repo, '404')).resolves.toBeNull()
    expect(calls[0]?.options?.allowNotFound).toBe(true)
  })

  it('keeps Founder-login validation at the workflow boundary', async () => {
    const transport = createProductionReopenTransport({
      runGh: () => JSON.stringify({ value: 'not a valid login' }),
    })
    await expect(transport.readFounderLoginsVariable(repo)).resolves.toEqual({
      value: 'not a valid login',
    })
  })

  it('classifies malformed Founder-login data through runReopen without writes', async () => {
    const issueNumber = '328'
    const repo = 'boat1994/bemoat-web-starter'
    const prNumber = '335'
    const oldHead = 'a'.repeat(40)
    const newHead = 'b'.repeat(40)
    const authorizationComment = '9001'
    const calls: string[][] = []
    let writes = 0
    const state: TestState = {
      schema_version: 1,
      state: 'ELIGIBLE_FOR_FOUNDER_REVIEW',
      review_cycle: 1,
      full_review_count: 1,
      approved_base: 'main',
      active_task_issue: `#${issueNumber}`,
      active_pr: `#${prNumber}`,
      current_head: oldHead,
      last_reviewed_head: oldHead,
      latest_result_comment_id: '9002',
      latest_review_verdict_comment_id: '9003',
      open_blockers: [],
      follow_up_issues: [],
      post_budget_reviews: [],
      workflow_mode: 'implementation_pr',
      guide_version: '1.3.0',
      guide_source_ref: 'main',
      guide_source_sha: 'c'.repeat(40),
      next_permitted_action: 'Founder merge review',
      material_change_status: 'none',
      updated_at: '2026-08-12T00:00:00.000Z',
      updated_by: 'Mission Control',
      campaign_issue: null,
      campaign_slice: null,
    }
    const authorization: TestState = {
      schema_version: 1,
      status: 'approved',
      authority: 'Founder',
      author_login: 'boat1994',
      comment_id: authorizationComment,
      immutable_comment_reference: true,
      non_superseded: true,
      superseded_by: null,
      repository: repo,
      task_issue: Number(issueNumber),
      pr: Number(prNumber),
      exact_head: newHead,
      reviewed_head: newHead,
      old_reviewed_head: oldHead,
      base: 'main',
      approved_base: 'main',
      policy_source_sha: 'c'.repeat(40),
      protected_base_sha: 'd'.repeat(40),
      bundle_kind: 'founder-reopen',
      scope: 'correction',
      action: 'reopen',
      review_cycle: 1,
      review_verdict_comment_id: '9003',
      original_result_comment_id: '9002',
      correction_reason: 'bounded test characterization',
      bounded_correction_scope: ['scripts/mission-control/workflows/reopen.mjs'],
      delta_review_requirement: true,
      maximum_correction_deliveries: 1,
      finding_ids: ['MC-R1-001'],
      authorization_id: 'reopen-328-1',
    }
    const comment = {
      id: authorizationComment,
      user: { login: 'boat1994' },
      author_association: 'OWNER',
      body: JSON.stringify(authorization),
    }
    const transport = createProductionReopenTransport({
      runGh: (args: string[]) => {
        calls.push(args)
        const command = args.slice(0, 3).join(' ')
        if (command === 'issue view 328') {
          return JSON.stringify({
            number: Number(issueNumber),
            state: 'OPEN',
            body: `Task body\n${renderMissionControlState(state)}\n`,
          })
        }
        if (command === 'pr view 335') {
          return JSON.stringify({
            number: Number(prNumber),
            state: 'OPEN',
            isDraft: false,
            headRefOid: newHead,
            baseRefName: 'main',
            baseRefOid: 'd'.repeat(40),
            statusCheckRollup: [],
          })
        }
        if (args[0] === 'api' && args[1]?.includes(`/issues/comments/${authorizationComment}`)) {
          return JSON.stringify(comment)
        }
        if (args.some((arg: string) => arg.includes('/issues/328/comments?per_page=100'))) {
          return JSON.stringify([[comment]])
        }
        if (args.some((arg: string) => arg.includes('BEMOAT_FOUNDER_LOGINS'))) {
          return JSON.stringify({ value: 'not valid login!' })
        }
        throw new Error(`unexpected read: ${args.join(' ')}`)
      },
    })
    const deps = {
      readManagedIssue: async () => {
        const issue = await transport.readManagedIssue(Number(issueNumber), repo)
        const parsed = parseMissionControlState(issue.body)
        return { ...issue, managedState: parsed.state }
      },
      readPullRequest: (pr: number, repository: string) => transport.readPullRequest(pr, repository),
      readComment: transport.readComment,
      readIssueComments: transport.readIssueComments,
      readTrustedFounderLogins: async (repository: string) => {
        const variable = await transport.readFounderLoginsVariable(repository)
        const logins = String(variable.value ?? '').split(',').map((login) => login.trim()).filter(Boolean)
        if (logins.length === 0 || logins.some((login) => !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(login))) {
          throw new Error('STATE_CONFLICT: repository Actions variable BEMOAT_FOUNDER_LOGINS is invalid')
        }
        return logins
      },
      writeIssueBody: async () => {
        writes += 1
        throw new Error('unexpected write')
      },
    }

    await expect(runReopen({
      options: {
        issueNumber,
        repo,
        expectedPr: prNumber,
        expectedBase: 'main',
        expectedState: 'ELIGIBLE_FOR_FOUNDER_REVIEW',
        expectedOldHead: oldHead,
        expectedNewHead: newHead,
        expectedReviewCycle: '1',
        expectedFullReviewCount: '1',
        authorizationComment,
      },
      deps,
    })).rejects.toThrow('STATE_CONFLICT: repository Actions variable BEMOAT_FOUNDER_LOGINS is invalid')
    expect(writes).toBe(0)
    expect(calls.some((args) => args[0] === 'issue' && args[1] === 'edit')).toBe(false)
  })
})
