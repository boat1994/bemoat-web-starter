import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const fixturesRoot = resolve(process.cwd(), 'tests/fixtures/mission-control')
const tmpRoot = resolve(process.cwd(), '.tmp-mission-control-contract-test')

describe('mission-control contract guard', () => {
  it('passes on the current repository', async () => {
    const mod = await import('../../scripts/guard-mission-control-contract.mjs')
    const violations = mod.runMissionControlContractGuard()

    expect(mod.getMissionControlContractExitCode(violations)).toBe(0)
    expect(violations).toEqual([])
  })

  it('fails with MC001 when the guide is missing', async () => {
    const mod = await import('../../scripts/guard-mission-control-contract.mjs')
    const violations = mod.scanGuideContent(mod.GUIDE_PATH, null)

    expect(violations).toHaveLength(1)
    expect(violations[0]?.rule).toBe('MC001')
  })

  it('fails when version is missing or invalid', async () => {
    const mod = await import('../../scripts/guard-mission-control-contract.mjs')
    const content = `---
policy_id: bemoat-mission-control
version: not-semver
scope: repository-development
canonical_repository: boat1994/bemoat-web-starter
max_review_cycles: 3
---
`

    const violations = mod.scanGuideContent(mod.GUIDE_PATH, content)
    expect(violations.some((v: { rule: string }) => v.rule === 'MC003')).toBe(true)
  })

  it('fails when max_review_cycles is not 3', async () => {
    const mod = await import('../../scripts/guard-mission-control-contract.mjs')
    const content = `---
policy_id: bemoat-mission-control
version: 1.0.0
scope: repository-development
canonical_repository: boat1994/bemoat-web-starter
max_review_cycles: 4
---
`

    const violations = mod.scanGuideContent(mod.GUIDE_PATH, content)
    expect(violations.some((v: { rule: string }) => v.rule === 'MC004')).toBe(true)
  })

  it('fails when a required guide section is missing', async () => {
    const mod = await import('../../scripts/guard-mission-control-contract.mjs')
    const guide = readFileSync(resolve(process.cwd(), mod.GUIDE_PATH), 'utf8')
    const truncated = guide.replace('## Worked examples', '## Examples only')

    const violations = mod.scanGuideContent(mod.GUIDE_PATH, truncated)
    expect(violations.some((v: { rule: string }) => v.rule === 'MC005')).toBe(true)
  })

  it('fails when loader does not point at the guide', async () => {
    const mod = await import('../../scripts/guard-mission-control-contract.mjs')
    const violations = mod.scanLoaderContent(mod.LOADER_PATH, 'You are Mission Control.\n')

    expect(violations.some((v: { rule: string }) => v.rule === 'MC006')).toBe(true)
  })

  it('fails when loader duplicates long-form policy', async () => {
    const mod = await import('../../scripts/guard-mission-control-contract.mjs')
    const oversized = [
      'Read docs/mission-control/mission-control-guide.md',
      '## Review-cycle budget',
      ...Array.from({ length: 170 }, (_, i) => `line ${i}`),
    ].join('\n')

    const violations = mod.scanLoaderContent(mod.LOADER_PATH, oversized)
    expect(violations.some((v: { rule: string }) => v.rule === 'MC007')).toBe(true)
  })

  it('fails when AGENTS.md lacks the Mission Control pointer', async () => {
    const mod = await import('../../scripts/guard-mission-control-contract.mjs')
    const violations = mod.scanAgentsPointer(mod.AGENTS_PATH, '# Agents\n')

    expect(violations.some((v: { rule: string }) => v.rule === 'MC008')).toBe(true)
  })

  it('fails when a required handoff field is missing', async () => {
    const mod = await import('../../scripts/guard-mission-control-contract.mjs')
    const violations = mod.scanHandoffTemplate(mod.HANDOFF_PATH, '## HANDOFF\n- Repository:\n')

    expect(violations.some((v: { rule: string }) => v.rule === 'MC011')).toBe(true)
  })

  it('fails when RESULT verdict enum is incomplete', async () => {
    const mod = await import('../../scripts/guard-mission-control-contract.mjs')
    const violations = mod.scanResultTemplate(mod.RESULT_PATH, '## RESULT\n- Role:\n')

    expect(violations.some((v: { rule: string }) => v.rule === 'MC011')).toBe(true)
  })

  it('fails when live override path is in managedPaths', async () => {
    const mod = await import('../../scripts/guard-mission-control-contract.mjs')
    const violations = mod.scanManagedPathsContract([
      ...mod.MC_MANAGED_PATHS,
      mod.LIVE_OVERRIDE_PATH,
    ])

    expect(violations.some((v: { rule: string }) => v.rule === 'MC010')).toBe(true)
  })

  it('formats actionable file/rule messages', async () => {
    const mod = await import('../../scripts/guard-mission-control-contract.mjs')
    const lines = mod.formatMissionControlContractViolations([
      {
        type: 'mission-control-contract',
        rule: 'MC001',
        file: mod.GUIDE_PATH,
        message: 'Canonical Mission Control guide is missing',
      },
    ])

    expect(lines.some((line: string) => line.includes('[MC001]'))).toBe(true)
    expect(lines.some((line: string) => line.includes(mod.GUIDE_PATH))).toBe(true)
  })

  it('is included in the central guard pack', async () => {
    const pack = await import('../../scripts/guard-pack.mjs')

    expect(pack.GUARD_PACK.map((guard: { id: string }) => guard.id)).toContain(
      'mission-control-contract',
    )
  })

  it('keeps mission-control fixtures available for sync', () => {
    expect(existsSync(join(fixturesRoot, 'README.md'))).toBe(true)
  })
})

