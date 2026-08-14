import { afterEach, describe, expect, it, vi } from 'vitest'

const { runMock } = vi.hoisted(() => ({
  runMock: vi.fn(),
}))

vi.mock('../../../scripts/agent-issue/process-runner.ts', () => ({
  run: runMock,
}))

afterEach(() => {
  runMock.mockReset()
})

async function loadLocalGitEvidence() {
  return import('../../../scripts/agent-issue/local-git-evidence.mjs')
}

describe('Cluster D characterization (issue #333) — local-git-evidence', () => {
  it('getCurrentBranch ignores status/error and defaults detached to <detached>', async () => {
    const { getCurrentBranch } = await loadLocalGitEvidence()
    runMock.mockReturnValue({ status: 1, stdout: '', stderr: 'fail', error: new Error('fail') })
    expect(getCurrentBranch()).toBe('<detached>')

    runMock.mockReturnValue({ status: 0, stdout: '  feature/x  \n', stderr: '', error: null })
    expect(getCurrentBranch()).toBe('feature/x')
  })

  it('getStatusShort trims end only and returns empty string on failed git', async () => {
    const { getStatusShort } = await loadLocalGitEvidence()
    runMock.mockReturnValue({ status: 1, stdout: '', stderr: 'err', error: null })
    expect(getStatusShort()).toBe('')

    runMock.mockReturnValue({ status: 0, stdout: ' M file\n\n', stderr: '', error: null })
    expect(getStatusShort()).toBe(' M file')
  })

  it('hasDevBranch checks local then origin/dev with status===0 only', async () => {
    const { hasDevBranch } = await loadLocalGitEvidence()
    runMock
      .mockReturnValueOnce({ status: 1, stdout: '', stderr: '', error: null })
      .mockReturnValueOnce({ status: 0, stdout: 'abc', stderr: '', error: null })
    expect(hasDevBranch()).toBe(true)

    runMock.mockReset()
    runMock
      .mockReturnValueOnce({ status: 0, stdout: 'abc', stderr: '', error: null })
    expect(hasDevBranch()).toBe(true)
  })

  it('getOriginUrl returns null on non-zero status', async () => {
    const { getOriginUrl } = await loadLocalGitEvidence()
    runMock.mockReturnValue({ status: 128, stdout: '', stderr: 'no origin', error: null })
    expect(getOriginUrl()).toBeNull()

    runMock.mockReturnValue({
      status: 0,
      stdout: 'git@github.com:boat1994/bemoat-web-starter.git\n',
      stderr: '',
      error: null,
    })
    expect(getOriginUrl()).toBe('git@github.com:boat1994/bemoat-web-starter.git')
  })

  it('normalizeGithubRepoUrl preserves oracle prefix rules', async () => {
    const { normalizeGithubRepoUrl } = await loadLocalGitEvidence()
    expect(normalizeGithubRepoUrl(null)).toBeNull()
    expect(normalizeGithubRepoUrl('')).toBeNull()
    expect(normalizeGithubRepoUrl('git@github.com:org/repo.git')).toBe('https://github.com/org/repo')
    expect(normalizeGithubRepoUrl('https://github.com/org/repo.git')).toBe('https://github.com/org/repo')
    expect(normalizeGithubRepoUrl('https://gitlab.com/org/repo')).toBeNull()
    expect(normalizeGithubRepoUrl('https://www.github.com/org/repo')).toBeNull()
    expect(normalizeGithubRepoUrl('ssh://git@github.com/org/repo')).toBeNull()
  })

  it('getDefaultRepo honors GH_REPO regex and falls through to origin', async () => {
    const { getDefaultRepo } = await loadLocalGitEvidence()
    const cwd = '/tmp/repo'
    expect(getDefaultRepo(cwd, { GH_REPO: 'boat1994/bogus-jewelry' } as unknown as NodeJS.ProcessEnv)).toBe(
      'boat1994/bogus-jewelry',
    )

    runMock.mockReturnValue({
      status: 0,
      stdout: 'git@github.com:boat1994/bemoat-web-starter.git',
      stderr: '',
      error: null,
    })
    expect(getDefaultRepo(cwd, { GH_REPO: 'invalid repo' } as unknown as NodeJS.ProcessEnv)).toBe(
      'boat1994/bemoat-web-starter',
    )
    expect(getDefaultRepo(cwd, {} as unknown as NodeJS.ProcessEnv)).toBe('boat1994/bemoat-web-starter')
  })

  it('runBranchSafety filters Current branch lines from combined output', async () => {
    const { runBranchSafety } = await loadLocalGitEvidence()
    runMock.mockReturnValue({
      status: 1,
      stdout: 'Current branch: main\n',
      stderr: 'blocked\n',
      error: null,
    })
    expect(runBranchSafety()).toEqual({ ok: false, lines: ['blocked'] })
  })

  it('isReadOnlyPlanningBaseline requires strict planning-no-pr and matching SHAs', async () => {
    const issueDeclarations = await import('../../../scripts/agent-issue/issue-declarations.mjs')
    const { isReadOnlyPlanningBaseline } = await loadLocalGitEvidence()
    const sha = 'a'.repeat(40)
    const state = {
      approved_base: 'main',
      guide_source_ref: 'main',
      workflow_mode: 'planning_no_pr',
      state: 'BLOCKED_FOR_FOUNDER_DECISION',
      review_cycle: 0,
      full_review_count: 0,
      active_pr: null as null,
      current_head: null as null,
      last_reviewed_head: null as null,
      planning_authorization_base_sha: sha,
      guide_source_sha: sha.toUpperCase(),
    }
    expect(issueDeclarations.isPreReviewPlanningNoPrState(state)).toBe(true)

    runMock
      .mockReturnValueOnce({ status: 0, stdout: `${sha}\n`, stderr: '', error: null })
      .mockReturnValueOnce({ status: 0, stdout: `${sha}\n`, stderr: '', error: null })
    expect(
      isReadOnlyPlanningBaseline({ branchName: 'main', state, cwd: '/tmp', env: {} as unknown as NodeJS.ProcessEnv }),
    ).toBe(true)

    expect(
      issueDeclarations.isPreReviewPlanningNoPrState({
        ...state,
        full_review_count: '0' as unknown as number,
      }),
    ).toBe(false)
    expect(
      issueDeclarations.isPreReviewPlanningNoPrState({
        ...state,
        active_pr: undefined,
      }),
    ).toBe(false)
  })

  it('getCorrectionDiffFiles maps git failures and success file lists', async () => {
    const { getCorrectionDiffFiles } = await loadLocalGitEvidence()
    runMock.mockReturnValue({ status: 1, stdout: '', stderr: 'bad ref', error: null })
    expect(getCorrectionDiffFiles('/tmp', 'deadbeef'.repeat(5))).toEqual({
      ok: false,
      errors: ['bad ref'],
    })

    runMock.mockReturnValue({
      status: 0,
      stdout: 'a.ts\n\n b.ts \n',
      stderr: '',
      error: null,
    })
    expect(getCorrectionDiffFiles('/tmp', 'abc123')).toEqual({ ok: true, files: ['a.ts', 'b.ts'] })
  })

  it('getCorrectionDiffFiles does not special-case result.error', async () => {
    const { getCorrectionDiffFiles } = await loadLocalGitEvidence()
    runMock.mockReturnValue({
      status: 1,
      stdout: '',
      stderr: '',
      error: new Error('spawn fail'),
    })
    expect(getCorrectionDiffFiles('/tmp', 'abc')).toEqual({ ok: false, errors: ['git diff failed'] })

    runMock.mockImplementation((_cmd, args: string[]) => {
      expect(args).toContain(undefined)
      return { status: 128, stdout: '', stderr: 'bad', error: null }
    })
    expect(getCorrectionDiffFiles('/tmp', undefined as unknown as string)).toEqual({
      ok: false,
      errors: ['bad'],
    })
  })
})
