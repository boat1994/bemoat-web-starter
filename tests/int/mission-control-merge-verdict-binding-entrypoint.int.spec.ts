import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/* eslint-disable @typescript-eslint/no-explicit-any -- deterministic .mjs transport boundary */

const fixturePath = resolve(
  process.cwd(),
  'tests/fixtures/mission-control/review-verdict-comment-5162624753.body.md',
)
const historicalCommentId = '5162624753'
const historicalTask = 254
const historicalPr = 258
const historicalHead = '31afbb8619c58877109a2448e2388a3bb16727d6'
const historicalBase = 'main'
const mergeCommit = '18640666402ade75003cbf0a3556eef6ad63d536'
const policySourceSha = 'd6e99c350f8d92e536fe97f81bd6507f6cdaa686'
const protectedBaseSha = 'b998c4a4ed30658c3f64e85c5b84e00035b5f8be'
const fixtureSha256 = '933ffdf92448b4cb8ebcde96941fcf98036fb1e46fe9eb4db10b5112ddc728fc'

async function mergeTransport() {
  return import('../../scripts/mission-control-merge.mjs')
}

function historicalFixtureBody() {
  return readFileSync(fixturePath, 'utf8')
}

function canonicalBody(pr = historicalPr, head = historicalHead, base = historicalBase) {
  return `## REVIEW_VERDICT

**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**PR / base / head:** PR #${pr} · \`${base}\` · \`${head}\`
`
}

function pullUrlBody(pr = historicalPr, head = historicalHead, base = historicalBase) {
  return `## REVIEW_VERDICT

**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**Approved base:** \`${base}@${policySourceSha}\`
**Exact head reviewed:** \`${head}\`

Reviewed at https://github.com/boat1994/bemoat-web-starter/pull/${pr}.
`
}

function historicalFieldBody({
  pr = `PR #${historicalPr}`,
  head = `\`${historicalHead}\``,
  extra = '',
} = {}) {
  return `## REVIEW_VERDICT

**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**Task:** Issue #${historicalTask}
**PR:** ${pr}
**Exact reviewed head:** ${head}
**Approved base:** \`${historicalBase}@${policySourceSha}\`
${extra}`
}

