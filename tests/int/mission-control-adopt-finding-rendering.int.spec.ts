import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { CliInvocationError } from '../../scripts/cli/command-invocation.mjs'
import { beforeAll, describe, expect, it } from 'vitest'

let renderers: typeof import('../../scripts/mission-control/domain/adopt-finding-result-rendering.mjs')
const rendererModulePath = ['..', '..', 'scripts', 'mission-control', 'domain', 'adopt-finding-result-rendering.mjs'].join('/')

const OPTIONS = {
  issueNumber: '328',
  expectedPr: '335',
  repo: 'Acme/Repo',
  expectedState: 'CORRECTION_REQUIRED_1',
  expectedAdoptionHead: 'ABCDEF0123456789ABCDEF0123456789ABCDEF01',
  authorizationComment: '7001',
  predecessorComment: '7002',
}

describe('mission-control adopt-finding result rendering', () => {
  beforeAll(async () => {
    expect(existsSync(resolve('scripts/mission-control/domain/adopt-finding-result-rendering.mjs'))).toBe(true)
    renderers = await import(rendererModulePath)
  })

  it('preserves the successful result envelope, legacy output, route, and exit code', () => {
    const rendering = renderers.createResultRendering({
      command: 'bemoat:mission-control:adopt-finding',
      format: 'text',
      options: OPTIONS,
      classification: 'SUCCESS',
      outcome: 'SUCCESS',
      mutationPerformed: true,
      observedPreState: OPTIONS.expectedState,
      resultingState: 'CORRECTION_REQUIRED_1',
      repository: 'acme/repo',
      exactHead: OPTIONS.expectedAdoptionHead.toLowerCase(),
      evidenceIds: { founder_authorization_comment_id: '7001', predecessor_comment_id: '7002' },
      details: { check_only: false, adopted_finding_id: 'F-1' },
    })

    expect(rendering.envelope).toMatchObject({
      outcome: 'SUCCESS',
      classification: 'SUCCESS',
      mutation_performed: true,
      observed_pre_state: 'CORRECTION_REQUIRED_1',
      resulting_state: 'CORRECTION_REQUIRED_1',
      repository: 'acme/repo',
      issue_number: '328',
      pr_number: '335',
      exact_head: OPTIONS.expectedAdoptionHead.toLowerCase(),
      evidence_ids: { founder_authorization_comment_id: '7001', predecessor_comment_id: '7002' },
      next_action: {
        type: 'COMMAND',
        command: 'bemoat:agent:issue',
        reason: 'Exact next permitted action: pnpm run bemoat:agent:issue -- 328 --phase correction',
      },
      details: {
        check_only: false,
        adopted_finding_id: 'F-1',
        exact_next_permitted_action: 'pnpm run bemoat:agent:issue -- 328 --phase correction',
      },
    })
    expect(rendering.output).toBe('SUCCESS: adopt-finding Task #328\n')
    expect(rendering.stream).toBe('stdout')
    expect(rendering.exitCode).toBe(0)
  })

  it('preserves the identical retry completion route and zero mutation', () => {
    const rendering = renderers.createResultRendering({
      command: 'bemoat:mission-control:adopt-finding',
      format: 'json',
      options: OPTIONS,
      classification: 'NO_OP_IDENTICAL_RETRY',
      outcome: 'NO_OP',
      mutationPerformed: false,
      observedPreState: OPTIONS.expectedState,
      resultingState: OPTIONS.expectedState,
      repository: 'acme/repo',
      exactHead: OPTIONS.expectedAdoptionHead.toLowerCase(),
      evidenceIds: {},
      details: { check_only: false },
    })

    expect(rendering.envelope).toMatchObject({
      outcome: 'NO_OP',
      classification: 'NO_OP_IDENTICAL_RETRY',
      mutation_performed: false,
      next_action: {
        type: 'COMMAND',
        command: 'bemoat:agent:issue',
      },
    })
    expect(rendering.output).toBe(`${JSON.stringify(rendering.envelope)}\n`)
    expect(rendering.exitCode).toBe(0)
  })

  it('preserves JSON terminal runtime error envelopes and mutation flags', () => {
    const error = Object.assign(new Error('Issue CAS/lease write outcome is ambiguous'), {
      classification: 'AMBIGUOUS_RESULT',
    })

    const rendering = renderers.createRuntimeErrorRendering({
      command: 'bemoat:mission-control:adopt-finding',
      format: 'json',
      error,
      options: OPTIONS,
    })

    expect(rendering.envelope).toMatchObject({
      outcome: 'STOP',
      classification: 'AMBIGUOUS_RESULT',
      mutation_performed: false,
      observed_pre_state: 'CORRECTION_REQUIRED_1',
      repository: 'acme/repo',
      issue_number: '328',
      pr_number: '335',
      exact_head: OPTIONS.expectedAdoptionHead.toLowerCase(),
      evidence_ids: {
        founder_authorization_comment_id: '7001',
        predecessor_comment_id: '7002',
      },
      next_action: { type: 'STOP', command: null, reason: error.message },
      details: { reason: error.message },
    })
    expect(rendering.output).toBe(`${JSON.stringify(rendering.envelope)}\n`)
    expect(rendering.stream).toBe('stdout')
    expect(rendering.exitCode).toBe(4)
  })

  it('preserves invalid invocation and text terminal error streams', () => {
    const invalid = renderers.createRuntimeErrorRendering({
      command: 'bemoat:mission-control:adopt-finding',
      format: 'text',
      error: new CliInvocationError('issue_number', 'missing positional input: issue_number'),
      options: null,
    })
    expect(invalid).toMatchObject({
      envelope: {
        classification: 'INVALID_INVOCATION',
        outcome: 'STOP',
      },
      output: 'INVALID_INVOCATION: missing positional input: issue_number\n',
      stream: 'stderr',
      exitCode: 2,
    })

    const external = new Error('GitHub CLI failed')
    const blocked = renderers.createRuntimeErrorRendering({
      command: 'bemoat:mission-control:adopt-finding',
      format: 'text',
      error: external,
      options: OPTIONS,
    })
    expect(blocked).toMatchObject({
      envelope: {
        classification: 'BLOCKED_EXTERNAL',
        outcome: 'STOP',
      },
      output: 'BLOCKED_EXTERNAL: GitHub CLI failed\n',
      stream: 'stderr',
      exitCode: 3,
    })
  })

  it('preserves parent throws for malformed invocation details and missing repository', () => {
    const malformedInvocation = new CliInvocationError('issue_number', 'missing positional input: issue_number')
    Object.defineProperty(malformedInvocation, 'details', { value: undefined })

    const malformedOptions = { ...OPTIONS }
    Object.defineProperty(malformedOptions, 'repo', { value: undefined })

    expect(() => renderers.createRuntimeErrorRendering({
      command: 'bemoat:mission-control:adopt-finding',
      format: 'text',
      error: malformedInvocation,
      options: null,
    })).toThrow("Cannot read properties of undefined (reading 'argument')")

    expect(() => renderers.createRuntimeErrorRendering({
      command: 'bemoat:mission-control:adopt-finding',
      format: 'json',
      error: new Error('local projection failed'),
      options: malformedOptions,
    })).toThrow("Cannot read properties of undefined (reading 'toLowerCase')")
  })

  it('preserves lease/CAS classification and bounded external matching', () => {
    const casConflict = renderers.createRuntimeErrorRendering({
      command: 'bemoat:mission-control:adopt-finding',
      format: 'text',
      error: Object.assign(new Error('write outcome conflict'), { code: 'CAS_CONFLICT' }),
      options: OPTIONS,
    })
    expect(casConflict).toMatchObject({
      envelope: {
        classification: 'STATE_CONFLICT',
        outcome: 'STOP',
      },
      output: 'STATE_CONFLICT: write outcome conflict\n',
      stream: 'stderr',
      exitCode: 3,
    })

    const shaConflict = renderers.createRuntimeErrorRendering({
      command: 'bemoat:mission-control:adopt-finding',
      format: 'text',
      error: new Error('HTTP 422 response: sha did not match'),
      options: OPTIONS,
    })
    expect(shaConflict.output).toBe('STATE_CONFLICT: HTTP 422 response: sha did not match\n')

    const incidentalGh = renderers.createRuntimeErrorRendering({
      command: 'bemoat:mission-control:adopt-finding',
      format: 'text',
      error: new Error('although the local projection failed'),
      options: OPTIONS,
    })
    expect(incidentalGh).toMatchObject({
      envelope: {
        classification: 'INTERNAL_ERROR',
        outcome: 'ERROR',
      },
      output: 'INTERNAL_ERROR: although the local projection failed\n',
      stream: 'stderr',
      exitCode: 1,
    })
  })
})
