import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const fixturesRoot = resolve(process.cwd(), 'tests/fixtures/mission-control')
const tmpRoot = resolve(process.cwd(), '.tmp-mission-control-contract-test')

describe('mission-control contract guard', () => {
  it('enforces deterministic ordering of required modules', async () => {
    const mod = await import('../../scripts/guard-mission-control-contract.mjs')

    expect(mod.MC_MANAGED_MODULES).toEqual([
      mod.MODULE_PROCEDURES_PATH,
      mod.MODULE_CHECKLISTS_PATH,
      mod.MODULE_TEMPLATES_PATH,
      mod.MODULE_TROUBLESHOOTING_PATH,
      mod.MODULE_MIGRATION_PATH,
      mod.MODULE_CHILD_SYNC_PATH,
    ])
  })

  it('fails closed when a required module is missing', async () => {
    const mod = await import('../../scripts/guard-mission-control-contract.mjs')

    // Simulate a missing required module by using a temp root that physically
    // lacks troubleshooting.md. This exercises the existsSync path in
    // readOptional — the same mechanism production uses to detect missing files.
    const missingModRoot = join(tmpRoot, 'missing-module')
    const presentModules = [
      mod.MODULE_PROCEDURES_PATH,
      mod.MODULE_CHECKLISTS_PATH,
      mod.MODULE_TEMPLATES_PATH,
      // MODULE_TROUBLESHOOTING_PATH intentionally absent
      mod.MODULE_MIGRATION_PATH,
      mod.MODULE_CHILD_SYNC_PATH,
    ]
    try {
      for (const relPath of presentModules) {
        mkdirSync(join(missingModRoot, relPath, '..'), { recursive: true })
        writeFileSync(join(missingModRoot, relPath), `# placeholder\n`)
      }

      const violations = mod.runMissionControlContractGuard({ root: missingModRoot })
      expect(violations.some((v: { rule: string }) => v.rule === 'MC013')).toBe(true)
    } finally {
      rmSync(missingModRoot, { recursive: true, force: true })
    }
  })

  it('fails if a required section is moved into an unrelated module', async () => {
    const mod = await import('../../scripts/guard-mission-control-contract.mjs')

    const violations = mod.scanModuleContent(mod.MODULE_PROCEDURES_PATH, '## Some section\n')

    expect(violations.some(v => v.rule === 'MC005' && v.message.includes('## Double-Loop Review Gate'))).toBe(true)
  })

  it('fails when cost-aware routing invariants are incomplete', async () => {
    const mod = await import('../../scripts/guard-mission-control-contract.mjs')
    expect(mod.REQUIRED_COST_AWARE_GUIDE_PHRASES).toEqual(
      expect.arrayContaining([
        'Delta Review uses the lowest reasoning level that can reliably verify the bounded change.',
        'FAST defaults to focused verification without independent high-reasoning review.',
        'STANDARD defaults to one risk-adjusted semantic review: Medium for bounded normal-risk work and High only for material ambiguity or significant connected risk.',
        'MANAGED defaults to one independent High Full Semantic Review, followed by bounded Delta Review.',
        'A Full Semantic Review escalation requires at least one explicit proven trigger.',
      ]),
    )
    const guide = readFileSync(resolve(process.cwd(), mod.GUIDE_PATH), 'utf8')
    const missingOperationalRule = guide.replace(
      'A durable state transition does not itself require or authorize a separate model run.',
      'A durable state transition may require a separate model run.',
    )

    const violations = mod.scanGuideContent(mod.GUIDE_PATH, missingOperationalRule)

    expect(violations.some((v: { rule: string; message: string }) => v.rule === 'MC012')).toBe(true)
  })

  it('fails when the Double-Loop Review Gate contract is incomplete', async () => {
    const mod = await import('../../scripts/guard-mission-control-contract.mjs')

    expect(mod.DOUBLE_LOOP_FAILURE_CLASSES).toEqual([
      'IMPLEMENTATION',
      'SPECIFICATION',
      'VALIDATION',
      'DECOMPOSITION',
      'TOOL_OR_MODEL',
      'ENVIRONMENT',
      'UNKNOWN',
    ])
    expect(mod.DOUBLE_LOOP_ALLOWED_DECISIONS).toContain('CONTINUE_IMPLEMENTATION')
    expect(mod.DOUBLE_LOOP_ALLOWED_DECISIONS).toContain('BLOCKED_FOR_FOUNDER_DECISION')

    const guide = readFileSync(resolve(process.cwd(), mod.GUIDE_PATH), 'utf8')
    const missingUnknownSafeguard = guide.replace(
      '`UNKNOWN` must not authorize another materially similar edit.',
      '`UNKNOWN` may continue implementation.',
    )

    const violations = mod.scanModuleContent(mod.MODULE_PROCEDURES_PATH, missingUnknownSafeguard)

    expect(violations.some((v: { rule: string; message: string }) => v.rule === 'MC012')).toBe(true)
  })

  it('fails when compact transport omits the Double-Loop Review fields', async () => {
    const mod = await import('../../scripts/guard-mission-control-contract.mjs')
    const contract = readFileSync(resolve(process.cwd(), mod.ROLE_HANDOFF_PATH), 'utf8')
    const missingDecision = contract.replace('**Decision:**', '**Outcome:**')

    const violations = mod.scanRoleHandoffContract(mod.ROLE_HANDOFF_PATH, missingDecision)

    expect(violations.some((v: { rule: string; message: string }) => v.rule === 'MC011')).toBe(true)
  })

  it('fails when immutable correction transport invariants are incomplete', async () => {
    const mod = await import('../../scripts/guard-mission-control-contract.mjs')
    expect(mod.REQUIRED_CORRECTION_GUIDE_PHRASES).toEqual(
      expect.arrayContaining([
        'Reviewers own immutable finding identity',
        'Correction agents may not rename, reinterpret, regroup, substitute, add, or omit findings',
      ]),
    )

    const guide = readFileSync(resolve(process.cwd(), mod.GUIDE_PATH), 'utf8')
    const missingIdentity = guide.replace(
      'Reviewers own immutable finding identity',
      'Findings may be freely rewritten during correction',
    )
    const guideViolations = mod.scanGuideContent(mod.GUIDE_PATH, missingIdentity)
    expect(guideViolations.some((v: { rule: string }) => v.rule === 'MC012')).toBe(true)

    const contract = readFileSync(resolve(process.cwd(), mod.ROLE_HANDOFF_PATH), 'utf8')
    const missingEvidenceMap = contract.replace('### Correction RESULT evidence map', '### Correction notes')
    const handoffViolations = mod.scanRoleHandoffContract(mod.ROLE_HANDOFF_PATH, missingEvidenceMap)
    expect(handoffViolations.some((v: { rule: string }) => v.rule === 'MC011')).toBe(true)
  })

  it('fails when brainstorming response profile invariants are incomplete', async () => {
    const mod = await import('../../scripts/guard-mission-control-contract.mjs')
    expect(mod.REQUIRED_BRAINSTORMING_GUIDE_PHRASES).toEqual(
      expect.arrayContaining([
        'formatting and routing guidance only',
        'Use exactly one profile marker heading: `## BRAINSTORMING` or `## DESIGN RESULT`',
      ]),
    )

    const guide = readFileSync(resolve(process.cwd(), mod.GUIDE_PATH), 'utf8')
    const missingAuthorization = guide.replace(
      'It **does not** authorize implementation, branch creation, commits, PR',
      'Brief approval authorizes implementation immediately',
    )

    const violations = mod.scanGuideContent(mod.GUIDE_PATH, missingAuthorization)
    expect(violations.some((v: { rule: string }) => v.rule === 'MC012')).toBe(true)
  })

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
    const truncated = guide.replace('## Purpose', '## Porpoise')

    const violations = mod.scanGuideContent(mod.GUIDE_PATH, truncated)
    expect(violations.some((v: { rule: string }) => v.rule === 'MC005')).toBe(true)
  })

  it('fails when loader does not point at the guide', async () => {
    const mod = await import('../../scripts/guard-mission-control-contract.mjs')
    const violations = mod.scanLoaderContent(mod.LOADER_PATH, 'You are Mission Control.\n')

    expect(violations.some((v: { rule: string }) => v.rule === 'MC006')).toBe(true)
  })

  it('fails when loader exceeds thin bootstrap line limit', async () => {
    const mod = await import('../../scripts/guard-mission-control-contract.mjs')
    const oversized = [
      'Read docs/mission-control/mission-control-guide.md',
      ...Array.from({ length: mod.LOADER_MAX_LINES + 1 }, (_, i) => `line ${i}`),
    ].join('\n')

    const violations = mod.scanLoaderContent(mod.LOADER_PATH, oversized)
    expect(violations.some((v: { rule: string }) => v.rule === 'MC007')).toBe(true)
  })

  it('fails when loader duplicates long-form policy', async () => {
    const mod = await import('../../scripts/guard-mission-control-contract.mjs')
    const oversized = [
      'Read docs/mission-control/mission-control-guide.md',
      '## Review-cycle budget',
      'keep thin',
    ].join('\n')

    const violations = mod.scanLoaderContent(mod.LOADER_PATH, oversized)
    expect(violations.some((v: { rule: string }) => v.rule === 'MC007')).toBe(true)
  })

  it('keeps the thin-loader ceiling at 80 lines', async () => {
    const mod = await import('../../scripts/guard-mission-control-contract.mjs')
    expect(mod.LOADER_MAX_LINES).toBe(80)
  })

  it('requires lean Founder Decision invariants in guide and loader', async () => {
    const mod = await import('../../scripts/guard-mission-control-contract.mjs')
    const guide = readFileSync(resolve(process.cwd(), mod.GUIDE_PATH), 'utf8')
    const loader = readFileSync(resolve(process.cwd(), mod.LOADER_PATH), 'utf8')

    expect(mod.MODULE_SECTION_MAP[mod.GUIDE_PATH]).toContain('## Lean Founder Decision')
    expect(mod.REQUIRED_LEAN_FOUNDER_DECISION_PHRASES.length).toBeGreaterThan(0)
    expect(mod.REQUIRED_LEAN_FOUNDER_LOADER_PHRASES.length).toBeGreaterThan(0)

    for (const phrase of mod.REQUIRED_LEAN_FOUNDER_DECISION_PHRASES) {
      expect(guide).toContain(phrase)
    }
    for (const phrase of mod.REQUIRED_LEAN_FOUNDER_LOADER_PHRASES) {
      expect(loader).toContain(phrase)
    }

    const strippedGuide = guide.replace(
      'Do not include Suggested model, Ready-to-paste prompts',
      'Suggested model and Ready-to-paste are allowed before Approve',
    )
    const guideViolations = mod.scanGuideContent(mod.GUIDE_PATH, strippedGuide)
    expect(
      guideViolations.some(
        (v: { rule: string; message: string }) =>
          v.rule === 'MC012' && v.message.includes('lean Founder Decision'),
      ),
    ).toBe(true)

    const strippedLoader = loader.replace(
      'Do not include Suggested model, Ready-to-paste',
      'Suggested model and Ready-to-paste may appear before Approve',
    )
    const loaderViolations = mod.scanLoaderContent(mod.LOADER_PATH, strippedLoader)
    expect(
      loaderViolations.some(
        (v: { rule: string; message: string }) =>
          v.rule === 'MC007' && v.message.includes('lean Founder Decision'),
      ),
    ).toBe(true)
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

  it('fails when role-handoff Core verdict enum is incomplete', async () => {
    const mod = await import('../../scripts/guard-mission-control-contract.mjs')
    const violations = mod.scanRoleHandoffContract(
      mod.ROLE_HANDOFF_PATH,
      '## REVIEW_VERDICT\n**Verdict:** ELIGIBLE FOR FOUNDER REVIEW\n',
    )

    expect(violations.some((v: { rule: string; message: string }) => v.rule === 'MC011')).toBe(
      true,
    )
    expect(
      violations.some(
        (v: { message: string }) =>
          v.message.includes('missing Core verdict') && v.message.includes('CORRECTION REQUIRED'),
      ),
    ).toBe(true)
  })

  it('fails when role-handoff uses bare legacy Core verdicts', async () => {
    const mod = await import('../../scripts/guard-mission-control-contract.mjs')
    const content = [
      'CORRECTION REQUIRED',
      'ELIGIBLE FOR FOUNDER REVIEW',
      'BLOCKED FOR FOUNDER DECISION',
      'BLOCKED EXTERNAL',
      'STATE CONFLICT',
      '**Verdict:** PASS | BLOCKED',
    ].join('\n')

    const violations = mod.scanRoleHandoffContract(mod.ROLE_HANDOFF_PATH, content)
    expect(
      violations.some(
        (v: { rule: string; message: string }) =>
          v.rule === 'MC011' && v.message.includes('bare legacy Core verdicts'),
      ),
    ).toBe(true)
  })

  it('accepts the repository role-handoff Core verdict vocabulary', async () => {
    const mod = await import('../../scripts/guard-mission-control-contract.mjs')
    const content = readFileSync(resolve(process.cwd(), mod.ROLE_HANDOFF_PATH), 'utf8')
    const violations = mod.scanRoleHandoffContract(mod.ROLE_HANDOFF_PATH, content)

    expect(violations).toEqual([])
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