describe('production merge REVIEW_VERDICT binding', () => {
  it('byte-faithful fixture matches live comment 5162624753', () => {
    const body = historicalFixtureBody()
    expect(createHash('sha256').update(body, 'utf8').digest('hex')).toBe(fixtureSha256)
    expect(body).toContain('**PR:** PR #258')
    expect(body).toContain('**Exact reviewed head:** `31afbb8619c58877109a2448e2388a3bb16727d6`')
  })

  it('live comment 5162624753 binds #254/#258/main/exact head', async () => {
    const { parseProductionMergeReviewVerdict, validateMergeReviewVerdict } = await mergeTransport()
    const reviewVerdict = parseProductionMergeReviewVerdict(historicalFixtureBody(), historicalCommentId)

    expect(reviewVerdict).toMatchObject({
      comment_id: historicalCommentId,
      verdict: 'ELIGIBLE FOR FOUNDER REVIEW',
      pr: String(historicalPr),
      base: historicalBase,
      reviewed_head: historicalHead,
      non_superseded: true,
    })

    expect(validateMergeReviewVerdict({
      reviewVerdict,
      expected: {
        commentId: historicalCommentId,
        exactHead: historicalHead,
        pr: historicalPr,
        base: historicalBase,
      },
    })).toBe(true)
  })

  it('accepts unique **PR:** PR #N historical field', async () => {
    const { resolveMergeReviewVerdictBinding } = await mergeTransport()
    expect(resolveMergeReviewVerdictBinding(historicalFieldBody()).pr).toBe(String(historicalPr))
  })

  it('accepts exactly one full 40-hex **Exact reviewed head:**', async () => {
    const { resolveMergeReviewVerdictBinding } = await mergeTransport()
    expect(resolveMergeReviewVerdictBinding(historicalFieldBody()).reviewed_head).toBe(historicalHead)
  })

  it('preserves canonical **PR / base / head:** binding', async () => {
    const { resolveMergeReviewVerdictBinding } = await mergeTransport()
    // Canonical shorthand without /pull/ still resolves head/base; PR requires /pull/ or historical field.
    const withPull = `## REVIEW_VERDICT

**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/${historicalPr} · \`${historicalBase}\` · \`${historicalHead}\`
`
    expect(resolveMergeReviewVerdictBinding(withPull)).toMatchObject({
      pr: String(historicalPr),
      base: historicalBase,
      reviewed_head: historicalHead,
    })
    expect(resolveMergeReviewVerdictBinding(canonicalBody())).toMatchObject({
      pr: null,
      base: historicalBase,
      reviewed_head: historicalHead,
    })
  })

  it('preserves /pull/N plus existing Exact head reviewed form', async () => {
    const { resolveMergeReviewVerdictBinding } = await mergeTransport()
    expect(resolveMergeReviewVerdictBinding(pullUrlBody())).toMatchObject({
      pr: String(historicalPr),
      base: historicalBase,
      reviewed_head: historicalHead,
    })
  })

  it('fails closed for wrong PR against managed binding', async () => {
    const { parseProductionMergeReviewVerdict, validateMergeReviewVerdict } = await mergeTransport()
    const reviewVerdict = parseProductionMergeReviewVerdict(
      historicalFieldBody({ pr: 'PR #999' }),
      historicalCommentId,
    )
    expect(() => validateMergeReviewVerdict({
      reviewVerdict,
      expected: {
        commentId: historicalCommentId,
        exactHead: historicalHead,
        pr: historicalPr,
        base: historicalBase,
      },
    })).toThrow(/STATE_CONFLICT/)
  })

  it('fails closed for wrong head against managed binding', async () => {
    const { parseProductionMergeReviewVerdict, validateMergeReviewVerdict } = await mergeTransport()
    const wrongHead = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const reviewVerdict = parseProductionMergeReviewVerdict(
      historicalFieldBody({ head: `\`${wrongHead}\`` }),
      historicalCommentId,
    )
    expect(() => validateMergeReviewVerdict({
      reviewVerdict,
      expected: {
        commentId: historicalCommentId,
        exactHead: historicalHead,
        pr: historicalPr,
        base: historicalBase,
      },
    })).toThrow(/STATE_CONFLICT/)
  })

  it('fails closed for duplicate identical historical PR fields', async () => {
    const { resolveMergeReviewVerdictBinding } = await mergeTransport()
    const body = `${historicalFieldBody()}\n**PR:** PR #258\n`
    expect(() => resolveMergeReviewVerdictBinding(body)).toThrow(/STATE_CONFLICT.*PR/i)
  })

  it('fails closed for conflicting PR fields', async () => {
    const { resolveMergeReviewVerdictBinding } = await mergeTransport()
    const body = `${historicalFieldBody()}\nSee https://github.com/boat1994/bemoat-web-starter/pull/999\n`
    expect(() => resolveMergeReviewVerdictBinding(body)).toThrow(/STATE_CONFLICT.*PR/i)
  })

  it('fails closed for duplicate or conflicting head fields', async () => {
    const { resolveMergeReviewVerdictBinding } = await mergeTransport()
    const duplicate = `${historicalFieldBody()}\n**Exact reviewed head:** \`${historicalHead}\`\n`
    expect(() => resolveMergeReviewVerdictBinding(duplicate)).toThrow(/STATE_CONFLICT.*Exact reviewed head/i)

    const conflicting = historicalFieldBody({
      extra: `**Exact head reviewed:** \`bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\`\n`,
    })
    expect(() => resolveMergeReviewVerdictBinding(conflicting)).toThrow(/STATE_CONFLICT.*exact reviewed head/i)
  })

  it('fails closed for multiline and short-SHA Exact reviewed head forms', async () => {
    const { resolveMergeReviewVerdictBinding } = await mergeTransport()
    const multiline = `## REVIEW_VERDICT

**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**PR:** PR #258
**Exact reviewed head:**
\`${historicalHead}\`
**Approved base:** \`main@${policySourceSha}\`
`
    expect(() => resolveMergeReviewVerdictBinding(multiline)).toThrow(/STATE_CONFLICT.*Exact reviewed head/i)

    const shortSha = historicalFieldBody({ head: '`31afbb8`' })
    expect(() => resolveMergeReviewVerdictBinding(shortSha)).toThrow(/STATE_CONFLICT.*Exact reviewed head/i)
  })

  it('does not treat incidental PR #258 prose as authority', async () => {
    const { resolveMergeReviewVerdictBinding } = await mergeTransport()
    const body = `## REVIEW_VERDICT

**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**Exact reviewed head:** \`${historicalHead}\`
**Approved base:** \`main@${policySourceSha}\`

Incidental prose mentions PR #258 without a recognized field.
`
    expect(resolveMergeReviewVerdictBinding(body)).toMatchObject({
      pr: null,
      reviewed_head: historicalHead,
      base: historicalBase,
    })
  })

  it('completion-recovery preflight reaches the next gate with zero writes', async () => {
    const {
      runFounderAuthorizedMerge,
      parseProductionMergeReviewVerdict,
    } = await mergeTransport()

    const writes: string[] = []
    const operations: string[] = []
    const reviewVerdict = parseProductionMergeReviewVerdict(historicalFixtureBody(), historicalCommentId)

    const deps = {
      readManagedIssue: async () => ({
        number: historicalTask,
        state: 'OPEN',
        stateReason: null as string | null,
        body: 'Mission Control mode: required',
        managedState: {
          state: 'ELIGIBLE_FOR_FOUNDER_REVIEW',
          review_cycle: 1,
          full_review_count: 1,
          active_task_issue: `#${historicalTask}`,
          active_pr: `#${historicalPr}`,
          current_head: historicalHead,
          last_reviewed_head: historicalHead,
          approved_base: historicalBase,
          guide_source_sha: policySourceSha,
          guide_version: '1.3.0',
          latest_review_verdict_comment_id: historicalCommentId,
          campaign_issue: '#215',
          campaign_slice: null as number | null,
        },
      }),
      readPullRequest: async () => ({
        number: historicalPr,
        state: 'MERGED',
        isDraft: false,
        mergeable: 'MERGEABLE',
        headRefOid: historicalHead,
        baseRefName: historicalBase,
        baseRefOid: protectedBaseSha,
        statusCheckRollup: [
          { name: 'ci', conclusion: 'SUCCESS', status: 'COMPLETED' },
          { name: 'starter-ci', conclusion: 'SUCCESS', status: 'COMPLETED' },
        ],
        mergeCommit: { oid: mergeCommit },
        body: 'Refs #254',
      }),
      readFounderAuthorization: async () => {
        operations.push('authorization')
        return {
          schema_version: 1,
          status: 'approved',
          authority: 'Founder',
          author_login: 'boat1994',
          immutable_comment_reference: true,
          comment_sha256: 'a'.repeat(64),
          non_superseded: true,
          superseded_by: null as string | null,
          repository: 'boat1994/bemoat-web-starter',
          bundle_kind: 'merge-completion',
          scope: 'merge',
          task_issue: historicalTask,
          pr: historicalPr,
          exact_head: historicalHead,
          reviewed_head: historicalHead,
          base: historicalBase,
          policy_source_sha: policySourceSha,
          protected_base_sha: protectedBaseSha,
          policy_version: '1.3.0',
          review_verdict_comment_id: historicalCommentId,
          review_verdict: 'ELIGIBLE FOR FOUNDER REVIEW',
          action: 'merge',
          comment_id: '5175340336',
          projection_kind: 'blocker-resolution',
          campaign_issue: 215,
          campaign_blocker_id: 'issue-254-planning-correction-1',
        }
      },
      readReviewVerdict: async () => {
        operations.push(`review-verdict:${historicalCommentId}`)
        return reviewVerdict
      },
      readTrustedFounderLogins: async () => ['boat1994'],
      markReadyForReview: async () => {
        writes.push('mark-ready')
        throw new Error('unexpected write: mark-ready')
      },
      mergePullRequest: async () => {
        writes.push('merge')
        throw new Error('unexpected write: merge')
      },
      verifyCommitOnProtectedBase: async ({ commit, base }: { commit: string, base: string }) => {
        operations.push(`verify-base:${commit}:${base}`)
        return false
      },
      postFinalResult: async () => {
        writes.push('result')
        throw new Error('unexpected write: result')
      },
      closeIssueCompleted: async () => {
        writes.push('close')
        throw new Error('unexpected write: close')
      },
      writeTaskDone: async () => {
        writes.push('task-done')
        throw new Error('unexpected write: task-done')
      },
      projectCampaignBlockerResolved: async () => {
        writes.push('campaign-blocker')
        throw new Error('unexpected write: campaign-blocker')
      },
      selectNextCampaignAction: async () => {
        writes.push('select-next')
        throw new Error('unexpected write: select-next')
      },
    }

    await expect(runFounderAuthorizedMerge({
      issueNumber: historicalTask,
      repo: 'boat1994/bemoat-web-starter',
      authorizationCommentId: '5175340336',
      deps,
    } as any)).rejects.toThrow(/STATE_CONFLICT.*protected base/i)

    expect(operations).toEqual([
      'authorization',
      `review-verdict:${historicalCommentId}`,
      `verify-base:${mergeCommit}:${historicalBase}`,
    ])
    expect(writes).toEqual([])
  })
})
