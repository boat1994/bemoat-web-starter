import { describe, expect, it } from 'vitest'
import {
  createCommandRunner,
  runCommand,
} from '../../scripts/adapters/command-runner.mjs'
import {
  fetchIssueComments,
  postIssueComment,
} from '../../scripts/mission-control/adapters/github-transport.mjs'

describe('scripts/adapters/command-runner.mjs', () => {
  it('returns trimmed stdout on success', () => {
    const run = createCommandRunner(() => ({
      status: 0,
      stdout: '  ok\n',
      stderr: '',
      error: undefined,
    }) as never)
    expect(run('echo', ['ok'])).toBe('ok')
  })

  it('throws stderr when the command exits non-zero', () => {
    const run = createCommandRunner(() => ({
      status: 1,
      stdout: '',
      stderr: 'boom',
      error: undefined,
    }) as never)
    expect(() => run('gh', ['api', 'rate-limit'])).toThrow('boom')
  })

  it('throws stdout when stderr is empty on failure', () => {
    const run = createCommandRunner(() => ({
      status: 2,
      stdout: 'rate limited',
      stderr: '',
      error: undefined,
    }) as never)
    expect(() => run('gh', ['pr', 'view', '1'])).toThrow('rate limited')
  })

  it('throws spawn error message when spawn fails', () => {
    const run = createCommandRunner(() => ({
      status: null,
      stdout: '',
      stderr: '',
      error: new Error('ENOENT'),
    }) as never)
    expect(() => run('missing-bin')).toThrow('ENOENT')
  })

  it('falls back to "<command> failed" when no diagnostics exist', () => {
    const run = createCommandRunner(() => ({
      status: 1,
      stdout: '',
      stderr: '',
      error: undefined,
    }) as never)
    expect(() => run('gh')).toThrow('gh failed')
  })

  it('default runCommand can execute a real node process', () => {
    expect(runCommand(process.execPath, ['-e', 'process.stdout.write("ping")'])).toBe('ping')
  })

  it('is listed in managedPaths for boilerplate sync', async () => {
    const sync = await import('../../scripts/sync-boilerplate.mjs')
    expect(sync.managedPaths).not.toContain('scripts/command-runner.mjs')
    expect(sync.managedPaths).toContain('scripts/adapters/command-runner.mjs')
    expect(sync.managedPaths).toContain('tests/int/command-runner.int.spec.ts')
  })
})

describe('scripts/mission-control/adapters/github-transport.mjs', () => {
  it('preserves raw issue-comment commands and returns the runner output', () => {
    const calls: Array<{ command: string, args: string[] }> = []
    const runGh = (command: string, args: string[]) => {
      calls.push({ command, args })
      return '{"id":123}'
    }

    expect(fetchIssueComments({ runGh, repository: 'boat1994/bemoat-web-starter', issueNumber: 328 })).toBe('{"id":123}')
    expect(postIssueComment({ runGh, repository: 'boat1994/bemoat-web-starter', issueNumber: 328, payloadPath: '/tmp/payload.json' })).toBe('{"id":123}')
    expect(calls).toEqual([
      { command: 'gh', args: ['api', '--paginate', 'repos/boat1994/bemoat-web-starter/issues/328/comments'] },
      { command: 'gh', args: ['api', '--method', 'POST', 'repos/boat1994/bemoat-web-starter/issues/328/comments', '--input', '/tmp/payload.json'] },
    ])
  })

  it('propagates runner errors without transport wrapping', () => {
    const transportError = new Error('transport failed')
    const runGh = () => { throw transportError }

    expect(() => fetchIssueComments({ runGh, repository: 'repo', issueNumber: 1 })).toThrow(transportError)
    expect(() => postIssueComment({ runGh, repository: 'repo', issueNumber: 1, payloadPath: '/tmp/payload.json' })).toThrow(transportError)
  })
})
