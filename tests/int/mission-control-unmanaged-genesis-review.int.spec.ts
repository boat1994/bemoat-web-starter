/* eslint-disable @typescript-eslint/no-explicit-any -- untyped runtime .mjs boundary */
import { generateKeyPairSync } from 'node:crypto'
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
  verifyUnmanagedGenesisReviewRecord,
} from '../../scripts/mission-control/domain/unmanaged-genesis-review.mjs'
import { createUnmanagedGenesisReviewService } from '../../scripts/mission-control/workflows/unmanaged-genesis-review.mjs'
import { sha256Hex } from '../../scripts/mission-control/domain/task-attestation.mjs'

const REPO = UGR_CONTRACT.repository
const OLD_HEAD = UGR_CONTRACT.historicalFullReviewedHead as string
const CURRENT_HEAD = '50879fe28e0293ef4c1f93edcb1f378e9ee8f7e6'
const NEXT_HEAD = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const MID_HEAD = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const MAIN_SHA = UGR_CONTRACT.protectedBaseSha as string
const APP_SLUG = 'bemoat-mc'
const SIGNING_KEY_ID = 'ugr-test-key'

function keyMaterial() {
  const pair = generateKeyPairSync('ed25519')
  return {
    privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  }
}

function loadFixture(name: string): any {
  return JSON.parse(readFileSync(resolve(process.cwd(), `tests/fixtures/mission-control/${name}`), 'utf8'))
}

function fixtureComment(fixture: any, { id = fixture.id, body = fixture.body } = {}): any {
  return {
    id,
    node_id: fixture.node_id,
    body,
    user: fixture.user,
    author: fixture.user,
    issue_number: 262,
    created_at: fixture.created_at,
    updated_at: fixture.updated_at,
    performed_via_github_app: fixture.performed_via_github_app,
  }
}

function appComment(id: number, body: string, appSlug = APP_SLUG): any {
  return {
    id,
    body,
    user: { login: 'bemoat-mc-app' },
    author: { login: 'bemoat-mc-app' },
    issue_number: 262,
    created_at: '2026-08-03T22:00:00Z',
    updated_at: '2026-08-03T22:00:00Z',
    performed_via_github_app: appSlug == null ? null : { slug: appSlug },
  }
}

function reviewVerdictComment(id: number, base: string, head: string): any {
  const body = [
    '## REVIEW_VERDICT',
    '',
    'ELIGIBLE FOR FOUNDER REVIEW',
    '',
    `**PR**: #266`,
    `**Base**: \`main\``,
    `**Exact Head**: \`${head}\``,
    '',
  ].join('\n')
  return {
    id,
    node_id: `review-${id}`,
    body,
    user: { login: 'boat1994' },
    author: { login: 'boat1994' },
    issue_number: 262,
    created_at: '2026-08-03T21:30:00Z',
    updated_at: '2026-08-03T21:30:00Z',
    performed_via_github_app: null,
    rangeBase: base,
    rangeHead: head,
  }
}

