/* eslint-disable @typescript-eslint/no-explicit-any -- untyped runtime .mjs boundary */
import { generateKeyPairSync, createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  UGR_CONTRACT,
  UGR_MARKER_START,
  collectVerifiedRecords,
  createFounderUnmanagedGenesisAuthorizationBody,
  evaluateUnmanagedGenesisMergeEligibility,
  parseFounderUnmanagedGenesisAuthorization,
  parseHistoricalReviewOccurrence,
  parseUnmanagedGenesisReviewComment,
  signUnmanagedGenesisReviewRecord,
  buildUnmanagedGenesisReviewRecord,
  verifyUnmanagedGenesisReviewRecord,
} from '../../scripts/mission-control/domain/unmanaged-genesis-review.mjs'
import { createUnmanagedGenesisReviewService } from '../../scripts/mission-control/workflows/unmanaged-genesis-review.mjs'
import { sha256Hex } from '../../scripts/mission-control/domain/task-attestation.mjs'

const REPO = UGR_CONTRACT.repository
const OLD_HEAD = UGR_CONTRACT.historicalFullReviewedHead as string
const NEW_HEAD = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const MAIN_SHA = UGR_CONTRACT.protectedBaseSha as string

function keyMaterial() {
  const pair = generateKeyPairSync('ed25519')
  return {
    privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  }
}

function loadHistoricalOccurrence(): any {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), 'tests/fixtures/mission-control/issue-262-review-occurrence-5167077714.json'), 'utf8'),
  )
}

function createWorld({
  head = OLD_HEAD,
  issueBody = 'Issue #262 remains unmanaged.\n',
  extraComments = [] as any[],
  authOverrides = {} as Record<string, any>,
  evidenceClass = 'full',
  diffText = 'diff --git a/x b/x\n+correction\n',
  keys = keyMaterial(),
}: {
  head?: string
  issueBody?: string
  extraComments?: any[]
  authOverrides?: Record<string, any>
  evidenceClass?: string
  diffText?: string
  keys?: { privateKey: string, publicKey: string }
} = {}) {
  const historical = loadHistoricalOccurrence()
  const authBody = createFounderUnmanagedGenesisAuthorizationBody({
    evidenceClass,
    reviewedHead: head,
    sourceReviewCommentId: historical.id,
    correctionBase: evidenceClass === 'delta' ? OLD_HEAD : null,
    correctionHead: evidenceClass === 'delta' ? head : null,
    correctionCommitOids: evidenceClass === 'delta' ? [NEW_HEAD] : null,
    correctionDiffSha256: evidenceClass === 'delta' ? sha256Hex(diffText) : null,
    correctionResultCommentId: evidenceClass === 'delta' ? 9002 : null,
    findingDisposition: evidenceClass === 'delta' ? [] : null,
    priorFullRecordCommentId: evidenceClass === 'delta' ? 8001 : null,
    priorFullRecordId: evidenceClass === 'delta' ? 'mc-ugr-v1-placeholder' : null,
    ...authOverrides,
  } as any)

  const comments: any[] = [
    {
      id: Number(historical.id),
      node_id: historical.node_id,
      body: historical.body,
      user: historical.user,
      author: historical.user,
      issue_number: 262,
      created_at: historical.created_at,
      updated_at: historical.updated_at,
      performed_via_github_app: historical.performed_via_github_app,
    },
    {
      id: 9001,
      body: authBody,
      user: { login: 'boat1994' },
      author: { login: 'boat1994' },
      issue_number: 262,
      created_at: '2026-08-03T21:00:00Z',
      updated_at: '2026-08-03T21:00:00Z',
      performed_via_github_app: null,
    },
    ...extraComments,
  ]

  const issue = {
    number: 262,
    id: 'I_kwDOParent262',
    node_id: 'MDU6SXNzdWUyNjI',
    url: `https://github.com/${REPO}/issues/262`,
    state: 'OPEN',
    title: 'unmanaged genesis parent',
    body: issueBody,
  }

  const pullRequest = {
    number: 266,
    id: 'PR_kwDO266',
    node_id: 'PR_kwDO266',
    url: `https://github.com/${REPO}/pull/266`,
    state: 'OPEN',
    isDraft: true,
    baseRefName: 'main',
    baseRefOid: MAIN_SHA,
    headRefName: 'feature/262-task-bootstrap',
    headRefOid: head,
    statusCheckRollup: [
      { name: 'ci', conclusion: 'SUCCESS', id: 1 },
      { name: 'starter-ci', conclusion: 'SUCCESS', id: 2 },
    ],
    commits: [{ oid: head, messageHeadline: 'feat' }],
  }

  const calls = { postComment: 0, updateIssueBody: 0 }
  let nextCommentId = Math.max(10000, ...comments.map((comment) => Number(comment.id) || 0)) + 1

  const github = {
    async getRepository() {
      return { nameWithOwner: REPO, id: 'R_repo', node_id: 'R_node', defaultBranch: 'main' }
    },
    async getIssue(number: number) {
      if (number !== 262) throw Object.assign(new Error('wrong issue'), { code: 'STATE_CONFLICT' })
      return { ...issue }
    },
    async getIssueComments(number: number) {
      if (number !== 262) throw Object.assign(new Error('wrong issue'), { code: 'STATE_CONFLICT' })
      return [...comments]
    },
    async getIssueComment(commentId: number) {
      const found = comments.find((comment) => Number(comment.id) === Number(commentId))
      if (!found) throw Object.assign(new Error('not found'), { code: 'NOT_FOUND' })
      return { ...found }
    },
    async getPullRequest(number: number) {
      if (number !== 266) throw Object.assign(new Error('wrong pr'), { code: 'STATE_CONFLICT' })
      return { ...pullRequest }
    },
    async getPullRequestDiff(number: number) {
      if (number !== 266) throw Object.assign(new Error('wrong pr'), { code: 'STATE_CONFLICT' })
      return diffText
    },
    async postIssueComment(number: number, body: string) {
      if (number !== 262) throw Object.assign(new Error('wrong issue'), { code: 'STATE_CONFLICT' })
      calls.postComment += 1
      const comment = {
        id: nextCommentId++,
        body,
        user: { login: 'bemoat-mc-app' },
        author: { login: 'bemoat-mc-app' },
        issue_number: 262,
        created_at: '2026-08-03T22:00:00Z',
        updated_at: '2026-08-03T22:00:00Z',
        performed_via_github_app: { slug: 'bemoat-mc' },
      }
      comments.push(comment)
      return { ...comment }
    },
    async updateIssueBody() {
      calls.updateIssueBody += 1
      throw Object.assign(new Error('unmanaged-genesis review transport must never write Issue bodies'), { code: 'STATE_CONFLICT' })
    },
  }

  const service = createUnmanagedGenesisReviewService({
    github,
    repository: REPO,
    publicKey: keys.publicKey,
    signingPrivateKey: keys.privateKey,
    signingKeyId: 'ugr-test-key',
    workflow: { file: 'scripts/mission-control-unmanaged-genesis-review.mjs', ref: 'refs/heads/main', sha: MAIN_SHA, runId: '1' },
    env: { BEMOAT_FOUNDER_LOGINS: 'boat1994' } as unknown as NodeJS.ProcessEnv,
  } as any)

  return { keys, github, service, comments, issue, pullRequest, calls, authBody, historical, diffText }
}

