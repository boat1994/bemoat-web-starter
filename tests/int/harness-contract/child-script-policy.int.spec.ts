import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

const tempRoots: string[] = []

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

async function loadPolicy() {
  return import('../../../scripts/harness-contract/child-script-policy.mjs')
}

describe('harness-contract child-script-policy', () => {
  it('exports CHILD_FACING_HARNESS_PATHS in exact baseline order', async () => {
    const mod = await loadPolicy()

    expect(mod.CHILD_FACING_HARNESS_PATHS).toEqual([
      '.github/workflows/ci.yml',
      '.githooks/pre-commit',
      '.githooks/pre-push',
    ])
  })

  it('exports FORBIDDEN_RAW_SCRIPTS in exact baseline order', async () => {
    const mod = await loadPolicy()

    expect(mod.FORBIDDEN_RAW_SCRIPTS).toEqual([
      'guard:safety',
      'guard:cloudflare-env',
      'check',
      'check:full',
      'typecheck',
      'lint',
      'build',
      'deploy',
      'deploy:app',
      'deploy:database',
      'deploy:dev',
      'preview',
      'test:int',
      'test',
      'generate:importmap',
      'generate:types',
    ])
  })

  it('extracts pnpm run script names', async () => {
    const mod = await loadPolicy()

    expect(mod.extractPnpmRunScripts('run: pnpm run lint\nrun: pnpm run bemoat:check')).toEqual([
      'lint',
      'bemoat:check',
    ])
  })

  it('detects forbidden raw script calls', async () => {
    const mod = await loadPolicy()

    expect(mod.findForbiddenRawScriptCalls('pnpm run lint\npnpm run bemoat:guard:safety')).toEqual([
      'lint',
    ])
  })

  it('scans child-facing harness files for forbidden-raw-script violations', async () => {
    const mod = await loadPolicy()

    expect(
      mod.scanChildFacingHarnessFile(
        '.github/workflows/ci.yml',
        'run: pnpm run lint\nrun: pnpm run bemoat:guard:safety',
      ),
    ).toEqual([
      {
        type: 'forbidden-raw-script',
        file: '.github/workflows/ci.yml',
        rule: 'lint',
        message:
          'Child-facing harness must not call non-namespaced script "lint" — use bemoat:* instead',
      },
    ])
  })

  it('runs the child-facing guard against a temporary tree', async () => {
    const mod = await loadPolicy()
    const root = mkdtempSync(join(tmpdir(), 'bemoat-240-child-policy-'))
    tempRoots.push(root)

    mkdirSync(join(root, '.github/workflows'), { recursive: true })
    mkdirSync(join(root, '.githooks'), { recursive: true })
    writeFileSync(join(root, '.github/workflows/ci.yml'), 'run: pnpm run lint\n')
    writeFileSync(join(root, '.githooks/pre-commit'), 'pnpm run bemoat:guard:safety\n')
    writeFileSync(join(root, '.githooks/pre-push'), 'pnpm run bemoat:check\n')

    const violations = mod.runHarnessContractGuard({ root })

    expect(violations).toEqual([
      {
        type: 'forbidden-raw-script',
        file: '.github/workflows/ci.yml',
        rule: 'lint',
        message:
          'Child-facing harness must not call non-namespaced script "lint" — use bemoat:* instead',
      },
    ])
    expect(mod.getHarnessContractExitCode(violations)).toBe(1)
    expect(mod.getHarnessContractExitCode([])).toBe(0)
  })

  it('formats success and failure diagnostics with stable ordering', async () => {
    const mod = await loadPolicy()

    expect(mod.formatHarnessContractViolations([])).toEqual(['Harness contract guard passed.'])
    expect(
      mod.formatHarnessContractViolations([
        {
          type: 'forbidden-raw-script',
          file: '.githooks/pre-push',
          rule: 'check',
          message: 'Child-facing harness must not call non-namespaced script "check" — use bemoat:* instead',
        },
        {
          type: 'missing-child-facing-file',
          file: '.githooks/pre-commit',
          rule: 'required-path',
          message: 'Child-facing harness file is missing',
        },
      ]),
    ).toEqual([
      'Harness contract guard failed:',
      '',
      'Synced CI and pre-push must call only bemoat:* scripts.',
      'See docs/harness-sync-contract.md.',
      '',
      '- [forbidden-raw-script] .githooks/pre-push: Child-facing harness must not call non-namespaced script "check" — use bemoat:* instead',
      '- [missing-child-facing-file] .githooks/pre-commit: Child-facing harness file is missing',
    ])
  })
})
