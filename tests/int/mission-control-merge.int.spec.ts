import { describe, expect, it } from 'vitest'

/* eslint-disable @typescript-eslint/no-explicit-any -- deterministic .mjs transport boundary */
import { getDefaultRepo } from '../../scripts/agent-issue/local-git-evidence.mjs'

const reviewedHead = '527a48cb83364a7fbde0fad5f88f5c9d1244d0ab'
const mergeCommit = '8df91686d715a0ddf0ddf258bf9fa5b060a4af29'

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
    ...overrides,
  }
}

function authorization(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    authority: 'Founder',
    scope: 'merge',
    task_issue: 222,
    pr: 223,
    reviewed_head: reviewedHead,
    action: 'merge',
    comment_id: '6000000001',
    author_login: 'boat1994',
    ...overrides,
  }
}

function createHarness(options: Record<string, any> = {}) {
  const issues = new Map<number, any>([
    [222, {
      number: 222,
      state: options.issueState ?? 'OPEN',
      stateReason: options.issueState === 'CLOSED' ? 'COMPLETED' : null,
      managedState: managedState(options.managedState),
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
    number: 223,
    state: options.prState ?? 'OPEN',
    isDraft: options.isDraft ?? true,
    mergeable: 'MERGEABLE',
    headRefOid: reviewedHead,
    baseRefName: 'main',
    statusCheckRollup: successfulChecks(),
    mergeCommit: options.prState === 'MERGED' ? { oid: mergeCommit } : null,
    ...options.pull,
  }
  const operations: string[] = []
  const reconcileOutcomes = [...(options.reconcileOutcomes ?? ['DONE', 'NO_OP'])]
  let closeFailures = options.closeFailures ?? 0
  let reconcileFailures = options.reconcileFailures ?? 0

  const deps = {
    readManagedIssue: async (issueNumber: number) => structuredClone(issues.get(issueNumber)),
    readPullRequest: async () => structuredClone(pull),
    readFounderAuthorization: async (_repo: string, issueNumber: number) => {
      operations.push(`authorization:${issueNumber}`)
      return authorization(options.authorization)
    },
    readTrustedFounderLogins: async () => options.trustedFounderLogins ?? ['boat1994'],
    markReadyForReview: async () => {
      operations.push('mark-ready')
      pull.isDraft = false
    },
    mergePullRequest: async ({ expectedHead }: { expectedHead: string }) => {
      operations.push(`merge:${expectedHead}`)
      pull.state = 'MERGED'
      pull.mergeCommit = { oid: mergeCommit }
      return { mergeCommit: { oid: mergeCommit } }
    },
    verifyCommitOnProtectedBase: async ({ commit, base }: { commit: string, base: string }) => {
      operations.push(`verify-base:${commit}:${base}`)
      return true
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
    reconcile: async (issueNumber: number) => {
      operations.push(`reconcile:${issueNumber}`)
      if (reconcileFailures > 0) {
        reconcileFailures -= 1
        throw new Error('simulated DONE projection failure')
      }
      const outcome = reconcileOutcomes.shift() ?? 'NO_OP'
      if (outcome === 'DONE') issues.get(issueNumber).managedState.state = 'DONE'
      return { finalOutcome: outcome, state: issues.get(issueNumber).managedState }
    },
  }

  return { deps, issues, pull, operations }
}

describe('Founder-authorized Mission Control merge transport', () => {
  it('executes ready, expected-head merge, protected-base verification, one closure, DONE and NO_OP in order', async () => {
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
      'mark-ready',
      `merge:${reviewedHead}`,
      `verify-base:${mergeCommit}:main`,
      'close:222',
      'reconcile:222',
      'reconcile:222',
    ])
    expect(harness.issues.get(222)).toMatchObject({ state: 'CLOSED', stateReason: 'COMPLETED', managedState: { state: 'DONE' } })
  })

  it.each([
    ['Founder authority', { authorization: { authority: 'Reviewer' } }],
    ['Founder identity', { authorization: { author_login: 'attacker' } }],
    ['reviewed head', { authorization: { reviewed_head: 'a'.repeat(40) } }],
    ['current PR head', { pull: { headRefOid: 'b'.repeat(40) } }],
    ['protected base', { pull: { baseRefName: 'dev' } }],
    ['exact-head CI', { pull: { statusCheckRollup: [{ name: 'ci', conclusion: 'FAILURE', status: 'COMPLETED' }] } }],
  ])('fails closed before merge when %s differs', async (_label, options) => {
    const harness = createHarness(options)

    await expect(execute({
      issueNumber: 222,
      repo: 'boat1994/bemoat-web-starter',
      authorizationCommentId: '6000000001',
      deps: harness.deps,
    })).rejects.toThrow(/STATE_CONFLICT/)

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

    expect(harness.operations).toEqual(['authorization:222'])
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

    expect(harness.operations).toEqual(['authorization:222'])
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

    expect(harness.operations).toEqual(['authorization:222'])
  })

  it('accepts an organization-owned child repository with repository-configured Founder identity', async () => {
    const harness = createHarness({
      authorization: { author_login: 'founder-login' },
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
    })).rejects.toThrow(/STATE_CONFLICT.*Founder identity/)

    expect(harness.operations).toEqual(['authorization:222'])
  })

  it('requires starter strict CI only in the starter repository', async () => {
    const harness = createHarness({
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
    const harness = createHarness({ closeFailures: 1 })
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
  })

  it('recovers after Issue closure succeeds but DONE projection fails without closing twice', async () => {
    const harness = createHarness({ reconcileFailures: 1 })
    const input = {
      issueNumber: 222,
      repo: 'boat1994/bemoat-web-starter',
      authorizationCommentId: '6000000001',
      deps: harness.deps,
    }

    await expect(execute(input)).rejects.toThrow('simulated DONE projection failure')
    await expect(execute(input)).resolves.toMatchObject({ outcome: 'DONE' })

    expect(harness.operations.filter((entry) => entry === 'close:222')).toHaveLength(1)
    expect(harness.operations.filter((entry) => entry.startsWith('merge:'))).toHaveLength(1)
  })

  it('returns NO_OP for an already-closed Issue in DONE state without lifecycle mutation', async () => {
    const harness = createHarness({
      issueState: 'CLOSED',
      prState: 'MERGED',
      isDraft: false,
      managedState: { state: 'DONE', merged_commit_sha: mergeCommit },
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
    expect(harness.operations.filter((entry) => entry === 'reconcile:222')).toHaveLength(1)
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
})
