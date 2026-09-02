import { describe, expect, it } from 'vitest'

import { runHandoffWorkflow } from '../../scripts/handoff/workflow.ts'
import type { HandoffCommandResult, HandoffCommandRunner } from '../../scripts/handoff/runtime.ts'

const BASE_SHA = 'a'.repeat(40)
const HEAD_SHA = 'b'.repeat(40)
const REPOSITORY = 'boat1994/bemoat-web-starter'
const ISSUE = '410'
const BRANCH = 'feature/410-handoff-protocol'
const PR_URL = `https://github.com/${REPOSITORY}/pull/412`
const ISSUE_URL = `https://github.com/${REPOSITORY}/issues/${ISSUE}`

function validRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    record_type: 'HANDOFF',
    repository: REPOSITORY,
    issue_number: ISSUE,
    objective: 'Implement the bounded handoff protocol primitive.',
    permitted_scope: ['scripts/agent-handoff.ts', 'scripts/handoff/', 'tests/int/'],
    prohibited_scope: ['legacy Mission Control deletion', 'production operations'],
    executing_agent: 'Codex',
    provider: 'OpenAI',
    branch: BRANCH,
    exact_head: HEAD_SHA,
    protected_base: { branch: 'main', sha: BASE_SHA },
    pr: {
      number: '412',
      url: PR_URL,
      base: 'main',
      head: BRANCH,
      head_sha: HEAD_SHA,
    },
    verified_evidence: [
      { kind: 'focused-tests', value: 'handoff transport tests pass', url: 'https://github.com/actions' },
    ],
    route: 'IMPLEMENT',
    next_action: {
      route: 'IMPLEMENT',
      description: 'Implement the bounded handoff protocol primitive.',
    },
    stop_conditions: ['Stop on stale, conflicting, malformed, or non-durable evidence.'],
    local_durability: { required: true, durable: true, reason: null },
    ...overrides,
  }
}

type Comment = { id: string; html_url: string; body: string }
type World = {
  comments: Comment[]
  postCount: number
  calls: Array<{ command: string; args: string[]; input?: string }>
  failPost?: boolean
  acceptFailedPost?: boolean
  duplicateFailedPost?: boolean
  hideReadback?: boolean
  repository?: string
  issueNumber?: string
  branch?: string
  head?: string
  baseSha?: string
  dirty?: string
}

