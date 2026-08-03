import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { runMissionControlContractGuard } from '../../scripts/guards/mission-control-contract/runner.mjs'

describe('Mission Control command reference contract', () => {
  it('proves the production guard invokes the command-reference scanner and catches missing content', () => {
    // Instead of faking everything, let's just use a custom readFile that strips the invariants from the real file
    const violations = runMissionControlContractGuard({
      readFile: (filePath) => {
        const content = readFileSync(filePath, 'utf8')
        if (filePath.endsWith('command-reference.md')) {
          return content.replace('Dispatch does not own `AWAITING_REVIEW_1` transitions.', '')
        }
        return content
      }
    })
    
    const missingInvariantViolations = violations.filter(v => v.rule === 'MC028')
    expect(missingInvariantViolations.length).toBeGreaterThan(0)
    expect(missingInvariantViolations[0].message).toContain('Command reference missing semantic invariant')
  })

  it('proves each command and key flag remains documented via scanner checks', () => {
    const violations = runMissionControlContractGuard()
    
    // With unmodified files, there should be no MC021-MC024 violations
    const missingArgViolations = violations.filter(v => ['MC021', 'MC022', 'MC023', 'MC024'].includes(v.rule))
    expect(missingArgViolations).toHaveLength(0)
  })

  it('proves semantic invariants are correctly represented in the document', () => {
    const violations = runMissionControlContractGuard()
    
    // With unmodified files, there should be no MC028 violations
    const missingInvariantViolations = violations.filter(v => v.rule === 'MC028')
    expect(missingInvariantViolations).toHaveLength(0)
  })
})
