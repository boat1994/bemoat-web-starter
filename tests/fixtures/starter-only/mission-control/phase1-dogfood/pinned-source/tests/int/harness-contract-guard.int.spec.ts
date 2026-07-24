import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('harness contract guard', () => {
  it('exports child-facing paths and forbidden raw scripts', async () => {
    const mod = await import('../../scripts/guard-harness-contract.mjs')

    expect(mod.CHILD_FACING_HARNESS_PATHS).toContain('.github/workflows/ci.yml')
    expect(mod.CHILD_FACING_HARNESS_PATHS).toContain('.githooks/pre-commit')
    expect(mod.CHILD_FACING_HARNESS_PATHS).toContain('.githooks/pre-push')
    expect(mod.FORBIDDEN_RAW_SCRIPTS).toContain('lint')
    expect(mod.FORBIDDEN_RAW_SCRIPTS).toContain('build')
    expect(mod.FORBIDDEN_RAW_SCRIPTS).not.toContain('bemoat:guard:safety')
  })

  it('detects forbidden raw script calls in harness content', async () => {
    const mod = await import('../../scripts/guard-harness-contract.mjs')

    const violations = mod.scanChildFacingHarnessFile(
      '.github/workflows/ci.yml',
      'run: pnpm run lint\nrun: pnpm run bemoat:guard:safety',
    )

    expect(violations).toHaveLength(1)
    expect(violations[0].rule).toBe('lint')
  })

  it('passes when only bemoat:* scripts are called', async () => {
    const mod = await import('../../scripts/guard-harness-contract.mjs')

    const violations = mod.runHarnessContractGuard({
      root: process.cwd(),
      readFile: (filePath) => readFileSync(filePath, 'utf8'),
    })

    expect(violations).toEqual([])
    expect(mod.getHarnessContractExitCode(violations)).toBe(0)
  })

  it('is listed in managedPaths for boilerplate sync', async () => {
    const syncMod = await import('../../scripts/sync-boilerplate.mjs')

    expect(syncMod.managedPaths).toContain('scripts/check-branch-safety.sh')
    expect(syncMod.managedPaths).toContain('scripts/guard-harness-contract.mjs')
    expect(syncMod.managedPackageScripts).toContain('bemoat:branch:check')
    expect(syncMod.managedPackageScripts).toContain('bemoat:guard:harness-contract')
  })
})

describe('harness contract guard on disk', () => {
  it('validates synced CI workflow and hooks', async () => {
    const mod = await import('../../scripts/guard-harness-contract.mjs')

    for (const relativePath of mod.CHILD_FACING_HARNESS_PATHS) {
      const content = readFileSync(resolve(process.cwd(), relativePath), 'utf8')
      const violations = mod.scanChildFacingHarnessFile(relativePath, content)

      expect(
        violations,
        `${relativePath} must not call raw scripts: ${violations.map((item: { rule: string }) => item.rule).join(', ')}`,
      ).toEqual([])
    }
  })
})