function runnerFor(world: World): HandoffCommandRunner {
  return (command, args, options = {}) => {
    world.calls.push({ command, args: [...args], input: options.input })

    if (command === 'git') {
      const key = args.join(' ')
      if (key === 'branch --show-current') return ok(`${world.branch ?? BRANCH}\n`)
      if (key === 'rev-parse HEAD') return ok(`${world.head ?? HEAD_SHA}\n`)
      if (key === 'status --short') return ok(world.dirty ?? '')
      if (key === 'remote get-url origin') return ok(`https://github.com/${world.repository ?? REPOSITORY}.git\n`)
      if (key === 'rev-parse --abbrev-ref --symbolic-full-name @{upstream}') return ok(`origin/${world.branch ?? BRANCH}\n`)
      if (key === `ls-remote --heads origin ${world.branch ?? BRANCH}`) return ok(`${world.head ?? HEAD_SHA}\trefs/heads/${world.branch ?? BRANCH}\n`)
      return fail(`unexpected git command: ${key}`)
    }

    if (command !== 'gh') return fail(`unexpected command: ${command}`)

    if (args[0] === 'repo' && args[1] === 'view') {
      return ok(JSON.stringify({ nameWithOwner: world.repository ?? REPOSITORY, defaultBranchRef: { name: 'main' } }))
    }
    if (args[0] === 'issue' && args[1] === 'view') {
      const issueNumber = world.issueNumber ?? ISSUE
      return ok(JSON.stringify({ number: Number(issueNumber), url: `https://github.com/${REPOSITORY}/issues/${issueNumber}`, state: 'OPEN' }))
    }
    if (args[0] === 'pr' && args[1] === 'view') {
      return ok(JSON.stringify({
        number: 412,
        url: PR_URL,
        baseRefName: 'main',
        baseRefOid: world.baseSha ?? BASE_SHA,
        headRefName: world.branch ?? BRANCH,
        headRefOid: world.head ?? HEAD_SHA,
        state: 'OPEN',
        closingIssuesReferences: [{ number: Number(world.issueNumber ?? ISSUE), repository: { nameWithOwner: world.repository ?? REPOSITORY } }],
      }))
    }
    if (args[0] === 'api' && args.includes('repos/boat1994/bemoat-web-starter/git/ref/heads/main')) {
      return ok(JSON.stringify({ object: { sha: world.baseSha ?? BASE_SHA } }))
    }
    if (args[0] === 'api' && args.includes(`repos/${REPOSITORY}/issues/${ISSUE}/comments`)) {
      if (args.includes('--method') && args.includes('POST')) {
        world.postCount += 1
        let payload: { body?: unknown }
        try {
          payload = JSON.parse(options.input ?? '') as { body?: unknown }
        } catch {
          return fail('GitHub comment POST body was not a JSON object')
        }
        if (typeof payload.body !== 'string') return fail('GitHub comment POST body field is missing')
        const body = payload.body
        const next: Comment = {
          id: String(9000 + world.postCount),
          html_url: `${ISSUE_URL}#issuecomment-${9000 + world.postCount}`,
          body,
        }
        if (world.acceptFailedPost) {
          world.comments.push(next)
          if (world.duplicateFailedPost) {
            world.comments.push({ ...next, id: String(9000 + world.postCount + 1), html_url: `${ISSUE_URL}#issuecomment-${9000 + world.postCount + 1}` })
          }
        }
        if (world.failPost) return { status: 1, stdout: '', stderr: 'simulated POST timeout', error: null }
        world.comments.push(next)
        return ok(JSON.stringify(next))
      }
      const comments = world.hideReadback ? [] : world.comments
      return ok(JSON.stringify([comments]))
    }

    return fail(`unexpected gh command: ${args.join(' ')}`)
  }
}

function ok(stdout: string): HandoffCommandResult {
  return { status: 0, stdout, stderr: '', error: null }
}

function fail(message: string): HandoffCommandResult {
  return { status: 1, stdout: '', stderr: message, error: null }
}

async function run(record: Record<string, unknown>, world: World = { comments: [], postCount: 0, calls: [] }) {
  return runHandoffWorkflow({
    issueNumber: ISSUE,
    body: JSON.stringify(record),
    cwd: '/repo',
    env: process.env,
    run: runnerFor(world),
  })
}

