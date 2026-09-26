import { describe, expect, it } from 'vitest'

import { runHandoffWorkflow } from '../../scripts/handoff/workflow.ts'
import type { HandoffCommandResult, HandoffCommandRunner } from '../../scripts/handoff/runtime.ts'

const REPOSITORY = 'boat1994/bemoat-web-starter'
const ISSUE = '485'
const BRANCH = 'fix/485-handoff-validation-proof'
const BASE_SHA = 'a'.repeat(40)
const HEAD_SHA = 'b'.repeat(40)
const OLD_HEAD_SHA = 'c'.repeat(40)
const PR_NUMBER = '485'
const PR_URL = `https://github.com/${REPOSITORY}/pull/${PR_NUMBER}`
const ISSUE_URL = `https://github.com/${REPOSITORY}/issues/${ISSUE}`

type Comment = { id: string; html_url: string; body: string }
type World = {
  calls: string[]
  comments: Comment[]
  postCount: number
  files: string[]
  malformedFiles?: boolean
  malformedBranchDiff?: boolean
  unavailableBranchDiff?: boolean
  renamedFile?: boolean
  noPullRequest?: boolean
  dirty: string
  failValidation: boolean
  driftAfterValidation: 'head' | 'remote' | 'dirty' | null
  validationRan: boolean
  headReads: number
  remoteHeadReads: number
}

type ValidationProof = {
  status: string
  tier: string
  command: string
  exact_head: string
}

function validRecord(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 2,
    record_type: 'HANDOFF',
    objective_mode: 'implementation',
    repository: REPOSITORY,
    issue_number: ISSUE,
    objective: 'Prove required validation before publishing HANDOFF.',
    permitted_scope: ['scripts/handoff/', 'tests/int/'],
    prohibited_scope: ['production operations'],
    executing_agent: 'Codex',
    provider: 'OpenAI',
    branch: BRANCH,
    exact_head: HEAD_SHA,
    protected_base: { branch: 'main', sha: BASE_SHA },
    pr: { number: PR_NUMBER, url: PR_URL, base: 'main', head: BRANCH, head_sha: HEAD_SHA },
    verified_evidence: [
      {
        kind: 'validation-proof',
        value: JSON.stringify({
          status: 'PASS',
          tier: 'code',
          command: 'pnpm run bemoat:check',
          exact_head: OLD_HEAD_SHA,
        }),
        url: null as string | null,
      },
    ],
    route: 'IMPLEMENT',
    next_action: { route: 'IMPLEMENT', description: 'Continue the bounded issue objective.' },
    stop_conditions: ['Stop if proof is missing, stale, failed, or ambiguous.'],
    local_durability: { required: true, durable: true, reason: null as string | null },
    ...overrides,
  }
}

function ok(stdout: string): HandoffCommandResult {
  return { status: 0, stdout, stderr: '', error: null }
}

function failure(stderr: string): HandoffCommandResult {
  return { status: 1, stdout: '', stderr, error: null }
}

function world(overrides: Partial<World> = {}): World {
  return {
    calls: [],
    comments: [],
    postCount: 0,
    files: ['src/example.ts'],
    dirty: '',
    failValidation: false,
    driftAfterValidation: null,
    validationRan: false,
    headReads: 0,
    remoteHeadReads: 0,
    ...overrides,
  }
}

