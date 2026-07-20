import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

import { afterEach, describe, expect, it } from 'vitest'

const scriptPath = resolve(process.cwd(), 'scripts/post-role-comment.mjs')
const tempPaths: string[] = []

const bodies = {
  HANDOFF: `## HANDOFF
### Task log
- Timestamp: 2026-07-16T12:00:00+07:00
- Task / Issue: #115
- Phase: Dev
- Executing role: Mission Control
**Target:** Dev
**Objective:** Implement the bounded change.
**Links:** Issue #115
**Next:** Dev posts RESULT
`,
  RESULT: `## RESULT
### Task log
- Timestamp: 2026-07-16T12:00:00+07:00
- Task / Issue: #115
- Phase: Dev
- Executing role: Dev / Builder
**Completed:** Implementation
**Summary:** Added the bounded change.
**Next:** Reviewer posts REVIEW_VERDICT
`,
  REVIEW_VERDICT: `## REVIEW_VERDICT
### Task log
- Timestamp: 2026-07-16T12:00:00+07:00
- Task / Issue: #115
- Phase: Reviewer
- Executing role: Reviewer
**PR / base / head:** https://github.com/acme/repo/pull/12 · \`main\` · \`abc1234\`
**Verdict:** CORRECTION REQUIRED
**Findings:** Critical: None · Important: missing test
**Gates:** exact-head CI https://example.test/ci → fail
**Next:** Mission Control posts HANDOFF

\`\`\`json
{
  "schema_version": 1,
  "reviewed_head": "abc1234",
  "findings": [
    {
      "id": "MC-R1-001",
      "canonical_summary": "missing focused regression coverage",
      "source_thread": "https://github.com/acme/repo/pull/12#discussion_r1",
      "required_evidence": ["focused failing-then-passing test"],
      "expected_areas": ["tests/int"],
      "prohibited_areas": ["src/unrelated"]
    }
  ]
}
\`\`\`
`,
}

const documentedResult = `## RESULT
### Task log
- Timestamp: 2026-07-16T12:00:00+07:00
- Task / Issue: #115
- Phase: Dev
- Executing role: Dev / Builder
**Role / phase completed:** Dev (implementation)
### Summary
- Added validation.
### Files or artifacts changed
- scripts/post-role-comment.mjs
### Commands run
- pnpm exec vitest → pass
### Next handoff
- Reviewer posts REVIEW_VERDICT
`

const documentedReviewVerdict = `## REVIEW_VERDICT
### Task log
- Timestamp: 2026-07-16T12:00:00+07:00
- Task / Issue: #115
- Phase: Reviewer
- Executing role: Reviewer
**Reviewed PR:** https://github.com/acme/repo/pull/12
**Approved base:** main
**Exact head reviewed:** abc1234
**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
### Critical / Important findings summary
- Critical: None
### Gate status
- Exact-head CI: pass
### Next handoff
- Founder review
`

const fastResult = `## RESULT
**Profile:** FAST
**Task:** #119 · \`feature/119-fast\` → \`main\` · head \`abc1234\`
**PR:** https://github.com/acme/repo/pull/119
**Completed:** Added the bounded FAST-path change.
**Evidence:** Local — focused test → pass; GitHub — exact-head CI → pass
**AC audit:** Done
**Risks / escalation:** None
**Next:** Founder review / merge decision
`

const doubleLoopHandoff = `${bodies.HANDOFF}
**Loop gate:** Triggered — no code edits
**Failure class:** UNKNOWN
**Invalidated assumptions:** The timeout change would reveal the root cause.
**Decision:** REVISE_VALIDATION
**Next experiment:** Capture the user-flow assertion without changing product code.
**Material difference:** It tests validation evidence instead of changing another timeout.
**Allowed / prohibited:** Test and documentation only; product code edits prohibited.
**Verify / stop:** Run the focused assertion; stop if the evidence remains ambiguous.
`

function tempFile(name: string, content: string) {
  const directory = mkdtempSync(join(tmpdir(), 'bemoat-role-comment-'))
  tempPaths.push(directory)
  const path = join(directory, name)
  writeFileSync(path, content)
  return path
}

