import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = process.cwd()
const scriptPath = resolve(repoRoot, 'scripts/check-branch-safety.sh')
const tempRoots: string[] = []

function createRepoOnBranch(branch: string) {
  const root = mkdtempSync(join(tmpdir(), 'bemoat-branch-safety-'))
  tempRoots.push(root)

  const init = spawnSync('git', ['init', '-b', branch], {
    cwd: root,
    encoding: 'utf8',
  })

  expect(init.status, init.stderr).toBe(0)

  return root
}

function runBranchCheck(branch: string, env: Record<string, string> = {}) {
  const root = createRepoOnBranch(branch)

  return spawnSync('bash', [scriptPath], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  })
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('branch safety script', () => {
  it('blocks commits and pushes on main', () => {
    const result = runBranchCheck('main')

    expect(result.status).toBe(1)
    expect(result.stdout).toContain('Current branch: main')
    expect(result.stderr).toContain('main is protected')
  })

  it('blocks routine implementation on dev without an explicit bypass', () => {
    const result = runBranchCheck('dev')

    expect(result.status).toBe(1)
    expect(result.stdout).toContain('Current branch: dev')
    expect(result.stderr).toContain('dev is an integration branch')
  })

  it('allows dev only for explicit integration maintenance', () => {
    const result = runBranchCheck('dev', { ALLOW_INTEGRATION_BRANCH: '1' })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('integration maintenance bypass enabled')
  })

  it('allows supported topic, release, and hotfix branch patterns', () => {
    for (const branch of [
      'feature/67-git-flow',
      'feat/67-git-flow',
      'fix/67-git-flow',
      'refactor/67-git-flow',
      'chore/67-git-flow',
      'test/67-git-flow',
      'docs/67-git-flow',
      'release/2026-06-30',
      'hotfix/67-git-flow',
    ]) {
      const result = runBranchCheck(branch)

      expect(result.status, `${branch}: ${result.stderr}`).toBe(0)
      expect(result.stdout).toContain(`Current branch: ${branch}`)
    }
  })

  it('blocks unsupported branch names with branch creation guidance', () => {
    const result = runBranchCheck('experiment/git-flow')

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Unsupported implementation branch')
    expect(result.stderr).toContain('git switch -c chore/67-git-flow-branch-guardrails dev')
  })
})