function runnerFor(state: World): HandoffCommandRunner {
  return (command, args, options = {}) => {
    const invocation = `${command} ${args.join(' ')}`
    state.calls.push(invocation)

    if (command === 'pnpm') {
      state.validationRan = true
      if (state.failValidation) return failure('required validation failed')
      return ok('validation passed')
    }

    if (command === 'git' && args[0] === 'diff') {
      if (state.unavailableBranchDiff) return failure('git diff unavailable')
      if (state.malformedBranchDiff) return ok(['scripts/validation.ts', 'docs/guide.md'].join(String.fromCharCode(0)))
      const files = state.renamedFile
        ? args.includes('--no-renames')
          ? ['scripts/validation.ts', 'docs/guide.md']
          : ['docs/guide.md']
        : state.files
      return ok(args.includes('-z')
        ? files.map((file) => file + String.fromCharCode(0)).join('')
        : files.join(String.fromCharCode(10)))
    }

    if (command === 'git') {
      const key = args.join(' ')
      if (key === 'remote get-url origin') return ok(`https://github.com/${REPOSITORY}.git\n`)
      if (key === 'branch --show-current') return ok(`${BRANCH}\n`)
      if (key === 'rev-parse HEAD') {
        state.headReads += 1
        if (state.validationRan && state.driftAfterValidation === 'head')
          return ok(`${OLD_HEAD_SHA}\n`)
        return ok(`${HEAD_SHA}\n`)
      }
      if (key === 'status --short') {
        if (state.validationRan && state.driftAfterValidation === 'dirty')
          return ok(' M src/example.ts\n')
        return ok(state.dirty)
      }
      if (key === 'rev-parse --abbrev-ref --symbolic-full-name @{upstream}')
        return ok(`origin/${BRANCH}\n`)
      if (key === `ls-remote --heads origin ${BRANCH}`) {
        state.remoteHeadReads += 1
        if (state.validationRan && state.driftAfterValidation === 'remote')
          return ok(`${OLD_HEAD_SHA}\trefs/heads/${BRANCH}\n`)
        return ok(`${HEAD_SHA}\trefs/heads/${BRANCH}\n`)
      }
      return failure(`unexpected git command: ${key}`)
    }

    if (command !== 'gh') return failure(`unexpected command: ${command}`)
    if (args[0] === 'repo' && args[1] === 'view')
      return ok(JSON.stringify({ nameWithOwner: REPOSITORY }))
    if (args[0] === 'api' && args[1] === `repos/${REPOSITORY}/git/ref/heads/dev`)
      return failure('Not Found')
    if (args[0] === 'api' && args[1] === `repos/${REPOSITORY}/git/ref/heads/main`)
      return ok(JSON.stringify({ object: { sha: BASE_SHA } }))
    if (args[0] === 'api' && args.includes(`repos/${REPOSITORY}/pulls/${PR_NUMBER}/files`)) {
      if (state.malformedFiles) return ok(JSON.stringify([[{ filename: 42 }]]))
      if (state.renamedFile) return ok(JSON.stringify([[{ filename: 'docs/guide.md', previous_filename: 'scripts/validation.ts', status: 'renamed' }]]))
      return ok(JSON.stringify([state.files.map((filename) => ({ filename }))]))
    }
    if (args[0] === 'issue' && args[1] === 'view') {
      return ok(JSON.stringify({ number: Number(ISSUE), url: ISSUE_URL, state: 'OPEN' }))
    }
    if (args[0] === 'pr' && args[1] === 'view') {
      return ok(
        JSON.stringify({
          number: Number(PR_NUMBER),
          url: PR_URL,
          state: 'OPEN',
          baseRefName: 'main',
          baseRefOid: BASE_SHA,
          headRefName: BRANCH,
          headRefOid: HEAD_SHA,
          closingIssuesReferences: [
            { number: Number(ISSUE), repository: { nameWithOwner: REPOSITORY } },
          ],
        }),
      )
    }
    if (args[0] === 'pr' && args[1] === 'list') return ok(state.noPullRequest ? '[]' : JSON.stringify([{
      number: Number(PR_NUMBER),
      state: 'OPEN',
      title: 'Issue #485 work',
      body: 'Closes #485',
      closingIssuesReferences: [{ number: Number(ISSUE), repository: { nameWithOwner: REPOSITORY } }],
    }]))
    if (args[0] === 'pr' && args[1] === 'diff') return ok(state.files.join('\n'))
    if (args[0] === 'api' && args.includes(`repos/${REPOSITORY}/issues/${ISSUE}/comments`)) {
      if (args.includes('--method') && args.includes('POST')) {
        state.postCount += 1
        const payload = JSON.parse(options.input ?? '') as { body: string }
        const id = String(9000 + state.postCount)
        const comment = { id, html_url: `${ISSUE_URL}#issuecomment-${id}`, body: payload.body }
        state.comments.push(comment)
        return ok(JSON.stringify(comment))
      }
      return ok(JSON.stringify([state.comments]))
    }
    return failure(`unexpected gh command: ${args.join(' ')}`)
  }
}

async function publish(state: World, overrides: Record<string, unknown> = {}) {
  return runHandoffWorkflow({
    issueNumber: ISSUE,
    body: JSON.stringify(validRecord(overrides)),
    cwd: '/repo',
    env: process.env,
    run: runnerFor(state),
  })
}

function postedRecord(state: World): Record<string, unknown> {
  const body = state.comments[0]?.body ?? ''
  const json = body.match(/```json\n([\s\S]*?)\n```/)?.[1]
  if (!json) throw new Error('HANDOFF comment did not contain its canonical JSON record')
  return JSON.parse(json) as Record<string, unknown>
}

function generatedProof(state: World): ValidationProof {
  const evidence = postedRecord(state).verified_evidence as Array<{ kind: string; value: string }>
  const proofs = evidence.filter((entry) => entry.kind === 'validation-proof')
  expect(proofs).toHaveLength(1)
  return JSON.parse(proofs[0]!.value) as ValidationProof
}

