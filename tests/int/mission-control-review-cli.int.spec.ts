import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { assertResultEnvelopeV1 } from '../../scripts/cli/command-result.mjs'
import {
  Coordinator,
  normalizeTransitionIdentity,
  serializeTransitionIdentity,
} from '../../scripts/mission-control-reconcile.mjs'

const scriptPath = resolve(process.cwd(), 'scripts/mission-control-review.mjs')
const tempPaths: string[] = []

function tempFile(name: string, content: string) {
  const directory = mkdtempSync(join(tmpdir(), 'bemoat-review-test-'))
  tempPaths.push(directory)
  const path = join(directory, name)
  writeFileSync(path, content)
  return path
}

function run(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: 'utf8',
  })
}

afterEach(() => {
  for (const path of tempPaths.splice(0)) rmSync(path, { recursive: true, force: true })
})

function createGhMock(config: Record<string, unknown>) {
  const directory = mkdtempSync(join(tmpdir(), 'bemoat-review-bin-'))
  tempPaths.push(directory)
  const configPath = join(directory, 'config.json')
  const callsFile = join(directory, 'calls.log')
  writeFileSync(configPath, JSON.stringify(config))
  writeFileSync(callsFile, '')

  const executable = join(directory, 'gh')
  const script = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync('${configPath}', 'utf8'));
fs.appendFileSync('${callsFile}', 'gh ' + args.join(' ') + '\\n');

if (args[0] === 'repo' && args[1] === 'view') {
  console.log(JSON.stringify({ nameWithOwner: config.repo || 'acme/repo' }));
  process.exit(0);
}

if (args[0] === 'pr' && args[1] === 'view') {
  console.log(JSON.stringify({
    number: config.prNumber || 123,
    headRefOid: config.prHead || 'ABCDEF0123456789ABCDEF0123456789ABCDEF01',
    baseRefName: config.prBase || 'main',
    statusCheckRollup: config.statusCheckRollup || [
      { status: 'COMPLETED', conclusion: 'SUCCESS', name: 'ci' },
      { status: 'COMPLETED', conclusion: 'SUCCESS', name: 'starter-ci' }
    ]
  }));
  process.exit(0);
}

if (args[0] === 'issue' && args[1] === 'view') {
  let issueBody = config.issueBody;
  if (config.concurrentBodyMutation) {
    const invocations = config._issueViewInvocations || 0;
    if (invocations === 1) {
      issueBody = issueBody.replace(/state: .*/, 'state: BLOCKED_FOR_FOUNDER_DECISION');
    }
    config._issueViewInvocations = invocations + 1;
    fs.writeFileSync('${configPath}', JSON.stringify(config));
  }
  console.log(JSON.stringify({ body: issueBody }));
  process.exit(0);
}

