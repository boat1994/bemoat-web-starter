import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const scriptPath = resolve(process.cwd(), 'scripts/agent-delivery.mjs')
const tempPaths: string[] = []

function stubGhAndGit(prData: Record<string, unknown>, issueData: Record<string, unknown>, lsRemoteOutput: string, currentBranch: string = 'main', localCommit: string = 'abc1234') {
  const directory = mkdtempSync(join(tmpdir(), 'bemoat-agent-delivery-bin-'))
  tempPaths.push(directory)

  const fixture = join(directory, 'fixture.json')
  const commentsStore = join(directory, 'comments.json')
  const editedBody = join(directory, 'edited-body.md')
  writeFileSync(commentsStore, '[]')
  writeFileSync(fixture, JSON.stringify({
    prData,
    issueData,
    repo: (prData.baseRepository as { nameWithOwner?: string } | undefined)?.nameWithOwner
      ?? (prData.headRepository as { nameWithOwner?: string } | undefined)?.nameWithOwner
      ?? 'acme/repo',
    commentsStore,
    editedBody,
    failEdit: false,
  }))

  const ghJs = join(directory, 'gh-stub.mjs')
  writeFileSync(ghJs, `import { readFileSync, writeFileSync, existsSync } from 'node:fs'
const fixture = JSON.parse(readFileSync(${JSON.stringify(fixture)}, 'utf8'))
const args = process.argv.slice(2)
if (args[0] === 'pr' && args[1] === 'view') {
  if (args.includes('baseRepository')) {
    console.error('Unknown JSON field: baseRepository')
    process.exit(1)
  }
  process.stdout.write(JSON.stringify(fixture.prData))
  process.exit(0)
}
if (args[0] === 'repo' && args[1] === 'view') {
  process.stdout.write(fixture.repo)
  process.exit(0)
}
if (args[0] === 'issue' && args[1] === 'view') {
  if (existsSync(fixture.editedBody)) {
    process.stdout.write(JSON.stringify({ body: readFileSync(fixture.editedBody, 'utf8') }))
  } else {
    process.stdout.write(JSON.stringify(fixture.issueData))
  }
  process.exit(0)
}
if (args[0] === 'issue' && args[1] === 'edit') {
  if (fixture.failEdit) {
    console.error('Simulated GitHub API error')
    process.exit(1)
  }
  const bodyFile = args[args.indexOf('--body-file') + 1]
  writeFileSync(fixture.editedBody, readFileSync(bodyFile, 'utf8'))
  process.exit(0)
}
if (args[0] === 'api') {
  if (args.includes('--paginate')) {
    process.stdout.write(readFileSync(fixture.commentsStore, 'utf8'))
    process.exit(0)
  }
  if (args.includes('POST')) {
    const input = args[args.indexOf('--input') + 1]
    const payload = JSON.parse(readFileSync(input, 'utf8'))
    const comments = JSON.parse(readFileSync(fixture.commentsStore, 'utf8'))
    const posted = {
      id: 9000 + comments.length,
      body: payload.body,
      user: { login: 'boat1994' },
      author_association: 'OWNER',
      html_url: 'https://github.com/acme/repo/issues/154#issuecomment-' + (9000 + comments.length),
      created_at: '2026-07-29T00:00:00Z',
    }
    comments.push(posted)
    writeFileSync(fixture.commentsStore, JSON.stringify(comments))
    process.stdout.write(JSON.stringify(posted))
    process.exit(0)
  }
}
process.exit(0)
`)

  const ghExec = join(directory, 'gh')
  writeFileSync(ghExec, `#!/bin/sh
exec "${process.execPath}" "${ghJs}" "$@"
`)
  chmodSync(ghExec, 0o755)

  const gitExec = join(directory, 'git')
  writeFileSync(gitExec, `#!/bin/sh
if [ "$1" = "rev-parse" ]; then
  printf '%s' '${localCommit}'
  exit 0
fi
if [ "$1" = "branch" ]; then
  printf '%s' '${currentBranch}'
  exit 0
fi
if [ "$1" = "ls-remote" ]; then
  printf '%s' '${lsRemoteOutput}'
  exit 0
fi
exit 0
`)
  chmodSync(gitExec, 0o755)

  const nodeExec = join(directory, 'node')
  writeFileSync(nodeExec, `#!/bin/sh
if [ "$1" = "scripts/post-role-comment.mjs" ]; then
  if [ "$NODE_FAIL_POST_ROLE_COMMENT" = "1" ]; then
    echo "Failed to post RESULT comment" >&2
    exit 1
  fi
  exec "${process.execPath}" "$@"
fi
exec "${process.execPath}" "$@"
`)
  chmodSync(nodeExec, 0o755)

  return {
    PATH: `${directory}:${process.env.PATH ?? ''}`,
    directory,
    fixture,
    commentsStore,
    editedBody,
  }
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
})

