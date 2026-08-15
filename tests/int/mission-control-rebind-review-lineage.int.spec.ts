import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { getCommandContract } from '../../scripts/cli/command-contract.mjs'
import { COMMAND_CONTRACT_REGISTRY } from '../../scripts/cli/command-contract-registry.mjs'
import { CANONICAL_TRANSPORTS, getTransportRoute } from '../../scripts/mission-control/transport-registry.mjs'
import {
  parseLegacyReviewVerdictBinding,
  selectLiveReviewVerdictComment,
} from '../../scripts/mission-control/review-verdict-binding.mjs'
import {
  parseMissionControlState,
  renderMissionControlState,
} from '../../scripts/mission-control/domain/task-state.ts'
import {
  main,
  runReviewLineageRebind,
} from '../../scripts/mission-control/workflows/rebind-review-lineage.mjs'

const COMMAND = 'bemoat:mission-control:rebind-review-lineage'
const REPOSITORY = 'boat1994/bemoat-web-starter'
const ISSUE = '259'
const PR = '260'
const BASE = 'main'
const SOURCE_COMMENT = '5163387315'
const HEAD = 'b1ce5f58e7ffd0178d955ef7e93395209a7c4d28'
const AUTHORIZATION_COMMENT = '9000000001'
const CANONICAL_COMMENT_ID = '9000000002'
const GUIDE_SOURCE_SHA = 'c'.repeat(40)
const LIVE_SOURCE_FIXTURE_PATH = resolve(
  process.cwd(),
  'tests/fixtures/starter-only/mission-control/review-verdict-comment-5163387315.body.md',
)
const LIVE_SOURCE_FIXTURE_FILE_SHA256 =
  '97d58461c476f3e0244613ddae02c7370a114973ef8a22bea5808c7eac639f6d'
const LIVE_SOURCE_COMMENT_SHA256 =
  '37ca7e4eadd60c030608f9fdc395d1830aa135f9bb25792a39cb867a5b33385d'

type RebindDeps = {
  readManagedIssue: (issueNumber: string, repo: string) => Promise<Record<string, unknown>>
  readPullRequest: (prNumber: string, repo: string) => Promise<Record<string, unknown>>
  readIssueComments: (repo: string, issueNumber: string) => Promise<Array<Record<string, unknown>>>
  readComment: (repo: string, commentId: string) => Promise<Record<string, unknown>>
  postComment: (repo: string, issueNumber: string, body: string) => Promise<Record<string, unknown>>
  updateComment: (repo: string, commentId: string, body: string) => Promise<Record<string, unknown>>
  writeIssueBody: (args: {
    repo?: string
    issueNumber?: string
    expectedBody?: string
    nextBody: string
    transitionIdentity?: string
  }) => Promise<{
    path: string
    observedBodyHash: string
    nextBodyHash: string
    adopted: boolean
  }>
}

function legacySourceBody(): string {
  return `## REVIEW_VERDICT

### Task log
- Timestamp: 2026-07-20T10:00:00+07:00
- Task / Issue: #259
- Phase: Review 1
- Executing role: Reviewer

**Task:** #259
**PR:** #260
**Base:** \`main\`
**Head:** \`${HEAD}\`
**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**Findings:** Critical: None · Important: None
**Gates:** exact-head CI pass
**Next:** Founder merge authorization
`
}

