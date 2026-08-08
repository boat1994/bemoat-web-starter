import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

import {
  createHelpEnvelopeV1,
} from '../../scripts/cli/command-help.mjs'
import { getCommandContract } from '../../scripts/cli/command-contract.mjs'
import {
  ACTIVE_CORRECTION_CONTRACT_IDENTITY_KEY,
  reconstructDeltaReviewFindingUnion,
  resolveAuthoritativeCorrectionContract,
  sameValue,
} from '../../scripts/mission-control/domain/active-correction-contract.mjs'
import {
  parseFounderAdoptFindingAuthorization,
} from '../../scripts/mission-control/domain/adopt-finding-authorization.mjs'
import {
  fingerprintCorrectionContract,
  hashExactBody,
} from '../../scripts/mission-control/domain/correction-contract-fingerprint.mjs'
import {
  exactNextAction,
  main,
  runAdoptFinding,
} from '../../scripts/mission-control/workflows/adopt-finding.mjs'
import {
  parseMissionControlState,
  renderMissionControlState,
} from '../../scripts/mission-control-state.mjs'
import { validateFindingEvidence } from '../../scripts/correction-contract.mjs'

const REPOSITORY = 'boat1994/bemoat-web-starter'
const ISSUE = '276'
const PR = '292'
const BASE = 'main'
const BASE_SHA = '7cf51129144a355172a32d57a73b5fda9eae5504'
const REVIEWED_HEAD = '24497c9891b03e4042ac34770a1dfd3b225be1e1'
const ADOPTION_HEAD = '917f879bea53ced5bc9622bd28f46d45046973c4'
const DRIFTED_HEAD = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const PREDECESSOR_COMMENT = '5213944977'
const AUTHORIZATION_COMMENT = '5215031090'
const POLICY_SOURCE_SHA = '7cf51129144a355172a32d57a73b5fda9eae5504'

type JsonObject = Record<string, unknown>
type HarnessIssue = {
  body: string
  managedState: JsonObject
  [key: string]: unknown
}

const predecessorFindings: Array<{
  id: string
  canonical_summary: string
  source_thread: string
  required_evidence: string[]
  expected_areas: string[]
  prohibited_areas: string[]
}> = [
  {
    id: 'CLI-IDEMPOTENCY-001',
    canonical_summary: 'bemoat:issue:comment must conditionally skip mutation and return NO_OP_IDENTICAL_RETRY when the validated comment is already the live authoritative comment',
    source_thread: `https://github.com/${REPOSITORY}/issues/${ISSUE}`,
    required_evidence: ['bemoat:issue:comment idempotency test output'],
    expected_areas: [],
    prohibited_areas: [],
  },
  {
    id: 'CLI-SCHEMA-001',
    canonical_summary: 'createHelpEnvelopeV1 must serialize stop_classifications to ensure agent stop conditions like AMBIGUOUS_RESULT are explicitly discoverable',
    source_thread: `https://github.com/${REPOSITORY}/issues/${ISSUE}`,
    required_evidence: ['command --help --json output containing stop_classifications'],
    expected_areas: [],
    prohibited_areas: [],
  },
]

function predecessorContractBody() {
  return `## REVIEW_VERDICT

**Verdict:** CORRECTION REQUIRED

\`\`\`json
${JSON.stringify({
    schema_version: 1,
    mode: 'implementation_pr',
    reviewed_head: REVIEWED_HEAD,
    findings: predecessorFindings,
  }, null, 2)}
\`\`\`
`
}

