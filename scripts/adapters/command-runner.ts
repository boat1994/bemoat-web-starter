#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

/** Create a command runner backed by a spawnSync-compatible transport. */
export function createCommandRunner(
  spawn: typeof spawnSync = spawnSync,
): (command: string, args?: string[], options?: object) => string {
  return function runCommand(command, args = [], options = {}) {
    const result = spawn(command, args, { encoding: 'utf8', ...options })
    if (result.error || result.status !== 0) {
      throw new Error(
        result.stderr || result.stdout || result.error?.message || `${command} failed`,
      )
    }
    return (result.stdout ?? '').trim()
  }
}

/** Default production CommandRunner backed by node:child_process.spawnSync. */
export const runCommand = createCommandRunner()
