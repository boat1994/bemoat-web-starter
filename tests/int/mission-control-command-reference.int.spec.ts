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
          return content.replace('### Review checks', '')
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

  it('documents that retired REVIEW_VERDICT publishing has no public writer', () => {
    const md = readFileSync('docs/mission-control/command-reference.md', 'utf8')
    expect(md).toContain('The managed review writer and custom managed/STANDARD merge wrappers are\nretired.')
    expect(md).toContain('No public command\npublishes managed `REVIEW_VERDICT` state')
  })

  it('keeps retired REVIEW_VERDICT publishing out of the command reference', () => {
    const md = readFileSync('docs/mission-control/command-reference.md', 'utf8')
    expect(md).not.toMatch(/```markdown\n## REVIEW_VERDICT[\s\S]*?```/)
  })
})
