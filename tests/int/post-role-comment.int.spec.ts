import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { CliInvocationError } from '../../scripts/cli/command-invocation.mjs'
import { assertResultEnvelopeV1 } from '../../scripts/cli/command-result.mjs'
import { getCommandContract } from '../../scripts/cli/command-contract.mjs'
import {
  renderResult,
  renderRuntimeError,
} from '../../scripts/mission-control/domain/role-comment-rendering.mjs'

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
const FULL_HEAD = 'ABCDEF0123456789ABCDEF0123456789ABCDEF01'

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

const RESULT_RENDER_INPUT: Parameters<typeof renderResult>[0] = {
  command: 'bemoat:issue:comment',
  format: 'text',
  options: {
    repo: 'acme/repo',
    issue: '123',
  },
  role: 'RESULT',
  legacyClassification: null,
  legacyOutput: [],
  mutationPerformed: false,
  parsedBody: {
    headSha: 'ABCDEF0123456789ABCDEF0123456789ABCDEF01',
    prNumber: '456',
  },
}

function invokeRuntimeResult(input: Record<string, unknown>) {
  return Reflect.apply(renderResult, undefined, [input])
}

function stubGh(options: {
  phantomPost?: boolean
  duplicatePost?: boolean
  olderOnly?: boolean
  delayedReadback?: boolean
  failPost?: boolean
  omitPostedId?: boolean
  untrustedPost?: boolean
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'bemoat-role-comment-bin-'))
  tempPaths.push(directory)
  const capture = join(directory, 'arguments.txt')
  const executable = join(directory, 'gh')
  const postedPath = join(directory, 'posted.json')
  const postCountPath = join(directory, 'post-count.txt')
  const readCountPath = join(directory, 'read-count.txt')
  writeFileSync(executable, `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const capture = process.env.BEMOAT_GH_CAPTURE;
const postedPath = ${JSON.stringify(postedPath)};
const postCountPath = ${JSON.stringify(postCountPath)};
const readCountPath = ${JSON.stringify(readCountPath)};
if (args[0] === 'issue' && args[1] === 'comment') {
  const bodyFile = args[args.indexOf('--body-file') + 1];
  const postCount = Number(fs.existsSync(postCountPath) ? fs.readFileSync(postCountPath, 'utf8') : '0') + 1;
  fs.writeFileSync(postCountPath, String(postCount));
  if (${options.failPost === true ? 'true' : 'false'}) {
    console.error('Simulated comment POST timeout');
    process.exit(1);
  }
  const postedId = ${options.duplicatePost === true || options.olderOnly === true ? '9002' : '9001'};
  const posted = {
    id: postedId,
    body: fs.readFileSync(bodyFile, 'utf8'),
    user: { login: ${options.untrustedPost === true ? "'attacker'" : "'boat1994'"} },
    author_association: ${options.untrustedPost === true ? "'NONE'" : "'OWNER'"},
    created_at: '2026-07-16T12:01:00Z',
  };
  const older = { ...posted, id: 9001, created_at: '2026-07-16T12:00:00Z' };
  if (${options.phantomPost === true ? 'true' : 'false'} === false) {
    const persisted = ${options.duplicatePost === true
      ? '[older, posted]'
      : options.olderOnly === true
        ? '[older]'
        : 'posted'};
    fs.writeFileSync(postedPath, JSON.stringify(persisted));
  }
  if (capture) fs.writeFileSync(capture, args.join('\\n') + '\\n');
  process.stdout.write(${options.omitPostedId === true ? "''" : "'https://github.com/acme/repo/issues/115#issuecomment-' + posted.id + '\\n'"});
  process.exit(0);
}
if (args[0] === 'issue' && args[1] === 'view' && args.includes('comments')) {
  const readCount = Number(fs.existsSync(readCountPath) ? fs.readFileSync(readCountPath, 'utf8') : '0') + 1;
  fs.writeFileSync(readCountPath, String(readCount));
  const stored = fs.existsSync(postedPath) ? JSON.parse(fs.readFileSync(postedPath, 'utf8')) : [];
  const comments = Array.isArray(stored) ? stored : [stored];
  const visibleComments = ${options.delayedReadback === true ? 'readCount <= 4 ? [] : comments' : 'comments'};
  process.stdout.write(JSON.stringify({ comments: visibleComments }));
  process.exit(0);
}
if (capture) fs.writeFileSync(capture, args.join('\\n') + '\\n');
process.exit(0);
`)
  chmodSync(executable, 0o755)
  return { capture, path: `${directory}:${process.env.PATH ?? ''}`, postCountPath }
}

