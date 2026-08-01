#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

/**
 * Create a CommandRunner that executes a command via spawnSync-compatible
 * transport and throws on non-zero exit or spawn failure.
 *
 * @param {typeof spawnSync} [spawn]
 * @returns {(command: string, args?: string[], options?: object) => string}
 */
export function createCommandRunner(spawn = spawnSync) {
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
