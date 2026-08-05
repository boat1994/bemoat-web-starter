/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash, generateKeyPairSync } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseMissionControlState } from '../../scripts/mission-control-state.mjs'
import { parseCampaign } from '../../scripts/mission-control/domain/campaign-parser.mjs'
import { renderCampaign } from '../../scripts/mission-control/domain/campaign-renderer.mjs'
import {
  CAMPAIGN_SLICE_BOOTSTRAP_ATTESTATION_OPERATION,
  CAMPAIGN_SLICE_BOOTSTRAP_ATTESTATION_SCHEMA,
  CAMPAIGN_SLICE_BOOTSTRAP_AUTHORIZATION_SCHEMA,
  CAMPAIGN_SLICE_BOOTSTRAP_REGISTRY_OPERATION,
  CAMPAIGN_SLICE_BOOTSTRAP_REGISTRY_SCHEMA,
  createCampaignSliceBootstrapAttestation,
} from '../../scripts/mission-control/domain/campaign-slice-bootstrap-authorization.mjs'
import {
  canonicalSerialize,
} from '../../scripts/mission-control/domain/task-attestation.mjs'
import * as campaignSliceBootstrapRequestModule from '../../scripts/mission-control/domain/campaign-slice-bootstrap-request.mjs'
import {
  CAMPAIGN_SLICE_BOOTSTRAP_OPERATION,
  CAMPAIGN_SLICE_BOOTSTRAP_OPERATION_VERSION,
  CAMPAIGN_SLICE_BOOTSTRAP_PROVISIONAL_MARKER_END,
  CAMPAIGN_SLICE_BOOTSTRAP_PROVISIONAL_MARKER_START,
  CAMPAIGN_SLICE_BOOTSTRAP_REQUEST_ID_PREFIX,
  renderCampaignSliceBootstrapProvisionalTaskBody,
} from '../../scripts/mission-control/domain/campaign-slice-bootstrap-request.mjs'
import {
  BOOTSTRAP_CONTRACT,
} from '../../scripts/mission-control/domain/task-bootstrap-authorization.mjs'
import {
  PROVISIONAL_TASK_END,
  PROVISIONAL_TASK_MARKER,
} from '../../scripts/mission-control/domain/task-bootstrap-request.mjs'
import * as campaignSliceBootstrapWorkflowModule from '../../scripts/mission-control/workflows/campaign-slice-bootstrap.mjs'
import { createCampaignSliceBootstrapGithubAdapter } from '../../scripts/mission-control/adapters/campaign-slice-bootstrap-github.mjs'
import {
  compareAndSwapIssueBody,
  createMemoryLeaseStore,
  hashIssueBody,
  leasePathForIssue,
} from '../../scripts/mission-control-issue-body-cas.mjs'

type AnyRecord = Record<string, any>

const buildCampaignSliceBootstrapRequestIdentity =
  campaignSliceBootstrapRequestModule.buildCampaignSliceBootstrapRequestIdentity as unknown as (
    input: AnyRecord,
  ) => AnyRecord
const runCampaignSliceBootstrap =
  campaignSliceBootstrapWorkflowModule.runCampaignSliceBootstrap as unknown as (
    input: AnyRecord,
    deps: AnyRecord,
  ) => Promise<AnyRecord>

const REPOSITORY = 'boat1994/bemoat-web-starter'
const CAMPAIGN_ISSUE = 215
const SLICE_ID = 5
const PLANNING_HANDOFF_COMMENT_ID = '5181983011'
const PLANNING_RESULT_COMMENT_ID = '5182110653'
const FOUNDER_AUTHORIZATION_COMMENT_ID = '5181900001'
const PLANNING_BASELINE_SHA = '88b306c7e055751f78b9ced5922607eee2d1037f'
const POLICY_PATH = 'docs/mission-control/mission-control-guide.md'
const POLICY_VERSION = '1.3.0'
const POLICY_BLOB_SHA = 'e79694467b89dace927c27a1022ec3d260a4a43c'
const FIXTURE_PATH = resolve(
  process.cwd(),
  'tests/fixtures/mission-control/campaign-slice-bootstrap/issue-215-slice-5-world.json',
)
const EXACT_HANDOFF_BODY_PATH = resolve(
  process.cwd(),
  'tests/fixtures/mission-control/campaign-slice-bootstrap/planning-handoff-5181983011.exact.md',
)
const EXACT_RESULT_BODY_PATH = resolve(
  process.cwd(),
  'tests/fixtures/mission-control/campaign-slice-bootstrap/planning-result-5182110653.exact.md',
)

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as AnyRecord

const campaignAuthorityBody = readFileSync(
  resolve(process.cwd(), 'tests/fixtures/mission-control/campaign/issue-215-expansion-authority.exact.md'),
  'utf8',
).replace(/\n$/, '')
const campaignEvidence = {
  campaignExpansionAuthority: {
    comments: [
      {
        id: '5158200377',
        body: campaignAuthorityBody,
        issue_url: `https://api.github.com/repos/${REPOSITORY}/issues/${CAMPAIGN_ISSUE}`,
        user: { login: 'boat1994' },
      },
      {
        id: '5152749203',
        body: '## FOUNDER_ARCHITECTURE_DIRECTIVE',
        issue_url: `https://api.github.com/repos/${REPOSITORY}/issues/${CAMPAIGN_ISSUE}`,
        user: { login: 'boat1994' },
      },
      {
        id: '5158205807',
        body: '## FOUNDER_DIRECTIVE',
        issue_url: `https://api.github.com/repos/${REPOSITORY}/issues/${CAMPAIGN_ISSUE}`,
        user: { login: 'boat1994' },
      },
      {
        id: '5158212142',
        body: '## FOUNDER_ARCHITECTURE_DIRECTIVE',
        issue_url: `https://api.github.com/repos/${REPOSITORY}/issues/${CAMPAIGN_ISSUE}`,
        user: { login: 'boat1994' },
      },
    ],
    trustedFounderLogins: ['boat1994'],
    currentProtectedBaseSha: PLANNING_BASELINE_SHA,
  },
}

type FailureMode =
  | 'ambiguous-issue-create'
  | 'after-campaign-before-completion'
  | 'after-final-task-body-before-campaign'
  | 'after-ownership-registry'
  | 'after-provisional-allocation'
  | 'after-task-allocation'
  | 'after-task-initialization'
  | 'before-campaign-projection'
  | 'campaign-cas-conflict'
  | 'task-readback-after-campaign-projection'
  | 'ownership-registry-write'

type WorldOptions = {
  campaignMutation?: (campaign: AnyRecord) => void
  protectedBaseSha?: string
  policyMutation?: (policy: AnyRecord) => void
  provisioned?: boolean
  permissions?: AnyRecord
  failure?: FailureMode
  seedRawTask?: boolean
  seedForgedAttestation?: 'hash-only' | 'wrong-key'
}