function createWorld({
  recordClass = 'FULL_RECORDING',
  head = CURRENT_HEAD,
  authCommentId = 9001,
  issueBody = 'Issue #262 remains unmanaged.\n',
  extraComments = [] as any[],
  authorizationOverrides = {} as Record<string, any>,
  diffText = 'diff --git a/x b/x\n+correction\n',
  overallDiffText = diffText,
  correctionDiffText = diffText,
  historicalChecks = [
    { name: 'ci', conclusion: 'SUCCESS', id: 11 },
    { name: 'starter-ci', conclusion: 'SUCCESS', id: 12 },
  ] as any[],
  ancestorResult = true,
  postFailure = null as 'append-then-fail' | 'fail' | null,
  includeLegacy = recordClass === 'DELTA_RECORDING',
  appSlug = APP_SLUG,
  keys = keyMaterial(),
}: {
  recordClass?: 'FULL_RECORDING' | 'DELTA_RECORDING'
  head?: string
  authCommentId?: number
  issueBody?: string
  extraComments?: any[]
  authorizationOverrides?: Record<string, any>
  diffText?: string
  overallDiffText?: string
  correctionDiffText?: string
  historicalChecks?: any[]
  ancestorResult?: boolean
  postFailure?: 'append-then-fail' | 'fail' | null
  includeLegacy?: boolean
  appSlug?: string | null
  keys?: { privateKey: string, publicKey: string }
} = {}) {
  const historical = loadFixture('issue-262-review-occurrence-5167077714.json')
  const legacy = loadFixture('issue-262-delta-evidence-5168547881.json')
  const legacySegment = {
    base: OLD_HEAD,
    head: CURRENT_HEAD,
    comment_id: legacy.id,
    body_sha256: sha256Hex(legacy.body),
    role: 'LEGACY_DELTA_EVIDENCE_RESULT',
    verdict: 'ELIGIBLE FOR FOUNDER REVIEW',
  }
  const authBody = createFounderUnmanagedGenesisAuthorizationBody({
    recordClass,
    observedHead: head,
    sourceSha: MAIN_SHA,
    githubAppSlug: appSlug,
    signingKeyId: SIGNING_KEY_ID,
    full: {
      reviewed_head: OLD_HEAD,
      source_evidence: {
        comment_id: historical.id,
        body_sha256: sha256Hex(historical.body),
        role: 'FULL_REVIEW_VERDICT',
        verdict: 'ELIGIBLE FOR FOUNDER REVIEW',
      },
      required_historical_checks: ['ci', 'starter-ci'],
    },
    delta: {
      parent_full: {
        authorization_id: 'mc-ugr-auth-v2-placeholder',
        authorization_comment_id: 9001,
        record_id: 'mc-ugr-v1-placeholder',
        record_comment_id: 10001,
        record_body_sha256: 'a'.repeat(64),
      },
      predecessor_delta_record_id: null,
      exact_current_head: head,
      coverage_segments: [legacySegment],
      correction_commit_oids: [head],
      correction_diff_sha256: sha256Hex(correctionDiffText),
      overall_diff_sha256: sha256Hex(overallDiffText),
      finding_disposition: [],
      required_current_checks: ['ci', 'starter-ci'],
    },
    authorizationOverrides,
  } as any)

  const comments: any[] = [
    fixtureComment(historical),
    ...(includeLegacy ? [fixtureComment(legacy)] : []),
    {
      id: authCommentId,
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

  const calls = {
    postComment: 0,
    updateIssueBody: 0,
    getCommitCheckRuns: [] as string[],
    isCommitAncestor: [] as { ancestor: string, descendant: string }[],
  }
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
    async getPullRequestDiff(number: number, { base, head: diffHead }: { base: string, head: string } = {} as any) {
      if (number !== 266) throw Object.assign(new Error('wrong pr'), { code: 'STATE_CONFLICT' })
      if (base === OLD_HEAD && diffHead === head) return overallDiffText
      return correctionDiffText
    },
    async getCommitCheckRuns(sha: string) {
      calls.getCommitCheckRuns.push(sha)
      return sha === OLD_HEAD ? historicalChecks : [
        { name: 'ci', conclusion: 'SUCCESS', id: 21 },
        { name: 'starter-ci', conclusion: 'SUCCESS', id: 22 },
      ]
    },
    async isCommitAncestor({ ancestor, descendant }: { ancestor: string, descendant: string }) {
      calls.isCommitAncestor.push({ ancestor, descendant })
      return ancestorResult
    },
    async postIssueComment(number: number, body: string) {
      if (number !== 262) throw Object.assign(new Error('wrong issue'), { code: 'STATE_CONFLICT' })
      calls.postComment += 1
      const comment = appComment(nextCommentId++, body, appSlug ?? undefined)
      comments.push(comment)
      if (postFailure) {
        if (postFailure === 'fail') comments.pop()
        throw new Error('simulated post ambiguity')
      }
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
    signingKeyId: SIGNING_KEY_ID,
    workflow: {
      file: 'scripts/mission-control-unmanaged-genesis-review.mjs',
      ref: 'refs/heads/main',
      sha: MAIN_SHA,
      runId: '1',
    },
    env: {
      BEMOAT_FOUNDER_LOGINS: 'boat1994',
      BEMOAT_UGR_GITHUB_APP_SLUG: appSlug ?? '',
    } as unknown as NodeJS.ProcessEnv,
  } as any)

  return {
    keys,
    github,
    service,
    comments,
    issue,
    pullRequest,
    calls,
    authBody,
    historical,
    legacy,
    diffText,
  }
}

async function recordFullAndPrepareDelta({
  keys = keyMaterial(),
  fullHead = CURRENT_HEAD,
  deltaHead = CURRENT_HEAD,
  deltaOverrides = {},
  deltaDiffText = 'diff --git a/scripts/x.mjs b/scripts/x.mjs\n+delta\n',
}: {
  keys?: { privateKey: string, publicKey: string }
  fullHead?: string
  deltaHead?: string
  deltaOverrides?: Record<string, any>
  deltaDiffText?: string
} = {}) {
  const fullWorld = createWorld({ recordClass: 'FULL_RECORDING', head: fullHead, keys })
  const fullResult = await fullWorld.service.recordReview({ founderAuthorizationCommentId: 9001 })
  const fullComment = fullWorld.comments.at(-1)
  const fullRecord = parseUnmanagedGenesisReviewComment(fullComment.body).record
  const parentFull = {
    authorization_id: fullRecord.founder_authorization.authorization_id,
    authorization_comment_id: fullRecord.founder_authorization.comment_id,
    record_id: fullRecord.record_id,
    record_comment_id: fullResult.commentId,
    record_body_sha256: sha256Hex(fullComment.body),
  }
  const deltaWorld = createWorld({
    recordClass: 'DELTA_RECORDING',
    head: deltaHead,
    keys,
    extraComments: [fullComment],
    diffText: deltaDiffText,
    correctionDiffText: deltaDiffText,
    overallDiffText: deltaDiffText,
    authorizationOverrides: {
      delta: {
        parent_full: parentFull,
        ...deltaOverrides.delta,
      },
      ...deltaOverrides,
    },
  })
  return { fullWorld, fullResult, fullComment, fullRecord, parentFull, deltaWorld }
}

describe('unmanaged-genesis review fixtures and schema', () => {
  it('treats historical Full and legacy Delta comments as evidence-only', () => {
    const historical = loadFixture('issue-262-review-occurrence-5167077714.json')
    const legacy = loadFixture('issue-262-delta-evidence-5168547881.json')
    expect(historical.id).toBe(5167077714)
    expect(historical.user.login).toBe('boat1994')
    expect(historical.performed_via_github_app).toBeNull()
    expect(historical.body).not.toContain(UGR_MARKER_START)
    expect(parseHistoricalReviewOccurrence(historical.body).verdict).toBe('ELIGIBLE FOR FOUNDER REVIEW')
    expect(legacy.id).toBe(5168547881)
    expect(legacy.body).toContain('This RESULT is durable semantic evidence only.')
    expect(legacy.body).not.toContain(UGR_MARKER_START)
  })

  it('emits a v2 raw authorization with a canonical authorization ID', () => {
    const auth = parseFounderUnmanagedGenesisAuthorization(
      createFounderUnmanagedGenesisAuthorizationBody({
        recordClass: 'FULL_RECORDING',
        observedHead: CURRENT_HEAD,
        sourceSha: MAIN_SHA,
        githubAppSlug: APP_SLUG,
        signingKeyId: SIGNING_KEY_ID,
      } as any),
    )
    expect(auth.schema_version).toBe(2)
    expect(auth.authorization_schema).toBe('bemoat-mission-control-unmanaged-genesis-review-authorization')
    expect(auth.authorization_id).toMatch(/^mc-ugr-auth-v2-[0-9a-f]{64}$/)
    expect(auth.lifecycle_id).toBe('mc-ugr-262-266-v2')
    expect(auth.record_class).toBe('FULL_RECORDING')
    expect(auth.pull_request).toBe(266)
    expect(auth.task_issue).toBe(262)
    expect(auth.full.reviewed_head).toBe(OLD_HEAD)
    expect(auth.full.require_ancestor_of_observed_head).toBe(true)
    expect(auth.delta).toBeUndefined()
  })

  it('keeps the committed public key verification-only and preserves the CLI alias', () => {
    const publicKey = readFileSync(UGR_CONTRACT.publicKeyPath, 'utf8')
    const cli = readFileSync('scripts/mission-control-unmanaged-genesis-review.mjs', 'utf8')
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(publicKey).toContain('BEGIN PUBLIC KEY')
    expect(publicKey).not.toContain('PRIVATE KEY')
    expect(cli).toContain('--founder-authorization-comment-id')
    expect(cli).toContain('--authorization-comment')
    expect(pkg.scripts['bemoat:mission-control:unmanaged-genesis-review']).toBe(
      'node scripts/mission-control-unmanaged-genesis-review.mjs',
    )
    expect(cli).not.toContain('console.log(process.env.BEMOAT_UNMANAGED_GENESIS_REVIEW_SIGNING_PRIVATE_KEY')
  })
})

describe('unmanaged-genesis Full/Delta transport', () => {
  it('records Full against historical CI while live PR head is newer', async () => {
    const world = createWorld({ recordClass: 'FULL_RECORDING', head: CURRENT_HEAD })
    const result = await world.service.recordReview({ founderAuthorizationCommentId: 9001 })
    const record = parseUnmanagedGenesisReviewComment(world.comments.at(-1).body).record
    expect(result.outcome).toBe('RECORDED')
    expect(result.evidenceClass).toBe('full')
    expect(result.reviewedHead).toBe(OLD_HEAD)
    expect(record.live_pr_head).toBe(CURRENT_HEAD)
    expect(record.exact_head_ci.head).toBe(OLD_HEAD)
    expect(world.calls.getCommitCheckRuns).toEqual([OLD_HEAD])
    expect(world.calls.isCommitAncestor).toEqual([{ ancestor: OLD_HEAD, descendant: CURRENT_HEAD }])
    expect(result.mergeEligibility.eligible).toBe(false)
  })

  it.each([
    ['ancestry failure', { ancestorResult: false }, /ancestor/i],
    ['historical CI failure', {
      historicalChecks: [{ name: 'ci', conclusion: 'SUCCESS' }],
    }, /historical.*CI|check starter-ci/i],
  ])('rejects Full when %s', async (_name, options, message) => {
    const world = createWorld({ recordClass: 'FULL_RECORDING', head: CURRENT_HEAD, ...options })
    await expect(world.service.recordReview({ founderAuthorizationCommentId: 9001 }))
      .rejects.toMatchObject({ code: 'STATE_CONFLICT', message })
  })

  it('accepts only the exact legacy Delta RESULT in contiguous coverage', async () => {
    const { fullComment, parentFull, deltaWorld } = await recordFullAndPrepareDelta()
    const result = await deltaWorld.service.recordReview({ founderAuthorizationCommentId: 9001 })
    const record = parseUnmanagedGenesisReviewComment(deltaWorld.comments.at(-1).body).record
    expect(result.outcome).toBe('RECORDED')
    expect(result.evidenceClass).toBe('delta')
    expect(record.delta.parent_full).toEqual(parentFull)
    expect(record.delta.coverage_segments[0].comment_id).toBe(5168547881)
    expect(result.mergeEligibility.eligible).toBe(true)
    expect(fullComment).toBeDefined()
  })

  it('rejects a generic RESULT as non-authoritative Delta evidence', async () => {
    const prepared = await recordFullAndPrepareDelta()
    const genericBody = '## RESULT\n\nA generic result is not review authority.\n'
    const generic = fixtureComment(prepared.deltaWorld.legacy, {
      id: 9999,
      body: genericBody,
    })
    const world = createWorld({
      recordClass: 'DELTA_RECORDING',
      head: CURRENT_HEAD,
      keys: prepared.fullWorld.keys,
      extraComments: [prepared.fullComment, generic],
      includeLegacy: false,
      authorizationOverrides: {
        delta: {
          parent_full: prepared.parentFull,
          coverage_segments: [{
            base: OLD_HEAD,
            head: CURRENT_HEAD,
            comment_id: 9999,
            body_sha256: sha256Hex(genericBody),
            role: 'LEGACY_DELTA_EVIDENCE_RESULT',
            verdict: 'ELIGIBLE FOR FOUNDER REVIEW',
          }],
        },
      },
    })
    await expect(world.service.recordReview({ founderAuthorizationCommentId: 9001 }))
      .rejects.toMatchObject({ code: 'STATE_CONFLICT' })
  })

  it.each([
    ['missing parent', {}],
    ['wrong parent record', {
      delta: {
        parent_full: {
          authorization_id: 'mc-ugr-auth-v2-wrong',
          authorization_comment_id: 9001,
          record_id: 'mc-ugr-v1-wrong',
          record_comment_id: 10001,
          record_body_sha256: 'b'.repeat(64),
        },
      },
    }],
  ])('fails closed when Delta has a %s Full link', async (_name, overrides) => {
    const prepared = await recordFullAndPrepareDelta()
    const world = createWorld({
      recordClass: 'DELTA_RECORDING',
      head: CURRENT_HEAD,
      keys: prepared.fullWorld.keys,
      extraComments: [prepared.fullComment],
      authorizationOverrides: overrides,
    })
    await expect(world.service.recordReview({ founderAuthorizationCommentId: 9001 }))
      .rejects.toMatchObject({ code: 'STATE_CONFLICT' })
  })

  it('denies merge eligibility for Full-only and Delta-only evidence', async () => {
    const { fullWorld, fullResult, fullComment, fullRecord, deltaWorld } = await recordFullAndPrepareDelta()
    const fullRecords = collectVerifiedRecords([...fullWorld.comments], {
      publicKey: fullWorld.keys.publicKey,
      signingKeyId: SIGNING_KEY_ID,
      githubAppSlug: APP_SLUG,
    } as any)
    expect(evaluateUnmanagedGenesisMergeEligibility({
      records: fullRecords,
      livePullRequestHead: CURRENT_HEAD,
    } as any).eligible).toBe(false)

    await deltaWorld.service.recordReview({ founderAuthorizationCommentId: 9001 })
    const deltaRecords = collectVerifiedRecords([deltaWorld.comments.at(-1)], {
      publicKey: fullWorld.keys.publicKey,
      signingKeyId: SIGNING_KEY_ID,
      githubAppSlug: APP_SLUG,
    } as any)
    expect(evaluateUnmanagedGenesisMergeEligibility({
      records: deltaRecords,
      livePullRequestHead: CURRENT_HEAD,
    } as any).eligible).toBe(false)
    expect(fullResult.commentId).toBeDefined()
    expect(fullComment.body).toContain(fullRecord.record_id)
  })

  it('rejects a Delta whose exact_current_head is stale', async () => {
    const { fullWorld, fullComment, parentFull } = await recordFullAndPrepareDelta()
    const world = createWorld({
      recordClass: 'DELTA_RECORDING',
      head: CURRENT_HEAD,
      keys: fullWorld.keys,
      extraComments: [fullComment],
      authorizationOverrides: {
        delta: {
          parent_full: parentFull,
          exact_current_head: NEXT_HEAD,
        },
      },
    })
    await expect(world.service.recordReview({ founderAuthorizationCommentId: 9001 }))
      .rejects.toMatchObject({ code: 'STATE_CONFLICT', message: /exact_current_head|live PR head|coverage/i })
  })

  it('recovers an ambiguous post as NO_OP and keeps deterministic retries idempotent', async () => {
    const world = createWorld({ recordClass: 'FULL_RECORDING', postFailure: 'append-then-fail' })
    const recovered = await world.service.recordReview({ founderAuthorizationCommentId: 9001 })
    const retry = await world.service.recordReview({ founderAuthorizationCommentId: 9001 })
    expect(recovered.outcome).toBe('NO_OP')
    expect(recovered.recovered).toBe(true)
    expect(retry.outcome).toBe('NO_OP')
    expect(retry.recordId).toBe(recovered.recordId)
    expect(world.calls.postComment).toBe(1)

    const missing = createWorld({ recordClass: 'FULL_RECORDING', postFailure: 'fail' })
    await expect(missing.service.recordReview({ founderAuthorizationCommentId: 9001 }))
      .rejects.toMatchObject({ code: 'BLOCKED_EXTERNAL' })
  })

  it('rejects App identity, signed-record, and authorization tampering', async () => {
    const world = createWorld({ recordClass: 'FULL_RECORDING' })
    await world.service.recordReview({ founderAuthorizationCommentId: 9001 })
    const posted = world.comments.at(-1)
    const wrongApp = { ...posted, performed_via_github_app: { slug: 'copied-app' } }
    expect(() => collectVerifiedRecords([...world.comments.slice(0, -1), wrongApp], {
      publicKey: world.keys.publicKey,
      signingKeyId: SIGNING_KEY_ID,
      githubAppSlug: APP_SLUG,
    } as any)).toThrow(/App|app|identity/i)

    const parsed = parseUnmanagedGenesisReviewComment(posted.body)
    expect(verifyUnmanagedGenesisReviewRecord({
      ...parsed.record,
      signing: { ...parsed.record.signing, signature: Buffer.from('tampered').toString('base64') },
    }, { publicKey: world.keys.publicKey, signingKeyId: SIGNING_KEY_ID } as any).ok).toBe(false)

    const copied = createWorld({ recordClass: 'FULL_RECORDING' })
    const authComment = copied.comments.find((comment) => comment.id === 9001)
    const auth = JSON.parse(authComment.body)
    auth.expected_pr.observed_head = NEXT_HEAD
    authComment.body = JSON.stringify(auth)
    await expect(copied.service.recordReview({ founderAuthorizationCommentId: 9001 }))
      .rejects.toMatchObject({ code: 'STATE_CONFLICT' })
  })

  it('returns STATE_CONFLICT for competing Full roots and forked Deltas', async () => {
    const keys = keyMaterial()
    const firstFull = createWorld({ recordClass: 'FULL_RECORDING', authCommentId: 9001, keys })
    await firstFull.service.recordReview({ founderAuthorizationCommentId: 9001 })
    const secondFull = createWorld({ recordClass: 'FULL_RECORDING', authCommentId: 9004, keys })
    await secondFull.service.recordReview({ founderAuthorizationCommentId: 9004 })
    const competing = collectVerifiedRecords([
      firstFull.comments.at(-1),
      secondFull.comments.at(-1),
    ], { publicKey: keys.publicKey, signingKeyId: SIGNING_KEY_ID, githubAppSlug: APP_SLUG } as any)
    expect(evaluateUnmanagedGenesisMergeEligibility({
      records: competing,
      livePullRequestHead: CURRENT_HEAD,
    } as any).classification).toBe('STATE_CONFLICT')

    const prepared = await recordFullAndPrepareDelta({ keys })
    const deltaOne = createWorld({
      recordClass: 'DELTA_RECORDING',
      authCommentId: 9003,
      keys,
      extraComments: [prepared.fullComment],
      correctionDiffText: 'diff --git a/a b/a\n+one\n',
      overallDiffText: 'diff --git a/a b/a\n+one\n',
      authorizationOverrides: { delta: { parent_full: prepared.parentFull } },
    })
    await deltaOne.service.recordReview({ founderAuthorizationCommentId: 9003 })
    const deltaTwo = createWorld({
      recordClass: 'DELTA_RECORDING',
      authCommentId: 9004,
      keys,
      extraComments: [prepared.fullComment],
      correctionDiffText: 'diff --git a/a b/a\n+two\n',
      overallDiffText: 'diff --git a/a b/a\n+two\n',
      authorizationOverrides: { delta: { parent_full: prepared.parentFull } },
    })
    await deltaTwo.service.recordReview({ founderAuthorizationCommentId: 9004 })
    const forked = collectVerifiedRecords([
      prepared.fullComment,
      deltaOne.comments.at(-1),
      deltaTwo.comments.at(-1),
    ], { publicKey: keys.publicKey, signingKeyId: SIGNING_KEY_ID, githubAppSlug: APP_SLUG } as any)
    expect(evaluateUnmanagedGenesisMergeEligibility({
      records: forked,
      livePullRequestHead: CURRENT_HEAD,
    } as any).classification).toBe('STATE_CONFLICT')
  })

  it('requires contiguous coverage from the Full head to the current head', async () => {
    const prepared = await recordFullAndPrepareDelta()
    const first = reviewVerdictComment(7001, OLD_HEAD, MID_HEAD)
    const second = reviewVerdictComment(7002, NEXT_HEAD, CURRENT_HEAD)
    const world = createWorld({
      recordClass: 'DELTA_RECORDING',
      head: CURRENT_HEAD,
      keys: prepared.fullWorld.keys,
      includeLegacy: false,
      extraComments: [prepared.fullComment, first, second],
      authorizationOverrides: {
        delta: {
          parent_full: prepared.parentFull,
          coverage_segments: [
            {
              base: OLD_HEAD,
              head: MID_HEAD,
              comment_id: first.id,
              body_sha256: sha256Hex(first.body),
              role: 'DELTA_REVIEW_VERDICT',
              verdict: 'ELIGIBLE FOR FOUNDER REVIEW',
            },
            {
              base: NEXT_HEAD,
              head: CURRENT_HEAD,
              comment_id: second.id,
              body_sha256: sha256Hex(second.body),
              role: 'DELTA_REVIEW_VERDICT',
              verdict: 'ELIGIBLE FOR FOUNDER REVIEW',
            },
          ],
        },
      },
    })
    await expect(world.service.recordReview({ founderAuthorizationCommentId: 9001 }))
      .rejects.toMatchObject({ code: 'STATE_CONFLICT', message: /contiguous|coverage/i })
  })

  it('accepts ordinary DELTA_REVIEW_VERDICT segments for later ranges', async () => {
    const prepared = await recordFullAndPrepareDelta()
    const first = reviewVerdictComment(7001, OLD_HEAD, MID_HEAD)
    const second = reviewVerdictComment(7002, MID_HEAD, CURRENT_HEAD)
    const world = createWorld({
      recordClass: 'DELTA_RECORDING',
      head: CURRENT_HEAD,
      keys: prepared.fullWorld.keys,
      includeLegacy: false,
      extraComments: [prepared.fullComment, first, second],
      authorizationOverrides: {
        delta: {
          parent_full: prepared.parentFull,
          coverage_segments: [
            {
              base: OLD_HEAD,
              head: MID_HEAD,
              comment_id: first.id,
              body_sha256: sha256Hex(first.body),
              role: 'DELTA_REVIEW_VERDICT',
              verdict: 'ELIGIBLE FOR FOUNDER REVIEW',
            },
            {
              base: MID_HEAD,
              head: CURRENT_HEAD,
              comment_id: second.id,
              body_sha256: sha256Hex(second.body),
              role: 'DELTA_REVIEW_VERDICT',
              verdict: 'ELIGIBLE FOR FOUNDER REVIEW',
            },
          ],
        },
      },
    })
    const result = await world.service.recordReview({ founderAuthorizationCommentId: 9001 })
    expect(result.outcome).toBe('RECORDED')
    expect(result.mergeEligibility.eligible).toBe(true)
  })

  it('never writes Issue body state or review counters', async () => {
    const prepared = await recordFullAndPrepareDelta()
    const deltaWorld = createWorld({
      recordClass: 'DELTA_RECORDING',
      head: CURRENT_HEAD,
      keys: prepared.fullWorld.keys,
      extraComments: [prepared.fullComment],
      authorizationOverrides: { delta: { parent_full: prepared.parentFull } },
    })
    await deltaWorld.service.recordReview({ founderAuthorizationCommentId: 9001 })
    expect(deltaWorld.calls.updateIssueBody).toBe(0)
    expect(deltaWorld.issue.body).not.toMatch(/review_cycle|full_review_count|bemoat-mission-control-state/)
  })
})