function canonicalBody(): string {
  return `## REVIEW_VERDICT

### Task log
- Timestamp: 2026-08-15T22:00:00+07:00
**Task / Issue:** #259
- Phase: Review 1 lineage transport
- Executing role: Mission Control Lineage Rebind Transport

**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/260 · \`main\` · \`${HEAD}\`
**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**Findings:** Critical: None · Important: None
**Gates:** exact-head CI pass
**Next:** Founder merge authorization
`
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function readLiveSourceComment5163387315(): string {
  const fileBytes = readFileSync(LIVE_SOURCE_FIXTURE_PATH)
  expect(createHash('sha256').update(fileBytes).digest('hex')).toBe(LIVE_SOURCE_FIXTURE_FILE_SHA256)
  const fileText = fileBytes.toString('utf8')
  expect(fileText.endsWith('\n')).toBe(true)
  const liveBody = fileText.slice(0, -1)
  expect(sha256Hex(liveBody)).toBe(LIVE_SOURCE_COMMENT_SHA256)
  expect(liveBody).toContain('### Findings')
  expect(liveBody).toContain('- **Critical/Important:** None.')
  expect(liveBody).not.toMatch(/^\*\*Findings:\*\*/m)
  return liveBody
}

function liveSourceScenario(overrides: Parameters<typeof createScenario>[0] = {}) {
  const liveSource = readLiveSourceComment5163387315()
  const sourceBody = overrides.sourceBody ?? liveSource
  return {
    liveSource,
    ...createScenario({
      ...overrides,
      sourceBody,
      authorization: {
        sourceBody: liveSource,
        ...overrides.authorization,
      },
    }),
  }
}

function authorizationBody(overrides: Record<string, unknown> = {}): string {
  const { replacementBody, sourceBody, ...rest } = overrides
  return JSON.stringify({
    bundle_kind: 'review-lineage-rebind',
    command: COMMAND,
    repository: REPOSITORY,
    task_issue: 259,
    pr: 260,
    base: BASE,
    source_comment_id: Number(SOURCE_COMMENT),
    head: HEAD,
    expected_state: 'ELIGIBLE_FOR_FOUNDER_REVIEW',
    review_cycle: 1,
    full_review_count: 1,
    verdict: 'ELIGIBLE FOR FOUNDER REVIEW',
    scope: 'transport-correction-only',
    replacement_body_sha256: sha256Hex(
      replacementBody === undefined ? canonicalBody() : String(replacementBody),
    ),
    source_body_sha256: sha256Hex(
      sourceBody === undefined ? legacySourceBody() : String(sourceBody),
    ),
    ...rest,
  })
}

function demotionPrefix(canonicalId: string | number): string {
  return `[superseded] This REVIEW_VERDICT is not authoritative. Canonical lineage is comment ${canonicalId}. Original Review 1 evidence is preserved below.`
}

function initialManagedState(): Record<string, unknown> {
  return {
    schema_version: 1,
    state: 'ELIGIBLE_FOR_FOUNDER_REVIEW',
    review_cycle: 1,
    full_review_count: 1,
    approved_base: BASE,
    active_task_issue: '#259',
    active_pr: '#260',
    current_head: HEAD,
    last_reviewed_head: HEAD,
    guide_version: '1.3.0',
    guide_source_ref: 'main',
    guide_source_sha: GUIDE_SOURCE_SHA,
    open_blockers: [],
    follow_up_issues: [],
    next_permitted_action: 'Founder merge authorization required before merge.',
    material_change_status: 'none',
    updated_at: '2026-07-20T10:00:00+07:00',
    updated_by: 'Reviewer',
    latest_review_verdict_comment_id: SOURCE_COMMENT,
    latest_transition_identity: 'legacy-review-1',
  }
}

function writeBodyFile(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'bemoat-rebind-review-lineage-'))
  const path = join(dir, 'canonical.md')
  writeFileSync(path, body)
  return path
}

function argv(overrides: Record<string, string> = {}, extras: string[] = []): string[] {
  const values = {
    issue: ISSUE,
    repo: REPOSITORY,
    expectedPr: PR,
    expectedBase: BASE,
    expectedState: 'ELIGIBLE_FOR_FOUNDER_REVIEW',
    expectedHead: HEAD,
    expectedReviewCycle: '1',
    expectedFullReviewCount: '1',
    sourceComment: SOURCE_COMMENT,
    authorizationComment: AUTHORIZATION_COMMENT,
    bodyFile: writeBodyFile(canonicalBody()),
    ...overrides,
  }
  return [
    values.issue,
    '--repo', values.repo,
    '--expected-pr', values.expectedPr,
    '--expected-base', values.expectedBase,
    '--expected-state', values.expectedState,
    '--expected-head', values.expectedHead,
    '--expected-review-cycle', values.expectedReviewCycle,
    '--expected-full-review-count', values.expectedFullReviewCount,
    '--source-comment', values.sourceComment,
    '--authorization-comment', values.authorizationComment,
    '--body-file', values.bodyFile,
    ...extras,
  ]
}

type Scenario = {
  managedIssue: {
    number: number
    body: string
    managedState: Record<string, unknown>
  }
  pullRequest: Record<string, unknown>
  issueComments: Array<Record<string, unknown>>
  commentsById: Map<string, Record<string, unknown>>
  postCount: number
  updateCount: number
  writeCount: number
  postedBodies: string[]
  updatedBodies: Array<{ id: string; body: string }>
}