/**
 * Stub `gh` so `issue view --json comments` reconstructs a canonical
 * correction contract from a live REVIEW_VERDICT, without any caller-supplied
 * contract file. `issue comment` posting calls still capture their argv.
 */
function stubGhForCorrection(verdictBody: string) {
  const directory = mkdtempSync(join(tmpdir(), 'bemoat-role-comment-bin-'))
  tempPaths.push(directory)
  const capture = join(directory, 'arguments.txt')
  const executable = join(directory, 'gh')
  const payload = JSON.stringify({
    comments: [{ body: verdictBody, createdAt: '2026-07-16T10:00:00Z' }],
  }).replace(/'/g, `'"'"'`)
  writeFileSync(
    executable,
    `#!/bin/sh
if [ "$1" = "issue" ] && [ "$2" = "view" ]; then
  printf '%s' '${payload}'
  exit 0
fi
printf '%s\\n' "$@" > "$BEMOAT_GH_CAPTURE"
`,
  )
  chmodSync(executable, 0o755)
  return { capture, path: `${directory}:${process.env.PATH ?? ''}` }
}

function initGitFixture() {
  const root = mkdtempSync(join(tmpdir(), 'bemoat-role-comment-repo-'))
  tempPaths.push(root)
  spawnSync('git', ['init', '-q'], { cwd: root })
  spawnSync('git', ['config', 'user.email', 'correction@test'], { cwd: root })
  spawnSync('git', ['config', 'user.name', 'Correction Test'], { cwd: root })
  writeFileSync(join(root, 'seed.txt'), 'seed\n')
  spawnSync('git', ['add', '.'], { cwd: root })
  spawnSync('git', ['commit', '-q', '-m', 'seed'], { cwd: root })
  const reviewedHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim()
  return { root, reviewedHead }
}

function commitChange(root: string, relativePath: string, content: string) {
  const absolute = join(root, relativePath)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, content)
  spawnSync('git', ['add', relativePath], { cwd: root })
  spawnSync('git', ['commit', '-q', '-m', `change ${relativePath}`], { cwd: root })
}

function run(args: string[], options: { input?: string; env?: Record<string, string>; cwd?: string } = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: options.cwd ?? process.cwd(),
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    input: options.input,
  })
}

