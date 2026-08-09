import { describe, expect, it } from 'vitest'

import { CliInvocationError } from '../../scripts/cli/command-invocation.mjs'
import {
  renderMergeError,
  renderMergeSuccess,
} from '../../scripts/mission-control/domain/merge-cli-result-rendering.mjs'

describe('Mission Control merge CLI result rendering', () => {
  it.each(['DONE', 'NO_OP'])('renders the %s terminal success exactly', (outcome) => {
    expect(renderMergeSuccess({
      outcome,
      prNumber: 335,
      reviewedHead: '739cba86c2a14f7a3ee66324772ce95fa9520e78',
      mergeCommit: 'merge-commit',
      issueNumber: 328,
    })).toBe(
      `Mission Control merge transport ${outcome}: PR #335 at 739cba86c2a14f7a3ee66324772ce95fa9520e78 -> merge-commit; Issue #328 DONE.\n`,
    )
  })

  it('renders CliInvocationError with its classification and message', () => {
    const rendering = renderMergeError(new CliInvocationError('issue_number', 'missing positional input: issue_number'))

    expect(rendering).toEqual({
      output: 'ERROR: [INVALID_INVOCATION] missing positional input: issue_number\n',
      stream: 'stderr',
      exitCode: 1,
    })
  })

  it.each([
    'STATE_CONFLICT: concurrent Issue write detected',
    'BLOCKED_EXTERNAL: GitHub response was unavailable',
    'AUTHORIZATION_VALIDATION_FAILURE: Founder authorization is invalid',
    'Usage: pnpm run bemoat:mission-control:merge -- <issue-number>',
  ])('renders generic errors as plain error text: %s', (message) => {
    expect(renderMergeError(new Error(message))).toEqual({
      output: `ERROR: ${message}\n`,
      stream: 'stderr',
      exitCode: 1,
    })
  })

  it('renders non-Error failures using String(error)', () => {
    expect(renderMergeError('unexpected failure')).toEqual({
      output: 'ERROR: unexpected failure\n',
      stream: 'stderr',
      exitCode: 1,
    })
  })
})