const STANDARD_OPTIONS = {
  issueNumber: ISSUE,
  repo: REPOSITORY,
  expectedPr: PR,
  expectedBase: BASE,
  expectedState: 'ELIGIBLE_FOR_FOUNDER_REVIEW',
  expectedHead: HEAD,
  expectedReviewCycle: '1',
  expectedFullReviewCount: '1',
  sourceComment: SOURCE_COMMENT,
  authorizationComment: AUTHORIZATION_COMMENT,
}

function createScenario(overrides: {
  sourceBody?: string
  extraComments?: Array<Record<string, unknown>>
  authorization?: Record<string, unknown>
  authorizationAuthor?: { login: string; author_association: string }
  authorizationIssueUrl?: string | null
  managedState?: Record<string, unknown>
  pullRequest?: Record<string, unknown>
} = {}): { scenario: Scenario; deps: RebindDeps } {
  const source = {
    id: SOURCE_COMMENT,
    body: overrides.sourceBody ?? legacySourceBody(),
    issue_url: `https://api.github.com/repos/${REPOSITORY}/issues/${ISSUE}`,
    user: { login: 'boat1994' },
    author: 'boat1994',
    author_association: 'OWNER',
    createdAt: '2026-07-20T10:00:00+07:00',
  }
  const authorization: Record<string, unknown> = {
    id: AUTHORIZATION_COMMENT,
    body: authorizationBody(overrides.authorization),
    user: { login: overrides.authorizationAuthor?.login ?? 'boat1994' },
    author: overrides.authorizationAuthor?.login ?? 'boat1994',
    author_association: overrides.authorizationAuthor?.author_association ?? 'OWNER',
    createdAt: '2026-08-15T21:00:00+07:00',
  }
  if (overrides.authorizationIssueUrl !== null) {
    authorization.issue_url = overrides.authorizationIssueUrl
      ?? `https://api.github.com/repos/${REPOSITORY}/issues/${ISSUE}`
  }
  const extraComments = overrides.extraComments ?? []
  const commentsById = new Map<string, Record<string, unknown>>([
    [SOURCE_COMMENT, source],
    [AUTHORIZATION_COMMENT, authorization],
    ...extraComments.map((comment) => [String(comment.id), comment] as const),
  ])
  const initialState = { ...initialManagedState(), ...overrides.managedState }
  const scenario: Scenario = {
    managedIssue: {
      number: 259,
      body: `Mission Control mode: required\n\n${renderMissionControlState(initialState)}`,
      managedState: initialState,
    },
    pullRequest: {
      number: 260,
      baseRefName: BASE,
      headRefOid: HEAD,
      state: 'OPEN',
      isDraft: false,
      ...overrides.pullRequest,
    },
    issueComments: [source, authorization, ...extraComments],
    commentsById,
    postCount: 0,
    updateCount: 0,
    writeCount: 0,
    postedBodies: [],
    updatedBodies: [],
  }

  const deps = {
    readManagedIssue: async () => {
      const parsed = parseMissionControlState(scenario.managedIssue.body)
      return {
        ...structuredClone(scenario.managedIssue),
        managedState: parsed.valid ? parsed.state : scenario.managedIssue.managedState,
      }
    },
    readPullRequest: async () => structuredClone(scenario.pullRequest),
    readIssueComments: async () => structuredClone(scenario.issueComments),
    readComment: async (_repo: string, commentId: string) => {
      const comment = scenario.commentsById.get(String(commentId))
      if (!comment) throw new Error(`missing comment ${commentId}`)
      return structuredClone(comment)
    },
    postComment: async (_repo: string, _issueNumber: string, body: string) => {
      scenario.postCount += 1
      scenario.postedBodies.push(body)
      const comment = {
        id: CANONICAL_COMMENT_ID,
        body,
        author: 'boat1994',
        user: { login: 'boat1994' },
        author_association: 'OWNER',
        createdAt: '2026-08-15T22:00:00+07:00',
      }
      scenario.issueComments = [...scenario.issueComments, comment]
      scenario.commentsById.set(String(comment.id), comment)
      return comment
    },
    updateComment: async (_repo: string, commentId: string, body: string) => {
      scenario.updateCount += 1
      scenario.updatedBodies.push({ id: String(commentId), body })
      const current = scenario.commentsById.get(String(commentId))
      if (!current) throw new Error(`missing comment ${commentId}`)
      const updated = { ...current, body }
      scenario.commentsById.set(String(commentId), updated)
      scenario.issueComments = scenario.issueComments.map((comment) =>
        String(comment.id) === String(commentId) ? updated : comment,
      )
      return updated
    },
    writeIssueBody: async ({ nextBody }: { nextBody: string }) => {
      scenario.writeCount += 1
      const parsed = parseMissionControlState(nextBody)
      if (!parsed.valid || !parsed.state) throw new Error(`invalid projected fixture state: ${parsed.reason}`)
      scenario.managedIssue = {
        ...scenario.managedIssue,
        body: nextBody,
        managedState: parsed.state,
      }
      return {
        path: `issues/${ISSUE}`,
        observedBodyHash: 'observed',
        nextBodyHash: 'next',
        adopted: true,
      }
    },
  }

  return { scenario, deps }
}

