import { describe, expect, it } from 'vitest'
import { validateArchitectureContract } from '../../scripts/guard-scripts-architecture.mjs'

describe('scripts architecture ratchet', () => {
  it('validates architecture contract (no unallowed cycles or edges, adapter constraints)', () => {
    const violations = validateArchitectureContract(process.cwd())
    expect(violations).toEqual([])
  })
})
