import { describe, expect, it } from 'vitest'

import { parseHandoffBody } from '../../scripts/handoff/schema.ts'

const BASE_SHA = 'a'.repeat(40)
const HEAD_SHA = 'b'.repeat(40)

function validRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    record_type: 'HANDOFF',
    repository: 'boat1994/bemoat-web-starter',
    issue_number: '410',
    objective: 'Implement the bounded handoff protocol primitive.',
    permitted_scope: ['scripts/agent-handoff.ts', 'scripts/handoff/', 'tests/int/'],
    prohibited_scope: ['legacy Mission Control deletion', 'production operations'],
    executing_agent: 'Codex',
    provider: 'OpenAI',
    branch: 'feature/410-handoff-protocol',
    exact_head: HEAD_SHA,
    protected_base: { branch: 'main', sha: BASE_SHA },
    pr: {
      number: '412',
      url: 'https://github.com/boat1994/bemoat-web-starter/pull/412',
      base: 'main',
      head: 'feature/410-handoff-protocol',
      head_sha: HEAD_SHA,
    },
    verified_evidence: [
      {
        kind: 'focused-tests',
        value: 'handoff transport tests pass',
        url: 'https://github.com/boat1994/bemoat-web-starter/actions',
      },
    ],
    route: 'IMPLEMENT',
    next_action: {
      route: 'IMPLEMENT',
      description: 'Implement the bounded handoff protocol primitive.',
    },
    stop_conditions: ['Stop on stale, conflicting, malformed, or non-durable evidence.'],
    local_durability: { required: true, durable: true, reason: null },
    ...overrides,
  }
}

describe('bemoat:handoff schema', () => {
  it('parses the minimal canonical HANDOFF record without adding fields', () => {
    const record = validRecord()

    expect(parseHandoffBody(JSON.stringify(record))).toEqual(record)
  })

  it('rejects stateful fields and unknown schema extensions', () => {
    expect(() => parseHandoffBody(JSON.stringify(validRecord({ state: 'IN_PROGRESS' })))).toThrow(/unknown field/i)
    expect(() => parseHandoffBody(JSON.stringify(validRecord({ review_cycle: 1 })))).toThrow(/unknown field/i)
    expect(() => parseHandoffBody(JSON.stringify(validRecord({ receipt: { id: 'x' } })))).toThrow(/unknown field/i)
  })

  it('rejects a route whose next action is not compatible with the route', () => {
    expect(() => parseHandoffBody(JSON.stringify(validRecord({
      next_action: { route: 'REVIEW', description: 'Review the implementation.' },
    })))).toThrow(/next_action.*route|compatible/i)
  })

  it('rejects malformed bindings and non-durable required local work', () => {
    expect(() => parseHandoffBody(JSON.stringify(validRecord({ exact_head: 'not-a-sha' })))).toThrow(/exact_head/i)
    expect(() => parseHandoffBody(JSON.stringify(validRecord({
      local_durability: { required: true, durable: false, reason: null },
    })))).toThrow(/durability|reason/i)
  })
})
