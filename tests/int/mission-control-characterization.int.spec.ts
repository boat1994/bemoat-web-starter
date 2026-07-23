import { describe, it, expect } from 'vitest'
import { parseMissionControlState } from '../../scripts/mission-control-state.mjs'

describe('Mission Control Characterization (Issue #150)', () => {
  it('strictly rejects unmarked MISSION_CONTROL_STATE YAML blocks and routes to STATE_MIGRATION_REQUIRED', () => {
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

    const parsed = parseMissionControlState(unmarkedBody)
    expect(parsed.present).toBe(true)
    expect(parsed.valid).toBe(false)
    expect(parsed.reason).toBe('unmarked YAML is not a durable managed-state block')
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
    const parsedDuplicate = parseMissionControlState(duplicateBody)
    expect(parsedDuplicate.present).toBe(true)
    expect(parsedDuplicate.valid).toBe(false)
    expect(parsedDuplicate.reason).toBe('exactly one balanced marker pair is required')
  })

  it('successfully parses valid marked state blocks', () => {
    const markedBody = `
<!-- bemoat-mission-control-state:start -->
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
    expect(parsed.state?.state).toBe('READY')
  })
})
