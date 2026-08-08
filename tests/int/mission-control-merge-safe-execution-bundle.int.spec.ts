import { describe, expect, it } from 'vitest'

import {
  SAFE_EXECUTION_BUNDLES,
  validateSafeExecutionBundle,
} from '../../scripts/mission-control/domain/merge-safe-execution-bundle.mjs'

describe('validateSafeExecutionBundle', () => {
  it('accepts each canonical safe execution bundle shape', () => {
    expect(validateSafeExecutionBundle({
      kind: 'delivery',
      authority_scope: 'delivery',
      terminal_outcome: 'implementation delivered and awaiting review',
      steps: SAFE_EXECUTION_BUNDLES.delivery,
    })).toEqual({
      valid: true,
      kind: 'delivery',
      authority_scope: 'delivery',
    })
  })

  it('rejects a bundle that crosses the canonical step boundary', () => {
    expect(validateSafeExecutionBundle({
      kind: 'delivery',
      authority_scope: 'delivery',
      terminal_outcome: 'implementation delivered and awaiting review',
      steps: [...SAFE_EXECUTION_BUNDLES.delivery, 'close-task-issue'],
    })).toEqual({
      valid: false,
      reason: 'safe execution bundle steps are prohibited or cross an independent gate; use one canonical bundle shape',
    })
  })
})
