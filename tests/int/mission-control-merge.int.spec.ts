import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

/* eslint-disable @typescript-eslint/no-explicit-any -- deterministic .mjs transport boundary */
import { getDefaultRepo } from '../../scripts/agent-issue/local-git-evidence.mjs'
import { parsePrReference } from '../../scripts/agent-issue/issue-references.mjs'

const reviewedHead = '527a48cb83364a7fbde0fad5f88f5c9d1244d0ab'
const mergeCommit = '8df91686d715a0ddf0ddf258bf9fa5b060a4af29'
const reviewCommentId = '6000000002'
const policySourceSha = '1111111111111111111111111111111111111111'
const protectedBaseSha = '2222222222222222222222222222222222222222'

async function execute(input: any) {
  const mergeTransport = await import('../../scripts/mission-control-merge.mjs')
  return mergeTransport.runFounderAuthorizedMerge(input)
}

async function normalizeCommitPages(pages: any) {
  const mergeTransport = await import('../../scripts/mission-control-merge.mjs')
  return mergeTransport.normalizePaginatedCommitMessages(pages)
}

function successfulChecks() {
  return [
    { name: 'ci', conclusion: 'SUCCESS', status: 'COMPLETED' },
    { name: 'starter-ci', conclusion: 'SUCCESS', status: 'COMPLETED' },
  ]
}

function managedState(overrides: Record<string, unknown> = {}) {
  return {
    state: 'ELIGIBLE_FOR_FOUNDER_REVIEW',
    review_cycle: 2,
    full_review_count: 1,
    active_task_issue: '#222',
    active_pr: '#223',
    current_head: reviewedHead,
    last_reviewed_head: reviewedHead,
    approved_base: 'main',
    guide_source_sha: policySourceSha,
    guide_version: '1.3.0',
    latest_review_verdict_comment_id: reviewCommentId,
    campaign_issue: '#215',
    campaign_slice: 3,
    ...overrides,
  }
}

function authorization(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const record: Record<string, unknown> = {
    schema_version: 1,
    status: 'approved',
    authority: 'Founder',
    author_login: 'boat1994',
    immutable_comment_reference: true,
    comment_sha256: 'a'.repeat(64),
    non_superseded: true,
    superseded_by: null,
    repository: 'boat1994/bemoat-web-starter',
    bundle_kind: 'merge-completion',
    scope: 'merge',
    task_issue: 222,
    pr: 223,
    exact_head: reviewedHead,
    reviewed_head: reviewedHead,
    base: 'main',
    policy_source_sha: policySourceSha,
    protected_base_sha: protectedBaseSha,
    policy_version: '1.3.0',
    review_verdict_comment_id: reviewCommentId,
    review_verdict: 'ELIGIBLE FOR FOUNDER REVIEW',
    action: 'merge',
    comment_id: '6000000001',
    campaign_issue: 215,
    campaign_slice: 3,
    ...overrides,
  }
  if (record.projection_kind === 'blocker-resolution' && !Object.hasOwn(overrides, 'campaign_slice')) {
    delete record.campaign_slice
  }
  return record
}

function createHarness(options: Record<string, any> = {}) {
  const taskIssue = options.taskIssue ?? 222
  const prNumber = options.prNumber ?? 223
  const taskReviewedHead = options.reviewedHead ?? reviewedHead
  const taskMergeCommit = options.mergeCommit ?? mergeCommit
  const taskBase = options.base ?? 'main'
  const taskProtectedBaseSha = options.protectedBaseSha ?? protectedBaseSha
  const issues = new Map<number, any>([
    [taskIssue, {
      number: taskIssue,
      state: options.issueState ?? 'OPEN',
      stateReason: options.issueState === 'CLOSED' ? 'COMPLETED' : null,
      managedState: managedState({
        active_task_issue: `#${taskIssue}`,
        active_pr: `#${prNumber}`,
        current_head: taskReviewedHead,
        last_reviewed_head: taskReviewedHead,
        approved_base: taskBase,
        ...options.managedState,
      }),
    }],
    [219, {
      number: 219,
      state: 'OPEN',
      stateReason: null,
      managedState: {
        state: 'BLOCKED_EXTERNAL',
        active_task_issue: '#219',
        active_pr: null,
        current_head: null,
        last_reviewed_head: null,
        delegated_task_issue: '#222',
      },
    }],
  ])
  const pull = {
    number: prNumber,
    state: options.prState ?? 'OPEN',
    isDraft: options.isDraft ?? true,
    mergeable: 'MERGEABLE',
    headRefOid: taskReviewedHead,
    baseRefName: taskBase,
    baseRefOid: taskProtectedBaseSha,
    statusCheckRollup: successfulChecks(),
    mergeCommit: options.prState === 'MERGED' ? { oid: taskMergeCommit } : null,
    ...options.pull,
  }
  const operations: string[] = []
  const reconcileOutcomes = [...(options.reconcileOutcomes ?? ['DONE', 'NO_OP'])]
  let closeFailures = options.closeFailures ?? 0
  let projectionFailures = options.projectionFailures ?? 0
  let campaignProjectionFailures = options.campaignProjectionFailures ?? 0
  let campaignBlockerProjectionFailures = options.campaignBlockerProjectionFailures ?? 0

  const deps = {
    readManagedIssue: async (issueNumber: number) => structuredClone(issues.get(issueNumber)),
    readPullRequest: async () => structuredClone(pull),
    readFounderAuthorization: async (_repo: string, issueNumber: number) => {
      operations.push(`authorization:${issueNumber}`)
      return authorization({
        task_issue: taskIssue,
        pr: prNumber,
        exact_head: taskReviewedHead,
        reviewed_head: taskReviewedHead,
        base: taskBase,
        protected_base_sha: taskProtectedBaseSha,
        ...options.authorization,
      })
    },
    readReviewVerdict: async (_repo: string, _issueNumber: number, commentId: string) => {
      operations.push(`review-verdict:${commentId}`)
      return {
        comment_id: commentId,
        verdict: options.reviewVerdict ?? 'ELIGIBLE FOR FOUNDER REVIEW',
        reviewed_head: options.reviewedVerdictHead ?? taskReviewedHead,
        pr: prNumber,
        base: taskBase,
        non_superseded: options.reviewVerdictSuperseded !== true,
      }
    },
    readTrustedFounderLogins: async () => options.trustedFounderLogins ?? ['boat1994'],
    markReadyForReview: async () => {
      operations.push('mark-ready')
      pull.isDraft = false
    },
    mergePullRequest: async ({ expectedHead }: { expectedHead: string }) => {
      operations.push(`merge:${expectedHead}`)
      pull.state = 'MERGED'
      pull.mergeCommit = { oid: taskMergeCommit }
      return { mergeCommit: { oid: taskMergeCommit } }
    },
    verifyCommitOnProtectedBase: async ({ commit, base }: { commit: string, base: string }) => {
      operations.push(`verify-base:${commit}:${base}`)
      return true
    },
    postFinalResult: async ({ issueNumber, mergeCommit: completedMergeCommit, commentId }: { issueNumber: number, mergeCommit: string, commentId?: string }) => {
      const resultCommentId = commentId ?? '6000000003'
      operations.push(`result:${resultCommentId}`)
      issues.get(issueNumber).managedState.latest_result_comment_id = resultCommentId
      issues.get(issueNumber).managedState.merged_commit_sha = completedMergeCommit
      return { id: resultCommentId }
    },
    closeIssueCompleted: async (issueNumber: number) => {
      operations.push(`close:${issueNumber}`)
      if (closeFailures > 0) {
        closeFailures -= 1
        throw new Error('simulated Issue closure failure')
      }
      const issue = issues.get(issueNumber)
      issue.state = 'CLOSED'
      issue.stateReason = 'COMPLETED'
    },
    writeTaskDone: async ({ issueNumber }: { issueNumber: number }) => {
      operations.push(`task-done:${issueNumber}`)
      if (projectionFailures > 0) {
        projectionFailures -= 1
        throw new Error('simulated Task DONE CAS/lease failure')
      }
      issues.get(issueNumber).managedState.state = 'DONE'
      return { state: 'DONE' }
    },
    projectCampaignSliceDone: async ({ campaignIssue, campaignSlice }: { campaignIssue: number, campaignSlice: number }) => {
      operations.push(`campaign-done:${campaignIssue}:${campaignSlice}`)
      if (campaignProjectionFailures > 0) {
        campaignProjectionFailures -= 1
        throw new Error('simulated campaign slice projection failure')
      }
      return { status: 'DONE', campaignIssue, campaignSlice }
    },
    projectCampaignBlockerResolved: async ({ campaignIssue, campaignBlockerId }: { campaignIssue: number, campaignBlockerId: string }) => {
      operations.push(`campaign-blocker-resolved:${campaignIssue}:${campaignBlockerId}`)
      if (campaignBlockerProjectionFailures > 0) {
        campaignBlockerProjectionFailures -= 1
        throw new Error('simulated campaign blocker projection failure')
      }
      return { status: 'RESOLVED', campaignIssue, campaignBlockerId }
    },
    selectNextCampaignAction: async () => {
      operations.push('select-next')
      return { action: 'Resolve the next campaign blocker', started: options.nextStarted === true }
    },
    reconcile: async (issueNumber: number) => {
      operations.push(`reconcile:${issueNumber}`)
      const outcome = reconcileOutcomes.shift() ?? 'NO_OP'
      if (outcome === 'DONE') issues.get(issueNumber).managedState.state = 'DONE'
      return { finalOutcome: outcome, state: issues.get(issueNumber).managedState }
    },
  }

  return { deps, issues, pull, operations }
}

