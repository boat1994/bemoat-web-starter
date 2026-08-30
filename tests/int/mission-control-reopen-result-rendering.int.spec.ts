import { describe, expect, it } from 'vitest'

import {
  createResultRendering,
  createRuntimeErrorRendering,
  runtimeError,
} from '../../scripts/mission-control/domain/reopen-result-rendering.ts'

const OPTIONS = {
  issueNumber: '284',
  repo: 'boat1994/bemoat-web-starter',
  expectedPr: '285',
  expectedNewHead: 'ABCDEF0123456789ABCDEF0123456789ABCDEF01',
}

describe('mission-control reopen result rendering', () => {
  it('preserves the reopened text result and canonical success envelope', () => {
    const rendering = createResultRendering({
      command: 'bemoat:mission-control:reopen',
      format: 'text',
      options: OPTIONS,
      observedPreState: 'ELIGIBLE_FOR_FOUNDER_REVIEW',
      result: {
        outcome: 'REOPENED',
        state: {
          state: 'FOUNDER_AUTHORIZED_CORRECTION',
          review_cycle: 1,
          full_review_count: 1,
        },
      },
    })

    expect(rendering.envelope).toMatchObject({
      outcome: 'SUCCESS',
      classification: 'SUCCESS',
      mutation_performed: true,
      observed_pre_state: 'ELIGIBLE_FOR_FOUNDER_REVIEW',
      resulting_state: 'FOUNDER_AUTHORIZED_CORRECTION',
      repository: 'boat1994/bemoat-web-starter',
      issue_number: '284',
      pr_number: '285',
      exact_head: OPTIONS.expectedNewHead.toLowerCase(),
      next_action: {
        type: 'FOUNDER_GATE',
        command: null,
      },
      details: {
        legacy_classification: 'REOPENED',
        legacy_output: [
          'Mission Control reopen REOPENED: Task #284 -> FOUNDER_AUTHORIZED_CORRECTION 1/1',
        ],
      },
    })
    expect(rendering.output).toBe('Mission Control reopen REOPENED: Task #284 -> FOUNDER_AUTHORIZED_CORRECTION 1/1\n')
    expect(rendering.stream).toBe('stdout')
    expect(rendering.exitCode).toBe(0)
  })

  it('preserves the identical retry envelope and JSON output', () => {
    const rendering = createResultRendering({
      command: 'bemoat:mission-control:reopen',
      format: 'json',
      options: OPTIONS,
      observedPreState: 'FOUNDER_AUTHORIZED_CORRECTION',
      result: {
        outcome: 'NO_OP',
        state: {
          state: 'FOUNDER_AUTHORIZED_CORRECTION',
          review_cycle: 1,
          full_review_count: 1,
        },
      },
    })

    expect(rendering.envelope).toMatchObject({
      outcome: 'NO_OP',
      classification: 'NO_OP_IDENTICAL_RETRY',
      mutation_performed: false,
      next_action: { type: 'COMPLETE', command: null },
    })
    expect(rendering.output).toBe(`${JSON.stringify(rendering.envelope)}\n`)
    expect(rendering.stream).toBe('stdout')
    expect(rendering.exitCode).toBe(0)
  })

  it('preserves classified Error and non-Error terminal failures', () => {
    expect(createRuntimeErrorRendering({
      command: 'bemoat:mission-control:reopen',
      format: 'text',
      error: runtimeError('STATE_CONFLICT', 'concurrent Issue body change detected'),
      options: OPTIONS,
    })).toEqual({
      envelope: null,
      output: 'ERROR: STATE_CONFLICT: concurrent Issue body change detected\n',
      stream: 'stderr',
      exitCode: 3,
    })

    const rendering = createRuntimeErrorRendering({
      command: 'bemoat:mission-control:reopen',
      format: 'json',
      error: 'BLOCKED_EXTERNAL: GitHub unavailable',
      options: OPTIONS,
    })
    expect(rendering.envelope).toMatchObject({
      outcome: 'ERROR',
      classification: 'BLOCKED_EXTERNAL',
      mutation_performed: false,
      details: { reason: 'BLOCKED_EXTERNAL: GitHub unavailable' },
    })
    expect(rendering.output).toBe(`${JSON.stringify(rendering.envelope)}\n`)
    expect(rendering.stream).toBe('stdout')
    expect(rendering.exitCode).toBe(3)
  })
})
