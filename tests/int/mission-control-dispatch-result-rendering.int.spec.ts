import { describe, expect, it } from 'vitest'

import {
  createResultRendering,
  createRuntimeErrorRendering,
  runtimeError,
} from '../../scripts/mission-control/domain/dispatch-result-rendering.mjs'

const HANDOFF = {
  prNumber: '335',
  headSha: 'ABCDEF0123456789ABCDEF0123456789ABCDEF01',
}

describe('mission-control dispatch result rendering', () => {
  it('preserves the successful dispatch envelope, legacy output, route, and exit code', () => {
    const rendering = createResultRendering({
      command: 'bemoat:mission-control:dispatch',
      format: 'text',
      options: { repo: 'acme/repo', issue: '328' },
      result: {
        outcome: 'DISPATCHED',
        state: { state: 'IN_PROGRESS', active_pr: '#335' },
        comment: { id: 9001 },
        identity: { issue: '328', head: HANDOFF.headSha },
      },
      observedPreState: 'READY',
      parsedBody: HANDOFF,
    })

    expect(rendering.envelope).toMatchObject({
      outcome: 'SUCCESS',
      classification: 'SUCCESS',
      mutation_performed: true,
      observed_pre_state: 'READY',
      resulting_state: 'IN_PROGRESS',
      repository: 'acme/repo',
      issue_number: '328',
      pr_number: '335',
      exact_head: HANDOFF.headSha.toLowerCase(),
      next_action: {
        type: 'COMMAND',
        command: 'bemoat:agent:delivery',
        reason: 'The dispatch claim is ready for one delivery RESULT.',
      },
      details: {
        legacy_classification: 'DISPATCHED',
        legacy_output: ['Mission Control dispatch DISPATCHED: READY -> IN_PROGRESS + HANDOFF comment 9001'],
        comment_id: '9001',
        transition_identity: JSON.stringify({ issue: '328', head: HANDOFF.headSha }),
      },
    })
    expect(rendering.output).toBe('SUCCESS: Mission Control dispatch DISPATCHED: READY -> IN_PROGRESS + HANDOFF comment 9001\n')
    expect(rendering.exitCode).toBe(0)
  })

  it('preserves the identical dispatch retry envelope and completion route', () => {
    const rendering = createResultRendering({
      command: 'bemoat:mission-control:dispatch',
      format: 'text',
      options: { repo: 'acme/repo', issue: '328' },
      result: {
        outcome: 'NO_OP',
        state: { state: 'IN_PROGRESS' },
        comment: { id: 9001 },
      },
      observedPreState: 'IN_PROGRESS',
      parsedBody: HANDOFF,
    })

    expect(rendering.envelope).toMatchObject({
      outcome: 'NO_OP',
      classification: 'NO_OP_IDENTICAL_RETRY',
      mutation_performed: false,
      next_action: {
        type: 'COMPLETE',
        command: null,
        reason: 'The identical dispatch claim is already durable.',
      },
    })
    expect(rendering.output).toBe('NO_OP_IDENTICAL_RETRY: Mission Control dispatch NO_OP: READY -> IN_PROGRESS + HANDOFF comment 9001\n')
    expect(rendering.exitCode).toBe(0)
  })

  it('preserves JSON runtime error envelope, mutation flag, and classified exit code', () => {
    const rendering = createRuntimeErrorRendering({
      command: 'bemoat:mission-control:dispatch',
      format: 'json',
      error: runtimeError('AMBIGUOUS_RESULT', 'HANDOFF POST outcome is unknown', { mutationPerformed: true }),
      values: { repository: 'acme/repo', issue_number: '328' },
    })

    expect(rendering.envelope).toMatchObject({
      outcome: 'ERROR',
      classification: 'AMBIGUOUS_RESULT',
      mutation_performed: true,
      repository: 'acme/repo',
      issue_number: '328',
      next_action: { type: 'STOP', command: null, reason: 'HANDOFF POST outcome is unknown' },
      details: { argument: null, reason: 'HANDOFF POST outcome is unknown' },
    })
    expect(rendering.output).toBe(`${JSON.stringify(rendering.envelope)}\n`)
    expect(rendering.stream).toBe('stdout')
    expect(rendering.exitCode).toBe(4)
  })

  it('preserves text runtime error stream and legacy classification prefix', () => {
    const rendering = createRuntimeErrorRendering({
      command: 'bemoat:mission-control:dispatch',
      format: 'text',
      error: runtimeError('STATE_CONFLICT', 'concurrent Issue write detected', { legacyClassification: 'POSTED' }),
      values: { repository: 'acme/repo', issue_number: '328' },
    })

    expect(rendering).toEqual({
      envelope: null,
      output: 'ERROR: STATE_CONFLICT: POSTED: concurrent Issue write detected\n',
      stream: 'stderr',
      exitCode: 3,
    })
  })
})