describe('Founder-authorized Mission Control merge transport', () => {
  it('rejects a delivery bundle at the merge boundary before mutation', async () => {
    const harness = createHarness()
    const mergeTransport = await import('../../scripts/mission-control-merge.mjs')

    await expect(execute({
      issueNumber: 222,
      repo: 'boat1994/bemoat-web-starter',
      authorizationCommentId: '6000000001',
      executionBundle: {
        kind: 'delivery',
        authority_scope: 'delivery',
        terminal_outcome: 'implementation delivered',
        steps: mergeTransport.SAFE_EXECUTION_BUNDLES.delivery,
      },
      deps: harness.deps,
    })).rejects.toThrow(/merge-completion|merge authority/i)

    expect(harness.operations).not.toContain('mark-ready')
    expect(harness.operations.some((entry) => entry.startsWith('merge:'))).toBe(false)
  })

  it('executes the complete merge bundle in order without reconciliation or starting the next task', async () => {
    const harness = createHarness()

    const result = await execute({
      issueNumber: 222,
      repo: 'boat1994/bemoat-web-starter',
      authorizationCommentId: '6000000001',
      deps: harness.deps,
    })

    expect(result).toMatchObject({ outcome: 'DONE', mergeCommit, issueNumber: 222, prNumber: 223 })
    expect(harness.operations).toEqual([
      'authorization:222',
      `review-verdict:${reviewCommentId}`,
      'mark-ready',
      `review-verdict:${reviewCommentId}`,
      `merge:${reviewedHead}`,
      `verify-base:${mergeCommit}:main`,
      'result:6000000003',
      'close:222',
      'task-done:222',
      'campaign-done:215:3',
      'select-next',
    ])
    expect(harness.issues.get(222)).toMatchObject({ state: 'CLOSED', stateReason: 'COMPLETED', managedState: { state: 'DONE' } })
    expect(harness.operations).not.toContain('reconcile:222')
  })

  it('executes the exact #254 blocker-resolution shape without projecting any slice status', async () => {
    const harness = createHarness({
      taskIssue: 254,
      prNumber: 258,
      managedState: { campaign_issue: '#215', campaign_slice: null },
      authorization: {
        projection_kind: 'blocker-resolution',
        campaign_issue: 215,
        campaign_blocker_id: 'issue-254-planning-correction-1',
      },
    })

    const result = await execute({
      issueNumber: 254,
      repo: 'boat1994/bemoat-web-starter',
      authorizationCommentId: '6000000001',
      deps: harness.deps,
    })

    expect(result).toMatchObject({ outcome: 'DONE', issueNumber: 254, prNumber: 258 })
    expect(harness.operations).toEqual([
      'authorization:254',
      `review-verdict:${reviewCommentId}`,
      'mark-ready',
      `review-verdict:${reviewCommentId}`,
      `merge:${reviewedHead}`,
      `verify-base:${mergeCommit}:main`,
      'result:6000000003',
      'close:254',
      'task-done:254',
      'campaign-blocker-resolved:215:issue-254-planning-correction-1',
      'select-next',
    ])
    expect(harness.operations).not.toContain('campaign-done:215:5')
  })

  it.each([
    ['missing projection kind', { campaign_issue: 215, campaign_blocker_id: 'issue-254-planning-correction-1' }],
    ['missing campaign binding', { projection_kind: 'blocker-resolution', campaign_issue: undefined, campaign_blocker_id: 'issue-254-planning-correction-1' }],
    ['wrong campaign binding', { projection_kind: 'blocker-resolution', campaign_issue: 216, campaign_blocker_id: 'issue-254-planning-correction-1' }],
    ['missing blocker binding', { projection_kind: 'blocker-resolution', campaign_issue: 215, campaign_blocker_id: undefined }],
  ])('fails closed before mutation for blocker-resolution %s', async (_label, authorizationOverrides) => {
    const harness = createHarness({
      taskIssue: 254,
      prNumber: 258,
      managedState: { campaign_issue: '#215', campaign_slice: null },
      authorization: authorizationOverrides,
    })

    await expect(execute({
      issueNumber: 254,
      repo: 'boat1994/bemoat-web-starter',
      authorizationCommentId: '6000000001',
      deps: harness.deps,
    })).rejects.toThrow(/STATE_CONFLICT.*(projection kind|campaign|blocker)/i)

    expect(harness.operations).not.toContain('mark-ready')
    expect(harness.operations.some((entry) => entry.startsWith('merge:'))).toBe(false)
    expect(harness.operations).not.toContain('close:254')
  })

  it('fails closed when blocker-resolution supplies a campaign_slice', async () => {
    const harness = createHarness({
      taskIssue: 254,
      prNumber: 258,
      managedState: { campaign_issue: '#215', campaign_slice: null },
      authorization: {
        projection_kind: 'blocker-resolution',
        campaign_issue: 215,
        campaign_blocker_id: 'issue-254-planning-correction-1',
        campaign_slice: 5,
      },
    })

    await expect(execute({
      issueNumber: 254,
      repo: 'boat1994/bemoat-web-starter',
      authorizationCommentId: '6000000001',
      deps: harness.deps,
    })).rejects.toThrow(/STATE_CONFLICT.*campaign_slice/i)

    expect(harness.operations).not.toContain('mark-ready')
    expect(harness.operations.some((entry) => entry.startsWith('merge:'))).toBe(false)
  })

  it('retries blocker resolution after a partial terminal bundle without merging twice', async () => {
    const harness = createHarness({
      taskIssue: 254,
      prNumber: 258,
      managedState: { campaign_issue: '#215', campaign_slice: null },
      authorization: {
        projection_kind: 'blocker-resolution',
        campaign_issue: 215,
        campaign_blocker_id: 'issue-254-planning-correction-1',
      },
      campaignBlockerProjectionFailures: 1,
      reconcileOutcomes: ['DONE'],
    })
    const input = {
      issueNumber: 254,
      repo: 'boat1994/bemoat-web-starter',
      authorizationCommentId: '6000000001',
      deps: harness.deps,
    }

    await expect(execute(input)).rejects.toThrow('simulated campaign blocker projection failure')
    await expect(execute(input)).resolves.toMatchObject({ outcome: 'NO_OP', issueNumber: 254, prNumber: 258 })

    expect(harness.operations.filter((entry) => entry.startsWith('merge:'))).toHaveLength(1)
    expect(harness.operations.filter((entry) => entry === 'close:254')).toHaveLength(1)
    expect(harness.operations.filter((entry) => entry === 'campaign-blocker-resolved:215:issue-254-planning-correction-1')).toHaveLength(2)
    expect(harness.operations.filter((entry) => entry === 'select-next')).toHaveLength(1)
  })

  it('fails closed when merge completion would start the selected next campaign action', async () => {
    const harness = createHarness({ nextStarted: true })

    await expect(execute({
      issueNumber: 222,
      repo: 'boat1994/bemoat-web-starter',
      authorizationCommentId: '6000000001',
      deps: harness.deps,
    })).rejects.toThrow(/STATE_CONFLICT.*next campaign action/)

    expect(harness.operations).toContain('select-next')
    expect(harness.operations).toContain('reconcile:222')
  })

  it.each([
    ['Founder authority', { authorization: { authority: 'Reviewer' } }, 'AUTHORIZATION_VALIDATION_FAILURE'],
    ['Founder identity', { authorization: { author_login: 'attacker' } }, 'AUTHORIZATION_VALIDATION_FAILURE'],
    ['superseded authority', { authorization: { non_superseded: false } }, 'AUTHORIZATION_VALIDATION_FAILURE'],
    ['reviewed head', { authorization: { reviewed_head: 'a'.repeat(40) } }, 'AUTHORIZATION_VALIDATION_FAILURE'],
    ['current PR head', { pull: { headRefOid: 'b'.repeat(40) } }, 'STATE_CONFLICT'],
    ['protected base', { pull: { baseRefName: 'dev' } }, 'STATE_CONFLICT'],
    ['failed exact-head CI', { pull: { statusCheckRollup: [{ name: 'ci', conclusion: 'FAILURE', status: 'COMPLETED' }] } }, 'STATE_CONFLICT'],
    ['stale exact-head CI', {
      pull: {
        statusCheckRollup: {
          contexts: [
            { name: 'ci', conclusion: 'SUCCESS', description: `passed for ${'a'.repeat(40)}` },
            { name: 'starter-ci', conclusion: 'SUCCESS', description: `passed for ${'a'.repeat(40)}` },
          ],
        },
      },
    }, 'STATE_CONFLICT'],
    ['changed verdict', { reviewVerdict: 'CORRECTION REQUIRED' }, 'STATE_CONFLICT'],
    ['mergeability drift', { pull: { mergeable: 'CONFLICTING' } }, 'STATE_CONFLICT'],
  ])('fails closed before merge when %s differs', async (_label, options, expectedClassification) => {
    const harness = createHarness(options)

    await expect(execute({
      issueNumber: 222,
      repo: 'boat1994/bemoat-web-starter',
      authorizationCommentId: '6000000001',
      deps: harness.deps,
    })).rejects.toThrow(new RegExp(expectedClassification))

    expect(harness.operations).not.toContain(expect.stringMatching(/^merge:/))
    expect(harness.operations).not.toContain('close:222')
  })

  it('rejects an automatic closing reference found on a later paginated commit page', async () => {
    const commits = await normalizeCommitPages([
      [{ commit: { message: 'First page subject\n\nNo closing reference.' } }],
      [{ commit: { message: 'Second page subject\n\nFixes #222' } }],
    ])
    const harness = createHarness({ pull: { commits } })

    await expect(execute({
      issueNumber: 222,
      repo: 'boat1994/bemoat-web-starter',
      authorizationCommentId: '6000000001',
      deps: harness.deps,
    })).rejects.toThrow(/STATE_CONFLICT.*closing reference/)

    expect(harness.operations).toEqual(['authorization:222', `review-verdict:${reviewCommentId}`])
  })

  it('rejects automatic closing references before marking ready or merging', async () => {
    const harness = createHarness({
      pull: {
        body: 'Closes #222',
        closingIssuesReferences: [{ number: 222, repository: { nameWithOwner: 'boat1994/bemoat-web-starter' } }],
      },
    })

    await expect(execute({
      issueNumber: 222,
      repo: 'boat1994/bemoat-web-starter',
      authorizationCommentId: '6000000001',
      deps: harness.deps,
    })).rejects.toThrow(/STATE_CONFLICT.*closing reference/)

    expect(harness.operations).toEqual(['authorization:222', `review-verdict:${reviewCommentId}`])
  })

  it.each([
    ['PR title', { title: 'Fixes #222: terminal transport' }],
    ['commit headline', { commits: [{ messageHeadline: 'Closes #222', messageBody: '' }] }],
    ['commit body', { commits: [{ messageHeadline: 'terminal transport', messageBody: 'Resolves boat1994/bemoat-web-starter#222' }] }],
  ])('rejects an automatic closing reference in the %s', async (_source, pull) => {
    const harness = createHarness({ pull })

    await expect(execute({
      issueNumber: 222,
      repo: 'boat1994/bemoat-web-starter',
      authorizationCommentId: '6000000001',
      deps: harness.deps,
    })).rejects.toThrow(/STATE_CONFLICT.*closing reference/)

    expect(harness.operations).toEqual(['authorization:222', `review-verdict:${reviewCommentId}`])
  })

  it('accepts an organization-owned child repository with repository-configured Founder identity', async () => {
    const harness = createHarness({
      authorization: { author_login: 'founder-login', repository: 'example-org/child-project' },
      trustedFounderLogins: ['founder-login'],
      pull: { statusCheckRollup: [{ name: 'ci', conclusion: 'SUCCESS', status: 'COMPLETED' }] },
    })

    await expect(execute({
      issueNumber: 222,
      repo: 'example-org/child-project',
      authorizationCommentId: '6000000001',
      deps: harness.deps,
    })).resolves.toMatchObject({ outcome: 'DONE' })
  })

  it('rejects a comment author absent from repository-owned Founder identity configuration', async () => {
    const harness = createHarness({ trustedFounderLogins: ['different-founder'] })

    await expect(execute({
      issueNumber: 222,
      repo: 'boat1994/bemoat-web-starter',
      authorizationCommentId: '6000000001',
      deps: harness.deps,
    })).rejects.toThrow(/AUTHORIZATION_VALIDATION_FAILURE.*Founder identity/)

    expect(harness.operations).toEqual(['authorization:222'])
  })

  it('requires starter strict CI only in the starter repository', async () => {
    const harness = createHarness({
      authorization: { repository: 'boat1994/bogus-jewelry' },
      pull: { statusCheckRollup: [{ name: 'ci', conclusion: 'SUCCESS', status: 'COMPLETED' }] },
    })

    await expect(execute({
      issueNumber: 222,
      repo: 'boat1994/bogus-jewelry',
      authorizationCommentId: '6000000001',
      deps: harness.deps,
    })).resolves.toMatchObject({ outcome: 'DONE' })
  })

  it('uses the explicit target repository for reconciliation evidence instead of the checkout remote', () => {
    expect(getDefaultRepo(
      process.cwd(),
      { GH_REPO: 'boat1994/bogus-jewelry' } as unknown as NodeJS.ProcessEnv,
    )).toBe('boat1994/bogus-jewelry')
  })

  it('recovers after merge succeeds but the first Issue closure attempt fails without merging twice', async () => {
    const harness = createHarness({ closeFailures: 1, reconcileOutcomes: ['NO_OP'] })
    const input = {
      issueNumber: 222,
      repo: 'boat1994/bemoat-web-starter',
      authorizationCommentId: '6000000001',
      deps: harness.deps,
    }

    await expect(execute(input)).rejects.toThrow('simulated Issue closure failure')
    await expect(execute(input)).resolves.toMatchObject({ outcome: 'DONE' })

    expect(harness.operations.filter((entry) => entry.startsWith('merge:'))).toHaveLength(1)
    expect(harness.operations.filter((entry) => entry === 'close:222')).toHaveLength(2)
    expect(harness.operations.filter((entry) => entry === 'reconcile:222')).toHaveLength(1)
  })

  it('recovers after Issue closure succeeds but DONE projection fails without closing twice', async () => {
    const harness = createHarness({ projectionFailures: 1, reconcileOutcomes: ['DONE'] })
    const input = {
      issueNumber: 222,
      repo: 'boat1994/bemoat-web-starter',
      authorizationCommentId: '6000000001',
      deps: harness.deps,
    }

    await expect(execute(input)).rejects.toThrow('simulated Task DONE CAS/lease failure')
    await expect(execute(input)).resolves.toMatchObject({ outcome: 'NO_OP' })

    expect(harness.operations.filter((entry) => entry === 'close:222')).toHaveLength(1)
    expect(harness.operations.filter((entry) => entry.startsWith('merge:'))).toHaveLength(1)
    expect(harness.operations.filter((entry) => entry === 'reconcile:222')).toHaveLength(1)
  })

  it('resumes campaign projection and next-action selection after a partial terminal bundle', async () => {
    const harness = createHarness({ campaignProjectionFailures: 1 })
    const input = {
      issueNumber: 222,
      repo: 'boat1994/bemoat-web-starter',
      authorizationCommentId: '6000000001',
      deps: harness.deps,
    }

    await expect(execute(input)).rejects.toThrow('simulated campaign slice projection failure')
    await expect(execute(input)).resolves.toMatchObject({ outcome: 'NO_OP' })

    expect(harness.operations.filter((entry) => entry.startsWith('merge:'))).toHaveLength(1)
    expect(harness.operations.filter((entry) => entry === 'campaign-done:215:3')).toHaveLength(2)
    expect(harness.operations.filter((entry) => entry === 'select-next')).toHaveLength(1)
  })

  it('fails closed instead of returning NO_OP when terminal RESULT evidence is missing', async () => {
    const harness = createHarness({
      issueState: 'CLOSED',
      prState: 'MERGED',
      isDraft: false,
      managedState: { state: 'DONE', merged_commit_sha: mergeCommit },
    })

    await expect(execute({
      issueNumber: 222,
      repo: 'boat1994/bemoat-web-starter',
      authorizationCommentId: '6000000001',
      deps: harness.deps,
    })).rejects.toThrow(/STATE_CONFLICT.*RESULT/i)

    expect(harness.operations).not.toContain('campaign-done:215:3')
    expect(harness.operations).not.toContain('select-next')
  })

  it('returns NO_OP for an already-closed Issue in DONE state without lifecycle mutation', async () => {
    const harness = createHarness({
      issueState: 'CLOSED',
      prState: 'MERGED',
      isDraft: false,
      managedState: { state: 'DONE', merged_commit_sha: mergeCommit, latest_result_comment_id: '6000000003' },
      reconcileOutcomes: ['NO_OP'],
    })

    await expect(execute({
      issueNumber: 222,
      repo: 'boat1994/bemoat-web-starter',
      authorizationCommentId: '6000000001',
      deps: harness.deps,
    })).resolves.toMatchObject({ outcome: 'NO_OP', mergeCommit })

    expect(harness.operations).not.toContain('close:222')
    expect(harness.operations.some((entry) => entry.startsWith('merge:'))).toBe(false)
    expect(harness.operations.filter((entry) => entry === 'reconcile:222')).toHaveLength(0)
  })

  it('completes only the directly managed child task and leaves delegated parent #219 unchanged', async () => {
    const harness = createHarness()
    const parentBefore = structuredClone(harness.issues.get(219))

    await execute({
      issueNumber: 222,
      repo: 'boat1994/bemoat-web-starter',
      authorizationCommentId: '6000000001',
      deps: harness.deps,
    })

    expect(harness.issues.get(219)).toEqual(parentBefore)
    expect(harness.issues.get(219)).toMatchObject({
      state: 'OPEN',
      managedState: { active_pr: null, state: 'BLOCKED_EXTERNAL' },
    })
    expect(harness.operations).not.toContain('authorization:219')
    expect(harness.operations).not.toContain('close:219')
    expect(harness.operations).not.toContain('reconcile:219')

    await expect(execute({
      issueNumber: 219,
      repo: 'boat1994/bemoat-web-starter',
      authorizationCommentId: '6000000001',
      deps: harness.deps,
    })).rejects.toThrow(/STATE_CONFLICT.*no active PR terminal ownership/)
    expect(harness.issues.get(219)).toEqual(parentBefore)
  })

  describe('Issue #227 canonical active_pr reference parsing', () => {
    it('reproduces Issue #225 YAML-round-tripped active_pr and advances past ownership', async () => {
      const yamlShape = parseYaml("active_pr: '\"#223\"'\nactive_task_issue: '\"#222\"'")
      expect(yamlShape.active_pr).toBe('"#223"')
      expect(parsePrReference(yamlShape.active_pr)).toEqual({ number: '223' })

      const harness = createHarness({
        managedState: {
          active_pr: yamlShape.active_pr,
          active_task_issue: yamlShape.active_task_issue,
        },
      })

      await expect(execute({
        issueNumber: 222,
        repo: 'boat1994/bemoat-web-starter',
        authorizationCommentId: '6000000001',
        deps: harness.deps,
      })).resolves.toMatchObject({ outcome: 'DONE', prNumber: 223 })

      expect(harness.operations.some((entry) => entry.startsWith('merge:'))).toBe(true)
    })

    it.each([
      [226, '226'],
      ['226', '226'],
      ['"226"', '226'],
      ['#226', '226'],
      ['"#226"', '226'],
    ])('accepts canonical PR reference %j as %s', (input, expected) => {
      expect(parsePrReference(input)).toEqual({ number: expected })
    })

    it.each([
      [null],
      [''],
      ['#'],
      ['PR #226 extra 227'],
      ['unrelated text ending in 226'],
      ['https://github.com/boat1994/bemoat-web-starter/issues/226'],
      ['9007199254740992'],
      [-1],
      [0],
      [1.5],
    ])('rejects malformed or unsafe PR reference %j', (input) => {
      expect(parsePrReference(input as never)).toBeNull()
    })

    it('fails closed when live PR does not match the managed active_pr', async () => {
      const harness = createHarness({
        managedState: { active_pr: '"#999"' },
      })

      await expect(execute({
        issueNumber: 222,
        repo: 'boat1994/bemoat-web-starter',
        authorizationCommentId: '6000000001',
        deps: harness.deps,
      })).rejects.toThrow(/STATE_CONFLICT.*live PR does not match the managed task active PR/)

      expect(harness.operations).toEqual([])
    })

    it('reaches the next pre-merge gate after accepting quoted active_pr ownership', async () => {
      const harness = createHarness({
        managedState: {
          active_pr: '"#223"',
          active_task_issue: '"#222"',
          current_head: 'c'.repeat(40),
        },
      })

      await expect(execute({
        issueNumber: 222,
        repo: 'boat1994/bemoat-web-starter',
        authorizationCommentId: '6000000001',
        deps: harness.deps,
      })).rejects.toThrow(/STATE_CONFLICT.*heads must match exactly|Founder authorization reviewed head/)

      expect(harness.operations).toEqual(['authorization:222', `review-verdict:${reviewCommentId}`])
      expect(harness.operations.some((entry) => entry.startsWith('merge:'))).toBe(false)
    })
  })

  it('returns deterministic NO_OP for an exactly completed blocker resolution without re-projecting it', async () => {
    const harness = createHarness({
      taskIssue: 254,
      prNumber: 258,
      issueState: 'CLOSED',
      prState: 'MERGED',
      isDraft: false,
      managedState: {
        state: 'DONE',
        campaign_issue: '#215',
        campaign_slice: null,
        merged_commit_sha: mergeCommit,
        latest_result_comment_id: '6000000003',
        open_blockers: [],
        next_permitted_action: 'none on this task',
        blocker_resolution_postconditions: {
          task: {
            state: 'DONE',
            open_blockers: [],
            next_permitted_action: 'none on this task',
          },
          campaign: {
            lifecycle: 'ACTIVE',
            blocker_ids: [],
            slice_keys: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'],
            slice5_status: 'NOT_STARTED',
            next_action: { slice: 5, started: false },
          },
        },
      },
      authorization: {
        projection_kind: 'blocker-resolution',
        campaign_issue: 215,
        campaign_blocker_id: 'issue-254-planning-correction-1',
      },
    })
    const writes: string[] = []
    harness.deps.projectCampaignBlockerResolved = async () => {
      writes.push('projectCampaignBlockerResolved')
      throw new Error('identical retry must not write the campaign')
    }
    harness.deps.selectNextCampaignAction = async () => {
      writes.push('selectNextCampaignAction')
      throw new Error('identical retry must not re-select or start the next action')
    }

    await expect(execute({
      issueNumber: 254,
      repo: 'boat1994/bemoat-web-starter',
      authorizationCommentId: '6000000001',
      deps: harness.deps,
    })).resolves.toMatchObject({
      outcome: 'NO_OP',
      issueNumber: 254,
      prNumber: 258,
      mergeCommit,
    })

    expect(writes).toEqual([])
    expect(harness.operations).not.toContain('close:254')
    expect(harness.operations).not.toContain('task-done:254')
    expect(harness.operations.some((entry) => entry.startsWith('merge:'))).toBe(false)
  })

  it.each([
    ['partial campaign range', { campaign: { slice_keys: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'] } }],
    ['conflicting blocker state', { campaign: { blocker_ids: ['issue-254-planning-correction-1'] } }],
    ['missing campaign postconditions', { campaign: null }],
    ['reordered campaign range', { campaign: { slice_keys: ['1', '2', '3', '4', '6', '5', '7', '8', '9', '10', '11'] } }],
    ['over-advanced Slice 5', { campaign: { slice5_status: 'IN_PROGRESS' } }],
    ['Task still has an open blocker', { task: { open_blockers: ['issue-254-planning-correction-1'] } }],
    ['Task permits another action', { task: { next_permitted_action: 'start Slice 5' } }],
  ])('fails closed when blocker-resolution completion postconditions are %s', async (_label, overrides: any) => {
    const harness = createHarness({
      taskIssue: 254,
      prNumber: 258,
      issueState: 'CLOSED',
      prState: 'MERGED',
      isDraft: false,
      managedState: {
        state: 'DONE',
        campaign_issue: '#215',
        campaign_slice: null,
        merged_commit_sha: mergeCommit,
        latest_result_comment_id: '6000000003',
        open_blockers: [],
        next_permitted_action: 'none on this task',
        ...(overrides.task ?? {}),
      },
      authorization: {
        projection_kind: 'blocker-resolution',
        campaign_issue: 215,
        campaign_blocker_id: 'issue-254-planning-correction-1',
      },
    })
    harness.deps.projectCampaignBlockerResolved = async () => ({
      status: 'RESOLVED',
      campaignIssue: 215,
      campaignBlockerId: 'issue-254-planning-correction-1',
      postconditions: {
        task: {
          state: 'DONE',
          open_blockers: [],
          next_permitted_action: 'none on this task',
          ...overrides.task,
        },
        campaign: overrides.campaign === null
          ? undefined
          : {
              lifecycle: 'ACTIVE',
              blocker_ids: [],
              slice_keys: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'],
              slice5_status: 'NOT_STARTED',
              next_action: { slice: 5, started: false },
              ...overrides.campaign,
            },
      },
    })
    harness.deps.selectNextCampaignAction = async () => ({
      action: 'Plan Slice 5',
      started: false,
    })

    await expect(execute({
      issueNumber: 254,
      repo: 'boat1994/bemoat-web-starter',
      authorizationCommentId: '6000000001',
      deps: harness.deps,
    })).rejects.toThrow(/STATE_CONFLICT/)

    expect(harness.operations).not.toContain('close:254')
    expect(harness.operations).not.toContain('task-done:254')
    expect(harness.operations.some((entry) => entry.startsWith('merge:'))).toBe(false)
  })
})

describe('Mission Control safe bundle and Founder authorization contracts', () => {
  it.each([
    'authorization-execution',
    'task-initialization',
    'delivery',
    'merge-completion',
  ])('accepts the complete allowed %s bundle', async (kind) => {
    const mergeTransport = await import('../../scripts/mission-control-merge.mjs')
    const result = mergeTransport.validateSafeExecutionBundle({
      kind,
      authority_scope: kind === 'merge-completion' ? 'merge' : kind,
      terminal_outcome: 'deterministic projection',
      steps: mergeTransport.SAFE_EXECUTION_BUNDLES[
        kind as keyof typeof mergeTransport.SAFE_EXECUTION_BUNDLES
      ],
    })

    expect(result).toMatchObject({ valid: true, kind })
  })

  it.each([
    ['implementation-plan-approval + implementation', ['approve-implementation-plan', 'deliver-implementation']],
    ['implementation + independent review', ['deliver-implementation', 'independent-review']],
    ['review + Founder merge approval', ['independent-review', 'approve-founder-merge']],
    ['merge + next-task start', ['merge-exact-reviewed-head', 'start-next-campaign-action']],
  ])('rejects the prohibited %s cross-gate bundle', async (_label, steps) => {
    const mergeTransport = await import('../../scripts/mission-control-merge.mjs')
    const result = mergeTransport.validateSafeExecutionBundle({
      kind: 'merge-completion',
      authority_scope: 'merge',
      terminal_outcome: 'deterministic projection',
      steps,
    })

    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/cross-gate|prohibited|steps/i)
  })

  it.each([
    ['ambiguous record', { status: undefined }],
    ['fabricated identity', { author_login: 'attacker' }],
    ['fabricated comment reference', { immutable_comment_reference: false }],
    ['invalid comment digest', { comment_sha256: 'not-a-sha256' }],
    ['superseded decision', { non_superseded: false }],
    ['supersession marker', { superseded_by: '6000000004' }],
    ['repository mismatch', { repository: 'other/repository' }],
    ['task mismatch', { task_issue: 999 }],
    ['PR mismatch', { pr: 999 }],
    ['head mismatch', { exact_head: 'a'.repeat(40), reviewed_head: 'a'.repeat(40) }],
    ['base mismatch', { base: 'dev' }],
    ['missing bundle kind', { bundle_kind: undefined }],
    ['bundle kind mismatch', { bundle_kind: 'delivery' }],
    ['missing policy source SHA', { policy_source_sha: undefined }],
    ['stale policy source SHA', { policy_source_sha: '3333333333333333333333333333333333333333' }],
    ['missing protected base SHA', { protected_base_sha: undefined }],
    ['stale protected base SHA', { protected_base_sha: '4444444444444444444444444444444444444444' }],
    ['scope mismatch', { scope: 'implementation' }],
    ['action mismatch', { action: 'review' }],
    ['implementation-only decision', { scope: 'implementation', action: 'implement' }],
    ['non-merge decision', { scope: 'review', action: 'review' }],
  ])('rejects %s as merge authority', async (_label, override) => {
    const mergeTransport = await import('../../scripts/mission-control-merge.mjs')
    expect(() => mergeTransport.validateFounderAuthorizationRecord({
      authorization: authorization(override),
      authorizationCommentId: '6000000001',
      trustedFounderLogins: ['boat1994'],
      expected: {
        repository: 'boat1994/bemoat-web-starter',
        taskIssue: 222,
        pr: 223,
        exactHead: reviewedHead,
        base: 'main',
        bundleKind: 'merge-completion',
        policySourceSha,
        protectedBaseSha,
        policyVersion: '1.3.0',
        scope: 'merge',
        action: 'merge',
      },
    })).toThrow(/AUTHORIZATION_VALIDATION_FAILURE/)
  })

  it('rejects an implementation-only Founder decision as merge authority even when the head matches', async () => {
    const mergeTransport = await import('../../scripts/mission-control-merge.mjs')
    expect(() => mergeTransport.validateFounderAuthorizationRecord({
      authorization: authorization({ scope: 'implementation', action: 'implement' }),
      authorizationCommentId: '6000000001',
      trustedFounderLogins: ['boat1994'],
      expected: {
        repository: 'boat1994/bemoat-web-starter',
        taskIssue: 222,
        pr: 223,
        exactHead: reviewedHead,
        base: 'main',
        bundleKind: 'merge-completion',
        policySourceSha,
        protectedBaseSha,
        policyVersion: '1.3.0',
        scope: 'merge',
        action: 'merge',
      },
    })).toThrow(/scope|action|merge/i)
  })

  it('rejects a merge-shaped bundle with an implementation authority scope', async () => {
    const mergeTransport = await import('../../scripts/mission-control-merge.mjs')
    const result = mergeTransport.validateSafeExecutionBundle({
      kind: 'merge-completion',
      authority_scope: 'implementation',
      terminal_outcome: 'Task DONE',
      steps: mergeTransport.SAFE_EXECUTION_BUNDLES['merge-completion'],
    })

    expect(result).toMatchObject({ valid: false })
    expect(result.reason).toMatch(/authority scope/i)
  })
})

describe('canonical Founder merge-authorization JSON transport', () => {
  function expectedAuthorization() {
    return {
      repository: 'boat1994/bemoat-web-starter',
      taskIssue: 222,
      pr: 223,
      exactHead: reviewedHead,
      base: 'main',
      bundleKind: 'merge-completion',
      policySourceSha,
      protectedBaseSha,
      policyVersion: '1.3.0',
      scope: 'merge',
      action: 'merge',
    }
  }

  function recordBody(overrides: Record<string, unknown> = {}) {
    const record = authorization(overrides)
    delete record.comment_id
    delete record.comment_sha256
    return record
  }

  function completeRecord(overrides: Record<string, unknown> = {}) {
    return authorization(overrides)
  }

  it('emits one raw JSON object with non_superseded true', async () => {
    const mergeTransport = await import('../../scripts/mission-control-merge.mjs')
    const raw = mergeTransport.generateFounderMergeAuthorization(completeRecord({
      supersedes_comment_ids: ['5159403964', '5159448302'],
    }))

    expect(raw).toMatch(/^\{[\s\S]*\}$/)
    expect(raw).not.toContain('```')
    expect(JSON.parse(raw)).toMatchObject({
      non_superseded: true,
      superseded_by: null,
      supersedes_comment_ids: ['5159403964', '5159448302'],
    })
    expect(JSON.parse(raw)).not.toBeTypeOf('string')
    expect(mergeTransport.validateFounderMergeAuthorizationEvidence({
      body: raw,
      authorizationCommentId: '6000000001',
      trustedFounderLogins: ['boat1994'],
      expected: expectedAuthorization(),
    })).toMatchObject({ non_superseded: true, superseded_by: null })
  })

  it.each([
    ['malformed', '{"schema_version":1,'],
    ['escaped', JSON.stringify(recordBody(), null, 2).replace(/\n/g, '\\n')],
    ['double-stringified', JSON.stringify(JSON.stringify(recordBody()))],
  ])('rejects %s authorization evidence as authorization validation failure', async (_label, body) => {
    const mergeTransport = await import('../../scripts/mission-control-merge.mjs')

    expect(() => mergeTransport.validateFounderMergeAuthorizationEvidence({
      body,
      authorizationCommentId: '6000000001',
      trustedFounderLogins: ['boat1994'],
      expected: expectedAuthorization(),
    })).toThrow(/AUTHORIZATION_VALIDATION_FAILURE/)
    expect(() => mergeTransport.validateFounderMergeAuthorizationEvidence({
      body,
      authorizationCommentId: '6000000001',
      trustedFounderLogins: ['boat1994'],
      expected: expectedAuthorization(),
    })).not.toThrow(/STATE_CONFLICT/)
  })

  it('rejects missing non_superseded evidence without classifying durable state conflict', async () => {
    const mergeTransport = await import('../../scripts/mission-control-merge.mjs')
    const body = JSON.stringify(completeRecord({ non_superseded: undefined }))
    const error = (() => {
      try {
        mergeTransport.validateFounderMergeAuthorizationEvidence({
          body,
          authorizationCommentId: '6000000001',
          trustedFounderLogins: ['boat1994'],
          expected: expectedAuthorization(),
        })
        return null
      } catch (caught) {
        return caught as Error & { code?: string, classification?: string }
      }
    })()

    expect(error).toMatchObject({
      code: 'AUTHORIZATION_VALIDATION_FAILURE',
      classification: 'AUTHORIZATION_VALIDATION_FAILURE',
    })
    expect(error?.message).not.toContain('STATE_CONFLICT')
  })

  it('rejects a superseded authorization record as authorization validation failure', async () => {
    const mergeTransport = await import('../../scripts/mission-control-merge.mjs')
    const body = JSON.stringify(completeRecord({
      non_superseded: false,
      superseded_by: '5159453303',
    }))

    expect(() => mergeTransport.validateFounderMergeAuthorizationEvidence({
      body,
      authorizationCommentId: '6000000001',
      trustedFounderLogins: ['boat1994'],
      expected: expectedAuthorization(),
    })).toThrow(/AUTHORIZATION_VALIDATION_FAILURE/)
  })
})

describe('bounded Founder Markdown authorization transport', () => {
  const taskIssue = 254
  const prNumber = 258
  const exactHead = '31afbb8619c58877109a2448e2388a3bb16727d6'
  const base = 'main'
  const policySourceSha = '1'.repeat(40)
  const protectedBaseSha = '2'.repeat(40)
  const reviewVerdictCommentId = '5162624753'
  const authorizationCommentId = '5179000001'

  type MarkdownOverrides = Partial<{
    author: string
    repository: string
    task: number
    pr: number
    approvedBase: string
    reviewedHead: string
    reviewComment: string
    policySha: string
    protectedSha: string
    action: string
    scope: string
    nonSuperseded: boolean
    omit: string
  }>

  function canonicalMarkdown(overrides: MarkdownOverrides = {}) {
    const values = {
      author: 'boat1994',
      repository: 'boat1994/bemoat-web-starter',
      task: taskIssue,
      pr: prNumber,
      approvedBase: base,
      reviewedHead: exactHead,
      reviewComment: reviewVerdictCommentId,
      policySha: policySourceSha,
      protectedSha: protectedBaseSha,
      action: 'merge',
      scope: 'merge',
      nonSuperseded: true,
      ...overrides,
    }
    const fields = [
      '## FOUNDER_DECISION',
      '',
      '**Decision:** APPROVE MERGE COMPLETION',
      '**Authority:** Founder',
      `**Author:** @${values.author}`,
      `**Repository:** \`${values.repository}\``,
      `**Task / Issue:** #${values.task}`,
      `**PR:** PR #${values.pr}`,
      `**Approved base:** \`${values.approvedBase}\``,
      `**Exact reviewed head:** \`${values.reviewedHead}\``,
      `**REVIEW_VERDICT comment ID:** ${values.reviewComment}`,
      `**Action:** ${values.action}`,
      `**Scope:** ${values.scope}`,
      `**Policy source SHA:** \`${values.policySha}\``,
      `**Protected base SHA:** \`${values.protectedSha}\``,
      `**Non-superseded:** ${values.nonSuperseded}`,
    ]
    return fields.filter((field) => !overrides.omit || !field.toLowerCase().includes(overrides.omit.toLowerCase())).join('\n')
  }

  function expectedAuthorization() {
    return {
      repository: 'boat1994/bemoat-web-starter',
      taskIssue,
      pr: prNumber,
      exactHead,
      base,
      bundleKind: 'merge-completion',
      policySourceSha,
      protectedBaseSha,
      policyVersion: '1.3.0',
      reviewCommentId: reviewVerdictCommentId,
      scope: 'merge',
      action: 'merge',
    }
  }

  function enrichParsed(parsed: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
    return {
      ...parsed,
      comment_id: authorizationCommentId,
      immutable_comment_reference: true,
      comment_sha256: 'a'.repeat(64),
      ...overrides,
    }
  }

  it('accepts canonical structured Markdown and preserves raw JSON through the same validator', async () => {
    const mergeTransport = await import('../../scripts/mission-control-merge.mjs')
    const parsedMarkdown = mergeTransport.parseFounderMergeAuthorization(canonicalMarkdown())

    expect(parsedMarkdown).toMatchObject({
      schema_version: 1,
      status: 'approved',
      authority: 'Founder',
      author_login: 'boat1994',
      repository: 'boat1994/bemoat-web-starter',
      task_issue: taskIssue,
      pr: prNumber,
      base,
      exact_head: exactHead,
      reviewed_head: exactHead,
      review_verdict_comment_id: reviewVerdictCommentId,
      policy_source_sha: policySourceSha,
      protected_base_sha: protectedBaseSha,
      bundle_kind: 'merge-completion',
      scope: 'merge',
      action: 'merge',
      non_superseded: true,
      superseded_by: null,
    })
    expect(mergeTransport.validateFounderAuthorizationRecord({
      authorization: enrichParsed(parsedMarkdown),
      authorizationCommentId,
      trustedFounderLogins: ['boat1994'],
      expected: expectedAuthorization(),
    })).toMatchObject({ non_superseded: true })

    const rawRecord = {
      ...enrichParsed(parsedMarkdown),
      comment_id: authorizationCommentId,
    }
    const raw = JSON.stringify(rawRecord)
    expect(mergeTransport.validateFounderMergeAuthorizationEvidence({
      body: raw,
      authorizationCommentId,
      trustedFounderLogins: ['boat1994'],
      expected: expectedAuthorization(),
    })).toMatchObject({ repository: 'boat1994/bemoat-web-starter', non_superseded: true })
  })

  it.each([
    ['prose-only approval', 'I approve the merge of Issue #254 and PR #258.'],
    ['incomplete repository binding', canonicalMarkdown({ omit: 'repository' })],
    ['incomplete REVIEW_VERDICT binding', canonicalMarkdown({ omit: 'review_verdict comment id' })],
    ['incomplete policy binding', canonicalMarkdown({ omit: 'policy source sha' })],
    ['duplicate PR field', `${canonicalMarkdown()}\n**PR:** PR #258`],
    ['conflicting PR field', `${canonicalMarkdown()}\n**PR:** PR #999`],
  ])('rejects %s as non-canonical authorization evidence', async (_label, body) => {
    const mergeTransport = await import('../../scripts/mission-control-merge.mjs')

    expect(() => mergeTransport.parseFounderMergeAuthorization(body))
      .toThrow(/AUTHORIZATION_VALIDATION_FAILURE/)
  })

  it.each([
    ['stale exact head', { reviewedHead: 'a'.repeat(40) }],
    ['mismatched task', { task: 999 }],
    ['mismatched PR', { pr: 999 }],
    ['mismatched base', { approvedBase: 'dev' }],
    ['stale REVIEW_VERDICT comment', { reviewComment: '5162624999' }],
    ['stale policy source', { policySha: '3'.repeat(40) }],
    ['stale protected base', { protectedSha: '4'.repeat(40) }],
    ['untrusted author', { author: 'attacker' }],
    ['superseded evidence', { nonSuperseded: false }],
  ])('rejects %s after canonical parsing without weakening shared binding validation', async (_label, overrides) => {
    const mergeTransport = await import('../../scripts/mission-control-merge.mjs')
    const parsed = mergeTransport.parseFounderMergeAuthorization(canonicalMarkdown(overrides))

    expect(() => mergeTransport.validateFounderAuthorizationRecord({
      authorization: enrichParsed(parsed),
      authorizationCommentId,
      trustedFounderLogins: ['boat1994'],
      expected: expectedAuthorization(),
    })).toThrow(/AUTHORIZATION_VALIDATION_FAILURE/)
  })
})

const blockerResolutionId = 'issue-254-planning-correction-1'
const terminalSliceKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11']

function completeTerminalSlices(): Record<string, any> {
  return Object.fromEntries(terminalSliceKeys.map((key) => {
    if (Number(key) <= 4) {
      return [key, {
        status: 'DONE',
        issue: `#${Number(key) + 200}`,
        pr: `#${Number(key) + 204}`,
        reviewed_head: `completed-slice-${key}-reviewed-head`,
        merged_commit: `completed-slice-${key}-merge-commit`,
        authority_comment_ids: [`completed-slice-${key}-authority`],
        blocker_ids: [] as string[],
      }]
    }
    return [key, {
      status: 'NOT_STARTED',
      issue: null,
      pr: null,
      reviewed_head: null,
      merged_commit: null,
      authority_comment_ids: [],
      blocker_ids: [],
    }]
  }))
}

function completeBlockerResolutionPostconditions(overrides: any = {}) {
  const base: Record<string, any> = {
    task: {
      state: 'DONE',
      canonical_pr: '#258',
      reviewed_head: reviewedHead,
      merge_commit: mergeCommit,
      final_result_comment_id: '6000000003',
      open_blockers: [],
      next_permitted_action: 'none on this task',
    },
    campaign: {
      lifecycle: 'ACTIVE',
      blocker_ids: [],
      unrelated_blockers: ['campaign-unrelated-blocker'],
      slice_keys: terminalSliceKeys,
      slice5_status: 'NOT_STARTED',
      slices: completeTerminalSlices(),
      next_action: {
        slice: 5,
        action: 'Plan Slice 5',
        started: false,
      },
      durable_next_action: {
        slice: 5,
        action: 'Plan Slice 5',
        started: false,
      },
    },
  }
  return {
    task: { ...base.task, ...(overrides.task ?? {}) },
    campaign: {
      ...base.campaign,
      ...(overrides.campaign ?? {}),
      slices: {
        ...base.campaign.slices,
        ...(overrides.campaign?.slices ?? {}),
      },
    },
  }
}

function completedBlockerResolutionHarness(overrides: any = {}) {
  return createHarness({
    taskIssue: 254,
    prNumber: 258,
    issueState: 'CLOSED',
    prState: 'MERGED',
    isDraft: false,
    managedState: {
      state: 'DONE',
      campaign_issue: '#215',
      campaign_slice: null,
      merged_commit_sha: mergeCommit,
      latest_result_comment_id: '6000000003',
      open_blockers: [],
      next_permitted_action: 'none on this task',
      blocker_resolution_postconditions: completeBlockerResolutionPostconditions(overrides),
    },
    authorization: {
      projection_kind: 'blocker-resolution',
      campaign_issue: 215,
      campaign_blocker_id: blockerResolutionId,
    },
  })
}

function mutationOperations(operations: string[]) {
  return operations.filter((operation) =>
    operation === 'mark-ready' ||
    operation.startsWith('merge:') ||
    operation.startsWith('result:') ||
    operation.startsWith('close:') ||
    operation.startsWith('task-done:') ||
    operation.startsWith('campaign-') ||
    operation === 'select-next' ||
    operation.startsWith('reconcile:'),
  )
}

function phase1FounderMarkdown(author = 'boat1994') {
  return [
    '## FOUNDER_DECISION',
    '',
    '**Decision:** APPROVE MERGE COMPLETION',
    '**Authority:** Founder',
    `**Author:** @${author}`,
    '**Repository:** `boat1994/bemoat-web-starter`',
    '**Task / Issue:** #254',
    '**PR:** PR #258',
    '**Approved base:** `main`',
    '**Exact reviewed head:** `31afbb8619c58877109a2448e2388a3bb16727d6`',
    '**REVIEW_VERDICT comment ID:** 5162624753',
    '**Action:** merge',
    '**Scope:** merge',
    `**Policy source SHA:** \`${'1'.repeat(40)}\``,
    `**Protected base SHA:** \`${'2'.repeat(40)}\``,
    '**Non-superseded:** true',
  ].join('\n')
}

function runFounderMergeCliWithFakeGithub({ authorizationBody }: { authorizationBody: string }) {
  const directory = mkdtempSync(join(tmpdir(), 'bemoat-254-phase1-'))
  const fakeGhPath = join(directory, 'gh')
  const logPath = join(directory, 'calls.log')
  const exactHead = '31afbb8619c58877109a2448e2388a3bb16727d6'
  const policySourceSha = '1'.repeat(40)
  const protectedBaseSha = '2'.repeat(40)
  const managedState: Record<string, any> = {
    schema_version: 1,
    state: 'ELIGIBLE_FOR_FOUNDER_REVIEW',
    review_cycle: 2,
    full_review_count: 1,
    active_task_issue: '#254',
    active_pr: '#258',
    current_head: exactHead,
    last_reviewed_head: exactHead,
    approved_base: 'main',
    guide_version: '1.3.0',
    guide_source_ref: 'main',
    guide_source_sha: policySourceSha,
    latest_review_verdict_comment_id: '5162624753',
    campaign_issue: '#215',
    campaign_slice: null,
    open_blockers: [],
    follow_up_issues: [],
    next_permitted_action: 'Founder merge authorization required',
    material_change_status: 'none',
    updated_at: null,
    updated_by: null,
  }
  const issue: Record<string, any> = {
    number: 254,
    id: 'I_kwDO254',
    title: 'bounded merge transport task',
    body: `<!-- bemoat-mission-control-state:start -->\n\`\`\`yaml\n${stringifyYaml(managedState)}\`\`\`\n<!-- bemoat-mission-control-state:end -->`,
    state: 'OPEN',
    stateReason: null,
  }
  const pull: Record<string, any> = {
    number: 258,
    id: 'P_kwDO258',
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    headRefOid: exactHead,
    baseRefName: 'main',
    baseRefOid: protectedBaseSha,
    statusCheckRollup: [
      { name: 'ci', conclusion: 'SUCCESS', status: 'COMPLETED' },
      { name: 'starter-ci', conclusion: 'SUCCESS', status: 'COMPLETED' },
    ],
    mergeCommit: null,
    title: 'bounded merge transport',
    body: 'Refs #254',
    closingIssuesReferences: [],
  }
  const authorizationComment = {
    id: 5179000001,
    issue_url: 'https://api.github.com/repos/boat1994/bemoat-web-starter/issues/254',
    user: { login: 'boat1994' },
    body: authorizationBody,
  }
  const reviewComment = {
    id: 5162624753,
    issue_url: 'https://api.github.com/repos/boat1994/bemoat-web-starter/issues/254',
    user: { login: 'boat1994' },
    body: [
      '## REVIEW_VERDICT',
      '',
      '**Verdict:** ELIGIBLE FOR FOUNDER REVIEW',
      `**PR / base / head:** PR #258 · \`main\` · \`${exactHead}\``,
    ].join('\n'),
  }
  const fakeData = {
    issue,
    pull,
    commits: [[{ commit: { message: 'bounded merge transport' } }]],
    authorizationComment,
    reviewComment,
    issueComments: [authorizationComment, reviewComment],
    founderLogins: { value: 'boat1994' },
  }
  writeFileSync(fakeGhPath, `#!/usr/bin/env node
import { appendFileSync } from 'node:fs'
const args = process.argv.slice(2)
const joined = args.join(' ')
const data = ${JSON.stringify(fakeData)}
appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify(args) + '\\n')
let output = {}
if (args[0] === 'issue' && args[1] === 'view') output = data.issue
else if (args[0] === 'pr' && args[1] === 'view') output = data.pull
else if (args[0] === 'api' && joined.includes('/pulls/258/commits')) output = data.commits
else if (args[0] === 'api' && joined.includes('/issues/comments/5179000001')) output = data.authorizationComment
else if (args[0] === 'api' && joined.includes('/issues/comments/5162624753')) output = data.reviewComment
else if (args[0] === 'api' && joined.includes('/issues/254/comments')) output = data.issueComments
else if (args[0] === 'api' && joined.includes('/actions/variables/BEMOAT_FOUNDER_LOGINS')) output = data.founderLogins
process.stdout.write(JSON.stringify(output))
`)
  chmodSync(fakeGhPath, 0o755)

  try {
    const result = spawnSync(
      process.execPath,
      ['scripts/mission-control-merge.mjs', '254', '--repo', 'boat1994/bemoat-web-starter', '--authorization-comment', '5179000001'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          FAKE_GH_LOG: logPath,
        },
      },
    )
    const calls = readFileSync(logPath, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as string[])
    return { result, calls }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

describe('Phase 1 Finding A: complete blocker-resolution terminal projection', () => {
  it('accepts the complete Task, Campaign, slice lineage, and durable next-action projection', async () => {
    const harness = completedBlockerResolutionHarness()

    await expect(execute({
      issueNumber: 254,
      repo: 'boat1994/bemoat-web-starter',
      authorizationCommentId: '6000000001',
      deps: harness.deps,
    })).resolves.toMatchObject({ outcome: 'NO_OP', issueNumber: 254, prNumber: 258 })

    expect(harness.operations).toEqual([
      'authorization:254',
      `review-verdict:${reviewCommentId}`,
      `verify-base:${mergeCommit}:main`,
    ])
  })

  it.each([
    ['missing Task canonical PR lineage', { task: { canonical_pr: undefined } }],
    ['stale Task reviewed head lineage', { task: { reviewed_head: 'stale-reviewed-head' } }],
    ['partial Task final RESULT lineage', { task: { final_result_comment_id: null } }],
    ['reordered slices', { campaign: { slice_keys: ['1', '2', '3', '4', '6', '5', '7', '8', '9', '10', '11'] } }],
    ['non-contiguous slices', { campaign: { slice_keys: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '11'] } }],
    ['changed unrelated blockers', { campaign: { unrelated_blockers: ['changed-unrelated-blocker'] } }],
    ['remaining target blocker', { campaign: { blocker_ids: [blockerResolutionId] } }],
    ['wrong lifecycle', { campaign: { lifecycle: 'BLOCKED' } }],
    ['over-advanced Slice 5', { campaign: { slices: { '5': { status: 'IN_PROGRESS' } } } }],
    ['over-advanced Slice 6', { campaign: { slices: { '6': { status: 'DONE' } } } }],
    ['non-null Slice 5 lineage', { campaign: { slices: { '5': { issue: '#259' } } } }],
    ['non-null Slice 11 lineage', { campaign: { slices: { '11': { merged_commit: 'unexpected-merge' } } } }],
    ['missing durable next action', { campaign: { next_action: undefined } }],
    ['synthesized next action disagrees with durable state', {
      campaign: { durable_next_action: { slice: 6, action: 'Plan Slice 6', started: false } },
    }],
    ['durable action starts Slice 5', {
      campaign: { durable_next_action: { slice: 5, action: 'Start Slice 5', started: true } },
    }],
  ])('rejects %s before returning NO_OP', async (_label, overrides) => {
    const harness = completedBlockerResolutionHarness(overrides)

    await expect(execute({
      issueNumber: 254,
      repo: 'boat1994/bemoat-web-starter',
      authorizationCommentId: '6000000001',
      deps: harness.deps,
    })).rejects.toThrow(/STATE_CONFLICT/)
  })

  it('reads the complete live postcondition object before returning deterministic NO_OP', async () => {
    const harness = completedBlockerResolutionHarness()
    delete harness.issues.get(254).managedState.blocker_resolution_postconditions
    let readerCalls = 0
    ;(harness.deps as Record<string, any>).readCampaignBlockerResolutionPostconditions = async () => {
      readerCalls += 1
      return completeBlockerResolutionPostconditions()
    }
    harness.deps.selectNextCampaignAction = async () => {
      throw new Error('next action must come from the verified live terminal projection')
    }

    await expect(execute({
      issueNumber: 254,
      repo: 'boat1994/bemoat-web-starter',
      authorizationCommentId: '6000000001',
      deps: harness.deps,
    })).resolves.toMatchObject({ outcome: 'NO_OP' })

    expect(readerCalls).toBe(1)
  })
})

describe('Phase 1 Finding B: structured Markdown author binding', () => {
  it('preserves explicit Markdown author evidence and accepts matching authenticated author evidence', async () => {
    const mergeTransport = await import('../../scripts/mission-control-merge.mjs')
    const parsed = mergeTransport.parseFounderMergeAuthorization(phase1FounderMarkdown())

    expect(parsed.author_login).toBe('boat1994')
    expect(mergeTransport.validateFounderAuthorizationRecord({
      authorization: {
        ...parsed,
        comment_id: '5179000001',
        immutable_comment_reference: true,
        comment_sha256: 'a'.repeat(64),
      },
      authorizationCommentId: '5179000001',
      trustedFounderLogins: ['boat1994'],
      expected: {
        repository: 'boat1994/bemoat-web-starter',
        taskIssue: 254,
        pr: 258,
        exactHead: '31afbb8619c58877109a2448e2388a3bb16727d6',
        base: 'main',
        bundleKind: 'merge-completion',
        policySourceSha: '1'.repeat(40),
        protectedBaseSha: '2'.repeat(40),
        policyVersion: '1.3.0',
        reviewCommentId: '5162624753',
        scope: 'merge',
        action: 'merge',
      },
    })).toMatchObject({ author_login: 'boat1994' })
  })

  it('fails closed when live comment metadata conflicts with explicit Markdown Author before any GitHub mutation', () => {
    const { result, calls } = runFounderMergeCliWithFakeGithub({
      authorizationBody: phase1FounderMarkdown('attacker'),
    })

    expect(result.status).not.toBe(0)
    expect({
      stderr: result.stderr,
      mutationCalls: calls.filter(([command, subcommand]) =>
        command === 'pr' && ['ready', 'merge'].includes(subcommand),
      ),
    }).toMatchObject({
      stderr: expect.stringMatching(/AUTHORIZATION_VALIDATION_FAILURE.*author/i),
      mutationCalls: [],
    })
  })
})

describe('Phase 1 Finding C: rejection before mutation', () => {
  it.each([
    ['invalid authority', { authorization: { authority: 'Reviewer' } }, /AUTHORIZATION_VALIDATION_FAILURE/],
    ['untrusted Founder', { trustedFounderLogins: ['different-founder'] }, /AUTHORIZATION_VALIDATION_FAILURE.*Founder identity/],
    ['stale Task binding', { managedState: { active_pr: '#999' } }, /STATE_CONFLICT.*active PR/],
    ['stale PR head', { pull: { headRefOid: 'b'.repeat(40) } }, /STATE_CONFLICT.*heads must match exactly/],
    ['stale base', { pull: { baseRefName: 'dev' } }, /STATE_CONFLICT.*base/],
    ['stale REVIEW_VERDICT', { reviewVerdict: 'CORRECTION REQUIRED' }, /STATE_CONFLICT/],
    ['stale policy binding', { managedState: { guide_source_sha: 'c'.repeat(40) } }, /AUTHORIZATION_VALIDATION_FAILURE/],
    ['superseded authority', { authorization: { non_superseded: false } }, /AUTHORIZATION_VALIDATION_FAILURE/],
  ])('rejects %s before any mutation', async (_label, options, expectedError) => {
    const harness = createHarness(options)

    await expect(execute({
      issueNumber: 222,
      repo: 'boat1994/bemoat-web-starter',
      authorizationCommentId: '6000000001',
      deps: harness.deps,
    })).rejects.toThrow(expectedError)

    expect(mutationOperations(harness.operations)).toEqual([])
  })

  it('rejects conflicting already-DONE terminal state before any mutation', async () => {
    const harness = createHarness({
      issueState: 'OPEN',
      prState: 'MERGED',
      isDraft: false,
      managedState: { state: 'DONE', merged_commit_sha: mergeCommit, latest_result_comment_id: '6000000003' },
    })

    await expect(execute({
      issueNumber: 222,
      repo: 'boat1994/bemoat-web-starter',
      authorizationCommentId: '6000000001',
      deps: harness.deps,
    })).rejects.toThrow(/STATE_CONFLICT/)

    expect(mutationOperations(harness.operations)).toEqual([])
  })

  it('rejects an invalid durable next action before selecting it or calling any mutation', async () => {
    const harness = createHarness({
      taskIssue: 254,
      prNumber: 258,
      managedState: { campaign_issue: '#215', campaign_slice: null },
      authorization: {
        projection_kind: 'blocker-resolution',
        campaign_issue: 215,
        campaign_blocker_id: blockerResolutionId,
      },
      nextStarted: true,
    })

    await expect(execute({
      issueNumber: 254,
      repo: 'boat1994/bemoat-web-starter',
      authorizationCommentId: '6000000001',
      deps: harness.deps,
    })).rejects.toThrow(/STATE_CONFLICT.*next campaign action/)

    expect(mutationOperations(harness.operations)).toEqual([])
  })
})
