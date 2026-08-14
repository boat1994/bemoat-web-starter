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
/** Frozen live Issue comment 5162624753 body SHA-256 (UTF-8 bytes, no normalization). */
const liveFixtureSha256 = 'ca3d14b365f768ec1cab6fe339f3f008bbfdb624a82670c6705faf381e20c83f'
const liveFixtureByteLength = 1788
const otherHead = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const thirdHead = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const mergeReviewVerdictFacadePath = resolve(
  process.cwd(),
  'scripts/mission-control/domain/merge-review-verdict.mjs',
)
const mergeReviewVerdictCanonicalPath = resolve(
  process.cwd(),
  'scripts/mission-control/domain/merge-review-verdict.ts',
)

async function mergeTransport() {
  return import('../../scripts/mission-control-merge.mjs')
}

function historicalFixtureBytes() {
  return readFileSync(fixturePath)
}

function historicalFixtureBody() {
  return historicalFixtureBytes().toString('utf8')
}

function canonicalBody(pr = historicalPr, head = historicalHead, base = historicalBase) {
  return `## REVIEW_VERDICT

**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**PR / base / head:** PR #${pr} · \`${base}\` · \`${head}\`
`
}

function canonicalPullBody(pr = historicalPr, head = historicalHead, base = historicalBase) {
  return `## REVIEW_VERDICT

**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/${pr} · \`${base}\` · \`${head}\`
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

function malformedHistoricalPrBody({ malformedFirst = false } = {}) {
  const malformed = '**PR:** PR #999 trailing\n'
  const body = historicalFieldBody({ extra: malformedFirst ? '' : malformed })
  return malformedFirst
    ? body.replace('**PR:** PR #258\n', `${malformed}**PR:** PR #258\n`)
    : body
}

function malformedCanonicalBody({ canonicalFirst = false } = {}) {
  const malformed = '**PR / base / head:** malformed\n'
  const body = historicalFieldBody()
  return canonicalFirst
    ? body.replace('## REVIEW_VERDICT\n\n', `## REVIEW_VERDICT\n\n${malformed}`)
    : `${body}${malformed}`
}

const WRITE_KEYS = [
  'markReadyForReview',
  'mergePullRequest',
  'postFinalResult',
  'closeIssueCompleted',
  'writeTaskDone',
  'projectCampaignBlockerResolved',
  'projectCampaignSliceDone',
  'selectNextCampaignAction',
  'reconcileAfterFailure',
] as const

function createZeroWriteDeps(options: {
  verdictBody: string
  prState?: string
  isDraft?: boolean
  includeReconcile?: boolean
}) {
  const writes: string[] = []
  const operations: string[] = []
  const calls: Record<string, number> = Object.fromEntries(WRITE_KEYS.map((key) => [key, 0]))
  const recordWrite = (key: string) => {
    calls[key] = (calls[key] ?? 0) + 1
    writes.push(key)
    throw new Error(`unexpected write: ${key}`)
  }

  const deps: Record<string, unknown> = {
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
      state: options.prState ?? 'OPEN',
      isDraft: options.isDraft ?? false,
      mergeable: 'MERGEABLE',
      headRefOid: historicalHead,
      baseRefName: historicalBase,
      baseRefOid: protectedBaseSha,
      statusCheckRollup: [
        { name: 'ci', conclusion: 'SUCCESS', status: 'COMPLETED' },
        { name: 'starter-ci', conclusion: 'SUCCESS', status: 'COMPLETED' },
      ],
      mergeCommit: options.prState === 'MERGED' ? { oid: mergeCommit } : null,
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
    readCampaignOwnership: async (ownership: Record<string, any>) => ({
      verified: true,
      evidence_kind: 'campaign-projection',
      projectionKind: ownership.projectionKind,
      campaignIssue: ownership.campaignIssue,
      campaignBlockerId: ownership.campaignBlockerId,
      taskIssue: historicalTask,
      prNumber: historicalPr,
    }),
    readReviewVerdict: async () => {
      operations.push(`review-verdict:${historicalCommentId}`)
      const { parseProductionMergeReviewVerdict } = await mergeTransport()
      // Production dependency path: parse the live body before validation.
      return parseProductionMergeReviewVerdict(options.verdictBody, historicalCommentId)
    },
    readTrustedFounderLogins: async () => ['boat1994'],
    markReadyForReview: async () => recordWrite('markReadyForReview'),
    mergePullRequest: async () => recordWrite('mergePullRequest'),
    verifyCommitOnProtectedBase: async ({ commit, base }: { commit: string, base: string }) => {
      operations.push(`verify-base:${commit}:${base}`)
      return false
    },
    postFinalResult: async () => recordWrite('postFinalResult'),
    closeIssueCompleted: async () => recordWrite('closeIssueCompleted'),
    writeTaskDone: async () => recordWrite('writeTaskDone'),
    projectCampaignBlockerResolved: async () => recordWrite('projectCampaignBlockerResolved'),
    projectCampaignSliceDone: async () => recordWrite('projectCampaignSliceDone'),
    selectNextCampaignAction: async () => recordWrite('selectNextCampaignAction'),
  }

  if (options.includeReconcile !== false) {
    deps.reconcile = async () => recordWrite('reconcileAfterFailure')
  }

  return { deps, writes, operations, calls }
}

