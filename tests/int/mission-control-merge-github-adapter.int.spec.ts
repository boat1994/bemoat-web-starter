import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { createProductionMergeDeps } from '../../scripts/mission-control/adapters/merge-github.mjs'

describe('mission-control merge GitHub adapter', () => {
  const repo = 'boat1994/bemoat-web-starter'

  function managedBody(state = 'READY_TO_MERGE') {
    return `Mission Control mode: required

<!-- bemoat-mission-control-state:start -->
\`\`\`yaml
schema_version: 1
state: ${state}
review_cycle: 1
full_review_count: 1
guide_version: "1.3.0"
guide_source_ref: main
guide_source_sha: "${'b'.repeat(40)}"
active_task_issue: "#222"
active_pr: "#223"
current_head: "${'a'.repeat(40)}"
last_reviewed_head: "${'a'.repeat(40)}"
approved_base: main
open_blockers: []
follow_up_issues: []
next_permitted_action: "Founder merge"
material_change_status: none
updated_at: null
updated_by: null
\`\`\`
<!-- bemoat-mission-control-state:end -->`
  }

  function createIssueTransport(initialBody: string) {
    let body = initialBody
    let lease: { sha: string, content: Record<string, unknown> } | null = null
    const calls: Array<{ args: string[], input?: string }> = []

    const runGh = (args: string[], options: { input?: string } = {}) => {
      calls.push({ args, input: options.input })
      if (args[0] === 'issue' && args[1] === 'view') {
        if (args.includes('number,id,title,body,state,stateReason')) {
          return JSON.stringify({ number: 222, id: 'I_222', title: 'Task', body, state: 'OPEN', stateReason: null })
        }
        return JSON.stringify({ body })
      }
      if (args[0] === 'issue' && args[1] === 'edit') {
        body = readFileSync(args[args.indexOf('--body-file') + 1], 'utf8')
        return ''
      }
      if (args[0] === 'api' && args.some((arg) => arg.includes('contents/.bemoat/mission-control/leases/issue-222.json?ref=bemoat%2Fmission-control-leases'))) {
        if (!lease) throw new Error('404 Not Found')
        return JSON.stringify({ sha: lease.sha, content: Buffer.from(JSON.stringify(lease.content)).toString('base64') })
      }
      if (args[0] === 'api' && args.includes('git/ref/heads/bemoat/mission-control-leases')) throw new Error('404 Not Found')
      if (args[0] === 'api' && args.length === 2 && args[1] === `repos/${repo}`) return JSON.stringify({ default_branch: 'main' })
      if (args[0] === 'api' && args.includes(`git/ref/heads/main`)) return JSON.stringify({ object: { sha: 'b'.repeat(40) } })
      if (args[0] === 'api' && args.includes('git/refs')) return ''
      if (args[0] === 'api' && args.some((arg) => arg.includes('contents/.bemoat/mission-control/leases/issue-222.json'))) {
        const payload = JSON.parse(options.input ?? '{}')
        lease = {
          sha: `lease-${(lease?.sha ?? '0').replace('lease-', '') + 1}`,
          content: JSON.parse(Buffer.from(payload.content, 'base64').toString('utf8')),
        }
        return JSON.stringify({ sha: lease.sha })
      }
      throw new Error(`unexpected gh call: ${args.join(' ')}`)
    }

    return { calls, runGh, get body() { return body } }
  }

  it('preserves exact-head merge command construction through the injected transport', async () => {
    const calls: string[][] = []
    const expectedHead = 'a'.repeat(40)
    const deps = createProductionMergeDeps({
      runGh(args: string[]) {
        calls.push(args)
        return ''
      },
    })

    await deps.mergePullRequest({
      prNumber: 223,
      repo: 'boat1994/bemoat-web-starter',
      expectedHead,
    })

    expect(calls).toEqual([[
      'pr',
      'merge',
      '223',
      '--repo',
      'boat1994/bemoat-web-starter',
      '--merge',
      '--match-head-commit',
      expectedHead,
    ]])
  })

  it('maps a concrete GitHub transport failure to BLOCKED_EXTERNAL', async () => {
    const originalPath = process.env.PATH
    process.env.PATH = ''
    try {
      const deps = createProductionMergeDeps()
      await expect(deps.mergePullRequest({
        prNumber: 223,
        repo: 'boat1994/bemoat-web-starter',
        expectedHead: 'a'.repeat(40),
      })).rejects.toThrow(/^BLOCKED_EXTERNAL:/)
    } finally {
      process.env.PATH = originalPath
    }
  })

  it('preserves the Task DONE CAS/lease transition identity and post-write readback', async () => {
    const harness = createIssueTransport(managedBody('ELIGIBLE_FOR_FOUNDER_REVIEW'))
    const deps = createProductionMergeDeps({ runGh: harness.runGh })
    const mergeCommit = 'c'.repeat(40)

    await expect(deps.writeTaskDone({
      repo,
      issueNumber: 222,
      expectedState: {
        state: 'ELIGIBLE_FOR_FOUNDER_REVIEW',
        active_task_issue: '#222',
        active_pr: '#223',
        current_head: 'a'.repeat(40),
        last_reviewed_head: 'a'.repeat(40),
      },
      mergeCommit,
      resultCommentId: '224',
      prNumber: 223,
      reviewedHead: 'a'.repeat(40),
    })).resolves.toEqual({ state: 'DONE' })

    expect(harness.body).toContain('state: DONE')
    const leaseWrites = harness.calls.filter(({ args }) => args.includes('-X') && args.includes('PUT'))
    expect(leaseWrites).toHaveLength(2)
    const firstPayload = JSON.parse(leaseWrites[0].input ?? '{}')
    const firstLease = JSON.parse(Buffer.from(firstPayload.content, 'base64').toString('utf8'))
    expect(firstLease.transition_identity).toBe('merge-completion:222:223:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:cccccccccccccccccccccccccccccccccccccccc')
    expect(harness.calls.filter(({ args }) => args[0] === 'issue' && args[1] === 'view')).toHaveLength(3)
  })

  it('fails closed on campaign projection rejection without mutating the Issue', async () => {
    const calls: string[][] = []
    const deps = createProductionMergeDeps({
      runGh(args: string[]) {
        calls.push(args)
        if (args[0] === 'issue' && args[1] === 'view') return JSON.stringify({ body: 'not a campaign', state: 'OPEN' })
        throw new Error(`unexpected mutation: ${args.join(' ')}`)
      },
    })

    await expect(deps.projectCampaignSliceDone({
      repo,
      campaignIssue: 215,
      campaignSlice: 5,
      taskIssue: 222,
      prNumber: 223,
      reviewedHead: 'a'.repeat(40),
      mergeCommit: 'c'.repeat(40),
      authorizationCommentId: '224',
    })).rejects.toThrow()

    expect(calls.filter((args) => args[1] === 'edit' || args.includes('-X'))).toHaveLength(0)
  })

  it('invokes reconciliation and verifies managed-state readback', async () => {
    const tempRoot = mkdtempSync('/tmp/bemoat-merge-reconcile-')
    const logPath = join(tempRoot, 'reconcile-calls.log')
    const commandRoot = join(tempRoot, 'scripts')
    mkdirSync(join(commandRoot, 'mission-control', 'workflows'), { recursive: true })
    const commandPath = join(commandRoot, 'mission-control-reconcile.mjs')
    const fakeCommand = [
      '#!/usr/bin/env node',
      "import { appendFileSync } from 'node:fs'",
      `appendFileSync(${JSON.stringify(logPath)}, process.argv.slice(2).join(' ') + '\\n')`,
      "process.stdout.write('Mission Control reconciliation NO_OP: 1 attempt(s), 0 durable write(s)\\n')",
      '',
    ].join('\n')
    writeFileSync(commandPath, fakeCommand)
    const originalCwd = process.cwd()
    const body = managedBody('ELIGIBLE_FOR_FOUNDER_REVIEW')
    const harness = createIssueTransport(body)
    process.chdir(join(commandRoot, 'mission-control', 'workflows'))
    try {
      const deps = createProductionMergeDeps({ runGh: harness.runGh })
      await expect(deps.reconcile(222, repo)).resolves.toMatchObject({ finalOutcome: 'NO_OP', state: { state: 'ELIGIBLE_FOR_FOUNDER_REVIEW' } })
      expect(readFileSync(logPath, 'utf8')).toContain('222 --repo boat1994/bemoat-web-starter')
      expect(harness.calls.filter(({ args }) => args[0] === 'issue' && args[1] === 'view')).toHaveLength(1)
    } finally {
      process.chdir(originalCwd)
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })
})
