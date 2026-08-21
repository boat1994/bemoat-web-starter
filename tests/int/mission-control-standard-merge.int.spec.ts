import { describe, expect, it } from 'vitest'

import { runStandardFounderAuthorizedMerge } from '../../scripts/mission-control/workflows/merge-standard.mjs'

const repository = 'boat1994/bemoat-web-starter'
const issueNumber = 100
const prNumber = 101
const reviewedHead = 'e'.repeat(40)
const protectedBaseSha = 'a'.repeat(40)
const policySha = 'b'.repeat(40)
const mergeCommit = 'c'.repeat(40)
const reviewCommentId = '777'
const authorizationCommentId = '888'

const policy = {
  path: 'docs/mission-control/mission-control-guide.md',
  version: '1.3.0',
  blobSha: policySha,
  sourceCommit: protectedBaseSha,
  content: `canonical_repository: ${repository}\nMission Control mode: required\n| Medium/Core | STANDARD |`,
}

const issue = {
  number: issueNumber,
  state: 'OPEN',
  body: 'Task size: Core\nMission Control mode: optional',
}

const reviewComment = {
  id: reviewCommentId,
  issue_number: issueNumber,
  body: `## REVIEW_VERDICT\n\n**Task / Issue:** #${issueNumber}\n**Verdict:** ELIGIBLE FOR FOUNDER REVIEW\n**PR / base / head:** PR #${prNumber} · \`main\` · \`${reviewedHead}\``,
}

function authorization(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    status: 'approved',
    authority: 'Founder',
    author_login: 'boat1994',
    immutable_comment_reference: true,
    comment_sha256: 'd'.repeat(64),
    non_superseded: true,
    superseded_by: null,
    repository,
    bundle_kind: 'merge-completion',
    task_issue: issueNumber,
    pr: prNumber,
    exact_head: reviewedHead,
    reviewed_head: reviewedHead,
    base: 'main',
    policy_source: policy.path,
    policy_source_sha: policySha,
    protected_base_sha: protectedBaseSha,
    policy_version: policy.version,
    review_verdict_comment_id: reviewCommentId,
    scope: 'merge',
    action: 'merge',
    comment_id: null,
    ...overrides,
  }
}

function harness(options: {
  issue?: Record<string, unknown>
  pull?: Record<string, unknown>
  authorization?: Record<string, unknown>
  comments?: Record<string, unknown>[]
  mergeError?: Error
} = {}) {
  const operations: string[] = []
  const pull: Record<string, unknown> = {
    number: prNumber,
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    headRefOid: reviewedHead,
    baseRefName: 'main',
    statusCheckRollup: [
      { name: 'ci', conclusion: 'SUCCESS' },
      { name: 'starter-ci', conclusion: 'SUCCESS' },
    ],
    mergeCommit: null,
    ...options.pull,
  }
  return {
    operations,
    deps: {
      readIssue: async () => structuredClone(options.issue ?? issue),
      readPullRequest: async () => structuredClone(pull),
      readIssueComments: async () => structuredClone(options.comments ?? [reviewComment]),
      readFounderAuthorization: async () => structuredClone(options.authorization ?? authorization()),
      readTrustedFounderLogins: async () => ['boat1994'],
      readProtectedRef: async () => ({ object: { sha: protectedBaseSha } }),
      readPolicy: async () => structuredClone(policy),
      mergePullRequest: async () => {
        operations.push(`merge:${reviewedHead}`)
        if (options.mergeError) throw options.mergeError
        pull.state = 'MERGED'
        pull.mergeCommit = { oid: mergeCommit }
        return { mergeCommit: { oid: mergeCommit } }
      },
      verifyCommitOnProtectedBase: async () => {
        operations.push('verify-base')
        return true
      },
    },
  }
}