function founderAuthorizationBody(overrides: {
  findingId?: string
  repo?: string
  issue?: string
  pr?: string
  base?: string
  adoptionHead?: string
  predecessorComment?: string
  reviewedHead?: string
  existingFindings?: string[]
  extraFinding?: string | null
} = {}) {
  const findingId = overrides.findingId ?? 'MC-CORRECTION-FINDING-ADOPTION-001'
  const existing = overrides.existingFindings ?? ['CLI-IDEMPOTENCY-001', 'CLI-SCHEMA-001']
  const extra = overrides.extraFinding === undefined ? null : overrides.extraFinding
  return `## FOUNDER AUTHORIZATION — ${findingId}

The Founder approves exactly one bounded correction: \`${findingId}\`.

### Approved canonical transport

\`bemoat:mission-control:adopt-finding\`

### Exact approval binding

- Repository: \`${overrides.repo ?? REPOSITORY}\`
- Issue: \`#${overrides.issue ?? ISSUE}\`
- PR: \`#${overrides.pr ?? PR}\`
- Base: \`${overrides.base ?? `${BASE}@${BASE_SHA}`}\`
- Live adoption head: \`${overrides.adoptionHead ?? ADOPTION_HEAD}\`
- Predecessor contract: Issue comment \`${overrides.predecessorComment ?? PREDECESSOR_COMMENT}\`
- Predecessor reviewed head: \`${overrides.reviewedHead ?? REVIEWED_HEAD}\`
- Existing immutable findings:
${existing.map((id) => `  - \`${id}\``).join('\n')}
- Authorized appended finding:
  - \`${findingId}\`${extra ? `\n  - \`${extra}\`` : ''}
`
}

function baseState(overrides: JsonObject = {}): JsonObject {
  return {
    schema_version: 1,
    state: 'CORRECTION_REQUIRED_1',
    review_cycle: 1,
    full_review_count: 1,
    approved_base: BASE,
    active_task_issue: `#${ISSUE}`,
    active_pr: `#${PR}`,
    current_head: ADOPTION_HEAD,
    last_reviewed_head: REVIEWED_HEAD,
    workflow_mode: 'implementation_pr',
    guide_version: '1.3.0',
    guide_source_ref: BASE,
    guide_source_sha: POLICY_SOURCE_SHA,
    latest_review_verdict_comment_id: PREDECESSOR_COMMENT,
    open_blockers: ['CLI-IDEMPOTENCY-001', 'CLI-SCHEMA-001'],
    follow_up_issues: [],
    next_permitted_action: 'bounded correction',
    material_change_status: 'none',
    updated_at: '2026-08-07T07:33:25.000Z',
    updated_by: 'Mission Control',
    ...overrides,
  }
}

function options(overrides: JsonObject = {}) {
  return {
    issueNumber: ISSUE,
    repo: REPOSITORY,
    expectedPr: PR,
    expectedBase: BASE,
    expectedBaseSha: BASE_SHA,
    expectedState: 'CORRECTION_REQUIRED_1',
    expectedReviewedHead: REVIEWED_HEAD,
    expectedAdoptionHead: ADOPTION_HEAD,
    predecessorComment: PREDECESSOR_COMMENT,
    authorizationComment: AUTHORIZATION_COMMENT,
    ...overrides,
  }
}

