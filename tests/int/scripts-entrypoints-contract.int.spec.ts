import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  formatHarnessContractViolations,
  getHarnessContractExitCode,
} from '../../scripts/guard-harness-contract.ts'
import {
  parseApplyBuildContract,
  parseSyncMode,
  SYNC_MODES,
} from '../../scripts/sync-boilerplate.ts'

const repoRoot = process.cwd()
const tempRoots: string[] = []

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

function createTempRoot(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix))
  tempRoots.push(root)
  return root
}

function runNode(
  scriptRelativePath: string,
  args: string[] = [],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
) {
  return spawnSync(process.execPath, [join(repoRoot, scriptRelativePath), ...args], {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
  })
}

describe('scripts entrypoints contract', () => {
  it('freezes guard-harness-contract success stdout structure and exit 0', () => {
    const result = runNode('scripts/guard-harness-contract.ts')
    expect(result.status).toBe(0)
    expect(result.stdout.trim().split('\n')).toEqual(['Harness contract guard passed.'])
    expect(result.stderr).toBe('')
  })

  it('freezes guard-harness-contract failure diagnostics ordering and exit 1 via temp fixture', () => {
    const root = createTempRoot('bemoat-entrypoint-harness-fail-')
    mkdirSync(join(root, '.github/workflows'), { recursive: true })
    mkdirSync(join(root, '.githooks'), { recursive: true })
    writeFileSync(
      join(root, '.github/workflows/ci.yml'),
      'jobs:\n  test:\n    steps:\n      - run: pnpm run typecheck\n',
    )
    writeFileSync(join(root, '.githooks/pre-commit'), '#!/bin/sh\npnpm run check\n')
    writeFileSync(join(root, '.githooks/pre-push'), '#!/bin/sh\npnpm run typecheck\n')

    const result = runNode('scripts/guard-harness-contract.ts', [], { cwd: root })
    expect(result.status).toBe(1)
    const lines = result.stdout.trim().split('\n')
    expect(lines[0]).toBe('Harness contract guard failed:')
    expect(lines[1]).toBe('')
    expect(lines[2]).toBe('Synced CI and pre-push must call only bemoat:* scripts.')
    expect(lines[3]).toBe('See docs/harness-sync-contract.md.')
    expect(lines[4]).toBe('')
    expect(lines.slice(5).some((line) => line.startsWith('- ['))).toBe(true)
    expect(getHarnessContractExitCode([{ type: 'x' }])).toBe(1)
    expect(formatHarnessContractViolations([])).toEqual(['Harness contract guard passed.'])
  })

  it('freezes guard-package-manager success stdout structure and exit 0', () => {
    const result = runNode('scripts/guards/package-manager.ts')
    expect(result.status).toBe(0)
    expect(result.stdout.trim().split('\n')).toEqual(['Package manager guard passed.'])
    expect(result.stderr).toBe('')
  })

  it('freezes sync-boilerplate CLI parsing defaults without performing a real child sync', () => {
    const emptyEnv = {} as NodeJS.ProcessEnv
    expect(parseSyncMode([], emptyEnv)).toBe(SYNC_MODES.HARNESS_ONLY)
    expect(parseSyncMode(['--harness-only'], emptyEnv)).toBe(SYNC_MODES.HARNESS_ONLY)
    expect(parseSyncMode(['--full'], emptyEnv)).toBe(SYNC_MODES.FULL)
    expect(parseApplyBuildContract([], emptyEnv)).toBe(false)
    expect(parseApplyBuildContract(['--apply-build-contract'], emptyEnv)).toBe(true)
  })

})
