/* eslint-disable @typescript-eslint/no-explicit-any */
import { generateKeyPairSync } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  BOOTSTRAP_CONTRACT,
  createFounderAuthorizationBody,
} from '../../scripts/mission-control/domain/task-bootstrap-authorization.ts'
import {
  createTaskBootstrapService,
  buildInitialTaskState,
} from '../../scripts/mission-control/workflows/task-bootstrap.mjs'
import {
  parseTaskAttestation,
  sha256Hex,
  verifyTaskAttestation,
} from '../../scripts/mission-control/domain/task-attestation.mjs'
import {
  createTaskOwnershipRecord,
  renderTaskOwnershipRecord,
} from '../../scripts/mission-control/domain/task-ownership-registry.mjs'
import {
  PROVISIONAL_TASK_END,
  PROVISIONAL_TASK_MARKER,
  buildTaskBootstrapRequestIdentity,
} from '../../scripts/mission-control/domain/task-bootstrap-request.ts'
import { preflightCanonicalBootstrapTask } from '../../scripts/mission-control/domain/task-bootstrap-preflight.ts'
import { parseMissionControlState, renderMissionControlState } from '../../scripts/mission-control/domain/task-state.ts'

const REPO = 'boat1994/bemoat-web-starter'
const MAIN_SHA = 'f6ac355b98aa281dda2a49bcf2ddaeb279d8173d'
const HEAD_SHA = 'd5f0d1edf86f0c0f94a4891558ae6fcea7bfb73f'
const POLICY_SHA = 'f46f5de1d5ee17669c7c4663893164ffb835b339'
const POLICY_PATH = 'docs/mission-control/mission-control-guide.md'
const POLICY_VERSION = '1.3.0'

function keyMaterial() {
  const pair = generateKeyPairSync('ed25519')
  return {
    privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  }
}

