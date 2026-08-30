/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars -- test mocks */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { main } from '../../scripts/mission-control/workflows/authorize-founder.mjs'
import * as mergeGithub from '../../scripts/mission-control/adapters/merge-github.mjs'
import * as taskBootstrapGithub from '../../scripts/mission-control/adapters/task-bootstrap-github.mjs'

vi.mock('../../scripts/mission-control/adapters/merge-github.mjs', () => ({
  defaultRunGh: vi.fn(),
  readProtectedRef: vi.fn(),
}))

vi.mock('../../scripts/mission-control/adapters/task-bootstrap-github.mjs', () => ({
  createTaskBootstrapGithubAdapter: vi.fn(),
}))

describe('authorize-founder workflow', () => {
  let stdoutData = ''
  let stderrData = ''
  let originalStdoutWrite: typeof process.stdout.write
  let originalStderrWrite: typeof process.stderr.write

  beforeEach(() => {
    vi.clearAllMocks()
    stdoutData = ''
    stderrData = ''
    originalStdoutWrite = process.stdout.write
    originalStderrWrite = process.stderr.write
    process.stdout.write = (chunk: string | Uint8Array) => {
      stdoutData += chunk.toString()
      return true
    }
    process.stderr.write = (chunk: string | Uint8Array) => {
      stderrData += chunk.toString()
      return true
    }
    process.env.GITHUB_REPOSITORY = 'boat1994/bemoat-web-starter'
  })

  afterEach(() => {
    process.stdout.write = originalStdoutWrite
    process.stderr.write = originalStderrWrite
  })

  it('non-managed happy path uses the canonical valid REVIEW_VERDICT representation', async () => {
    const recordedComments: Array<Record<string, unknown>> = []
    const runGhMock = vi.mocked(mergeGithub.defaultRunGh)
    runGhMock.mockImplementation((args: string[]) => {
      const argsStr = args.join(' ')
      if (argsStr.includes('issue view 100 --repo boat1994/bemoat-web-starter --json number,body')) {
        return JSON.stringify({
          number: 100,
          body: 'This is a non-managed standard issue.\n\nTask tier: Core\nMission Control mode: optional\nExpected profile: STANDARD',
        })
      }
      if (argsStr.includes('pr view 101 --repo boat1994/bemoat-web-starter')) {
        return JSON.stringify({ number: 101, state: 'OPEN', baseRefName: 'main', headRefOid: '1111111111111111111111111111111111111111' })
      }
      if (argsStr.includes('api --paginate --slurp repos/boat1994/bemoat-web-starter/issues/100/comments?per_page=100')) {
        return JSON.stringify([[
      {
            id: 111,
            body: '## REVIEW_VERDICT\n\n**Task / Issue:** #100\n**Verdict:** ELIGIBLE FOR FOUNDER REVIEW\n**PR / base / head:** PR #101 · `main` · `1111111111111111111111111111111111111111`',
          },
        ]])
      }
      if (argsStr.includes('api user')) {
        return JSON.stringify({ login: 'boat1994' })
      }
      if (argsStr.includes('repos/boat1994/bemoat-web-starter/actions/variables/BEMOAT_FOUNDER_LOGINS')) {
        return JSON.stringify({ value: 'boat1994' })
      }
      return '{}'
    })

    const readProtectedRefMock = vi.mocked(mergeGithub.readProtectedRef)
    readProtectedRefMock.mockResolvedValue({ object: { sha: '3333333333333333333333333333333333333333' } } as any)

    const adapterMock = {
      acquireIssueLease: vi.fn().mockResolvedValue('lease-123'),
      releaseIssueLease: vi.fn().mockResolvedValue(null),
      getPolicy: vi.fn().mockResolvedValue({
        path: 'docs/mission-control/mission-control-guide.md',
        version: '1.3.0',
        blobSha: '2222222222222222222222222222222222222222',
        sourceCommit: '3333333333333333333333333333333333333333',
        content: 'canonical_repository: boat1994/bemoat-web-starter\nMission Control mode: required\n| Medium/Core | STANDARD |',
      }),
      getIssueComments: vi.fn(async () => recordedComments),
      postIssueComment: vi.fn(async (issueNumber: number, body: string) => {
        const comment = {
          id: 999 + recordedComments.length,
          body,
          user: { login: 'boat1994' },
          issue_number: issueNumber,
          created_at: '2026-08-22T00:00:00Z',
          updated_at: '2026-08-22T00:00:00Z',
        }
        recordedComments.push(comment)
        return comment
      }),
      getIssueComment: vi.fn(async (id: string | number) => recordedComments.find((comment) => String(comment.id) === String(id))),
    }
    vi.mocked(taskBootstrapGithub.createTaskBootstrapGithubAdapter).mockReturnValue(adapterMock as any)

    await main(['100', '--scope', 'merge', '--json'])

    expect(stdoutData).toContain('"classification":"SUCCESS"')
    expect(stdoutData).toContain('"type":"FOUNDER_GATE","command":null')
    expect(process.exitCode).toBe(0)
    expect(adapterMock.getIssueComments).toHaveBeenCalled()
    expect(adapterMock.postIssueComment).toHaveBeenCalled()
    expect(adapterMock.getIssueComment).toHaveBeenCalled()
    expect(runGhMock.mock.calls.some((args) => args[0]?.includes('-X') && args[0]?.includes('POST'))).toBe(false)
  })

  it('fails closed for non-managed path with base@sha negative coverage', async () => {
    const runGhMock = vi.mocked(mergeGithub.defaultRunGh)
    runGhMock.mockImplementation((args: string[]) => {
      const argsStr = args.join(' ')
      if (argsStr.includes('issue view 100 --repo boat1994/bemoat-web-starter --json number,body')) {
        return JSON.stringify({
          number: 100,
          body: 'This is a non-managed standard issue.\n\nTask size: Core\nMission Control mode: optional',
        })
      }
      if (argsStr.includes('pr view 101 --repo boat1994/bemoat-web-starter')) {
        return JSON.stringify({ number: 101, state: 'OPEN', baseRefName: 'main', headRefOid: '1111111111111111111111111111111111111111' })
      }
      if (argsStr.includes('api --paginate --slurp repos/boat1994/bemoat-web-starter/issues/100/comments?per_page=100')) {
        return JSON.stringify([[
          {
            id: 111,
            body: '## REVIEW_VERDICT\n\n**Task / Issue:** #100\n**Verdict:** ELIGIBLE FOR FOUNDER REVIEW\n**PR / base / head:** PR #101 · `main@2222222222222222222222222222222222222222` · `1111111111111111111111111111111111111111`',
          },
        ]])
      }
      if (argsStr.includes('api user')) {
        return JSON.stringify({ login: 'boat1994' })
      }
      if (argsStr.includes('repos/boat1994/bemoat-web-starter/actions/variables/BEMOAT_FOUNDER_LOGINS')) {
        return JSON.stringify({ value: 'boat1994' })
      }
      return '{}'
    })

    const readProtectedRefMock = vi.mocked(mergeGithub.readProtectedRef)
    readProtectedRefMock.mockResolvedValue({ object: { sha: '3333333333333333333333333333333333333333' } } as any)

    const adapterMock = {
      acquireIssueLease: vi.fn().mockResolvedValue('lease-123'),
      releaseIssueLease: vi.fn().mockResolvedValue(null),
      getPolicy: vi.fn().mockResolvedValue({
        path: 'docs/mission-control/mission-control-guide.md',
        version: '1.3.0',
        blobSha: '2222222222222222222222222222222222222222',
        sourceCommit: '3333333333333333333333333333333333333333',
        content: 'canonical_repository: boat1994/bemoat-web-starter\nMission Control mode: required\n| Medium/Core | STANDARD |',
      }),
    }
    vi.mocked(taskBootstrapGithub.createTaskBootstrapGithubAdapter).mockReturnValue(adapterMock as any)

    await main(['100', '--scope', 'merge', '--json'])

    expect(stdoutData).toContain('"classification":"STATE_CONFLICT"')
    expect(stdoutData).toContain('malformed, partial, or ambiguous')
    expect(process.exitCode).toBe(3)
  })

  it('selects the open PR when a historical merged PR verdict is present', async () => {
    const recordedComments: Array<Record<string, unknown>> = []
    const runGhMock = vi.mocked(mergeGithub.defaultRunGh)
    runGhMock.mockImplementation((args: string[]) => {
      const argsStr = args.join(' ')
      if (argsStr.includes('issue view 100 --repo boat1994/bemoat-web-starter --json number,body')) {
        return JSON.stringify({ number: 100, body: 'This is a non-managed standard issue.\n\nTask tier: Core\nMission Control mode: optional\nExpected profile: STANDARD' })
      }
      if (argsStr.includes('pr view 101 --repo boat1994/bemoat-web-starter')) {
        return JSON.stringify({ number: 101, state: 'OPEN', baseRefName: 'main', headRefOid: '1111111111111111111111111111111111111111' })
      }
      if (argsStr.includes('pr view 102 --repo boat1994/bemoat-web-starter')) {
        return JSON.stringify({ number: 102, state: 'MERGED', baseRefName: 'main', headRefOid: '2222222222222222222222222222222222222222' })
      }
      if (argsStr.includes('api --paginate --slurp repos/boat1994/bemoat-web-starter/issues/100/comments?per_page=100')) {
        return JSON.stringify([[
          { id: 111, body: '## REVIEW_VERDICT\n\n**Task / Issue:** #100\n**Verdict:** ELIGIBLE FOR FOUNDER REVIEW\n**PR / base / head:** PR #101 · `main` · `1111111111111111111111111111111111111111`' },
          { id: 112, body: '## REVIEW_VERDICT\n\n**Task / Issue:** #100\n**Verdict:** ELIGIBLE FOR FOUNDER REVIEW\n**PR / base / head:** PR #102 · `main` · `2222222222222222222222222222222222222222`' },
        ]])
      }
      if (argsStr.includes('api user')) return JSON.stringify({ login: 'boat1994' })
      if (argsStr.includes('repos/boat1994/bemoat-web-starter/actions/variables/BEMOAT_FOUNDER_LOGINS')) return JSON.stringify({ value: 'boat1994' })
      return '{}'
    })

    const readProtectedRefMock = vi.mocked(mergeGithub.readProtectedRef)
    readProtectedRefMock.mockResolvedValue({ object: { sha: '3333333333333333333333333333333333333333' } } as any)
    const adapterMock = {
      acquireIssueLease: vi.fn().mockResolvedValue('lease-123'), releaseIssueLease: vi.fn().mockResolvedValue(null),
      getPolicy: vi.fn().mockResolvedValue({ path: 'docs/mission-control/mission-control-guide.md', version: '1.3.0', blobSha: '2222222222222222222222222222222222222222', sourceCommit: '3333333333333333333333333333333333333333', content: 'canonical_repository: boat1994/bemoat-web-starter\nMission Control mode: required\n| Medium/Core | STANDARD |' }),
      getIssueComments: vi.fn(async () => recordedComments),
      postIssueComment: vi.fn(async (issueNumber: number, body: string) => {
        const comment = { id: 999 + recordedComments.length, body, user: { login: 'boat1994' }, issue_number: issueNumber, created_at: '2026-08-22T00:00:00Z', updated_at: '2026-08-22T00:00:00Z' }
        recordedComments.push(comment)
        return comment
      }),
      getIssueComment: vi.fn(async (id: string | number) => recordedComments.find((comment) => String(comment.id) === String(id))),
    }
    vi.mocked(taskBootstrapGithub.createTaskBootstrapGithubAdapter).mockReturnValue(adapterMock as any)

    await main(['100', '--scope', 'merge', '--json'])
    expect(stdoutData).toContain('"classification":"SUCCESS"')
    expect(stdoutData).toContain('"type":"FOUNDER_GATE","command":null')
    expect(process.exitCode).toBe(0)
  })

  it('fails closed when multiple open PRs exist', async () => {
    const runGhMock = vi.mocked(mergeGithub.defaultRunGh)
    runGhMock.mockImplementation((args: string[]) => {
      const argsStr = args.join(' ')
      if (argsStr.includes('issue view 100 --repo boat1994/bemoat-web-starter --json number,body')) {
        return JSON.stringify({ number: 100, body: 'This is a non-managed standard issue.\n\nTask tier: Core\nMission Control mode: optional\nExpected profile: STANDARD' })
      }
      if (argsStr.includes('pr view 101 --repo boat1994/bemoat-web-starter')) {
        return JSON.stringify({ number: 101, state: 'OPEN', baseRefName: 'main', headRefOid: '1111111111111111111111111111111111111111' })
      }
      if (argsStr.includes('pr view 102 --repo boat1994/bemoat-web-starter')) {
        return JSON.stringify({ number: 102, state: 'OPEN', baseRefName: 'main', headRefOid: '2222222222222222222222222222222222222222' })
      }
      if (argsStr.includes('api --paginate --slurp repos/boat1994/bemoat-web-starter/issues/100/comments?per_page=100')) {
        return JSON.stringify([[
          { id: 111, body: '## REVIEW_VERDICT\n\n**Task / Issue:** #100\n**Verdict:** ELIGIBLE FOR FOUNDER REVIEW\n**PR / base / head:** PR #101 · `main` · `1111111111111111111111111111111111111111`' },
          { id: 112, body: '## REVIEW_VERDICT\n\n**Task / Issue:** #100\n**Verdict:** ELIGIBLE FOR FOUNDER REVIEW\n**PR / base / head:** PR #102 · `main` · `2222222222222222222222222222222222222222`' },
        ]])
      }
      return '{}'
    })
    const readProtectedRefMock = vi.mocked(mergeGithub.readProtectedRef)
    readProtectedRefMock.mockResolvedValue({ object: { sha: '3333333333333333333333333333333333333333' } } as any)
    const adapterMock = { getPolicy: vi.fn().mockResolvedValue({ path: 'docs/mission-control/mission-control-guide.md', version: '1.3.0', blobSha: '2222222222222222222222222222222222222222', sourceCommit: '3333333333333333333333333333333333333333', content: 'canonical_repository: boat1994/bemoat-web-starter\nMission Control mode: required\n| Medium/Core | STANDARD |' }) }
    vi.mocked(taskBootstrapGithub.createTaskBootstrapGithubAdapter).mockReturnValue(adapterMock as any)

    await main(['100', '--scope', 'merge', '--json'])
    expect(stdoutData).toContain('"classification":"STATE_CONFLICT"')
    expect(stdoutData).toContain('STANDARD authorization requires exactly one canonical active REVIEW_VERDICT PR target')
    expect(process.exitCode).toBe(3)
  })

  it('fails closed when only merged historical targets exist', async () => {
    const runGhMock = vi.mocked(mergeGithub.defaultRunGh)
    runGhMock.mockImplementation((args: string[]) => {
      const argsStr = args.join(' ')
      if (argsStr.includes('issue view 100 --repo boat1994/bemoat-web-starter --json number,body')) {
        return JSON.stringify({ number: 100, body: 'This is a non-managed standard issue.\n\nTask tier: Core\nMission Control mode: optional\nExpected profile: STANDARD' })
      }
      if (argsStr.includes('pr view 101 --repo boat1994/bemoat-web-starter')) {
        return JSON.stringify({ number: 101, state: 'MERGED', baseRefName: 'main', headRefOid: '1111111111111111111111111111111111111111' })
      }
      if (argsStr.includes('api --paginate --slurp repos/boat1994/bemoat-web-starter/issues/100/comments?per_page=100')) {
        return JSON.stringify([[
          { id: 111, body: '## REVIEW_VERDICT\n\n**Task / Issue:** #100\n**Verdict:** ELIGIBLE FOR FOUNDER REVIEW\n**PR / base / head:** PR #101 · `main` · `1111111111111111111111111111111111111111`' },
        ]])
      }
      return '{}'
    })
    const readProtectedRefMock = vi.mocked(mergeGithub.readProtectedRef)
    readProtectedRefMock.mockResolvedValue({ object: { sha: '3333333333333333333333333333333333333333' } } as any)
    const adapterMock = { getPolicy: vi.fn().mockResolvedValue({ path: 'docs/mission-control/mission-control-guide.md', version: '1.3.0', blobSha: '2222222222222222222222222222222222222222', sourceCommit: '3333333333333333333333333333333333333333', content: 'canonical_repository: boat1994/bemoat-web-starter\nMission Control mode: required\n| Medium/Core | STANDARD |' }) }
    vi.mocked(taskBootstrapGithub.createTaskBootstrapGithubAdapter).mockReturnValue(adapterMock as any)

    await main(['100', '--scope', 'merge', '--json'])
    expect(stdoutData).toContain('"classification":"STATE_CONFLICT"')
    expect(stdoutData).toContain('STANDARD authorization requires exactly one canonical active REVIEW_VERDICT PR target')
    expect(process.exitCode).toBe(3)
  })

  it('selects the open PR when a CLOSED unmerged PR verdict is present', async () => {
    const recordedComments: Array<Record<string, unknown>> = []
    const runGhMock = vi.mocked(mergeGithub.defaultRunGh)
    runGhMock.mockImplementation((args: string[]) => {
      const argsStr = args.join(' ')
      if (argsStr.includes('issue view 100 --repo boat1994/bemoat-web-starter --json number,body')) {
        return JSON.stringify({ number: 100, body: 'This is a non-managed standard issue.\n\nTask tier: Core\nMission Control mode: optional\nExpected profile: STANDARD' })
      }
      if (argsStr.includes('pr view 101 --repo boat1994/bemoat-web-starter')) {
        return JSON.stringify({ number: 101, state: 'OPEN', baseRefName: 'main', headRefOid: '1111111111111111111111111111111111111111' })
      }
      if (argsStr.includes('pr view 102 --repo boat1994/bemoat-web-starter')) {
        return JSON.stringify({ number: 102, state: 'CLOSED', baseRefName: 'main', headRefOid: '2222222222222222222222222222222222222222' })
      }
      if (argsStr.includes('api --paginate --slurp repos/boat1994/bemoat-web-starter/issues/100/comments?per_page=100')) {
        return JSON.stringify([[
          { id: 111, body: '## REVIEW_VERDICT\n\n**Task / Issue:** #100\n**Verdict:** ELIGIBLE FOR FOUNDER REVIEW\n**PR / base / head:** PR #101 · `main` · `1111111111111111111111111111111111111111`' },
          { id: 112, body: '## REVIEW_VERDICT\n\n**Task / Issue:** #100\n**Verdict:** ELIGIBLE FOR FOUNDER REVIEW\n**PR / base / head:** PR #102 · `main` · `2222222222222222222222222222222222222222`' },
        ]])
      }
      if (argsStr.includes('api user')) return JSON.stringify({ login: 'boat1994' })
      if (argsStr.includes('repos/boat1994/bemoat-web-starter/actions/variables/BEMOAT_FOUNDER_LOGINS')) return JSON.stringify({ value: 'boat1994' })
      return '{}'
    })

    const readProtectedRefMock = vi.mocked(mergeGithub.readProtectedRef)
    readProtectedRefMock.mockResolvedValue({ object: { sha: '3333333333333333333333333333333333333333' } } as any)
    const adapterMock = {
      acquireIssueLease: vi.fn().mockResolvedValue('lease-123'), releaseIssueLease: vi.fn().mockResolvedValue(null),
      getPolicy: vi.fn().mockResolvedValue({ path: 'docs/mission-control/mission-control-guide.md', version: '1.3.0', blobSha: '2222222222222222222222222222222222222222', sourceCommit: '3333333333333333333333333333333333333333', content: 'canonical_repository: boat1994/bemoat-web-starter\nMission Control mode: required\n| Medium/Core | STANDARD |' }),
      getIssueComments: vi.fn(async () => recordedComments),
      postIssueComment: vi.fn(async (issueNumber: number, body: string) => {
        const comment = { id: 999 + recordedComments.length, body, user: { login: 'boat1994' }, issue_number: issueNumber, created_at: '2026-08-22T00:00:00Z', updated_at: '2026-08-22T00:00:00Z' }
        recordedComments.push(comment)
        return comment
      }),
      getIssueComment: vi.fn(async (id: string | number) => recordedComments.find((comment) => String(comment.id) === String(id))),
    }
    vi.mocked(taskBootstrapGithub.createTaskBootstrapGithubAdapter).mockReturnValue(adapterMock as any)

    await main(['100', '--scope', 'merge', '--json'])
    expect(stdoutData).toContain('"classification":"SUCCESS"')
    expect(stdoutData).toContain('"type":"FOUNDER_GATE","command":null')
    expect(process.exitCode).toBe(0)
  })
})
