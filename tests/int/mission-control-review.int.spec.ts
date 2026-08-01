import { describe, expect, it } from 'vitest'

/* eslint-disable @typescript-eslint/no-explicit-any -- executable .mjs boundary */
import * as correctionContractModule from '../../scripts/correction-contract.mjs'
import * as reconcileModule from '../../scripts/mission-control-reconcile.mjs'

const {
  findingsFieldDeclaresUnresolvedImplementationFindings,
  parseReviewVerdictContractFindings,
  requiresCorrectionFindingContract,
  validateCorrectionRoleComment,
} = correctionContractModule as unknown as Record<string, any>

const {
  Coordinator,
  analyzeReconciliation,
  parseRoleCommentBody,
  projectReviewVerdictState,
} = reconcileModule as unknown as Record<string, any>

const REVIEWED_HEAD = '8b73bdfec3ebdec69588069fa275baf4fd15c333'

const review3Contract = {
  schema_version: 1,
  reviewed_head: REVIEWED_HEAD,
  findings: [
    {
      id: 'CRITICAL-2',
      canonical_summary: 'dispatch omits planningAuthorizationBaseSha at the composition root',
      source_thread: 'https://github.com/boat1994/bemoat-web-starter/pull/230#discussion_r-critical-2',
      required_evidence: ['production dispatch transport of planningAuthorizationBaseSha'],
      expected_areas: ['scripts/mission-control-dispatch.mjs'],
      prohibited_areas: ['scripts/agent-issue/planning-no-pr-lineage.mjs'],
    },
    {
      id: 'CRITICAL-3',
      canonical_summary: 'production dispatch lacks workflow_mode authority for planning_no_pr',
      source_thread: 'https://github.com/boat1994/bemoat-web-starter/pull/230#discussion_r-critical-3',
      required_evidence: ['live creation/dispatch path sets workflow_mode'],
      expected_areas: ['scripts/mission-control-dispatch.mjs'],
      prohibited_areas: [],
    },
    {
      id: 'IMPORTANT-2',
      canonical_summary: 'WF matrix does not fail against the production CLI omission',
      source_thread: 'https://github.com/boat1994/bemoat-web-starter/pull/230#discussion_r-important-2',
      required_evidence: ['WF-01..WF-12 production traceability'],
      expected_areas: ['tests/int/planning-no-pr-lineage.int.spec.ts'],
      prohibited_areas: [],
    },
  ],
}

/** Review 3 incident shape: BLOCKED + named findings + machine-readable contract. */
function review3BlockedBody(options: { includeContract?: boolean, malformedContract?: boolean } = {}) {
  const { includeContract = true, malformedContract = false } = options
  const contractBlock = malformedContract
    ? `\n\`\`\`json\n{"schema_version":1,"reviewed_head":"${REVIEWED_HEAD}","findings":[]}\n\`\`\`\n`
    : includeContract
      ? `\n\`\`\`json\n${JSON.stringify(review3Contract, null, 2)}\n\`\`\`\n`
      : ''
  return `## REVIEW_VERDICT

### Task log
- Timestamp: 2026-08-01T00:20:00+07:00
- Task / Issue: #229
- Phase: Bounded Delta Review 3
- Executing role: Reviewer
- Model / reasoning: GPT-5.6 Codex

**PR / base / head:** PR #230 / main / · \`${REVIEWED_HEAD}\`
**Verdict:** BLOCKED FOR FOUNDER DECISION
**Findings:** Critical: CRITICAL-2, CRITICAL-3 remain open · Important: IMPORTANT-2 remains unproven
**Gates:** exact-head CI pass (CI and starter-ci); local lineage suite 19/19 and safety guard pass
**Next:** Founder Approve or Decline the bounded post-Review-3 path; no Review 4, merge, or implementation is authorized.

### Bounded finding evidence
- **CRITICAL-2 — remains open.** Narrative evidence only; durable blockers come from the Correction Contract JSON.
- **CRITICAL-3 — remains open.** Narrative evidence only; durable blockers come from the Correction Contract JSON.
- **IMPORTANT-2 — remains unproven.** Narrative evidence only; durable blockers come from the Correction Contract JSON.

**Founder decision required:** The exact-head CI is green, but the actual planning authorization/dispatch chain is not proven. Approve only a separately bounded correction/review exception; Decline closes or defers the unresolved lineage work. No autonomous Review 4.
${contractBlock}`
}

