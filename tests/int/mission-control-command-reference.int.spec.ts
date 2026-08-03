import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Mission Control command reference contract', () => {
  it('documents all canonical transports with exact arguments', () => {
    const mdPath = join(process.cwd(), 'docs/mission-control/command-reference.md')
    const content = existsSync(mdPath) ? readFileSync(mdPath, 'utf8') : ''
    
    expect(content).toContain('pnpm run bemoat:mission-control:dispatch')
    expect(content).toContain('-- <issue-number>')
    expect(content).toContain('[--repo <owner>/<repo>]')
    expect(content).toContain('[--body-file <handoff-file>]')
    expect(content).toContain('[--founder-correction]')
    expect(content).toContain('[--workflow-mode <mode>]')
    expect(content).toContain('[--planning-base-sha <commit-sha>]')

    expect(content).toContain('pnpm run bemoat:mission-control:review')
    expect(content).toContain('--body-file <verdict-file>')
    expect(content).toContain('--expected-state <state>')
    expect(content).toContain('--review-type <full|delta>')
    expect(content).toContain('--expected-head <exact-pr-head-sha>')

    expect(content).toContain('pnpm run bemoat:mission-control:reconcile')

    expect(content).toContain('pnpm run bemoat:mission-control:merge')
    expect(content).toContain('--repo <owner>/<repo>')
    expect(content).toContain('--authorization-comment <role-comment-id>')
  })
})
