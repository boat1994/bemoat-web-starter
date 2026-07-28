import { spawnSync } from 'node:child_process'

function runGit(args, { cwd, env }) {
  const result = spawnSync('git', args, {
    cwd,
    env,
    encoding: 'utf8',
  })

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error ?? null,
  }
}

function hasRef(runCommand, ref) {
  return runCommand(['rev-parse', '--verify', '--quiet', ref]).status === 0
}

export function collectLocalGitEvidence({ cwd = process.cwd(), env = process.env, runCommand } = {}) {
  const execute = runCommand
    ? (args) => runCommand('git', args, { cwd, env })
    : (args) => runGit(args, { cwd, env })

  const branchResult = execute(['branch', '--show-current'])
  const statusResult = execute(['status', '--short'])
  const originResult = execute(['remote', 'get-url', 'origin'])
  const headResult = execute(['rev-parse', 'HEAD'])
  const statusShort = statusResult.stdout.trimEnd()

  return {
    branchName: branchResult.stdout.trim() || '<detached>',
    statusShort,
    dirty: statusShort.length > 0,
    originUrl: originResult.status === 0 ? originResult.stdout.trim() || null : null,
    head: headResult.status === 0 ? headResult.stdout.trim() || null : null,
    hasDevBranch: hasRef(execute, 'dev') || hasRef(execute, 'origin/dev'),
  }
}
