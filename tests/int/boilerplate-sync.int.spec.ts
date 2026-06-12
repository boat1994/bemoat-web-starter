import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('boilerplate sync managed paths', () => {
  it('includes repository agent instructions and Cursor rules', () => {
    const script = readFileSync(resolve(process.cwd(), 'scripts/sync-boilerplate.mjs'), 'utf8')

    expect(script).toContain("'AGENTS.md'")
    expect(script).toContain("'.cursor/rules'")
  })

  it('exports the sync commit scope including the sync metadata file', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    expect(mod.syncCommitPaths).toContain('.bemoat-boilerplate-sync.json')
    expect(mod.syncCommitPaths).toContain('package.json')
    expect(mod.syncCommitPaths).toContain('AGENTS.md')
  })

  it('stashes unrelated local changes, commits only sync-scoped files, then restores the stash', async () => {
    const calls: string[] = []
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    const git = {
      hasWorkingTreeChanges(cwd: string) {
        calls.push(`hasWorkingTreeChanges:${cwd}`)
        return true
      },
      stashPush(cwd: string) {
        calls.push(`stashPush:${cwd}`)
      },
      addPaths(cwd: string, paths: string[]) {
        calls.push(`addPaths:${cwd}:${paths.join(',')}`)
      },
      hasStagedChanges(cwd: string, paths: string[]) {
        calls.push(`hasStagedChanges:${cwd}:${paths.join(',')}`)
        return true
      },
      commit(cwd: string, message: string) {
        calls.push(`commit:${cwd}:${message}`)
      },
      stashPop(cwd: string) {
        calls.push(`stashPop:${cwd}`)
      },
    }

    const targetRoot = '/tmp/bemoat-child'
    const stashCreated = mod.stashWorkingTreeIfNeeded(targetRoot, git)
    const committed = mod.commitSyncedChanges(
      {
        repo: 'boat1994/bemoat-web-starter',
        ref: 'main',
        targetRoot,
      },
      git,
    )
    mod.restoreStashIfNeeded(targetRoot, stashCreated, git)

    expect(stashCreated).toBe(true)
    expect(committed).toBe(true)
    expect(calls).toContain(`stashPush:${targetRoot}`)
    expect(calls).toContain(`stashPop:${targetRoot}`)
    expect(calls).toContain(`commit:${targetRoot}:sync boilerplate from boat1994/bemoat-web-starter#main`)

    const addCall = calls.find((call) => call.startsWith(`addPaths:${targetRoot}:`))
    expect(addCall).toContain('.bemoat-boilerplate-sync.json')
    expect(addCall).toContain('package.json')
    expect(addCall).toContain('AGENTS.md')
    expect(addCall).not.toContain('notes.txt')
  })
})
