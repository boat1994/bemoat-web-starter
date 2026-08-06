import { describe, expect, it } from 'vitest'

import {
  main,
  parseReopenArgs,
  runReopen,
} from '../../scripts/mission-control/workflows/reopen.mjs'
import {
  parseMissionControlState,
  renderMissionControlState,
} from '../../scripts/mission-control-state.mjs'
import { assertResultEnvelopeV1 } from '../../scripts/cli/command-result.mjs'
import { runCliBoundaryCase } from '../helpers/cli-boundary-harness'

const REPOSITORY = 'boat1994/bemoat-web-starter'
const ISSUE = '284'
const PR = '285'
const BASE = 'main'
const OLD_HEAD = 'c44bf1bc379fe4160946dce96e5a4d7abae7b5b0'
const NEW_HEAD = '88b306c7e055751f78b9ced5922607eee2d1037f'
const DRIFTED_HEAD = '7c6c8d0f2c9426a7a0a55d3d4f4b56b9a0c1d2e3'
const PROTECTED_BASE_SHA = '3bb6f45ee5c17ada94e51ca7bc93d969df3776eb'
const POLICY_SOURCE_SHA = 'e79694467b89dace927c27a1022ec3d260a4a43c'
const AUTHORIZATION_COMMENT = '5193626365'
const RESULT_COMMENT = '5193868664'
const REVIEW_VERDICT_COMMENT = '5194028692'
type JsonObject = Record<string, unknown>
type HarnessIssue = {
  body: string
  managedState: JsonObject
  [key: string]: unknown
}
type HarnessOverrides = {
  state?: JsonObject
  prefix?: string
  issue?: JsonObject
  pullRequest?: JsonObject
  authorizationComment?: JsonObject
  issueComments?: JsonObject[]
  onPullRead?: (input: {
    pullRequest: { headRefOid: string }
    pullReads: number
  }) => void
  writeError?: Error
  skipWriteProjection?: boolean
  afterWrite?: (issue: HarnessIssue) => void
}

