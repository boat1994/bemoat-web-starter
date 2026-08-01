import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

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
  writeFileSync(configPath, JSON.stringify(config))

  const executable = join(directory, 'gh')
  const script = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync('${configPath}', 'utf8'));

if (args[0] === 'repo' && args[1] === 'view') {
  console.log(JSON.stringify({ nameWithOwner: config.repo || 'acme/repo' }));
  process.exit(0);
}

if (args[0] === 'pr' && args[1] === 'view') {
  console.log(JSON.stringify({
    number: config.prNumber || 123,
    headRefOid: config.prHead || 'abc1234',
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
        const posted = { id: 9999, body: 'posted comment' };
        console.log(JSON.stringify(posted));
        process.exit(0);
      }
      console.log(JSON.stringify({ id: 9001, body: 'new comment', user: { login: 'Reviewer' } }));
      process.exit(0);
    } else {
      console.log(JSON.stringify(config.comments || []));
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
  return { path: `${directory}:${process.env.PATH ?? ''}`, configPath }
}

describe('scripts/mission-control-review.mjs CLI characterization', () => {
  const validVerdict = `## REVIEW_VERDICT
### Task log
- Timestamp: 2026-08-01T00:20:00+07:00
- Task / Issue: #229
- Phase: Bounded Delta Review 3
- Executing role: Reviewer
**PR / base / head:** PR #230 / main / · \`abc1234\`
**Verdict:** BLOCKED FOR FOUNDER DECISION
**Findings:** Critical: None · Important: None
**Gates:** exact-head CI pass
**Next:** Founder Approve or Decline
`

  const validState = `<!-- bemoat-mission-control-state:start -->
\`\`\`yaml
schema_version: 1
state: CORRECTION_REQUIRED_2
review_cycle: 2
full_review_count: 1
approved_base: main
active_task_issue: "#229"
active_pr: "#230"
current_head: abc1234
last_reviewed_head: abc1234
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
    const gh = createGhMock({ issueBody: validState, repo: 'acme/repo', prNumber: 230, prHead: 'abc1234' })
    const res = run(['229', '--body-file', bodyFile, '--expected-state', 'CORRECTION_REQUIRED_2', '--review-type', 'delta', '--expected-head', 'abc1234'], { PATH: gh.path })
    expect(res.status).not.toBe(0)
    expect(res.stderr).toMatch(/body must contain exactly one recognized role heading/i)
  })

  it('case 2: reviewed-head mismatch', () => {
    const bodyFile = tempFile('verdict.md', validVerdict)
    const gh = createGhMock({ issueBody: validState, repo: 'acme/repo', prNumber: 230, prHead: 'def5678' })
    const res = run(['229', '--body-file', bodyFile, '--expected-state', 'CORRECTION_REQUIRED_2', '--review-type', 'delta', '--expected-head', 'abc1234'], { PATH: gh.path })
    expect(res.status).not.toBe(0)
    expect(res.stderr).toMatch(/STATE_CONFLICT: live PR head differs from reviewed head/i)
  })

  it('case 3: exact-head CI failure', () => {
    const bodyFile = tempFile('verdict.md', validVerdict)
    const gh = createGhMock({ issueBody: validState, repo: 'acme/repo', prNumber: 230, prHead: 'abc1234', statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE', name: 'ci' }] })
    const res = run(['229', '--body-file', bodyFile, '--expected-state', 'CORRECTION_REQUIRED_2', '--review-type', 'delta', '--expected-head', 'abc1234'], { PATH: gh.path })
    expect(res.status).not.toBe(0)
    expect(res.stderr).toMatch(/STATE_CONFLICT: exact-head CI is not verified/i)
  })

  it('case 4: stale managed state / expected-state mismatch', () => {
    const bodyFile = tempFile('verdict.md', validVerdict)
    const gh = createGhMock({ issueBody: validState, repo: 'acme/repo', prNumber: 230, prHead: 'abc1234' })
    const res = run(['229', '--body-file', bodyFile, '--expected-state', 'BLOCKED_FOR_FOUNDER_DECISION', '--review-type', 'delta', '--expected-head', 'abc1234'], { PATH: gh.path })
    expect(res.status).not.toBe(0)
    expect(res.stderr).toMatch(/STATE_CONFLICT: expected BLOCKED_FOR_FOUNDER_DECISION, received CORRECTION_REQUIRED_2/i)
  })

  it('case 5: concurrent Issue-body mutation before CAS write', () => {
    const bodyFile = tempFile('verdict.md', validVerdict)
    const gh = createGhMock({ issueBody: validState.replace('17:00:00Z', '18:00:00Z'), repo: 'acme/repo', prNumber: 230, prHead: 'abc1234', concurrentBodyMutation: true, noLease: true })
    const res = run(['229', '--body-file', bodyFile, '--expected-state', 'CORRECTION_REQUIRED_2', '--review-type', 'delta', '--expected-head', 'abc1234'], { PATH: gh.path })
    expect(res.status).not.toBe(0)
    expect(res.stderr).toMatch(/STATE_CONFLICT: concurrent Issue body change detected/i)
  })

  it('case 6: comment posted but projection failed (RECOVERABLE_ROUTING_DRIFT)', () => {
    const bodyFile = tempFile('verdict.md', validVerdict)
    const gh = createGhMock({ issueBody: validState, repo: 'acme/repo', prNumber: 230, prHead: 'abc1234', simulateProjectionFailure: true, noLease: true })
    const res = run(['229', '--body-file', bodyFile, '--expected-state', 'CORRECTION_REQUIRED_2', '--review-type', 'delta', '--expected-head', 'abc1234'], { PATH: gh.path })
    expect(res.status).not.toBe(0)
    expect(res.stderr).toMatch(/RECOVERABLE_ROUTING_DRIFT/i)
  })

  it('case 7: successful verdict projection', () => {
    const bodyFile = tempFile('verdict.md', validVerdict)
    const gh = createGhMock({ issueBody: validState, repo: 'acme/repo', prNumber: 230, prHead: 'abc1234', noLease: true })
    const res = run(['229', '--body-file', bodyFile, '--expected-state', 'CORRECTION_REQUIRED_2', '--review-type', 'delta', '--expected-head', 'abc1234'], { PATH: gh.path })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/Mission Control review REVIEWED: BLOCKED_FOR_FOUNDER_DECISION.*comment 9001/i)
  })

  it('case 8: duplicate rerun / idempotency behavior', () => {
    const bodyFile = tempFile('verdict.md', validVerdict)
    const idempotentState = validState.replace('state: CORRECTION_REQUIRED_2', 'state: BLOCKED_FOR_FOUNDER_DECISION').replace('review_cycle: 2', 'review_cycle: 3').replace('last_reviewed_head: abc1234', 'last_reviewed_head: abc1234\nlatest_review_verdict_comment_id: 9001')
    const gh = createGhMock({
      issueBody: idempotentState, repo: 'acme/repo', prNumber: 230, prHead: 'abc1234', noLease: true,
      comments: [{ id: '9001', body: validVerdict, createdAt: '2026-08-01T00:30:00Z' }]
    })
    const res = run(['229', '--body-file', bodyFile, '--expected-state', 'BLOCKED_FOR_FOUNDER_DECISION', '--review-type', 'delta', '--expected-head', 'abc1234'], { PATH: gh.path })
    if (res.status !== 0) console.log(res.stderr)
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/Mission Control review REVIEWED: BLOCKED_FOR_FOUNDER_DECISION.*comment 9001/i)
  })
})