describe('bemoat:agent:delivery', () => {
  const validResultBody = `## RESULT
**Profile:** FAST
**Task:** #154 · \`feature/154\` → \`main\` · head \`abc1234\`
**PR:** https://github.com/acme/repo/pull/155
**Completed:** Added the bounded change.
**Evidence:** Local — focused test → pass; GitHub — exact-head CI → pass
**AC audit:** Done
**Risks / escalation:** None
**Next:** Founder review
`
  const validIssueBody = [
    '<!-- bemoat-mission-control-state:start -->',
    '```yaml',
    'schema_version: 1',
    'state: READY',
    'review_cycle: 0',
    'full_review_count: 0',
    'approved_base: main',
    'active_task_issue: null',
    'active_pr: null',
    'current_head: null',
    'last_reviewed_head: null',
    'guide_version: 1.0.0',
    'guide_source_ref: main',
    'guide_source_sha: null',
    'open_blockers:',
    '  - id: "BLK-1"',
    'follow_up_issues:',
    '  - 155',
    `next_permitted_action: "none"`,
    `material_change_status: none`,
    `updated_at: "2026-07-23T12:00:00Z"`,
    `updated_by: "Mission Control"`,
    '```',
    '<!-- bemoat-mission-control-state:end -->'
  ].join('\n')

  it('fails if local commit does not match remote ref', () => {
    const stub = stubGhAndGit({}, {}, 'def5678 refs/heads/main', 'main', 'abc1234')
    const result = run(['154'], { input: validResultBody, env: { PATH: stub.PATH } })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('STATE_CONFLICT: Remote branch ref does not equal local commit abc1234')
  }, 10000)

  it('fails if PR head does not match local commit', () => {
    const stub = stubGhAndGit({ headRefOid: 'def5678', headRefName: 'main' }, {}, 'abc1234 refs/heads/main', 'main', 'abc1234')
    const result = run(['154'], { input: validResultBody, env: { PATH: stub.PATH } })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('STATE_CONFLICT: PR head def5678 does not match local commit abc1234')
  }, 10000)

  it('fails if PR headRefName does not match local branch', () => {
    const stub = stubGhAndGit({ headRefOid: 'abc1234', headRefName: 'wrong-branch' }, {}, 'abc1234 refs/heads/main', 'main', 'abc1234')
    const result = run(['154'], { input: validResultBody, env: { PATH: stub.PATH } })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('STATE_CONFLICT: PR headRefName wrong-branch does not match local branch main')
  }, 10000)

  it('fails if exact-head CI is missing', () => {
    const prData: Record<string, unknown> = {
      headRefOid: 'abc1234',
      headRefName: 'main',
      statusCheckRollup: []
    }
    const stub = stubGhAndGit(prData, {}, 'abc1234 refs/heads/main', 'main', 'abc1234')
    const result = run(['154'], { input: validResultBody, env: { PATH: stub.PATH } })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('STATE_CONFLICT: Exact-head CI not verified')
  }, 10000)

  it('fails on wrong repository/ref transport', () => {
    const prData = {
      headRefOid: 'abc1234',
      headRefName: 'main',
      headRepository: { nameWithOwner: 'wrong/repo' },
      baseRepository: { nameWithOwner: 'acme/repo' },
      statusCheckRollup: [{ conclusion: 'SUCCESS', targetUrl: 'https://ci/abc1234' }]
    }
    const stub = stubGhAndGit(prData, { body: validIssueBody }, 'abc1234 refs/heads/main', 'main', 'abc1234')
    const result = run(['154', '--repo', 'acme/repo'], { input: validResultBody, env: { PATH: stub.PATH } })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('STATE_CONFLICT: PR head repository wrong/repo does not match expected repository acme/repo')
  }, 10000)

  it('fails on a wrong head repository without an explicit --repo flag', () => {
    const prData = {
      headRefOid: 'abc1234',
      headRefName: 'main',
      headRepository: { nameWithOwner: 'wrong/repo' },
      baseRepository: { nameWithOwner: 'acme/repo' },
      statusCheckRollup: [{ conclusion: 'SUCCESS', targetUrl: 'https://ci/abc1234' }],
    }
    const stub = stubGhAndGit(prData, { body: validIssueBody }, 'abc1234 refs/heads/main', 'main', 'abc1234')
    const result = run(['154'], { input: validResultBody, env: { PATH: stub.PATH } })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('STATE_CONFLICT: PR head repository wrong/repo does not match expected repository acme/repo')
  }, 10000)

  it('succeeds when all conditions are met and preserves blockers', () => {
    const prData = {
      headRefOid: 'abc1234',
      headRefName: 'main',
      baseRefName: 'main',
      statusCheckRollup: [
        { conclusion: 'SUCCESS', targetUrl: 'https://ci/abc1234' }
      ]
    }
    const stub = stubGhAndGit(prData, { body: validIssueBody }, 'abc1234 refs/heads/main', 'main', 'abc1234')
    const result = run(['154'], { input: validResultBody, env: { PATH: stub.PATH } })
    if (result.status !== 0) {
      console.log('STDERR:', result.stderr)
      console.log('STDOUT:', result.stdout)
    }
    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/Delivery reconciliation successful\. RESULT comment \d+ posted/)
  }, 10000)

  it('persists fresh Mission Control audit provenance for Correction 2 delivery', async () => {
    const { readFileSync } = await import('node:fs')
    const prData = {
      headRefOid: 'abc1234', headRefName: 'main', baseRefName: 'main',
      statusCheckRollup: [{ conclusion: 'SUCCESS', targetUrl: 'https://ci/abc1234' }],
    }
    const correctionBody = validIssueBody
      .replace('state: READY', 'state: CORRECTION_REQUIRED_2')
      .replace('review_cycle: 0', 'review_cycle: 2')
      .replace('full_review_count: 0', 'full_review_count: 1')
      .replace('active_task_issue: null', 'active_task_issue: "#173"')
      .replace('active_pr: null', 'active_pr: "#174"')
      .replace('current_head: null', 'current_head: "reviewed-head"')
      .replace('last_reviewed_head: null', 'last_reviewed_head: "reviewed-head"')
      .replace('updated_at: "2026-07-23T12:00:00Z"', 'updated_at: "2026-07-23T12:00:00Z"')
    const stub = stubGhAndGit(prData, { body: correctionBody }, 'abc1234 refs/heads/main', 'main', 'abc1234')

    const result = run(['173'], {
      input: validResultBody.replace('#154', '#173').replace('/155', '/174'),
      env: { PATH: stub.PATH },
    })
    expect(result.status, result.stderr || result.stdout).toBe(0)
    const editedBody = readFileSync(stub.editedBody, 'utf8')
    expect(editedBody).toContain('state: AWAITING_REVIEW_3')
    expect(editedBody).toContain('updated_by: Mission Control')
    expect(editedBody).not.toContain('updated_at: "2026-07-23T12:00:00Z"')
  }, 10000)

  it('fails closed without advancing state if RESULT post fails', () => {
    const prData = {
      headRefOid: 'abc1234',
      headRefName: 'main',
      baseRefName: 'main',
      statusCheckRollup: [
        { conclusion: 'SUCCESS', targetUrl: 'https://ci/abc1234' }
      ]
    }
    const stub = stubGhAndGit(prData, { body: validIssueBody }, 'abc1234 refs/heads/main', 'main', 'abc1234')
    const result = run(['154'], {
      input: validResultBody,
      env: { PATH: stub.PATH, NODE_FAIL_POST_ROLE_COMMENT: '1' },
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/ambiguous POST has no provable match|Failed to validate RESULT comment|Failed to post RESULT comment/)
    expect(existsSync(stub.editedBody)).toBe(false)
  }, 10000)

  it('preserves arbitrary custom YAML fields', async () => {
    const { readFileSync } = await import('node:fs')
    const prData = {
      headRefOid: 'abc1234',
      headRefName: 'main',
      baseRefName: 'main',
      statusCheckRollup: [{ conclusion: 'SUCCESS', targetUrl: 'https://ci/abc1234' }]
    }
    const issueBodyWithCustom = validIssueBody.replace('```\n<!-- bemoat-mission-control-state:end -->', 'custom_field: "preserved"\ncustom_list:\n  - "a"\n  - "b"\n```\n<!-- bemoat-mission-control-state:end -->')
    const stub = stubGhAndGit(prData, { body: issueBodyWithCustom }, 'abc1234 refs/heads/main', 'main', 'abc1234')

    const result = run(['154'], { input: validResultBody, env: { PATH: stub.PATH } })
    expect(result.status).toBe(0)

    const editedBody = readFileSync(stub.editedBody, 'utf8')
    expect(editedBody).toContain('custom_field: preserved')
    expect(editedBody).toContain('custom_list:\n  - a\n  - b')
  }, 10000)

  it('RESULT failure before state write leaves durable state unchanged', () => {
    const prData = {
      headRefOid: 'abc1234',
      headRefName: 'main',
      baseRefName: 'main',
      statusCheckRollup: [{ conclusion: 'SUCCESS', targetUrl: 'https://ci/abc1234' }]
    }
    const stub = stubGhAndGit(prData, { body: validIssueBody }, 'abc1234 refs/heads/main', 'main', 'abc1234')
    const result = run(['154'], {
      input: validResultBody,
      env: { PATH: stub.PATH, NODE_FAIL_POST_ROLE_COMMENT: '1' },
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/ambiguous POST has no provable match|Failed to validate RESULT comment|Failed to post RESULT comment/)
    expect(existsSync(stub.editedBody)).toBe(false)
  }, 10000)

  it('state write failure after RESULT post reports recoverable routing drift', async () => {
    const { readFileSync, writeFileSync: write } = await import('node:fs')
    const prData = {
      headRefOid: 'abc1234',
      headRefName: 'main',
      baseRefName: 'main',
      statusCheckRollup: [{ conclusion: 'SUCCESS', targetUrl: 'https://ci/abc1234' }]
    }
    const stub = stubGhAndGit(prData, { body: validIssueBody }, 'abc1234 refs/heads/main', 'main', 'abc1234')
    const fixture = JSON.parse(readFileSync(stub.fixture, 'utf8'))
    fixture.failEdit = true
    write(stub.fixture, JSON.stringify(fixture))

    const result = run(['154'], { input: validResultBody, env: { PATH: stub.PATH } })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('RECOVERABLE_ROUTING_DRIFT')
  }, 10000)

  it('rerun after comment-success/state-write-failure reuses the live comment id', async () => {
    const { readFileSync, writeFileSync: write } = await import('node:fs')
    const prData = {
      headRefOid: 'abc1234',
      headRefName: 'main',
      baseRefName: 'main',
      statusCheckRollup: [{ conclusion: 'SUCCESS', targetUrl: 'https://ci/abc1234' }],
    }
    const stub = stubGhAndGit(prData, { body: validIssueBody }, 'abc1234 refs/heads/main', 'main', 'abc1234')
    const fixture = JSON.parse(readFileSync(stub.fixture, 'utf8'))
    fixture.failEdit = true
    write(stub.fixture, JSON.stringify(fixture))

    const first = run(['154'], { input: validResultBody, env: { PATH: stub.PATH } })
    expect(first.status).toBe(1)
    expect(first.stderr).toContain('RECOVERABLE_ROUTING_DRIFT')
    const commentsAfterFirst = JSON.parse(readFileSync(stub.commentsStore, 'utf8'))
    expect(commentsAfterFirst).toHaveLength(1)
    const commentId = commentsAfterFirst[0].id

    fixture.failEdit = false
    write(stub.fixture, JSON.stringify(fixture))
    const second = run(['154'], { input: validResultBody, env: { PATH: stub.PATH } })
    expect(second.status, second.stderr || second.stdout).toBe(0)
    expect(second.stdout).toContain(`RESULT comment ${commentId}`)
    expect(JSON.parse(readFileSync(stub.commentsStore, 'utf8'))).toHaveLength(1)
  }, 10000)
})