describe('unmanaged-genesis review occurrence fixture', () => {
  it('reproduces comment 5167077714 as evidence-only, never merge authority', () => {
    const historical = loadHistoricalOccurrence()
    expect(historical.id).toBe(5167077714)
    expect(historical.user.login).toBe('boat1994')
    expect(historical.performed_via_github_app).toBeNull()
    expect(historical.body).toContain('## REVIEW_VERDICT')
    expect(historical.body).toContain(OLD_HEAD)
    expect(historical.body).not.toContain(UGR_MARKER_START)

    const parsed = parseHistoricalReviewOccurrence(historical.body)
    expect(parsed.verdict).toBe('ELIGIBLE FOR FOUNDER REVIEW')
    expect(parsed.pullRequest).toBe(266)
    expect(parsed.evidenceOnly).toBe(true)
    expect(parsed.hasSignedRecord).toBe(false)

    const eligibility = evaluateUnmanagedGenesisMergeEligibility({
      records: [],
      livePullRequestHead: OLD_HEAD,
    } as any)
    expect(eligibility.eligible).toBe(false)
    expect(eligibility.reason).toMatch(/no valid signed Full root/i)
  })

  it('keeps the committed public key verification-only', () => {
    const publicKey = readFileSync(UGR_CONTRACT.publicKeyPath, 'utf8')
    const cli = readFileSync('scripts/mission-control-unmanaged-genesis-review.mjs', 'utf8')
    expect(publicKey).toContain('BEGIN PUBLIC KEY')
    expect(publicKey).not.toContain('PRIVATE KEY')
    expect(cli).toContain('--founder-authorization-comment-id')
    expect(cli).not.toContain('console.log(process.env.BEMOAT_UNMANAGED_GENESIS_REVIEW_SIGNING_PRIVATE_KEY')
  })
})

