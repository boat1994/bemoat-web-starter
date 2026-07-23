import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const scriptPath = resolve(process.cwd(), 'scripts/agent-delivery.mjs')
const tempPaths: string[] = []

function stubGhAndGit(prData: Record<string, unknown>, issueData: Record<string, unknown>, lsRemoteOutput: string, currentBranch: string = 'main', localCommit: string = 'abc1234') {
  const directory = mkdtempSync(join(tmpdir(), 'bemoat-agent-delivery-bin-'))
  tempPaths.push(directory)
  
  const ghExec = join(directory, 'gh')
  const prJson = JSON.stringify(prData).replace(/'/g, `'"'"'`)
  const issueJson = JSON.stringify(issueData).replace(/'/g, `'"'"'`)
  
  writeFileSync(ghExec, `#!/bin/sh
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  printf '%s' '${prJson}'
  exit 0
fi
if [ "$1" = "issue" ] && [ "$2" = "view" ]; then
  printf '%s' '${issueJson}'
  exit 0
fi
if [ "$1" = "issue" ] && [ "$2" = "edit" ]; then
  exit 0
fi
if [ "$1" = "issue" ] && [ "$2" = "comment" ]; then
  exit 0
fi
exit 0
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

  return { PATH: `${directory}:${process.env.PATH ?? ''}` }
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
  const validIssueBody = `<!-- bemoat-mission-control-state:start -->
\`\`\`yaml
schema_version: 1
state: READY
review_cycle: 0
full_review_count: 0
approved_base: main
active_task_issue: null
active_pr: null
current_head: null
last_reviewed_head: null
guide_version: 1.0.0
guide_source_ref: main
guide_source_sha: null
open_blockers: []
follow_up_issues: []
next_permitted_action: "none"
material_change_status: none
updated_at: "2026-07-23T12:00:00Z"
updated_by: "Mission Control"
\`\`\`
<!-- bemoat-mission-control-state:end -->`

  it('fails if local commit does not match remote ref', () => {
    const env = stubGhAndGit({}, {}, 'def5678 refs/heads/main', 'main', 'abc1234')
    const result = run(['154'], { input: validResultBody, env })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('STATE_CONFLICT: Remote branch ref does not equal local commit abc1234')
  })

  it('fails if PR head does not match local commit', () => {
    const env = stubGhAndGit({ headRefOid: 'def5678' }, {}, 'abc1234 refs/heads/main', 'main', 'abc1234')
    const result = run(['154'], { input: validResultBody, env })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('STATE_CONFLICT: PR head def5678 does not match local commit abc1234')
  })

  it('fails if exact-head CI is missing', () => {
    const prData: Record<string, unknown> = {
      headRefOid: 'abc1234',
      statusCheckRollup: []
    }
    const env = stubGhAndGit(prData, {}, 'abc1234 refs/heads/main', 'main', 'abc1234')
    const result = run(['154'], { input: validResultBody, env })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('STATE_CONFLICT: Exact-head CI not verified')
  })

  it('succeeds when all conditions are met', () => {
    const prData = {
      headRefOid: 'abc1234',
      statusCheckRollup: [
        { conclusion: 'SUCCESS', targetUrl: 'https://ci/abc1234' }
      ]
    }
    const env = stubGhAndGit(prData, { body: validIssueBody }, 'abc1234 refs/heads/main', 'main', 'abc1234')
    const result = run(['154'], { input: validResultBody, env })
    if (result.status !== 0) {
      console.log('STDERR:', result.stderr)
      console.log('STDOUT:', result.stdout)
    }
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Delivery reconciliation successful')
  })
})
