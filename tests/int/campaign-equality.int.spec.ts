import { describe, expect, it } from 'vitest'

import {
  sameCampaignValue,
  verifyCampaignPostcondition,
} from '../../scripts/mission-control/domain/campaign-equality.ts'

describe('campaign equality characterization', () => {
  it('preserves Object.is primitives, recursive objects, and array order', () => {
    expect(sameCampaignValue(NaN, NaN)).toBe(true)
    expect(sameCampaignValue(0, -0)).toBe(false)
    expect(sameCampaignValue(null, null)).toBe(true)
    expect(sameCampaignValue({ b: [1, { x: true }], a: 'same' }, { a: 'same', b: [1, { x: true }] })).toBe(true)
    expect(sameCampaignValue([1, 2], [2, 1])).toBe(false)
    expect(sameCampaignValue({ a: 1 }, { a: 1, b: undefined })).toBe(false)
    expect(sameCampaignValue('1', 1)).toBe(false)
  })

  it('preserves postcondition field selection and mismatch errors', () => {
    expect(verifyCampaignPostcondition(
      { lifecycle: 'ACTIVE', next_action: { slice: 5 } },
      { lifecycle: 'ACTIVE', next_action: { slice: 5 }, ignored: true },
    )).toBeUndefined()
    expect(() => verifyCampaignPostcondition(
      { lifecycle: 'ACTIVE' },
      { lifecycle: 'BLOCKED' },
    )).toThrow('campaign postcondition mismatch on lifecycle')
  })
})
