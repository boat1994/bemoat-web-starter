import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = process.cwd()
const scriptPath = resolve(repoRoot, 'scripts/agent-issue.mjs')
const tempRoots: string[] = []

function createRepo(branch: string) {
  const root = mkdtempSync(join(tmpdir(), 'bemoat-agent-issue-'))
  tempRoots.push(root)

  const init = spawnSync('git', ['init', '-b', branch], {
    cwd: root,
    encoding: 'utf8',
  })

  expect(init.status, init.stderr).toBe(0)

  const remote = spawnSync(
    'git',
    ['remote', 'add', 'origin', 'https://github.com/boat1994/bemoat-web-starter.git'],
    {
      cwd: root,
      encoding: 'utf8',
    },
  )

  expect(remote.status, remote.stderr).toBe(0)

  return root
}

function writeExecutable(filePath: string, content: string) {
  writeFileSync(filePath, content)
  chmodSync(filePath, 0o755)
}

function withStubbedGh(root: string, content: string) {
  const binDir = mkdtempSync(join(tmpdir(), 'bemoat-agent-issue-bin-'))
  const ghPath = join(binDir, 'gh')

  tempRoots.push(binDir)
  mkdirSync(binDir, { recursive: true })
  writeExecutable(ghPath, content)

  return `${binDir}:${process.env.PATH ?? ''}`
}

function runAgentIssue(root: string, args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
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

describe('agent issue preflight', () => {
  it('exits non-zero when the issue number is missing', () => {
    const root = createRepo('feature/83-agent-issue')
    const result = runAgentIssue(root, [])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Usage: pnpm run bemoat:agent:issue -- <issue-number>')
  })

  it('passes on a clean implementation branch and prints GitHub issue metadata when available', () => {
    const root = createRepo('feature/83-agent-issue')
    const pathValue = withStubbedGh(
      root,
      `#!/usr/bin/env sh
printf '%s' '{"title":"Minimal bemoat:agent:issue contract for issue-driven AI workflow","url":"https://github.com/boat1994/bemoat-web-starter/issues/83"}'
`,
    )

    const result = runAgentIssue(root, ['83'], { PATH: pathValue })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Current branch: feature/83-agent-issue')
    expect(result.stdout).toContain('Git status --short:\n<clean>')
    expect(result.stdout).toContain('Title: Minimal bemoat:agent:issue contract for issue-driven AI workflow')
    expect(result.stdout).toContain('URL: https://github.com/boat1994/bemoat-web-starter/issues/83')
    expect(result.stdout).toContain(
      'Suggested branch default: feature/83-minimal-bemoat-agent-issue-contract-for-issue-dr',
    )
    expect(result.stdout).toContain('Adjust the prefix if this is docs, fix, chore, test, or refactor work.')
    expect(result.stdout).toContain('Validation guidance:')
    expect(result.stdout).toContain('- Follow the validation tier in AGENTS.md.')
    expect(result.stdout).toContain('- Starter code/script changes usually require pnpm run check.')
    expect(result.stdout).toContain('- Child repos must use the bemoat:* tier documented in AGENTS.md.')
    expect(result.stdout).not.toContain('Starter docs-only changes: pnpm run guard:safety')
    expect(result.stdout).toContain('Next manual step: Read the listed docs')
  })

  it('accepts the documented pnpm argument separator before the issue number', () => {
    const root = createRepo('feature/83-agent-issue')
    const pathValue = withStubbedGh(
      root,
      `#!/usr/bin/env sh
printf '%s' '{"title":"Minimal bemoat:agent:issue contract for issue-driven AI workflow","url":"https://github.com/boat1994/bemoat-web-starter/issues/83"}'
`,
    )

    const result = runAgentIssue(root, ['--', '83'], { PATH: pathValue })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Issue number: 83')
    expect(result.stdout).toContain('Title: Minimal bemoat:agent:issue contract for issue-driven AI workflow')
  })

  it('fails on main and suggests a topic branch command without mutating the repo', () => {
    const root = createRepo('main')
    const pathValue = withStubbedGh(
      root,
      `#!/usr/bin/env sh
printf '%s' '{"title":"Minimal bemoat:agent:issue contract for issue-driven AI workflow","url":"https://github.com/boat1994/bemoat-web-starter/issues/83"}'
`,
    )

    const beforeBranches = spawnSync('git', ['branch', '--list'], {
      cwd: root,
      encoding: 'utf8',
    }).stdout

    const result = runAgentIssue(root, ['83'], { PATH: pathValue })

    const afterBranches = spawnSync('git', ['branch', '--list'], {
      cwd: root,
      encoding: 'utf8',
    }).stdout

    expect(result.status).toBe(1)
    expect(result.stdout).toContain('main is protected and read-only for direct coding')
    expect(result.stdout).toContain('Repo bootstrap note:')
    expect(result.stdout).toContain(
      "Next manual step: Create a topic branch from the repo's current integration baseline.",
    )
    expect(result.stdout).toContain(
      'Example when dev is unavailable: git switch -c feature/83-minimal-bemoat-agent-issue-contract-for-issue-dr',
    )
    expect(result.stdout).not.toContain('Next recommended command:')
    expect(afterBranches).toBe(beforeBranches)
  })

  it('fails on dev without the integration maintenance bypass', () => {
    const root = createRepo('dev')
    const pathValue = withStubbedGh(
      root,
      `#!/usr/bin/env sh
printf '%s' '{"title":"Minimal bemoat:agent:issue contract for issue-driven AI workflow","url":"https://github.com/boat1994/bemoat-web-starter/issues/83"}'
`,
    )

    const result = runAgentIssue(root, ['83'], { PATH: pathValue })

    expect(result.status).toBe(1)
    expect(result.stdout).toContain('dev is an integration branch, not a routine implementation branch')
    expect(result.stdout).toContain(
      "Next manual step: Create a topic branch from the repo's current integration baseline.",
    )
    expect(result.stdout).toContain(
      'Example from the current dev branch: git switch -c feature/83-minimal-bemoat-agent-issue-contract-for-issue-dr',
    )
    expect(result.stdout).not.toContain('Next recommended command:')
  })

  it('fails when the working tree is dirty', () => {
    const root = createRepo('feature/83-agent-issue')
    const pathValue = withStubbedGh(
      root,
      `#!/usr/bin/env sh
echo 'offline test gh stub' >&2
exit 1
`,
    )
    writeFileSync(join(root, 'dirty.txt'), 'pending change\n')

    const result = runAgentIssue(root, ['83'], { PATH: pathValue })

    expect(result.status).toBe(1)
    expect(result.stdout).toContain('Git status --short:\n?? dirty.txt')
    expect(result.stdout).toContain('Working tree: not clean.')
    expect(result.stdout).toContain('Metadata unavailable: offline test gh stub')
    expect(result.stdout).toContain('Report the dirty working tree blocker and do not edit files.')
  })

  it('falls back gracefully when GitHub metadata is unavailable', () => {
    const root = createRepo('feature/83-agent-issue')
    const pathValue = withStubbedGh(
      root,
      `#!/usr/bin/env sh
echo 'authentication required' >&2
exit 1
`,
    )

    const result = runAgentIssue(root, ['83'], { PATH: pathValue })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Metadata unavailable: authentication required')
    expect(result.stdout).toContain(
      'Best-effort issue URL: https://github.com/boat1994/bemoat-web-starter/issues/83',
    )
  })
})