describe('mission-control sync ownership', () => {
  it('lists managed Mission Control paths and excludes the live override', async () => {
    const syncMod = await import('../../scripts/sync-boilerplate.mjs')
    const guardMod = await import('../../scripts/guard-mission-control-contract.mjs')

    for (const path of guardMod.MC_MANAGED_PATHS) {
      expect(syncMod.managedPaths).toContain(path)
    }
    expect(syncMod.managedPaths).not.toContain(guardMod.LIVE_OVERRIDE_PATH)
    expect(syncMod.managedPackageScripts).toContain('bemoat:guard:mission-control-contract')
  })

  it('syncs Mission Control managed files twice while preserving child override', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    rmSync(tmpRoot, { recursive: true, force: true })
    const sourceRoot = join(tmpRoot, 'source')
    const targetRoot = join(tmpRoot, 'target')

    const managedFiles = [
      'docs/mission-control/README.md',
      'docs/mission-control/mission-control-guide.md',
      'docs/mission-control/handoff-template.md',
      'docs/mission-control/result-template.md',
      'docs/mission-control/project-overrides.example.md',
      'prompts/mission-control/chatgpt-project-loader.md',
      'scripts/guard-mission-control-contract.mjs',
      'tests/int/mission-control-contract.int.spec.ts',
      'tests/fixtures/mission-control/README.md',
    ]

    for (const relativePath of managedFiles) {
      mkdirSync(join(sourceRoot, relativePath, '..'), { recursive: true })
      writeFileSync(join(sourceRoot, relativePath), `starter:${relativePath}\n`)
      mkdirSync(join(targetRoot, relativePath, '..'), { recursive: true })
      writeFileSync(join(targetRoot, relativePath), `stale:${relativePath}\n`)
    }

    mkdirSync(join(targetRoot, 'src/app'), { recursive: true })
    writeFileSync(join(targetRoot, 'src/app/child-only.tsx'), 'export const Child = 1\n')
    mkdirSync(join(targetRoot, '.bemoat'), { recursive: true })
    const overrideContent = 'approved_base: child-main\ncustom: keep-me\n'
    writeFileSync(join(targetRoot, '.bemoat/mission-control-overrides.md'), overrideContent)

    const syncConfig = {
      ...mod.getDefaultSyncConfig(),
      managedPaths: managedFiles,
      seedOnlyPaths: ['src/app'],
      mergeKeepPaths: [] as string[],
    }

    const first = mod.syncPathsFromSource({
      sourceRootPath: sourceRoot,
      targetRootPath: targetRoot,
      mode: mod.SYNC_MODES.HARNESS_ONLY,
      syncConfig,
      onWarn: () => {},
      onLog: () => {},
    })
    const second = mod.syncPathsFromSource({
      sourceRootPath: sourceRoot,
      targetRootPath: targetRoot,
      mode: mod.SYNC_MODES.HARNESS_ONLY,
      syncConfig,
      onWarn: () => {},
      onLog: () => {},
    })

    for (const relativePath of managedFiles) {
      expect(readFileSync(join(targetRoot, relativePath), 'utf8')).toBe(`starter:${relativePath}\n`)
    }
    expect(readFileSync(join(targetRoot, '.bemoat/mission-control-overrides.md'), 'utf8')).toBe(
      overrideContent,
    )
    expect(readFileSync(join(targetRoot, 'src/app/child-only.tsx'), 'utf8')).toBe(
      'export const Child = 1\n',
    )
    expect(first.seedOnlyPathsSkipped).toBe(true)
    expect(second.seedOnlyPathsSkipped).toBe(true)

    rmSync(tmpRoot, { recursive: true, force: true })
  })
})
