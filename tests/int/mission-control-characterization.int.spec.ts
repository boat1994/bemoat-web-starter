import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, it, expect } from 'vitest'
import { parseMissionControlState, renderMissionControlState } from '../../scripts/mission-control/domain/task-state.ts'
import * as missionControlStateModule from '../../scripts/mission-control/domain/task-state.ts'
import {
  analyzeProgressTracking,
  analyzeExactHeadCi,
} from '../../scripts/agent-issue.mjs'
import {
  classifyDeliveryLag as rawClassifyDeliveryLag,
  classifyReviewLag as rawClassifyReviewLag,
  proposeReviewReconciliation,
  proposeDeliveryReconciliation as rawProposeDeliveryReconciliation,
  findLatestRoleComment,
  isGenuineStateConflict,
  parseRoleCommentBody,
} from '../../scripts/mission-control-reconcile.mjs'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped runtime .mjs boundary */
const classifyDeliveryLag = rawClassifyDeliveryLag as unknown as (...args: any[]) => any
const classifyReviewLag = rawClassifyReviewLag as unknown as (...args: any[]) => any
const proposeDeliveryReconciliation = rawProposeDeliveryReconciliation as unknown as (...args: any[]) => any
/* eslint-enable @typescript-eslint/no-explicit-any */

const tempRoots: string[] = []
const dogfoodRoot = resolve(process.cwd(), 'docs/mission-control/dogfood')
// Starter-only corpus: gate only tests that read/execute these paths so child
// repos can run portable Mission Control characterization without the corpus.
// Path literals must appear inside existsSync(...) for the child-portability
// structural contract (avoid helpers whose args contain ')' before the path).
const hasStarterOnlyCorpus =
  existsSync('docs/mission-control/dogfood') &&
  existsSync('scripts/tooling/capture-baseline.mjs')
