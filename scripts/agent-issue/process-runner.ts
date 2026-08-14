import { spawnSync } from 'node:child_process'

export interface ProcessRunnerOptions {
  cwd?: string | null
  env?: NodeJS.ProcessEnv | null
}

export interface ProcessRunnerResult {
  status: number
  stdout: string
  stderr: string
  error: Error | null
}

export function run(
  command: string,
  args: readonly string[],
  options: ProcessRunnerOptions = {},
): ProcessRunnerResult {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    encoding: 'utf8',
  })

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error ?? null,
  }
}