const options = {
  issueNumber: ISSUE,
  repo: REPOSITORY,
  expectedPr: PR,
  expectedBase: BASE,
  expectedState: 'ELIGIBLE_FOR_FOUNDER_REVIEW',
  expectedOldHead: OLD_HEAD,
  expectedNewHead: NEW_HEAD,
  expectedReviewCycle: '1',
  expectedFullReviewCount: '1',
  authorizationComment: AUTHORIZATION_COMMENT,
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function baseState(overrides: JsonObject = {}): JsonObject {
  return {
    schema_version: 1,
    state: 'ELIGIBLE_FOR_FOUNDER_REVIEW',
    review_cycle: 1,
    full_review_count: 1,
    approved_base: BASE,
    active_task_issue: `#${ISSUE}`,
    active_pr: `#${PR}`,
    current_head: OLD_HEAD,
    last_reviewed_head: OLD_HEAD,
    workflow_mode: 'implementation_pr',
    guide_version: '1.3.0',
    guide_source_ref: BASE,
    guide_source_sha: POLICY_SOURCE_SHA,
    latest_result_comment_id: RESULT_COMMENT,
    latest_review_verdict_comment_id: REVIEW_VERDICT_COMMENT,
    open_blockers: [],
    follow_up_issues: [],
    next_permitted_action: 'Founder merge review',
    material_change_status: 'none',
    updated_at: '2026-08-05T15:35:40.000Z',
    updated_by: 'Mission Control',
    campaign_issue: null,
    campaign_slice: null,
    ...overrides,
  }
}

function baseAuthorization(overrides: JsonObject = {}): JsonObject {
  return {
    schema_version: 1,
    status: 'approved',
    authority: 'Founder',
    author_login: 'boat1994',
    comment_id: AUTHORIZATION_COMMENT,
    immutable_comment_reference: true,
    non_superseded: true,
    superseded_by: null,
    repository: REPOSITORY,
    task_issue: Number(ISSUE),
    pr: Number(PR),
    exact_head: NEW_HEAD,
    reviewed_head: NEW_HEAD,
    old_reviewed_head: OLD_HEAD,
    base: BASE,
    approved_base: BASE,
    policy_source_sha: POLICY_SOURCE_SHA,
    protected_base_sha: PROTECTED_BASE_SHA,
    bundle_kind: 'founder-reopen',
    scope: 'correction',
    action: 'reopen',
    policy_version: '1.3.0',
    review_cycle: 1,
    review_verdict_comment_id: REVIEW_VERDICT_COMMENT,
    original_result_comment_id: RESULT_COMMENT,
    correction_reason: 'Merge the approved protected-base update into the reviewed branch.',
    bounded_correction_scope: ['scripts/mission-control/workflows/reopen.mjs'],
    delta_review_requirement: true,
    maximum_correction_deliveries: 1,
    finding_ids: ['MC-R1-001', 'MC-R1-002', 'MC-R1-003', 'MC-R1-004'],
    authorization_id: 'reopen-284-1',
    ...overrides,
  }
}

function authorizationComment(overrides: JsonObject = {}): JsonObject {
  const authorization = baseAuthorization(
    (overrides.authorization as JsonObject | undefined) ?? {},
  )
  return {
    id: AUTHORIZATION_COMMENT,
    issue_url: `https://api.github.com/repos/${REPOSITORY}/issues/${ISSUE}`,
    user: { login: 'boat1994' },
    author_association: 'OWNER',
    created_at: '2026-08-05T16:00:00Z',
    body: JSON.stringify(authorization),
    ...overrides,
  }
}

function createHarness(overrides: HarnessOverrides = {}) {
  const issueState = baseState(overrides.state)
  const issue = {
    number: Number(ISSUE),
    state: 'OPEN',
    body: `${overrides.prefix ?? 'Task body'}\n${renderMissionControlState(issueState)}\n`,
    managedState: issueState,
    ...overrides.issue,
  } as HarnessIssue
  const pullRequest = {
    number: Number(PR),
    state: 'OPEN',
    isDraft: false,
    headRefOid: NEW_HEAD,
    baseRefName: BASE,
    baseRefOid: PROTECTED_BASE_SHA,
    ...overrides.pullRequest,
  } as { headRefOid: string; baseRefName: string; baseRefOid: string; [key: string]: unknown }
  const authComment = authorizationComment(overrides.authorizationComment)
  const issueComments: JsonObject[] = [authComment, ...(overrides.issueComments ?? [])]
  const operations: string[] = []
  let writes = 0
  let managedReads = 0
  let pullReads = 0

  const deps = {
    readManagedIssue: async () => {
      managedReads += 1
      return clone(issue)
    },
    readPullRequest: async () => {
      pullReads += 1
      if (overrides.onPullRead) overrides.onPullRead({ pullRequest, pullReads })
      return clone(pullRequest)
    },
    readComment: async (_repo: string, commentId: string) => {
      const comment = issueComments.find((entry) => String(entry.id) === String(commentId))
      if (!comment) throw new Error(`missing comment ${commentId}`)
      return clone(comment)
    },
    readIssueComments: async () => clone(issueComments),
    readTrustedFounderLogins: async () => ['boat1994'],
    writeIssueBody: async ({ nextBody }: { nextBody: string }) => {
      writes += 1
      operations.push('write')
      if (overrides.writeError) throw overrides.writeError
      if (overrides.skipWriteProjection) return undefined
      issue.body = nextBody
      const parsed = parseMissionControlState(nextBody)
      if (!parsed.state) throw new Error('test harness failed to parse projected state')
      issue.managedState = parsed.state
      if (overrides.afterWrite) overrides.afterWrite(issue)
      return { accepted: true }
    },
  }

  return {
    deps,
    issue,
    pullRequest,
    issueComments,
    operations,
    get writes() { return writes },
    get managedReads() { return managedReads },
    get pullReads() { return pullReads },
  }
}

function stateFromHarness(harness: ReturnType<typeof createHarness>) {
  return clone(harness.issue.managedState)
}

describe('parseReopenArgs', () => {
  it('parses the complete reopen invocation', () => {
    const parsed = parseReopenArgs([
      ISSUE,
      '--repo', REPOSITORY,
      '--expected-pr', PR,
      '--expected-base', BASE,
      '--expected-state', 'ELIGIBLE_FOR_FOUNDER_REVIEW',
      '--expected-old-head', OLD_HEAD,
      '--expected-new-head', NEW_HEAD,
      '--expected-review-cycle', '1',
      '--expected-full-review-count', '1',
      '--authorization-comment', AUTHORIZATION_COMMENT,
    ])

    expect(parsed).toMatchObject(options)
  })

  it.each(['--help', '-h'])('returns non-mutating help options for %s', (flag) => {
    expect(parseReopenArgs([flag])).toEqual({ help: true })
  })
})

describe('runReopen', () => {
  it('successfully reopens a #280/#281-shaped drift without resetting Review 1 lineage', async () => {
    const harness = createHarness({
      state: {
        campaign_issue: null,
        campaign_slice: null,
      },
    })

    const result = await runReopen({ options, deps: harness.deps })
    const state = stateFromHarness(harness)

    expect(result.outcome).toBe('REOPENED')
    expect(harness.writes).toBe(1)
    expect(state.state).toBe('FOUNDER_AUTHORIZED_CORRECTION')
    expect(state.current_head).toBe(NEW_HEAD)
    expect(state.last_reviewed_head).toBe(OLD_HEAD)
    expect(state.review_cycle).toBe(1)
    expect(state.full_review_count).toBe(1)
    expect(state.latest_result_comment_id).toBe(RESULT_COMMENT)
    expect(state.latest_review_verdict_comment_id).toBe(REVIEW_VERDICT_COMMENT)
    expect(state.campaign_issue).toBeNull()
    expect(state.campaign_slice).toBeNull()
    expect(state.founder_correction_authorization).toMatchObject({
      authorization_id: 'reopen-284-1',
      status: 'authorized',
      old_reviewed_head: OLD_HEAD,
      reviewed_head: NEW_HEAD,
      maximum_correction_deliveries: 1,
      delta_review_requirement: true,
      correction_deliveries: 0,
      delta_review_count: 0,
    })
  })

  it('returns NO_OP only after validating the complete post-state and live evidence', async () => {
    const harness = createHarness()

    await expect(runReopen({ options, deps: harness.deps })).resolves.toMatchObject({ outcome: 'REOPENED' })
    const writesAfterFirstRun = harness.writes
    const result = await runReopen({ options, deps: harness.deps })

    expect(result.outcome).toBe('NO_OP')
    expect(harness.writes).toBe(writesAfterFirstRun)
    expect(harness.managedReads).toBeGreaterThan(2)
    expect(harness.pullReads).toBeGreaterThan(2)
  })

  it('rejects partial durable post-state instead of returning NO_OP', async () => {
    const harness = createHarness({
      state: {
        state: 'FOUNDER_AUTHORIZED_CORRECTION',
        current_head: NEW_HEAD,
        founder_correction_authorization: {
          status: 'authorized',
          authorization_id: 'reopen-284-1',
          reviewed_head: NEW_HEAD,
          for_review_number: 1,
          finding_ids: ['MC-R1-001'],
        },
      },
    })

    await expect(runReopen({ options, deps: harness.deps })).rejects.toThrow('STATE_CONFLICT')
    expect(harness.writes).toBe(0)
  })

  it.each([
    ['repository', { repository: 'wrong/repository' }],
    ['Task Issue', { task_issue: 999 }],
    ['PR', { pr: 999 }],
    ['base', { base: 'dev', approved_base: 'dev' }],
    ['old reviewed head', { old_reviewed_head: DRIFTED_HEAD }],
    ['new live head', { exact_head: DRIFTED_HEAD, reviewed_head: DRIFTED_HEAD }],
    ['policy source', { policy_source_sha: 'f'.repeat(40) }],
    ['policy version', { policy_version: '0.0.0' }],
    ['correction reason', { correction_reason: '' }],
    ['bounded scope', { bounded_correction_scope: [] }],
    ['Delta Review requirement', { delta_review_requirement: false }],
    ['maximum delivery count', { maximum_correction_deliveries: 2 }],
  ])('fails closed for a wrong or incomplete authorization %s', async (_label, authorization) => {
    const harness = createHarness({ authorizationComment: { authorization } })

    await expect(runReopen({ options, deps: harness.deps })).rejects.toThrow('STATE_CONFLICT')
    expect(harness.writes).toBe(0)
  })

  it('rejects a malformed authorization and an authorization with a superseding comment', async () => {
    const malformed = createHarness({
      authorizationComment: { authorization: { ...baseAuthorization(), action: undefined } },
    })
    await expect(runReopen({ options, deps: malformed.deps })).rejects.toThrow('STATE_CONFLICT')
    expect(malformed.writes).toBe(0)

    const superseded = createHarness({
      issueComments: [{
        id: '5193626366',
        user: { login: 'boat1994' },
        author_association: 'OWNER',
        body: JSON.stringify({
          repository: REPOSITORY,
          task_issue: Number(ISSUE),
          pr: Number(PR),
          bundle_kind: 'founder-reopen',
          supersedes_comment_id: AUTHORIZATION_COMMENT,
        }),
      }],
    })
    await expect(runReopen({ options, deps: superseded.deps })).rejects.toThrow('STATE_CONFLICT')
    expect(superseded.writes).toBe(0)
  })

  it('rejects deterministic competing reopen authorizations', async () => {
    const competing = createHarness({
      issueComments: [{
        id: '5193626366',
        user: { login: 'boat1994' },
        author_association: 'OWNER',
        body: JSON.stringify(baseAuthorization({
          comment_id: '5193626366',
          authorization_id: 'reopen-284-2',
        })),
      }],
    })

    await expect(runReopen({ options, deps: competing.deps })).rejects.toThrow('STATE_CONFLICT')
    expect(competing.writes).toBe(0)
  })

  it.each([
    ['closed PR', { state: 'CLOSED' }],
    ['draft PR', { isDraft: true }],
    ['wrong PR number', { number: 286 }],
    ['wrong base', { baseRefName: 'dev' }],
    ['further head drift', { headRefOid: DRIFTED_HEAD }],
  ])('rejects live PR preflight drift: %s', async (_label, pullRequest) => {
    const harness = createHarness({ pullRequest })

    await expect(runReopen({ options, deps: harness.deps })).rejects.toThrow('STATE_CONFLICT')
    expect(harness.writes).toBe(0)
  })

  it('head drift without the complete Founder tuple cannot enter reopen', async () => {
    const harness = createHarness({
      pullRequest: { headRefOid: DRIFTED_HEAD },
      authorizationComment: {
        authorization: {
          ...baseAuthorization(),
          finding_ids: undefined,
        },
      },
    })
    const before = stateFromHarness(harness)

    await expect(runReopen({ options, deps: harness.deps })).rejects.toThrow('STATE_CONFLICT')
    expect(harness.writes).toBe(0)
    expect(stateFromHarness(harness)).toEqual(before)

    const boundary = runCliBoundaryCase({
      entrypoint: 'scripts/mission-control-reopen.mjs',
      argv: [
        ISSUE,
        '--repo', REPOSITORY,
        '--expected-pr', PR,
        '--expected-base', BASE,
        '--expected-state', 'ELIGIBLE_FOR_FOUNDER_REVIEW',
        '--expected-old-head', OLD_HEAD,
        '--expected-new-head', NEW_HEAD,
        '--expected-review-cycle', '1',
        '--expected-full-review-count', '1',
        '--authorization-comment', AUTHORIZATION_COMMENT,
        '--json',
      ],
      env: {
        BEMOAT_FACADE_COMMAND: 'bemoat:mission-control:reopen',
        BEMOAT_FACADE_ENTRYPOINT: 'scripts/mission-control-reopen.mjs',
        npm_lifecycle_event: 'bemoat:mission-control:reopen',
      },
    })

    expect(boundary.status, `${boundary.stdout}\n${boundary.stderr}`).toBe(3)
    expect(boundary.stderr).toBe('')
    expect(boundary.filesystem_unchanged).toBe(true)
    expect(boundary.poison_invocations.length).toBeGreaterThan(0)
    const envelope = JSON.parse(boundary.stdout) as Record<string, unknown>
    assertResultEnvelopeV1(envelope)
    expect(envelope).toMatchObject({
      command: 'bemoat:mission-control:reopen',
      mode: 'result',
      outcome: 'ERROR',
      classification: 'HEAD_DRIFT',
      mutation_performed: false,
    })
  })

  it('rejects a head that drifts between preflight reads and the mutation', async () => {
    const harness = createHarness({
      onPullRead: ({ pullRequest, pullReads }: {
        pullRequest: { headRefOid: string }
        pullReads: number
      }) => {
        if (pullReads === 2) pullRequest.headRefOid = DRIFTED_HEAD
      },
    })

    await expect(runReopen({ options, deps: harness.deps })).rejects.toThrow('STATE_CONFLICT')
    expect(harness.writes).toBe(0)
  })

  it('fails closed on CAS/lease ambiguity', async () => {
    const harness = createHarness({
      writeError: new Error('CAS_CONFLICT: lease winner is ambiguous'),
    })

    await expect(runReopen({ options, deps: harness.deps })).rejects.toThrow('STATE_CONFLICT')
    expect(harness.writes).toBe(1)
  })

  it('fails closed when the exact post-write Issue readback does not persist', async () => {
    const harness = createHarness({ skipWriteProjection: true })

    await expect(runReopen({ options, deps: harness.deps })).rejects.toThrow('STATE_CONFLICT')
    expect(harness.writes).toBe(1)
  })

  it('preserves the old-head merge boundary and exposes only one correction delivery and Delta Review', async () => {
    const harness = createHarness()
    await runReopen({ options, deps: harness.deps })
    const correction = stateFromHarness(harness).founder_correction_authorization as {
      exact_head: string
      old_reviewed_head: string
      [key: string]: unknown
    }

    expect(correction).toMatchObject({
      exact_head: NEW_HEAD,
      protected_base_sha: PROTECTED_BASE_SHA,
      original_result_comment_id: RESULT_COMMENT,
      original_review_verdict_comment_id: REVIEW_VERDICT_COMMENT,
      required_next_review: 'Delta Review',
      maximum_correction_deliveries: 1,
      correction_deliveries: 0,
      delta_review_count: 0,
    })
    expect(correction.old_reviewed_head).not.toBe(correction.exact_head)
  })

  it.each(['--help', '-h'])('main %s performs no dependency reads or writes', async (flag) => {
    const calls: string[] = []
    const deps = new Proxy({} as NonNullable<Parameters<typeof main>[1]>, {
      get() {
        return async () => {
          calls.push('mutation-or-read')
        }
      },
    })

    await expect(main([flag], deps)).resolves.toMatchObject({ outcome: 'HELP' })
    expect(calls).toEqual([])
  })
})