afterEach(() => {
  for (const path of tempPaths.splice(0)) rmSync(path, { recursive: true, force: true })
  vi.restoreAllMocks()
  process.exitCode = undefined
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

  it('uses the authoritative POST comment identity when identical bodies are duplicated', () => {
    const gh = stubGh({ duplicatePost: true })
    const result = run(['115', '--repo', 'acme/repo', '--json'], {
      input: bodies.RESULT,
      env: { PATH: gh.path, BEMOAT_GH_CAPTURE: gh.capture },
    })

    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      command: 'bemoat:issue:comment',
      outcome: 'SUCCESS',
      classification: 'SUCCESS',
      details: { comment_id: '9002' },
    })
  })

  it('skips the GitHub mutation on an identical retry of the authoritative role comment', () => {
    const gh = stubGh({ duplicatePost: true })
    const env = { PATH: gh.path, BEMOAT_GH_CAPTURE: gh.capture }

    const first = run(['115', '--repo', 'acme/repo', '--json'], {
      input: bodies.RESULT,
      env,
    })
    const retry = run(['115', '--repo', 'acme/repo', '--json'], {
      input: bodies.RESULT,
      env,
    })

    expect(first.status, first.stderr).toBe(0)
    expect(retry.status, retry.stderr).toBe(0)
    expect(Number(readFileSync(gh.postCountPath, 'utf8'))).toBe(1)
    expect(JSON.parse(retry.stdout)).toMatchObject({
      command: 'bemoat:issue:comment',
      outcome: 'NO_OP',
      classification: 'NO_OP_IDENTICAL_RETRY',
      mutation_performed: false,
      details: { comment_id: '9002' },
      next_action: { type: 'COMPLETE' },
    })
  })

  it.each([
    ['HANDOFF', bodies.HANDOFF],
    ['REVIEW_VERDICT', bodies.REVIEW_VERDICT],
  ])('skips an identical %s retry', (_role, body) => {
    const gh = stubGh({ duplicatePost: true })
    const env = { PATH: gh.path, BEMOAT_GH_CAPTURE: gh.capture }

    const first = run(['115', '--repo', 'acme/repo', '--json'], { input: body, env })
    const retry = run(['115', '--repo', 'acme/repo', '--json'], { input: body, env })

    expect(first.status, first.stderr).toBe(0)
    expect(retry.status, retry.stderr).toBe(0)
    expect(Number(readFileSync(gh.postCountPath, 'utf8'))).toBe(1)
    expect(JSON.parse(retry.stdout)).toMatchObject({
      outcome: 'NO_OP',
      classification: 'NO_OP_IDENTICAL_RETRY',
      mutation_performed: false,
      details: { comment_id: '9002' },
      next_action: { type: 'COMPLETE' },
    })
  })

  it('does not deduplicate a materially different role body', () => {
    const gh = stubGh()
    const env = { PATH: gh.path, BEMOAT_GH_CAPTURE: gh.capture }

    const first = run(['115', '--repo', 'acme/repo', '--json'], { input: bodies.RESULT, env })
    const second = run(['115', '--repo', 'acme/repo', '--json'], {
      input: bodies.RESULT.replace('Added the bounded change.', 'Added a different bounded change.'),
      env,
    })

    expect(first.status, first.stderr).toBe(0)
    expect(second.status, second.stderr).toBe(0)
    expect(Number(readFileSync(gh.postCountPath, 'utf8'))).toBe(2)
    expect(JSON.parse(second.stdout)).toMatchObject({
      classification: 'SUCCESS',
      mutation_performed: true,
    })
  })

  it('does not deduplicate a comment bound to a different task issue', () => {
    const gh = stubGh()
    const env = { PATH: gh.path, BEMOAT_GH_CAPTURE: gh.capture }

    const first = run(['115', '--repo', 'acme/repo', '--json'], { input: bodies.RESULT, env })
    const second = run(['115', '--repo', 'acme/repo', '--json'], {
      input: bodies.RESULT.replace('#115', '#116'),
      env,
    })

    expect(first.status, first.stderr).toBe(0)
    expect(second.status, second.stderr).toBe(0)
    expect(Number(readFileSync(gh.postCountPath, 'utf8'))).toBe(2)
    expect(JSON.parse(second.stdout)).toMatchObject({
      classification: 'SUCCESS',
      mutation_performed: true,
    })
  })

  it('does not deduplicate a comment bound to a different exact head', () => {
    const headA = 'abcdef0123456789abcdef0123456789abcdef01'
    const headB = '1234567890abcdef1234567890abcdef12345678'
    const resultA = `${bodies.RESULT}\n**State:** branch \`feature/115\` · base \`main\` · head \`${headA}\`\n**PR:** #292\n`
    const resultB = resultA.replace(headA, headB)
    const gh = stubGh()
    const env = { PATH: gh.path, BEMOAT_GH_CAPTURE: gh.capture }

    const first = run(['115', '--repo', 'acme/repo', '--json'], { input: resultA, env })
    const second = run(['115', '--repo', 'acme/repo', '--json'], { input: resultB, env })

    expect(first.status, first.stderr).toBe(0)
    expect(second.status, second.stderr).toBe(0)
    expect(Number(readFileSync(gh.postCountPath, 'utf8'))).toBe(2)
    expect(JSON.parse(second.stdout)).toMatchObject({
      classification: 'SUCCESS',
      mutation_performed: true,
    })
  })

  it('does not deduplicate a different role type', () => {
    const gh = stubGh()
    const env = { PATH: gh.path, BEMOAT_GH_CAPTURE: gh.capture }

    const first = run(['115', '--repo', 'acme/repo', '--json'], { input: bodies.RESULT, env })
    const second = run(['115', '--repo', 'acme/repo', '--json'], { input: bodies.HANDOFF, env })

    expect(first.status, first.stderr).toBe(0)
    expect(second.status, second.stderr).toBe(0)
    expect(Number(readFileSync(gh.postCountPath, 'utf8'))).toBe(2)
    expect(JSON.parse(second.stdout)).toMatchObject({
      classification: 'SUCCESS',
      mutation_performed: true,
      details: { role: 'HANDOFF' },
    })
  })

  it('does not deduplicate a different REVIEW_VERDICT finding payload', () => {
    const gh = stubGh()
    const env = { PATH: gh.path, BEMOAT_GH_CAPTURE: gh.capture }

    const first = run(['115', '--repo', 'acme/repo', '--json'], {
      input: bodies.REVIEW_VERDICT,
      env,
    })
    const second = run(['115', '--repo', 'acme/repo', '--json'], {
      input: bodies.REVIEW_VERDICT.replace('missing test', 'different finding payload'),
      env,
    })

    expect(first.status, first.stderr).toBe(0)
    expect(second.status, second.stderr).toBe(0)
    expect(Number(readFileSync(gh.postCountPath, 'utf8'))).toBe(2)
    expect(JSON.parse(second.stdout)).toMatchObject({
      classification: 'SUCCESS',
      mutation_performed: true,
    })
  })

  it('does not create a duplicate after an ambiguous delayed readback', () => {
    const gh = stubGh({ delayedReadback: true })
    const env = { PATH: gh.path, BEMOAT_GH_CAPTURE: gh.capture }

    const first = run(['115', '--repo', 'acme/repo', '--json'], { input: bodies.RESULT, env })
    const retry = run(['115', '--repo', 'acme/repo', '--json'], { input: bodies.RESULT, env })

    expect(first.status).toBe(4)
    expect(JSON.parse(first.stdout)).toMatchObject({
      classification: 'AMBIGUOUS_RESULT',
      mutation_performed: true,
    })
    expect(retry.status, retry.stderr).toBe(0)
    expect(Number(readFileSync(gh.postCountPath, 'utf8'))).toBe(1)
    expect(JSON.parse(retry.stdout)).toMatchObject({
      classification: 'NO_OP_IDENTICAL_RETRY',
      mutation_performed: false,
      details: { comment_id: '9001' },
    })
  })

  it('keeps an older identical comment ambiguous when the POST identity is absent from readback', () => {
    const gh = stubGh({ olderOnly: true })
    const result = run(['115', '--repo', 'acme/repo', '--json'], {
      input: bodies.RESULT,
      env: { PATH: gh.path, BEMOAT_GH_CAPTURE: gh.capture },
    })

    expect(result.status).toBe(4)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toMatchObject({
      command: 'bemoat:issue:comment',
      outcome: 'ERROR',
      classification: 'AMBIGUOUS_RESULT',
      mutation_performed: true,
    })
  })

  it('maps a direct POST failure to AMBIGUOUS_RESULT with mutation performed', () => {
    const gh = stubGh({ failPost: true })
    const result = run(['115', '--repo', 'acme/repo', '--json'], {
      input: bodies.RESULT,
      env: { PATH: gh.path, BEMOAT_GH_CAPTURE: gh.capture },
    })

    expect(result.status).toBe(4)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toMatchObject({
      command: 'bemoat:issue:comment',
      outcome: 'ERROR',
      classification: 'AMBIGUOUS_RESULT',
      mutation_performed: true,
    })
  })

  it('rejects a body-only fallback when the new comment is not trusted', () => {
    const gh = stubGh({ omitPostedId: true, untrustedPost: true })
    const result = run(['115', '--repo', 'acme/repo', '--json'], {
      input: bodies.RESULT,
      env: { PATH: gh.path, BEMOAT_GH_CAPTURE: gh.capture },
    })

    expect(result.status).toBe(4)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toMatchObject({
      classification: 'AMBIGUOUS_RESULT',
      mutation_performed: true,
    })
  })

  it('fails closed when a successful POST is not durable in the live comment readback', () => {
    const gh = stubGh({ phantomPost: true })
    const result = run(['115', '--repo', 'acme/repo', '--json'], {
      input: bodies.RESULT,
      env: { PATH: gh.path, BEMOAT_GH_CAPTURE: gh.capture },
    })

    expect(result.status).toBe(4)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toMatchObject({
      command: 'bemoat:issue:comment',
      outcome: 'ERROR',
      classification: 'AMBIGUOUS_RESULT',
      mutation_performed: true,
      next_action: { type: 'STOP', command: null },
    })
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

  it('check mode emits one schema-v1 result envelope without posting', () => {
    const gh = stubGh()
    const result = run(['115', '--check', '--json'], {
      input: bodies.RESULT,
      env: { PATH: gh.path, BEMOAT_GH_CAPTURE: gh.capture },
    })

    expect(result.status, result.stderr).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout.trim().split(/\r?\n/)).toHaveLength(1)

    const envelope = JSON.parse(result.stdout) as Record<string, unknown>
    assertResultEnvelopeV1(envelope)
    expect(envelope).toMatchObject({
      command: 'bemoat:issue:comment',
      mode: 'result',
      outcome: 'SUCCESS',
      classification: 'SUCCESS',
      mutation_performed: false,
      issue_number: '115',
      pr_number: null,
      exact_head: null,
    })
    expect(() => readFileSync(gh.capture, 'utf8')).toThrow()
  })

  it('exposes the exact correction contract representation via help --json', () => {
    const helpResult = run(['--help', '--json'])
    expect(helpResult.status, helpResult.stderr).toBe(0)

    const lines = helpResult.stdout.split('\n')
    const jsonLine = lines.find((line) => line.trim().startsWith('{'))
    const contract = JSON.parse(jsonLine!)

    const correctionSchema = contract.role_contracts.REVIEW_VERDICT.correction_contract
    expect(correctionSchema.placement).toBeDefined()
    expect(correctionSchema.representation).toBe('fenced_json_block')
    expect(correctionSchema.canonical_example).toContain('```json')

    // Construct a REVIEW_VERDICT from the canonical example
    const reviewVerdict = `## REVIEW_VERDICT
### Task log
- Timestamp: 2026-08-07T12:00:00Z
- Task / Issue: #115
- Phase: Reviewer
- Executing role: Reviewer
**Reviewed PR:** https://github.com/acme/repo/pull/12
**Approved base:** main
**Exact head reviewed:** 1234567890abcdef1234567890abcdef12345678
**Verdict:** CORRECTION REQUIRED
### Critical / Important findings summary
- Important: needs fix
### Gate status
- CI: pass
### Next handoff
- Dev
\n${correctionSchema.canonical_example}`

    // Now test that this body passes the public check path
    const checkResult = run(['115', '--check'], { input: reviewVerdict })
    expect(checkResult.status, checkResult.stderr).toBe(0)
  })

  it('exposes the registry stop classifications in public help --json', () => {
    const helpResult = run(['--help', '--json'])
    expect(helpResult.status, helpResult.stderr).toBe(0)

    const jsonLine = helpResult.stdout.split('\n').find((line) => line.trim().startsWith('{'))
    const help = JSON.parse(jsonLine!)
    const contract = getCommandContract('bemoat:issue:comment')

    expect(help.stop_classifications).toEqual(contract.stop_classifications)
    expect(help.stop_classifications).toContain('AMBIGUOUS_RESULT')
  })

  it('shares EVIDENCE_CONFLICT classification and exit between text and JSON check modes', () => {
    const invalidBody = bodies.RESULT.replace('**Summary:** Added the bounded change.\n', '')
    const text = run(['115', '--check'], { input: invalidBody })
    const json = run(['115', '--check', '--json'], { input: invalidBody })

    expect(text.status).toBe(3)
    expect(text.stderr).toContain('EVIDENCE_CONFLICT')
    expect(json.status).toBe(3)
    expect(json.stderr).toBe('')
    expect(JSON.parse(json.stdout)).toMatchObject({
      classification: 'EVIDENCE_CONFLICT',
      outcome: 'ERROR',
    })
  })

  it('extracts the exact head from canonical REVIEW_VERDICT metadata', () => {
    const result = run(['115', '--check', '--json'], {
      input: bodies.REVIEW_VERDICT.replaceAll('abc1234', FULL_HEAD),
    })

    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      classification: 'SUCCESS',
      exact_head: FULL_HEAD.toLowerCase(),
    })
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

  it('rejects BLOCKED FOR FOUNDER DECISION that names Critical/Important findings without a contract', () => {
    const body = `## REVIEW_VERDICT
### Task log
- Timestamp: 2026-08-01T00:20:00+07:00
- Task / Issue: #229
- Phase: Bounded Delta Review 3
- Executing role: Reviewer
**PR / base / head:** PR #230 / main / · \`8b73bdfec3ebdec69588069fa275baf4fd15c333\`
**Verdict:** BLOCKED FOR FOUNDER DECISION
**Findings:** Critical: CRITICAL-2, CRITICAL-3 remain open · Important: IMPORTANT-2 remains unproven
**Gates:** exact-head CI pass
**Next:** Founder Approve or Decline
`
    const result = run(['229', '--check'], { input: body })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('missing correction finding contract')
  })

  it('accepts a pure Founder BLOCKED verdict with no implementation findings and no contract', () => {
    const body = `## REVIEW_VERDICT
### Task log
- Timestamp: 2026-08-01T00:20:00+07:00
- Task / Issue: #229
- Phase: Bounded Delta Review 3
- Executing role: Reviewer
**PR / base / head:** PR #230 / main / · \`8b73bdfec3ebdec69588069fa275baf4fd15c333\`
**Verdict:** BLOCKED FOR FOUNDER DECISION
**Findings:** Critical: None · Important: None
**Gates:** exact-head CI pass
**Next:** Founder Approve or Decline the policy choice
`
    const result = run(['229', '--check'], { input: body })
    expect(result.status, result.stderr).toBe(0)
  })

  it('fails closed when a correction RESULT is posted with no reconstructable canonical contract', () => {
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
    const directory = mkdtempSync(join(tmpdir(), 'bemoat-role-comment-bin-'))
    tempPaths.push(directory)
    const executable = join(directory, 'gh')
    writeFileSync(executable, '#!/bin/sh\necho "no REVIEW_VERDICT reachable" >&2\nexit 1\n')
    chmodSync(executable, 0o755)

    const result = run(['115', '--check'], {
      input: body,
      env: { PATH: `${directory}:${process.env.PATH ?? ''}` },
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/unable to reconstruct the canonical correction contract/i)
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

describe('correction RESULT default-path reconstruction (MC-R1-001)', () => {
  function verdictBodyFor(reviewedHead: string) {
    return `## REVIEW_VERDICT
### Task log
- Timestamp: 2026-07-16T12:00:00+07:00
- Task / Issue: #115
- Phase: Reviewer
- Executing role: Reviewer
**PR / base / head:** https://github.com/acme/repo/pull/12 · \`main\` · \`${reviewedHead}\`
**Verdict:** CORRECTION REQUIRED
**Findings:** Important: two immutable findings
**Gates:** exact-head CI https://example.test/ci → pass
**Next:** Dev posts correction RESULT

\`\`\`json
{
  "schema_version": 1,
  "reviewed_head": "${reviewedHead}",
  "findings": [
    {
      "id": "MC-R1-001",
      "canonical_summary": "missing focused regression coverage",
      "source_thread": "https://github.com/acme/repo/pull/12#discussion_r1",
      "required_evidence": ["focused failing-then-passing test"],
      "expected_areas": ["tests/int"],
      "prohibited_areas": ["src/unrelated"]
    },
    {
      "id": "MC-R1-002",
      "canonical_summary": "second immutable finding",
      "source_thread": "https://github.com/acme/repo/pull/12#discussion_r2",
      "required_evidence": ["second evidence"]
    }
  ]
}
\`\`\`
`
  }

  function resultBodyFor(correctionBase: string, findingResults: Record<string, unknown>) {
    return `## RESULT
### Task log
- Timestamp: 2026-07-16T13:00:00+07:00
- Task / Issue: #115
- Phase: Dev (correction)
- Executing role: Dev / Builder
**Completed:** Correction
**Summary:** Addressed immutable findings with explicit evidence.
**Next:** Delta Reviewer posts REVIEW_VERDICT

\`\`\`json
${JSON.stringify({ schema_version: 1, correction_base: correctionBase, finding_results: findingResults }, null, 2)}
\`\`\`
`
  }

  function fullyResolvedFindings() {
    return {
      'MC-R1-001': {
        changed_files: ['tests/int/example.int.spec.ts'],
        tests: ['pnpm exec vitest run tests/int/example.int.spec.ts'],
        status: 'CLAIMED_RESOLVED',
      },
      'MC-R1-002': {
        changed_files: ['src/lib/fix.ts'],
        tests: ['pnpm exec vitest run tests/int/example.int.spec.ts'],
        status: 'CLAIMED_RESOLVED',
      },
    }
  }

  it('validates successfully by default when the reconstructed contract and actual diff satisfy every finding', () => {
    const { root, reviewedHead } = initGitFixture()
    commitChange(root, 'tests/int/example.int.spec.ts', 'test\n')
    commitChange(root, 'src/lib/fix.ts', 'fix\n')
    const gh = stubGhForCorrection(verdictBodyFor(reviewedHead))

    const result = run(['115', '--check'], {
      cwd: root,
      input: resultBodyFor(reviewedHead, fullyResolvedFindings()),
      env: { PATH: gh.path },
    })

    expect(result.status, result.stderr).toBe(0)
  })

  it('rejects an empty finding_results map without relying on optional caller flags', () => {
    const { root, reviewedHead } = initGitFixture()
    const gh = stubGhForCorrection(verdictBodyFor(reviewedHead))

    const result = run(['115', '--check'], {
      cwd: root,
      input: resultBodyFor(reviewedHead, {}),
      env: { PATH: gh.path },
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/omitted finding id/i)
  })

  it('rejects an unknown finding ID without relying on optional caller flags', () => {
    const { root, reviewedHead } = initGitFixture()
    commitChange(root, 'src/lib/unrelated-feature.ts', 'unrelated\n')
    const gh = stubGhForCorrection(verdictBodyFor(reviewedHead))

    const result = run(['115', '--check'], {
      cwd: root,
      input: resultBodyFor(reviewedHead, {
        'MC-R1-099': {
          changed_files: ['src/lib/unrelated-feature.ts'],
          tests: ['pnpm run check'],
          status: 'CLAIMED_RESOLVED',
        },
      }),
      env: { PATH: gh.path },
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/unknown|omitted|substituted/i)
  })

  it('rejects a renamed finding ID without relying on optional caller flags', () => {
    const { root, reviewedHead } = initGitFixture()
    commitChange(root, 'tests/int/example.int.spec.ts', 'test\n')
    commitChange(root, 'src/lib/fix.ts', 'fix\n')
    const gh = stubGhForCorrection(verdictBodyFor(reviewedHead))

    const findings = fullyResolvedFindings()
    const renamed = { 'MC-R1-001': findings['MC-R1-001'], 'MC-R1-002-renamed': findings['MC-R1-002'] }

    const result = run(['115', '--check'], {
      cwd: root,
      input: resultBodyFor(reviewedHead, renamed),
      env: { PATH: gh.path },
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/unknown|omitted|substituted/i)
  })

  it('rejects an omitted finding ID without relying on optional caller flags', () => {
    const { root, reviewedHead } = initGitFixture()
    commitChange(root, 'tests/int/example.int.spec.ts', 'test\n')
    const gh = stubGhForCorrection(verdictBodyFor(reviewedHead))

    const result = run(['115', '--check'], {
      cwd: root,
      input: resultBodyFor(reviewedHead, {
        'MC-R1-001': fullyResolvedFindings()['MC-R1-001'],
      }),
      env: { PATH: gh.path },
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/omitted finding id/i)
  })

  it('rejects a wrong correction base without relying on optional caller flags', () => {
    const { root, reviewedHead } = initGitFixture()
    commitChange(root, 'tests/int/example.int.spec.ts', 'test\n')
    commitChange(root, 'src/lib/fix.ts', 'fix\n')
    const gh = stubGhForCorrection(verdictBodyFor(reviewedHead))

    const result = run(['115', '--check'], {
      cwd: root,
      input: resultBodyFor('0000000000000000000000000000000000000000', fullyResolvedFindings()),
      env: { PATH: gh.path },
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/correction_base must match reviewed_head/i)
  })

  it('rejects a changed file absent from the actual correction diff without relying on optional caller flags', () => {
    const { root, reviewedHead } = initGitFixture()
    commitChange(root, 'src/lib/fix.ts', 'fix\n')
    const gh = stubGhForCorrection(verdictBodyFor(reviewedHead))

    const result = run(['115', '--check'], {
      cwd: root,
      input: resultBodyFor(reviewedHead, fullyResolvedFindings()),
      env: { PATH: gh.path },
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/absent|not in|diff/i)
  })

  it('rejects prohibited scope present in the actual correction diff without relying on optional caller flags', () => {
    const { root, reviewedHead } = initGitFixture()
    commitChange(root, 'tests/int/example.int.spec.ts', 'test\n')
    commitChange(root, 'src/lib/fix.ts', 'fix\n')
    commitChange(root, 'src/unrelated/reversal.ts', 'unrelated\n')
    const gh = stubGhForCorrection(verdictBodyFor(reviewedHead))

    const result = run(['115', '--check'], {
      cwd: root,
      input: resultBodyFor(reviewedHead, fullyResolvedFindings()),
      env: { PATH: gh.path },
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/prohibited/i)
  })

  it('rejects UNPROVEN correction evidence paired with a free-form Done claim', () => {
    const { root, reviewedHead } = initGitFixture()
    const gh = stubGhForCorrection(verdictBodyFor(reviewedHead))
    const body = resultBodyFor(reviewedHead, {
      'MC-R1-001': { changed_files: [], tests: [], status: 'UNPROVEN' },
      'MC-R1-002': { changed_files: [], tests: [], status: 'UNPROVEN' },
    }).replace('**Next:** Delta Reviewer posts REVIEW_VERDICT', '**AC audit:** Done\n**Next:** Delta Reviewer posts REVIEW_VERDICT')

    const result = run(['115', '--check'], { cwd: root, input: body, env: { PATH: gh.path } })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/UNPROVEN|Done/i)
  })

  it('preserves non-correction posting behavior and never invokes gh for a plain implementation RESULT', () => {
    const { root } = initGitFixture()
    const gh = stubGh()

    const result = run(['115', '--check'], {
      cwd: root,
      input: bodies.RESULT,
      env: { PATH: gh.path, BEMOAT_GH_CAPTURE: gh.capture },
    })

    expect(result.status, result.stderr).toBe(0)
    expect(() => readFileSync(gh.capture, 'utf8')).toThrow()
  })

  it('preserves the parent throw for a missing parsedBody', () => {
    expect(() => invokeRuntimeResult({
      ...RESULT_RENDER_INPUT,
      parsedBody: undefined,
    })).toThrow("Cannot read properties of undefined (reading 'headSha')")
  })

  it('preserves the parent throw for missing options', () => {
    expect(() => invokeRuntimeResult({
      ...RESULT_RENDER_INPUT,
      options: undefined,
    })).toThrow("Cannot read properties of undefined (reading 'repo')")
  })

  it('preserves the parent throw for malformed CliInvocationError details', () => {
    const error = new CliInvocationError('issue_number', 'missing positional input: issue_number')
    Object.defineProperty(error, 'details', { value: undefined })

    expect(() => renderRuntimeError({
      command: RESULT_RENDER_INPUT.command,
      format: 'text',
      error,
    })).toThrow("Cannot read properties of undefined (reading 'argument')")
  })

  it('treats a truthy check value as validation in the legacy text output', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    renderResult({
      ...RESULT_RENDER_INPUT,
      options: {
        ...RESULT_RENDER_INPUT.options,
        check: 'truthy',
      },
    })

    expect(stdout).toHaveBeenCalledWith('SUCCESS: validated RESULT comment for Issue #123\n')
    expect(stderr).not.toHaveBeenCalled()
  })
})
