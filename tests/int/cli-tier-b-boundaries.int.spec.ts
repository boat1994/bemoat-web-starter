import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { delimiter, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'

import {
  compareFileSystemSnapshots,
  type FileSystemSnapshot,
  runCliBoundaryCase,
  snapshotDirectory,
  type CliBoundaryResult,
} from '../helpers/cli-boundary-harness'
import { getCommandContract } from '../../scripts/cli/command-contract.mjs'

type TierBCase = {
  command: string
  entrypoint: string
}

const TIER_B_CASES = [
  {
    command: 'bemoat:boilerplate:check',
    entrypoint: 'scripts/check-boilerplate-drift.mjs',
  },
  {
    command: 'bemoat:branch:check',
    entrypoint: 'scripts/check-branch-safety.sh',
  },
  {
    command: 'bemoat:guard:cloudflare-env',
    entrypoint: 'scripts/guard-cloudflare-env.mjs',
  },
  {
    command: 'bemoat:guard:harness-contract',
    entrypoint: 'scripts/guard-harness-contract.mjs',
  },
  {
    command: 'bemoat:guard:pack',
    entrypoint: 'scripts/guard-pack.mjs',
  },
  {
    command: 'bemoat:guard:safety',
    entrypoint: 'scripts/guard-pack.mjs',
  },
] as const satisfies readonly TierBCase[]

const TIER_B_ROWS = TIER_B_CASES.map((entry) => [entry.command, entry] as const)

const TIER_B_SECTIONS = [
  'NAME',
  'PURPOSE',
  'USAGE',
  'PRECONDITIONS',
  'REQUIRED INPUTS',
  'OPTIONAL FLAGS',
  'READS',
  'WRITES',
  'RESULT CLASSIFICATIONS',
  'EXIT CODES',
  'RETRY CONTRACT',
  'NEXT ACTIONS',
  'STOP CONDITIONS',
  'EXAMPLES',
  'SAFE RECOVERY',
] as const

const POISON_EXECUTABLES = ['gh', 'git', 'pnpm'] as const

function facadeEnvironment(entry: TierBCase): Record<string, string> {
  return {
    BEMOAT_FACADE_COMMAND: entry.command,
    BEMOAT_FACADE_ENTRYPOINT: entry.entrypoint,
    npm_lifecycle_event: entry.command,
  }
}

function installPoisonExecutables(binDirectory: string, logPath: string) {
  mkdirSync(binDirectory, { recursive: true })

  for (const executable of POISON_EXECUTABLES) {
    const path = join(binDirectory, executable)
    writeFileSync(
      path,
      [
        '#!/bin/sh',
        'printf \'%s\\n\' "$0 $*" >> "$BEMOAT_CLI_POISON_LOG"',
        'exit 97',
        '',
      ].join('\n'),
      'utf8',
    )
    chmodSync(path, 0o755)
  }

  rmSync(logPath, { force: true })
}

function readLines(path: string): string[] {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function snapshotRepositoryState(): FileSystemSnapshot {
  const repositoryRoot = process.cwd()
  const gitCommands = [
    ['status', '--porcelain=v1', '--untracked-files=all'],
    ['diff', '--raw', '--no-renames'],
    ['diff', '--cached', '--raw', '--no-renames'],
    ['ls-files', '-s'],
  ]
  const state = gitCommands
    .map((args) => {
      const result = spawnSync('git', args, {
        cwd: repositoryRoot,
        encoding: 'utf8',
      })
      const stdout = args[0] === 'status'
        ? (result.stdout ?? '')
          .split(/\r?\n/)
          .filter((line) => !line.startsWith('?? .tmp-'))
          .join('\n')
        : result.stdout ?? ''
      return [
        args.join(' '),
        String(result.status),
        stdout,
        result.stderr ?? '',
      ].join('\n')
    })
    .join('\n---\n')

  return {
    '.git-boundary-state': {
      kind: 'file',
      mode: 0o644,
      content: Buffer.from(state).toString('base64'),
    },
  }
}

function runFromRepositoryRoot(
  entry: TierBCase,
  argv: readonly string[],
): CliBoundaryResult {
  const repositoryRoot = process.cwd()
  const sandbox = mkdtempSync(join(tmpdir(), 'bemoat-cli-root-'))
  const binDirectory = join(sandbox, 'poison-bin')
  const poisonLog = join(sandbox, 'poison-calls.log')
  const entrypoint = resolve(repositoryRoot, entry.entrypoint)
  const args = [...argv]

  try {
    installPoisonExecutables(binDirectory, poisonLog)
    const before = snapshotRepositoryState()
    const executable = entry.entrypoint.endsWith('.sh') ? 'bash' : process.execPath
    const result = spawnSync(executable, [entrypoint, ...args], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        ...facadeEnvironment(entry),
        PATH: [binDirectory, process.env.PATH].filter(Boolean).join(delimiter),
        BEMOAT_CLI_POISON_LOG: poisonLog,
      },
      maxBuffer: 4 * 1024 * 1024,
    })
    const after = snapshotRepositoryState()

    return {
      cwd: repositoryRoot,
      entrypoint: entry.entrypoint,
      argv: args,
      status: result.status,
      signal: result.signal,
      error: result.error ? result.error.message : null,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      before,
      after,
      filesystem_unchanged: compareFileSystemSnapshots(before, after),
      poison_invocations: readLines(poisonLog),
    }
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
}

function runShellFromIsolatedCwd(
  entry: TierBCase,
  argv: readonly string[],
): CliBoundaryResult {
  const root = mkdtempSync(join(tmpdir(), 'bemoat-cli-shell-boundary-'))
  const binDirectory = join(root, 'poison-bin')
  const poisonLog = join(root, 'poison-calls.log')
  const entrypoint = resolve(process.cwd(), entry.entrypoint)
  const args = [...argv]

  try {
    installPoisonExecutables(binDirectory, poisonLog)
    const before = snapshotDirectory(root)
    const result = spawnSync('bash', [entrypoint, ...args], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        ...facadeEnvironment(entry),
        PATH: [binDirectory, process.env.PATH].filter(Boolean).join(delimiter),
        BEMOAT_CLI_POISON_LOG: poisonLog,
      },
      maxBuffer: 4 * 1024 * 1024,
    })
    const after = snapshotDirectory(root)

    return {
      cwd: root,
      entrypoint: entry.entrypoint,
      argv: args,
      status: result.status,
      signal: result.signal,
      error: result.error ? result.error.message : null,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      before,
      after,
      filesystem_unchanged: compareFileSystemSnapshots(before, after),
      poison_invocations: readLines(poisonLog),
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function runFromIsolatedCwd(
  entry: TierBCase,
  argv: readonly string[],
): CliBoundaryResult {
  if (entry.entrypoint.endsWith('.sh')) {
    return runShellFromIsolatedCwd(entry, argv)
  }

  return runCliBoundaryCase({
    entrypoint: entry.entrypoint,
    argv,
    env: facadeEnvironment(entry),
  })
}

function expectSectionsInOrder(help: string) {
  let previousIndex = -1

  for (const section of TIER_B_SECTIONS) {
    const index = help.indexOf(`${section}:`)
    expect(index, `missing help section ${section}`).toBeGreaterThanOrEqual(0)
    expect(index, `${section} is out of order`).toBeGreaterThan(previousIndex)
    previousIndex = index
  }
}

function semanticText(value: string): string {
  return value.replace(/\r\n/g, '\n').trim()
}

function expectNoBoundarySideEffects(run: CliBoundaryResult) {
  expect(run.error).toBeNull()
  expect(run.poison_invocations).toEqual([])
  expect(run.filesystem_unchanged).toBe(true)
  expect(compareFileSystemSnapshots(run.before, run.after)).toBe(true)
}

function expectHelpBoundary(run: CliBoundaryResult, entry: TierBCase) {
  expect(run.status).toBe(0)
  expect(run.stderr).toBe('')
  expect(run.stdout).toContain(`HELP: ${entry.command}`)
  expect(run.stdout).toContain(`Direct entrypoint: ${entry.entrypoint}`)
  expect(run.stdout).toContain(`Package command: ${entry.command}`)
  expect(run.stdout).toContain('WRITES: none')
  expectSectionsInOrder(run.stdout)
  expectNoBoundarySideEffects(run)
}

function expectInvalidBoundary(run: CliBoundaryResult) {
  expect(run.status).toBe(2)
  expect(run.stdout).toBe('')
  expect(run.stderr).toContain('INVALID_INVOCATION')
  expectNoBoundarySideEffects(run)
}

function writeFakeGit(
  path: string,
  mode: 'success' | 'failure',
  logPath: string,
) {
  const cloneBehavior = mode === 'success'
    ? [
      '  mkdir -p "$last"',
      '  exit 0',
    ]
    : ['  exit 42']

  writeFileSync(
    path,
    [
      '#!/bin/sh',
      'printf \'%s\\n\' "$0 $*" >> "$BEMOAT_FAKE_GIT_LOG"',
      'if [ "$1" = "clone" ]; then',
      '  last=""',
      '  for argument in "$@"; do last="$argument"; done',
      ...cloneBehavior,
      'fi',
      'exit 41',
      '',
    ].join('\n'),
    'utf8',
  )
  chmodSync(path, 0o755)
  rmSync(logPath, { force: true })
}

function runBoilerplateCheckWithFakeClone(mode: 'success' | 'failure') {
  const targetRoot = mkdtempSync(join(tmpdir(), 'bemoat-boilerplate-check-'))
  const binDirectory = join(targetRoot, 'bin')
  const fakeGit = join(binDirectory, 'git')
  const logPath = join(tmpdir(), `bemoat-fake-git-${process.pid}-${Date.now()}-${mode}.log`)
  const sentinelPath = join(targetRoot, 'target-sentinel.txt')
  const entrypoint = resolve(process.cwd(), 'scripts/check-boilerplate-drift.mjs')

  mkdirSync(binDirectory, { recursive: true })
  writeFileSync(join(targetRoot, 'package.json'), '{"name":"child-fixture"}\n', 'utf8')
  writeFileSync(sentinelPath, 'target-owned-content\n', 'utf8')
  chmodSync(sentinelPath, 0o640)
  writeFakeGit(fakeGit, mode, logPath)

  try {
    const before = snapshotDirectory(targetRoot)
    const result = spawnSync(process.execPath, [entrypoint], {
      cwd: targetRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        ...facadeEnvironment({
          command: 'bemoat:boilerplate:check',
          entrypoint: 'scripts/check-boilerplate-drift.mjs',
        }),
        BEMOAT_FAKE_GIT_LOG: logPath,
        BEMOAT_SYNC_MODE: 'harness-only',
        PATH: [binDirectory, process.env.PATH].filter(Boolean).join(delimiter),
      },
      maxBuffer: 4 * 1024 * 1024,
    })
    const after = snapshotDirectory(targetRoot)

    return {
      status: result.status,
      error: result.error ? result.error.message : null,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      before,
      after,
      filesystem_unchanged: compareFileSystemSnapshots(before, after),
      transient_storage_exists: existsSync(join(targetRoot, '.bemoat-check-tmp')),
      fake_git_invocations: readLines(logPath),
      sentinel_before: before['target-sentinel.txt'],
      sentinel_after: after['target-sentinel.txt'],
    }
  } finally {
    rmSync(logPath, { force: true })
    rmSync(targetRoot, { recursive: true, force: true })
  }
}

describe('Task 3 Tier B CLI boundaries', () => {
  it.each(TIER_B_ROWS)(
    'Tier B %s --help and -h exit zero without I/O',
    (command, entry) => {
      expect(command).toBe(entry.command)
      expect(getCommandContract(entry.command)).toMatchObject({
        tier: 'B',
        entrypoint: entry.entrypoint,
      })

      const runs = [
        runFromRepositoryRoot(entry, ['--help']),
        runFromIsolatedCwd(entry, ['--help']),
        runFromRepositoryRoot(entry, ['-h']),
        runFromIsolatedCwd(entry, ['-h']),
      ]

      for (const run of runs) expectHelpBoundary(run, entry)

      const semanticOutputs = runs.map((run) => semanticText(run.stdout))
      expect(semanticOutputs).toEqual([
        semanticOutputs[0],
        semanticOutputs[0],
        semanticOutputs[0],
        semanticOutputs[0],
      ])
    },
  )

  it.each(TIER_B_ROWS)(
    'Tier B %s rejects invalid invocation with exit two before I/O',
    (command, entry) => {
      expect(command).toBe(entry.command)

      const runs = [
        runFromRepositoryRoot(entry, ['--definitely-invalid']),
        runFromIsolatedCwd(entry, ['--definitely-invalid']),
      ]

      for (const run of runs) expectInvalidBoundary(run)
      expect(semanticText(runs[0].stderr)).toBe(semanticText(runs[1].stderr))
    },
  )

  it.each(TIER_B_ROWS)(
    'Tier B %s help names the exact lifecycle command and entrypoint',
    (command, entry) => {
      expect(command).toBe(entry.command)

      const rootRun = runFromRepositoryRoot(entry, ['--help'])
      const isolatedRun = runFromIsolatedCwd(entry, ['--help'])

      for (const run of [rootRun, isolatedRun]) {
        expectHelpBoundary(run, entry)
        expect(run.stdout).toMatch(
          new RegExp(`^HELP: ${entry.command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm'),
        )
        expect(run.stdout).toContain(`Direct entrypoint: ${entry.entrypoint}`)
      }
      expect(semanticText(rootRun.stdout)).toBe(semanticText(isolatedRun.stdout))
    },
  )

  it('boilerplate check removes transient storage and preserves the target on success and clone failure', () => {
    const success = runBoilerplateCheckWithFakeClone('success')
    const failure = runBoilerplateCheckWithFakeClone('failure')

    expect(success.status).toBe(0)
    expect(success.error).toBeNull()
    expect(success.stdout).toContain('No drift found.')
    expect(success.stderr).toBe('')
    expect(success.fake_git_invocations).toHaveLength(1)
    expect(success.transient_storage_exists).toBe(false)
    expect(success.filesystem_unchanged).toBe(true)
    expect(success.sentinel_after).toEqual(success.sentinel_before)

    expect(failure.status).toBe(2)
    expect(failure.error).toBeNull()
    expect(failure.stderr).toContain('Unable to fetch or compare boilerplate source.')
    expect(failure.fake_git_invocations).toHaveLength(1)
    expect(failure.transient_storage_exists).toBe(false)
    expect(failure.filesystem_unchanged).toBe(true)
    expect(failure.sentinel_after).toEqual(failure.sentinel_before)
  })
})