describe('bemoat:handoff neutral transport', () => {
  it('validates bindings, appends exactly one Issue comment, and reads it back', async () => {
    const world: World = { comments: [], postCount: 0, calls: [] }
    const result = await run(validRecord(), world)

    expect(result).toMatchObject({ classification: 'SUCCESS', mutationPerformed: true })
    expect(result.comment).toMatchObject({ id: '9001', html_url: `${ISSUE_URL}#issuecomment-9001` })
    expect(world.postCount).toBe(1)
    expect(world.comments).toHaveLength(1)
    expect(world.comments[0].body).toMatch(/^## HANDOFF\n\n```json\n/)
    expect(world.comments[0].body).not.toMatch(/^## RESULT/m)
    expect(world.comments[0].body).toContain('"record_type": "HANDOFF"')
    const postCalls = world.calls.filter((call) => call.args.includes('--method') && call.args.includes('POST'))
    expect(postCalls).toHaveLength(1)
    expect(JSON.parse(postCalls[0]?.input ?? '')).toEqual({ body: world.comments[0].body })
  })

  it('performs no comment mutation when repository, Issue, head, or PR binding is wrong', async () => {
    const wrongRepository: World = { comments: [], postCount: 0, calls: [], repository: 'other/repository' }
    await expect(run(validRecord(), wrongRepository)).rejects.toMatchObject({ classification: 'EVIDENCE_CONFLICT' })
    expect(wrongRepository.postCount).toBe(0)

    const wrongIssue: World = { comments: [], postCount: 0, calls: [], issueNumber: '411' }
    await expect(run(validRecord(), wrongIssue)).rejects.toMatchObject({ classification: 'EVIDENCE_CONFLICT' })
    expect(wrongIssue.postCount).toBe(0)

    const wrongHead: World = { comments: [], postCount: 0, calls: [], head: 'c'.repeat(40) }
    await expect(run(validRecord(), wrongHead)).rejects.toMatchObject({ classification: 'EVIDENCE_CONFLICT' })
    expect(wrongHead.postCount).toBe(0)

    const wrongPr: World = { comments: [], postCount: 0, calls: [] }
    await expect(run(validRecord({
      pr: {
        number: '413',
        url: `https://github.com/${REPOSITORY}/pull/413`,
        base: 'main',
        head: BRANCH,
        head_sha: HEAD_SHA,
      },
    }), wrongPr)).rejects.toMatchObject({ classification: 'EVIDENCE_CONFLICT' })
    expect(wrongPr.postCount).toBe(0)

    const wrongPrBase: World = { comments: [], postCount: 0, calls: [] }
    await expect(run(validRecord({
      pr: {
        number: '412',
        url: PR_URL,
        base: 'other-branch',
        head: BRANCH,
        head_sha: HEAD_SHA,
      },
    }), wrongPrBase)).rejects.toMatchObject({ classification: 'EVIDENCE_CONFLICT' })
    expect(wrongPrBase.postCount).toBe(0)
    
    // Create a custom runner for unrelated/closed PR tests
    const runCustom = async (worldOverrides: Partial<World>, prData: Record<string, unknown>, recordOverrides: Record<string, unknown> = {}) => {
      const world: World = { comments: [], postCount: 0, calls: [], ...worldOverrides }
      const customRunner: HandoffCommandRunner = (command, args, options = {}) => {
        if (command === 'gh' && args[0] === 'pr' && args[1] === 'view') {
          return { status: 0, stdout: JSON.stringify({
            number: 412, url: PR_URL, baseRefName: 'main', baseRefOid: BASE_SHA,
            headRefName: BRANCH, headRefOid: HEAD_SHA, state: 'OPEN',
            closingIssuesReferences: [{ number: Number(ISSUE), repository: { nameWithOwner: REPOSITORY } }],
            ...prData
          }), stderr: '', error: null }
        }
        if (command === 'gh' && args[0] === 'pr' && args[1] === 'list') {
          return { status: 0, stdout: JSON.stringify([prData]), stderr: '', error: null }
        }
        return runnerFor(world)(command, args, options)
      }
      const record = validRecord(recordOverrides)
      await expect(async () => runHandoffWorkflow({ issueNumber: ISSUE, body: JSON.stringify(record), cwd: '/repo', env: process.env, run: customRunner })).rejects.toMatchObject({ classification: 'EVIDENCE_CONFLICT' })
      expect(world.postCount).toBe(0)
    }

    await runCustom({}, { closingIssuesReferences: [] }, {}) // Unrelated PR
    await runCustom({}, { state: 'CLOSED' }, {}) // Closed PR
    await runCustom({}, { state: 'OPEN', closingIssuesReferences: [{ number: Number(ISSUE), repository: { nameWithOwner: REPOSITORY } }] }, { pr: null }) // Omitted applicable PR
  })

  it('uses the same authorized PR-Issue ownership contract as Context', async () => {
    const incidentalBody = 'Acceptance audit: Issue #410 is regression context only. related to #410 references #410'
    const world: World = { comments: [], postCount: 0, calls: [] }
    const incidentalClaim: HandoffCommandRunner = (command, args, options = {}) => {
      if (command === 'gh' && args[0] === 'pr' && args[1] === 'view') {
        return ok(JSON.stringify({
          number: 412,
          url: PR_URL,
          baseRefName: 'main',
          baseRefOid: BASE_SHA,
          headRefName: BRANCH,
          headRefOid: HEAD_SHA,
          state: 'OPEN',
          title: 'incidental mention',
          body: incidentalBody,
          closingIssuesReferences: [],
        }))
      }
      return runnerFor(world)(command, args, options)
    }
    await expect(async () => runHandoffWorkflow({
      issueNumber: ISSUE,
      body: JSON.stringify(validRecord()),
      cwd: '/repo',
      env: process.env,
      run: incidentalClaim,
    })).rejects.toMatchObject({ classification: 'EVIDENCE_CONFLICT' })
    expect(world.postCount).toBe(0)

    const textualWorld: World = { comments: [], postCount: 0, calls: [] }
    const textualOwner: HandoffCommandRunner = (command, args, options = {}) => {
      if (command === 'gh' && args[0] === 'pr' && args[1] === 'view') {
        return ok(JSON.stringify({
          number: 412,
          url: PR_URL,
          baseRefName: 'main',
          baseRefOid: BASE_SHA,
          headRefName: BRANCH,
          headRefOid: HEAD_SHA,
          state: 'OPEN',
          title: 'bounded work',
          body: 'Part of #410',
          closingIssuesReferences: [],
        }))
      }
      return runnerFor(textualWorld)(command, args, options)
    }
    const textual = await runHandoffWorkflow({
      issueNumber: ISSUE,
      body: JSON.stringify(validRecord()),
      cwd: '/repo',
      env: process.env,
      run: textualOwner,
    })
    expect(textual).toMatchObject({ classification: 'SUCCESS', mutationPerformed: true })
    expect(textualWorld.postCount).toBe(1)

    const omittedWorld: World = { comments: [], postCount: 0, calls: [] }
    const omittedIncidental: HandoffCommandRunner = (command, args, options = {}) => {
      if (command === 'gh' && args[0] === 'pr' && args[1] === 'list') {
        return ok(JSON.stringify([{
          number: 999,
          state: 'OPEN',
          title: 'unrelated',
          body: incidentalBody,
          closingIssuesReferences: [],
        }]))
      }
      return runnerFor(omittedWorld)(command, args, options)
    }
    const omitted = await runHandoffWorkflow({
      issueNumber: ISSUE,
      body: JSON.stringify(validRecord({ pr: null })),
      cwd: '/repo',
      env: process.env,
      run: omittedIncidental,
    })
    expect(omitted).toMatchObject({ classification: 'SUCCESS', mutationPerformed: true })
    expect(omittedWorld.postCount).toBe(1)
  })

  it('does not alter Issue fields, labels, assignees, branches, PRs, state, receipts, or counters', async () => {
    const world: World & { issueFields: Record<string, unknown> } = {
      comments: [],
      postCount: 0,
      calls: [],
      issueFields: {
        body: 'unchanged',
        labels: ['protocol'],
        assignees: ['boat1994'],
        branches: [BRANCH],
        prs: [412],
      },
    }
    const before = structuredClone(world.issueFields)
    await run(validRecord(), world)
    expect(world.issueFields).toEqual(before)
    expect(world.calls.some((call) => call.command === 'gh' && /issue edit|label|assignee|pr edit|pr merge|receipt|counter|lease|cas|yaml|result|review|repos\/.*\/labels|repos\/.*\/assignees/i.test(call.args.join(' ')))).toBe(false)
  })

  it('fails closed without posting when required local work is dirty', async () => {
    const world: World = { comments: [], postCount: 0, calls: [], dirty: ' M scripts/handoff/workflow.ts\n' }
    await expect(run(validRecord(), world)).rejects.toMatchObject({ classification: 'EVIDENCE_CONFLICT' })
    expect(world.postCount).toBe(0)
  })

  it('requires exact readback before reporting success', async () => {
    const world: World = { comments: [], postCount: 0, calls: [], hideReadback: true }
    await expect(run(validRecord(), world)).rejects.toMatchObject({ classification: 'AMBIGUOUS_RESULT' })
    expect(world.postCount).toBe(1)
  })

  it('fresh-reads an ambiguous POST and recovers exactly one provable comment without retrying', async () => {
    const world: World = { comments: [], postCount: 0, calls: [], failPost: true, acceptFailedPost: true }
    const result = await run(validRecord(), world)

    expect(result).toMatchObject({ classification: 'SUCCESS', mutationPerformed: true, recovered: true })
    expect(result.comment.id).toBe('9001')
    expect(world.postCount).toBe(1)
    expect(world.comments).toHaveLength(1)
  })

  it('classifies an exact identical retry as a no-op without posting again', async () => {
    const firstWorld: World = { comments: [], postCount: 0, calls: [] }
    await run(validRecord(), firstWorld)
    const result = await run(validRecord(), firstWorld)

    expect(result).toMatchObject({ classification: 'NO_OP_IDENTICAL_RETRY', mutationPerformed: false })
    expect(firstWorld.postCount).toBe(1)
    expect(firstWorld.comments).toHaveLength(1)
  })

  it('classifies duplicate matching readback after an ambiguous POST as ambiguous', async () => {
    const world: World = { comments: [], postCount: 0, calls: [], failPost: true, acceptFailedPost: true, duplicateFailedPost: true }

    await expect(run(validRecord(), world)).rejects.toMatchObject({ classification: 'AMBIGUOUS_RESULT' })
    expect(world.postCount).toBe(1)
  })

  it('stops when an ambiguous POST has no uniquely provable outcome', async () => {
    const world: World = { comments: [], postCount: 0, calls: [], failPost: true }
    await expect(run(validRecord(), world)).rejects.toMatchObject({ classification: 'AMBIGUOUS_RESULT' })
    expect(world.postCount).toBe(1)
  })

  it('stops and performs zero mutation if evidence drifts immediately before POST', async () => {
    const world: World = { comments: [], postCount: 0, calls: [] }
    let callCount = 0
    const customRunner: HandoffCommandRunner = (command, args, options = {}) => {
      if (command === 'gh' && args[0] === 'pr' && args[1] === 'view') {
        callCount++
        if (callCount > 1) { // On the second call (pre-POST revalidation)
          return { status: 0, stdout: JSON.stringify({
            number: 412, url: PR_URL, baseRefName: 'main', baseRefOid: BASE_SHA,
            headRefName: BRANCH, headRefOid: 'drifted-sha', state: 'OPEN',
            closingIssuesReferences: [{ number: Number(ISSUE), repository: { nameWithOwner: REPOSITORY } }]
          }), stderr: '', error: null }
        }
        return { status: 0, stdout: JSON.stringify({
          number: 412, url: PR_URL, baseRefName: 'main', baseRefOid: BASE_SHA,
          headRefName: BRANCH, headRefOid: HEAD_SHA, state: 'OPEN',
          closingIssuesReferences: [{ number: Number(ISSUE), repository: { nameWithOwner: REPOSITORY } }]
        }), stderr: '', error: null }
      }
      return runnerFor(world)(command, args, options)
    }
    await expect(async () => runHandoffWorkflow({ issueNumber: ISSUE, body: JSON.stringify(validRecord()), cwd: '/repo', env: process.env, run: customRunner })).rejects.toMatchObject({ classification: 'EVIDENCE_CONFLICT' })
    expect(world.postCount).toBe(0)
  })
})
