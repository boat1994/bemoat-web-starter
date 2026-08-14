import { afterEach, describe, expect, it, vi } from 'vitest'

const { runMock } = vi.hoisted(() => ({
  runMock: vi.fn(),
}))

vi.mock('../../../scripts/agent-issue/process-runner.ts', () => ({
  run: runMock,
}))

const originalGhRepo = process.env.GH_REPO

afterEach(() => {
  runMock.mockReset()
  if (originalGhRepo === undefined) {
    delete process.env.GH_REPO
  } else {
    process.env.GH_REPO = originalGhRepo
  }
})

async function loadGithubEvidence() {
  return import('../../../scripts/agent-issue/github-evidence.mjs')
}

describe('Cluster D characterization (issue #333) — github-evidence', () => {
  const cwd = '/tmp/repo'
  const env = { GH_REPO: 'boat1994/bemoat-web-starter' } as unknown as NodeJS.ProcessEnv

  it('fetchIssueMetadata has unique result.error handling', async () => {
    const { fetchIssueMetadata } = await loadGithubEvidence()
    runMock.mockReturnValue({
      status: 0,
      stdout: '{}',
      stderr: '',
      error: new Error('gh missing'),
    })
    expect(fetchIssueMetadata(cwd, 1, env)).toEqual({
      available: false,
      reason: 'GitHub CLI is unavailable: gh missing',
    })
  })

  it('fetchIssueMetadata accepts any JSON value and preserves labels edge cases', async () => {
    const { fetchIssueMetadata } = await loadGithubEvidence()
    runMock.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({ title: 'T', url: 'https://github.com/x/y/issues/1', body: 0, labels: ['x'] }),
      stderr: '',
      error: null,
    })
    expect(fetchIssueMetadata(cwd, 1, env)).toMatchObject({
      available: true,
      body: 0,
      labels: [undefined],
    })

    runMock.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({ title: 'T', url: 'https://x', labels: [null] }),
      stderr: '',
      error: null,
    })
    expect(fetchIssueMetadata(cwd, 1, env)).toMatchObject({
      available: false,
      reason: expect.stringContaining("reading 'name'"),
    })

    runMock.mockReturnValue({ status: 0, stdout: 'null', stderr: '', error: null })
    expect(fetchIssueMetadata(cwd, 1, env)).toEqual({
      available: false,
      title: null,
      url: null,
      body: '',
      labels: [],
      reason: 'GitHub CLI response was missing issue metadata.',
    })
  })

  it('fetchIssueByReference does not inspect result.error and includes reference on failure', async () => {
    const { fetchIssueByReference } = await loadGithubEvidence()
    runMock.mockReturnValue({
      status: 1,
      stdout: '',
      stderr: '',
      error: new Error('ENOENT'),
    })
    const result = fetchIssueByReference(cwd, '#12', env)
    expect(result).toMatchObject({
      ok: false,
      reason: 'GitHub issue lookup failed.',
      reference: { number: '12', repo: 'boat1994/bemoat-web-starter' },
    })
  })

  it('fetchIssueComments falsy issue numbers and JSON null TypeError', async () => {
    const { fetchIssueComments } = await loadGithubEvidence()
    expect(fetchIssueComments(cwd, 0, env)).toEqual({
      ok: false,
      reason: 'Issue number is required for comment lookup.',
    })
    expect(fetchIssueComments(cwd, null as unknown as number, env)).toEqual({
      ok: false,
      reason: 'Issue number is required for comment lookup.',
    })

    runMock.mockReturnValue({ status: 0, stdout: 'null', stderr: '', error: null })
    expect(fetchIssueComments(cwd, '1', env)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("reading 'comments'"),
    })

    runMock.mockReturnValue({ status: 0, stdout: '"x"', stderr: '', error: null })
    expect(fetchIssueComments(cwd, '1', env)).toEqual({ ok: true, comments: [] })
  })

  it('parseGhPrListPayload preserves exact reason strings', async () => {
    const { parseGhPrListPayload } = await loadGithubEvidence()
    expect(parseGhPrListPayload('not-json')).toEqual({
      ok: false,
      reason: 'malformed GitHub PR list JSON',
    })
    expect(parseGhPrListPayload('{}')).toEqual({
      ok: false,
      reason: 'GitHub PR list evidence is not an array',
    })
    expect(parseGhPrListPayload('[]')).toEqual({ ok: true, openPrs: [] })
  })

  it('prClosesIssue matches number:0 against issue "0"', async () => {
    const { prClosesIssue } = await loadGithubEvidence()
    expect(prClosesIssue({ closingIssuesReferences: [{ number: 0 }] }, '0')).toBe(true)
    expect(prClosesIssue({ closingIssuesReferences: 'nope' }, 1)).toBe(false)
  })

  it('checkOpenPrsForIssueOrBranch uses process.env for search repo quirk', async () => {
    const { checkOpenPrsForIssueOrBranch } = await loadGithubEvidence()
    process.env.GH_REPO = 'process-env/repo'
    const childEnv = { GH_REPO: 'child-env/repo' } as unknown as NodeJS.ProcessEnv

    runMock.mockImplementation((_cmd, args: string[]) => {
      if (args.includes('--search')) {
        expect(args).toContain('closes #99 repo:process-env/repo')
      }
      return {
        status: 0,
        stdout: JSON.stringify([{ number: 99, headRefName: 'other', closingIssuesReferences: [] }]),
        stderr: '',
        error: null,
      }
    })

    const result = checkOpenPrsForIssueOrBranch(cwd, childEnv, null, 99)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.openPrs).toHaveLength(1)
    }
  })

  it('checkOpenPrsForIssueOrBranch keeps empty repo token when getDefaultRepo is null', async () => {
    const { checkOpenPrsForIssueOrBranch } = await loadGithubEvidence()
    delete process.env.GH_REPO
    runMock.mockImplementation((_cmd, args: string[]) => {
      if (args.includes('--search')) {
        expect(args).toContain('closes #5 repo:')
      }
      return { status: 0, stdout: '[]', stderr: '', error: null }
    })
    runMock.mockReturnValue({ status: 0, stdout: '[]', stderr: '', error: null })
    expect(checkOpenPrsForIssueOrBranch(cwd, {} as unknown as NodeJS.ProcessEnv, null, 5)).toEqual({ ok: true, openPrs: [] })
  })
})
