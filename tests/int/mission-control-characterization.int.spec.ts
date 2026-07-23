import { describe, it, expect } from 'vitest'
import { parseMissionControlState } from '../../scripts/mission-control-state.mjs'
import {
  analyzeProgressTracking,
} from '../../scripts/agent-issue.mjs'
import {
  classifyDeliveryLag,
  proposeReviewReconciliation,
  findLatestRoleComment,
  isGenuineStateConflict,
} from '../../scripts/mission-control-reconcile.mjs'

describe('Mission Control Characterization (Issue #150)', () => {

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
      expect(parsed.state.approved_base).toBe('dev-branch')
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
      const report = analyzeProgressTracking({ activeIssueBody: duplicateBody, activeIssueNumber: "1" })
      expect(report.blockers.some(b => b.includes('STATE_MIGRATION_REQUIRED: exactly one balanced marker pair is required'))).toBe(true)

      const unbalancedBody = `
<!-- bemoat-mission-control-state:start -->
\`\`\`yaml
schema_version: 1
\`\`\`
`
      const unbalancedReport = analyzeProgressTracking({ activeIssueBody: unbalancedBody, activeIssueNumber: "1" })
      expect(unbalancedReport.blockers.some(b => b.includes('STATE_MIGRATION_REQUIRED: exactly one balanced marker pair is required'))).toBe(true)
    })

    it('emits STATE_CONFLICT when genuine state conflict is detected', () => {
      expect(isGenuineStateConflict({ headMismatch: true })).toBe(true)
      expect(isGenuineStateConflict({ staleCi: true })).toBe(true)
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
  })

  describe('Role-comment selection and supersession (MC-SCENARIO-007)', () => {
    it('findLatestRoleComment selects the most recent comment matching the role', () => {
      const comments = [
        { body: '## RESULT\nold', createdAt: '2026-07-23T01:00:00Z' },
        { body: '## RESULT\nnew', createdAt: '2026-07-23T02:00:00Z' },
        { body: '## REVIEW_VERDICT\nold review', createdAt: '2026-07-23T01:30:00Z' },
      ]
      const latestResult = findLatestRoleComment(comments, 'RESULT')
      expect(latestResult.comment.createdAt).toBe('2026-07-23T02:00:00Z')

      const latestReview = findLatestRoleComment(comments, 'REVIEW_VERDICT')
      expect(latestReview.comment.createdAt).toBe('2026-07-23T01:30:00Z')
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
      const livePr = { number: 151, headRefOid: 'abcdef1' }
      const latestResult = { parsed: { prNumber: 151, headSha: 'abcdef1' } }
      const exactHeadCi = { exactHeadVerified: false }
      
      const delivery = classifyDeliveryLag(managedState, livePr, exactHeadCi, latestResult)
      expect(delivery.lag).toBe(true)
      expect(delivery.kind).toBe('INCOMPLETE_DELIVERY')
      expect(delivery.reason).toBe('exact-head CI not verified')
    })

    it('allows delivery lag resolution when exact-head CI is verified', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const managedState: any = { state: 'READY', review_cycle: 0, full_review_count: 0, active_pr: null, current_head: null }
      const livePr = { number: 151, headRefOid: 'abcdef1' }
      const latestResult = { parsed: { prNumber: 151, headSha: 'abcdef1' } }
      const exactHeadCi = { exactHeadVerified: true }
      
      const delivery = classifyDeliveryLag(managedState, livePr, exactHeadCi, latestResult)
      expect(delivery.lag).toBe(true)
      expect(delivery.kind).toBe('DETERMINISTIC_RECONCILIATION')
      expect(delivery.reason).toBe('unambiguous delivery evidence')
    })
  })
})
