import { describe, expect, it } from 'vitest'

import { validateDirectOwnership } from '../../scripts/mission-control/domain/merge-direct-ownership.mjs'

describe('validateDirectOwnership', () => {
  const issue = {
    managedState: {
      active_task_issue: '#222',
      active_pr: '#223',
    },
  }
  const pr = { number: 223 }

  it('accepts the directly managed task and PR', () => {
    expect(validateDirectOwnership({ issueNumber: 222, issue, pr })).toEqual({
      valid: true,
      prNumber: 223,
      reason: null,
    })
  })

  it.each([
    ['missing managed state', 222, {}, pr, 'managed Issue state is unavailable'],
    ['a different managed task', 222, { managedState: { ...issue.managedState, active_task_issue: 221 } }, pr, 'merge transport may operate only on the directly managed task Issue'],
    ['no active PR', 222, { managedState: { ...issue.managedState, active_pr: null } }, pr, 'directly managed task has no active PR terminal ownership'],
    ['a different live PR', 222, issue, { number: 224 }, 'live PR does not match the managed task active PR'],
  ])('rejects %s without throwing', (_label, issueNumber, candidateIssue, candidatePr, reason) => {
    expect(validateDirectOwnership({
      issueNumber,
      issue: candidateIssue,
      pr: candidatePr,
    })).toEqual({
      valid: false,
      prNumber: null,
      reason,
    })
  })

  it('allows validation before a live PR number is available', () => {
    expect(validateDirectOwnership({ issueNumber: 222, issue, pr: {} })).toEqual({
      valid: true,
      prNumber: 223,
      reason: null,
    })
  })
})