function correctionRequiredBody() {
  return `## REVIEW_VERDICT

### Task log
- Timestamp: 2026-07-31T12:00:00+07:00
- Task / Issue: #231
- Phase: Reviewer
- Executing role: Reviewer / Red Team

**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/232 · \`main\` · \`deadbeef\`
**Verdict:** CORRECTION REQUIRED
**Findings:** Critical: None · Important: MC-R1-231-001
**Gates:** exact-head CI pass
**Next:** Dev posts correction RESULT

\`\`\`json
{
  "schema_version": 1,
  "reviewed_head": "deadbeef",
  "findings": [
    {
      "id": "MC-R1-231-001",
      "canonical_summary": "missing focused regression coverage",
      "source_thread": "https://github.com/boat1994/bemoat-web-starter/pull/232#discussion_r1",
      "required_evidence": ["focused failing-then-passing test"],
      "expected_areas": ["tests/int"],
      "prohibited_areas": []
    }
  ]
}
\`\`\`
`
}

function pureFounderBlockedBody() {
  return `## REVIEW_VERDICT

### Task log
- Timestamp: 2026-08-01T00:20:00+07:00
- Task / Issue: #229
- Phase: Bounded Delta Review 3
- Executing role: Reviewer

**PR / base / head:** PR #230 / main / · \`${REVIEWED_HEAD}\`
**Verdict:** BLOCKED FOR FOUNDER DECISION
**Findings:** Critical: None · Important: None
**Gates:** exact-head CI pass
**Next:** Founder Approve or Decline the policy choice; no implementation findings remain open.
`
}

describe('mission-control review transition', () => {
  it('posts one verdict then projects its durable state exactly once on replay', async () => {
    const verdictBody = correctionRequiredBody()
    let state: any = {
      state: 'AWAITING_REVIEW_1', review_cycle: 0, full_review_count: 0,
      active_pr: '#232', current_head: 'deadbeef', last_reviewed_head: null,
      open_blockers: [], next_permitted_action: 'Review 1',
    }
    const comments: any[] = []
    let postCount = 0
    const coordinator = new Coordinator({
      readState: async () => structuredClone(state),
      writeState: async (next: any, expected: any) => {
        expect(state).toEqual(expected)
        state = structuredClone(next)
        return structuredClone(state)
      },
      listComments: async () => comments,
      postComment: async (body: string) => {
        postCount += 1
        const comment = { id: '9001', body }
        comments.push(comment)
        return comment
      },
    })
    const project = (prior: any, comment: any, identity: any) => projectReviewVerdictState({
      prior, verdict: 'CORRECTION REQUIRED', reviewType: 'full', reviewedHead: 'deadbeef',
      commentId: comment.id, transitionIdentity: JSON.stringify(identity),
      findings: [{ finding_id: 'MC-R1-231-001' },], updatedAt: 'now', updatedBy: 'Reviewer',
    })

    const first = await coordinator.integrateReviewVerdict({ verdictBody, projectState: project })
    expect(first.outcome).toBe('REVIEWED')
    expect(state).toMatchObject({ state: 'CORRECTION_REQUIRED_1', review_cycle: 1, full_review_count: 1, latest_review_verdict_comment_id: '9001', open_blockers: ['MC-R1-231-001'] })

    const replay = await coordinator.integrateReviewVerdict({ verdictBody, projectState: project })
    expect(replay.outcome).toBe('REVIEWED')
    expect(postCount).toBe(1)
    expect(state.review_cycle).toBe(1)
  })

  it('keeps the review CLI as a sync-managed facade', async () => {
    const sync = await import('../../scripts/sync-boilerplate.mjs')
    expect(sync.managedPaths).toContain('scripts/mission-control-review.mjs')
    expect(sync.managedPaths).toContain('scripts/command-runner.mjs')
    expect(sync.managedPaths).toContain('scripts/adapters/command-runner.mjs')
    expect(sync.managedPackageScripts).toContain('bemoat:mission-control:review')
    expect((await import('../../package.json', { with: { type: 'json' } })).default.scripts['bemoat:mission-control:review'])
      .toBe('node scripts/mission-control-review.mjs')
  })

  it('routes subprocess execution through CommandRunner with no direct child_process import', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const source = readFileSync(resolve(process.cwd(), 'scripts/mission-control-review.mjs'), 'utf8')
    expect(source).toMatch(/from '\.\/adapters\/command-runner\.mjs'/)
    expect(source).not.toMatch(/from 'node:child_process'/)
    expect(source).not.toMatch(/\bspawnSync\b/)
  })
})