function createWorld({ projectionFailure = false } = {}) {
  const authBody = createFounderAuthorizationBody({
    repository: REPO,
    parentIssue: 262,
    pullRequest: 263,
    base: 'main',
    head: HEAD_SHA,
    protectedBaseSha: MAIN_SHA,
    policySource: POLICY_PATH,
    policyVersion: POLICY_VERSION,
    policySha: POLICY_SHA,
    commentId: 9001,
  })

  const issues = new Map<number, any>([
    [262, {
      number: 262,
      id: 'I_kwDOParent',
      node_id: 'MDU6SXNzdWUx',
      url: `https://github.com/${REPO}/issues/262`,
      state: 'OPEN',
      title: 'canonical bootstrap parent',
      body: 'Founder-approved genesis parent.\n',
    }],
    [259, {
      number: 259,
      id: 'I_kwDOLegacy',
      node_id: 'MDU6SXNzdWUy',
      url: `https://github.com/${REPO}/issues/259`,
      state: 'OPEN',
      title: 'legacy managed task',
      body: '<!-- bemoat-mission-control-state:start -->\n```yaml\nschema_version: 1\nstate: ELIGIBLE_FOR_FOUNDER_REVIEW\nreview_cycle: 1\nfull_review_count: 1\napproved_base: main\nactive_task_issue: "#259"\nactive_pr: "#260"\ncurrent_head: "b1ce5f0000000000000000000000000000000000"\nlast_reviewed_head: "b1ce5f0000000000000000000000000000000000"\nguide_version: 1.3.0\nguide_source_ref: main\nguide_source_sha: "f46f5de1d5ee17669c7c4663893164ffb835b339"\nopen_blockers: []\nfollow_up_issues: []\nnext_permitted_action: "Founder review"\nmaterial_change_status: none\nupdated_at: null\nupdated_by: null\n```\n<!-- bemoat-mission-control-state:end -->',
    }],
  ])
  const comments = new Map<number, any[]>([
    [262, [{
      id: 9001,
      body: authBody,
      user: { login: 'boat1994' },
      issue_number: 262,
      created_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-08-01T00:00:00Z',
    }]],
  ])
  const calls = {
    createIssue: 0,
    updateIssue: 0,
    postComment: 0,
    leases: 0,
    events: [] as string[],
  }
  let nextIssue = 300
  let failProjection = projectionFailure
  let lease: string | null = null
  let creationTail = Promise.resolve()
  const world = {
    issues,
    comments,
    calls,
    async getRepository() {
      return { nameWithOwner: REPO, id: 'R_repo', node_id: 'R_node', defaultBranch: 'main' }
    },
    async getIssue(number: number) {
      calls.events.push(`getIssue:${number}`)
      const issue = issues.get(Number(number))
      if (!issue) throw Object.assign(new Error('404 Not Found'), { code: 'NOT_FOUND' })
      return structuredClone(issue)
    },
    async listIssues() {
      return [...issues.values()].map((issue) => structuredClone(issue))
    },
    async getIssueComments(number: number) {
      return structuredClone(comments.get(Number(number)) ?? [])
    },
    async getIssueComment(id: number) {
      for (const entries of comments.values()) {
        const found = entries.find((comment) => String(comment.id) === String(id))
        if (found) return structuredClone(found)
      }
      throw Object.assign(new Error('404 Not Found'), { code: 'NOT_FOUND' })
    },
    async getPullRequest(number: number) {
      if (Number(number) !== 263) throw new Error('unexpected PR')
      return {
        number: 263,
        id: 'PR_263',
        node_id: 'PR_node_263',
        url: `https://github.com/${REPO}/pull/263`,
        state: 'OPEN',
        isDraft: true,
        baseRefName: 'main',
        baseRefOid: MAIN_SHA,
        headRefName: 'fix/262-review-verdict-reconciliation',
        headRefOid: HEAD_SHA,
        statusCheckRollup: [
          { name: 'ci', conclusion: 'SUCCESS' },
          { name: 'starter-ci', conclusion: 'SUCCESS' },
        ],
      }
    },
    async getBranchCommit(branch: string) {
      if (branch !== 'main') throw new Error('unexpected branch')
      return { sha: MAIN_SHA }
    },
    async getPolicy() {
      return { path: POLICY_PATH, version: POLICY_VERSION, blobSha: POLICY_SHA, sourceCommit: MAIN_SHA }
    },
    async getFounderLogins() {
      return ['boat1994']
    },
    async createIssue(input: any) {
      calls.createIssue += 1
      const number = nextIssue++
      const issue = {
        number,
        id: `I_task_${number}`,
        node_id: `MDU6SXNzdWV${number}`,
        url: `https://github.com/${REPO}/issues/${number}`,
        state: 'OPEN',
        title: input.title,
        body: input.body,
      }
      issues.set(number, issue)
      comments.set(number, [])
      return structuredClone(issue)
    },
    async updateIssueBody(number: number, body: string) {
      calls.events.push(`updateIssueBody:${number}`)
      calls.updateIssue += 1
      if (failProjection) {
        failProjection = false
        throw new Error('projection unavailable')
      }
      const issue = issues.get(Number(number))
      if (!issue) throw new Error('issue disappeared')
      issue.body = body
      return structuredClone(issue)
    },
    async postIssueComment(number: number, body: string) {
      calls.events.push(`postIssueComment:${number}`)
      calls.postComment += 1
      const entries = comments.get(Number(number)) ?? []
      const comment = {
        id: 9100 + calls.postComment,
        body,
        user: { login: 'github-actions[bot]' },
        issue_number: Number(number),
        created_at: '2026-08-01T00:00:01Z',
        updated_at: '2026-08-01T00:00:01Z',
      }
      entries.push(comment)
      comments.set(Number(number), entries)
      return structuredClone(comment)
    },
    async acquireIssueLease({ requestId }: { requestId: string }) {
      calls.leases += 1
      if (lease && lease !== requestId) throw Object.assign(new Error('CAS_CONFLICT'), { code: 'CAS_CONFLICT' })
      lease = requestId
      return { token: requestId }
    },
    async releaseIssueLease() {
      lease = null
    },
    async acquireCreationLease({ requestId }: { requestId: string }) {
      const previous = creationTail
      let release!: () => void
      creationTail = new Promise((resolve) => { release = resolve })
      await previous
      return { token: requestId, release }
    },
    async releaseCreationLease({ lease }: { lease?: { release?: () => void } } = {}) {
      lease?.release?.()
    },
    getAuthBody() {
      return authBody
    },
  }
  return world
}

