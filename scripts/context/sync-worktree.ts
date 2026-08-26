import { realpathSync, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

import type { NormalizedContextEvidence } from './model.ts'
import {
  isFullSha,
  normalizeOriginRepository,
  output,
  runContextCommand,
  type ContextCommandRunner,
} from './runtime.ts'

interface DirectoryStat {
  isDirectory(): boolean
}

export interface ContextSyncRoots {
  sourceCwd: string
  targetCwd: string
  bootstrap: boolean
}

export class ContextSyncWorktreeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ContextSyncWorktreeError'
  }
}

function canonicalDirectory(
  label: string,
  path: string,
  realpath: (path: string) => string,
  stat: (path: string) => DirectoryStat,
): string {
  let canonicalPath: string
  try {
    canonicalPath = realpath(path)
  } catch {
    throw new ContextSyncWorktreeError(`${label} cannot be canonicalized to an existing directory`)
  }

  try {
    if (!stat(canonicalPath).isDirectory()) {
      throw new ContextSyncWorktreeError(`${label} must resolve to a directory`)
    }
  } catch (error) {
    if (error instanceof ContextSyncWorktreeError) throw error
    throw new ContextSyncWorktreeError(`${label} cannot be canonicalized to an existing directory`)
  }
  return canonicalPath
}

export function resolveContextSyncRoots({
  sourceCwd,
  targetWorktree,
  realpath = realpathSync,
  stat = statSync,
}: {
  sourceCwd: string
  targetWorktree?: string | null
  realpath?: (path: string) => string
  stat?: (path: string) => DirectoryStat
}): ContextSyncRoots {
  const canonicalSource = canonicalDirectory('command source worktree', resolve(sourceCwd), realpath, stat)
  if (targetWorktree == null) {
    return { sourceCwd: canonicalSource, targetCwd: canonicalSource, bootstrap: false }
  }
  if (!isAbsolute(targetWorktree)) {
    throw new ContextSyncWorktreeError('--target-worktree must be an absolute path')
  }

  const canonicalTarget = canonicalDirectory('target worktree', targetWorktree, realpath, stat)
  if (canonicalTarget === canonicalSource) {
    throw new ContextSyncWorktreeError('--target-worktree must be distinct from the command source worktree; omit the flag for same-worktree mode')
  }
  return { sourceCwd: canonicalSource, targetCwd: canonicalTarget, bootstrap: true }
}

export function verifyContextSyncSource({
  sourceCwd,
  evidence,
  run = runContextCommand,
}: {
  sourceCwd: string
  evidence: NormalizedContextEvidence
  run?: ContextCommandRunner
}): string[] {
  const topLevel = output(run('git', ['rev-parse', '--show-toplevel'], { cwd: sourceCwd }))
  const head = output(run('git', ['rev-parse', 'HEAD'], { cwd: sourceCwd }))
  const status = output(run('git', ['status', '--short'], { cwd: sourceCwd }))
  const origin = output(run('git', ['remote', 'get-url', 'origin'], { cwd: sourceCwd }))
  const repository = normalizeOriginRepository(origin)
  const reasons: string[] = []

  if (topLevel !== sourceCwd) {
    reasons.push('EVIDENCE_CONFLICT: protected-main command source root is unavailable or does not match the invocation checkout')
  }
  if (!isFullSha(head) || head.toLowerCase() !== evidence.protectedBase.sha.toLowerCase()) {
    reasons.push('EVIDENCE_CONFLICT: protected-main command source HEAD does not match the live protected base')
  }
  if (status === null || status !== '') {
    reasons.push('EVIDENCE_CONFLICT: protected-main command source is not clean')
  }
  if (
    repository !== evidence.repository.nameWithOwner ||
    repository !== evidence.localGit.originRepository
  ) {
    reasons.push('EVIDENCE_CONFLICT: protected-main command source is not the canonical target repository')
  }

  return [...new Set(reasons)]
}