describe('Issue #229 Review 3 blocker-projection hotfix', () => {
  it('CORRECTION REQUIRED with a contract projects blockers', () => {
    const body = correctionRequiredBody()
    const parsed = parseReviewVerdictContractFindings(body, 'CORRECTION REQUIRED')
    expect(parsed.ok).toBe(true)
    expect(parsed.findings.map((finding: any) => finding.finding_id)).toEqual(['MC-R1-231-001'])
    expect(projectReviewVerdictState({
      prior: {
        state: 'AWAITING_REVIEW_1', review_cycle: 0, full_review_count: 0,
        current_head: 'deadbeef', last_reviewed_head: null, open_blockers: [],
      },
      verdict: 'CORRECTION REQUIRED',
      reviewType: 'full',
      reviewedHead: 'deadbeef',
      commentId: '9001',
      transitionIdentity: 'identity',
      findings: parsed.findings,
    }).open_blockers).toEqual(['MC-R1-231-001'])
  })

  it('BLOCKED FOR FOUNDER DECISION with a contract projects blockers', () => {
    const body = review3BlockedBody({ includeContract: true })
    expect(requiresCorrectionFindingContract(body)).toBe(true)
    const parsed = parseReviewVerdictContractFindings(body, 'BLOCKED FOR FOUNDER DECISION')
    expect(parsed.ok).toBe(true)
    expect(parsed.findings.map((finding: any) => finding.finding_id)).toEqual([
      'CRITICAL-2',
      'CRITICAL-3',
      'IMPORTANT-2',
    ])

    const projected = projectReviewVerdictState({
      prior: {
        state: 'CORRECTION_REQUIRED_2',
        review_cycle: 2,
        full_review_count: 1,
        current_head: REVIEWED_HEAD,
        last_reviewed_head: REVIEWED_HEAD,
        open_blockers: ['CRITICAL-2'],
        latest_handoff_comment_id: '5143825219',
        latest_result_comment_id: '5145571785',
      },
      verdict: 'BLOCKED FOR FOUNDER DECISION',
      reviewType: 'delta',
      reviewedHead: REVIEWED_HEAD,
      commentId: '5145633304',
      transitionIdentity: 'review3-identity',
      findings: parsed.findings,
      updatedAt: '2026-07-31T17:20:15.085Z',
      updatedBy: 'Reviewer',
    })

    expect(projected).toMatchObject({
      state: 'BLOCKED_FOR_FOUNDER_DECISION',
      review_cycle: 3,
      full_review_count: 1,
      current_head: REVIEWED_HEAD,
      last_reviewed_head: REVIEWED_HEAD,
      open_blockers: ['CRITICAL-2', 'CRITICAL-3', 'IMPORTANT-2'],
      latest_review_verdict_comment_id: '5145633304',
      latest_handoff_comment_id: '5143825219',
      latest_result_comment_id: '5145571785',
    })
    expect(projected.next_permitted_action).toMatch(/Founder Approve or Decline/i)
  })

  it('rejects BLOCKED verdict naming Critical/Important findings without a contract before posting', () => {
    const body = review3BlockedBody({ includeContract: false })
    expect(findingsFieldDeclaresUnresolvedImplementationFindings(body)).toBe(true)
    expect(requiresCorrectionFindingContract(body)).toBe(true)
    expect(validateCorrectionRoleComment({ role: 'REVIEW_VERDICT', body })).toMatchObject({
      ok: false,
    })
    expect(validateCorrectionRoleComment({ role: 'REVIEW_VERDICT', body }).errors.join(' '))
      .toMatch(/missing correction finding contract/i)
    expect(parseReviewVerdictContractFindings(body, 'BLOCKED FOR FOUNDER DECISION')).toMatchObject({
      ok: false,
    })
  })

  it('pure Founder decision without implementation findings permits empty blockers', () => {
    const body = pureFounderBlockedBody()
    expect(findingsFieldDeclaresUnresolvedImplementationFindings(body)).toBe(false)
    expect(requiresCorrectionFindingContract(body)).toBe(false)
    expect(validateCorrectionRoleComment({ role: 'REVIEW_VERDICT', body })).toEqual({ ok: true, errors: [] })
    const parsed = parseReviewVerdictContractFindings(body, 'BLOCKED FOR FOUNDER DECISION')
    expect(parsed).toEqual({ ok: true, findings: [] })
    expect(projectReviewVerdictState({
      prior: {
        state: 'CORRECTION_REQUIRED_2', review_cycle: 2, full_review_count: 1,
        current_head: REVIEWED_HEAD, last_reviewed_head: REVIEWED_HEAD, open_blockers: ['STALE'],
      },
      verdict: 'BLOCKED FOR FOUNDER DECISION',
      reviewType: 'delta',
      reviewedHead: REVIEWED_HEAD,
      commentId: 'pure-1',
      transitionIdentity: 'pure',
      findings: parsed.findings,
    }).open_blockers).toEqual([])
  })

  it('malformed BLOCKED contract fails closed', () => {
    const body = review3BlockedBody({ malformedContract: true })
    expect(requiresCorrectionFindingContract(body)).toBe(true)
    expect(validateCorrectionRoleComment({ role: 'REVIEW_VERDICT', body }).ok).toBe(false)
    expect(parseReviewVerdictContractFindings(body, 'BLOCKED FOR FOUNDER DECISION').ok).toBe(false)
  })

  it('reconciliation detects authoritative contract blockers versus empty durable blockers', () => {
    const body = review3BlockedBody({ includeContract: true })
    const analysis = analyzeReconciliation({
      managedState: {
        state: 'BLOCKED_FOR_FOUNDER_DECISION',
        review_cycle: 3,
        full_review_count: 1,
        current_head: REVIEWED_HEAD,
        last_reviewed_head: REVIEWED_HEAD,
        open_blockers: [],
      },
      livePr: { number: '230', headRefOid: REVIEWED_HEAD, baseRefName: 'main' },
      latestVerdict: {
        comment: { id: '5145633304', body },
        parsed: parseRoleCommentBody(body),
      },
      stateConflictBlockers: [],
    })

    expect(analysis.classification.outcome).toBe('BOOKKEEPING_REPAIR')
    expect(analysis.proposal?.fields.open_blockers).toEqual([
      'CRITICAL-2',
      'CRITICAL-3',
      'IMPORTANT-2',
    ])
  })

  it('duplicate Review 3 replay remains idempotent and keeps counters capped at 3/1', async () => {
    const body = review3BlockedBody({ includeContract: true })
    const findings = parseReviewVerdictContractFindings(body, 'BLOCKED FOR FOUNDER DECISION').findings
    let state: any = {
      state: 'CORRECTION_REQUIRED_2',
      review_cycle: 2,
      full_review_count: 1,
      active_pr: '#230',
      current_head: REVIEWED_HEAD,
      last_reviewed_head: REVIEWED_HEAD,
      open_blockers: [],
      latest_handoff_comment_id: '5143825219',
      latest_result_comment_id: '5145571785',
    }
    const comments: any[] = []
    let postCount = 0
    const coordinator = new Coordinator({
      readState: async () => structuredClone(state),
      writeState: async (next: any, expected: any) => {
        expect(state).toEqual(expected)
        state = structuredClone(next)
        return structuredClone(state)
      },
      listComments: async () => comments,
      postComment: async (commentBody: string) => {
        postCount += 1
        const comment = { id: '5145633304', body: commentBody }
        comments.push(comment)
        return comment
      },
    })
    const project = (prior: any, comment: any, identity: any) => projectReviewVerdictState({
      prior,
      verdict: 'BLOCKED FOR FOUNDER DECISION',
      reviewType: 'delta',
      reviewedHead: REVIEWED_HEAD,
      commentId: comment.id,
      transitionIdentity: JSON.stringify(identity),
      findings,
      updatedAt: '2026-07-31T17:20:15.085Z',
      updatedBy: 'Reviewer',
    })

    const first = await coordinator.integrateReviewVerdict({ verdictBody: body, projectState: project })
    expect(first.outcome).toBe('REVIEWED')
    expect(state).toMatchObject({
      state: 'BLOCKED_FOR_FOUNDER_DECISION',
      review_cycle: 3,
      full_review_count: 1,
      current_head: REVIEWED_HEAD,
      last_reviewed_head: REVIEWED_HEAD,
      open_blockers: ['CRITICAL-2', 'CRITICAL-3', 'IMPORTANT-2'],
      latest_review_verdict_comment_id: '5145633304',
      latest_handoff_comment_id: '5143825219',
      latest_result_comment_id: '5145571785',
    })

    const replay = await coordinator.integrateReviewVerdict({ verdictBody: body, projectState: project })
    expect(replay.outcome).toBe('REVIEWED')
    expect(replay.replayed).toBe(true)
    expect(postCount).toBe(1)
    expect(state.review_cycle).toBe(3)
    expect(state.full_review_count).toBe(1)
    expect(state.latest_review_verdict_comment_id).toBe('5145633304')
    expect(state.latest_handoff_comment_id).toBe('5143825219')
    expect(state.latest_result_comment_id).toBe('5145571785')
    expect(state.current_head).toBe(REVIEWED_HEAD)
    expect(state.last_reviewed_head).toBe(REVIEWED_HEAD)
  })

  it('matched authoritative blockers remain NO_OP for reconciliation completeness', () => {
    const body = review3BlockedBody({ includeContract: true })
    const analysis = analyzeReconciliation({
      managedState: {
        state: 'BLOCKED_FOR_FOUNDER_DECISION',
        review_cycle: 3,
        full_review_count: 1,
        current_head: REVIEWED_HEAD,
        last_reviewed_head: REVIEWED_HEAD,
        open_blockers: ['CRITICAL-2', 'CRITICAL-3', 'IMPORTANT-2'],
      },
      livePr: { number: '230', headRefOid: REVIEWED_HEAD, baseRefName: 'main' },
      latestVerdict: {
        comment: { id: '5145633304', body },
        parsed: parseRoleCommentBody(body),
      },
      stateConflictBlockers: [],
    })

    expect(analysis.classification.outcome).toBe('NO_OP')
  })
})
