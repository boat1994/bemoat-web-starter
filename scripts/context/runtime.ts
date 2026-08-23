import { spawnSync } from 'node:child_process'

import type { RepositoryEvidence } from './model.ts'

export interface ContextCommandResult {
  status: number
  stdout: string
  stderr: string
  error: Error | null
}

export type ContextCommandRunner = (
  command: string,
  args: readonly string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv },
) => ContextCommandResult

export const runContextCommand: ContextCommandRunner = (command, args, options = {}) => {
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

export function output(result: ContextCommandResult): string | null {
  if (result.status !== 0 || result.error) return null
  return result.stdout.trim()
}

export function failure(result: ContextCommandResult, fallback: string): string {
  return result.error?.message || result.stderr.trim() || result.stdout.trim() || fallback
}

export function json<T>(
  run: ContextCommandRunner,
  command: string,
  args: readonly string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv },
): { value: T | null; error: string | null } {
  const result = run(command, args, options)
  const text = output(result)
  if (text === null || text === '') return { value: null, error: failure(result, `${command} returned no evidence`) }
  try {
    return { value: JSON.parse(text) as T, error: null }
  } catch (error) {
    return { value: null, error: `${command} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

export function normalizeOriginRepository(origin: string | null): string | null {
  if (!origin) return null
  if (origin.startsWith('git@github.com:')) return origin.slice('git@github.com:'.length).replace(/\.git$/, '')
  if (origin.startsWith('https://github.com/')) return origin.slice('https://github.com/'.length).replace(/\.git$/, '')
  return null
}

export function repositoryEvidence(repo: string): RepositoryEvidence {
  const [owner, name] = repo.split('/')
  return { owner, name, nameWithOwner: repo, url: `https://github.com/${repo}` }
}