describe('Mission Control review lineage rebind transport', () => {
  it('registers one exceptional lineage-transport route without changing ordinary review ownership', async () => {
    expect(getTransportRoute(COMMAND)).toMatchObject({
      owner: 'Mission Control Lineage Rebind Transport',
      role: 'REVIEW_VERDICT',
      exceptional: true,
      ordinary_owner: 'bemoat:mission-control:review',
    })
    expect(CANONICAL_TRANSPORTS.filter((route) => route.role === 'REVIEW_VERDICT')).toHaveLength(3)
    expect(getTransportRoute('bemoat:mission-control:review')).toMatchObject({
      exceptional: false,
      purpose: 'publish an ordinary Full or Delta Review verdict',
    })
  })

  it('exposes a quarantined --help --json contract without mutation', async () => {
    const { scenario, deps } = createScenario()
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const previousExitCode = process.exitCode
    try {
      const result = await main(['--help', '--json'], deps)
      expect(result).toMatchObject({ classification: 'HELP' })
    } finally {
      stdout.mockRestore()
      process.exitCode = previousExitCode
    }
    expect(scenario.postCount).toBe(0)
    expect(scenario.updateCount).toBe(0)
    expect(scenario.writeCount).toBe(0)

    const contract = getCommandContract(COMMAND)
    expect(contract).toMatchObject({
      command: COMMAND,
      exceptional: true,
      transport_role: 'REVIEW_VERDICT',
      accepted_pre_states: ['ELIGIBLE_FOR_FOUNDER_REVIEW'],
      help_meaningful: true,
      safe_help_invocation: 'pnpm run bemoat:mission-control:rebind-review-lineage -- --help --json',
    })
    expect(COMMAND_CONTRACT_REGISTRY.routes.some(
      (route) => route.canonical_command === COMMAND,
    )).toBe(true)
  })

  it('fails closed on an exact tuple mismatch before any mutation', async () => {
    const { scenario, deps } = createScenario()
    await expect(runReviewLineageRebind({
      options: {
        issueNumber: '274',
        repo: REPOSITORY,
        expectedPr: PR,
        expectedBase: BASE,
        expectedState: 'ELIGIBLE_FOR_FOUNDER_REVIEW',
        expectedHead: HEAD,
        expectedReviewCycle: '1',
        expectedFullReviewCount: '1',
        sourceComment: SOURCE_COMMENT,
        authorizationComment: AUTHORIZATION_COMMENT,
      },
      body: canonicalBody(),
      deps,
    })).rejects.toThrow(/STATE_CONFLICT/)
    expect(scenario.postCount).toBe(0)
    expect(scenario.updateCount).toBe(0)
    expect(scenario.writeCount).toBe(0)
  })

  it('fails closed when Founder authorization is missing or unbound', async () => {
    const missing = createScenario()
    missing.scenario.commentsById.delete(AUTHORIZATION_COMMENT)
    missing.scenario.issueComments = missing.scenario.issueComments.filter(
      (comment) => String(comment.id) !== AUTHORIZATION_COMMENT,
    )
    await expect(runReviewLineageRebind({
      options: {
        issueNumber: ISSUE,
        repo: REPOSITORY,
        expectedPr: PR,
        expectedBase: BASE,
        expectedState: 'ELIGIBLE_FOR_FOUNDER_REVIEW',
        expectedHead: HEAD,
        expectedReviewCycle: '1',
        expectedFullReviewCount: '1',
        sourceComment: SOURCE_COMMENT,
        authorizationComment: AUTHORIZATION_COMMENT,
      },
      body: canonicalBody(),
      deps: missing.deps,
    })).rejects.toThrow(/AUTHORITY_CONFLICT|STATE_CONFLICT/)
    expect(missing.scenario.postCount).toBe(0)

    const unbound = createScenario({
      authorizationAuthor: { login: 'octocat', author_association: 'CONTRIBUTOR' },
    })
    await expect(runReviewLineageRebind({
      options: {
        issueNumber: ISSUE,
        repo: REPOSITORY,
        expectedPr: PR,
        expectedBase: BASE,
        expectedState: 'ELIGIBLE_FOR_FOUNDER_REVIEW',
        expectedHead: HEAD,
        expectedReviewCycle: '1',
        expectedFullReviewCount: '1',
        sourceComment: SOURCE_COMMENT,
        authorizationComment: AUTHORIZATION_COMMENT,
      },
      body: canonicalBody(),
      deps: unbound.deps,
    })).rejects.toThrow(/AUTHORITY_CONFLICT/)
    expect(unbound.scenario.postCount).toBe(0)
  })

  it('posts canonical REVIEW_VERDICT, demotes the source, and CAS-projects only lineage identity', async () => {
    const { scenario, deps } = createScenario()
    const prior = structuredClone(scenario.managedIssue.managedState)

    const result = await runReviewLineageRebind({
      options: {
        issueNumber: ISSUE,
        repo: REPOSITORY,
        expectedPr: PR,
        expectedBase: BASE,
        expectedState: 'ELIGIBLE_FOR_FOUNDER_REVIEW',
        expectedHead: HEAD,
        expectedReviewCycle: '1',
        expectedFullReviewCount: '1',
        sourceComment: SOURCE_COMMENT,
        authorizationComment: AUTHORIZATION_COMMENT,
      },
      body: canonicalBody(),
      deps,
    })

    expect(result).toMatchObject({
      classification: 'SUCCESS',
      outcome: 'REBOUND',
    })
    expect(scenario.postCount).toBe(1)
    expect(scenario.updateCount).toBe(1)
    expect(scenario.writeCount).toBe(1)
    expect(scenario.postedBodies[0]).toBe(canonicalBody())
    expect(scenario.updatedBodies[0]).toMatchObject({ id: SOURCE_COMMENT })
    expect(String(scenario.updatedBodies[0]?.body)).toContain(demotionPrefix(CANONICAL_COMMENT_ID))
    expect(String(scenario.updatedBodies[0]?.body)).toContain('**Task:** #259')

    const next = scenario.managedIssue.managedState
    expect(next).toMatchObject({
      state: 'ELIGIBLE_FOR_FOUNDER_REVIEW',
      review_cycle: 1,
      full_review_count: 1,
      approved_base: BASE,
      active_pr: '#260',
      current_head: HEAD,
      last_reviewed_head: HEAD,
      latest_review_verdict_comment_id: String(CANONICAL_COMMENT_ID),
    })
    expect(next.latest_transition_identity).not.toBe(prior.latest_transition_identity)
    expect(next.review_cycle).toBe(prior.review_cycle)
    expect(next.full_review_count).toBe(prior.full_review_count)
    expect(next.state).toBe(prior.state)
    expect(next.open_blockers).toEqual(prior.open_blockers)
    expect(next.next_permitted_action).toBe(prior.next_permitted_action)

    const selected = selectLiveReviewVerdictComment({
      comments: scenario.issueComments,
      issueNumber: ISSUE,
      livePr: scenario.pullRequest,
    })
    expect(String(selected.id)).toBe(CANONICAL_COMMENT_ID)
    expect(parseLegacyReviewVerdictBinding(String(selected.body ?? ''))).toBeNull()
  })

  it('returns NO_OP_IDENTICAL_RETRY without a second post, demote, or CAS write', async () => {
    const { scenario, deps } = createScenario()
    const options = {
      issueNumber: ISSUE,
      repo: REPOSITORY,
      expectedPr: PR,
      expectedBase: BASE,
      expectedState: 'ELIGIBLE_FOR_FOUNDER_REVIEW',
      expectedHead: HEAD,
      expectedReviewCycle: '1',
      expectedFullReviewCount: '1',
      sourceComment: SOURCE_COMMENT,
      authorizationComment: AUTHORIZATION_COMMENT,
    }
    const first = await runReviewLineageRebind({ options, body: canonicalBody(), deps })
    const firstState = structuredClone(scenario.managedIssue.managedState)
    const retry = await runReviewLineageRebind({ options, body: canonicalBody(), deps })

    expect(first).toMatchObject({ classification: 'SUCCESS' })
    expect(retry).toMatchObject({
      classification: 'NO_OP_IDENTICAL_RETRY',
      outcome: 'NO_OP',
    })
    expect(scenario.postCount).toBe(1)
    expect(scenario.updateCount).toBe(1)
    expect(scenario.writeCount).toBe(1)
    expect(scenario.managedIssue.managedState).toEqual(firstState)
  })

  it('fails closed when a competing active REVIEW_VERDICT exists without demotion', async () => {
    const competing = {
      id: '9000000099',
      body: canonicalBody().replace('lineage transport', 'competing review'),
      author: 'boat1994',
      user: { login: 'boat1994' },
      author_association: 'OWNER',
      createdAt: '2026-08-15T21:30:00+07:00',
    }
    const { scenario, deps } = createScenario({ extraComments: [competing] })
    await expect(runReviewLineageRebind({
      options: {
        issueNumber: ISSUE,
        repo: REPOSITORY,
        expectedPr: PR,
        expectedBase: BASE,
        expectedState: 'ELIGIBLE_FOR_FOUNDER_REVIEW',
        expectedHead: HEAD,
        expectedReviewCycle: '1',
        expectedFullReviewCount: '1',
        sourceComment: SOURCE_COMMENT,
        authorizationComment: AUTHORIZATION_COMMENT,
      },
      body: canonicalBody(),
      deps,
    })).rejects.toThrow(/AMBIGUOUS_RESULT|STATE_CONFLICT/)
    expect(scenario.writeCount).toBe(0)
  })

  it('classifies a posted-but-undemoted partial mutation as AMBIGUOUS_RESULT', async () => {
    const { scenario, deps } = createScenario()
    const originalUpdate = deps.updateComment
    deps.updateComment = async () => {
      throw new Error('GitHub comment update failed')
    }
    await expect(runReviewLineageRebind({
      options: {
        issueNumber: ISSUE,
        repo: REPOSITORY,
        expectedPr: PR,
        expectedBase: BASE,
        expectedState: 'ELIGIBLE_FOR_FOUNDER_REVIEW',
        expectedHead: HEAD,
        expectedReviewCycle: '1',
        expectedFullReviewCount: '1',
        sourceComment: SOURCE_COMMENT,
        authorizationComment: AUTHORIZATION_COMMENT,
      },
      body: canonicalBody(),
      deps,
    })).rejects.toThrow(/AMBIGUOUS_RESULT/)
    expect(scenario.postCount).toBe(1)
    expect(scenario.writeCount).toBe(0)
    deps.updateComment = originalUpdate
  })

  it('rejects a CLI invocation whose flags do not match the registered tuple', async () => {
    const { scenario, deps } = createScenario()
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const previousExitCode = process.exitCode
    try {
      const result = await main(argv({ expectedPr: '275' }), deps)
      expect(result.classification).toBe('STATE_CONFLICT')
    } finally {
      stdout.mockRestore()
      stderr.mockRestore()
      process.exitCode = previousExitCode
    }
    expect(scenario.postCount).toBe(0)
    expect(scenario.writeCount).toBe(0)
  })

  it('fails closed when replacement Findings diverge from source Review 1 (DIVERGENT_FINDINGS_ACCEPTED)', async () => {
    const divergentBody = canonicalBody().replace(
      '**Findings:** Critical: None · Important: None',
      '**Findings:** Critical: Forged · Important: None',
    )
    const { scenario, deps } = createScenario({
      authorization: {
        replacement_body_sha256: sha256Hex(divergentBody),
        source_body_sha256: sha256Hex(legacySourceBody()),
      },
    })
    await expect(runReviewLineageRebind({
      options: STANDARD_OPTIONS,
      body: divergentBody,
      deps,
    })).rejects.toThrow(/STATE_CONFLICT|AUTHORITY_CONFLICT/)
    expect(scenario.postCount).toBe(0)
    expect(scenario.updateCount).toBe(0)
    expect(scenario.writeCount).toBe(0)
  })

  it('fails closed when the replacement body diverges by one byte from the authorized body', async () => {
    const { scenario, deps } = createScenario()
    await expect(runReviewLineageRebind({
      options: STANDARD_OPTIONS,
      body: `${canonicalBody()} `,
      deps,
    })).rejects.toThrow(/STATE_CONFLICT|AUTHORITY_CONFLICT/)
    expect(scenario.postCount).toBe(0)
    expect(scenario.updateCount).toBe(0)
    expect(scenario.writeCount).toBe(0)
  })

  it('fails closed when Founder authorization is hosted on Issue #340 (WRONG_ISSUE_AUTH_ACCEPTED)', async () => {
    const { scenario, deps } = createScenario({
      authorizationIssueUrl: `https://api.github.com/repos/${REPOSITORY}/issues/340`,
    })
    await expect(runReviewLineageRebind({
      options: STANDARD_OPTIONS,
      body: canonicalBody(),
      deps,
    })).rejects.toThrow(/AUTHORITY_CONFLICT/)
    expect(scenario.postCount).toBe(0)
    expect(scenario.updateCount).toBe(0)
    expect(scenario.writeCount).toBe(0)
  })

  it('fails closed when Founder authorization is hosted on another Issue', async () => {
    const { scenario, deps } = createScenario({
      authorizationIssueUrl: `https://api.github.com/repos/${REPOSITORY}/issues/1`,
    })
    await expect(runReviewLineageRebind({
      options: STANDARD_OPTIONS,
      body: canonicalBody(),
      deps,
    })).rejects.toThrow(/AUTHORITY_CONFLICT/)
    expect(scenario.postCount).toBe(0)
    expect(scenario.updateCount).toBe(0)
    expect(scenario.writeCount).toBe(0)
  })

  it('fails closed when Founder authorization is missing issue_url', async () => {
    const { scenario, deps } = createScenario({
      authorizationIssueUrl: null,
    })
    await expect(runReviewLineageRebind({
      options: STANDARD_OPTIONS,
      body: canonicalBody(),
      deps,
    })).rejects.toThrow(/AUTHORITY_CONFLICT/)
    expect(scenario.postCount).toBe(0)
    expect(scenario.updateCount).toBe(0)
    expect(scenario.writeCount).toBe(0)
  })

  it('fails closed when Founder authorization is hosted on another repository', async () => {
    const { scenario, deps } = createScenario({
      authorizationIssueUrl: 'https://api.github.com/repos/other/repo/issues/259',
    })
    await expect(runReviewLineageRebind({
      options: STANDARD_OPTIONS,
      body: canonicalBody(),
      deps,
    })).rejects.toThrow(/AUTHORITY_CONFLICT/)
    expect(scenario.postCount).toBe(0)
    expect(scenario.updateCount).toBe(0)
    expect(scenario.writeCount).toBe(0)
  })

  it('fails closed when replacement_body_sha256 does not match the replacement body', async () => {
    const { scenario, deps } = createScenario({
      authorization: {
        replacement_body_sha256: '0'.repeat(64),
      },
    })
    await expect(runReviewLineageRebind({
      options: STANDARD_OPTIONS,
      body: canonicalBody(),
      deps,
    })).rejects.toThrow(/AUTHORITY_CONFLICT/)
    expect(scenario.postCount).toBe(0)
    expect(scenario.updateCount).toBe(0)
    expect(scenario.writeCount).toBe(0)
  })

  it('fails closed when source_body_sha256 does not match the live source body', async () => {
    const { scenario, deps } = createScenario({
      authorization: {
        source_body_sha256: '0'.repeat(64),
      },
    })
    await expect(runReviewLineageRebind({
      options: STANDARD_OPTIONS,
      body: canonicalBody(),
      deps,
    })).rejects.toThrow(/AUTHORITY_CONFLICT/)
    expect(scenario.postCount).toBe(0)
    expect(scenario.updateCount).toBe(0)
    expect(scenario.writeCount).toBe(0)
  })

  it('fails closed when replacement omits the Findings line even when hashes match', async () => {
    const omitted = canonicalBody().replace(/^\*\*Findings:\*\*.*\n/m, '')
    const { scenario, deps } = createScenario({
      authorization: {
        replacement_body_sha256: sha256Hex(omitted),
        source_body_sha256: sha256Hex(legacySourceBody()),
      },
    })
    await expect(runReviewLineageRebind({
      options: STANDARD_OPTIONS,
      body: omitted,
      deps,
    })).rejects.toThrow(/STATE_CONFLICT|AUTHORITY_CONFLICT/)
    expect(scenario.postCount).toBe(0)
    expect(scenario.updateCount).toBe(0)
    expect(scenario.writeCount).toBe(0)
  })

  it('does not import or call parseLegacyReviewVerdictBinding retirement paths', async () => {
    const source = readFileSync(
      resolve(process.cwd(), 'scripts/mission-control/workflows/rebind-review-lineage.mjs'),
      'utf8',
    )
    expect(source).not.toMatch(/retire|removeLegacy|deleteLegacy/)
    expect(parseLegacyReviewVerdictBinding(legacySourceBody())).toMatchObject({
      kind: 'legacy',
      issueNumber: '259',
      prNumber: '260',
      base: 'main',
      head: HEAD,
    })
    expect(parseLegacyReviewVerdictBinding(readLiveSourceComment5163387315())).toMatchObject({
      kind: 'legacy',
      issueNumber: '259',
      prNumber: '260',
      base: 'main',
      head: HEAD,
    })
  })

  it('accepts byte-faithful live source 5163387315 when canonical replacement Findings remain None', async () => {
    const { scenario, deps, liveSource } = liveSourceScenario()
    expect(liveSource).toContain('- **Critical/Important:** None.')
    const result = await runReviewLineageRebind({
      options: STANDARD_OPTIONS,
      body: canonicalBody(),
      deps,
    })
    expect(result).toMatchObject({
      classification: 'SUCCESS',
      outcome: 'REBOUND',
    })
    expect(scenario.postCount).toBe(1)
    expect(scenario.updateCount).toBe(1)
    expect(scenario.writeCount).toBe(1)
    expect(scenario.postedBodies[0]).toContain('**Findings:** Critical: None · Important: None')
  })

  it('rejects a replacement that adds an Important finding to live source None', async () => {
    const divergentBody = canonicalBody().replace(
      '**Findings:** Critical: None · Important: None',
      '**Findings:** Critical: None · Important: Forged finding',
    )
    const { scenario, deps } = liveSourceScenario({
      authorization: { replacementBody: divergentBody },
    })
    await expect(runReviewLineageRebind({
      options: STANDARD_OPTIONS,
      body: divergentBody,
      deps,
    })).rejects.toThrow(/preserve source Review 1 Critical\/Important provenance/)
    expect(scenario.postCount).toBe(0)
    expect(scenario.updateCount).toBe(0)
    expect(scenario.writeCount).toBe(0)
  })

  it('rejects a replacement that adds a Critical finding to live source None', async () => {
    const divergentBody = canonicalBody().replace(
      '**Findings:** Critical: None · Important: None',
      '**Findings:** Critical: Forged finding · Important: None',
    )
    const { scenario, deps } = liveSourceScenario({
      authorization: { replacementBody: divergentBody },
    })
    await expect(runReviewLineageRebind({
      options: STANDARD_OPTIONS,
      body: divergentBody,
      deps,
    })).rejects.toThrow(/preserve source Review 1 Critical\/Important provenance/)
    expect(scenario.postCount).toBe(0)
    expect(scenario.updateCount).toBe(0)
    expect(scenario.writeCount).toBe(0)
  })

  it('rejects live source findings/body drift through source_body_sha256', async () => {
    const liveSource = readLiveSourceComment5163387315()
    const drifted = liveSource.replace(
      '- **Critical/Important:** None.',
      '- **Critical/Important:** Forged.',
    )
    const { scenario, deps } = liveSourceScenario({ sourceBody: drifted })
    await expect(runReviewLineageRebind({
      options: STANDARD_OPTIONS,
      body: canonicalBody(),
      deps,
    })).rejects.toThrow(/source_body_sha256/)
    expect(scenario.postCount).toBe(0)
    expect(scenario.updateCount).toBe(0)
    expect(scenario.writeCount).toBe(0)
  })

  it('rejects replacement byte drift through replacement_body_sha256 for the live source', async () => {
    const { scenario, deps } = liveSourceScenario()
    await expect(runReviewLineageRebind({
      options: STANDARD_OPTIONS,
      body: `${canonicalBody()} `,
      deps,
    })).rejects.toThrow(/replacement_body_sha256/)
    expect(scenario.postCount).toBe(0)
    expect(scenario.updateCount).toBe(0)
    expect(scenario.writeCount).toBe(0)
  })

  it('rejects Founder authorization hosted on Issue #340 for the live source', async () => {
    const { scenario, deps } = liveSourceScenario({
      authorizationIssueUrl: `https://api.github.com/repos/${REPOSITORY}/issues/340`,
    })
    await expect(runReviewLineageRebind({
      options: STANDARD_OPTIONS,
      body: canonicalBody(),
      deps,
    })).rejects.toThrow(/AUTHORITY_CONFLICT/)
    expect(scenario.postCount).toBe(0)
    expect(scenario.updateCount).toBe(0)
    expect(scenario.writeCount).toBe(0)
  })
})
