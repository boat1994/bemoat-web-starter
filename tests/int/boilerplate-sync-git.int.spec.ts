import { describe, expect, it } from 'vitest'

describe('boilerplate sync Git lifecycle', () => {
  it('stashes scoped unrelated changes, validates before committing the ordered sync scope, then restores the stash', async () => {
    const mod = await import('../../scripts/boilerplate/git.mjs')
    const calls: string[] = []
    const targetRoot = '/tmp/bemoat-child'
    const syncPaths = ['AGENTS.md', 'scripts/sync-boilerplate.mjs']
    const expectedCommitPaths = [
      ...syncPaths,
      '.bemoat-boilerplate-sync.json',
      '.bemoat/package-sync-proposal.md',
      'package.json',
    ]
    const git = {
      hasWorkingTreeChanges(cwd: string, excludedPaths: string[]) {
        calls.push(`status:${cwd}:${excludedPaths.join(',')}`)
        return true
      },
      stashPush(cwd: string, excludedPaths: string[]) {
        calls.push(`stash:${cwd}:${excludedPaths.join(',')}`)
      },
      addPaths(cwd: string, paths: string[]) {
        calls.push(`add:${cwd}:${paths.join(',')}`)
      },
      hasStagedChanges(cwd: string, paths: string[]) {
        calls.push(`staged:${cwd}:${paths.join(',')}`)
        return true
      },
      commit(cwd: string, message: string) {
        calls.push(`commit:${cwd}:${message}`)
      },
      stashPop(cwd: string) {
        calls.push(`pop:${cwd}`)
      },
    }

    expect(mod.getSyncCommitPaths(syncPaths, { includePackageJson: true })).toEqual(expectedCommitPaths)

    const stashCreated = mod.stashWorkingTreeIfNeeded(targetRoot, git)
    const committed = mod.commitValidatedSyncChanges(
      {
        repo: 'boat1994/bemoat-web-starter',
        ref: 'main',
        targetRoot,
        syncedPaths: syncPaths,
        includePackageJson: true,
      },
      { git, validate: () => calls.push('validate') },
    )
    mod.restoreStashIfNeeded(targetRoot, stashCreated, git)

    expect(stashCreated).toBe(true)
    expect(committed).toBe(true)
    expect(calls).toEqual([
      `status:${targetRoot}:${mod.getSyncCommitPaths().join(',')}`,
      `stash:${targetRoot}:${mod.getSyncCommitPaths().join(',')}`,
      'validate',
      `add:${targetRoot}:${expectedCommitPaths.join(',')}`,
      `staged:${targetRoot}:${expectedCommitPaths.join(',')}`,
      `commit:${targetRoot}:sync boilerplate from boat1994/bemoat-web-starter#main`,
      `pop:${targetRoot}`,
    ])
  })

  it('does not stash or commit a clean/no-op lifecycle and propagates stash restoration failures', async () => {
    const mod = await import('../../scripts/boilerplate/git.mjs')
    const calls: string[] = []
    const targetRoot = '/tmp/bemoat-child'
    const git = {
      hasWorkingTreeChanges() {
        calls.push('status')
        return false
      },
      stashPush() {
        calls.push('stash')
      },
      addPaths() {
        calls.push('add')
      },
      hasStagedChanges() {
        calls.push('staged')
        return false
      },
      commit() {
        calls.push('commit')
      },
      stashPop() {
        throw new Error('stash conflict')
      },
    }

    expect(mod.stashWorkingTreeIfNeeded(targetRoot, git)).toBe(false)
    expect(mod.commitSyncedChanges(
      { repo: 'boat1994/bemoat-web-starter', ref: 'main', targetRoot },
      git,
    )).toBe(false)
    expect(() => mod.restoreStashIfNeeded(targetRoot, true, git)).toThrow('stash conflict')
    expect(calls).toEqual(['status', 'add', 'staged'])
  })
})