if (args[0] === 'api') {
  const methodIndex = args.indexOf('--method');
  const method = methodIndex !== -1 ? args[methodIndex + 1] : 'GET';
  const methodPostIndex = args.indexOf('-X');
  const methodPut = methodPostIndex !== -1 && args[methodPostIndex + 1] === 'PUT';
  const endpoint = args.find(a => a.startsWith('repos/'));

  if (endpoint && endpoint.includes('/issues/') && endpoint.includes('/comments')) {
    if (method === 'POST') {
      if (config.simulateProjectionFailure) {
        const payloadFile = args[args.indexOf('--input') + 1];
        const posted = {
          id: 9999,
          body: JSON.parse(fs.readFileSync(payloadFile, 'utf8')).body,
          user: { login: 'boat1994' },
          author_association: 'OWNER',
        };
        if (!config.phantomPost) {
          config.comments = [...(config.comments || []), posted];
          fs.writeFileSync('${configPath}', JSON.stringify(config));
        }
        console.log(JSON.stringify(posted));
        process.exit(0);
      }
      const payloadFile = args[args.indexOf('--input') + 1];
      const posted = {
        id: 9001,
        body: JSON.parse(fs.readFileSync(payloadFile, 'utf8')).body,
        user: { login: 'boat1994' },
        author_association: 'OWNER',
      };
      if (!config.phantomPost) {
        config.comments = [...(config.comments || []), posted];
        fs.writeFileSync('${configPath}', JSON.stringify(config));
      }
      console.log(JSON.stringify(posted));
      process.exit(0);
    } else {
      const comments = config.comments || [];
      const commentReads = config._commentReads || 0;
      config._commentReads = commentReads + 1;
      fs.writeFileSync('${configPath}', JSON.stringify(config));
      const readback = config.finalCommentReadbackFailure && commentReads >= 2
        ? comments.map(comment => ({ ...comment, body: comment.body + '\\nTampered after projection' }))
        : comments;
      console.log(JSON.stringify(readback));
      process.exit(0);
    }
  }

  if (endpoint && endpoint.includes('/contents/.bemoat/mission-control/leases')) {
    if (methodPut) {
      if (config.failCas) {
        console.error('CAS_CONFLICT');
        process.exit(1);
      }
      console.log(JSON.stringify({ content: { sha: 'new-sha' } }));
      process.exit(0);
    } else {
      if (config.noLease) {
        console.error('404 Not Found');
        process.exit(1);
      }
      console.log(JSON.stringify({
        sha: 'old-sha',
        content: Buffer.from(JSON.stringify({
          transition_identity: config.leaseIdentity || 'identity',
          observed_body_sha256: config.leaseHash || require('crypto').createHash('sha256').update(config.issueBody, 'utf8').digest('hex'),
          status: 'held'
        })).toString('base64')
      }));
      process.exit(0);
    }
  }

  if (endpoint && endpoint.includes('/git/ref/')) {
    console.log(JSON.stringify({ object: { sha: 'branch-sha' } }));
    process.exit(0);
  }

  if (endpoint === 'repos/' + (config.repo || 'acme/repo')) {
    console.log(JSON.stringify({ default_branch: 'main' }));
    process.exit(0);
  }
}

if (args[0] === 'issue' && args[1] === 'edit') {
  if (!config.simulateProjectionFailure) {
    const bodyFile = args[args.indexOf('--body-file') + 1];
    config.issueBody = fs.readFileSync(bodyFile, 'utf8');
    fs.writeFileSync('${configPath}', JSON.stringify(config));
  }
  process.exit(0);
}

console.error('Unhandled gh mock call: ' + args.join(' '));
process.exit(1);
`
  writeFileSync(executable, script)
  chmodSync(executable, 0o755)
  return { path: `${directory}:${process.env.PATH ?? ''}`, configPath, callsFile }
}

const FULL_HEAD = 'ABCDEF0123456789ABCDEF0123456789ABCDEF01'

describe('scripts/mission-control-review.mjs CLI characterization', () => {
  const validVerdict = `## REVIEW_VERDICT
### Task log
- Timestamp: 2026-08-01T00:20:00+07:00
- Task / Issue: #229
- Phase: Bounded Delta Review 3
- Executing role: Reviewer
**PR / base / head:** PR #230 · \`main\` · \`${FULL_HEAD}\`
**Verdict:** BLOCKED FOR FOUNDER DECISION
**Findings:** Critical: None · Important: None
**Gates:** exact-head CI pass
**Next:** Founder Approve or Decline
`

  const validState = `<!-- bemoat-mission-control-state:start -->