const renderStateBody = (state: Record<string, unknown>) => renderMissionControlState(state)
const projectMissionControlStateBlock = missionControlStateModule.projectMissionControlStateBlock as unknown as (
  body: string,
  state: Record<string, unknown>,
) => string

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Mission Control Characterization (Issue #150)', () => {

  it('keeps the canonical TypeScript parser and authorization helpers directly callable', async () => {
    const canonicalState = await import(
      '../../scripts/mission-control/domain/task-state.ts'
    )
    const canonicalAuthorization = await import(
      '../../scripts/mission-control/domain/task-state-authorization.ts'
    )

    expect(canonicalState.parseMissionControlState).toBeTypeOf('function')
    expect(canonicalState.renderMissionControlState).toBeTypeOf('function')
    expect(canonicalAuthorization.validateBoundCorrectionAuthorization).toBeTypeOf('function')

    const review = {
      review_number: 4,
      reviewed_head: 'head-4',
      finding_dispositions: [{ finding_id: 'MC-R1-333-001', disposition: 'accepted' }],
    }
    const authorization = {
      status: 'approved',
      authority: 'Founder',
      scope: 'correction',
      action: 'apply-correction',
      authorized_at: '2026-08-13T00:00:00Z',
      for_review_number: 4,
      reviewed_head: 'head-4',
      finding_ids: ['MC-R1-333-001'],
    }

    expect(canonicalAuthorization.validateBoundCorrectionAuthorization(authorization, review))
      .toEqual({ valid: true })
    expect(canonicalAuthorization.validateBoundCorrectionAuthorization(
      { ...authorization, reviewed_head: 'stale-head' },
      review,
    )).toEqual({
      valid: false,
      reason: 'post-budget correction authorization must bind to the latest completed post-budget reviewed head',
    })
  })

  it('preserves the parser error matrix for malformed roots and duplicate YAML keys', () => {
    const duplicate = `
<!-- bemoat-mission-control-state:start -->
state: READY
state: IN_PROGRESS
<!-- bemoat-mission-control-state:end -->`
    const scalarRoot = `
<!-- bemoat-mission-control-state:start -->
not-a-mapping
<!-- bemoat-mission-control-state:end -->`

    expect(parseMissionControlState(duplicate)).toMatchObject({
      present: true,
      valid: false,
      reason: expect.stringContaining('duplicate state key: Map keys must be unique'),
    })
    expect(parseMissionControlState(scalarRoot)).toEqual({
      present: true,
      valid: false,
      reason: 'unreadable state line: root must be a mapping',
    })
  })

  it('preserves renderer key ordering, unknown keys, formatting, and YAML scalar typing', () => {
    const state: Record<string, unknown> = {
      schema_version: 1,
      state: 'READY',
      review_cycle: 0,
      full_review_count: 0,
      approved_base: 'main',
      active_task_issue: '#333',
      active_pr: null,
      current_head: null,
      last_reviewed_head: null,
      workflow_mode: null,
      guide_version: '1.3.0',
      guide_source_ref: 'main',
      guide_source_sha: null,
      open_blockers: [],
      follow_up_issues: [],
      next_permitted_action: 'continue',
      material_change_status: 'none',
      updated_at: null,
      updated_by: null,
      unknown_future_key: { enabled: true },
    }

    expect(renderMissionControlState(state)).toBe(`<!-- bemoat-mission-control-state:start -->
\`\`\`yaml
schema_version: 1
state: READY
review_cycle: 0
full_review_count: 0
approved_base: main
active_task_issue: "#333"
active_pr: null
current_head: null
last_reviewed_head: null
workflow_mode: null
guide_version: 1.3.0
guide_source_ref: main
guide_source_sha: null
open_blockers: []
follow_up_issues: []
next_permitted_action: continue
material_change_status: none
updated_at: null
updated_by: null
unknown_future_key:
  enabled: true
\`\`\`
<!-- bemoat-mission-control-state:end -->`)
    expect(parseMissionControlState(renderMissionControlState(state)).state).toEqual(state)
  })

  it('keeps planning-lineage population immutable and side-effect free', async () => {
    const { populateOrPreservePlanningAuthorizationBaseSha } = await import(
      '../../scripts/mission-control/domain/task-state.ts'
    )
    const prior: Record<string, unknown> = { state: 'READY', planning_authorization_base_sha: null }
    const result = populateOrPreservePlanningAuthorizationBaseSha(
      prior,
      'ABCDEF0123456789ABCDEF0123456789ABCDEF01',
    )

    expect(result).toEqual({
      ok: true,
      state: {
        state: 'READY',
        planning_authorization_base_sha: 'abcdef0123456789abcdef0123456789abcdef01',
      },
      populated: true,
    })
    expect(prior).toEqual({ state: 'READY', planning_authorization_base_sha: null })
  })

  it('Issue #255: centralized state-block projection preserves prose and fails closed on duplicate markers', () => {
    const prior: Record<string, unknown> = {
      schema_version: 1,
      state: 'READY',
      review_cycle: 0,
      full_review_count: 0,
      approved_base: 'main',
      active_task_issue: '#255',
      active_pr: null,
      current_head: null,
      last_reviewed_head: null,
      guide_version: '1.3.0',
      guide_source_ref: 'main',
      guide_source_sha: null,
      open_blockers: [],
      follow_up_issues: [],
      next_permitted_action: 'Mission Control posts HANDOFF',
      material_change_status: 'none',
      updated_at: null,
      updated_by: null,
    }
    const next = { ...prior, state: 'IN_PROGRESS', updated_by: 'Mission Control' }
    const body = `prose before\n${renderMissionControlState(prior)}\nprose after`

    expect(projectMissionControlStateBlock(body, next)).toBe(
      `prose before\n${renderMissionControlState(next)}\nprose after`,
    )
    expect(() => projectMissionControlStateBlock(
      `${body}\n${renderMissionControlState(prior)}`,
      next,
    )).toThrow(/exactly one balanced marker pair/i)
    expect(() => projectMissionControlStateBlock('prose without a managed block', next))
      .toThrow(/managed state block is missing/i)
  })

  describe('Policy/base resolution (MC-SCENARIO-001)', () => {
    it('resolves approved base from state block when present', () => {
      const state = `<!-- bemoat-mission-control-state:start -->
\`\`\`yaml
schema_version: 1
state: READY
review_cycle: 0
full_review_count: 0
approved_base: dev-branch
active_task_issue: "#150"
active_pr: null
current_head: null
last_reviewed_head: null
guide_version: 1.2.0
guide_source_ref: main
guide_source_sha: abc1234
open_blockers: []
follow_up_issues: []
next_permitted_action: "test"
material_change_status: none
updated_at: "2026-07-23T03:45:00Z"
updated_by: "Mission Control"
\`\`\`
<!-- bemoat-mission-control-state:end -->`
      const parsed = parseMissionControlState(state)
      expect(parsed.valid).toBe(true)
      expect(parsed.state?.approved_base).toBe('dev-branch')
    })

    it.skipIf(!hasStarterOnlyCorpus)('derives protected-base loading order and bundle classifications from loader content', () => {
      const root = mkdtempSync(join(tmpdir(), 'mc-loader-contract-'))
      tempRoots.push(root)
      const fixturePath = join(root, 'loader.md')
      writeFileSync(fixturePath, `# Loader fixture

## Startup

1. Resolve the approved protected base.
2. Read \`policy/custom-guide.md\`, then \`.bemoat/custom-overrides.md\` when present.

1. Merged canonical guide on approved base
2. Optional child override
3. Approved Implementation Plan → Main Issue → Active Task Issue
4. Latest approved non-superseded \`## HANDOFF\` / \`## RESULT\` / \`## REVIEW_VERDICT\`
5. Active PR exact head, review threads, exact-head CI/checks
`)

      const stdout = execFileSync(
        process.execPath,
        ['scripts/tooling/capture-baseline.mjs', '--classify-loader', fixturePath],
        { cwd: process.cwd(), encoding: 'utf8' },
      )
      const classification = JSON.parse(stdout)

      expect(classification.mandatory_repository_policy).toEqual([
        'policy/custom-guide.md',
        '.bemoat/custom-overrides.md',
      ])
      expect(classification.loading_order).toHaveLength(5)
      expect(classification.role_transport.comment_types).toEqual([
        'HANDOFF',
        'RESULT',
        'REVIEW_VERDICT',
      ])
      expect(classification.live_github_evidence).toContain('exact-head CI/checks')
    })

    it.skipIf(!hasStarterOnlyCorpus)('records the approved-SHA loader as the derivation source for every loading bundle', () => {
      const baseline = JSON.parse(
        readFileSync(join(dogfoodRoot, 'issue-150-baseline.json'), 'utf8'),
      )

      expect(baseline.sha).toBe('c2637d6540f9200b01e8e0af1938e257975ada27')
      expect(baseline.loading_contract.derived_from).toEqual({
        path: 'prompts/mission-control/chatgpt-project-loader.md',
        ref: baseline.sha,
      })
      expect(baseline.loading_contract.loading_order).toHaveLength(5)
      expect(baseline.loading_contract.role_transport.comment_types).toEqual([
        'HANDOFF',
        'RESULT',
        'REVIEW_VERDICT',
      ])
      expect(baseline.totals).toMatchObject({
        docs_files: 85,
        docs_lines: 12236,
        docs_bytes: 557938,
        sync_managed_docs_files: 49,
        sync_managed_docs_lines: 7173,
        sync_managed_docs_bytes: 333061,
      })
      expect(baseline.sync_managed_resolved_paths).toHaveLength(49)
    })
  })

  describe('Durable reconstruction and vocabulary preservation (MC-SCENARIO-002, MC-SCENARIO-009)', () => {
    it('successfully parses and preserves valid marked state blocks', () => {
      const markedBody = `
<!-- bemoat-mission-control-state:start -->
\`\`\`yaml
schema_version: 1
state: CORRECTION_REQUIRED_2
review_cycle: 2
full_review_count: 1
approved_base: main
active_task_issue: "#150"
active_pr: "#151"
current_head: head1
last_reviewed_head: head0
guide_version: 1.2.0
guide_source_ref: main
guide_source_sha: abc1234
open_blockers: []
follow_up_issues: []
next_permitted_action: "test"
material_change_status: none
updated_at: "2026-07-23T03:45:00Z"
updated_by: "Mission Control"
\`\`\`
<!-- bemoat-mission-control-state:end -->
`
      const parsed = parseMissionControlState(markedBody)
      expect(parsed.present).toBe(true)
      expect(parsed.valid).toBe(true)
      expect(parsed.state?.state).toBe('CORRECTION_REQUIRED_2')
      expect(parsed.state?.review_cycle).toBe(2)
      expect(parsed.state?.full_review_count).toBe(1)
    })

    it('does not treat a state-only active PR as conflicting when no separate Active PR is declared', () => {
      const managedBody = `
## MISSION_CONTROL_STATE

- **Task size**: Core
- **Mission Control mode**: required

<!-- bemoat-mission-control-state:start -->
\`\`\`yaml
schema_version: 1
state: BLOCKED_FOR_FOUNDER_DECISION
review_cycle: 3
full_review_count: 1
approved_base: main
active_task_issue: "#150"
active_pr: "#151"
current_head: dcbbfd8d5dcb862725a71535207da7f173756d40
last_reviewed_head: dcbbfd8d5dcb862725a71535207da7f173756d40
guide_version: 1.2.0
guide_source_ref: main
guide_source_sha: c2637d6540f9200b01e8e0af1938e257975ada27
open_blockers:
  - MC-R1-002
follow_up_issues: []
next_permitted_action: "Founder decides whether to authorize one bounded post-budget correction for MC-R1-002 on existing PR #151."
material_change_status: none
updated_at: "2026-07-23T06:35:37.744Z"
updated_by: "Delta Reviewer"
\`\`\`
<!-- bemoat-mission-control-state:end -->
`

      const analysis = analyzeProgressTracking({ activeIssueBody: managedBody })

      expect(analysis.report.declarations.activePrRef).toBeNull()
      expect(parseMissionControlState(managedBody).state?.active_pr).toBe('#151')
      expect(analysis.blockers).not.toContain(
        'STATE_CONFLICT: state active_pr does not match the declared Active PR.',
      )
    })

    it('deterministically round-trips nested objects and arrays of objects including future keys', async () => {
      const { renderMissionControlState } = await import('../../scripts/mission-control/domain/task-state.ts')
      const complexState = {
        schema_version: 1,
        state: 'IN_PROGRESS',
        review_cycle: 0,
        full_review_count: 0,
        approved_base: 'main',
        active_task_issue: '#154',
        active_pr: null as string | null,
        current_head: 'abcd',
        last_reviewed_head: null as string | null,
        guide_version: '1.0.0',
        guide_source_ref: 'main',
        guide_source_sha: '1234',
        open_blockers: [] as string[],
        next_permitted_action: 'continue',
        material_change_status: 'none',
        updated_at: '2026-07-23T03:45:00Z',
        updated_by: 'Agent',
        follow_up_issues: [
          { title: 'future action', estimated_size: 'core', tags: ['one', 'two'] }
        ],
        founder_decision: {
          decision: 'APPROVED',
          rationale: 'Looks good',
          overrides: { allow_bypass: true }
        },
        finding_lineage: {
          origin: 'MC-R2-001',
          fixes: ['c3f2']
        },
        unknown_future_key: [null, 42, 'string']
      }
      
      const rendered = renderMissionControlState(complexState)
      const parsed = parseMissionControlState(rendered)
      expect(parsed.valid).toBe(true)
      expect(parsed.state).toEqual(complexState)
    })
  })

  describe('Migration/conflict/external boundaries (MC-SCENARIO-003, MC-SCENARIO-004)', () => {
    it('strictly rejects unmarked MISSION_CONTROL_STATE YAML blocks and routes to STATE_MIGRATION_REQUIRED via analyzeProgressTracking', () => {
      const unmarkedBody = `
## MISSION_CONTROL_STATE

- **Task size**: Core
- **Mission Control mode**: required

\`\`\`yaml
schema_version: 1
state: READY
review_cycle: 0
full_review_count: 0
approved_base: main
active_task_issue: "#150"
active_pr: null
current_head: null
last_reviewed_head: null
guide_version: 1.2.0
guide_source_ref: main
guide_source_sha: c2637d6540f9200b01e8e0af1938e257975ada27
open_blockers: []
follow_up_issues: []
next_permitted_action: "test"
material_change_status: none
updated_at: "2026-07-23T03:45:00Z"
updated_by: "Mission Control"
\`\`\`
`

      const report = analyzeProgressTracking({ activeIssueBody: unmarkedBody })
      expect(report.blockers.some(b => b.includes('STATE_MIGRATION_REQUIRED: unmarked YAML is not a durable managed-state block'))).toBe(true)
    })

    it('fails closed when markers are duplicate or unbalanced', () => {
      const duplicateBody = `
<!-- bemoat-mission-control-state:start -->
\`\`\`yaml
schema_version: 1
\`\`\`
<!-- bemoat-mission-control-state:end -->
<!-- bemoat-mission-control-state:start -->
<!-- bemoat-mission-control-state:end -->
`
      const report = analyzeProgressTracking({ activeIssueBody: duplicateBody })
      expect(report.blockers.some(b => b.includes('STATE_MIGRATION_REQUIRED: exactly one balanced marker pair is required'))).toBe(true)

      const unbalancedBody = `
<!-- bemoat-mission-control-state:start -->
\`\`\`yaml
schema_version: 1
\`\`\`
`
      const unbalancedReport = analyzeProgressTracking({ activeIssueBody: unbalancedBody })
      expect(unbalancedReport.blockers.some(b => b.includes('STATE_MIGRATION_REQUIRED: exactly one balanced marker pair is required'))).toBe(true)
    })

    it('emits STATE_CONFLICT when genuine state conflict is detected', () => {
      expect(isGenuineStateConflict({ headMismatch: true })).toBe(true)
      expect(isGenuineStateConflict({ staleCi: true })).toBe(true)
    })

    it.skipIf(!hasStarterOnlyCorpus)('preserves the explicit BLOCKED_EXTERNAL fail-closed outcome', () => {
      const body = readFileSync(join(dogfoodRoot, 'fixtures/blocked-external-state.md'), 'utf8')
      const report = analyzeProgressTracking({ activeIssueBody: body })

      expect(report.blockers).toContain(
        'BLOCKED_EXTERNAL: recorded Mission Control state requires reconciliation before continuing.',
      )
    })
  })

  describe('Review-history preservation, no reset, no Review 4 (MC-SCENARIO-005, MC-SCENARIO-006)', () => {
    it('preserves review cycle and full review count without resetting on valid transitions', () => {
      const prop1 = proposeReviewReconciliation({ verdict: 'CORRECTION REQUIRED', reviewedHead: 'a', reviewCycle: 0, fullReviewCount: 0 })
      expect(prop1.state).toBe('CORRECTION_REQUIRED_1')
      expect(prop1.review_cycle).toBe(1)
      expect(prop1.full_review_count).toBe(1)

      const prop2 = proposeReviewReconciliation({ verdict: 'CORRECTION REQUIRED', reviewedHead: 'b', reviewCycle: 1, fullReviewCount: 1 })
      expect(prop2.state).toBe('CORRECTION_REQUIRED_2')
      expect(prop2.review_cycle).toBe(2)
      expect(prop2.full_review_count).toBe(1) // does not increase past 1
    })

    it('routes unauthorized Review 4 (CORRECTION REQUIRED at cycle 2) to STATE_CONFLICT', () => {
      const prop = proposeReviewReconciliation({ verdict: 'CORRECTION REQUIRED', reviewedHead: 'c', reviewCycle: 2, fullReviewCount: 1 })
      expect(prop.state).toBe('STATE_CONFLICT')
      expect(prop.review_cycle).toBe(2)
      expect(prop.full_review_count).toBe(1)
    })

    it('accepts completed Founder-authorized Review 4 history during its separately authorized correction', () => {
      const body = `<!-- bemoat-mission-control-state:start -->
\`\`\`yaml
schema_version: 1
state: IN_PROGRESS
review_cycle: 3
full_review_count: 1
approved_base: main
active_task_issue: "#155"
active_pr: "#157"
current_head: correction-head
last_reviewed_head: review-4-head
post_budget_reviews:
  - review_number: 4
    reviewed_head: review-4-head
    verdict: BLOCKED FOR FOUNDER DECISION
    authorization:
      status: approved
      authority: Founder
      scope: review
      review_number: 4
      reviewed_head: review-4-head
      action: "Authorize bounded Review 4"
      authorized_at: "2026-07-23T15:00:00Z"
    finding_dispositions:
      - finding_id: MC-R1-002
        disposition: open
founder_decision:
  status: approved
  authority: Founder
  scope: correction
  for_review_number: 4
  reviewed_head: review-4-head
  finding_ids:
    - MC-R1-002
  action: "Authorize one bounded correction for MC-R1-002"
  authorized_at: "2026-07-23T16:00:00Z"
guide_version: 1.2.0
guide_source_ref: main
guide_source_sha: 42b383a8bca33518116763af8094e6a42212bf0b
open_blockers:
  - MC-R1-002
follow_up_issues: []
next_permitted_action: "Dev executes only the authorized MC-R1-002 correction"
material_change_status: none
updated_at: "2026-07-23T16:01:00Z"
updated_by: Mission Control
\`\`\`
<!-- bemoat-mission-control-state:end -->`

      const parsed = parseMissionControlState(body)

      expect(parsed.valid).toBe(true)
      expect(parsed.state).toMatchObject({
        state: 'IN_PROGRESS',
        review_cycle: 3,
        full_review_count: 1,
        last_reviewed_head: 'review-4-head',
        post_budget_reviews: [
          {
            review_number: 4,
            reviewed_head: 'review-4-head',
            verdict: 'BLOCKED FOR FOUNDER DECISION',
            authorization: {
              status: 'approved',
              authority: 'Founder',
              scope: 'review',
              review_number: 4,
              reviewed_head: 'review-4-head',
              action: 'Authorize bounded Review 4',
              authorized_at: '2026-07-23T15:00:00Z',
            },
            finding_dispositions: [
              { finding_id: 'MC-R1-002', disposition: 'open' },
            ],
          },
        ],
      })
      const roundTrip = parseMissionControlState(renderMissionControlState(parsed.state ?? {}))
      expect(roundTrip.valid).toBe(true)
      expect(roundTrip.state?.post_budget_reviews).toEqual(parsed.state?.post_budget_reviews)
    })

    it('rejects a post-budget review or correction without its explicit Founder authorization', () => {
      const base = {
        schema_version: 1,
        state: 'IN_PROGRESS',
        review_cycle: 3,
        full_review_count: 1,
        approved_base: 'main',
        active_task_issue: '#155',
        active_pr: '#157',
        current_head: 'correction-head',
        last_reviewed_head: 'review-4-head',
        post_budget_reviews: [{
          review_number: 4,
          reviewed_head: 'review-4-head',
          verdict: 'BLOCKED FOR FOUNDER DECISION',
          authorization: {
            status: 'approved',
            authority: 'Founder',
            scope: 'review',
            review_number: 4,
            reviewed_head: 'review-4-head',
            action: 'Authorize bounded Review 4',
            authorized_at: '2026-07-23T15:00:00Z',
          },
          finding_dispositions: [{ finding_id: 'MC-R1-002', disposition: 'open' }],
        }],
        founder_decision: {
          status: 'approved',
          authority: 'Founder',
          scope: 'correction',
          for_review_number: 4,
          reviewed_head: 'review-4-head',
          finding_ids: ['MC-R1-002'],
          action: 'Authorize one bounded correction for MC-R1-002',
          authorized_at: '2026-07-23T16:00:00Z',
        },
        guide_version: '1.2.0',
        guide_source_ref: 'main',
        guide_source_sha: '42b383a8bca33518116763af8094e6a42212bf0b',
        open_blockers: ['MC-R1-002'],
        follow_up_issues: [] as string[],
        next_permitted_action: 'Dev executes only the authorized MC-R1-002 correction',
        material_change_status: 'none',
        updated_at: '2026-07-23T16:01:00Z',
        updated_by: 'Mission Control',
      }

      const missingReviewAuthorization = structuredClone(base)
      delete (missingReviewAuthorization.post_budget_reviews[0] as Record<string, unknown>).authorization
      const missingCorrectionAuthorization = structuredClone(base)
      delete (missingCorrectionAuthorization as Record<string, unknown>).founder_decision
      const ineligibleCorrectionVerdict = structuredClone(base)
      ineligibleCorrectionVerdict.post_budget_reviews[0].verdict = 'ELIGIBLE FOR FOUNDER REVIEW'

      expect(parseMissionControlState(renderStateBody(missingReviewAuthorization))).toMatchObject({
        valid: false,
        reason: expect.stringContaining('post-budget review authorization'),
      })
      expect(parseMissionControlState(renderStateBody(missingCorrectionAuthorization))).toMatchObject({
        valid: false,
        reason: expect.stringContaining('post-budget correction authorization'),
      })
      expect(parseMissionControlState(renderStateBody(ineligibleCorrectionVerdict))).toMatchObject({
        valid: false,
        reason: expect.stringContaining('does not authorize a correction transition'),
      })
    })

    it('does not infer authorization for Review 5 from an authorized Review 4', () => {
      const body = renderStateBody({
        schema_version: 1,
        state: 'BLOCKED_FOR_FOUNDER_DECISION',
        review_cycle: 3,
        full_review_count: 1,
        approved_base: 'main',
        active_task_issue: '#155',
        active_pr: '#157',
        current_head: 'review-5-head',
        last_reviewed_head: 'review-5-head',
        post_budget_reviews: [
          {
            review_number: 4,
            reviewed_head: 'review-4-head',
            verdict: 'BLOCKED FOR FOUNDER DECISION',
            authorization: {
              status: 'approved', authority: 'Founder', scope: 'review',
              review_number: 4, reviewed_head: 'review-4-head',
              action: 'Authorize bounded Review 4', authorized_at: '2026-07-23T15:00:00Z',
            },
            finding_dispositions: [{ finding_id: 'MC-R1-002', disposition: 'open' }],
          },
          {
            review_number: 5,
            reviewed_head: 'review-5-head',
            verdict: 'BLOCKED FOR FOUNDER DECISION',
            finding_dispositions: [{ finding_id: 'MC-R1-002', disposition: 'open' }],
          },
        ],
        guide_version: '1.2.0',
        guide_source_ref: 'main',
        guide_source_sha: '42b383a8bca33518116763af8094e6a42212bf0b',
        open_blockers: ['MC-R1-002'],
        follow_up_issues: [],
        next_permitted_action: 'Founder decision required',
        material_change_status: 'none',
        updated_at: '2026-07-23T17:00:00Z',
        updated_by: 'Reviewer',
      })

      expect(parseMissionControlState(body)).toMatchObject({
        valid: false,
        reason: expect.stringContaining('post-budget review authorization'),
      })
    })

    it('rejects replayed post-budget review authorization across later review entries', () => {
      const sharedAuthorization = {
        status: 'approved',
        authority: 'Founder',
        scope: 'review',
        review_number: 4,
        reviewed_head: 'review-4-head',
        action: 'Authorize bounded Review 4',
        authorized_at: '2026-07-23T15:00:00Z',
      }
      const body = renderStateBody({
        schema_version: 1,
        state: 'BLOCKED_FOR_FOUNDER_DECISION',
        review_cycle: 3,
        full_review_count: 1,
        approved_base: 'main',
        active_task_issue: '#155',
        active_pr: '#157',
        current_head: 'review-5-head',
        last_reviewed_head: 'review-5-head',
        post_budget_reviews: [
          {
            review_number: 4,
            reviewed_head: 'review-4-head',
            verdict: 'BLOCKED FOR FOUNDER DECISION',
            authorization: sharedAuthorization,
            finding_dispositions: [{ finding_id: 'MC-R1-002', disposition: 'open' }],
          },
          {
            review_number: 5,
            reviewed_head: 'review-5-head',
            verdict: 'BLOCKED FOR FOUNDER DECISION',
            authorization: sharedAuthorization,
            finding_dispositions: [{ finding_id: 'MC-R1-002', disposition: 'open' }],
          },
        ],
        guide_version: '1.2.0',
        guide_source_ref: 'main',
        guide_source_sha: '42b383a8bca33518116763af8094e6a42212bf0b',
        open_blockers: ['MC-R1-002'],
        follow_up_issues: [],
        next_permitted_action: 'Founder decision required',
        material_change_status: 'none',
        updated_at: '2026-07-23T17:00:00Z',
        updated_by: 'Reviewer',
      })

      expect(parseMissionControlState(body)).toMatchObject({
        valid: false,
        reason: expect.stringContaining('must bind to Review 5'),
      })
    })

    it('rejects stale post-budget correction authorization after a later completed review', () => {
      const body = renderStateBody({
        schema_version: 1,
        state: 'IN_PROGRESS',
        review_cycle: 3,
        full_review_count: 1,
        approved_base: 'main',
        active_task_issue: '#155',
        active_pr: '#157',
        current_head: 'correction-head',
        last_reviewed_head: 'review-5-head',
        post_budget_reviews: [
          {
            review_number: 4,
            reviewed_head: 'review-4-head',
            verdict: 'CORRECTION REQUIRED',
            authorization: {
              status: 'approved', authority: 'Founder', scope: 'review',
              review_number: 4, reviewed_head: 'review-4-head',
              action: 'Authorize bounded Review 4', authorized_at: '2026-07-23T15:00:00Z',
            },
            finding_dispositions: [{ finding_id: 'MC-R1-002', disposition: 'open' }],
          },
          {
            review_number: 5,
            reviewed_head: 'review-5-head',
            verdict: 'CORRECTION REQUIRED',
            authorization: {
              status: 'approved', authority: 'Founder', scope: 'review',
              review_number: 5, reviewed_head: 'review-5-head',
              action: 'Authorize bounded Review 5', authorized_at: '2026-07-23T16:30:00Z',
            },
            finding_dispositions: [{ finding_id: 'MC-R1-002', disposition: 'open' }],
          },
        ],
        founder_decision: {
          status: 'approved',
          authority: 'Founder',
          scope: 'correction',
          for_review_number: 4,
          reviewed_head: 'review-4-head',
          finding_ids: ['MC-R1-002'],
          action: 'Authorize one bounded correction for MC-R1-002',
          authorized_at: '2026-07-23T16:00:00Z',
        },
        guide_version: '1.2.0',
        guide_source_ref: 'main',
        guide_source_sha: '42b383a8bca33518116763af8094e6a42212bf0b',
        open_blockers: ['MC-R1-002'],
        follow_up_issues: [],
        next_permitted_action: 'Dev executes only the authorized MC-R1-002 correction',
        material_change_status: 'none',
        updated_at: '2026-07-23T17:00:00Z',
        updated_by: 'Mission Control',
      })

      expect(parseMissionControlState(body)).toMatchObject({
        valid: false,
        reason: expect.stringContaining('latest completed post-budget review number'),
      })
    })

    it('accepts distinct bound post-budget review and correction authorizations', () => {
      const body = renderStateBody({
        schema_version: 1,
        state: 'IN_PROGRESS',
        review_cycle: 3,
        full_review_count: 1,
        approved_base: 'main',
        active_task_issue: '#155',
        active_pr: '#157',
        current_head: 'correction-head',
        last_reviewed_head: 'review-5-head',
        post_budget_reviews: [
          {
            review_number: 4,
            reviewed_head: 'review-4-head',
            verdict: 'CORRECTION REQUIRED',
            authorization: {
              status: 'approved', authority: 'Founder', scope: 'review',
              review_number: 4, reviewed_head: 'review-4-head',
              action: 'Authorize bounded Review 4', authorized_at: '2026-07-23T15:00:00Z',
            },
            finding_dispositions: [{ finding_id: 'MC-R1-002', disposition: 'open' }],
          },
          {
            review_number: 5,
            reviewed_head: 'review-5-head',
            verdict: 'CORRECTION REQUIRED',
            authorization: {
              status: 'approved', authority: 'Founder', scope: 'review',
              review_number: 5, reviewed_head: 'review-5-head',
              action: 'Authorize bounded Review 5', authorized_at: '2026-07-23T16:30:00Z',
            },
            finding_dispositions: [{ finding_id: 'MC-R1-002', disposition: 'open' }],
          },
        ],
        founder_decision: {
          status: 'approved',
          authority: 'Founder',
          scope: 'correction',
          for_review_number: 5,
          reviewed_head: 'review-5-head',
          finding_ids: ['MC-R1-002'],
          action: 'Authorize one bounded correction for MC-R1-002',
          authorized_at: '2026-07-23T17:00:00Z',
        },
        guide_version: '1.2.0',
        guide_source_ref: 'main',
        guide_source_sha: '42b383a8bca33518116763af8094e6a42212bf0b',
        open_blockers: ['MC-R1-002'],
        follow_up_issues: [],
        next_permitted_action: 'Dev executes only the authorized MC-R1-002 correction',
        material_change_status: 'none',
        updated_at: '2026-07-23T17:01:00Z',
        updated_by: 'Mission Control',
      })

      expect(parseMissionControlState(body)).toMatchObject({ valid: true })
    })
  })

  describe('Role-comment selection and supersession (MC-SCENARIO-007)', () => {
    it('findLatestRoleComment selects the most recent comment matching the role', () => {
      const comments = [
        { body: '## RESULT\nold', createdAt: '2026-07-23T01:00:00Z' },
        { body: '## RESULT\nnew', createdAt: '2026-07-23T02:00:00Z' },
        { body: '## REVIEW_VERDICT\nold review', createdAt: '2026-07-23T01:30:00Z' },
      ]
      const latestResult = findLatestRoleComment(comments, 'RESULT')
      expect(latestResult?.comment.createdAt).toBe('2026-07-23T02:00:00Z')

      const latestReview = findLatestRoleComment(comments, 'REVIEW_VERDICT')
      expect(latestReview?.comment.createdAt).toBe('2026-07-23T01:30:00Z')
    })

    it('parses and supersedes all three canonical role-comment types', () => {
      const comments = [
        { body: '## HANDOFF\nold', createdAt: '2026-07-23T01:00:00Z' },
        { body: '## HANDOFF\nnew', createdAt: '2026-07-23T02:00:00Z' },
        { body: '## RESULT\nlatest result', createdAt: '2026-07-23T03:00:00Z' },
        { body: '## REVIEW_VERDICT\n**Verdict:** STATE CONFLICT', createdAt: '2026-07-23T04:00:00Z' },
      ]

      expect(comments.map((comment) => parseRoleCommentBody(comment.body).role)).toEqual([
        'HANDOFF',
        'HANDOFF',
        'RESULT',
        'REVIEW_VERDICT',
      ])
      expect(findLatestRoleComment(comments, 'HANDOFF' as 'RESULT')?.comment.body).toContain('new')
      expect(findLatestRoleComment(comments, 'RESULT')?.comment.body).toContain('latest result')
      expect(findLatestRoleComment(comments, 'REVIEW_VERDICT')?.parsed.verdict).toBe('STATE CONFLICT')
    })
  })

  describe('Reconciler / parser compatibility (MC-SCENARIO-008)', () => {
    it('ensures reconciler outputs are parsable state objects', () => {
      const prop = proposeReviewReconciliation({ verdict: 'BLOCKED FOR FOUNDER DECISION', reviewedHead: 'd', reviewCycle: 2, fullReviewCount: 1 })
      expect(prop.state).toBe('BLOCKED_FOR_FOUNDER_DECISION')
      
      const stateStr = `<!-- bemoat-mission-control-state:start -->
\`\`\`yaml
schema_version: 1
state: ${prop.state}
review_cycle: ${prop.review_cycle}
full_review_count: ${prop.full_review_count}
approved_base: main
active_task_issue: "#150"
active_pr: "#151"
current_head: head1
last_reviewed_head: ${prop.last_reviewed_head}
guide_version: 1.2.0
guide_source_ref: main
guide_source_sha: deadbeef
open_blockers: []
follow_up_issues: []
next_permitted_action: "${prop.next_permitted_action}"
material_change_status: none
updated_at: "2026-07-23T03:45:00Z"
updated_by: "Mission Control"
\`\`\`
<!-- bemoat-mission-control-state:end -->`

      const parsed = parseMissionControlState(stateStr)
      expect(parsed.valid).toBe(true)
    })
  })

  describe('Exact-head CI requirements (MC-SCENARIO-010)', () => {
    it('blocks delivery lag resolution when exact-head CI is missing', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const managedState: any = { state: 'READY', review_cycle: 0, full_review_count: 0, active_pr: null, current_head: null }
      const livePr = { number: 151, headRefOid: 'abcdef1000000000000000000000000000000000' }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const latestResult: any = { comment: {}, parsed: { role: 'RESULT', body: '', prNumber: '151', headSha: 'abcdef1000000000000000000000000000000000', verdict: null, managedStateLine: null } }
      const exactHeadCi = { exactHeadVerified: false }
      
      const delivery = classifyDeliveryLag(managedState, livePr, exactHeadCi, latestResult)
      expect(delivery.lag).toBe(true)
      expect(delivery.kind).toBe('INCOMPLETE_DELIVERY')
      expect(delivery.reason).toBe('exact-head CI not verified')
    })

    it('allows delivery lag resolution when exact-head CI is verified', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const managedState: any = { state: 'READY', review_cycle: 0, full_review_count: 0, active_pr: null, current_head: null }
      const livePr = { number: 151, headRefOid: 'abcdef1000000000000000000000000000000000' }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const latestResult: any = { comment: {}, parsed: { role: 'RESULT', body: '', prNumber: '151', headSha: 'abcdef1000000000000000000000000000000000', verdict: null, managedStateLine: null } }
      const exactHeadCi = { exactHeadVerified: true }
      
      const delivery = classifyDeliveryLag(managedState, livePr, exactHeadCi, latestResult)
      expect(delivery.lag).toBe(true)
      expect(delivery.kind).toBe('DETERMINISTIC_RECONCILIATION')
      expect(delivery.reason).toBe('unambiguous delivery evidence')
    })

    it('binds delivery projection to the verified live head instead of short RESULT metadata', () => {
      const verifiedHead = 'abcdef1'.padEnd(40, '0')
      const proposal = proposeDeliveryReconciliation({
        managedState: {
          state: 'READY',
          review_cycle: 0,
          full_review_count: 0,
          active_pr: null,
          current_head: null,
        },
        livePr: { number: 151, headRefOid: verifiedHead, baseRefName: 'main' },
        latestResult: { parsed: { prNumber: '151', headSha: 'abcdef1000000000000000000000000000000000', base: 'main' } },
        activeTaskIssue: '#150',
        approvedBase: 'main',
      })

      expect(proposal.current_head).toBe(verifiedHead)
    })

    it('rejects delivery projection when RESULT head evidence conflicts with the live head', () => {
      const verifiedHead = 'abcdef1'.padEnd(40, '0')
      expect(() => proposeDeliveryReconciliation({
        managedState: {
          state: 'READY',
          review_cycle: 0,
          full_review_count: 0,
          active_pr: null,
          current_head: null,
        },
        livePr: { number: 151, headRefOid: verifiedHead, baseRefName: 'main' },
        latestResult: { parsed: { prNumber: '151', headSha: '1234567000000000000000000000000000000000', base: 'main' } },
        activeTaskIssue: '#150',
        approvedBase: 'main',
      })).toThrow(/EVIDENCE_CONFLICT: RESULT head does not match verified live PR head/)
    })

    it('rejects successful CI evidence that names a different head', () => {
      const analysis = analyzeExactHeadCi({
        headRefOid: 'abcdef1234567890000000000000000000000000',
        statusCheckRollup: {
          contexts: [
            {
              state: 'SUCCESS',
              description: 'verified commit 1111111111111111',
              targetUrl: 'https://example.test/actions/older',
            },
          ],
        },
      })

      expect(analysis.exactHeadVerified).toBe(false)
      expect(analysis.olderShaSuccess).toBe(true)
    })

    it('routes RESULT and REVIEW_VERDICT head disagreement with the live PR to STATE_CONFLICT', () => {
      const livePr = { number: 151, headRefOid: 'abcdef1234567890000000000000000000000000' }
      const delivery = classifyDeliveryLag(
        { state: 'IN_PROGRESS', active_pr: '#151', current_head: null },
        livePr,
        { exactHeadVerified: true },
        { parsed: { headSha: '1111111111111111111111111111111111111111', prNumber: '151' } },
      )
      const review = classifyReviewLag(
        { state: 'AWAITING_REVIEW_1', review_cycle: 0, last_reviewed_head: null },
        livePr,
        { parsed: { verdict: 'CORRECTION REQUIRED', headSha: '1111111111111111111111111111111111111111', prNumber: '151' } },
      )

      expect(delivery).toMatchObject({ kind: 'STATE_CONFLICT', reason: 'RESULT head does not match live PR head' })
      expect(review).toMatchObject({ kind: 'STATE_CONFLICT', reason: 'verdict head does not match live PR head' })
    })
  })

  describe.skipIf(!hasStarterOnlyCorpus)('Integrated upstream dogfood (MC-SCENARIO-008)', () => {
    it('replays delivery, three review bounds, role transport, exact-head CI, and sync inventory', async () => {
      const head = 'abcdef1234567890000000000000000000000000'
      const livePr = { number: 151, headRefOid: head, baseRefName: 'main' }
      const renderState = (state: string, reviewCycle: number, fullReviewCount: number) => `
**Task size**: Core
**Mission Control mode**: required
<!-- bemoat-mission-control-state:start -->
\`\`\`yaml
schema_version: 1
state: ${state}
review_cycle: ${reviewCycle}
full_review_count: ${fullReviewCount}
approved_base: main
active_task_issue: "#150"
active_pr: ${state === 'READY' ? 'null' : '"#151"'}
current_head: ${state === 'READY' ? 'null' : head}
last_reviewed_head: ${reviewCycle === 0 ? 'null' : head}
guide_version: 1.2.0
guide_source_ref: main
guide_source_sha: c2637d6540f9200b01e8e0af1938e257975ada27
open_blockers: []
follow_up_issues: []
next_permitted_action: "bounded fixture action"
material_change_status: none
updated_at: "2026-07-23T03:45:00Z"
updated_by: "Mission Control"
\`\`\`
<!-- bemoat-mission-control-state:end -->`
      const comments = {
        handoff: parseRoleCommentBody('## HANDOFF\n**State:** branch `test/150` · base `main` · head `abcdef1234567890000000000000000000000000`'),
        result: parseRoleCommentBody('## RESULT\n**State:** branch `test/150` · base `main` · head `abcdef1234567890000000000000000000000000`\n**PR:** https://github.com/boat1994/bemoat-web-starter/pull/151'),
        verdict: parseRoleCommentBody('## REVIEW_VERDICT\n**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/151 · `main` · `abcdef1234567890000000000000000000000000`\n**Verdict:** ELIGIBLE FOR FOUNDER REVIEW'),
      }

      expect(Object.values(comments).map((comment) => comment.role)).toEqual([
        'HANDOFF',
        'RESULT',
        'REVIEW_VERDICT',
      ])
      const lifecycleStates = [
        ['READY', 0, 0],
        ['AWAITING_REVIEW_1', 0, 0],
        ['CORRECTION_REQUIRED_1', 1, 1],
        ['AWAITING_REVIEW_2', 1, 1],
        ['CORRECTION_REQUIRED_2', 2, 1],
        ['AWAITING_REVIEW_3', 2, 1],
        ['ELIGIBLE_FOR_FOUNDER_REVIEW', 3, 1],
      ] as const
      for (const [state, cycle, full] of lifecycleStates) {
        expect(parseMissionControlState(renderState(state, cycle, full))).toMatchObject({ valid: true })
      }
      expect(analyzeProgressTracking({ activeIssueBody: renderState('READY', 0, 0) }).blockers)
        .not.toContain(expect.stringContaining('STATE_MIGRATION_REQUIRED'))

      const exactHeadCi = analyzeExactHeadCi({
        headRefOid: head,
        statusCheckRollup: [
          { name: 'ci', conclusion: 'SUCCESS' },
          { name: 'starter-ci', conclusion: 'SUCCESS' },
        ],
      })
      expect(exactHeadCi).toMatchObject({ exactHeadVerified: true, headSha: head })
      expect(classifyDeliveryLag(
        { state: 'IN_PROGRESS', active_pr: null, current_head: null },
        livePr,
        exactHeadCi,
        { parsed: comments.result },
      ).kind).toBe('DETERMINISTIC_RECONCILIATION')
      expect(proposeDeliveryReconciliation({
        livePr,
        activeTaskIssue: '150',
        latestResult: { parsed: comments.result },
      })).toMatchObject({ state: 'AWAITING_REVIEW_1', review_cycle: 0, full_review_count: 0 })

      const review1 = proposeReviewReconciliation({
        verdict: 'CORRECTION REQUIRED', reviewedHead: head, reviewCycle: 0, fullReviewCount: 0,
      })
      const review2 = proposeReviewReconciliation({
        verdict: 'CORRECTION REQUIRED', reviewedHead: head, reviewCycle: 1, fullReviewCount: 1,
      })
      const review3 = proposeReviewReconciliation({
        verdict: 'ELIGIBLE FOR FOUNDER REVIEW', reviewedHead: head, reviewCycle: 2, fullReviewCount: 1,
      })
      expect([review1.state, review2.state, review3.state]).toEqual([
        'CORRECTION_REQUIRED_1',
        'CORRECTION_REQUIRED_2',
        'ELIGIBLE_FOR_FOUNDER_REVIEW',
      ])
      expect([review1.review_cycle, review2.review_cycle, review3.review_cycle]).toEqual([1, 2, 3])
      expect([review1.full_review_count, review2.full_review_count, review3.full_review_count]).toEqual([1, 1, 1])

      const baseline = JSON.parse(readFileSync(join(dogfoodRoot, 'issue-150-baseline.json'), 'utf8'))
      const syncManifest = JSON.parse(
        readFileSync(resolve(process.cwd(), '.bemoat/boilerplate-sync-manifest.json'), 'utf8'),
      )
      const syncModule = await import('../../scripts/sync-boilerplate.mjs')
      expect(syncModule.managedPaths).toEqual(syncManifest.managedPaths)
      expect(baseline.totals.sync_managed_docs_files).toBe(49)
      expect(baseline.sync_managed_resolved_paths).toHaveLength(49)
    })
  })

  describe.skipIf(!hasStarterOnlyCorpus)('Issue #149 contradiction and Issue #150 acceptance traceability', () => {
    it('defines complete machine-readable before/current/approved benchmark scenarios', () => {
      const benchmark = JSON.parse(
        readFileSync(join(dogfoodRoot, 'issue-150-benchmark-scenarios.json'), 'utf8'),
      )

      expect(benchmark.schema_version).toBe(1)
      expect(benchmark.issue_criteria.map((item: { id: string }) => item.id)).toEqual(
        Array.from({ length: 12 }, (_, index) => `ISSUE150-${String(index + 1).padStart(2, '0')}`),
      )
      expect(benchmark.discovery_contradictions.map((item: { id: string }) => item.id)).toEqual(
        Array.from({ length: 10 }, (_, index) => `MC149-D${String(index + 1).padStart(2, '0')}`),
      )
      expect(Object.fromEntries(
        benchmark.discovery_contradictions.map((item: { id: string, scenario_ids: string[] }) => [item.id, item.scenario_ids]),
      )).toEqual({
        'MC149-D01': ['MC-SCENARIO-005', 'MC-SCENARIO-006', 'MC-SCENARIO-008'],
        'MC149-D02': ['MC-SCENARIO-002', 'MC-SCENARIO-003'],
        'MC149-D03': ['MC-SCENARIO-008'],
        'MC149-D04': ['MC-SCENARIO-007', 'MC-SCENARIO-009'],
        'MC149-D05': ['MC-SCENARIO-009'],
        'MC149-D06': ['MC-SCENARIO-009'],
        'MC149-D07': ['MC-SCENARIO-009'],
        'MC149-D08': ['MC-SCENARIO-007', 'MC-SCENARIO-008', 'MC-SCENARIO-010'],
        'MC149-D09': ['MC-SCENARIO-001', 'MC-SCENARIO-009'],
        'MC149-D10': ['MC-SCENARIO-001'],
      })
      expect(new Set(benchmark.issue_criteria.flatMap((item: { scenarios: string[] }) => item.scenarios)).size)
        .toBe(benchmark.scenarios.length)
      for (const scenario of benchmark.scenarios) {
        expect(scenario).toMatchObject({
          id: expect.stringMatching(/^MC-SCENARIO-\d{3}$/),
          policy_intent: expect.any(String),
          before_observation: expect.any(String),
          current_observation: expect.any(String),
          approved_behavior: expect.any(String),
          fixture: expect.any(Object),
          test_references: expect.any(Array),
        })
        expect(scenario.test_references.length).toBeGreaterThan(0)
      }
      const characterizationSource = readFileSync(
        resolve(process.cwd(), 'tests/int/mission-control-characterization.int.spec.ts'),
        'utf8',
      )
      const guardSource = readFileSync(resolve(process.cwd(), 'tests/int/guard-pack.int.spec.ts'), 'utf8')
      for (const testReference of benchmark.scenarios.flatMap(
        (scenario: { test_references: string[] }) => scenario.test_references,
      )) {
        expect(`${characterizationSource}\n${guardSource}`).toContain(testReference)
      }
      const tracedContradictions = new Set(
        benchmark.scenarios.flatMap((scenario: { discovery_trace: string[] }) => scenario.discovery_trace),
      )
      expect([...tracedContradictions].sort()).toEqual(
        benchmark.discovery_contradictions.map((item: { id: string }) => item.id).sort(),
      )
      for (const contradiction of benchmark.discovery_contradictions) {
        expect(contradiction.evidence_boundary).toEqual(expect.any(String))
        expect(contradiction.evidence_boundary.length).toBeGreaterThan(20)
        for (const scenarioId of contradiction.scenario_ids) {
          const scenario = benchmark.scenarios.find((item: { id: string }) => item.id === scenarioId)
          expect(scenario.discovery_trace).toContain(contradiction.id)
        }
      }
    })
  })
})
