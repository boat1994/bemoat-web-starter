import { describe, expect, it } from 'vitest'

import { validateNextAction } from '../../scripts/mission-control/domain/merge-next-action.mjs'

describe('validateNextAction', () => {
  it('normalizes a valid required slice without starting it', () => {
    expect(validateNextAction({
      action: 'Review slice 5 planning evidence',
      started: false,
      slice: '5',
    }, { requiredSlice: 5 })).toEqual({
      action: 'Review slice 5 planning evidence',
      started: false,
      slice: 5,
    })
  })

  it.each([
    ['missing', null],
    ['array', []],
    ['started', { action: 'Review slice 5', started: true }],
    ['blank', { action: '  ', started: false }],
    ['starts work', { action: 'Start slice 5', started: false }],
    ['wrong slice', { action: 'Review slice 4', started: false, slice: 4 }],
  ])('rejects a %s next action', (_label, nextAction) => {
    expect(() => validateNextAction(nextAction, { requiredSlice: 5 }))
      .toThrow(/STATE_CONFLICT.*next campaign action/)
  })
})