describe('STANDARD/non-managed merge transport', () => {
  it('merges one exact authorized head without mutating managed state or Issue lifecycle', async () => {
    const testHarness = harness()
    await expect(runStandardFounderAuthorizedMerge({
      issueNumber,
      repo: repository,
      authorizationCommentId,
      deps: testHarness.deps,
    })).resolves.toMatchObject({
      outcome: 'SUCCESS',
      issueNumber,
      prNumber,
      reviewedHead,
      mergeCommit,
      reviewVerdictCommentId: reviewCommentId,
    })
    expect(testHarness.operations).toEqual([`merge:${reviewedHead}`, 'verify-base'])
  })

  it('rejects managed or ambiguous targets before any merge mutation', async () => {
    for (const body of [
      `${issue.body}\n<!-- bemoat-mission-control-state:start -->\nstate: READY\n<!-- bemoat-mission-control-state:end -->`,
      'Task size: Core\nMission Control mode: unsure',
      'Task size: Small\nMission Control mode: optional',
    ]) {
      const testHarness = harness({ issue: { ...issue, body } })
      await expect(runStandardFounderAuthorizedMerge({ issueNumber, repo: repository, authorizationCommentId, deps: testHarness.deps })).rejects.toThrow()
      expect(testHarness.operations).toEqual([])
    }
  })

  it('rejects review-comment ID mismatch before any merge mutation', async () => {
    const testHarness = harness({ authorization: authorization({ review_verdict_comment_id: '778' }) })
    await expect(runStandardFounderAuthorizedMerge({ issueNumber, repo: repository, authorizationCommentId, deps: testHarness.deps })).rejects.toThrow(/review|authorization/i)
    expect(testHarness.operations).toEqual([])
  })

  it('returns an identical no-op for an already merged exact head', async () => {
    const testHarness = harness({ pull: { state: 'MERGED', mergeCommit: { oid: mergeCommit } } })
    await expect(runStandardFounderAuthorizedMerge({ issueNumber, repo: repository, authorizationCommentId, deps: testHarness.deps })).resolves.toMatchObject({
      outcome: 'NO_OP_IDENTICAL_RETRY',
      mergeCommit,
    })
    expect(testHarness.operations).toEqual(['verify-base'])
  })

  it('fails closed after an ambiguous merge write and never retries blindly', async () => {
    const testHarness = harness({ mergeError: new Error('transport outcome unknown') })
    await expect(runStandardFounderAuthorizedMerge({ issueNumber, repo: repository, authorizationCommentId, deps: testHarness.deps })).rejects.toThrow(/AMBIGUOUS_RESULT/)
    expect(testHarness.operations).toEqual([`merge:${reviewedHead}`])
  })

  it('rejects stale policy identity before any merge mutation', async () => {
    const testHarness = harness()
    testHarness.deps.readPolicy = async () => ({ ...policy, sourceCommit: 'f'.repeat(40) })
    await expect(runStandardFounderAuthorizedMerge({ issueNumber, repo: repository, authorizationCommentId, deps: testHarness.deps })).rejects.toThrow(/policy/i)
    expect(testHarness.operations).toEqual([])
  })

  it('rejects a stale policy blob binding before any merge mutation', async () => {
    const testHarness = harness()
    testHarness.deps.readPolicy = async () => ({ ...policy, blobSha: 'f'.repeat(40) })
    await expect(runStandardFounderAuthorizedMerge({ issueNumber, repo: repository, authorizationCommentId, deps: testHarness.deps })).rejects.toThrow(/policy/i)
    expect(testHarness.operations).toEqual([])
  })

  it('requires exact starter CI and mergeability before any merge mutation', async () => {
    const failedCi = harness({ pull: { statusCheckRollup: [{ name: 'ci', conclusion: 'SUCCESS' }, { name: 'starter-ci', conclusion: 'FAILURE' }] } })
    await expect(runStandardFounderAuthorizedMerge({ issueNumber, repo: repository, authorizationCommentId, deps: failedCi.deps })).rejects.toThrow(/CI|check/i)
    expect(failedCi.operations).toEqual([])

    const conflicting = harness({ pull: { mergeable: 'CONFLICTING' } })
    await expect(runStandardFounderAuthorizedMerge({ issueNumber, repo: repository, authorizationCommentId, deps: conflicting.deps })).rejects.toThrow(/mergeable|conflict/i)
    expect(conflicting.operations).toEqual([])
  })
})
