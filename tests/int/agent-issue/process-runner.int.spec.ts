import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const tempRoots: string[] = []

afterEach(() => {
  tempRoots.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }))
})

async function loadRun() {
  const { run } = await import('../../../scripts/agent-issue/process-runner.mjs')
  return run
}

describe('Cluster C characterization (issue #333) — process-runner', () => {
  it('returns success exit with stdout and stderr', async () => {
    const run = await loadRun()
    const result = run(process.execPath, [
      '-e',
      "console.log('stdout-line'); console.error('stderr-line')",
    ])

    expect(result).toEqual({
      status: 0,
      stdout: 'stdout-line\n',
      stderr: 'stderr-line\n',
      error: null,
    })
  })

  it('returns a non-zero exit status unchanged', async () => {
    const run = await loadRun()
    const result = run(process.execPath, ['-e', 'process.exit(42)'])

    expect(result.status).toBe(42)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')
    expect(result.error).toBeNull()
  })

  it('maps ENOENT spawn failures to status 1 with empty strings and error.code ENOENT', async () => {
    const run = await loadRun()
    const result = run('/no/such/process-runner-binary-xyz', [])

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')
    expect(result.error).toMatchObject({ code: 'ENOENT' })
  })

  it('maps SIGKILL to status 1 with a null error', async () => {
    const run = await loadRun()
    const result = run(process.execPath, ['-e', 'process.kill(process.pid, "SIGKILL")'])

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')
    expect(result.error).toBeNull()
  })

  it('maps maxBuffer exceed to status 1 with partial stdout and a truthy error', async () => {
    const run = await loadRun()
    const result = run(process.execPath, [
      '-e',
      "process.stdout.write('x'.repeat(2 * 1024 * 1024))",
    ])

    expect(result.status).toBe(1)
    expect(result.stdout.length).toBeGreaterThan(0)
    expect(result.error).toBeTruthy()
  })

  it('defaults cwd and env to the current process values', async () => {
    const run = await loadRun()
    const result = run(process.execPath, [
      '-e',
      "console.log(JSON.stringify({ cwd: process.cwd(), hasPath: Boolean(process.env.PATH) }))",
    ])

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout.trim())).toEqual({
      cwd: process.cwd(),
      hasPath: true,
    })
  })

  it('honors explicit cwd and env overrides', async () => {
    const run = await loadRun()
    const customCwd = realpathSync(mkdtempSync(join(tmpdir(), 'process-runner-cwd-')))
    tempRoots.push(customCwd)
    const customEnv = { ...process.env, PROCESS_RUNNER_TEST_MARKER: 'cluster-c' }
    const result = run(
      process.execPath,
      [
        '-e',
        "console.log(JSON.stringify({ cwd: process.cwd(), marker: process.env.PROCESS_RUNNER_TEST_MARKER }))",
      ],
      { cwd: customCwd, env: customEnv },
    )

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout.trim())).toEqual({
      cwd: customCwd,
      marker: 'cluster-c',
    })
  })

  it('uses process.env when options.env is null', async () => {
    const marker = `process-runner-null-env-${Date.now()}`
    process.env.PROCESS_RUNNER_NULL_ENV_MARKER = marker
    const run = await loadRun()
    const result = run(
      process.execPath,
      ['-e', 'console.log(process.env.PROCESS_RUNNER_NULL_ENV_MARKER ?? "")'],
      { env: null },
    )

    expect(result.status).toBe(0)
    expect(result.stdout).toBe(`${marker}\n`)
    delete process.env.PROCESS_RUNNER_NULL_ENV_MARKER
  })

  it('coalesces undefined stdout and stderr to empty strings', async () => {
    const missingBinary = '/no/such/process-runner-undefined-streams-xyz'
    const raw = spawnSync(missingBinary, [], { encoding: 'utf8' })
    expect(raw.stdout).toBeUndefined()
    expect(raw.stderr).toBeUndefined()

    const run = await loadRun()
    const result = run(missingBinary, [])

    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')
  })

  it('coalesces a null spawn status to 1', async () => {
    const raw = spawnSync(process.execPath, ['-e', 'process.kill(process.pid, "SIGTERM")'], {
      encoding: 'utf8',
    })
    expect(raw.status).toBeNull()

    const run = await loadRun()
    const result = run(process.execPath, ['-e', 'process.kill(process.pid, "SIGTERM")'])

    expect(result).toEqual({
      status: 1,
      stdout: '',
      stderr: '',
      error: null,
    })
    expect(result).not.toHaveProperty('signal')
  })

  it('throws a native TypeError for invalid args types', async () => {
    const run = await loadRun()
    expect(() => run(process.execPath, 'not-an-array' as unknown as string[])).toThrow(TypeError)
  })

  it('throws a native TypeError for a null command', async () => {
    const run = await loadRun()
    expect(() => run(null as unknown as string, [])).toThrow(TypeError)
  })

  it('does not mutate the options object or args array', async () => {
    const run = await loadRun()
    const args = ['-e', 'process.exit(0)']
    const argsCopy = [...args]
    const options = { cwd: process.cwd(), env: { ...process.env } }
    const optionsCopy = { cwd: options.cwd, env: { ...options.env } }

    run(process.execPath, args, options)

    expect(args).toEqual(argsCopy)
    expect(options).toEqual(optionsCopy)
  })

  it('preserves git merge-base --is-ancestor tri-state behavior in a temp repo', async () => {
    const run = await loadRun()
    const root = mkdtempSync(join(tmpdir(), 'process-runner-git-'))
    tempRoots.push(root)

    const init = spawnSync('git', ['init', '-b', 'main'], { cwd: root, encoding: 'utf8' })
    expect(init.status).toBe(0)
    spawnSync('git', ['config', 'user.email', 'process-runner@test'], { cwd: root, encoding: 'utf8' })
    spawnSync('git', ['config', 'user.name', 'Process Runner Test'], { cwd: root, encoding: 'utf8' })
    writeFileSync(join(root, 'seed.txt'), 'seed\n')
    spawnSync('git', ['add', 'seed.txt'], { cwd: root, encoding: 'utf8' })
    spawnSync('git', ['commit', '-m', 'seed'], { cwd: root, encoding: 'utf8' })

    const ancestor = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim()
    spawnSync('git', ['checkout', '-b', 'feature/child'], { cwd: root, encoding: 'utf8' })
    writeFileSync(join(root, 'child.txt'), 'child\n')
    spawnSync('git', ['add', 'child.txt'], { cwd: root, encoding: 'utf8' })
    spawnSync('git', ['commit', '-m', 'child'], { cwd: root, encoding: 'utf8' })
    const descendant = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim()

    mkdirSync(join(root, 'orphan-worktree'), { recursive: true })
    const orphanInit = spawnSync('git', ['init', '-b', 'orphan'], {
      cwd: join(root, 'orphan-worktree'),
      encoding: 'utf8',
    })
    expect(orphanInit.status).toBe(0)
    spawnSync('git', ['config', 'user.email', 'process-runner@test'], {
      cwd: join(root, 'orphan-worktree'),
      encoding: 'utf8',
    })
    spawnSync('git', ['config', 'user.name', 'Process Runner Test'], {
      cwd: join(root, 'orphan-worktree'),
      encoding: 'utf8',
    })
    writeFileSync(join(root, 'orphan-worktree', 'orphan.txt'), 'orphan\n')
    spawnSync('git', ['add', 'orphan.txt'], { cwd: join(root, 'orphan-worktree'), encoding: 'utf8' })
    spawnSync('git', ['commit', '-m', 'orphan'], { cwd: join(root, 'orphan-worktree'), encoding: 'utf8' })
    const unrelated = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: join(root, 'orphan-worktree'),
      encoding: 'utf8',
    }).stdout.trim()

    const isAncestor = run('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd: root })
    const notAncestor = run('git', ['merge-base', '--is-ancestor', descendant, ancestor], { cwd: root })
    const invalidRef = run('git', ['merge-base', '--is-ancestor', ancestor, unrelated], { cwd: root })

    expect(isAncestor.status).toBe(0)
    expect(isAncestor.error).toBeNull()
    expect(notAncestor.status).toBe(1)
    expect(notAncestor.error).toBeNull()
    expect(invalidRef.status).toBeGreaterThan(1)
    expect(invalidRef.error).toBeNull()
  })
})