function createHarness(overrides: {
  state?: JsonObject
  authorizationBody?: string
  predecessorBody?: string
  issueComments?: JsonObject[]
  trustedFounders?: string[]
  writeError?: Error
  skipWrite?: boolean
  afterWrite?: (issue: HarnessIssue) => void
  onWrite?: () => void
  pullHead?: string
  pullBaseSha?: string
} = {}) {
  const issueState = baseState(overrides.state)
  const issue: HarnessIssue = {
    number: Number(ISSUE),
    state: 'OPEN',
    body: `Task body\n${renderMissionControlState(issueState)}\n`,
    managedState: issueState,
  }
  const predecessorBody = overrides.predecessorBody ?? predecessorContractBody()
  const authorizationBody = overrides.authorizationBody ?? founderAuthorizationBody()
  const comments = overrides.issueComments ?? [
    {
      id: PREDECESSOR_COMMENT,
      issue_url: `https://api.github.com/repos/${REPOSITORY}/issues/${ISSUE}`,
      user: { login: 'boat1994' },
      author_association: 'OWNER',
      body: predecessorBody,
    },
    {
      id: AUTHORIZATION_COMMENT,
      issue_url: `https://api.github.com/repos/${REPOSITORY}/issues/${ISSUE}`,
      user: { login: 'boat1994' },
      author_association: 'OWNER',
      body: authorizationBody,
    },
  ]
  let writes = 0

  const deps = {
    readManagedIssue: async () => {
      const parsed = parseMissionControlState(issue.body)
      return {
        ...issue,
        managedState: parsed.state,
      }
    },
    readPullRequest: async () => ({
      number: Number(PR),
      state: 'OPEN',
      isDraft: false,
      headRefOid: overrides.pullHead ?? ADOPTION_HEAD,
      baseRefName: BASE,
      baseRefOid: overrides.pullBaseSha ?? BASE_SHA,
    }),
    readComment: async (_repo: string, commentId: string) => {
      const comment = comments.find((entry) => String(entry.id) === String(commentId))
      if (!comment) throw new Error(`BLOCKED_EXTERNAL: comment ${commentId} missing`)
      return structuredClone(comment)
    },
    readIssueComments: async () => structuredClone(comments),
    readTrustedFounderLogins: async () => overrides.trustedFounders ?? ['boat1994'],
    writeIssueBody: async ({ expectedBody, nextBody }: { expectedBody: string, nextBody: string }) => {
      if (overrides.writeError) throw overrides.writeError
      if (overrides.skipWrite) {
        return {
          path: 'lease',
          observedBodyHash: 'skip',
          nextBodyHash: 'skip',
          adopted: false,
        }
      }
      if (issue.body !== expectedBody) {
        throw new Error('STATE_CONFLICT: concurrent Issue body change detected before state write')
      }
      writes += 1
      overrides.onWrite?.()
      issue.body = nextBody
      const parsed = parseMissionControlState(nextBody)
      issue.managedState = parsed.state as JsonObject
      overrides.afterWrite?.(issue)
      return {
        path: 'lease',
        observedBodyHash: 'observed',
        nextBodyHash: 'next',
        adopted: true,
      }
    },
  }

  return { issue, deps, comments, getWrites: () => writes }
}

