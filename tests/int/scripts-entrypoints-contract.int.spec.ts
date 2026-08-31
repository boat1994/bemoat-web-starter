import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  formatHarnessContractViolations,
  getHarnessContractExitCode,
} from '../../scripts/guard-harness-contract.mjs'
import {
  formatMissionControlContractViolations,
  getMissionControlContractExitCode,
} from '../../scripts/guard-mission-control-contract.mjs'
import {
  enforceMcTransitionChildSyncGate,
  parseApplyBuildContract,
  parseSyncMode,
  SYNC_MODES,
} from '../../scripts/sync-boilerplate.mjs'

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
    const result = runNode('scripts/guard-harness-contract.mjs')
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

    const result = runNode('scripts/guard-harness-contract.mjs', [], { cwd: root })
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

  it('freezes guard-mission-control-contract success stdout structure and exit 0', () => {
    const result = runNode('scripts/guard-mission-control-contract.mjs')
    expect(result.status).toBe(0)
    expect(result.stdout.trim().split('\n')).toEqual(['Mission Control contract guard passed.'])
    expect(result.stderr).toBe('')
  })

  it('freezes guard-package-manager success stdout structure and exit 0', () => {
    const result = runNode('scripts/guards/package-manager.mjs')
    expect(result.status).toBe(0)
    expect(result.stdout.trim().split('\n')).toEqual(['Package manager guard passed.'])
    expect(result.stderr).toBe('')
  })

  it('freezes guard-mission-control-contract failure diagnostics ordering and exit mapping', () => {
    expect(getMissionControlContractExitCode([])).toBe(0)
    expect(getMissionControlContractExitCode([{ rule: 'x', file: 'f', message: 'm' }])).toBe(1)
    expect(formatMissionControlContractViolations([])).toEqual([
      'Mission Control contract guard passed.',
    ])
    expect(
      formatMissionControlContractViolations([
        { rule: 'guide-required-phrase', file: 'docs/x.md', message: 'missing phrase' },
      ]),
    ).toEqual([
      'Mission Control contract guard failed:',
      '',
      'Fix the violations below, then rerun `pnpm run guard:mission-control-contract` or `pnpm run bemoat:guard:safety`.',
      'See docs/guard-pack.md and docs/mission-control/README.md.',
      '',
      '- [guide-required-phrase] docs/x.md: missing phrase',
    ])
  })

  it('freezes sync-boilerplate CLI defaults, args, and gate failure without performing a real child sync', () => {
    const emptyEnv = {} as NodeJS.ProcessEnv
    expect(parseSyncMode([], emptyEnv)).toBe(SYNC_MODES.HARNESS_ONLY)
    expect(parseSyncMode(['--harness-only'], emptyEnv)).toBe(SYNC_MODES.HARNESS_ONLY)
    expect(parseSyncMode(['--full'], emptyEnv)).toBe(SYNC_MODES.FULL)
    expect(parseApplyBuildContract([], emptyEnv)).toBe(false)
    expect(parseApplyBuildContract(['--apply-build-contract'], emptyEnv)).toBe(true)
    expect(
      enforceMcTransitionChildSyncGate({ argv: ['--skip-mc-transition-gate'], env: emptyEnv }),
    ).toEqual({
      enforced: false,
      allowed: true,
    })

    const blocked = runNode('scripts/sync-boilerplate.mjs', [], {
      env: {
        ...process.env,
        BEMOAT_SKIP_MC_TRANSITION_CHILD_SYNC_GATE: '0',
        BEMOAT_CHILD_SYNC_182_MERGED: '',
        BEMOAT_CHILD_SYNC_184_MERGED: '',
        BEMOAT_CHILD_SYNC_LIVE_RECONSTRUCTED: '',
        BEMOAT_CHILD_SYNC_FRESH_HANDOFF: '',
      },
    })
    expect(blocked.status).not.toBe(0)
    expect(blocked.stderr).toContain('child-sync gate blocked:')
    expect(blocked.stderr).toContain('Issue #182 must be merged and green on protected main')
    expect(blocked.stderr).toContain('Issue #184 must be merged and green on protected main')
    expect(blocked.stderr).toContain('live child-state reconstruction required')
    expect(blocked.stderr).toContain('fresh child-sync HANDOFF required')
    expect(blocked.stdout).not.toContain('Syncing Bemoat boilerplate')
  })

})
