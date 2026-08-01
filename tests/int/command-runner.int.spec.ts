import { describe, expect, it } from 'vitest'
import {
  createCommandRunner as createFromAdapter,
  runCommand as runFromAdapter,
} from '../../scripts/adapters/command-runner.mjs'
import {
  createCommandRunner as createFromFacade,
  runCommand as runFromFacade,
} from '../../scripts/command-runner.mjs'

describe('scripts/command-runner.mjs', () => {
  it('re-exports the same createCommandRunner and runCommand values as the adapter', () => {
    expect(createFromFacade).toBe(createFromAdapter)
    expect(runFromFacade).toBe(runFromAdapter)
  })

  it('returns trimmed stdout on success', () => {
    const run = createFromFacade(() => ({
      status: 0,
      stdout: '  ok\n',
      stderr: '',
      error: undefined,
    }) as never)
    expect(run('echo', ['ok'])).toBe('ok')
  })

  it('throws stderr when the command exits non-zero', () => {
    const run = createFromFacade(() => ({
      status: 1,
      stdout: '',
      stderr: 'boom',
      error: undefined,
    }) as never)
    expect(() => run('gh', ['api', 'rate-limit'])).toThrow('boom')
  })

  it('throws stdout when stderr is empty on failure', () => {
    const run = createFromFacade(() => ({
      status: 2,
      stdout: 'rate limited',
      stderr: '',
      error: undefined,
    }) as never)
    expect(() => run('gh', ['pr', 'view', '1'])).toThrow('rate limited')
  })

  it('throws spawn error message when spawn fails', () => {
    const run = createFromFacade(() => ({
      status: null,
      stdout: '',
      stderr: '',
      error: new Error('ENOENT'),
    }) as never)
    expect(() => run('missing-bin')).toThrow('ENOENT')
  })

  it('falls back to "<command> failed" when no diagnostics exist', () => {
    const run = createFromFacade(() => ({
      status: 1,
      stdout: '',
      stderr: '',
      error: undefined,
    }) as never)
    expect(() => run('gh')).toThrow('gh failed')
  })

  it('default runCommand can execute a real node process', () => {
    expect(runFromFacade(process.execPath, ['-e', 'process.stdout.write("ping")'])).toBe('ping')
  })

  it('is listed in managedPaths for boilerplate sync', async () => {
    const sync = await import('../../scripts/sync-boilerplate.mjs')
    expect(sync.managedPaths).toContain('scripts/command-runner.mjs')
    expect(sync.managedPaths).toContain('scripts/adapters/command-runner.mjs')
    expect(sync.managedPaths).toContain('tests/int/command-runner.int.spec.ts')
  })
})
