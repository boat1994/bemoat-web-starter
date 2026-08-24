import { spawnSync } from 'node:child_process'

export type HandoffCommandOptions = {
  cwd?: string
  env?: NodeJS.ProcessEnv
  input?: string
}

export type HandoffCommandResult = {
  status: number | null
  stdout: string
  stderr: string
  error: Error | null
  mutationPerformed?: boolean
}

export type HandoffCommandRunner = (
  command: string,
  args: readonly string[],
  options?: HandoffCommandOptions,
) => HandoffCommandResult

export const runHandoffCommand: HandoffCommandRunner = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    input: options.input,
    encoding: 'utf8',
    maxBuffer: 100 * 1024 * 1024,
  })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error ?? null,
    mutationPerformed: result.error ? false : undefined,
  }
}

export class HandoffRuntimeError extends Error {
  readonly classification: string
  readonly mutationPerformed: boolean
  readonly errors?: string[]

  constructor(
    classification: string,
    message: string,
    options: { mutationPerformed?: boolean; errors?: string[] } = {},
  ) {
    super(message)
    this.name = 'HandoffRuntimeError'
    this.classification = classification
    this.mutationPerformed = options.mutationPerformed ?? false
    this.errors = options.errors
  }
}

export function commandFailure(result: HandoffCommandResult, fallback: string): string {
  return result.error?.message || result.stderr.trim() || result.stdout.trim() || fallback
}

export function parseJson<T>(result: HandoffCommandResult, label: string): T {
  if (result.error || result.status !== 0) {
    throw new HandoffRuntimeError('BLOCKED_EXTERNAL', `${label}: ${commandFailure(result, 'command failed')}`)
  }
  try {
    return JSON.parse(result.stdout) as T
  } catch (error) {
    throw new HandoffRuntimeError(
      'EVIDENCE_CONFLICT',
      `${label}: invalid JSON (${error instanceof Error ? error.message : String(error)})`,
    )
  }
}
