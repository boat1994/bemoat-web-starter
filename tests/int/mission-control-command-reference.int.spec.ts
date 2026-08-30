import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
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

  it('proves the canonical REVIEW_VERDICT example passes the real post-role-comment validation/check path', () => {
    const md = readFileSync('docs/mission-control/command-reference.md', 'utf8')
    const match = md.match(/```markdown\n(## REVIEW_VERDICT[\s\S]*?)```/)
    expect(match).not.toBeNull()
    if (!match?.[1]) {
      throw new Error('expected REVIEW_VERDICT markdown fence in command-reference.md')
    }

    writeFileSync('.tmp-test-verdict.md', match[1])
    const result = spawnSync('node', ['scripts/post-role-comment.mjs', '--', '123', '--body-file', '.tmp-test-verdict.md', '--check'], { encoding: 'utf8' })
    unlinkSync('.tmp-test-verdict.md')
    expect(result.status).toBe(0)
  })

  it('proves removal or corruption of required fields fails', () => {
    const md = readFileSync('docs/mission-control/command-reference.md', 'utf8')
    const match = md.match(/```markdown\n(## REVIEW_VERDICT[\s\S]*?)```/)
    expect(match).not.toBeNull()
    if (!match?.[1]) {
      throw new Error('expected REVIEW_VERDICT markdown fence in command-reference.md')
    }
    writeFileSync('.tmp-test-verdict-fail.md', match[1].replace('**Verdict:** ELIGIBLE FOR FOUNDER REVIEW', ''))
    const result = spawnSync('node', ['scripts/post-role-comment.mjs', '--', '123', '--body-file', '.tmp-test-verdict-fail.md', '--check'], { encoding: 'utf8' })
    unlinkSync('.tmp-test-verdict-fail.md')
    expect(result.status).toBe(3)
    expect(result.stderr).toContain('EVIDENCE_CONFLICT')
  })
})
