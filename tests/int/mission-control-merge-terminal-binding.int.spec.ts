import { describe, expect, it } from 'vitest'

import { sameTerminalBinding } from '../../scripts/mission-control/domain/merge-terminal-binding.mjs'

describe('sameTerminalBinding', () => {
  const binding = {
    state: 'IN_PROGRESS',
    active_task_issue: 328,
    active_pr: 332,
    current_head: 'f058678f6854a458776f8ce42e15a2c2929d17f0',
    last_reviewed_head: 'f058678f6854a458776f8ce42e15a2c2929d17f0',
  }

  it('accepts matching terminal bindings', () => {
    expect(sameTerminalBinding(binding, { ...binding })).toBe(true)
  })

  it('rejects changes to any terminal binding field', () => {
    for (const key of ['state', 'active_task_issue', 'active_pr', 'current_head', 'last_reviewed_head']) {
      expect(sameTerminalBinding(binding, { ...binding, [key]: 'changed' })).toBe(false)
    }
  })

  it('ignores unrelated state metadata', () => {
    expect(sameTerminalBinding(binding, { ...binding, updated_at: 'later', open_blockers: ['notice'] })).toBe(true)
  })
})