describe('production merge REVIEW_VERDICT binding', () => {
  it('byte-faithful fixture matches live comment 5162624753 bytes and SHA-256', () => {
    const bytes = historicalFixtureBytes()
    expect(bytes.byteLength).toBe(liveFixtureByteLength)
    expect(bytes.subarray(-1)[0]).toBe(0x0a)
    expect(bytes.subarray(-2)[0]).not.toBe(0x0a)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(liveFixtureSha256)

    const body = bytes.toString('utf8')
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

  it('preserves canonical **PR / base / head:** binding including PR #N form', async () => {
    const { resolveMergeReviewVerdictBinding } = await mergeTransport()
    expect(resolveMergeReviewVerdictBinding(canonicalPullBody())).toMatchObject({
      pr: String(historicalPr),
      base: historicalBase,
      reviewed_head: historicalHead,
    })
    expect(resolveMergeReviewVerdictBinding(canonicalBody())).toMatchObject({
      pr: String(historicalPr),
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

  it('accepts agreeing cross-source PR/head/base forms when each form is unique', async () => {
    const { resolveMergeReviewVerdictBinding } = await mergeTransport()
    // Contract: one unique occurrence of each permitted source form may agree.
    const body = `${historicalFieldBody()}
Reviewed again at https://github.com/boat1994/bemoat-web-starter/pull/${historicalPr}.
`
    expect(resolveMergeReviewVerdictBinding(body)).toMatchObject({
      pr: String(historicalPr),
      base: historicalBase,
      reviewed_head: historicalHead,
    })

    const agreeingCanonical = `## REVIEW_VERDICT

**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**Approved base:** \`${historicalBase}@${policySourceSha}\`
**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/${historicalPr} · \`${historicalBase}\` · \`${historicalHead}\`
**Exact head reviewed:** \`${historicalHead}\`
`
    expect(resolveMergeReviewVerdictBinding(agreeingCanonical)).toMatchObject({
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
    const reviewVerdict = parseProductionMergeReviewVerdict(
      historicalFieldBody({ head: `\`${otherHead}\`` }),
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

  it('fails closed for conflicting Approved base and canonical base regardless of order', async () => {
    const { resolveMergeReviewVerdictBinding } = await mergeTransport()
    const approvedFirst = `## REVIEW_VERDICT

**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**Approved base:** \`main@${policySourceSha}\`
**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/${historicalPr} · \`dev\` · \`${historicalHead}\`
`
    const canonicalFirst = `## REVIEW_VERDICT

**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/${historicalPr} · \`dev\` · \`${historicalHead}\`
**Approved base:** \`main@${policySourceSha}\`
`
    expect(() => resolveMergeReviewVerdictBinding(approvedFirst)).toThrow(/STATE_CONFLICT.*base/i)
    expect(() => resolveMergeReviewVerdictBinding(canonicalFirst)).toThrow(/STATE_CONFLICT.*base/i)
  })

  it('fails closed for conflicting canonical PR #N and /pull/N in either order', async () => {
    const { resolveMergeReviewVerdictBinding } = await mergeTransport()
    const canonicalThenUrl = `${canonicalBody(258)}
See https://github.com/boat1994/bemoat-web-starter/pull/999
`
    const urlThenCanonical = `## REVIEW_VERDICT

**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
See https://github.com/boat1994/bemoat-web-starter/pull/999
**PR / base / head:** PR #258 · \`${historicalBase}\` · \`${historicalHead}\`
`
    expect(() => resolveMergeReviewVerdictBinding(canonicalThenUrl)).toThrow(/STATE_CONFLICT.*PR/i)
    expect(() => resolveMergeReviewVerdictBinding(urlThenCanonical)).toThrow(/STATE_CONFLICT.*PR/i)
  })

  it('fails closed for conflicting URL and historical PR in either order', async () => {
    const { resolveMergeReviewVerdictBinding } = await mergeTransport()
    const wrongFirst = `## REVIEW_VERDICT

**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
See https://github.com/boat1994/bemoat-web-starter/pull/999
**PR:** PR #258
**Exact reviewed head:** \`${historicalHead}\`
**Approved base:** \`${historicalBase}@${policySourceSha}\`
`
    const correctFirst = `${historicalFieldBody()}
See https://github.com/boat1994/bemoat-web-starter/pull/999
`
    expect(() => resolveMergeReviewVerdictBinding(wrongFirst)).toThrow(/STATE_CONFLICT.*PR/i)
    expect(() => resolveMergeReviewVerdictBinding(correctFirst)).toThrow(/STATE_CONFLICT.*PR/i)
  })

  it('fails closed for conflicting canonical and historical heads in either order', async () => {
    const { resolveMergeReviewVerdictBinding } = await mergeTransport()
    const wrongFirst = `## REVIEW_VERDICT

**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**Exact reviewed head:** \`${otherHead}\`
**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/${historicalPr} · \`${historicalBase}\` · \`${historicalHead}\`
`
    const correctFirst = `## REVIEW_VERDICT

**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/${historicalPr} · \`${historicalBase}\` · \`${historicalHead}\`
**Exact reviewed head:** \`${otherHead}\`
`
    expect(() => resolveMergeReviewVerdictBinding(wrongFirst)).toThrow(/STATE_CONFLICT.*exact reviewed head/i)
    expect(() => resolveMergeReviewVerdictBinding(correctFirst)).toThrow(/STATE_CONFLICT.*exact reviewed head/i)
  })

  it('fails closed for duplicate identical historical PR and head fields', async () => {
    const { resolveMergeReviewVerdictBinding } = await mergeTransport()
    const duplicatePr = `${historicalFieldBody()}\n**PR:** PR #258\n`
    expect(() => resolveMergeReviewVerdictBinding(duplicatePr)).toThrow(/STATE_CONFLICT.*PR/i)

    const duplicateHead = `${historicalFieldBody()}\n**Exact reviewed head:** \`${historicalHead}\`\n`
    expect(() => resolveMergeReviewVerdictBinding(duplicateHead)).toThrow(/STATE_CONFLICT.*Exact reviewed head/i)
  })

  it('fails closed for duplicate canonical lines even when values agree', async () => {
    const { resolveMergeReviewVerdictBinding } = await mergeTransport()
    const duplicateCanonical = `${canonicalPullBody()}${canonicalPullBody()}`
    expect(() => resolveMergeReviewVerdictBinding(duplicateCanonical)).toThrow(/STATE_CONFLICT/i)
  })

  it('fails closed for repeated identical pull URL evidence', async () => {
    const { resolveMergeReviewVerdictBinding } = await mergeTransport()
    const repeatedUrl = `${historicalFieldBody()}
See https://github.com/boat1994/bemoat-web-starter/pull/${historicalPr}
See https://github.com/boat1994/bemoat-web-starter/pull/${historicalPr}
`
    expect(() => resolveMergeReviewVerdictBinding(repeatedUrl)).toThrow(/STATE_CONFLICT.*PR/i)
  })

  it('fails closed for existing Exact head reviewed vs Exact reviewed head conflicts', async () => {
    const { resolveMergeReviewVerdictBinding } = await mergeTransport()
    const conflicting = historicalFieldBody({
      extra: `**Exact head reviewed:** \`${thirdHead}\`\n`,
    })
    expect(() => resolveMergeReviewVerdictBinding(conflicting)).toThrow(/STATE_CONFLICT.*exact reviewed head/i)
  })

  it('fails closed for multiline, short-SHA, and partial historical bindings', async () => {
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

    const prOnly = `## REVIEW_VERDICT

**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**PR:** PR #258
**Approved base:** \`main@${policySourceSha}\`
`
    expect(() => resolveMergeReviewVerdictBinding(prOnly)).toThrow(/STATE_CONFLICT.*partial/i)

    const headOnly = `## REVIEW_VERDICT

**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**Exact reviewed head:** \`${historicalHead}\`
**Approved base:** \`main@${policySourceSha}\`
`
    expect(() => resolveMergeReviewVerdictBinding(headOnly)).toThrow(/STATE_CONFLICT.*partial/i)
  })

  it('does not treat incidental PR #258 prose as authority', async () => {
    const { resolveMergeReviewVerdictBinding } = await mergeTransport()
    const body = `## REVIEW_VERDICT

**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**Exact head reviewed:** \`${historicalHead}\`
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
    const { runFounderAuthorizedMerge } = await mergeTransport()
    const { deps, writes, operations } = createZeroWriteDeps({
      verdictBody: historicalFixtureBody(),
      prState: 'MERGED',
      // Already-merged recovery reaches verify-base after mutationStarted; omit
      // reconcile so this probe stays focused on pre-RESULT write absence.
      includeReconcile: false,
    })

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

describe('production-entrypoint zero-write fail-closed matrix', () => {
  const cases: Array<{ name: string, body: string }> = [
    {
      name: 'conflicting canonical PR #N and URL PR',
      body: `${canonicalBody(258)}\nSee https://github.com/boat1994/bemoat-web-starter/pull/999\n`,
    },
    {
      name: 'conflicting URL and historical PR',
      body: `${historicalFieldBody()}\nSee https://github.com/boat1994/bemoat-web-starter/pull/999\n`,
    },
    {
      name: 'conflicting canonical and historical head',
      body: `## REVIEW_VERDICT

**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/${historicalPr} · \`${historicalBase}\` · \`${historicalHead}\`
**Exact reviewed head:** \`${otherHead}\`
`,
    },
    {
      name: 'duplicate identical historical PR',
      body: `${historicalFieldBody()}\n**PR:** PR #258\n`,
    },
    {
      name: 'malformed trailing-token historical PR after valid binding (MC-R1-001/003)',
      body: malformedHistoricalPrBody(),
    },
    {
      name: 'malformed trailing-token historical PR before valid binding (MC-R1-001/003)',
      body: malformedHistoricalPrBody({ malformedFirst: true }),
    },
    {
      name: 'malformed canonical PR/base/head after valid historical binding (MC-R1-001/003)',
      body: malformedCanonicalBody(),
    },
    {
      name: 'malformed canonical PR/base/head before valid historical binding (MC-R1-001/003)',
      body: malformedCanonicalBody({ canonicalFirst: true }),
    },
    {
      name: 'malformed historical PR plus valid pull URL',
      body: `## REVIEW_VERDICT

**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**PR:** PR #999 trailing
**Exact reviewed head:** \`${historicalHead}\`
**Approved base:** \`${historicalBase}@${policySourceSha}\`
See https://github.com/boat1994/bemoat-web-starter/pull/${historicalPr}
`,
    },
    {
      name: 'valid head plus malformed repeated head',
      body: historicalFieldBody({
        extra: `**Exact reviewed head:** \`${historicalHead}\` trailing
`,
      }),
    },
    {
      name: 'valid canonical binding plus malformed legacy field',
      body: `${canonicalPullBody()}**PR:** PR #999 trailing
`,
    },
    {
      name: 'duplicate recognized label with blank value',
      body: `${historicalFieldBody()}**PR:**
`,
    },
    {
      name: 'duplicate recognized label with multiline continuation',
      body: `${historicalFieldBody()}**Exact reviewed head:**
${historicalHead}
`,
    },
    {
      name: 'malformed-first / valid-second recognized PR fields',
      body: `## REVIEW_VERDICT

**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**PR:** PR #999 trailing
**PR:** PR #258
**Exact reviewed head:** \`${historicalHead}\`
**Approved base:** \`${historicalBase}@${policySourceSha}\`
`,
    },
    {
      name: 'valid-first / malformed-second recognized PR fields',
      body: `## REVIEW_VERDICT

**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**PR:** PR #258
**PR:** PR #999 trailing
**Exact reviewed head:** \`${historicalHead}\`
**Approved base:** \`${historicalBase}@${policySourceSha}\`
`,
    },
    {
      name: 'near-valid recognized PR syntax is not prose',
      body: `## REVIEW_VERDICT

**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**PR:** PR #258 trailing
**Exact reviewed head:** \`${historicalHead}\`
**Approved base:** \`${historicalBase}@${policySourceSha}\`
`,
    },
    {
      name: 'exact omitted case: malformed historical then malformed canonical',
      body: historicalFieldBody({
        extra: `**PR:** PR #999 trailing
**PR / base / head:** malformed
`,
      }),
    },
    {
      name: 'exact omitted case: malformed canonical then malformed historical',
      body: `${malformedCanonicalBody({ canonicalFirst: true })}**PR:** PR #999 trailing
`,
    },
    {
      name: 'repeated identical pull URL evidence',
      body: `${historicalFieldBody()}
See https://github.com/boat1994/bemoat-web-starter/pull/${historicalPr}
See https://github.com/boat1994/bemoat-web-starter/pull/${historicalPr}
`,
    },
    {
      name: 'duplicate identical historical head',
      body: `${historicalFieldBody()}\n**Exact reviewed head:** \`${historicalHead}\`\n`,
    },
    {
      name: 'partial historical binding (PR without head)',
      body: `## REVIEW_VERDICT

**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**PR:** PR #258
**Approved base:** \`main@${policySourceSha}\`
`,
    },
    {
      name: 'multiline Exact reviewed head',
      body: `## REVIEW_VERDICT

**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**PR:** PR #258
**Exact reviewed head:**
\`${historicalHead}\`
**Approved base:** \`main@${policySourceSha}\`
`,
    },
    {
      name: 'short SHA Exact reviewed head',
      body: historicalFieldBody({ head: '`31afbb8`' }),
    },
    {
      name: 'incidental prose only',
      body: `## REVIEW_VERDICT

**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**Approved base:** \`main@${policySourceSha}\`

Incidental prose mentions PR #258 and head ${historicalHead} without recognized fields.
`,
    },
    {
      name: 'wrong-first URL then correct historical PR',
      body: `## REVIEW_VERDICT

**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
See https://github.com/boat1994/bemoat-web-starter/pull/999
**PR:** PR #258
**Exact reviewed head:** \`${historicalHead}\`
**Approved base:** \`${historicalBase}@${policySourceSha}\`
`,
    },
    {
      name: 'correct-first historical PR then wrong URL',
      body: `${historicalFieldBody()}
See https://github.com/boat1994/bemoat-web-starter/pull/999
`,
    },
    {
      name: 'conflicting Approved base and canonical base',
      body: `## REVIEW_VERDICT

**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**Approved base:** \`main@${policySourceSha}\`
**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/${historicalPr} · \`dev\` · \`${historicalHead}\`
`,
    },
  ]

  it.each(cases)('$name stops before mutation with zero writes', async ({ body }) => {
    const { runFounderAuthorizedMerge } = await mergeTransport()
    const { deps, writes, operations, calls } = createZeroWriteDeps({ verdictBody: body })

    await expect(runFounderAuthorizedMerge({
      issueNumber: historicalTask,
      repo: 'boat1994/bemoat-web-starter',
      authorizationCommentId: '5175340336',
      deps,
    } as any)).rejects.toThrow(/STATE_CONFLICT/)

    expect(operations).toEqual([
      'authorization',
      `review-verdict:${historicalCommentId}`,
    ])
    expect(writes).toEqual([])
    for (const key of WRITE_KEYS) {
      expect(calls[key], `${key} should remain unused`).toBe(0)
      expect(writes).not.toContain(key)
    }
  })
})

describe('merge REVIEW_VERDICT TypeScript boundary', () => {
  it('keeps the .mjs facade exact and preserves direct merge-consumer export identity', async () => {
    const facade = await import('../../scripts/mission-control/domain/merge-review-verdict.mjs')
    const canonical = await import('../../scripts/mission-control/domain/merge-review-verdict.ts')
    const merge = await mergeTransport()
    const names = [
      'classifyMergeReviewVerdict',
      'parseProductionMergeReviewVerdict',
      'resolveMergeReviewVerdictBinding',
    ] as const

    expect(readFileSync(mergeReviewVerdictFacadePath, 'utf8')).toBe(
      "export * from './merge-review-verdict.ts'\n",
    )
    const canonicalSource = readFileSync(mergeReviewVerdictCanonicalPath, 'utf8')
    expect(canonicalSource).toContain('z.unknown().parse(body)')
    expect(canonicalSource).toContain('z.unknown().parse(commentId)')
    expect(canonicalSource).not.toMatch(/z\.(string|coerce|object|record|array|union)/)
    expect(Object.keys(facade).sort()).toEqual([...names].sort())
    expect(Object.keys(canonical).sort()).toEqual([...names].sort())
    for (const name of names) {
      expect(facade[name]).toBe(canonical[name])
    }
    expect(merge.parseProductionMergeReviewVerdict).toBe(facade.parseProductionMergeReviewVerdict)
    expect(merge.resolveMergeReviewVerdictBinding).toBe(facade.resolveMergeReviewVerdictBinding)
  })

  it('keeps the raw unknown admission boundary and native coercion or throwing semantics', async () => {
    const canonical = await import('../../scripts/mission-control/domain/merge-review-verdict.ts')
    const body = {
      toString: () => historicalFieldBody(),
    }
    const commentId = {
      toString: () => historicalCommentId,
    }

    expect(canonical.resolveMergeReviewVerdictBinding(body)).toMatchObject({
      pr: String(historicalPr),
      base: historicalBase,
      reviewed_head: historicalHead,
    })
    expect(canonical.parseProductionMergeReviewVerdict(body, commentId)).toMatchObject({
      comment_id: historicalCommentId,
      pr: String(historicalPr),
    })

    const bodyError = new Error('body toString failed')
    expect(() => canonical.resolveMergeReviewVerdictBinding({
      toString: () => { throw bodyError },
    })).toThrow(bodyError)

    const commentIdError = new Error('comment ID toString failed')
    expect(() => canonical.parseProductionMergeReviewVerdict(
      historicalFieldBody(),
      { toString: () => { throw commentIdError } },
    )).toThrow(commentIdError)
  })

  it('preserves first case-sensitive Verdict extraction and duplicate-line tolerance', async () => {
    const { resolveMergeReviewVerdictBinding } = await import(
      '../../scripts/mission-control/domain/merge-review-verdict.ts',
    )
    const body = `**verdict:** ignored\n**Verdict:** FIRST\n**Verdict:** SECOND\n`

    expect(resolveMergeReviewVerdictBinding(body).verdict).toBe('FIRST')
  })

  it('preserves exact-head label case insensitivity, SHA lowercasing, base source stripping, and URL lexical rules', async () => {
    const { resolveMergeReviewVerdictBinding } = await import(
      '../../scripts/mission-control/domain/merge-review-verdict.ts',
    )
    const upperHead = historicalHead.toUpperCase()
    const body = `**PR:** PR #${historicalPr}\n**eXaCt ReViEwEd HeAd:** \`${upperHead}\`\n**Approved base:** \`${historicalBase}@${policySourceSha}\`\n`

    expect(resolveMergeReviewVerdictBinding(body)).toMatchObject({
      pr: String(historicalPr),
      base: historicalBase,
      reviewed_head: historicalHead,
    })

    expect(resolveMergeReviewVerdictBinding(
      `**PR / base / head:** https://unvalidated.example/anything/pull/${historicalPr} · \`${historicalBase}\` · \`${upperHead}\`\n`,
    )).toMatchObject({
      pr: String(historicalPr),
      base: historicalBase,
      reviewed_head: historicalHead,
    })
    expect(() => resolveMergeReviewVerdictBinding(
      `**PR / base / head:** https://unvalidated.example/pull/${historicalPr}/extra · \`${historicalBase}\` · \`${historicalHead}\`\n`,
    )).toThrow(
      'STATE_CONFLICT: REVIEW_VERDICT canonical PR / base / head field is malformed, partial, or ambiguous',
    )
  })

  it('preserves broad non-superseded markers, strict classification, and invalid-PR normalization', async () => {
    const canonical = await import('../../scripts/mission-control/domain/merge-review-verdict.ts')
    expect(canonical.resolveMergeReviewVerdictBinding('SUPERSEDED')).toMatchObject({ non_superseded: false })
    expect(canonical.resolveMergeReviewVerdictBinding('Not Authoritative')).toMatchObject({ non_superseded: false })

    const expected = {
      commentId: historicalCommentId,
      exactHead: historicalHead,
      pr: 'not-a-pr',
      base: historicalBase,
    }
    const reviewVerdict: {
      comment_id: string
      verdict: string
      pr: string | null
      base: string
      reviewed_head: string
      non_superseded: boolean
    } = {
      comment_id: historicalCommentId,
      verdict: 'ELIGIBLE FOR FOUNDER REVIEW',
      pr: null,
      base: historicalBase,
      reviewed_head: historicalHead,
      non_superseded: true,
    }
    expect(canonical.classifyMergeReviewVerdict({ reviewVerdict, expected })).toEqual({
      valid: true,
      reason: null,
    })
    expect(canonical.classifyMergeReviewVerdict({
      reviewVerdict: { ...reviewVerdict, verdict: 'ELIGIBLE FOR FOUNDER REVIEW ' },
      expected,
    })).toEqual({
      valid: false,
      reason: 'latest review verdict is changed, superseded, or does not bind the exact PR, base, and reviewed head',
    })
  })
})