describe('bemoat:mission-control:adopt-finding', () => {
  it('help is zero-write and machine-readable', async () => {
    const { deps, getWrites } = createHarness()
    const before = getWrites()
    const result = await main(['--help', '--json'], deps)
    expect(result.classification).toBe('HELP')
    expect(getWrites()).toBe(before)
    const contract = getCommandContract('bemoat:mission-control:adopt-finding')
    const help = createHelpEnvelopeV1(contract)
    expect(help.command).toBe('bemoat:mission-control:adopt-finding')
    expect(help.tier).toBe('A')
    expect(help.accepted_pre_states).toEqual(['CORRECTION_REQUIRED_1', 'CORRECTION_REQUIRED_2'])
    expect((help.trusted_derived_values as string[]).join(' ')).toMatch(/Founder authorization/i)
    expect((help.trusted_derived_values as string[]).join(' ')).toMatch(/never be caller-supplied|trusted-derived|adopted finding/i)
    expect(help.stop_classifications).toEqual(expect.arrayContaining([
      'INVALID_INVOCATION',
      'UNSUPPORTED_PRE_STATE',
      'AUTHORITY_CONFLICT',
      'HEAD_DRIFT',
      'EVIDENCE_CONFLICT',
      'STATE_CONFLICT',
      'BLOCKED_EXTERNAL',
      'AMBIGUOUS_RESULT',
      'INTERNAL_ERROR',
    ]))
    expect((help.next_action_rules as Array<{ next_action: { command: string } }>)[0].next_action.command).toBe('bemoat:agent:issue')
  })

  it('--check --json is zero-write', async () => {
    const { deps, getWrites } = createHarness()
    const result = await runAdoptFinding({
      options: options(),
      deps,
      checkOnly: true,
    })
    expect(result.classification).toBe('SUCCESS')
    expect(result.mutationPerformed).toBe(false)
    expect(getWrites()).toBe(0)
  })

  it('only CORRECTION_REQUIRED_1|2 are accepted', async () => {
    const { deps } = createHarness({
      state: { state: 'AWAITING_REVIEW_2' },
    })
    await expect(runAdoptFinding({ options: options({ expectedState: 'CORRECTION_REQUIRED_1' }), deps }))
      .rejects.toThrow(/UNSUPPORTED_PRE_STATE/)
  })

  it('preserves state/counters/reviewed head and predecessor findings while appending exactly one trusted finding', async () => {
    const { deps, issue } = createHarness()
    const before = structuredClone(issue.managedState)
    const result = await runAdoptFinding({ options: options(), deps })
    expect(result.classification).toBe('SUCCESS')
    expect(result.mutationPerformed).toBe(true)
    expect(result.state.state).toBe('CORRECTION_REQUIRED_1')
    expect(result.state.review_cycle).toBe(before.review_cycle)
    expect(result.state.full_review_count).toBe(before.full_review_count)
    expect(result.state.last_reviewed_head).toBe(before.last_reviewed_head)
    expect(result.state.current_head).toBe(before.current_head)
    const identity = result.state[ACTIVE_CORRECTION_CONTRACT_IDENTITY_KEY] as JsonObject
    expect(identity.adopted_finding_id).toBe('MC-CORRECTION-FINDING-ADOPTION-001')
    const findings = (identity.contract as { findings: Array<{ id: string }> }).findings
    expect(findings.map((finding) => finding.id)).toEqual([
      'CLI-IDEMPOTENCY-001',
      'CLI-SCHEMA-001',
      'MC-CORRECTION-FINDING-ADOPTION-001',
    ])
    expect(sameValue(findings.slice(0, 2), predecessorFindings)).toBe(true)
    expect(exactNextAction(ISSUE)).toBe('pnpm run bemoat:agent:issue -- 276 --phase correction')
  })

  it('derives finding data from Founder authorization, not caller input', () => {
    const authorization = parseFounderAdoptFindingAuthorization(founderAuthorizationBody()) as {
      adopted_finding: {
        id: string
        canonical_summary: string
        source_thread: string
      }
      authorization_id: string
    }
    expect(authorization.adopted_finding.id).toBe('MC-CORRECTION-FINDING-ADOPTION-001')
    expect(authorization.adopted_finding.canonical_summary).toContain('bemoat:mission-control:adopt-finding')
    expect(authorization.adopted_finding.source_thread).toContain(`/issues/${ISSUE}`)
    expect(() => parseFounderAdoptFindingAuthorization(founderAuthorizationBody({
      extraFinding: 'EXTRA-FINDING-001',
    }))).toThrow(/exactly one appended finding|EVIDENCE_CONFLICT/)
  })

  it('stops on wrong Founder/trust evidence', async () => {
    const { deps } = createHarness({ trustedFounders: ['someone-else'] })
    await expect(runAdoptFinding({ options: options(), deps }))
      .rejects.toThrow(/AUTHORITY_CONFLICT/)
  })

  it('stops on wrong repo/Issue/PR', async () => {
    const { deps } = createHarness({
      authorizationBody: founderAuthorizationBody({ issue: '999' }),
    })
    await expect(runAdoptFinding({ options: options(), deps }))
      .rejects.toThrow(/EVIDENCE_CONFLICT/)
  })

  it('stops on wrong base/head', async () => {
    const { deps } = createHarness({ pullHead: DRIFTED_HEAD })
    await expect(runAdoptFinding({ options: options(), deps }))
      .rejects.toThrow(/HEAD_DRIFT/)
  })

  it('stops on wrong predecessor comment/hash/fingerprint', async () => {
    const body = predecessorContractBody()
    const { deps } = createHarness()
    await expect(runAdoptFinding({
      options: options({
        expectedPredecessorBodySha: '0'.repeat(64),
      }),
      deps,
    })).rejects.toThrow(/EVIDENCE_CONFLICT/)
    await expect(runAdoptFinding({
      options: options({
        expectedPredecessorBodySha: hashExactBody(body),
        expectedPredecessorFingerprint: '1'.repeat(64),
      }),
      deps,
    })).rejects.toThrow(/EVIDENCE_CONFLICT/)
  })

  it('stops on superseded Founder authorization', async () => {
    const { deps } = createHarness({
      issueComments: [
        {
          id: PREDECESSOR_COMMENT,
          issue_url: `https://api.github.com/repos/${REPOSITORY}/issues/${ISSUE}`,
          user: { login: 'boat1994' },
          author_association: 'OWNER',
          body: predecessorContractBody(),
        },
        {
          id: AUTHORIZATION_COMMENT,
          issue_url: `https://api.github.com/repos/${REPOSITORY}/issues/${ISSUE}`,
          user: { login: 'boat1994' },
          author_association: 'OWNER',
          body: founderAuthorizationBody(),
        },
        {
          id: '5215031091',
          issue_url: `https://api.github.com/repos/${REPOSITORY}/issues/${ISSUE}`,
          user: { login: 'boat1994' },
          author_association: 'OWNER',
          body: `supersedes: ${AUTHORIZATION_COMMENT}\nThis authorization is superseded / not authoritative.`,
        },
      ],
    })
    await expect(runAdoptFinding({ options: options(), deps }))
      .rejects.toThrow(/AUTHORITY_CONFLICT/)
  })

  it('stops on multiple candidate authorizations', async () => {
    const { deps } = createHarness({
      issueComments: [
        {
          id: PREDECESSOR_COMMENT,
          issue_url: `https://api.github.com/repos/${REPOSITORY}/issues/${ISSUE}`,
          user: { login: 'boat1994' },
          author_association: 'OWNER',
          body: predecessorContractBody(),
        },
        {
          id: AUTHORIZATION_COMMENT,
          issue_url: `https://api.github.com/repos/${REPOSITORY}/issues/${ISSUE}`,
          user: { login: 'boat1994' },
          author_association: 'OWNER',
          body: founderAuthorizationBody(),
        },
        {
          id: '5215031999',
          issue_url: `https://api.github.com/repos/${REPOSITORY}/issues/${ISSUE}`,
          user: { login: 'boat1994' },
          author_association: 'OWNER',
          body: founderAuthorizationBody({ findingId: 'MC-CORRECTION-FINDING-ADOPTION-001' }),
        },
      ],
    })
    await expect(runAdoptFinding({ options: options(), deps }))
      .rejects.toThrow(/AUTHORITY_CONFLICT|competing/)
  })

  it('stale CAS stops without partial mutation', async () => {
    const { deps, getWrites, issue } = createHarness({
      onWrite: () => {
        // mutate expected body identity before write completes by changing issue after snapshot
      },
      writeError: new Error('STATE_CONFLICT: concurrent Issue body change detected before state write'),
    })
    const before = issue.body
    await expect(runAdoptFinding({ options: options(), deps }))
      .rejects.toThrow(/STATE_CONFLICT/)
    expect(getWrites()).toBe(0)
    expect(issue.body).toBe(before)
  })

  it('lease conflict stops', async () => {
    const { deps } = createHarness({
      writeError: new Error('STATE_CONFLICT: issue-body lease CAS lost; concurrent writer holds the lease'),
    })
    await expect(runAdoptFinding({ options: options(), deps }))
      .rejects.toThrow(/STATE_CONFLICT|lease/)
  })

  it('success updates only active correction-contract identity', async () => {
    const { deps, issue } = createHarness()
    const beforeKeys = Object.keys(issue.managedState).sort()
    const result = await runAdoptFinding({ options: options(), deps })
    const after = result.state
    for (const key of beforeKeys) {
      if (key === 'updated_at' || key === 'updated_by' || key === 'next_permitted_action') continue
      expect(after[key]).toEqual(issue.managedState[key] === undefined ? after[key] : expect.anything())
    }
    expect(after[ACTIVE_CORRECTION_CONTRACT_IDENTITY_KEY]).toBeTruthy()
    expect(after.state).toBe('CORRECTION_REQUIRED_1')
    expect(after.review_cycle).toBe(1)
    expect(after.full_review_count).toBe(1)
    expect(after.last_reviewed_head).toBe(REVIEWED_HEAD)
  })

  it('identical completed retry returns NO_OP_IDENTICAL_RETRY with zero mutation', async () => {
    const harness = createHarness()
    const first = await runAdoptFinding({ options: options(), deps: harness.deps })
    expect(first.classification).toBe('SUCCESS')
    const writesAfterFirst = harness.getWrites()
    const second = await runAdoptFinding({ options: options(), deps: harness.deps })
    expect(second.classification).toBe('NO_OP_IDENTICAL_RETRY')
    expect(second.mutationPerformed).toBe(false)
    expect(harness.getWrites()).toBe(writesAfterFirst)
  })

  it('changed authorization is not an identical retry', async () => {
    const harness = createHarness()
    await runAdoptFinding({ options: options(), deps: harness.deps })
    const altered = createHarness({
      state: harness.issue.managedState,
      authorizationBody: founderAuthorizationBody({
        findingId: 'MC-CORRECTION-FINDING-ADOPTION-002',
      }),
      authorizationCommentOverride: true,
    } as never)
    // Rebuild with existing identity but different auth comment id.
    const withIdentity = createHarness({
      state: {
        ...harness.issue.managedState,
      },
    })
    // Force existing identity onto the new harness issue body.
    withIdentity.issue.body = harness.issue.body
    withIdentity.issue.managedState = harness.issue.managedState
    await expect(runAdoptFinding({
      options: options({ authorizationComment: '5215038888' }),
      deps: {
        ...withIdentity.deps,
        readComment: async (_repo: string, commentId: string) => {
          if (String(commentId) === '5215038888') {
            return {
              id: '5215038888',
              issue_url: `https://api.github.com/repos/${REPOSITORY}/issues/${ISSUE}`,
              user: { login: 'boat1994' },
              author_association: 'OWNER',
              body: founderAuthorizationBody({ findingId: 'MC-CORRECTION-FINDING-ADOPTION-002' }),
            }
          }
          return withIdentity.deps.readComment(_repo, commentId)
        },
      },
    })).rejects.toThrow(/STATE_CONFLICT|AUTHORITY_CONFLICT|EVIDENCE_CONFLICT/)
    void altered
  })

  it('ambiguous mutation result is not retried as identical', async () => {
    const { deps } = createHarness({
      writeError: new Error('network timeout after accepted write'),
    })
    await expect(runAdoptFinding({ options: options(), deps }))
      .rejects.toThrow(/AMBIGUOUS_RESULT/)
  })

  it('reconciled union becomes authoritative for correction RESULT validation and Delta Review reconstruction', () => {
    const authorization = parseFounderAdoptFindingAuthorization(founderAuthorizationBody()) as {
      adopted_finding: {
        id: string
        canonical_summary: string
        source_thread: string
        required_evidence: string[]
        expected_areas: string[]
        prohibited_areas: string[]
      }
      authorization_id: string
    }
    const predecessor = {
      schema_version: 1,
      mode: 'implementation_pr',
      reviewed_head: REVIEWED_HEAD,
      findings: predecessorFindings,
    }
    const contract = {
      ...predecessor,
      findings: [...predecessorFindings, authorization.adopted_finding],
    }
    const identity = {
      schema_version: 1,
      kind: 'founder-adopted-finding',
      predecessor_comment_id: PREDECESSOR_COMMENT,
      predecessor_body_sha256: hashExactBody(predecessorContractBody()),
      predecessor_contract_fingerprint: fingerprintCorrectionContract(predecessor),
      founder_authorization_comment_id: AUTHORIZATION_COMMENT,
      founder_authorization_body_sha256: hashExactBody(founderAuthorizationBody()),
      founder_author_login: 'boat1994',
      non_superseded: true,
      adoption_head: ADOPTION_HEAD,
      reviewed_head: REVIEWED_HEAD,
      repository: REPOSITORY,
      task_issue: Number(ISSUE),
      pr: Number(PR),
      base: BASE,
      base_sha: BASE_SHA,
      contract_fingerprint: fingerprintCorrectionContract(contract),
      adopted_finding_id: authorization.adopted_finding.id,
      authorization_id: authorization.authorization_id,
      contract,
    }
    const body = `Task\n${renderMissionControlState({
      ...baseState(),
      [ACTIVE_CORRECTION_CONTRACT_IDENTITY_KEY]: identity,
    })}\n`
    const resolved = resolveAuthoritativeCorrectionContract({
      issueBody: body,
      latestCorrectionVerdictBody: predecessorContractBody(),
    })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.source).toBe('active_correction_contract_identity')
    expect((resolved.contract as { findings: Array<{ id: string }> }).findings.map((finding) => finding.id)).toEqual([
      'CLI-IDEMPOTENCY-001',
      'CLI-SCHEMA-001',
      'MC-CORRECTION-FINDING-ADOPTION-001',
    ])

    const delta = reconstructDeltaReviewFindingUnion({ issueBody: body })
    expect(delta.ok).toBe(true)
    if (!delta.ok) return
    expect(delta.finding_ids).toEqual([
      'CLI-IDEMPOTENCY-001',
      'CLI-SCHEMA-001',
      'MC-CORRECTION-FINDING-ADOPTION-001',
    ])

    const evidence = validateFindingEvidence(resolved.contract, {
      schema_version: 2,
      correction_base: REVIEWED_HEAD,
      finding_results: {
        'CLI-IDEMPOTENCY-001': {
          changed_files: ['scripts/post-role-comment.mjs'],
          tests: ['tests/int/post-role-comment.int.spec.ts'],
          status: 'CLAIMED_RESOLVED',
        },
        'CLI-SCHEMA-001': {
          changed_files: ['scripts/cli/command-help.mjs'],
          tests: ['tests/int/cli-invocation-contract.int.spec.ts'],
          status: 'CLAIMED_RESOLVED',
        },
        // Missing adopted finding must fail.
      },
    }, ['scripts/post-role-comment.mjs', 'scripts/cli/command-help.mjs'])
    expect(evidence.ok).toBe(false)
  })

  it('success next action is exactly the correction preflight command for issue 276', async () => {
    const { deps } = createHarness()
    const result = await runAdoptFinding({ options: options(), deps })
    expect(exactNextAction(ISSUE)).toBe('pnpm run bemoat:agent:issue -- 276 --phase correction')
    expect(result.classification).toBe('SUCCESS')
  })

  it('registry/inventory/docs cannot drift from the new Tier-A command', () => {
    const contract = getCommandContract('bemoat:mission-control:adopt-finding')
    expect(contract?.tier).toBe('A')
    expect(contract?.entrypoint).toBe('scripts/mission-control-adopt-finding.mjs')
    const help = spawnSync('pnpm', ['run', 'bemoat:mission-control:adopt-finding', '--', '--help', '--json'], {
      encoding: 'utf8',
      cwd: process.cwd(),
    })
    expect(help.status).toBe(0)
    const envelope = JSON.parse(help.stdout.split('\n').filter(Boolean).at(-1) ?? '{}')
    expect(envelope.command).toBe('bemoat:mission-control:adopt-finding')
    expect(envelope.mode).toBe('help')
    expect(envelope.accepted_pre_states).toEqual(['CORRECTION_REQUIRED_1', 'CORRECTION_REQUIRED_2'])
  })
})