function serviceFor(world: ReturnType<typeof createWorld>, overrides: any = {}) {
  const keys = keyMaterial()
  return {
    keys,
    service: createTaskBootstrapService({
      github: world,
      repository: REPO,
      publicKey: keys.publicKey,
      signingPrivateKey: keys.privateKey,
      signingKeyId: 'genesis-test-key-1',
      workflow: {
        file: '.github/workflows/mission-control-task-bootstrap.yml',
        ref: 'refs/heads/main',
        sha: MAIN_SHA,
        runId: '1',
      },
      ...overrides,
    }),
  }
}

describe('canonical Mission Control Task bootstrap', () => {
  it('initializes the Founder-authorized existing planning-only Issue without reading PR genesis evidence', async () => {
    const world = createWorld()
    const authBody = createFounderAuthorizationBody({
      repository: REPO,
      parentIssue: 380,
      taskIssue: 380,
      targetMode: 'planning_no_pr',
      pullRequest: null,
      head: null,
      protectedBaseSha: MAIN_SHA,
      policySource: POLICY_PATH,
      policyVersion: POLICY_VERSION,
      policySha: POLICY_SHA,
      commentId: 9002,
    })
    world.issues.set(380, {
      number: 380,
      id: 'I_existing_380',
      node_id: 'MDU6SXNzdWUzODA=',
      url: `https://github.com/${REPO}/issues/380`,
      state: 'OPEN',
      title: 'existing managed task',
      body: '',
    })
    world.comments.set(380, [{ id: 9002, body: authBody, user: { login: 'boat1994' }, issue_number: 380 }])

    const { service } = serviceFor(world)
    const result = await service.bootstrap({ founderAuthorizationCommentId: '9002' })
    const state = parseMissionControlState(result.issue.body)

    expect(result.targetMode).toBe('planning_no_pr')
    expect(state.state).toMatchObject({ active_task_issue: '#380', active_pr: null, current_head: null, workflow_mode: 'planning_no_pr' })
    expect((parseTaskAttestation(result.issue.body).envelope as any).payload.policy_source_commit).toBe(MAIN_SHA)
    expect(world.calls.events).not.toContain('getPullRequest:263')
  })

  it('writes durable ownership before projection and reads back after projection', async () => {
    const world = createWorld()
    const { service } = serviceFor(world)

    await service.bootstrap({ founderAuthorizationCommentId: '9001' })

    const ownershipIndex = world.calls.events.indexOf('postIssueComment:262')
    const projectionIndex = world.calls.events.indexOf('updateIssueBody:300')
    const finalReadbackIndex = world.calls.events.lastIndexOf('getIssue:300')
    expect(ownershipIndex).toBeGreaterThanOrEqual(0)
    expect(projectionIndex).toBeGreaterThan(ownershipIndex)
    expect(finalReadbackIndex).toBeGreaterThan(projectionIndex)
  })

  it('fails closed when the registry post is lost before live reread', async () => {
    const world = createWorld()
    const originalPost = world.postIssueComment
    world.postIssueComment = async (number: number, body: string) => {
      const comment = await originalPost(number, body)
      world.comments.get(number)!.pop()
      return comment
    }
    const { service } = serviceFor(world)
    await expect(service.bootstrap({ founderAuthorizationCommentId: '9001' })).rejects.toMatchObject({ code: 'BLOCKED_EXTERNAL' })
    expect(world.calls.events).not.toContain('updateIssueBody:300')
  })

  it('rejects partial current-target state before any projection', async () => {
    const world = createWorld()
    const partialState: Record<string, unknown> = {
      schema_version: 1, state: 'AWAITING_REVIEW_1', review_cycle: 0, full_review_count: 0,
      approved_base: 'main', active_task_issue: '#380', active_pr: null, current_head: null,
      last_reviewed_head: null, guide_version: POLICY_VERSION, guide_source_ref: 'main', guide_source_sha: POLICY_SHA,
      open_blockers: [], follow_up_issues: [], next_permitted_action: 'Run read-only Review 1 preflight; do not start Review 1.',
      material_change_status: 'none', updated_at: null, updated_by: 'fixture',
    }
    world.issues.set(380, { number: 380, id: 'I_existing_380', node_id: 'N_existing_380', state: 'OPEN', title: 'existing', body: renderMissionControlState(partialState) })
    world.comments.set(380, [{ id: 9002, body: createFounderAuthorizationBody({ parentIssue: 380, taskIssue: 380, targetMode: 'planning_no_pr', protectedBaseSha: MAIN_SHA, policySource: POLICY_PATH, policyVersion: POLICY_VERSION, policySha: POLICY_SHA, commentId: 9002 }), user: { login: 'boat1994' }, issue_number: 380 }])
    const { service } = serviceFor(world)
    await expect(service.bootstrap({ founderAuthorizationCommentId: '9002' })).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
    expect(world.calls.updateIssue).toBe(0)
  })

  it('uses the current authorized target rather than historical Issue #262 for the creation lease', async () => {
    const world = createWorld()
    const leaseIssues: number[] = []
    delete (world as any).acquireCreationLease
    world.acquireIssueLease = async ({ issueNumber, requestId }: { issueNumber: number, requestId: string }) => {
      leaseIssues.push(Number(issueNumber))
      return { token: requestId }
    }
    const authBody = createFounderAuthorizationBody({ parentIssue: 380, taskIssue: 380, targetMode: 'planning_no_pr', protectedBaseSha: MAIN_SHA, policySource: POLICY_PATH, policyVersion: POLICY_VERSION, policySha: POLICY_SHA, commentId: 9002 })
    world.issues.set(380, { number: 380, id: 'I_existing_380', node_id: 'N_existing_380', state: 'OPEN', title: 'existing', body: '' })
    world.comments.set(380, [{ id: 9002, body: authBody, user: { login: 'boat1994' }, issue_number: 380 }])
    await serviceFor(world).service.bootstrap({ founderAuthorizationCommentId: '9002' })
    expect(leaseIssues).toHaveLength(2)
    expect(leaseIssues.every((number) => number === 380)).toBe(true)
    expect(leaseIssues).not.toContain(262)
  })

  it('fails the workflow scan closed for invalid provisional metadata with the exact conflict reason', async () => {
    const world = createWorld()
    world.issues.set(300, {
      number: 300,
      id: 'I_invalid_provisional',
      node_id: 'MDU6SXNzdWV300',
      state: 'OPEN',
      title: 'invalid provisional allocation',
      body: `${PROVISIONAL_TASK_MARKER}\n{}\n${PROVISIONAL_TASK_END}`,
    })
    const { service } = serviceFor(world)

    await expect(service.bootstrap({ founderAuthorizationCommentId: '9001' })).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
      classification: 'STATE_CONFLICT',
      message: 'STATE_CONFLICT: provisional Issue #300 has invalid recovery metadata',
    })
    expect(world.calls.createIssue).toBe(0)
  })

  it('creates one valid Task with the exact initial state and 0/0 counters', async () => {
    const world = createWorld()
    const { service, keys } = serviceFor(world)
    const result = await service.bootstrap({ founderAuthorizationCommentId: '9001' })

    expect(result.ok).toBe(true)
    expect(result.issue.number).toBe(300)
    const parsed = parseMissionControlState(result.issue.body)
    expect(parsed).toMatchObject({ valid: true, state: {
      state: 'AWAITING_REVIEW_1',
      review_cycle: 0,
      full_review_count: 0,
      approved_base: 'main',
      active_task_issue: '#300',
      active_pr: '#263',
      current_head: HEAD_SHA,
      last_reviewed_head: null,
      parent_issue: '#262',
      policy_source: POLICY_PATH,
      policy_version: POLICY_VERSION,
      policy_sha: POLICY_SHA,
      next_permitted_action: 'Run read-only Review 1 preflight; do not start Review 1.',
    } })
    expect(result.issue.body).toContain('bemoat-mission-control-task-attestation:v1')
    const attestationCheck = verifyTaskAttestation(parseTaskAttestation(result.issue.body).envelope, {
      publicKey: keys.publicKey,
      repository: REPO,
      taskIssue: result.issue,
      pullRequest: await world.getPullRequest(263),
      expectedWorkflow: { file: '.github/workflows/mission-control-task-bootstrap.yml', ref: 'refs/heads/main', sha: MAIN_SHA, runId: '1' },
    })
    expect(attestationCheck.ok).toBe(true)
  })

  it('is idempotent for identical retry and concurrent duplicate invocation', async () => {
    const world = createWorld()
    const { service } = serviceFor(world)
    const first = await service.bootstrap({ founderAuthorizationCommentId: '9001' })
    const retry = await service.bootstrap({ founderAuthorizationCommentId: '9001' })
    expect(retry.ok).toBe(true)
    expect(retry.issue.number).toBe(first.issue.number)
    expect(world.calls.createIssue).toBe(1)

    const concurrentWorld = createWorld()
    const concurrent = serviceFor(concurrentWorld).service
    const results = await Promise.all([
      concurrent.bootstrap({ founderAuthorizationCommentId: '9001' }),
      concurrent.bootstrap({ founderAuthorizationCommentId: '9001' }),
    ])
    expect(results.every((entry) => entry.ok)).toBe(true)
    expect(new Set(results.map((entry) => entry.issue.number)).size).toBe(1)
    expect(concurrentWorld.calls.createIssue).toBe(1)
  })

  it('recovers a provisional Issue after projection failure and after every durable checkpoint', async () => {
    const world = createWorld({ projectionFailure: true })
    const { service } = serviceFor(world)
    await expect(service.bootstrap({ founderAuthorizationCommentId: '9001' })).rejects.toMatchObject({ code: 'PROJECTION_FAILED' })
    expect(world.calls.createIssue).toBe(1)
    const recovered = await service.bootstrap({ founderAuthorizationCommentId: '9001' })
    expect(recovered.ok).toBe(true)
    expect(recovered.issue.number).toBe(300)
    expect(world.calls.createIssue).toBe(1)
  })

  it.each([
    ['changed PR head', (world: any) => { world.getPullRequest = async (number: number) => ({ ...(await world.__getPullRequest(number)), headRefOid: 'a'.repeat(40) }) }],
    ['changed PR base', (world: any) => { const original = world.getPullRequest; world.getPullRequest = async (number: number) => ({ ...await original(number), baseRefName: 'dev' }) }],
    ['failed exact-head CI', (world: any) => { const original = world.getPullRequest; world.getPullRequest = async (number: number) => ({ ...await original(number), statusCheckRollup: [{ name: 'ci', conclusion: 'FAILURE' }] }) }],
    ['missing exact-head CI', (world: any) => { const original = world.getPullRequest; world.getPullRequest = async (number: number) => ({ ...await original(number), statusCheckRollup: [{ name: 'ci', conclusion: 'SUCCESS' }] }) }],
  ])('%s invalidates the request before Issue creation', async (_name, mutate) => {
    const world = createWorld()
    const original = world.getPullRequest
    ;(world as any).__getPullRequest = original
    mutate(world)
    const { service } = serviceFor(world)
    await expect(service.bootstrap({ founderAuthorizationCommentId: '9001' })).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
    expect(world.calls.createIssue).toBe(0)
  })

  it('rejects stale, forged, mismatched, and superseded Founder authority', async () => {
    for (const mutate of [
      (world: any) => { world.comments.get(262)[0].user.login = 'not-founder' },
      (world: any) => { world.comments.get(262)[0].body = world.getAuthBody().replace(HEAD_SHA, 'a'.repeat(40)) },
      (world: any) => { world.comments.get(262).push({ id: 9002, body: JSON.stringify({ supersedes_comment_id: 9001 }), user: { login: 'boat1994' } }) },
    ]) {
      const world = createWorld()
      mutate(world)
      const { service } = serviceFor(world)
      await expect(service.bootstrap({ founderAuthorizationCommentId: '9001' })).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
      expect(world.calls.createIssue).toBe(0)
    }
  })

  it('fails closed for copied or forged attestations, wrong keys, direct mutation, ambiguity, and lease/readback failures', async () => {
    const world = createWorld()
    const { service, keys } = serviceFor(world)
    const result = await service.bootstrap({ founderAuthorizationCommentId: '9001' })
    const task = world.issues.get(result.issue.number)
    task.body = task.body.replace('"task_issue_number": 300', '"task_issue_number": 301')
    expect(verifyTaskAttestation(parseTaskAttestation(task.body).envelope, {
      publicKey: keys.publicKey,
      repository: REPO,
      taskIssue: task,
      pullRequest: await world.getPullRequest(263),
      expectedWorkflow: { file: '.github/workflows/mission-control-task-bootstrap.yml', ref: 'refs/heads/main', sha: MAIN_SHA, runId: '1' },
    }).ok).toBe(false)
    expect(preflightCanonicalBootstrapTask({
      issue: task,
      pullRequest: await world.getPullRequest(263),
      repository: REPO,
      publicKey: keys.publicKey,
    }).ok).toBe(false)

    const wrong = serviceFor(world, { publicKey: keyMaterial().publicKey }).service
    await expect(wrong.bootstrap({ founderAuthorizationCommentId: '9001' })).rejects.toMatchObject({ code: 'STATE_CONFLICT' })

    const ambiguous = createWorld()
    ambiguous.createIssue = async () => { throw Object.assign(new Error('response lost'), { code: 'API_AMBIGUITY' }) }
    const ambiguousService = serviceFor(ambiguous).service
    await expect(ambiguousService.bootstrap({ founderAuthorizationCommentId: '9001' })).rejects.toMatchObject({ code: 'BLOCKED_EXTERNAL' })

    const leaseConflict = createWorld()
    leaseConflict.acquireIssueLease = async () => { throw Object.assign(new Error('CAS_CONFLICT'), { code: 'CAS_CONFLICT' }) }
    await expect(serviceFor(leaseConflict).service.bootstrap({ founderAuthorizationCommentId: '9001' })).rejects.toMatchObject({ code: 'STATE_CONFLICT' })

    const readbackFailure = createWorld()
    const originalUpdateIssueBody = readbackFailure.updateIssueBody
    readbackFailure.updateIssueBody = async (number: number, body: string) => {
      const updated = await originalUpdateIssueBody(number, body)
      readbackFailure.issues.get(number).body = `${updated.body}\nforged`
      return updated
    }
    await expect(serviceFor(readbackFailure).service.bootstrap({ founderAuthorizationCommentId: '9001' })).rejects.toMatchObject({ code: 'BLOCKED_EXTERNAL' })
  })

  it('rejects competing valid ownership records and never rebinds a conflicting parent registry owner', async () => {
    const competingWorld = createWorld()
    const { service: competingService, keys: competingKeys } = serviceFor(competingWorld)
    const competingRecord = createTaskOwnershipRecord({
      signingKeyId: 'genesis-test-key-1',
      privateKey: competingKeys.privateKey,
      payload: {
        schema_version: 1,
        registry_schema: 'bemoat-mission-control-task-ownership-registry',
        repository: REPO,
        request_id: `mc-task-bootstrap-v1-${'d'.repeat(64)}`,
        parent_issue_number: 262,
        parent_issue_id: 'I_kwDOParent',
        parent_issue_node_id: 'MDU6SXNzdWV1',
        task_issue_number: 301,
        task_issue_id: 'I_competing',
        task_issue_node_id: 'MDU6SXNzdWV301',
        pr_number: 263,
        pr_id: 'PR_263',
        pr_node_id: 'PR_node_263',
        base: 'main',
        head: HEAD_SHA,
        protected_base_sha: MAIN_SHA,
        attestation_sha256: 'e'.repeat(64),
        signing_key_id: 'genesis-test-key-1',
      },
    })
    competingWorld.comments.get(262)!.push({ id: 9201, body: renderTaskOwnershipRecord(competingRecord), user: { login: 'github-actions[bot]' }, issue_number: 262 })
    await expect(competingService.bootstrap({ founderAuthorizationCommentId: '9001' })).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
    expect(competingWorld.calls.createIssue).toBe(0)

    const registryWorld = createWorld()
    const { service: registryService, keys: registryKeys } = serviceFor(registryWorld)
    const request = buildTaskBootstrapRequestIdentity({
      repository: REPO,
      authorizationCommentId: 9001,
      authorizationBodySha256: sha256Hex(registryWorld.getAuthBody()),
      parentIssue: 262,
      pullRequest: 263,
      base: 'main',
      head: HEAD_SHA,
      protectedBaseSha: MAIN_SHA,
      policyPath: POLICY_PATH,
      policyVersion: POLICY_VERSION,
      policySha: POLICY_SHA,
    })
    registryWorld.issues.set(301, { number: 301, id: 'I_wrong', node_id: 'MDU6SXNzdWV301', state: 'OPEN', title: 'unrelated', body: 'human text' })
    registryWorld.comments.set(301, [])
    const sameRequestRecord = createTaskOwnershipRecord({
      signingKeyId: 'genesis-test-key-1',
      privateKey: registryKeys.privateKey,
      payload: {
        schema_version: 1,
        registry_schema: 'bemoat-mission-control-task-ownership-registry',
        repository: REPO,
        request_id: request.requestId,
        parent_issue_number: 262,
        parent_issue_id: 'I_kwDOParent',
        parent_issue_node_id: 'MDU6SXNzdWV1',
        task_issue_number: 301,
        task_issue_id: 'I_wrong',
        task_issue_node_id: 'MDU6SXNzdWV301',
        pr_number: 263,
        pr_id: 'PR_263',
        pr_node_id: 'PR_node_263',
        base: 'main',
        head: HEAD_SHA,
        protected_base_sha: MAIN_SHA,
        attestation_sha256: 'e'.repeat(64),
        signing_key_id: 'genesis-test-key-1',
      },
    })
    registryWorld.comments.get(262)!.push({ id: 9202, body: renderTaskOwnershipRecord(sameRequestRecord), user: { login: 'github-actions[bot]' }, issue_number: 262 })
    await expect(registryService.bootstrap({ founderAuthorizationCommentId: '9001' })).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
    expect(registryWorld.calls.createIssue).toBe(0)
  })

  it('rejects non-main workflow refs and child repositories without protected signing material', async () => {
    const world = createWorld()
    await expect(serviceFor(world, { workflow: { file: BOOTSTRAP_CONTRACT.workflowFile, ref: 'refs/heads/feature', sha: MAIN_SHA, runId: 'run-1' } }).service.bootstrap({ founderAuthorizationCommentId: '9001' })).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
    await expect(serviceFor(world, { repository: 'child/example', signingPrivateKey: null, publicKey: null }).service.bootstrap({ founderAuthorizationCommentId: '9001' })).rejects.toMatchObject({ code: 'BLOCKED_EXTERNAL' })
  })

  it('keeps the Issue #259 / PR #260 legacy lineage untouched', async () => {
    const world = createWorld()
    const before = structuredClone(world.issues.get(259))
    await serviceFor(world).service.bootstrap({ founderAuthorizationCommentId: '9001' })
    expect(world.issues.get(259)).toEqual(before)
  })
})

void buildInitialTaskState