\`\`\`yaml
schema_version: 1
state: AWAITING_REVIEW_3
review_cycle: 2
full_review_count: 1
approved_base: main
active_task_issue: "#229"
active_pr: "#230"
current_head: ABCDEF0123456789ABCDEF0123456789ABCDEF01
last_reviewed_head: ABCDEF0123456789ABCDEF0123456789ABCDEF01
guide_version: 1.2.0
guide_source_ref: main
guide_source_sha: 42b383a8bca33518116763af8094e6a42212bf0b
open_blockers: []
follow_up_issues: []
next_permitted_action: "test"
material_change_status: none
updated_at: "2026-07-23T17:00:00Z"
updated_by: "Mission Control"
\`\`\`
<!-- bemoat-mission-control-state:end -->`

  it('case 1: invalid canonical REVIEW_VERDICT identity', () => {
    const bodyFile = tempFile('verdict.md', validVerdict.replace('## REVIEW_VERDICT', '## WRONG_ROLE'))
    const gh = createGhMock({ issueBody: validState, repo: 'acme/repo', prNumber: 230, prHead: FULL_HEAD })
    const res = run(['229', '--body-file', bodyFile, '--expected-state', 'AWAITING_REVIEW_3', '--review-type', 'delta', '--expected-head', FULL_HEAD], { PATH: gh.path })
    expect(res.status).not.toBe(0)
    expect(res.stderr).toMatch(/body must contain exactly one recognized role heading/i)
  })

  it('maps a delegated canonical evidence failure instead of treating it as internal', () => {
    const bodyFile = tempFile('verdict.md', validVerdict.replace('**Findings:** Critical: None · Important: None\n', ''))
    const gh = createGhMock({ issueBody: validState, repo: 'acme/repo', prNumber: 230, prHead: FULL_HEAD })
    const res = run(['229', '--body-file', bodyFile, '--expected-state', 'AWAITING_REVIEW_3', '--review-type', 'delta', '--expected-head', FULL_HEAD], { PATH: gh.path })

    expect(res.status).toBe(3)
    expect(res.stderr).toContain('EVIDENCE_CONFLICT')
    expect(res.stderr).not.toContain('INTERNAL_ERROR')
    expect(readFileSync(gh.callsFile, 'utf8')).toBe('')
  })

  it('case 2: reviewed-head mismatch', () => {
    const bodyFile = tempFile('verdict.md', validVerdict)
    const gh = createGhMock({ issueBody: validState, repo: 'acme/repo', prNumber: 230, prHead: 'def5678' })
    const res = run(['229', '--body-file', bodyFile, '--expected-state', 'AWAITING_REVIEW_3', '--review-type', 'delta', '--expected-head', FULL_HEAD], { PATH: gh.path })
    expect(res.status).not.toBe(0)
    expect(res.stderr).toMatch(/STATE_CONFLICT: live PR head differs from reviewed head/i)
  })

  it('rejects canonical REVIEW_VERDICT base drift before posting', () => {
    const bodyFile = tempFile('verdict.md', validVerdict)
    const gh = createGhMock({
      issueBody: validState.replace('approved_base: main', 'approved_base: dev'),
      repo: 'acme/repo',
      prNumber: 230,
      prHead: FULL_HEAD,
      prBase: 'dev',
    })
    const res = run([
      '229',
      '--body-file',
      bodyFile,
      '--expected-state',
      'AWAITING_REVIEW_3',
      '--review-type',
      'delta',
      '--expected-head',
      FULL_HEAD,
    ], { PATH: gh.path })

    expect(res.status).toBe(3)
    expect(res.stderr).toMatch(/STATE_CONFLICT: REVIEW_VERDICT base differs from live PR base/i)
    expect(readFileSync(gh.callsFile, 'utf8')).not.toMatch(/--method POST/)
  })

  it('case 3: exact-head CI failure', () => {
    const bodyFile = tempFile('verdict.md', validVerdict)
    const gh = createGhMock({ issueBody: validState, repo: 'acme/repo', prNumber: 230, prHead: FULL_HEAD, statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE', name: 'ci' }] })
    const res = run(['229', '--body-file', bodyFile, '--expected-state', 'AWAITING_REVIEW_3', '--review-type', 'delta', '--expected-head', FULL_HEAD], { PATH: gh.path })
    expect(res.status).not.toBe(0)
    expect(res.stderr).toMatch(/STATE_CONFLICT: exact-head CI is not verified/i)
  })

  it('case 4: stale managed state / expected-state mismatch', () => {
    const bodyFile = tempFile('verdict.md', validVerdict)
    const gh = createGhMock({ issueBody: validState, repo: 'acme/repo', prNumber: 230, prHead: FULL_HEAD })
    const res = run(['229', '--body-file', bodyFile, '--expected-state', 'AWAITING_REVIEW_1', '--review-type', 'delta', '--expected-head', FULL_HEAD], { PATH: gh.path })
    expect(res.status).not.toBe(0)
    expect(res.stderr).toMatch(/UNSUPPORTED_PRE_STATE: expected AWAITING_REVIEW_1, received AWAITING_REVIEW_3/i)
  })

  it('case 5: concurrent Issue-body mutation before CAS write', () => {
    const bodyFile = tempFile('verdict.md', validVerdict)
    const gh = createGhMock({ issueBody: validState.replace('17:00:00Z', '18:00:00Z'), repo: 'acme/repo', prNumber: 230, prHead: FULL_HEAD, concurrentBodyMutation: true, noLease: true })
    const res = run(['229', '--body-file', bodyFile, '--expected-state', 'AWAITING_REVIEW_3', '--review-type', 'delta', '--expected-head', FULL_HEAD], { PATH: gh.path })
    expect(res.status).not.toBe(0)
    expect(res.stderr).toMatch(/STATE_CONFLICT: concurrent Issue body change detected/i)
  })

  it('case 6: comment posted but projection failed (RECOVERABLE_ROUTING_DRIFT)', () => {
    const bodyFile = tempFile('verdict.md', validVerdict)
    const gh = createGhMock({ issueBody: validState, repo: 'acme/repo', prNumber: 230, prHead: FULL_HEAD, simulateProjectionFailure: true, noLease: true })
    const res = run(['229', '--body-file', bodyFile, '--expected-state', 'AWAITING_REVIEW_3', '--review-type', 'delta', '--expected-head', FULL_HEAD], { PATH: gh.path })
    expect(res.status).not.toBe(0)
    expect(res.stderr).toMatch(/RECOVERABLE_ROUTING_DRIFT/i)
  })

  it('delivery and review preserve last validation before first write', () => {
    const bodyFile = tempFile('verdict.md', validVerdict)
    const gh = createGhMock({
      issueBody: validState,
      repo: 'acme/repo',
      prNumber: 230,
      prHead: FULL_HEAD,
      noLease: true,
    })
    const res = run([
      '229',
      '--body-file',
      bodyFile,
      '--expected-state',
      'AWAITING_REVIEW_3',
      '--review-type',
      'delta',
      '--expected-head',
      FULL_HEAD,
    ], { PATH: gh.path })
    expect(res.status, res.stderr).toBe(0)

    const calls = readFileSync(gh.callsFile, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    const firstWrite = calls.findIndex((call) =>
      /^gh api --method POST /.test(call) ||
      /^gh api -X PUT /.test(call) ||
      /^gh issue edit /.test(call),
    )
    const lastIssueRead = calls.reduce(
      (last, call, index) => index < firstWrite && /^gh issue view /.test(call) ? index : last,
      -1,
    )
    const lastPullRequestRead = calls.reduce(
      (last, call, index) => index < firstWrite && /^gh pr view /.test(call) ? index : last,
      -1,
    )
    const lastCommentRead = calls.reduce(
      (last, call, index) => index < firstWrite && /^gh api --paginate .*issues\/229\/comments/.test(call) ? index : last,
      -1,
    )

    expect(firstWrite).toBeGreaterThan(-1)
    expect(lastIssueRead).toBeGreaterThanOrEqual(0)
    expect(lastPullRequestRead).toBeGreaterThan(lastIssueRead)
    expect(lastCommentRead).toBeGreaterThan(lastPullRequestRead)
    expect(lastCommentRead).toBeLessThan(firstWrite)
  })

  it('partial comment-state drift is AMBIGUOUS_RESULT', () => {
    const fullHead = FULL_HEAD
    const body = validVerdict.replaceAll(FULL_HEAD, fullHead)
    const state = validState.replaceAll(FULL_HEAD, fullHead)
    const bodyFile = tempFile('verdict.md', body)
    const gh = createGhMock({
      issueBody: state,
      repo: 'acme/repo',
      prNumber: 230,
      prHead: fullHead,
      simulateProjectionFailure: true,
      noLease: true,
    })
    const res = run([
      '229',
      '--body-file',
      bodyFile,
      '--expected-state',
      'AWAITING_REVIEW_3',
      '--review-type',
      'delta',
      '--expected-head',
      fullHead,
      '--json',
    ], { PATH: gh.path })

    expect(res.status, res.stderr).toBe(4)
    expect(res.stderr).toBe('')
    expect(res.stdout.trim().split(/\r?\n/)).toHaveLength(1)
    const envelope = JSON.parse(res.stdout) as Record<string, unknown>
    assertResultEnvelopeV1(envelope)
    expect(envelope).toMatchObject({
      command: 'bemoat:mission-control:review',
      mode: 'result',
      outcome: 'ERROR',
      classification: 'AMBIGUOUS_RESULT',
      mutation_performed: true,
      exact_head: fullHead.toLowerCase(),
      details: {
        legacy_classification: 'RECOVERABLE_ROUTING_DRIFT',
      },
      next_action: {
        type: 'STOP',
        command: null,
      },
    })
  })

  it('case 7: successful verdict projection', () => {
    const bodyFile = tempFile('verdict.md', validVerdict)
    const gh = createGhMock({ issueBody: validState, repo: 'acme/repo', prNumber: 230, prHead: FULL_HEAD, noLease: true })
    const res = run(['229', '--body-file', bodyFile, '--expected-state', 'AWAITING_REVIEW_3', '--review-type', 'delta', '--expected-head', FULL_HEAD], { PATH: gh.path })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/^SUCCESS: Mission Control review REVIEWED: BLOCKED_FOR_FOUNDER_DECISION.*comment 9001/i)
  })

  it('requires final REVIEW_VERDICT identity and metadata readback after projection', () => {
    const bodyFile = tempFile('verdict.md', validVerdict)
    const gh = createGhMock({
      issueBody: validState,
      repo: 'acme/repo',
      prNumber: 230,
      prHead: FULL_HEAD,
      noLease: true,
      finalCommentReadbackFailure: true,
    })
    const res = run([
      '229',
      '--body-file',
      bodyFile,
      '--expected-state',
      'AWAITING_REVIEW_3',
      '--review-type',
      'delta',
      '--expected-head',
      FULL_HEAD,
      '--json',
    ], { PATH: gh.path })

    expect(res.status).toBe(4)
    expect(res.stderr).toBe('')
    expect(JSON.parse(res.stdout)).toMatchObject({
      classification: 'AMBIGUOUS_RESULT',
      mutation_performed: true,
    })
  })

  it('case 8: duplicate rerun / idempotency behavior', () => {
    const identity = normalizeTransitionIdentity(validVerdict, { role: 'REVIEW_VERDICT' })
    const terminalState = {
      state: 'BLOCKED_FOR_FOUNDER_DECISION',
      review_cycle: 3,
      full_review_count: 1,
      current_head: FULL_HEAD,
      last_reviewed_head: FULL_HEAD,
      latest_review_verdict_comment_id: '9001',
      latest_transition_identity: serializeTransitionIdentity(identity),
    }
    const comments = [{ id: '9001', body: validVerdict }]
    let postCalls = 0
    const coordinator = new Coordinator({
      readState: async () => terminalState,
      writeState: async () => {
        throw new Error('terminal idempotency must not write state')
      },
      listComments: async () => comments,
      postComment: async () => {
        postCalls += 1
        throw new Error('terminal idempotency must not post a comment')
      },
    })

    return coordinator.integrateReviewVerdict({
      verdictBody: validVerdict,
      projectState: () => {
        throw new Error('terminal idempotency must not project state')
      },
      verifyPreconditions: async () => {},
      updatedAt: '2026-08-06T00:00:00.000Z',
      updatedBy: 'Reviewer',
    }).then((result) => {
      expect(result).toMatchObject({
        outcome: 'REVIEWED',
        replayed: true,
        state: terminalState,
        comment: { id: '9001' },
      })
      expect(postCalls).toBe(0)
    })
  })

  it('case 9: CLI replay is a canonical no-op with live readback and no writes', () => {
    const identity = normalizeTransitionIdentity(validVerdict, { role: 'REVIEW_VERDICT' })
    const replayState = validState.replace(
      'updated_at: "2026-07-23T17:00:00Z"',
      [
        'latest_review_verdict_comment_id: "9001"',
        `latest_transition_identity: '${serializeTransitionIdentity(identity)}'`,
        'updated_at: "2026-07-23T17:00:00Z"',
      ].join('\n'),
    )
    const bodyFile = tempFile('verdict.md', validVerdict)
    const gh = createGhMock({
      issueBody: replayState,
      repo: 'acme/repo',
      prNumber: 230,
      prHead: FULL_HEAD,
      comments: [{
        id: '9001',
        body: validVerdict,
        user: { login: 'boat1994' },
        author_association: 'OWNER',
      }],
      noLease: true,
    })
    const res = run([
      '229',
      '--body-file',
      bodyFile,
      '--expected-state',
      'AWAITING_REVIEW_3',
      '--review-type',
      'delta',
      '--expected-head',
      FULL_HEAD,
      '--json',
    ], { PATH: gh.path })

    expect(res.status, res.stderr || res.stdout).toBe(0)
    expect(res.stderr).toBe('')
    const envelope = JSON.parse(res.stdout) as Record<string, unknown>
    assertResultEnvelopeV1(envelope)
    expect(envelope).toMatchObject({
      command: 'bemoat:mission-control:review',
      outcome: 'NO_OP',
      classification: 'NO_OP_IDENTICAL_RETRY',
      mutation_performed: false,
      next_action: {
        type: 'COMPLETE',
        command: null,
      },
    })

    const calls = readFileSync(gh.callsFile, 'utf8').split(/\r?\n/).filter(Boolean)
    expect(calls.some((call) => call.includes('POST') || call.startsWith('gh issue edit'))).toBe(false)
    expect(calls.filter((call) => call.includes('/issues/229/comments')).length).toBeGreaterThan(0)
  })

  it('case 10: phantom POST fails closed as AMBIGUOUS_RESULT', () => {
    const bodyFile = tempFile('verdict.md', validVerdict)
    const gh = createGhMock({
      issueBody: validState,
      repo: 'acme/repo',
      prNumber: 230,
      prHead: FULL_HEAD,
      phantomPost: true,
      noLease: true,
    })
    const res = run([
      '229',
      '--body-file',
      bodyFile,
      '--expected-state',
      'AWAITING_REVIEW_3',
      '--review-type',
      'delta',
      '--expected-head',
      FULL_HEAD,
      '--json',
    ], { PATH: gh.path })

    expect(res.status).toBe(4)
    expect(res.stderr).toBe('')
    expect(JSON.parse(res.stdout)).toMatchObject({
      command: 'bemoat:mission-control:review',
      outcome: 'ERROR',
      classification: 'AMBIGUOUS_RESULT',
      mutation_performed: true,
      next_action: { type: 'STOP', command: null },
    })
  })
})