function sha256(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function keyMaterial() {
  const pair = generateKeyPairSync('ed25519')
  return {
    privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  }
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function callerAllowlist(overrides: AnyRecord = {}) {
  return {
    founder_authorization_comment_id: FOUNDER_AUTHORIZATION_COMMENT_ID,
    campaign_issue_number: CAMPAIGN_ISSUE,
    slice_id: SLICE_ID,
    planning_handoff_comment_id: PLANNING_HANDOFF_COMMENT_ID,
    planning_result_comment_id: PLANNING_RESULT_COMMENT_ID,
    planning_baseline_sha: PLANNING_BASELINE_SHA,
    ...overrides,
  }
}

function trustedIdentityInput(overrides: AnyRecord = {}): AnyRecord {
  const authorizationBody = fixture.founderAuthorization.body
  const handoffBody = fixture.planningHandoff.body
  const resultBody = fixture.planningResult.body
  return {
    repository: REPOSITORY,
    founderAuthorizationCommentId: FOUNDER_AUTHORIZATION_COMMENT_ID,
    founderAuthorizationBodySha256: sha256(authorizationBody),
    campaignIssueNumber: CAMPAIGN_ISSUE,
    sliceId: SLICE_ID,
    planningHandoffCommentId: PLANNING_HANDOFF_COMMENT_ID,
    planningHandoffBodySha256: sha256(handoffBody),
    planningResultCommentId: PLANNING_RESULT_COMMENT_ID,
    planningResultBodySha256: sha256(resultBody),
    planningBaselineSha: PLANNING_BASELINE_SHA,
    protectedBaseSha: PLANNING_BASELINE_SHA,
    policyPath: POLICY_PATH,
    policyVersion: POLICY_VERSION,
    policySha: POLICY_BLOB_SHA,
    targetState: 'BLOCKED_FOR_FOUNDER_DECISION',
    workflowMode: 'planning_no_pr',
    reviewCycle: 0,
    fullReviewCount: 0,
    activePr: null,
    currentHead: null,
    lastReviewedHead: null,
    ...overrides,
  }
}

function campaignIssue(campaign: AnyRecord) {
  return {
    number: CAMPAIGN_ISSUE,
    id: 'I_campaign_215',
    node_id: 'MDU6SXNzdWUyMTU',
    url: `https://github.com/${REPOSITORY}/issues/${CAMPAIGN_ISSUE}`,
    state: 'open',
    title: 'Campaign #215',
    body: `Campaign state:\n\n${renderCampaign(campaign)}\n`,
  }
}

function bootstrapComments() {
  return [
    clone(fixture.founderAuthorization),
    clone(fixture.planningHandoff),
    clone(fixture.planningResult),
  ]
}

function createWorld(options: WorldOptions = {}) {
  const campaign = clone(fixture.campaign)
  options.campaignMutation?.(campaign)
  const policy = clone(fixture.policy)
  options.policyMutation?.(policy)
  const protectedBase = {
    ref: 'main',
    sha: options.protectedBaseSha ?? fixture.protectedBase.sha,
  }
  const permissions = clone(options.permissions ?? fixture.permissions)
  const comments = new Map<number, AnyRecord[]>([[CAMPAIGN_ISSUE, bootstrapComments()]])
  const issues = new Map<number, AnyRecord>([[CAMPAIGN_ISSUE, campaignIssue(campaign)]])
  const calls = {
    createIssue: 0,
    updateIssueBody: 0,
    campaignProjection: 0,
    postIssueComment: 0,
    founderAuthorityCommentsPosted: 0,
    ownershipRegistryWrites: 0,
    leaseAcquires: 0,
  }
  const failure = {
    mode: options.failure ?? null,
    consumed: false,
    readbackConsumed: false,
  }
  const signingKeys = keyMaterial()
  let nextTaskIssue = 500
  let leaseOwner: string | null = null
  let leaseQueue = Promise.resolve()
  const registryOwners = new Map<string, string>()
  const registryRecords = new Map<string, AnyRecord>()

  const writeIssueBody = async (number: number, body: string, expectedBody?: string) => {
    const issue = issues.get(Number(number))
    if (!issue) throw Object.assign(new Error('issue disappeared'), { code: 'NOT_FOUND' })
    if (expectedBody !== undefined && issue.body !== expectedBody) {
      throw Object.assign(new Error('issue body compare-and-swap expectedBody mismatch'), {
        code: 'CAS_CONFLICT',
      })
    }
    if (Number(number) === CAMPAIGN_ISSUE) {
      calls.campaignProjection += 1
      if (failure.mode === 'campaign-cas-conflict' && !failure.consumed) {
        failure.consumed = true
        throw Object.assign(new Error('campaign projection compare-and-swap conflict'), { code: 'CAS_CONFLICT' })
      }
    }
    calls.updateIssueBody += 1
    issue.body = body
    return clone(issue)
  }

  const getIssue = async (number: number) => {
    const issue = issues.get(Number(number))
    if (!issue) throw Object.assign(new Error('404 Not Found'), { code: 'NOT_FOUND' })
    if (
      failure.mode === 'task-readback-after-campaign-projection' &&
      Number(number) !== CAMPAIGN_ISSUE &&
      calls.campaignProjection > 0 &&
      !failure.readbackConsumed
    ) {
      failure.readbackConsumed = true
      throw Object.assign(new Error('Task readback unavailable after campaign projection'), {
        code: 'API_AMBIGUITY',
      })
    }
    return clone(issue)
  }

  const acquireLease = async ({ requestId }: { requestId: string }) => {
    calls.leaseAcquires += 1
    const previous = leaseQueue
    let releaseQueue!: () => void
    leaseQueue = new Promise((resolve) => {
      releaseQueue = resolve
    })
    await previous
    if (leaseOwner && leaseOwner !== requestId) {
      releaseQueue()
      throw Object.assign(new Error('different request already owns the campaign slice lease'), {
        code: 'CAS_CONFLICT',
      })
    }
    leaseOwner = requestId
    return {
      token: requestId,
      release: () => {
        if (leaseOwner === requestId) leaseOwner = null
        releaseQueue()
      },
    }
  }

  const world = {
    campaign,
    campaignEvidence,
    signingKeys,
    issues,
    comments,
    calls,
    failure,
    ownershipRecords: registryRecords,
    async getRepository() {
      return clone(fixture.repository)
    },
    async getWorkflowPermissions() {
      return clone(permissions)
    },
    async getPermissions() {
      return clone(permissions)
    },
    async getChildRepositoryProvisioning() {
      return {
        childRepository: options.provisioned ?? fixture.provisioning.childRepository,
        workflow: fixture.provisioning.workflow,
      }
    },
    async isChildRepositoryProvisioned() {
      return options.provisioned ?? fixture.provisioning.childRepository
    },
    async getFounderLogins() {
      return clone(fixture.founderLogins)
    },
    async getTrustedFounderLogins() {
      return clone(fixture.founderLogins)
    },
    async getBranchCommit(ref: string) {
      if (ref !== protectedBase.ref) throw new Error(`unexpected protected branch ${ref}`)
      return clone(protectedBase)
    },
    async getProtectedBase() {
      return clone(protectedBase)
    },
    async getPolicy() {
      return clone(policy)
    },
    async getCampaignAuthorityEvidence() {
      return clone(campaignEvidence)
    },
    async getIssue(number: number) {
      return getIssue(number)
    },
    async listIssues() {
      return [...issues.values()].map((value) => clone(value))
    },
    async getIssueComments(number: number) {
      return clone(comments.get(Number(number)) ?? [])
    },
    async listIssueComments(number: number) {
      return clone(comments.get(Number(number)) ?? [])
    },
    async getIssueComment(id: string | number) {
      for (const entries of comments.values()) {
        const comment = entries.find((entry) => String(entry.id) === String(id))
        if (comment) return clone(comment)
      }
      throw Object.assign(new Error('404 Not Found'), { code: 'NOT_FOUND' })
    },
    async createIssue(input: AnyRecord) {
      calls.createIssue += 1
      const number = nextTaskIssue
      nextTaskIssue += 1
      const issue = {
        number,
        id: `I_task_${number}`,
        node_id: `MDU6SXNzdWV${number}`,
        url: `https://github.com/${REPOSITORY}/issues/${number}`,
        state: 'open',
        title: input.title,
        body: input.body,
      }
      if (failure.mode === 'ambiguous-issue-create' && !failure.consumed) {
        failure.consumed = true
        throw Object.assign(new Error('Issue create response lost'), { code: 'API_AMBIGUITY' })
      }
      issues.set(number, issue)
      comments.set(number, [])
      return clone(issue)
    },
    async updateIssueBody(number: number, body: string) {
      return writeIssueBody(number, body)
    },
    async compareAndSwapIssueBody(input: {
      number: number
      expectedBody: string
      body: string
    }) {
      return writeIssueBody(input.number, input.body, input.expectedBody)
    },
    async postIssueComment(number: number, body: string) {
      calls.postIssueComment += 1
      if (/FOUNDER_AUTHORIZATION|Founder authority/i.test(body)) {
        calls.founderAuthorityCommentsPosted += 1
      }
      const entries = comments.get(Number(number)) ?? []
      const comment = {
        id: String(9000000000 + calls.postIssueComment),
        body,
        user: { login: 'github-actions[bot]' },
        issue_number: Number(number),
        created_at: '2026-08-05T00:00:00Z',
        updated_at: '2026-08-05T00:00:00Z',
      }
      entries.push(comment)
      comments.set(Number(number), entries)
      return clone(comment)
    },
    async writeOwnershipRegistry(input: { requestId: string; taskIssueNumber: number; record?: AnyRecord }) {
      calls.ownershipRegistryWrites += 1
      if (failure.mode === 'ownership-registry-write' && !failure.consumed) {
        failure.consumed = true
        throw Object.assign(new Error('ownership registry write unavailable'), {
          code: 'API_AMBIGUITY',
        })
      }
      const owner = registryOwners.get(input.requestId)
      if (owner && owner !== String(input.taskIssueNumber)) {
        throw Object.assign(new Error('request already owns a different Task'), { code: 'STATE_CONFLICT' })
      }
      registryOwners.set(input.requestId, String(input.taskIssueNumber))
      if (input.record) registryRecords.set(input.requestId, clone(input.record))
      return { ok: true, requestId: input.requestId, taskIssueNumber: input.taskIssueNumber }
    },
    async bindCampaignSliceOwnership(input: { requestId: string; taskIssueNumber: number; record?: AnyRecord }) {
      return this.writeOwnershipRegistry(input)
    },
    async getCampaignSliceOwnershipRecords() {
      return [...registryRecords.values()].map((record) => ({ record: clone(record) }))
    },
    async acquireCampaignLease(input: { requestId: string }) {
      return acquireLease(input)
    },
    async acquireTaskAllocationLease(input: { requestId: string }) {
      return acquireLease(input)
    },
    async acquireCreationLease(input: { requestId: string }) {
      return acquireLease(input)
    },
    async releaseCampaignLease(input: { lease?: { release?: () => void } }) {
      input.lease?.release?.()
    },
    async releaseTaskAllocationLease(input: { lease?: { release?: () => void } }) {
      input.lease?.release?.()
    },
    async releaseCreationLease(input: { lease?: { release?: () => void } }) {
      input.lease?.release?.()
    },
    async injectFailure(checkpoint: string) {
      const expected = {
        'after-task-allocation': ['after-task-allocation', 'after-provisional-allocation'],
        'after-task-initialization': [
          'after-task-initialization',
          'after-final-task-body-before-campaign',
        ],
        'after-ownership-before-final-body': [
          'after-ownership-before-final-body',
          'after-ownership-registry',
        ],
        'before-campaign-projection': ['before-campaign-projection'],
        'after-ownership-registry': ['after-ownership-registry'],
        'after-campaign-before-completion': ['after-campaign-before-completion'],
      }[checkpoint] ?? [checkpoint]
      if (expected.includes(String(failure.mode ?? '')) && failure.consumed !== true) {
        failure.consumed = true
        throw Object.assign(new Error(`injected failure at ${checkpoint}`), {
          code: 'PROJECTION_FAILED',
        })
      }
    },
    taskIssues() {
      return [...issues.values()].filter((issue) => Number(issue.number) !== CAMPAIGN_ISSUE)
    },
    campaignIssue() {
      return issues.get(CAMPAIGN_ISSUE) as AnyRecord
    },
  }

  if (options.seedRawTask) {
    const requestId = buildCampaignSliceBootstrapRequestIdentity(trustedIdentityInput()).requestId
    const payload = {
      repository: REPOSITORY,
      campaign_issue_number: CAMPAIGN_ISSUE,
      slice_id: SLICE_ID,
      request_id: requestId,
    }
    const forged = options.seedForgedAttestation === 'wrong-key'
      ? createCampaignSliceBootstrapAttestation({
        payload,
        privateKey: keyMaterial().privateKey,
        keyId: 'attacker-key',
      })
      : {
        schema_version: 1,
        attestation_schema: CAMPAIGN_SLICE_BOOTSTRAP_ATTESTATION_SCHEMA,
        operation: CAMPAIGN_SLICE_BOOTSTRAP_ATTESTATION_OPERATION,
        operation_version: 1,
        algorithm: 'SHA-256-BINDING',
        key_id: 'campaign-slice-bootstrap-v1',
        payload,
        payload_sha256: sha256(canonicalSerialize({
          attestation_schema: CAMPAIGN_SLICE_BOOTSTRAP_ATTESTATION_SCHEMA,
          key_id: 'campaign-slice-bootstrap-v1',
          operation: CAMPAIGN_SLICE_BOOTSTRAP_ATTESTATION_OPERATION,
          operation_version: 1,
          payload,
        })),
      }
    const rawTask = {
      number: 499,
      id: 'I_raw_task_499',
      node_id: 'MDU6SXNzdWV499',
      state: 'open',
      title: 'raw task created without accepted provenance',
      body: options.seedForgedAttestation
        ? `<!-- bemoat-mission-control-campaign-slice-bootstrap:attestation:v1 -->\n\`\`\`json\n${JSON.stringify(forged, null, 2)}\n\`\`\`\n<!-- bemoat-mission-control-campaign-slice-bootstrap:attestation:end -->`
        : 'Raw Issue created directly by a caller.\n',
    }
    issues.set(rawTask.number, rawTask)
    comments.set(rawTask.number, [])
  }

  return world
}

function depsFor(world: ReturnType<typeof createWorld>) {
  return {
    github: world,
    publicKey: world.signingKeys.publicKey,
    signingPrivateKey: world.signingKeys.privateKey,
    signingKeyId: 'campaign-slice-bootstrap-test-key',
    failureInjector: world.injectFailure,
    now: () => '2026-08-05T00:00:00.000Z',
  }
}

function createProductionAdapterWorld(world: ReturnType<typeof createWorld>) {
  const contentsLeaseStore = createMemoryLeaseStore()
  const ghCalls: string[][] = []
  const policyContent = readFileSync(POLICY_PATH, 'utf8')
  let nextTaskIssue = 500
  const campaignComments = world.comments.get(CAMPAIGN_ISSUE) ?? []
  campaignComments.find((comment) => String(comment.id) === PLANNING_HANDOFF_COMMENT_ID)!.body =
    readFileSync(EXACT_HANDOFF_BODY_PATH, 'utf8')
  const planningResult = campaignComments.find(
    (comment) => String(comment.id) === PLANNING_RESULT_COMMENT_ID,
  )!
  planningResult.body = readFileSync(EXACT_RESULT_BODY_PATH, 'utf8')
  if (!planningResult.body.includes('**Slice:** 5')) {
    planningResult.body = `${planningResult.body}\n**Slice:** 5\n`
  }
  for (const authorityComment of campaignEvidence.campaignExpansionAuthority.comments) {
    if (!campaignComments.some((comment) => String(comment.id) === String(authorityComment.id))) {
      campaignComments.push(clone(authorityComment))
    }
  }

  const notFound = (message = '404 Not Found') => {
    const error = Object.assign(new Error(message), { code: 'NOT_FOUND' })
    throw error
  }

  const restIssue = (issue: AnyRecord) => ({
    ...clone(issue),
    html_url: issue.url,
  })

  const restComment = (comment: AnyRecord) => ({
    ...clone(comment),
    issue_url: comment.issue_url ?? `https://api.github.com/repos/${REPOSITORY}/issues/${comment.issue_number}`,
  })

  const createComment = (issueNumber: number, body: string) => {
    world.calls.postIssueComment += 1
    if (/FOUNDER_AUTHORIZATION|Founder authority/i.test(body)) {
      world.calls.founderAuthorityCommentsPosted += 1
    }
    const comment = {
      id: String(9000000000 + world.calls.postIssueComment),
      body,
      user: { login: 'github-actions[bot]' },
      issue_number: issueNumber,
      issue_url: `https://api.github.com/repos/${REPOSITORY}/issues/${issueNumber}`,
      created_at: '2026-08-05T00:00:00Z',
      updated_at: '2026-08-05T00:00:00Z',
    }
    const entries = world.comments.get(issueNumber) ?? []
    entries.push(comment)
    world.comments.set(issueNumber, entries)
    return comment
  }

  const createIssue = (input: AnyRecord) => {
    world.calls.createIssue += 1
    const number = nextTaskIssue
    nextTaskIssue += 1
    const issue = {
      number,
      id: `I_task_${number}`,
      node_id: `MDU6SXNzdWV${number}`,
      url: `https://github.com/${REPOSITORY}/issues/${number}`,
      state: 'open',
      title: input.title,
      body: input.body,
    }
    world.issues.set(number, issue)
    world.comments.set(number, [])
    return issue
  }

  const runGh = (args: string[], options: AnyRecord = {}) => {
    ghCalls.push([...args])
    if (args[0] !== 'api') throw new Error(`unexpected gh command: ${args.join(' ')}`)
    const route = args.find((argument) => argument.startsWith('repos/'))
    if (!route) throw new Error(`missing GitHub API route: ${args.join(' ')}`)
    const path = route.split('?')[0]
    const methodIndex = args.findIndex((argument) => argument === '--method' || argument === '-X')
    const method = methodIndex >= 0 ? String(args[methodIndex + 1]).toUpperCase() : 'GET'
    const input = options.input ? JSON.parse(options.input) : null
    const issueMatch = path.match(/^repos\/[^/]+\/[^/]+\/issues\/(\d+)$/)
    const commentsMatch = path.match(/^repos\/[^/]+\/[^/]+\/issues\/(\d+)\/comments$/)
    const commentMatch = path.match(/^repos\/[^/]+\/[^/]+\/issues\/comments\/(\d+)$/)
    const leaseMatch = path.match(/^repos\/[^/]+\/[^/]+\/contents\/(.+)$/)
    const branchMatch = path.match(/^repos\/[^/]+\/[^/]+\/git\/ref\/heads\/(.+)$/)

    if (method === 'POST' && commentsMatch) {
      return JSON.stringify(restComment(createComment(Number(commentsMatch[1]), input.body)))
    }
    if (method === 'POST' && path === `repos/${REPOSITORY}/issues`) {
      return JSON.stringify(restIssue(createIssue(input)))
    }
    if (method === 'PATCH' && issueMatch) {
      const issue = world.issues.get(Number(issueMatch[1]))
      if (!issue) notFound(`404 Issue #${issueMatch[1]}`)
      issue.body = input.body
      world.calls.updateIssueBody += 1
      if (Number(issueMatch[1]) === CAMPAIGN_ISSUE) world.calls.campaignProjection += 1
      return JSON.stringify(restIssue(issue))
    }
    if (method === 'PUT' && leaseMatch) {
      const leasePath = decodeURIComponent(leaseMatch[1])
      const content = JSON.parse(Buffer.from(String(input.content), 'base64').toString('utf8'))
      try {
        const result = awaitableContentsWrite(contentsLeaseStore, {
          path: leasePath,
          content,
          sha: input.sha,
        })
        return JSON.stringify({
          content: { sha: result.sha },
          commit: { sha: `lease-commit-${result.sha}` },
        })
      } catch (error) {
        const typedError = error as AnyRecord
        const conflict = Object.assign(new Error('422 sha mismatch'), {
          code: typedError.code ?? 'CAS_CONFLICT',
        })
        throw conflict
      }
    }
    if (leaseMatch && leaseMatch[1].startsWith('.bemoat/mission-control/leases/')) {
      const leasePath = decodeURIComponent(leaseMatch[1])
      const current = contentsLeaseStore._dump().get(leasePath)
      if (!current) notFound(`404 lease ${leasePath}`)
      return JSON.stringify({
        content: {
          content: Buffer.from(`${JSON.stringify(current.content)}\n`, 'utf8').toString('base64'),
          sha: current.sha,
        },
      })
    }
    if (branchMatch) {
      if (decodeURIComponent(branchMatch[1]) === 'main') {
        return JSON.stringify({ object: { sha: fixture.protectedBase.sha } })
      }
      return JSON.stringify({ object: { sha: 'lease-branch-tip' } })
    }
    if (commentMatch) {
      const commentId = String(commentMatch[1])
      for (const entries of world.comments.values()) {
        const comment = entries.find((entry) => String(entry.id) === commentId)
        if (comment) return JSON.stringify(restComment(comment))
      }
      notFound(`404 comment ${commentId}`)
    }
    if (commentsMatch) {
      const comments = world.comments.get(Number(commentsMatch[1])) ?? []
      return JSON.stringify(comments.map(restComment))
    }
    if (issueMatch) {
      const issue = world.issues.get(Number(issueMatch[1]))
      if (!issue) notFound(`404 Issue #${issueMatch[1]}`)
      return JSON.stringify(restIssue(issue))
    }
    if (path === `repos/${REPOSITORY}/issues`) {
      return JSON.stringify([...world.issues.values()].map(restIssue))
    }
    if (path === `repos/${REPOSITORY}`) {
      return JSON.stringify({
        full_name: REPOSITORY,
        id: 'R_repository',
        node_id: 'R_node_repository',
        default_branch: 'main',
      })
    }
    if (path === `repos/${REPOSITORY}/contents/.github/workflows/mission-control-campaign-slice-bootstrap.yml`) {
      return JSON.stringify({
        content: Buffer.from('permissions:\n  issues: write\n  contents: write\n', 'utf8').toString('base64'),
        sha: 'workflow-sha',
      })
    }
    if (path === `repos/${REPOSITORY}/contents/${POLICY_PATH}`) {
      return JSON.stringify({
        content: Buffer.from(policyContent, 'utf8').toString('base64'),
        sha: POLICY_BLOB_SHA,
      })
    }
    throw new Error(`unexpected GitHub API request: ${args.join(' ')}`)
  }

  const createAdapter = createCampaignSliceBootstrapGithubAdapter as unknown as (
    input: AnyRecord,
  ) => AnyRecord
  const github = createAdapter({
    repository: REPOSITORY,
    env: { BEMOAT_FOUNDER_LOGINS: 'boat1994' } as unknown as NodeJS.ProcessEnv,
    runGh,
    leaseStore: contentsLeaseStore,
  })

  const projectionCalls = { directUpdate: 0, compareAndSwap: [] as number[] }
  const originalUpdateIssueBody = github.updateIssueBody
  const originalCompareAndSwapIssueBody = github.compareAndSwapIssueBody
  github.updateIssueBody = async (number: number, body: string) => {
    projectionCalls.directUpdate += 1
    return originalUpdateIssueBody(number, body)
  }
  github.compareAndSwapIssueBody = async (input: AnyRecord) => {
    projectionCalls.compareAndSwap.push(Number(input.number))
    return originalCompareAndSwapIssueBody.call(github, input)
  }

  return { github, contentsLeaseStore, ghCalls, projectionCalls }
}

function awaitableContentsWrite(
  store: ReturnType<typeof createMemoryLeaseStore>,
  input: { path: string; content: AnyRecord; sha?: string },
) {
  const current = store._dump().get(input.path)
  if (current && input.sha !== current.sha) {
    throw Object.assign(new Error('CAS_CONFLICT: lease blob sha mismatch'), { code: 'CAS_CONFLICT' })
  }
  if (!current && input.sha) {
    throw Object.assign(new Error('CAS_CONFLICT: lease blob missing for provided sha'), { code: 'CAS_CONFLICT' })
  }
  const next = {
    sha: hashIssueBody(`${input.path}:${JSON.stringify(input.content)}:${Math.random()}`),
    content: clone(input.content),
  }
  store._dump().set(input.path, next)
  return next
}

async function invoke(
  world: ReturnType<typeof createWorld>,
  input: AnyRecord = callerAllowlist(),
) {
  try {
    return await runCampaignSliceBootstrap(input, depsFor(world))
  } catch (error) {
    const typed = error as AnyRecord
    return {
      ok: false,
      outcome: typed.code ?? typed.classification ?? 'THROWN',
      error,
    }
  }
}

function campaignSliceProvisionalBody(
  task: AnyRecord,
  signed = true,
  signingPrivateKey = keyMaterial().privateKey,
) {
  const request = buildCampaignSliceBootstrapRequestIdentity(trustedIdentityInput())
  const boundTask = signed
    ? task
    : { number: 498, id: 'I_source', node_id: 'N_source' }
  return renderCampaignSliceBootstrapProvisionalTaskBody({
    requestId: request.requestId,
    repository: REPOSITORY,
    campaignIssueNumber: CAMPAIGN_ISSUE,
    sliceId: SLICE_ID,
    founderAuthorizationCommentId: FOUNDER_AUTHORIZATION_COMMENT_ID,
    planningHandoffCommentId: PLANNING_HANDOFF_COMMENT_ID,
    planningResultCommentId: PLANNING_RESULT_COMMENT_ID,
    planningBaselineSha: PLANNING_BASELINE_SHA,
    protectedBaseSha: PLANNING_BASELINE_SHA,
    policyPath: POLICY_PATH,
    policyVersion: POLICY_VERSION,
    policySha: POLICY_BLOB_SHA,
    taskIssue: boundTask,
    privateKey: signingPrivateKey,
    keyId: 'campaign-slice-bootstrap-test-key',
  })
}

function provisionalIssue(task: AnyRecord, body: string) {
  return {
    number: Number(task.number),
    id: String(task.id),
    node_id: String(task.node_id),
    url: `https://github.com/${REPOSITORY}/issues/${task.number}`,
    state: 'open',
    title: '[Mission Control][Provisional] Campaign Slice 5 planning Task bootstrap',
    body,
  }
}

function expectIncompleteTask(world: ReturnType<typeof createWorld>) {
  const tasks = world.taskIssues()
  expect(tasks).toHaveLength(1)
  const state = parseMissionControlState(String(tasks[0].body))
  expect(state).toMatchObject({
    valid: false,
  })
  return tasks[0]
}

function expectOutcome(result: AnyRecord, outcome: string) {
  expect(result.outcome).toBe(outcome)
}

function expectSingleTaskNumber(world: ReturnType<typeof createWorld>) {
  const tasks = world.taskIssues()
  expect(tasks).toHaveLength(1)
  return tasks[0]?.number
}

function expectSuccessfulProjection(world: ReturnType<typeof createWorld>, result: AnyRecord) {
  expect(result).toMatchObject({ ok: true, outcome: 'SUCCESS' })
  expect(world.calls.createIssue).toBe(1)
  expect(world.taskIssues()).toHaveLength(1)
  const task = world.taskIssues()[0]
  const state = parseMissionControlState(String(task.body))
  expect(state).toMatchObject({
    present: true,
    valid: true,
    state: {
      state: 'BLOCKED_FOR_FOUNDER_DECISION',
      review_cycle: 0,
      full_review_count: 0,
      active_pr: null,
      current_head: null,
      last_reviewed_head: null,
      workflow_mode: 'planning_no_pr',
      planning_authorization_base_sha: PLANNING_BASELINE_SHA,
    },
  })
  const campaign = parseCampaign(world.campaignIssue().body, {
    evidence: world.campaignEvidence,
  })
  expect(campaign).toMatchObject({ present: true, valid: true })
  const campaignState = campaign.campaign as AnyRecord
  expect(campaignState?.slices?.['5']).toMatchObject({
    status: 'PLANNING',
    issue: `#${task.number}`,
    pr: null,
    reviewed_head: null,
    merged_commit: null,
    authority_comment_ids: expect.arrayContaining([
      FOUNDER_AUTHORIZATION_COMMENT_ID,
      PLANNING_HANDOFF_COMMENT_ID,
      PLANNING_RESULT_COMMENT_ID,
    ]),
  })
  expect(String(task.body)).toContain(CAMPAIGN_SLICE_BOOTSTRAP_ATTESTATION_SCHEMA)
  expect(String(task.body)).toContain(CAMPAIGN_SLICE_BOOTSTRAP_OPERATION)
  expect(String(task.body)).not.toContain(PROVISIONAL_TASK_MARKER)
  return task
}

describe('campaign-slice bootstrap Design B contract', () => {
  it('bootstraps the exact simulated #215 Slice 5 planning path', async () => {
    const world = createWorld()
    const result = await invoke(world)

    expectSuccessfulProjection(world, result)
  })

  it('accepts exact live HANDOFF and RESULT bodies with numeric REST IDs', async () => {
    expect(fixture.planningHandoff.id).toBe(5181983011)
    expect(fixture.planningResult.id).toBe(5182110653)
    expect(fixture.planningHandoff.body).toBe(readFileSync(EXACT_HANDOFF_BODY_PATH, 'utf8'))
    expect(fixture.planningResult.body).toBe(readFileSync(EXACT_RESULT_BODY_PATH, 'utf8'))

    const world = createWorld()
    const comments = world.comments.get(CAMPAIGN_ISSUE) ?? []
    expect(comments.find((comment) => comment.id === 5181983011)?.body).toBe(
      readFileSync(EXACT_HANDOFF_BODY_PATH, 'utf8'),
    )
    expect(comments.find((comment) => comment.id === 5182110653)?.body).toBe(
      readFileSync(EXACT_RESULT_BODY_PATH, 'utf8'),
    )

    const result = await invoke(world)

    expectSuccessfulProjection(world, result)
  })

  it('normalizes numeric REST IDs to string identities in projection and readback', async () => {
    const world = createWorld()
    const first = await invoke(world, callerAllowlist({
      founder_authorization_comment_id: String(fixture.founderAuthorization.id),
      planning_handoff_comment_id: String(fixture.planningHandoff.id),
      planning_result_comment_id: String(fixture.planningResult.id),
    }))
    const task = expectSuccessfulProjection(world, first)
    const state = parseMissionControlState(String(task.body))
    const record = [...world.ownershipRecords.values()][0]

    expect(state.state?.latest_result_comment_id).toMatch(/^[1-9]\d*$/)
    expect(state.state?.latest_result_comment_id).not.toBe(PLANNING_RESULT_COMMENT_ID)
    expect(state.state?.planning_result_comment_id).toBe(PLANNING_RESULT_COMMENT_ID)
    expect(state.state?.planning_handoff_comment_id).toBe(PLANNING_HANDOFF_COMMENT_ID)
    expect(record.payload.authority_comment_ids).toEqual([
      FOUNDER_AUTHORIZATION_COMMENT_ID,
      PLANNING_HANDOFF_COMMENT_ID,
      PLANNING_RESULT_COMMENT_ID,
    ])
    expect(record.payload.authority_comment_ids.every((id: unknown) => typeof id === 'string')).toBe(true)

    const retry = await invoke(world)

    expect(retry).toMatchObject({
      ok: true,
      outcome: 'NO_OP',
      requestId: first.requestId,
    })
    expect(retry.attestation.payload.planning_handoff_comment_id).toBe(
      PLANNING_HANDOFF_COMMENT_ID,
    )
    expect(retry.attestation.payload.planning_result_comment_id).toBe(
      PLANNING_RESULT_COMMENT_ID,
    )
  })

  it('returns NO_OP for an identical completed retry with the same Task', async () => {
    const world = createWorld()
    const first = await invoke(world)
    const task = expectSuccessfulProjection(world, first)
    const retry = await invoke(world)

    expect(retry).toMatchObject({
      ok: true,
      outcome: 'NO_OP',
    })
    expect(world.taskIssues()).toHaveLength(1)
    expect(world.taskIssues()[0].number).toBe(task.number)
  })

  it('verifies the signed ownership registry again on an identical retry', async () => {
    const world = createWorld()
    const first = await invoke(world)
    expect(first).toMatchObject({ ok: true, outcome: 'SUCCESS' })
    const record = [...world.ownershipRecords.values()][0]
    record.signature_base64 = `${record.signature_base64.slice(0, -2)}AA`

    const retry = await invoke(world)

    expectOutcome(retry, 'STATE_CONFLICT')
  })

  it('allocates at most one Task Issue for a request identity', async () => {
    const world = createWorld()
    await invoke(world)
    await invoke(world)

    expect(world.calls.createIssue).toBe(1)
    expect(world.taskIssues()).toHaveLength(1)
  })

  it('accepts exactly one Founder-authority comment for the completed request', async () => {
    const world = createWorld()
    await invoke(world)
    await invoke(world)

    const authorityComments = world.comments.get(CAMPAIGN_ISSUE)?.filter(
      (comment) => /FOUNDER_AUTHORIZATION/.test(String(comment.body)),
    )
    expect(authorityComments).toHaveLength(1)
    expect(String(authorityComments?.[0].id)).toBe(FOUNDER_AUTHORIZATION_COMMENT_ID)
    expect(world.calls.founderAuthorityCommentsPosted).toBe(0)
  })

  it('rejects an occupied Campaign slice without allocating a Task', async () => {
    const world = createWorld({
      campaignMutation: (campaign) => {
        campaign.slices['5'] = {
          ...campaign.slices['5'],
          status: 'PLANNING',
          issue: '#499',
        }
      },
    })

    const result = await invoke(world)

    expectOutcome(result, 'STATE_CONFLICT')
    expect(world.calls.createIssue).toBe(0)
  })

  it('rejects a Campaign slice that is not NOT_STARTED', async () => {
    const world = createWorld({
      campaignMutation: (campaign) => {
        campaign.slices['5'].status = 'BLOCKED'
      },
    })

    const result = await invoke(world)

    expectOutcome(result, 'STATE_CONFLICT')
    expect(world.calls.createIssue).toBe(0)
  })

  it('rejects a caller-selected Campaign other than the verified #215 Campaign', async () => {
    const world = createWorld()

    const result = await invoke(world, callerAllowlist({ campaign_issue_number: 214 }))

    expectOutcome(result, 'STATE_CONFLICT')
    expect(world.calls.createIssue).toBe(0)
  })

  it('rejects a caller-selected Slice that does not match the verified planning evidence', async () => {
    const world = createWorld()

    const result = await invoke(world, callerAllowlist({ slice_id: 6 }))

    expectOutcome(result, 'STATE_CONFLICT')
    expect(world.calls.createIssue).toBe(0)
  })

  it('MC-R1-001 allows protected execution base to advance beyond historical planning baseline', async () => {
    const executionSha = '99'.repeat(20)
    const world = createWorld({
      protectedBaseSha: executionSha,
    })
    world.campaignEvidence.campaignExpansionAuthority.currentProtectedBaseSha = PLANNING_BASELINE_SHA

    const result = await invoke(world)

    expectSuccessfulProjection(world, result)
    expect(result.attestation.payload.planning_baseline_sha).toBe(PLANNING_BASELINE_SHA)
    expect(result.attestation.payload.protected_base_sha).toBe(executionSha)
    expect(result.attestation.payload.planning_baseline_sha).not.toBe(result.attestation.payload.protected_base_sha)
  })

  it('rejects a changed policy identity before mutation', async () => {
    const world = createWorld({
      policyMutation: (policy) => {
        policy.blobSha = 'aa'.repeat(20)
      },
    })

    const result = await invoke(world)

    expectOutcome(result, 'STATE_CONFLICT')
    expect(world.calls.createIssue).toBe(0)
  })

  it('rejects stale planning HANDOFF evidence', async () => {
    const world = createWorld()
    const handoff = world.comments.get(CAMPAIGN_ISSUE)?.find(
      (comment) => String(comment.id) === PLANNING_HANDOFF_COMMENT_ID,
    )
    expect(handoff).toBeDefined()
    handoff!.body = handoff!.body.replaceAll(PLANNING_BASELINE_SHA, 'aa'.repeat(20))

    const result = await invoke(world)

    expectOutcome(result, 'STATE_CONFLICT')
    expect(world.calls.createIssue).toBe(0)
  })

  it('rejects superseded planning HANDOFF evidence', async () => {
    const world = createWorld()
    world.comments.get(CAMPAIGN_ISSUE)?.push({
      id: '5181983012',
      body: `## HANDOFF\n\nsupersedes_comment_id: ${PLANNING_HANDOFF_COMMENT_ID}\n`,
      user: { login: 'boat1994' },
      issue_number: CAMPAIGN_ISSUE,
    })

    const result = await invoke(world)

    expectOutcome(result, 'STATE_CONFLICT')
    expect(world.calls.createIssue).toBe(0)
  })

  it('rejects stale planning RESULT evidence', async () => {
    const world = createWorld()
    const resultComment = world.comments.get(CAMPAIGN_ISSUE)?.find(
      (comment) => String(comment.id) === PLANNING_RESULT_COMMENT_ID,
    )
    expect(resultComment).toBeDefined()
    resultComment!.body = resultComment!.body.replaceAll(PLANNING_BASELINE_SHA, 'bb'.repeat(20))

    const result = await invoke(world)

    expectOutcome(result, 'STATE_CONFLICT')
    expect(world.calls.createIssue).toBe(0)
  })

  it('rejects superseded planning RESULT evidence', async () => {
    const world = createWorld()
    world.comments.get(CAMPAIGN_ISSUE)?.push({
      id: '5182110654',
      body: `## RESULT\n\nsupersedes_comment_id: ${PLANNING_RESULT_COMMENT_ID}\n`,
      user: { login: 'boat1994' },
      issue_number: CAMPAIGN_ISSUE,
    })

    const result = await invoke(world)

    expectOutcome(result, 'STATE_CONFLICT')
    expect(world.calls.createIssue).toBe(0)
  })

  it('rejects Founder authority from an untrusted login', async () => {
    const world = createWorld()
    const authorization = world.comments.get(CAMPAIGN_ISSUE)?.find(
      (comment) => String(comment.id) === FOUNDER_AUTHORIZATION_COMMENT_ID,
    )
    expect(authorization).toBeDefined()
    authorization!.user.login = 'untrusted-user'

    const result = await invoke(world)

    expectOutcome(result, 'STATE_CONFLICT')
    expect(world.calls.createIssue).toBe(0)
  })

  it('rejects forged Founder provenance even when the body claims approval', async () => {
    const world = createWorld()
    const authorization = world.comments.get(CAMPAIGN_ISSUE)?.find(
      (comment) => String(comment.id) === FOUNDER_AUTHORIZATION_COMMENT_ID,
    )
    expect(authorization).toBeDefined()
    authorization!.user = { login: 'github-actions[bot]' }
    authorization!.body = `${authorization!.body}\nForged founder provenance.\n`

    const result = await invoke(world)

    expectOutcome(result, 'STATE_CONFLICT')
    expect(world.calls.createIssue).toBe(0)
  })

  it('ignores a raw Issue without campaign-slice markers and allocates a trusted Task', async () => {
    const world = createWorld({ seedRawTask: true })

    const result = await invoke(world)

    expect(result).toMatchObject({ ok: true, outcome: 'SUCCESS' })
    expect(world.calls.createIssue).toBe(1)
    expect(world.taskIssues().some((issue) => issue.number === 499)).toBe(true)
    expect(world.taskIssues().some((issue) => issue.number === 500)).toBe(true)
  })

  it.each(['hash-only', 'wrong-key'] as const)(
    'rejects a forged final attestation (%s) as STATE_CONFLICT',
    async (kind) => {
      const world = createWorld({ seedRawTask: true, seedForgedAttestation: kind })

      const result = await invoke(world)

      expectOutcome(result, 'STATE_CONFLICT')
      expect(world.calls.createIssue).toBe(0)
    },
  )

  it('rejects a wrong-key replacement of an otherwise canonical final attestation', async () => {
    const world = createWorld()
    const first = await invoke(world)
    expect(first).toMatchObject({ ok: true, outcome: 'SUCCESS' })
    const task = world.taskIssues()[0]
    const markerStart = '<!-- bemoat-mission-control-campaign-slice-bootstrap:attestation:v1 -->'
    const markerEnd = '<!-- bemoat-mission-control-campaign-slice-bootstrap:attestation:end -->'
    const raw = task.body.slice(
      task.body.indexOf(markerStart) + markerStart.length,
      task.body.indexOf(markerEnd),
    ).replace(/```json\s*|```/g, '').trim()
    const original = JSON.parse(raw)
    const forged = createCampaignSliceBootstrapAttestation({
      payload: original.payload,
      privateKey: keyMaterial().privateKey,
      keyId: 'attacker-key',
    })
    task.body = task.body.replace(JSON.stringify(original, null, 2), JSON.stringify(forged, null, 2))

    const retry = await invoke(world)

    expectOutcome(retry, 'STATE_CONFLICT')
  })

  it('MC-R1-003 rejects a copied matching provisional marker without blocking fresh allocation', async () => {
    const world = createWorld()
    const forgedIdentity = { number: 499, id: 'I_forged', node_id: 'N_forged' }
    const forged = provisionalIssue(
      forgedIdentity,
      campaignSliceProvisionalBody(forgedIdentity, false),
    )
    world.issues.set(forged.number, forged)
    world.comments.set(forged.number, [])

    const result = await invoke(world)

    expect(result).toMatchObject({ ok: true, outcome: 'SUCCESS' })
    expect(world.calls.createIssue).toBe(1)
    expect(world.issues.get(forged.number)?.body).toBe(forged.body)
    expect(world.campaignIssue().body).toContain('#500')
    expect(world.taskIssues().some((issue) => issue.number === 499)).toBe(true)
    expect(world.taskIssues().some((issue) => issue.number === 500)).toBe(true)

    const retry = await invoke(world)
    expect(retry).toMatchObject({ ok: true, outcome: 'NO_OP' })
    expect(world.calls.createIssue).toBe(1)
  })

  it('MC-R1-003 ignores unrelated Task-like Issues such as live Issue #274', async () => {
    const world = createWorld()
    const unrelated = {
      number: 274,
      id: 'I_issue_274',
      node_id: 'MDU6SXNzdWV274',
      url: `https://github.com/${REPOSITORY}/issues/274`,
      state: 'open',
      title: 'feat: add protected campaign-slice managed Task bootstrap',
      body: 'This ordinary implementation Task contains the word task but no campaign-slice bootstrap namespace.\n',
    }
    world.issues.set(unrelated.number, unrelated)
    world.comments.set(unrelated.number, [])

    const result = await invoke(world)

    expect(result).toMatchObject({ ok: true, outcome: 'SUCCESS' })
    expect(world.calls.createIssue).toBe(1)
    expect(world.campaignIssue().body).toContain('#500')
    expect(world.issues.get(unrelated.number)?.body).toBe(unrelated.body)
  })

  it('MC-R1-003 fails closed for multiple valid signed and issue-bound provisional candidates', async () => {
    const world = createWorld()
    const firstIdentity = { number: 498, id: 'I_owned_498', node_id: 'N_owned_498' }
    const secondIdentity = { number: 499, id: 'I_owned_499', node_id: 'N_owned_499' }
    const first = provisionalIssue(
      firstIdentity,
      campaignSliceProvisionalBody(firstIdentity, true, world.signingKeys.privateKey),
    )
    const second = provisionalIssue(
      secondIdentity,
      campaignSliceProvisionalBody(secondIdentity, true, world.signingKeys.privateKey),
    )
    world.issues.set(first.number, first)
    world.issues.set(second.number, second)
    world.comments.set(first.number, [])
    world.comments.set(second.number, [])

    const result = await invoke(world)

    expectOutcome(result, 'STATE_CONFLICT')
    expect(world.calls.createIssue).toBe(0)
    expect(world.taskIssues()).toHaveLength(2)
  })

  it('MC-R1-003 recovers only a signed provisional tied to the allocated Issue identity', async () => {
    const world = createWorld()
    const ownedIdentity = { number: 499, id: 'I_owned_499', node_id: 'N_owned_499' }
    const owned = provisionalIssue(
      ownedIdentity,
      campaignSliceProvisionalBody(ownedIdentity, true, world.signingKeys.privateKey),
    )
    world.issues.set(owned.number, owned)
    world.comments.set(owned.number, [])

    const result = await invoke(world)

    expect(result).toMatchObject({ ok: true, outcome: 'SUCCESS' })
    expect(world.calls.createIssue).toBe(0)
    expect(world.taskIssues()).toHaveLength(1)
    expect(world.taskIssues()[0].number).toBe(499)
    expect(world.campaignIssue().body).toContain('#499')
    const state = parseMissionControlState(String(world.taskIssues()[0].body))
    expect(state).toMatchObject({ present: true, valid: true })
  })

  it('returns BLOCKED_EXTERNAL for an unprovisioned child repository', async () => {
    const world = createWorld({ provisioned: false })

    const result = await invoke(world)

    expectOutcome(result, 'BLOCKED_EXTERNAL')
    expect(world.calls.createIssue).toBe(0)
  })

  it('requires Contents write for shared lease CAS', async () => {
    const world = createWorld({ permissions: { issues: 'write', contents: 'read' } })

    const result = await invoke(world)

    expectOutcome(result, 'BLOCKED_EXTERNAL')
    expect(world.calls.createIssue).toBe(0)
  })

  it('requires explicit workflow provisioning evidence', async () => {
    const world = createWorld()
    ;(world as AnyRecord).getChildRepositoryProvisioning = async () => ({ childRepository: true })

    const result = await invoke(world)

    expectOutcome(result, 'BLOCKED_EXTERNAL')
    expect(world.calls.createIssue).toBe(0)
  })

  it('requires both a lease adapter and expected-body CAS for Campaign projection', async () => {
    const noLease = createWorld()
    ;(noLease as AnyRecord).acquireCampaignLease = undefined
    ;(noLease as AnyRecord).acquireIssueLease = undefined
    const noLeaseResult = await invoke(noLease)
    expectOutcome(noLeaseResult, 'BLOCKED_EXTERNAL')

    const noCas = createWorld()
    ;(noCas as AnyRecord).compareAndSwapIssueBody = undefined
    const noCasResult = await invoke(noCas)
    expectOutcome(noCasResult, 'BLOCKED_EXTERNAL')
  })

  it('rejects a mock-world CAS write when expectedBody is stale', async () => {
    const world = createWorld()
    const expectedBody = world.campaignIssue().body
    const liveBody = `${expectedBody}\nexternal mutation`
    await world.updateIssueBody(CAMPAIGN_ISSUE, liveBody)

    await expect(world.compareAndSwapIssueBody({
      number: CAMPAIGN_ISSUE,
      expectedBody,
      body: 'stale writer must not land',
    })).rejects.toMatchObject({
      code: 'CAS_CONFLICT',
    })
    expect(world.campaignIssue().body).toBe(liveBody)
  })

  it('classifies an ambiguous Issue-create response as BLOCKED_EXTERNAL', async () => {
    const world = createWorld({ failure: 'ambiguous-issue-create' })

    const result = await invoke(world)

    expectOutcome(result, 'BLOCKED_EXTERNAL')
    expect(world.calls.createIssue).toBe(1)
    expect(world.taskIssues()).toHaveLength(0)
  })

  it('retries an ambiguous Issue-create without adopting unsigned orphans', async () => {
    const world = createWorld({ failure: 'ambiguous-issue-create' })
    const first = await invoke(world)
    const recovered = await invoke(world)

    expectOutcome(first, 'BLOCKED_EXTERNAL')
    expect(recovered).toMatchObject({ ok: true, outcome: 'SUCCESS' })
    expect(world.calls.createIssue).toBe(2)
    expect(world.taskIssues()).toHaveLength(1)
  })

  it('recovers after failure immediately following Task allocation', async () => {
    const world = createWorld({ failure: 'after-task-allocation' })
    const first = await invoke(world)
    const taskNumber = expectSingleTaskNumber(world)
    const recovered = await invoke(world)

    expectOutcome(first, 'PROJECTION_FAILED')
    expect(recovered).toMatchObject({ ok: true, outcome: 'SUCCESS' })
    expect(world.calls.createIssue).toBe(1)
    expect(world.taskIssues()[0].number).toBe(taskNumber)
  })

  it('recovers after failure following Task initialization', async () => {
    const world = createWorld({ failure: 'after-task-initialization' })
    const first = await invoke(world)
    const taskNumber = expectSingleTaskNumber(world)
    const recovered = await invoke(world)

    expectOutcome(first, 'PROJECTION_FAILED')
    expect(recovered).toMatchObject({ ok: true, outcome: 'SUCCESS' })
    expect(world.calls.createIssue).toBe(1)
    expect(world.taskIssues()[0].number).toBe(taskNumber)
  })

  it('recovers a registry write failure after Task finalization without a duplicate Task', async () => {
    const world = createWorld({ failure: 'ownership-registry-write' })
    const first = await invoke(world)
    const taskNumber = expectSingleTaskNumber(world)
    const recovered = await invoke(world)

    expectOutcome(first, 'BLOCKED_EXTERNAL')
    expect(recovered).toMatchObject({ ok: true, outcome: 'SUCCESS' })
    expect(world.calls.createIssue).toBe(1)
    expect(world.taskIssues()[0].number).toBe(taskNumber)
    expect(world.calls.ownershipRegistryWrites).toBe(2)
  })

  it('recovers after failure before Campaign projection', async () => {
    const world = createWorld({ failure: 'before-campaign-projection' })
    const first = await invoke(world)
    const taskNumber = expectSingleTaskNumber(world)
    const recovered = await invoke(world)

    expectOutcome(first, 'PROJECTION_FAILED')
    expect(recovered).toMatchObject({ ok: true, outcome: 'SUCCESS' })
    expect(world.calls.createIssue).toBe(1)
    expect(world.taskIssues()[0].number).toBe(taskNumber)
  })

  it('recovers a transient Campaign projection CAS conflict without duplicate Task', async () => {
    const world = createWorld({ failure: 'campaign-cas-conflict' })
    const first = await invoke(world)
    const taskNumber = expectSingleTaskNumber(world)
    const recovered = await invoke(world)

    expectOutcome(first, 'STATE_CONFLICT')
    expect(recovered).toMatchObject({ ok: true, outcome: 'SUCCESS' })
    expect(world.calls.createIssue).toBe(1)
    expect(world.taskIssues()[0].number).toBe(taskNumber)
  })

  it('recovers when Campaign projection succeeds but Task readback fails', async () => {
    const world = createWorld({ failure: 'task-readback-after-campaign-projection' })
    const first = await invoke(world)
    const taskNumber = expectSingleTaskNumber(world)
    const recovered = await invoke(world)

    expectOutcome(first, 'PROJECTION_FAILED')
    expect(recovered).toMatchObject({ ok: true, outcome: 'SUCCESS' })
    expect(world.calls.createIssue).toBe(1)
    expect(world.taskIssues()[0].number).toBe(taskNumber)
  })

  it.each([
    ['after provisional allocation', 'after-provisional-allocation', 'provisional'],
    ['after ownership registry', 'after-ownership-registry', 'provisional'],
    ['after final Task body before Campaign projection', 'after-final-task-body-before-campaign', 'task-final'],
    ['after Campaign before completion', 'after-campaign-before-completion', 'campaign-final'],
  ] as Array<[string, FailureMode, 'provisional' | 'task-final' | 'campaign-final']>)(
    'MC-R1-006 rejects an incomplete Task at the %s boundary and retries it as SUCCESS',
    async (_label, failureMode, phase) => {
      const world = createWorld({ failure: failureMode })
      const first = await invoke(world)

      expect(['BLOCKED_EXTERNAL', 'PROJECTION_FAILED']).toContain(first.outcome)
      if (phase === 'provisional') {
        expectIncompleteTask(world)
      } else if (phase === 'task-final') {
        const task = world.taskIssues()[0]
        expect(parseMissionControlState(String(task.body))).toMatchObject({ present: true, valid: true })
        const campaign = parseCampaign(String(world.campaignIssue().body), {
          evidence: world.campaignEvidence,
        })
        expect((campaign.campaign?.slices as AnyRecord | undefined)?.['5']?.status).toBe('NOT_STARTED')
      } else {
        const task = world.taskIssues()[0]
        expect(parseMissionControlState(String(task.body))).toMatchObject({ present: true, valid: true })
        expect(String(world.campaignIssue().body)).toContain(`#${task.number}`)
      }

      const recovered = await invoke(world)

      expect(recovered).toMatchObject({ ok: true, outcome: expect.stringMatching(/^(SUCCESS|NO_OP)$/) })
      expect(world.calls.createIssue).toBe(1)
      expect(world.taskIssues()).toHaveLength(1)
    },
  )

  it.each([
    ['ambiguous Issue-create response', 'ambiguous-issue-create', 'BLOCKED_EXTERNAL'],
    ['after Task allocation', 'after-task-allocation', 'PROJECTION_FAILED'],
    ['after Task initialization', 'after-task-initialization', 'PROJECTION_FAILED'],
    ['before Campaign projection', 'before-campaign-projection', 'PROJECTION_FAILED'],
    ['Campaign projection CAS conflict', 'campaign-cas-conflict', 'STATE_CONFLICT'],
    [
      'Campaign projection followed by Task readback failure',
      'task-readback-after-campaign-projection',
      'PROJECTION_FAILED',
    ],
  ] as Array<[string, FailureMode, string]>)(
    'retries the %s checkpoint with the same request identity',
    async (_label, failureMode, firstOutcome) => {
      const world = createWorld({ failure: failureMode })
      const first = await invoke(world)
      const recovered = await invoke(world)

      expectOutcome(first, firstOutcome)
      expect(recovered).toMatchObject({ ok: true, outcome: 'SUCCESS' })
      if (failureMode === 'ambiguous-issue-create') {
        expect(world.calls.createIssue).toBe(2)
      } else {
        expect(world.calls.createIssue).toBe(1)
      }
      expect(world.taskIssues()).toHaveLength(1)
    },
  )

  it('lets concurrent identical requests produce one winner and one deterministic NO_OP', async () => {
    const world = createWorld()
    const results = await Promise.all([invoke(world), invoke(world)])

    expect(results.map((result) => result.outcome).sort()).toEqual(['NO_OP', 'SUCCESS'])
    expect(world.calls.createIssue).toBe(1)
    expect(world.taskIssues()).toHaveLength(1)
  })

  it('rejects a competing non-identical authority request without a second Task', async () => {
    const world = createWorld()
    const first = await invoke(world)
    const competing = await invoke(
      world,
      callerAllowlist({ planning_result_comment_id: '5182110654' }),
    )

    expect(first).toMatchObject({ ok: true, outcome: 'SUCCESS' })
    expectOutcome(competing, 'STATE_CONFLICT')
    expect(world.calls.createIssue).toBe(1)
    expect(world.taskIssues()).toHaveLength(1)
  })

  it('never duplicates a Task or ownership binding on identical retries', async () => {
    const world = createWorld()
    await invoke(world)
    await invoke(world)
    await invoke(world)

    expect(world.calls.createIssue).toBe(1)
    expect(world.calls.ownershipRegistryWrites).toBe(1)
    expect(world.taskIssues()).toHaveLength(1)
  })

  it('never duplicates the Founder-authority comment on identical retries', async () => {
    const world = createWorld()
    await invoke(world)
    await invoke(world)
    await invoke(world)

    const authorityComments = world.comments.get(CAMPAIGN_ISSUE)?.filter(
      (comment) => /FOUNDER_AUTHORIZATION/.test(String(comment.body)),
    )
    expect(authorityComments).toHaveLength(1)
    expect(world.calls.founderAuthorityCommentsPosted).toBe(0)
  })

  it('records final Task state, Campaign binding, and complete authority lineage', async () => {
    const world = createWorld()
    const result = await invoke(world)
    const task = expectSuccessfulProjection(world, result)

    expect(String(task.body)).toContain(FOUNDER_AUTHORIZATION_COMMENT_ID)
    expect(String(task.body)).toContain(PLANNING_HANDOFF_COMMENT_ID)
    expect(String(task.body)).toContain(PLANNING_RESULT_COMMENT_ID)
    expect(String(task.body)).toContain(`request_id`)
    expect(world.campaignIssue().body).toContain(`#${task.number}`)
  })

  it('keeps genesis task-bootstrap authority and provisional namespaces unchanged', () => {
    expect(BOOTSTRAP_CONTRACT.parentIssue).toBe(262)
    expect(BOOTSTRAP_CONTRACT.pullRequest).toBe(263)
    expect(PROVISIONAL_TASK_MARKER).toContain('task-bootstrap')
    expect(PROVISIONAL_TASK_END).toContain('task-bootstrap')
    expect(CAMPAIGN_SLICE_BOOTSTRAP_PROVISIONAL_MARKER_START).toContain(
      'campaign-slice-bootstrap',
    )
    expect(CAMPAIGN_SLICE_BOOTSTRAP_PROVISIONAL_MARKER_END).toContain(
      'campaign-slice-bootstrap',
    )
    expect(CAMPAIGN_SLICE_BOOTSTRAP_PROVISIONAL_MARKER_START).not.toBe(PROVISIONAL_TASK_MARKER)
    expect(CAMPAIGN_SLICE_BOOTSTRAP_PROVISIONAL_MARKER_END).not.toBe(PROVISIONAL_TASK_END)
  })
})

describe('campaign-slice bootstrap request identity contract', () => {
  it('registers the protected CLI, package script, workflow, and managed harness paths', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
    const cli = readFileSync('scripts/mission-control-campaign-slice-bootstrap.mjs', 'utf8')
    const adapter = readFileSync(
      'scripts/mission-control/adapters/campaign-slice-bootstrap-github.mjs',
      'utf8',
    )
    const workflow = readFileSync(
      '.github/workflows/mission-control-campaign-slice-bootstrap.yml',
      'utf8',
    )

    expect(packageJson.scripts['bemoat:mission-control:campaign-slice-bootstrap']).toBe(
      'node scripts/mission-control-campaign-slice-bootstrap.mjs',
    )
    expect(cli).toContain('.bemoat/mission-control/task-bootstrap-public-key.pem')
    expect(cli).toContain('resolveCampaignSliceBootstrapSigningIdentity')
    const signingHelper = readFileSync(
      'scripts/mission-control/domain/campaign-slice-bootstrap-signing.mjs',
      'utf8',
    )
    expect(signingHelper).toContain('BEMOAT_CAMPAIGN_SLICE_BOOTSTRAP_SIGNING_PRIVATE_KEY')
    expect(signingHelper).toContain('BEMOAT_TASK_BOOTSTRAP_SIGNING_PRIVATE_KEY')
    expect(signingHelper).toContain('BEMOAT_CAMPAIGN_SLICE_BOOTSTRAP_SIGNING_KEY_ID')
    expect(signingHelper).toContain('BEMOAT_TASK_BOOTSTRAP_SIGNING_KEY_ID')
    for (const flag of [
      '--founder-authorization-comment-id',
      '--campaign-issue-number',
      '--slice-id',
      '--planning-handoff-comment-id',
      '--planning-result-comment-id',
      '--planning-baseline-sha',
    ]) {
      expect(cli).toContain(flag)
      expect(workflow).toContain(`${flag.slice(2).replaceAll('-', '_')}:`)
    }
    expect(workflow).toContain(
      'group: mission-control-campaign-slice-bootstrap-${{ github.repository }}',
    )
    expect(workflow).toContain('environment:\n      name: mission-control-task-creation')
    expect(workflow).toContain('issues: write')
    expect(workflow).toContain('contents: write')
    expect(adapter).toContain('compareAndSwapIssueBody')
    expect(adapter).toContain('acquireCampaignLease')
    expect(adapter).not.toContain('method: \'PUT\'')
  })

  it('binds operation, authority, planning evidence, policy, base, and target projection', () => {
    const identity = buildCampaignSliceBootstrapRequestIdentity(trustedIdentityInput())

    expect(identity.requestId).toMatch(
      new RegExp(`^${CAMPAIGN_SLICE_BOOTSTRAP_REQUEST_ID_PREFIX}[0-9a-f]{64}$`),
    )
    expect(identity.tuple).toMatchObject({
      operation: CAMPAIGN_SLICE_BOOTSTRAP_OPERATION,
      operation_version: CAMPAIGN_SLICE_BOOTSTRAP_OPERATION_VERSION,
      repository: REPOSITORY,
      founder_authorization_comment_id: FOUNDER_AUTHORIZATION_COMMENT_ID,
      campaign_issue_number: CAMPAIGN_ISSUE,
      slice_id: SLICE_ID,
      planning_handoff_comment_id: PLANNING_HANDOFF_COMMENT_ID,
      planning_result_comment_id: PLANNING_RESULT_COMMENT_ID,
      planning_baseline_sha: PLANNING_BASELINE_SHA,
      protected_base_sha: PLANNING_BASELINE_SHA,
      target_state: 'BLOCKED_FOR_FOUNDER_DECISION',
      workflow_mode: 'planning_no_pr',
      review_cycle: 0,
      full_review_count: 0,
      active_pr: null,
      current_head: null,
      last_reviewed_head: null,
    })
  })

  it('is deterministic for identical input and changes for every security-relevant tuple field', () => {
    const input = trustedIdentityInput()
    const first = buildCampaignSliceBootstrapRequestIdentity(input)
    const identical = buildCampaignSliceBootstrapRequestIdentity({ ...input })
    expect(identical).toEqual(first)

    const changes: Array<[string, AnyRecord]> = [
      ['Founder body hash', { founderAuthorizationBodySha256: 'a'.repeat(64) }],
      ['Campaign Issue', { campaignIssueNumber: 214 }],
      ['Slice', { sliceId: 6 }],
      ['HANDOFF identity', { planningHandoffCommentId: '5181983012' }],
      ['HANDOFF body hash', { planningHandoffBodySha256: 'b'.repeat(64) }],
      ['RESULT identity', { planningResultCommentId: '5182110654' }],
      ['RESULT body hash', { planningResultBodySha256: 'c'.repeat(64) }],
      ['planning baseline', { planningBaselineSha: 'd'.repeat(40) }],
      ['protected base', { protectedBaseSha: 'e'.repeat(40) }],
      ['policy path', { policyPath: 'docs/other-policy.md' }],
      ['policy version', { policyVersion: '1.4.0' }],
      ['policy blob', { policySha: 'f'.repeat(40) }],
      ['target state', { targetState: 'READY' }],
      ['workflow mode', { workflowMode: 'implementation_pr' }],
      ['review cycle', { reviewCycle: 1 }],
      ['full review count', { fullReviewCount: 1 }],
      ['active PR', { activePr: '#500' }],
      ['current head', { currentHead: '1'.repeat(40) }],
      ['last reviewed head', { lastReviewedHead: '2'.repeat(40) }],
    ]

    for (const [label, change] of changes) {
      const changed = buildCampaignSliceBootstrapRequestIdentity({ ...input, ...change })
      expect(changed.requestId, label).not.toBe(first.requestId)
    }
  })

  it('uses operation-specific attestation and registry schemas and operation strings', () => {
    expect(CAMPAIGN_SLICE_BOOTSTRAP_AUTHORIZATION_SCHEMA).toContain(
      'campaign-slice-bootstrap',
    )
    expect(CAMPAIGN_SLICE_BOOTSTRAP_ATTESTATION_SCHEMA).toContain(
      'campaign-slice-bootstrap',
    )
    expect(CAMPAIGN_SLICE_BOOTSTRAP_REGISTRY_SCHEMA).toContain(
      'campaign-slice-bootstrap',
    )
    expect(CAMPAIGN_SLICE_BOOTSTRAP_ATTESTATION_OPERATION).toBe(
      CAMPAIGN_SLICE_BOOTSTRAP_OPERATION,
    )
    expect(CAMPAIGN_SLICE_BOOTSTRAP_REGISTRY_OPERATION).not.toBe('task-ownership-register')
    expect(CAMPAIGN_SLICE_BOOTSTRAP_REGISTRY_OPERATION).not.toBe('task-bootstrap')
  })

  it('does not permit caller input to replace trusted server-derived identity fields', async () => {
    const world = createWorld()
    const result = await invoke(
      world,
      callerAllowlist({
        repository: 'attacker/forged-repository',
        protected_base_sha: '00'.repeat(20),
        policy_sha: '11'.repeat(20),
        target_state: 'READY',
        workflow_mode: 'implementation_pr',
      }),
    )

    expectOutcome(result, 'STATE_CONFLICT')
    expect(world.calls.createIssue).toBe(0)
  })
})

describe('campaign-slice production adapter CAS and lease races', () => {
  const casRepository = REPOSITORY
  const casIssueNumber = 274

  it('gives competing production-shaped CAS workers one winner and one conflict', async () => {
    let body = 'campaign-body-v1'
    const leaseStore = createMemoryLeaseStore()
    const writes: string[] = []
    let contenderReady!: () => void
    const contenderSignal = new Promise<void>((resolve) => {
      contenderReady = resolve
    })
    let releaseWinner!: () => void
    const winnerPause = new Promise<void>((resolve) => {
      releaseWinner = resolve
    })

    const winner = compareAndSwapIssueBody({
      repo: casRepository,
      issueNumber: casIssueNumber,
      expectedBody: body,
      nextBody: 'campaign-body-winner',
      transitionIdentity: 'campaign-worker-a',
      holder: 'campaign-slice-bootstrap',
      deps: {
        leaseStore,
        readIssueBody: async () => body,
        writeIssueBody: async ({ body: next }: { body: string }) => {
          writes.push(next)
          body = next
        },
        beforeIssueUpdate: async () => {
          contenderReady()
          await winnerPause
        },
      },
    })

    await contenderSignal
    const loser = compareAndSwapIssueBody({
      repo: casRepository,
      issueNumber: casIssueNumber,
      expectedBody: 'campaign-body-v1',
      nextBody: 'campaign-body-loser',
      transitionIdentity: 'campaign-worker-b',
      holder: 'campaign-slice-bootstrap',
      deps: {
        leaseStore,
        readIssueBody: async () => body,
        writeIssueBody: async ({ body: next }: { body: string }) => {
          writes.push(next)
          body = next
        },
      },
    })

    const loserResult = await Promise.race([
      loser.then(() => 'fulfilled', () => 'rejected'),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 100)),
    ])
    expect(loserResult).toBe('rejected')
    releaseWinner()

    const results = await Promise.allSettled([winner, loser])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(results.find((result) => result.status === 'rejected')).toEqual(expect.objectContaining({
      reason: expect.objectContaining({
        message: expect.stringMatching(/(?:STATE_CONFLICT|CAS_CONFLICT)/),
      }),
    }))
    expect(writes).toEqual(['campaign-body-winner'])
    expect(body).toBe('campaign-body-winner')
  })

  it('prevents a stale lease holder from writing after ownership is replaced', async () => {
    let body = 'campaign-body-v1'
    const leaseStore = createMemoryLeaseStore()
    const writes: string[] = []
    const path = leasePathForIssue(casIssueNumber)
    let ownershipReplaced!: () => void
    const ownershipSignal = new Promise<void>((resolve) => {
      ownershipReplaced = resolve
    })
    let releaseStaleHolder!: () => void
    const staleHolderPause = new Promise<void>((resolve) => {
      releaseStaleHolder = resolve
    })

    const staleHolder = compareAndSwapIssueBody({
      repo: casRepository,
      issueNumber: casIssueNumber,
      expectedBody: body,
      nextBody: 'stale-body-must-not-land',
      transitionIdentity: 'stale-campaign-worker',
      holder: 'campaign-slice-bootstrap',
      deps: {
        leaseStore,
        readIssueBody: async () => body,
        writeIssueBody: async ({ body: next }: { body: string }) => {
          writes.push(next)
          body = next
        },
        beforeIssueUpdate: async () => {
          const current = leaseStore._dump().get(path)
          expect(current?.content?.status).toBe('held')
          leaseStore._dump().set(path, {
            sha: 'replacement-lease-sha',
            content: {
              ...clone(current?.content),
              transition_identity: 'replacement-campaign-worker',
              status: 'held',
            },
          })
          ownershipReplaced()
          await staleHolderPause
        },
      },
    })

    await ownershipSignal
    releaseStaleHolder()

    await expect(staleHolder).rejects.toThrow(/(?:STATE_CONFLICT|CAS_CONFLICT)/)
    expect(writes).toEqual([])
    expect(body).toBe('campaign-body-v1')
  })

  it('rejects a compare-and-swap when expectedBody differs from the live Issue body', async () => {
    let body = 'campaign-body-live'
    const leaseStore = createMemoryLeaseStore()
    const writes: string[] = []

    await expect(compareAndSwapIssueBody({
      repo: casRepository,
      issueNumber: casIssueNumber,
      expectedBody: 'campaign-body-stale',
      nextBody: 'campaign-body-must-not-land',
      transitionIdentity: 'stale-body-worker',
      holder: 'campaign-slice-bootstrap',
      deps: {
        leaseStore,
        readIssueBody: async () => body,
        writeIssueBody: async ({ body: next }: { body: string }) => {
          writes.push(next)
          body = next
        },
      },
    })).rejects.toThrow(/STATE_CONFLICT: concurrent Issue body change detected/)

    expect(writes).toEqual([])
    expect(body).toBe('campaign-body-live')
    expect(hashIssueBody(body)).not.toBe(hashIssueBody('campaign-body-stale'))
  })

  it('makes the production adapter reject a stale expected Issue body', async () => {
    const world = createWorld()
    const production = createProductionAdapterWorld(world)
    const expectedBody = world.campaignIssue().body
    await world.updateIssueBody(CAMPAIGN_ISSUE, `${expectedBody}\nexternal mutation`)

    await expect(production.github.compareAndSwapIssueBody({
      number: CAMPAIGN_ISSUE,
      expectedBody,
      body: 'stale adapter writer must not land',
      requestId: 'stale-adapter-worker',
    })).rejects.toThrow(/STATE_CONFLICT: concurrent Issue body change detected/)
    expect(world.campaignIssue().body).toBe(`${expectedBody}\nexternal mutation`)
  })

  it('runs simultaneous identical bootstrap requests through adapter lease/CAS state', async () => {
    const world = createWorld()
    const production = createProductionAdapterWorld(world)
    const deps = {
      github: production.github,
      publicKey: world.signingKeys.publicKey,
      signingPrivateKey: world.signingKeys.privateKey,
      signingKeyId: 'campaign-slice-bootstrap-test-key',
      now: () => '2026-08-05T00:00:00.000Z',
    }

    const firstWave = await Promise.allSettled([
      runCampaignSliceBootstrap(callerAllowlist(), deps),
      runCampaignSliceBootstrap(callerAllowlist(), deps),
    ])
    const firstOutcomes = firstWave.map((result) =>
      result.status === 'fulfilled' ? result.value.outcome : result.reason?.code,
    )
    expect(firstOutcomes).toContain('SUCCESS')
    expect(firstOutcomes).toEqual(expect.arrayContaining([
      expect.stringMatching(/(?:NO_OP|STATE_CONFLICT|CAS_CONFLICT)/),
    ]))

    const conflict = firstWave.find(
      (result) => result.status === 'rejected' &&
        /STATE_CONFLICT|CAS_CONFLICT/.test(String(result.reason?.code ?? result.reason?.message)),
    )
    if (conflict) {
      await expect(runCampaignSliceBootstrap(callerAllowlist(), deps)).resolves.toMatchObject({
        ok: true,
        outcome: 'NO_OP',
      })
    }

    expect(world.calls.createIssue).toBe(1)
    expect(world.taskIssues()).toHaveLength(1)
    expect(production.contentsLeaseStore._dump().size).toBeGreaterThan(0)
    expect(production.projectionCalls.directUpdate).toBe(0)
    expect(production.projectionCalls.compareAndSwap).toContain(CAMPAIGN_ISSUE)
    expect(production.projectionCalls.compareAndSwap).toContain(world.taskIssues()[0].number)
  })
})
