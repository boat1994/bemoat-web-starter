import { describe, expect, it } from 'vitest'

const recoveryModulePromise = import('../../scripts/mission-control/domain/review-recovery.ts')

describe('MC-R2-003: Malformed findings parity', () => {
  it('throws TypeError instead of normalizing to [] when findings is malformed (e.g. an object)', async () => {
    const { buildRecoveryRecord } = await recoveryModulePromise
    
    expect(() => {
      buildRecoveryRecord({
        findings: { malformed: true }
      })
    }).toThrow(TypeError)
  })
})