function stubGh() {
  const directory = mkdtempSync(join(tmpdir(), 'bemoat-role-comment-bin-'))
  tempPaths.push(directory)
  const capture = join(directory, 'arguments.txt')
  const executable = join(directory, 'gh')
  writeFileSync(executable, `#!/bin/sh\nprintf '%s\\n' "$@" > "$BEMOAT_GH_CAPTURE"\n`)
  chmodSync(executable, 0o755)
  return { capture, path: `${directory}:${process.env.PATH ?? ''}` }
}

function run(args: string[], options: { input?: string; env?: Record<string, string> } = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    input: options.input,
  })
}

afterEach(() => {
  for (const path of tempPaths.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('bemoat:issue:comment', () => {
  it.each(Object.entries(bodies))('accepts valid %s from stdin in check mode', (_role, body) => {
    const result = run(['115', '--check'], { input: body })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('validated')
  })

  it.each(Object.entries(bodies))('accepts valid %s from a body file', (_role, body) => {
    const result = run(['115', '--body-file', tempFile('body.md', body), '--check'])
    expect(result.status, result.stderr).toBe(0)
  })

  it('accepts the documented RESULT reference form', () => {
    expect(run(['115', '--check'], { input: documentedResult }).status).toBe(0)
  })

  it('accepts the documented REVIEW_VERDICT reference form', () => {
    expect(run(['115', '--check'], { input: documentedReviewVerdict }).status).toBe(0)
  })

  it('accepts the documented FAST RESULT form', () => {
    expect(run(['119', '--check'], { input: fastResult }).status).toBe(0)
  })

  it('accepts a complete conditional Double-Loop HANDOFF', () => {
    expect(run(['121', '--check'], { input: doubleLoopHandoff }).status).toBe(0)
  })

  it('rejects a triggered Double-Loop HANDOFF without a bounded decision', () => {
    const result = run(['121', '--check'], {
      input: doubleLoopHandoff.replace('**Decision:** REVISE_VALIDATION\n', ''),
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Double-Loop Review is missing required field')
  })

  it('rejects UNKNOWN when it authorizes another implementation attempt', () => {
    const result = run(['121', '--check'], {
      input: doubleLoopHandoff.replace('**Decision:** REVISE_VALIDATION', '**Decision:** CONTINUE_IMPLEMENTATION'),
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('UNKNOWN cannot authorize CONTINUE_IMPLEMENTATION')
  })

  it('posts through gh argument vectors and a body file', () => {
    const gh = stubGh()
    const result = run(['115', '--repo', 'acme/repo'], {
      input: bodies.RESULT,
      env: { PATH: gh.path, BEMOAT_GH_CAPTURE: gh.capture },
    })

    expect(result.status, result.stderr).toBe(0)
    expect(readFileSync(gh.capture, 'utf8').split('\n').filter(Boolean)).toEqual([
      'issue',
      'comment',
      '115',
      '--repo',
      'acme/repo',
      '--body-file',
      expect.stringMatching(/(?:^\/tmp\/|\/T\/bemoat-role-comment-)/),
    ])
  })

  it('never invokes gh in check mode', () => {
    const gh = stubGh()
    const result = run(['115', '--check'], {
      input: bodies.RESULT,
      env: { PATH: gh.path, BEMOAT_GH_CAPTURE: gh.capture },
    })
    expect(result.status, result.stderr).toBe(0)
    expect(() => readFileSync(gh.capture, 'utf8')).toThrow()
  })

  it.each([
    ['literal escaped newline', `${bodies.RESULT}literal\\nnewline`],
    ['shell substitution', `${bodies.RESULT}\n$(whoami)`],
    ['duplicate heading', `${bodies.RESULT}\n## RESULT`],
    ['wrong role heading', `${bodies.RESULT}\n## HANDOFF`],
    ['transcript payload', `${bodies.RESULT}\n$ pnpm run check\nPASS all tests`],
    ['missing operational field', bodies.RESULT.replace('**Summary:** Added the bounded change.\n', '')],
    ['empty operational field', bodies.RESULT.replace('**Summary:** Added the bounded change.', '**Summary:**')],
    ['shell-style transcript', `${bodies.RESULT}\n> pnpm run check`],
    ['command-labelled transcript', `${bodies.RESULT}\nCommand: pnpm run check`],
    ['indented log transcript', `${bodies.RESULT}\n    PASS scripts/post-role-comment`],
  ])('rejects %s', (_name, body) => {
    const result = run(['115', '--check'], { input: body })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('ERROR')
  })

  it('rejects an invalid Core review verdict', () => {
    const result = run(['115', '--check'], {
      input: bodies.REVIEW_VERDICT.replace('CORRECTION REQUIRED', 'APPROVED'),
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Verdict')
  })

  it('rejects CORRECTION REQUIRED without an immutable finding contract', () => {
    const result = run(['115', '--check'], {
      input: bodies.REVIEW_VERDICT.replace(/```json[\s\S]*```/, ''),
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('missing correction finding contract')
  })

  it('rejects correction RESULT evidence maps that omit finding IDs', () => {
    const body = `## RESULT
### Task log
- Timestamp: 2026-07-16T12:00:00+07:00
- Task / Issue: #115
- Phase: Dev (correction)
- Executing role: Dev / Builder
**Completed:** Correction
**Summary:** Partial map only.
**Next:** Delta Reviewer posts REVIEW_VERDICT

\`\`\`json
{
  "schema_version": 1,
  "correction_base": "abc1234",
  "finding_results": {
    "MC-R1-001": {
      "changed_files": ["tests/int/example.int.spec.ts"],
      "tests": ["pnpm exec vitest run tests/int/example.int.spec.ts"],
      "status": "CLAIMED_RESOLVED"
    }
  }
}
\`\`\`
`
    const contractFile = tempFile(
      'canonical.json',
      JSON.stringify({
        schema_version: 1,
        reviewed_head: 'abc1234',
        findings: [
          {
            id: 'MC-R1-001',
            canonical_summary: 'missing focused regression coverage',
            source_thread: 'https://github.com/acme/repo/pull/12#discussion_r1',
            required_evidence: ['focused failing-then-passing test'],
          },
          {
            id: 'MC-R1-002',
            canonical_summary: 'second immutable finding',
            source_thread: 'https://github.com/acme/repo/pull/12#discussion_r2',
            required_evidence: ['second evidence'],
          },
        ],
      }),
    )
    const result = run(
      ['115', '--check', '--canonical-contract-file', contractFile, '--diff-file', 'tests/int/example.int.spec.ts'],
      { input: body },
    )
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/omitted finding id/i)
  })

  it('rejects UNPROVEN correction evidence paired with a free-form Done claim', () => {
    const body = `## RESULT
### Task log
- Timestamp: 2026-07-16T12:00:00+07:00
- Task / Issue: #115
- Phase: Dev (correction)
- Executing role: Dev / Builder
**Completed:** Correction
**Summary:** Partial correction.
**AC audit:** Done
**Next:** Delta Reviewer posts REVIEW_VERDICT

\`\`\`json
{
  "schema_version": 1,
  "correction_base": "abc1234",
  "finding_results": {
    "MC-R1-001": {
      "changed_files": [],
      "tests": [],
      "status": "UNPROVEN"
    }
  }
}
\`\`\`
`
    const result = run(['115', '--check'], { input: body })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/UNPROVEN|Done/i)
  })

  it('requires acknowledgement only for a length warning', () => {
    const long = `${bodies.RESULT}\n${'x'.repeat(6_100)}`
    const warning = run(['115', '--check'], { input: long })
    expect(warning.status).not.toBe(0)
    expect(warning.stderr).toContain('WARNING')
    const acknowledged = run(['115', '--check', '--allow-warning'], { input: long })
    expect(acknowledged.status, acknowledged.stderr).toBe(0)
  })

  it('requires one issue target and exactly one input source', () => {
    expect(run(['--check'], { input: bodies.RESULT }).status).not.toBe(0)
    expect(run(['115', '--repo', 'acme/one', '--repo', 'acme/two', '--check'], { input: bodies.RESULT }).status).not.toBe(0)
    expect(run(['115', '--body-file', tempFile('one.md', bodies.RESULT), '--body-file', tempFile('two.md', bodies.RESULT), '--check']).status).not.toBe(0)
    expect(run(['115', '--body-file', tempFile('body.md', bodies.RESULT), '--check'], { input: bodies.RESULT }).status).not.toBe(0)
    expect(run(['115', '--body-file', tempFile('body.md', bodies.RESULT), '--check'], { input: '   ' }).status).not.toBe(0)
  })
})
