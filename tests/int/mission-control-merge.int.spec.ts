import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

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
  return {
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
    baseRefOid: protectedBaseSha,
    statusCheckRollup: successfulChecks(),
    mergeCommit: options.prState === 'MERGED' ? { oid: mergeCommit } : null,
    ...options.pull,
  }
  const operations: string[] = []
  const reconcileOutcomes = [...(options.reconcileOutcomes ?? ['DONE', 'NO_OP'])]
  let closeFailures = options.closeFailures ?? 0
  let projectionFailures = options.projectionFailures ?? 0
  let campaignProjectionFailures = options.campaignProjectionFailures ?? 0

  const deps = {
    readManagedIssue: async (issueNumber: number) => structuredClone(issues.get(issueNumber)),
    readPullRequest: async () => structuredClone(pull),
    readFounderAuthorization: async (_repo: string, issueNumber: number) => {
      operations.push(`authorization:${issueNumber}`)
      return authorization(options.authorization)
    },
    readReviewVerdict: async (_repo: string, _issueNumber: number, commentId: string) => {
      operations.push(`review-verdict:${commentId}`)
      return {
        comment_id: commentId,
        verdict: options.reviewVerdict ?? 'ELIGIBLE FOR FOUNDER REVIEW',
        reviewed_head: options.reviewedVerdictHead ?? reviewedHead,
        pr: 223,
        base: 'main',
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
      pull.mergeCommit = { oid: mergeCommit }
      return { mergeCommit: { oid: mergeCommit } }
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