describe('unmanaged-genesis Full/Delta transport', () => {
  it('records a trusted Full root from historical evidence and still denies merge eligibility alone', async () => {
    const world = createWorld({ evidenceClass: 'full', head: OLD_HEAD })
    const result = await world.service.recordReview({ founderAuthorizationCommentId: 9001 })
    expect(result.outcome).toBe('RECORDED')
    expect(result.evidenceClass).toBe('full')
    expect(result.issueBodyWrites).toBe(0)
    expect(world.calls.postComment).toBe(1)
    expect(world.calls.updateIssueBody).toBe(0)
    expect(result.mergeEligibility.eligible).toBe(false)
    expect(result.mergeEligibility.reason).toMatch(/Full evidence alone cannot authorize/i)

    const posted = world.comments.at(-1)
    const parsed = parseUnmanagedGenesisReviewComment(posted.body)
    expect(parsed.ok).toBe(true)
    expect(verifyUnmanagedGenesisReviewRecord(parsed.record, {
      publicKey: world.keys.publicKey,
      signingKeyId: 'ugr-test-key',
    } as any).ok).toBe(true)
    expect(world.issue.body).not.toMatch(/review_cycle|full_review_count|bemoat-mission-control-state/)
  })

  it('returns NO_OP on identical retry without duplicate comment', async () => {
    const world = createWorld({ evidenceClass: 'full', head: OLD_HEAD })
    const first = await world.service.recordReview({ founderAuthorizationCommentId: 9001 })
    const second = await world.service.recordReview({ founderAuthorizationCommentId: 9001 })
    expect(first.outcome).toBe('RECORDED')
    expect(second.outcome).toBe('NO_OP')
    expect(second.recordId).toBe(first.recordId)
    expect(world.calls.postComment).toBe(1)
  })

  it('rejects unsigned/direct comments, copied records, and Issue-body edits as authority', async () => {
    const world = createWorld({ evidenceClass: 'full', head: OLD_HEAD })
    await world.service.recordReview({ founderAuthorizationCommentId: 9001 })
    const signed = world.comments.at(-1)

    // Raw historical comment alone
    expect(evaluateUnmanagedGenesisMergeEligibility({
      records: [],
      livePullRequestHead: OLD_HEAD,
    } as any).eligible).toBe(false)

    // Copied record body without valid signature against committed key
    const copied = {
      ...parseUnmanagedGenesisReviewComment(signed.body).record,
      signing: {
        algorithm: 'Ed25519',
        key_id: 'ugr-test-key',
        signature: Buffer.from('forged').toString('base64'),
      },
    }
    expect(verifyUnmanagedGenesisReviewRecord(copied, {
      publicKey: world.keys.publicKey,
      signingKeyId: 'ugr-test-key',
    } as any).ok).toBe(false)

    // Manual Issue-body edit cannot create counters/authority
    const mutated = createWorld({
      evidenceClass: 'full',
      head: OLD_HEAD,
      issueBody: '<!-- bemoat-mission-control-state:start -->\n```yaml\nreview_cycle: 1\nfull_review_count: 1\n```\n<!-- bemoat-mission-control-state:end -->\n',
    })
    await expect(mutated.service.recordReview({ founderAuthorizationCommentId: 9001 }))
      .rejects.toMatchObject({ code: 'STATE_CONFLICT' })
  })

  it('rejects malformed Founder authorization', async () => {
    const world = createWorld({ evidenceClass: 'full', head: OLD_HEAD })
    world.comments[1].body = JSON.stringify({ status: 'approved', evidence_class: 'full' })
    await expect(world.service.recordReview({ founderAuthorizationCommentId: 9001 }))
      .rejects.toMatchObject({ code: 'STATE_CONFLICT' })
  })

  it('composes valid Full + exact-current-head Delta into ELIGIBLE FOR FOUNDER REVIEW', async () => {
    const keys = keyMaterial()
    const fullWorld = createWorld({ evidenceClass: 'full', head: OLD_HEAD, keys })
    const fullResult = await fullWorld.service.recordReview({ founderAuthorizationCommentId: 9001 })
    expect(fullResult.outcome).toBe('RECORDED')

    const fullComment = fullWorld.comments.at(-1)
    const fullRecord = parseUnmanagedGenesisReviewComment(fullComment.body).record
    const diffText = 'diff --git a/scripts/x.mjs b/scripts/x.mjs\n+delta\n'

    const deltaWorld = createWorld({
      evidenceClass: 'delta',
      head: NEW_HEAD,
      diffText,
      keys,
      extraComments: [fullComment],
      authOverrides: {
        priorFullRecordCommentId: fullComment.id,
        priorFullRecordId: fullRecord.record_id,
        correctionBase: OLD_HEAD,
        correctionHead: NEW_HEAD,
        correctionCommitOids: [NEW_HEAD],
        correctionDiffSha256: sha256Hex(diffText),
        correctionResultCommentId: 9002,
        findingDisposition: [],
        sourceReviewCommentId: fullWorld.historical.id,
      },
    })
    const deltaResult = await deltaWorld.service.recordReview({ founderAuthorizationCommentId: 9001 })
    expect(deltaResult.outcome).toBe('RECORDED')
    expect(deltaResult.evidenceClass).toBe('delta')
    expect(deltaResult.mergeEligibility.eligible).toBe(true)
    expect(deltaResult.mergeEligibility.next).toBe('ELIGIBLE FOR FOUNDER REVIEW')
  })

  it('fails closed on post-Delta head drift', async () => {
    const keys = keyMaterial()
    const fullWorld = createWorld({ evidenceClass: 'full', head: OLD_HEAD, keys })
    await fullWorld.service.recordReview({ founderAuthorizationCommentId: 9001 })
    const fullComment = fullWorld.comments.at(-1)
    const fullRecord = parseUnmanagedGenesisReviewComment(fullComment.body).record
    const diffText = 'diff --git a/a b/a\n+1\n'

    const deltaWorld = createWorld({
      evidenceClass: 'delta',
      head: NEW_HEAD,
      diffText,
      keys,
      extraComments: [fullComment],
      authOverrides: {
        priorFullRecordCommentId: fullComment.id,
        priorFullRecordId: fullRecord.record_id,
        correctionBase: OLD_HEAD,
        correctionHead: NEW_HEAD,
        correctionCommitOids: [NEW_HEAD],
        correctionDiffSha256: sha256Hex(diffText),
        findingDisposition: [],
      },
    })
    const deltaResult = await deltaWorld.service.recordReview({ founderAuthorizationCommentId: 9001 })
    expect(deltaResult.mergeEligibility.eligible).toBe(true)

    const drifted = evaluateUnmanagedGenesisMergeEligibility({
      records: collectVerifiedRecords(deltaWorld.comments, {
        publicKey: keys.publicKey,
        signingKeyId: 'ugr-test-key',
      } as any),
      livePullRequestHead: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    } as any)
    expect(drifted.eligible).toBe(false)
    expect(drifted.reason).toMatch(/head drift/i)
  })

  it('returns STATE CONFLICT for competing Full roots', async () => {
    const keys = keyMaterial()
    const base = buildUnmanagedGenesisReviewRecord({
      evidenceClass: 'full',
      repository: { nameWithOwner: REPO, id: 'R', node_id: 'R' },
      taskIssue: { number: 262, id: 'I', node_id: 'I' },
      pullRequest: { number: 266, id: 'P', node_id: 'P', baseRefName: 'main', baseRefOid: MAIN_SHA },
      founderAuthorization: { commentId: 1, bodySha256: 'a'.repeat(64), authorLogin: 'boat1994' },
      sourceReview: { commentId: 5167077714, bodySha256: 'b'.repeat(64), authorLogin: 'boat1994', verdict: 'ELIGIBLE FOR FOUNDER REVIEW' },
      reviewedHead: OLD_HEAD,
      exactHeadCi: { head: OLD_HEAD, checks: [{ name: 'ci', conclusion: 'SUCCESS' }] },
      findings: [],
      full: { reviewed_old_head: OLD_HEAD, findings_sha256: createHash('sha256').update('[]').digest('hex') },
      workflow: { file: 'x', ref: 'refs/heads/main', sha: MAIN_SHA, runId: '1' },
      signingKeyId: 'k',
    } as any)
    const first = signUnmanagedGenesisReviewRecord({
      ...base,
      founder_authorization: { ...base.founder_authorization, comment_id: 1 },
    }, { privateKey: keys.privateKey, keyId: 'k' })
    const second = signUnmanagedGenesisReviewRecord({
      ...base,
      founder_authorization: { ...base.founder_authorization, comment_id: 2, comment_body_sha256: 'c'.repeat(64) },
      findings: [{ id: 'f1', severity: 'Important', summary: 'x' }],
      full: { reviewed_old_head: OLD_HEAD, findings_sha256: createHash('sha256').update('f').digest('hex') },
    }, { privateKey: keys.privateKey, keyId: 'k' })
    expect(first.record_id).not.toBe(second.record_id)

    const eligibility = evaluateUnmanagedGenesisMergeEligibility({
      records: [
        { verified: true, record: first, commentId: 10 },
        { verified: true, record: second, commentId: 11 },
      ],
      livePullRequestHead: NEW_HEAD,
    } as any)
    expect(eligibility.eligible).toBe(false)
    expect(eligibility.classification).toBe('STATE_CONFLICT')
  })

  it('links CORRECTION REQUIRED → later Delta through predecessor fields without Issue counters', async () => {
    const keys = keyMaterial()
    const fullWorld = createWorld({ evidenceClass: 'full', head: OLD_HEAD, keys })
    await fullWorld.service.recordReview({ founderAuthorizationCommentId: 9001 })
    const fullComment = fullWorld.comments.at(-1)
    const fullRecord = parseUnmanagedGenesisReviewComment(fullComment.body).record
    const diff1 = 'diff --git a/a b/a\n+fix1\n'
    const head1 = 'cccccccccccccccccccccccccccccccccccccccc'

    const correctionDelta = createWorld({
      evidenceClass: 'delta',
      head: head1,
      diffText: diff1,
      keys,
      extraComments: [fullComment],
      authOverrides: {
        priorFullRecordCommentId: fullComment.id,
        priorFullRecordId: fullRecord.record_id,
        correctionBase: OLD_HEAD,
        correctionHead: head1,
        correctionCommitOids: [head1],
        correctionDiffSha256: sha256Hex(diff1),
        findingDisposition: [{ finding_id: 'F1', status: 'UNRESOLVED', summary: 'needs fix' }],
        sourceReviewCommentId: fullWorld.historical.id,
      },
    })
    const firstDelta = await correctionDelta.service.recordReview({ founderAuthorizationCommentId: 9001 })
    expect(firstDelta.outcome).toBe('RECORDED')
    expect(firstDelta.mergeEligibility.eligible).toBe(false)
    const firstDeltaComment = correctionDelta.comments.at(-1)
    const firstDeltaRecord = parseUnmanagedGenesisReviewComment(firstDeltaComment.body).record
    expect(firstDeltaRecord.delta.prior_full_record_id).toBe(fullRecord.record_id)
    expect(firstDeltaRecord.delta.finding_disposition[0].finding_id).toBe('F1')

    const head2 = 'dddddddddddddddddddddddddddddddddddddddd'
    const diff2 = 'diff --git a/a b/a\n+fix2\n'
    const secondDeltaWorld = createWorld({
      evidenceClass: 'delta',
      head: head2,
      diffText: diff2,
      keys,
      extraComments: [fullComment, firstDeltaComment],
      authOverrides: {
        priorFullRecordCommentId: fullComment.id,
        priorFullRecordId: fullRecord.record_id,
        predecessorDeltaRecordId: firstDeltaRecord.record_id,
        correctionOfRecordId: firstDeltaRecord.record_id,
        correctionBase: head1,
        correctionHead: head2,
        correctionCommitOids: [head2],
        correctionDiffSha256: sha256Hex(diff2),
        findingDisposition: [{ finding_id: 'F1', status: 'RESOLVED', summary: 'fixed' }],
      },
    })
    const second = await secondDeltaWorld.service.recordReview({ founderAuthorizationCommentId: 9001 })
    expect(second.outcome).toBe('RECORDED')
    const secondRecord = parseUnmanagedGenesisReviewComment(secondDeltaWorld.comments.at(-1).body).record
    expect(secondRecord.delta.predecessor_delta_record_id).toBe(firstDeltaRecord.record_id)
    expect(secondRecord.delta.correction_of_record_id).toBe(firstDeltaRecord.record_id)
    expect(secondDeltaWorld.issue.body).not.toMatch(/review_cycle|full_review_count/)
    expect(second.mergeEligibility.eligible).toBe(true)
  })

  it('exposes only founder_authorization_comment_id at the package script boundary', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(pkg.scripts['bemoat:mission-control:unmanaged-genesis-review']).toBe(
      'node scripts/mission-control-unmanaged-genesis-review.mjs',
    )
    const auth = parseFounderUnmanagedGenesisAuthorization(
      createFounderUnmanagedGenesisAuthorizationBody({ evidenceClass: 'full' }),
    )
    expect(auth.evidence_class).toBe('full')
    expect(auth.pr).toBe(266)
    expect(auth.task_issue).toBe(262)
  })
})