describe('bemoat:handoff exact-head validation proof', () => {
  it('publishes a no-PR read-only handoff for an empty protected-base diff with a read-only proof', async () => {
    const state = world({ files: [], noPullRequest: true })
    const result = await publish(state, {
      schema_version: 2,
      objective_mode: 'read_only',
      pr: null,
      verified_evidence: [{ kind: 'review', value: 'Inspected current state.', url: null }],
    })

    expect(state.calls).toContain('pnpm run bemoat:guard:safety')
    expect(state.calls).not.toContain('pnpm run bemoat:check')
    expect(generatedProof(state)).toEqual({
      status: 'PASS',
      tier: 'read-only',
      command: 'pnpm run bemoat:guard:safety',
      exact_head: HEAD_SHA,
    })
    expect(state.postCount).toBe(1)
    expect(result.comment.body).toBe(result.body)
  })

  it('rejects a read-only record when an applicable PR exists', async () => {
    const state = world({ files: [], noPullRequest: false })
    await expect(publish(state, { schema_version: 2, objective_mode: 'read_only', pr: null }))
      .rejects.toMatchObject({ classification: 'EVIDENCE_CONFLICT' })
    expect(state.postCount).toBe(0)
  })

  it('rejects non-empty protected-base changes in read-only mode', async () => {
    const state = world({ files: ['src/example.ts'], noPullRequest: true })
    await expect(publish(state, { schema_version: 2, objective_mode: 'read_only', pr: null }))
      .rejects.toMatchObject({ classification: 'EVIDENCE_CONFLICT' })
    expect(state.calls.filter((call) => call.startsWith('pnpm '))).toHaveLength(0)
    expect(state.postCount).toBe(0)
  })

  it('keeps implementation mode fail-closed for an empty no-PR diff', async () => {
    const state = world({ files: [], noPullRequest: true })
    await expect(publish(state, { pr: null }))
      .rejects.toMatchObject({ classification: 'EVIDENCE_CONFLICT' })
    expect(state.postCount).toBe(0)
  })

  it('generates exact-head proof when caller evidence has no validation proof', async () => {
    const state = world()
    await publish(state, {
      verified_evidence: [{ kind: 'focused-tests', value: 'Focused tests passed.', url: null }],
    })

    expect(state.calls).toContain('pnpm run bemoat:check')
    expect(generatedProof(state)).toEqual({
      status: 'PASS',
      tier: 'code',
      command: 'pnpm run bemoat:check',
      exact_head: HEAD_SHA,
    })
  })

  it('reruns validation when the supplied proof belongs to an older head', async () => {
    const state = world()
    await publish(state, {
      verified_evidence: [
        {
          kind: 'validation-proof',
          value: JSON.stringify({
            status: 'PASS',
            tier: 'code',
            command: 'pnpm run bemoat:check',
            exact_head: OLD_HEAD_SHA,
          }),
          url: null,
        },
      ],
    })

    expect(state.calls).toContain('pnpm run bemoat:check')
    expect(generatedProof(state).exact_head).toBe(HEAD_SHA)
  })

  it('replaces caller-forged PASS proof even when it claims the current exact head', async () => {
    const state = world()
    await publish(state, {
      verified_evidence: [{
        kind: 'validation-proof',
        value: JSON.stringify({ status: 'PASS', tier: 'docs-only', command: 'pnpm run bemoat:guard:safety', exact_head: HEAD_SHA }),
        url: null,
      }],
    })

    expect(generatedProof(state)).toEqual({
      status: 'PASS',
      tier: 'code',
      command: 'pnpm run bemoat:check',
      exact_head: HEAD_SHA,
    })
  })

  it.each([
    ['empty', []],
    ['unknown', ['fixtures/reference.bin']],
  ])('fails closed when authoritative PR file evidence is %s', async (_label, files) => {
    const state = world({ files })
    await expect(publish(state)).rejects.toMatchObject({ classification: 'EVIDENCE_CONFLICT' })
    expect(state.calls.filter((call) => call.startsWith('pnpm '))).toHaveLength(0)
    expect(state.postCount).toBe(0)
  })

  it('fails closed when authoritative PR file evidence is malformed', async () => {
    const state = world({ malformedFiles: true })
    await expect(publish(state)).rejects.toMatchObject({ classification: 'EVIDENCE_CONFLICT' })
    expect(state.calls.filter((call) => call.startsWith('pnpm '))).toHaveLength(0)
    expect(state.postCount).toBe(0)
  })

  it('rejects a failed required validation command without publishing a comment', async () => {
    const state = world({ failValidation: true })

    await expect(publish(state)).rejects.toThrow(/validation/i)

    expect(state.calls).toContain('pnpm run bemoat:check')
    expect(state.postCount).toBe(0)
  })

  it('fails closed for an unsupported file type even under docs/', async () => {
    const state = world({ files: ['docs/reference.bin'] })
    await expect(publish(state)).rejects.toMatchObject({ classification: 'EVIDENCE_CONFLICT' })
    expect(state.calls.filter((call) => call.startsWith('pnpm '))).toHaveLength(0)
    expect(state.postCount).toBe(0)
  })

  it('uses code validation for executable GitHub composite actions', async () => {
    const state = world({ files: ['.github/actions/check/action.yml'] })
    await publish(state)
    expect(state.calls).toContain('pnpm run bemoat:check')
    expect(generatedProof(state).tier).toBe('code')
  })

  it('uses code validation when a PR renames code to a Markdown path', async () => {
    const state = world({ renamedFile: true })
    await publish(state)
    expect(state.calls).toContain('pnpm run bemoat:check')
    expect(generatedProof(state).tier).toBe('code')
  })

  it('uses code validation for a code-to-Markdown rename when no PR is attached', async () => {
    const state = world({ renamedFile: true, noPullRequest: true })
    await publish(state, { pr: null })

    expect(state.calls).toContain('pnpm run bemoat:check')
    expect(state.calls.some((call) => call.startsWith('git diff --name-only --no-renames -z '))).toBe(true)
    expect(state.calls).not.toContain('pnpm run bemoat:guard:safety')
    expect(generatedProof(state).tier).toBe('code')
  })

  it.each([
    ['malformed', { malformedBranchDiff: true }, 'EVIDENCE_CONFLICT'],
    ['unavailable', { unavailableBranchDiff: true }, 'BLOCKED_EXTERNAL'],
  ] as const)('fails closed when no-PR NUL-delimited changed-file evidence is %s', async (_label, evidence, classification) => {
    const state = world({ ...evidence, noPullRequest: true })
    await expect(publish(state, { pr: null })).rejects.toMatchObject({ classification })

    expect(state.calls.filter((call) => call.startsWith('pnpm '))).toHaveLength(0)
    expect(state.postCount).toBe(0)
  })

  it('runs docs-only safety validation and records proof for the exact head', async () => {
    const state = world({ files: ['docs/agent-loop/example.md', '.github/workflows/ci.yml'] })
    await publish(state)

    expect(state.calls).toContain('pnpm run bemoat:guard:safety')
    expect(state.calls).not.toContain('pnpm run bemoat:check')
    expect(generatedProof(state)).toEqual({
      status: 'PASS',
      tier: 'docs-only',
      command: 'pnpm run bemoat:guard:safety',
      exact_head: HEAD_SHA,
    })
  })

  it('uses code validation when a docs path contains a code file', async () => {
    const state = world({ files: ['docs/validation-helper.ts'] })
    await publish(state)

    expect(state.calls).toContain('pnpm run bemoat:check')
    expect(generatedProof(state).tier).toBe('code')
  })

  it('runs code validation for code changes and records proof for the exact head', async () => {
    const state = world({ files: ['tests/int/example.int.spec.ts'] })
    await publish(state)

    expect(state.calls).toContain('pnpm run bemoat:check')
    expect(state.calls).not.toContain('pnpm run bemoat:guard:safety')
    expect(generatedProof(state)).toEqual({
      status: 'PASS',
      tier: 'code',
      command: 'pnpm run bemoat:check',
      exact_head: HEAD_SHA,
    })
  })

  it('keeps dirty executing worktree fail-closed before validation or publication', async () => {
    const state = world({ dirty: ' M scripts/handoff/workflow.ts\n' })

    await expect(publish(state)).rejects.toThrow(/dirty|durable/i)

    expect(state.calls.filter((call) => call.startsWith('pnpm '))).toHaveLength(0)
    expect(state.postCount).toBe(0)
  })

  it.each([
    ['clean', ''],
    ['dirty', ' M scripts/handoff/workflow.ts' + String.fromCharCode(10)],
  ])('rejects a HANDOFF without branch and exact HEAD bindings before validation on a %s worktree', async (_label, dirty) => {
    const state = world({ dirty, noPullRequest: true })

    await expect(publish(state, {
      branch: null,
      exact_head: null,
      pr: null,
      local_durability: { required: false, durable: false, reason: null },
    })).rejects.toMatchObject({ classification: 'EVIDENCE_CONFLICT' })

    expect(state.calls.filter((call) => call.startsWith('pnpm '))).toHaveLength(0)
    expect(state.postCount).toBe(0)
  })

  it.each([
    ['local HEAD', 'head'],
    ['pushed upstream HEAD', 'remote'],
    ['executing worktree cleanliness', 'dirty'],
  ] as const)(
    'rejects %s drift after validation and before comment publication',
    async (_label, driftAfterValidation) => {
      const state = world({ driftAfterValidation })

      await expect(publish(state)).rejects.toThrow(/head|pushed|drift|dirty|durable/i)

      expect(state.calls).toContain('pnpm run bemoat:check')
      expect(state.postCount).toBe(0)
    },
  )
})
