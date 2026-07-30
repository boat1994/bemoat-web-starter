import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve, extname } from 'node:path'

import { describe, expect, it } from 'vitest'

type BuildSyncMetadataInput = {
  syncMode: string
  seedOnlyPathsSkipped: boolean
  syncedManaged?: string[]
  seededFiles?: string[]
  skippedSeedFiles?: string[]
  mergedFiles?: string[]
  repo?: string
  ref?: string
}

type BuildSyncMetadataParams = Parameters<
  (typeof import('../../scripts/sync-boilerplate.mjs'))['buildSyncMetadata']
>[0]

function buildSyncMetadataInput(input: BuildSyncMetadataInput): BuildSyncMetadataParams {
  return input as unknown as BuildSyncMetadataParams
}

/** Integration tests under tests/int that are starter-only and intentionally not synced. */
const STARTER_ONLY_INT_TESTS: { path: string; reason: string }[] = [
  {
    path: 'tests/int/mission-control-phase1-dogfood.int.spec.ts',
    reason: 'Phase 1 Mission Control dogfood proof scenarios (Issue #169) are starter harness validation only',
  },
]

/** Fixture trees that are starter-only and intentionally not synced. */
const STARTER_ONLY_FIXTURE_PATHS: { path: string; reason: string }[] = [
  {
    path: 'tests/fixtures/starter-only/mission-control/phase1-dogfood',
    reason:
      'Phase 1 Mission Control dogfood pinned fixtures (Issue #169) must not sync to child projects',
  },
]

/** Documentation paths that are starter-only and intentionally not synced. */
const STARTER_ONLY_DOCS: { path: string; reason: string }[] = [
  {
    path: 'docs/superpowers',
    reason:
      'Superpowers feature folders are starter-only or child-local; README paths, plans/_templates, and specs/_templates sync as explicit subpaths',
  },
]

/** Superpowers README paths that sync to child projects for canonical planning conventions. */
const SYNCED_SUPERPOWERS_README_PATHS = [
  'docs/superpowers/README.md',
  'docs/superpowers/specs/README.md',
  'docs/superpowers/plans/README.md',
]

/** Superpowers template subpaths that sync to child projects for agent planning workflows. */
const SYNCED_SUPERPOWERS_TEMPLATE_PATHS = [
  'docs/superpowers/plans/_templates',
  'docs/superpowers/specs/_templates',
]

/** README.md is project-owned and must not appear in managedPaths (see docs/harness-sync-contract.md). */

const MANAGED_BEMOAT_PACKAGE_SCRIPTS = [
  'bemoat:agent:issue',
  'bemoat:issue:comment',
  'bemoat:branch:check',
  'bemoat:guard:safety',
  'bemoat:guard:harness-contract',
  'bemoat:guard:mission-control-contract',
  'bemoat:guard:cloudflare-env',
  'bemoat:test:int',
  'bemoat:typecheck',
  'bemoat:check',
  'bemoat:boilerplate:sync',
  'bemoat:boilerplate:check',
  'bemoat:hooks:install',
]

const PROPOSAL_ONLY_PACKAGE_SCRIPTS = [
  'branch:check',
  'build',
  'build:next',
  'build:cloudflare',
  'cf:build',
  'deploy',
  'deploy:app',
  'deploy:database',
  'deploy:dev',
  'preview',
  'check',
  'check:full',
  'lint',
  'typecheck',
  'test',
  'test:int',
  'dev',
  'start',
]

/** Non-bemoat scripts that synced CI and pre-push must not call directly. */
const FORBIDDEN_SYNCED_HARNESS_SCRIPTS = [
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
]

function assertChildSafeHarnessScripts(filePath: string, content: string) {
  const forbidden = [...content.matchAll(/pnpm run ([a-zA-Z0-9:_-]+)/g)]
    .map((match) => match[1])
    .filter((script) => FORBIDDEN_SYNCED_HARNESS_SCRIPTS.includes(script))

  expect(
    forbidden,
    `${filePath} must not call non-namespaced harness scripts directly: ${forbidden.join(', ')}`,
  ).toEqual([])
}

describe('synced harness CI and hooks', () => {
  it('uses only child-safe bemoat:* scripts in synced CI workflow', () => {
    const ciWorkflow = readFileSync(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8')

    assertChildSafeHarnessScripts('.github/workflows/ci.yml', ciWorkflow)
    expect(ciWorkflow).toContain('pnpm run bemoat:guard:safety')
    expect(ciWorkflow).toContain('pnpm run bemoat:test:int')
    expect(ciWorkflow).toContain('pnpm install --frozen-lockfile')
    expect(ciWorkflow).not.toContain('pnpm run lint')
    expect(ciWorkflow).not.toContain('pnpm run build')
    expect(ciWorkflow).not.toContain('pnpm run check')
  })

  it('targets main and dev in the synced CI workflow', () => {
    const ciWorkflow = readFileSync(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8')

    expect(ciWorkflow).toContain('branches:\n      - main\n      - dev')
    expect(ciWorkflow).not.toContain('- develop')
  })

  it('uses only child-safe bemoat:* scripts in synced hooks', () => {
    const preCommit = readFileSync(resolve(process.cwd(), '.githooks/pre-commit'), 'utf8')
    const prePush = readFileSync(resolve(process.cwd(), '.githooks/pre-push'), 'utf8')

    assertChildSafeHarnessScripts('.githooks/pre-commit', preCommit)
    assertChildSafeHarnessScripts('.githooks/pre-push', prePush)
    expect(preCommit).toContain('bash scripts/check-branch-safety.sh')
    expect(prePush).toContain('bash scripts/check-branch-safety.sh')
    expect(prePush).toContain('pnpm run bemoat:guard:safety')
    expect(prePush).toContain('pnpm run bemoat:test:int')
    expect(prePush).not.toContain('pnpm run typecheck')
    expect(prePush).not.toContain('pnpm run guard:safety')
    expect(prePush).not.toContain('pnpm run test:int')
  })
})

describe('boilerplate sync managed paths', () => {
  it('includes repository agent instructions and editor agent rules', () => {
    const script = readFileSync(resolve(process.cwd(), 'scripts/sync-boilerplate.mjs'), 'utf8')

    expect(script).toContain("'AGENTS.md'")
    expect(script).toContain("'ANTIGRAVITY.md'")
    expect(script).toContain("'.agents'")
    expect(script).toContain("'.cursor/rules'")
    expect(script).toContain("'.github/workflows/ci.yml'")
    expect(script).toContain("'scripts/sync-boilerplate.mjs'")
    expect(script).toContain("'scripts/check-boilerplate-drift.mjs'")
  })

  it('includes planning contract guard rails in managedPaths', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    const planningContractPaths = [
      'scripts/guard-planning-contract.mjs',
      'scripts/mission-control-state.mjs',
      'tests/fixtures/planning',
      'tests/int/guard-planning-contract.int.spec.ts',
      'tests/int/guard-planning-contract-child-dev-base.int.spec.ts',
      'tests/int/guard-planning-contract-starter-main-base.int.spec.ts',
    ]

    for (const path of planningContractPaths) {
      expect(
        mod.managedPaths,
        `${path} must be listed in managedPaths so child harness sync receives planning contract validation`,
      ).toContain(path)
    }
  })

  it('includes harness workflow rails in managedPaths and managedPackageScripts', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    const harnessPaths = [
      'ANTIGRAVITY.md',
      'docs/schema-evolution.md',
      'docs/workflow',
      'docs/ai/ui-skills.md',
      'docs/ai/ui-execution-workflow.md',
      'docs/ai/visual-qa-checklist.md',
      'docs/ai/accessibility-baseline.md',
      'prompts/ui',
      'docs/mission-control/README.md',
      'docs/mission-control/mission-control-guide.md',
      'docs/mission-control/handoff-template.md',
      'docs/mission-control/result-template.md',
      'docs/mission-control/project-overrides.example.md',
      'prompts/mission-control/chatgpt-project-loader.md',
      'docs/cloudflare-environments.md',
      'docs/boilerplate-sync-command.md',
      'scripts/agent-issue.mjs',
      'scripts/post-role-comment.mjs',
      'scripts/guard-repo-safety.mjs',
      'scripts/guard-mission-control-contract.mjs',
      'scripts/guard-build-script-contract.mjs',
      'scripts/build.mjs',
      'scripts/guard-cloudflare-env.mjs',
      'scripts/guard-toolchain-contract.mjs',
      'scripts/bemoat-typecheck.mjs',
      'tsconfig.harness-strict.json',
      '.bemoat/toolchain-contract.json',
      'scripts/check-branch-safety.sh',
      'scripts/install-git-hooks.mjs',
      '.githooks',
      'vitest.config.mts',
      'vitest.setup.ts',
      'tests/helpers/vitestProcessLock.ts',
      'tests/setup/vitestGlobalSetup.ts',
      'tests/int/api.int.spec.ts',
      'tests/int/repo-safety-guard.int.spec.ts',
      'tests/int/cloudflare-env-guard.int.spec.ts',
      'tests/int/boilerplate-sync.int.spec.ts',
      'tests/int/agent-issue.int.spec.ts',
      'tests/int/post-role-comment.int.spec.ts',
      'tests/int/branch-safety.int.spec.ts',
      'tests/int/harness-contract-guard.int.spec.ts',
      'tests/int/mission-control-contract.int.spec.ts',
      'tests/int/starter-acceptance.int.spec.ts',
      'tests/int/open-next-config.int.spec.ts',
      'tests/int/payload-build-context.int.spec.ts',
      'tests/int/toolchain-contract.int.spec.ts',
      'tests/int/vitest-process-lock.int.spec.ts',
      'tests/fixtures/mission-control',
    ]

    for (const path of harnessPaths) {
      expect(mod.managedPaths).toContain(path)
    }

    expect(mod.managedPaths).not.toContain('.bemoat/mission-control-overrides.md')

    for (const scriptName of MANAGED_BEMOAT_PACKAGE_SCRIPTS) {
      expect(mod.managedPackageScripts).toContain(scriptName)
    }

    for (const scriptName of PROPOSAL_ONLY_PACKAGE_SCRIPTS) {
      expect(mod.managedPackageScripts).not.toContain(scriptName)
      expect(mod.suggestedPackageScripts).toContain(scriptName)
    }
  })

  it('documents starter-only docs paths outside managedPaths', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    for (const entry of STARTER_ONLY_DOCS) {
      expect(
        mod.managedPaths,
        `${entry.path} must not be in managedPaths: ${entry.reason}`,
      ).not.toContain(entry.path)
    }
  })

  it('documents starter-only fixture paths outside managedPaths', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    for (const entry of STARTER_ONLY_FIXTURE_PATHS) {
      expect(
        mod.managedPaths,
        `${entry.path} must not be in managedPaths: ${entry.reason}`,
      ).not.toContain(entry.path)
    }

    expect(mod.managedPaths).not.toContain('tests/fixtures/starter-only')
  })

  it('does not copy starter-only phase1-dogfood fixtures into a scratch child project', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')
    const fixtureRoot = resolve(process.cwd(), '.tmp-boilerplate-sync-starter-only-dogfood')
    const sourceRoot = join(fixtureRoot, 'source')
    const targetRoot = join(fixtureRoot, 'target')
    const starterOnlyFixtureRoot = join(
      sourceRoot,
      'tests/fixtures/starter-only/mission-control/phase1-dogfood',
    )

    rmSync(fixtureRoot, { recursive: true, force: true })
    mkdirSync(starterOnlyFixtureRoot, { recursive: true })
    mkdirSync(join(sourceRoot, '.bemoat'), { recursive: true })
    mkdirSync(targetRoot, { recursive: true })

    writeFileSync(join(sourceRoot, 'AGENTS.md'), 'starter agents\n')
    seedManagedRuntimeClosureSource(sourceRoot)
    writeFileSync(
      join(starterOnlyFixtureRoot, 'pinned-snapshot.json'),
      '{"pinned_sha":"c01156c66fd33741df9b5d4acf22b620b605f221"}\n',
    )
    writeFileSync(
      join(sourceRoot, mod.syncManifestPath),
      `${JSON.stringify(
        {
          version: 1,
          managedPaths: mod.managedPaths,
          seedOnlyPaths: mod.seedOnlyPaths,
          mergeKeepPaths: mod.mergeKeepPaths,
          managedPackageScripts: mod.managedPackageScripts,
          suggestedPackageScripts: mod.suggestedPackageScripts,
          buildContractPackageScripts: mod.buildContractPackageScripts,
          buildContractFilePaths: mod.buildContractFilePaths,
          suggestedPackageSections: mod.suggestedPackageSections,
        },
        null,
        2,
      )}\n`,
    )

    try {
      const result = mod.syncPathsFromSource({
        sourceRootPath: sourceRoot,
        targetRootPath: targetRoot,
        mode: mod.SYNC_MODES.HARNESS_ONLY,
        onWarn: () => {},
        onLog: () => {},
      })

      expect(result.syncedManaged).toContain('AGENTS.md')
      expect(result.syncedManaged).not.toContain('tests/fixtures/starter-only/mission-control/phase1-dogfood')
      expect(
        existsSync(join(targetRoot, 'tests/fixtures/starter-only/mission-control/phase1-dogfood/pinned-snapshot.json')),
      ).toBe(false)
      expect(
        existsSync(join(targetRoot, 'tests/fixtures/starter-only')),
      ).toBe(false)
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true })
    }
  })

  it('documents starter-only dogfood int spec outside managedPaths', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    for (const entry of STARTER_ONLY_INT_TESTS) {
      expect(
        mod.managedPaths,
        `${entry.path} must not be in managedPaths: ${entry.reason}`,
      ).not.toContain(entry.path)
    }
  })

  it('syncs superpowers README and template paths while keeping docs/superpowers starter-only', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    expect(mod.managedPaths).not.toContain('docs/superpowers')

    for (const readmePath of SYNCED_SUPERPOWERS_README_PATHS) {
      expect(
        mod.managedPaths,
        `${readmePath} must sync to child projects for canonical planning conventions`,
      ).toContain(readmePath)
    }

    for (const templatePath of SYNCED_SUPERPOWERS_TEMPLATE_PATHS) {
      expect(
        mod.managedPaths,
        `${templatePath} must sync to child projects for agent planning workflows`,
      ).toContain(templatePath)
    }
  })

  it('lists every shared harness int test in managedPaths', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'))
    if (pkg.name !== 'bemoat-web-starter') {
      // In child projects, child-local tests are allowed and won't be in managedPaths.
      return
    }

    const allIntTests = mod
      .listPathFiles(process.cwd(), 'tests/int')
      .filter((path: string) => path.endsWith('.int.spec.ts'))
      .sort()

    const starterOnlyPaths = new Set(STARTER_ONLY_INT_TESTS.map((entry) => entry.path))

    for (const testPath of allIntTests) {
      if (starterOnlyPaths.has(testPath)) continue

      expect(
        mod.managedPaths,
        `${testPath} must be listed in managedPaths (scripts/sync-boilerplate.mjs) or documented in STARTER_ONLY_INT_TESTS`,
      ).toContain(testPath)
    }
  })

  it('adds a missing bemoat:* script without touching child-owned scripts', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    const sourcePackage = {
      scripts: {
        'bemoat:check': 'pnpm run bemoat:guard:safety',
        'bemoat:boilerplate:sync': 'node scripts/sync-boilerplate.mjs',
        build: 'pnpm run build:app',
        deploy: 'pnpm run deploy:app',
        check: 'pnpm run lint',
      },
      dependencies: { payload: '3.82.1' },
      devDependencies: { vitest: '3.0.0' },
    }

    const targetPackage = {
      scripts: {
        deploy: 'pnpm run custom-deploy',
        check: 'pnpm run custom-check',
      },
      dependencies: { payload: '3.80.0' },
      devDependencies: {},
    }

    const result = mod.applyManagedPackageScripts(sourcePackage, targetPackage)

    expect(result.addedScripts).toEqual(['bemoat:check', 'bemoat:boilerplate:sync'])
    expect(result.packageJSON.scripts['bemoat:check']).toBe('pnpm run bemoat:guard:safety')
    expect(result.packageJSON.scripts.deploy).toBe('pnpm run custom-deploy')
    expect(result.packageJSON.scripts.check).toBe('pnpm run custom-check')
    expect(result.packageJSON.scripts.build).toBeUndefined()
    expect(result.packageJSON.dependencies).toEqual({ payload: '3.80.0' })
    expect(result.packageJSON.devDependencies).toEqual({})
  })

  it('does not overwrite an existing bemoat:* script', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    const sourcePackage = {
      scripts: {
        'bemoat:check': 'pnpm run bemoat:guard:safety && pnpm run lint',
      },
    }

    const targetPackage = {
      scripts: {
        'bemoat:check': 'pnpm run custom-bemoat-check',
      },
    }

    const result = mod.applyManagedPackageScripts(sourcePackage, targetPackage)

    expect(result.addedScripts).toEqual([])
    expect(result.packageJSON.scripts['bemoat:check']).toBe('pnpm run custom-bemoat-check')
  })

  it('does not add missing deploy, build, or check scripts', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    const sourcePackage = {
      scripts: {
        build: 'pnpm run build:app',
        deploy: 'pnpm run deploy:app',
        check: 'pnpm run lint',
        test: 'pnpm run test:int',
      },
    }

    const targetPackage = {
      scripts: {},
    }

    const result = mod.applyManagedPackageScripts(sourcePackage, targetPackage)

    expect(result.addedScripts).toEqual([])
    expect(result.packageJSON.scripts).toEqual({})
  })

  it('does not overwrite existing deploy, build, or check scripts', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    const sourcePackage = {
      scripts: {
        build: 'pnpm run build:app',
        deploy: 'pnpm run deploy:app',
        check: 'pnpm run lint',
        'check:full': 'pnpm run check && pnpm run build',
        test: 'pnpm run test:int',
        'test:int': 'vitest run --config ./vitest.config.mts tests/int',
      },
    }

    const targetPackage = {
      scripts: {
        build: 'pnpm run custom-build',
        deploy: 'pnpm run custom-deploy',
        check: 'pnpm run custom-check',
        'check:full': 'pnpm run custom-check-full',
        test: 'pnpm run custom-test',
        'test:int': 'pnpm run custom-test-int',
      },
    }

    const result = mod.applyManagedPackageScripts(sourcePackage, targetPackage)

    expect(result.addedScripts).toEqual([])
    expect(result.packageJSON.scripts).toEqual(targetPackage.scripts)
  })

  it('parses --apply-build-contract from argv and BEMOAT_APPLY_BUILD_CONTRACT env', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    expect(mod.parseApplyBuildContract(['--harness-only', '--apply-build-contract'], process.env)).toBe(
      true,
    )
    expect(
      mod.parseApplyBuildContract(['--harness-only'], {
        ...process.env,
        BEMOAT_APPLY_BUILD_CONTRACT: '1',
      }),
    ).toBe(true)
    expect(
      mod.parseApplyBuildContract(['--harness-only'], {
        ...process.env,
        BEMOAT_APPLY_BUILD_CONTRACT: undefined,
      }),
    ).toBe(false)
  })

  it('applies build contract scripts from starter onto a child with recursive OpenNext build', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')
    const starterPackage = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'))
    const childPackage = JSON.parse(
      readFileSync(
        resolve(process.cwd(), 'tests/fixtures/boilerplate-sync/child-recursive-build-package.json'),
        'utf8',
      ),
    )

    const result = mod.applyBuildContractScripts(starterPackage, childPackage)

    expect(result.updatedScripts).toEqual(['build', 'deploy:app', 'preview'])
    expect(result.addedScripts).toEqual([
      'build:next',
      'build:cloudflare',
      'cf:build',
      'deploy',
      'deploy:database',
      'deploy:dev',
    ])
    expect(result.packageJSON.scripts.build).toBe(starterPackage.scripts.build)
    expect(result.packageJSON.scripts['build:next']).toBe(starterPackage.scripts['build:next'])
    expect(result.packageJSON.scripts['build:cloudflare']).toBe(starterPackage.scripts['build:cloudflare'])
    expect(result.packageJSON.scripts['cf:build']).toBe(starterPackage.scripts['cf:build'])
    expect(result.packageJSON.scripts.deploy).toBe(starterPackage.scripts.deploy)
    expect(result.packageJSON.scripts['deploy:app']).toBe(starterPackage.scripts['deploy:app'])
    expect(result.packageJSON.scripts['deploy:database']).toBe(starterPackage.scripts['deploy:database'])
    expect(result.packageJSON.scripts['deploy:dev']).toBe(starterPackage.scripts['deploy:dev'])
    expect(result.packageJSON.scripts['deploy:database']).toContain('PAYLOAD_MIGRATE_REMOTE=true')
    expect(result.packageJSON.scripts.preview).toBe(starterPackage.scripts.preview)
    expect(result.packageJSON.scripts.build).toContain('scripts/build.mjs')
    expect(result.packageJSON.scripts.build).not.toContain('opennextjs-cloudflare build')
    expect(result.packageJSON.scripts.check).toBe('pnpm run custom-check')
  })

  it('does not apply build contract scripts by default during managed package sync', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')
    const childPackage = JSON.parse(
      readFileSync(
        resolve(process.cwd(), 'tests/fixtures/boilerplate-sync/child-recursive-build-package.json'),
        'utf8',
      ),
    )
    const starterPackage = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'))

    for (const scriptName of mod.managedPackageScripts) {
      childPackage.scripts[scriptName] = starterPackage.scripts[scriptName]
    }

    const result = mod.applyManagedPackageScripts(starterPackage, childPackage)

    expect(result.addedScripts).toEqual([])
    expect(result.packageJSON.scripts.build).toContain('opennextjs-cloudflare build')
    expect(result.packageJSON.scripts['cf:build']).toBeUndefined()
  })

  it('writes build contract scripts when syncPackageManifest opts in', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')
    const tempRoot = resolve(process.cwd(), '.tmp-boilerplate-sync-build-contract')
    const sourceRoot = join(tempRoot, 'source')
    const targetRoot = join(tempRoot, 'target')

    mkdirSync(sourceRoot, { recursive: true })
    mkdirSync(targetRoot, { recursive: true })

    const starterPackage = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'))
    const childPackage = JSON.parse(
      readFileSync(
        resolve(process.cwd(), 'tests/fixtures/boilerplate-sync/child-recursive-build-package.json'),
        'utf8',
      ),
    )

    writeFileSync(join(sourceRoot, 'package.json'), `${JSON.stringify(starterPackage, null, 2)}\n`)
    writeFileSync(join(targetRoot, 'package.json'), `${JSON.stringify(childPackage, null, 2)}\n`)

    try {
      const result = mod.syncPackageManifest({
        sourceRootPath: sourceRoot,
        targetRootPath: targetRoot,
        applyBuildContract: true,
      })

      const writtenPackage = JSON.parse(readFileSync(join(targetRoot, 'package.json'), 'utf8'))

      expect(result.packageChanged).toBe(true)
      expect(result.updatedBuildContractScripts).toEqual(['build', 'deploy:app', 'preview'])
      expect(result.appliedBuildContractScripts).toEqual([
        'build:next',
        'build:cloudflare',
        'cf:build',
        'deploy',
        'deploy:database',
        'deploy:dev',
      ])
      expect(writtenPackage.scripts.build).toBe(starterPackage.scripts.build)
      expect(writtenPackage.scripts['cf:build']).toBe(starterPackage.scripts['cf:build'])
      expect(writtenPackage.scripts['deploy:database']).toContain('PAYLOAD_MIGRATE_REMOTE=true')
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('exports buildContractPackageScripts for the universal build wrapper contract', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    expect(mod.buildContractPackageScripts).toEqual([
      'build',
      'build:next',
      'build:cloudflare',
      'cf:build',
      'deploy',
      'deploy:app',
      'deploy:database',
      'deploy:dev',
      'preview',
    ])
    expect(mod.buildContractFilePaths).toEqual(['open-next.config.ts'])
    expect(mod.managedPaths).not.toContain('open-next.config.ts')
  })

  it('does not copy open-next.config.ts during default harness path sync', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')
    const tempRoot = resolve(process.cwd(), '.tmp-boilerplate-sync-default-open-next')
    const sourceRoot = join(tempRoot, 'source')
    const targetRoot = join(tempRoot, 'target')

    mkdirSync(sourceRoot, { recursive: true })
    mkdirSync(targetRoot, { recursive: true })

    writeFileSync(join(sourceRoot, 'open-next.config.ts'), "export default { buildCommand: 'starter' }\n")
    writeFileSync(join(targetRoot, 'open-next.config.ts'), "export default { buildCommand: 'child' }\n")
    seedManagedRuntimeClosureSource(sourceRoot)

    try {
      mod.syncPathsFromSource({
        sourceRootPath: sourceRoot,
        targetRootPath: targetRoot,
        mode: mod.SYNC_MODES.HARNESS_ONLY,
        onWarn: () => {},
        onLog: () => {},
      })

      expect(readFileSync(join(targetRoot, 'open-next.config.ts'), 'utf8')).toContain('child')
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('applies open-next.config.ts when build contract sync opts in', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')
    const tempRoot = resolve(process.cwd(), '.tmp-boilerplate-sync-build-contract-files-apply')
    const sourceRoot = join(tempRoot, 'source')
    const targetRoot = join(tempRoot, 'target')
    const starterConfig = readFileSync(resolve(process.cwd(), 'open-next.config.ts'), 'utf8')

    mkdirSync(sourceRoot, { recursive: true })
    mkdirSync(targetRoot, { recursive: true })

    writeFileSync(join(sourceRoot, 'open-next.config.ts'), starterConfig)
    writeFileSync(
      join(targetRoot, 'open-next.config.ts'),
      "export default { buildCommand: 'pnpm run build:cloudflare' }\n",
    )

    try {
      const result = mod.applyBuildContractFiles(sourceRoot, targetRoot)

      expect(result.updated).toEqual(['open-next.config.ts'])
      expect(readFileSync(join(targetRoot, 'open-next.config.ts'), 'utf8')).toBe(starterConfig)
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('records applied build contract files in sync metadata', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped runtime .mjs boundary
    const metadata = (mod.buildSyncMetadata as unknown as (input: unknown) => any)({
      syncMode: mod.SYNC_MODES.HARNESS_ONLY,
      seedOnlyPathsSkipped: true,
      buildContractFiles: {
        applied: [],
        updated: ['open-next.config.ts'],
        skipped: [],
      },
    })

    expect(metadata.buildContractFilePaths).toEqual(['open-next.config.ts'])
    expect(metadata.buildContractFiles.updated).toEqual(['open-next.config.ts'])
  })

  it('does not mutate dependencies or devDependencies', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    const sourcePackage = {
      scripts: { 'bemoat:check': 'pnpm run bemoat:guard:safety' },
      dependencies: { payload: '3.82.1', next: '15.2.0' },
      devDependencies: { vitest: '3.0.0', typescript: '5.8.0' },
    }

    const targetPackage = {
      scripts: {},
      dependencies: { payload: '3.80.0' },
      devDependencies: { eslint: '9.0.0' },
    }

    const result = mod.applyManagedPackageScripts(sourcePackage, targetPackage)

    expect(result.packageJSON.dependencies).toEqual({ payload: '3.80.0' })
    expect(result.packageJSON.devDependencies).toEqual({ eslint: '9.0.0' })
  })

  it('reports non-namespaced script drift without mutating package.json', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    const sourcePackage = {
      scripts: {
        deploy: 'pnpm run deploy:app',
        check: 'pnpm run lint',
        dev: 'next dev',
      },
      dependencies: { payload: '3.82.1' },
      devDependencies: { vitest: '3.0.0' },
    }

    const targetPackage = {
      scripts: {
        check: 'pnpm run custom-check',
      },
      dependencies: { payload: '3.80.0' },
      devDependencies: {},
    }

    const proposal = mod.buildPackageSyncProposal(sourcePackage, targetPackage)
    const markdown = mod.formatPackageSyncProposal({
      repo: 'boat1994/bemoat-web-starter',
      ref: 'main',
      proposal,
    })

    expect(proposal.missingScripts.map((entry: { name: string }) => entry.name)).toContain('deploy')
    expect(proposal.missingScripts.map((entry: { name: string }) => entry.name)).toContain('dev')
    expect(proposal.differentScripts.map((entry: { name: string }) => entry.name)).toContain('check')
    expect(markdown).toContain('Script drift report (human review only)')
    expect(markdown).toContain('Do not apply these changes automatically')
    expect(markdown).not.toContain('Suggested scripts')
  })

  it('reports dependency drift without mutating package.json', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    const sourcePackage = {
      scripts: {},
      dependencies: { payload: '3.82.1' },
      devDependencies: { vitest: '3.0.0' },
    }

    const targetPackage = {
      scripts: {},
      dependencies: { payload: '3.80.0' },
      devDependencies: {},
    }

    const proposal = mod.buildPackageSyncProposal(sourcePackage, targetPackage)
    const markdown = mod.formatPackageSyncProposal({
      repo: 'boat1994/bemoat-web-starter',
      ref: 'main',
      proposal,
    })

    expect(
      (proposal.missingSectionEntries as Record<string, { name: string }[]>).devDependencies?.map(
        (entry) => entry.name,
      ),
    ).toContain('vitest')
    expect(
      (proposal.differentSectionEntries as Record<string, { name: string }[]>).dependencies?.map(
        (entry) => entry.name,
      ),
    ).toContain('payload')
    expect(markdown).toContain('Dependency drift report (human review only)')
    expect(markdown).not.toContain('Suggested dependencies')
  })

  it('reports differing bemoat:* scripts in the proposal without overwriting them', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    const sourcePackage = {
      scripts: {
        'bemoat:check': 'pnpm run bemoat:guard:safety && pnpm run lint',
      },
    }

    const targetPackage = {
      scripts: {
        'bemoat:check': 'pnpm run custom-bemoat-check',
      },
    }

    const applyResult = mod.applyManagedPackageScripts(sourcePackage, targetPackage)
    const proposal = mod.buildPackageSyncProposal(sourcePackage, targetPackage)

    expect(applyResult.addedScripts).toEqual([])
    expect(applyResult.packageJSON.scripts['bemoat:check']).toBe('pnpm run custom-bemoat-check')
    expect(proposal.differentBemoatScripts.map((entry: { name: string }) => entry.name)).toContain('bemoat:check')
  })

  it('exports managedPaths and seedOnlyPaths for drift check reuse', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    expect(mod.managedPaths).toContain('AGENTS.md')
    expect(mod.managedPaths).toContain(mod.syncManifestPath)
    expect(mod.managedPaths).toContain('scripts/check-boilerplate-drift.mjs')
    expect(mod.managedPaths).toContain('docs/ai/ui-skills.md')
    expect(mod.managedPaths).toContain('docs/ai/ui-execution-workflow.md')
    expect(mod.managedPaths).toContain('docs/ai/visual-qa-checklist.md')
    expect(mod.managedPaths).toContain('docs/ai/accessibility-baseline.md')
    expect(mod.managedPaths).not.toContain('docs/ai')
    expect(mod.managedPaths).toContain('prompts/ui')
    expect(mod.managedPaths).not.toContain('src/payload.config.ts')
    expect(mod.managedPaths).not.toContain('package.json')
    expect(mod.managedPaths).not.toContain('README.md')
    for (const entry of STARTER_ONLY_DOCS) {
      expect(mod.managedPaths).not.toContain(entry.path)
    }
    expect(mod.mergeKeepPaths).toContain('.gitignore')
    expect(mod.seedOnlyPaths).not.toContain('.gitignore')
    expect(mod.seedOnlyPaths).toContain('src/payload.config.ts')
    expect(mod.seedOnlyPaths).toContain('src/app/(frontend)')
    expect(mod.suggestedPackageScripts).toContain('deploy')
    expect(mod.suggestedPackageSections).toEqual(['dependencies', 'devDependencies'])
  })

  it('exports the sync commit scope without treating package.json as managed rails', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    expect(mod.syncCommitPaths).toContain('.bemoat-boilerplate-sync.json')
    expect(mod.syncCommitPaths).toContain(mod.packageSyncProposalPath)
    expect(mod.syncCommitPaths).not.toContain('package.json')
    expect(mod.syncCommitPaths).toContain('AGENTS.md')
    expect(mod.getSyncCommitPaths(['AGENTS.md'], { includePackageJson: true })).toContain('package.json')
    expect(mod.getSyncCommitPaths(['AGENTS.md'])).toContain(mod.packageSyncProposalPath)
  })

  it('stashes unrelated local changes, commits only sync-scoped files, then restores the stash', async () => {
    const calls: string[] = []
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    const git = {
      hasWorkingTreeChanges(cwd: string, excludedPaths: string[]) {
        calls.push(`hasWorkingTreeChanges:${cwd}:${excludedPaths.join(',')}`)
        return true
      },
      stashPush(cwd: string, excludedPaths: string[]) {
        calls.push(`stashPush:${cwd}:${excludedPaths.join(',')}`)
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
    const statusCall = calls.find((call) => call.startsWith(`hasWorkingTreeChanges:${targetRoot}:`))
    expect(statusCall).toContain('.bemoat-boilerplate-sync.json')
    expect(statusCall).toContain('.bemoat/package-sync-proposal.md')
    expect(statusCall).not.toContain('package.json')
    expect(statusCall).toContain('scripts/sync-boilerplate.mjs')

    const stashCall = calls.find((call) => call.startsWith(`stashPush:${targetRoot}:`))
    expect(stashCall).toContain('.bemoat-boilerplate-sync.json')
    expect(stashCall).toContain('.bemoat/package-sync-proposal.md')
    expect(stashCall).not.toContain('package.json')
    expect(stashCall).toContain('scripts/sync-boilerplate.mjs')
    expect(calls).toContain(`stashPop:${targetRoot}`)
    expect(calls).toContain(`commit:${targetRoot}:sync boilerplate from boat1994/bemoat-web-starter#main`)

    const addCall = calls.find((call) => call.startsWith(`addPaths:${targetRoot}:`))
    expect(addCall).toContain('.bemoat-boilerplate-sync.json')
    expect(addCall).toContain('.bemoat/package-sync-proposal.md')
    expect(addCall).not.toContain('package.json')
    expect(addCall).toContain('AGENTS.md')
    expect(addCall).not.toContain('notes.txt')
  })
})

describe('source-driven sync manifest', () => {
  const fixtureRoot = resolve(process.cwd(), '.tmp-boilerplate-sync-manifest-test')

  it('matches local sync constants in the starter repository', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')
    const manifest = JSON.parse(
      readFileSync(resolve(process.cwd(), mod.syncManifestPath), 'utf8'),
    )

    expect(manifest.managedPaths).toEqual(mod.managedPaths)
    expect(manifest.seedOnlyPaths).toEqual(mod.seedOnlyPaths)
    expect(manifest.mergeKeepPaths).toEqual(mod.mergeKeepPaths)
    expect(manifest.managedPackageScripts).toEqual(mod.managedPackageScripts)
    expect(manifest.suggestedPackageScripts).toEqual(mod.suggestedPackageScripts)
    expect(manifest.buildContractPackageScripts).toEqual(mod.buildContractPackageScripts)
    expect(manifest.buildContractFilePaths).toEqual(mod.buildContractFilePaths)
    expect(manifest.suggestedPackageSections).toEqual(mod.suggestedPackageSections)
  })

  it('copies newly added managed paths from the source manifest in a single run', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    rmSync(fixtureRoot, { recursive: true, force: true })
    const sourceRoot = join(fixtureRoot, 'source')
    const targetRoot = join(fixtureRoot, 'target')

    mkdirSync(join(sourceRoot, '.new-harness-rail'), { recursive: true })
    mkdirSync(join(sourceRoot, '.bemoat'), { recursive: true })
    mkdirSync(targetRoot, { recursive: true })

    writeFileSync(join(sourceRoot, '.new-harness-rail/README.md'), 'new harness rail\n')
    seedManagedRuntimeClosureSource(sourceRoot)

    const simulatedOldManagedPaths = mod.managedPaths.filter(
      (path: string) => path !== '.agents' && path !== '.new-harness-rail',
    )

    writeFileSync(
      join(sourceRoot, mod.syncManifestPath),
      `${JSON.stringify(
        {
          version: 1,
          managedPaths: [...simulatedOldManagedPaths, '.new-harness-rail'],
          seedOnlyPaths: mod.seedOnlyPaths,
          mergeKeepPaths: mod.mergeKeepPaths,
          managedPackageScripts: mod.managedPackageScripts,
          suggestedPackageScripts: mod.suggestedPackageScripts,
          buildContractPackageScripts: mod.buildContractPackageScripts,
          buildContractFilePaths: mod.buildContractFilePaths,
          suggestedPackageSections: mod.suggestedPackageSections,
        },
        null,
        2,
      )}\n`,
    )

    const syncConfig = mod.getSourceSyncConfig(sourceRoot)

    expect(simulatedOldManagedPaths).not.toContain('.new-harness-rail')
    expect(syncConfig.managedPaths).toContain('.new-harness-rail')

    const result = mod.syncPathsFromSource({
      sourceRootPath: sourceRoot,
      targetRootPath: targetRoot,
      mode: mod.SYNC_MODES.HARNESS_ONLY,
      syncConfig,
      onWarn: () => {},
      onLog: () => {},
    })

    expect(result.syncedManaged).toContain('.new-harness-rail')
    expect(readFileSync(join(targetRoot, '.new-harness-rail/README.md'), 'utf8')).toBe('new harness rail\n')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped runtime .mjs boundary
    const metadata = (mod.buildSyncMetadata as unknown as (input: unknown) => any)({
      syncMode: mod.SYNC_MODES.HARNESS_ONLY,
      seedOnlyPathsSkipped: true,
      syncedManaged: result.syncedManaged,
      syncConfig,
    })

    expect(metadata.managedPaths).toContain('.new-harness-rail')
    expect(metadata.lastSyncedManagedPaths).toContain('.new-harness-rail')

    rmSync(fixtureRoot, { recursive: true, force: true })
  })

  it('falls back to local constants when the source manifest is missing', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    rmSync(fixtureRoot, { recursive: true, force: true })
    const sourceRoot = join(fixtureRoot, 'source')
    const targetRoot = join(fixtureRoot, 'target')

    mkdirSync(sourceRoot, { recursive: true })
    mkdirSync(targetRoot, { recursive: true })
    writeFileSync(join(sourceRoot, 'AGENTS.md'), 'starter agents\n')
    seedManagedRuntimeClosureSource(sourceRoot)

    const syncConfig = mod.getSourceSyncConfig(sourceRoot)

    expect(syncConfig.managedPaths).toEqual(mod.managedPaths)
    expect(syncConfig.seedOnlyPaths).toEqual(mod.seedOnlyPaths)
    expect(syncConfig.mergeKeepPaths).toEqual(mod.mergeKeepPaths)

    const result = mod.syncPathsFromSource({
      sourceRootPath: sourceRoot,
      targetRootPath: targetRoot,
      mode: mod.SYNC_MODES.HARNESS_ONLY,
      syncConfig,
      onWarn: () => {},
      onLog: () => {},
    })

    expect(result.syncedManaged).toContain('AGENTS.md')
    expect(readFileSync(join(targetRoot, 'AGENTS.md'), 'utf8')).toBe('starter agents\n')

    rmSync(fixtureRoot, { recursive: true, force: true })
  })
})

describe('boilerplate sync copy behavior', () => {
  const fixtureRoot = resolve(process.cwd(), '.tmp-boilerplate-sync-test')

  it('overwrites an existing managed file', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    rmSync(fixtureRoot, { recursive: true, force: true })
    mkdirSync(join(fixtureRoot, 'source'), { recursive: true })
    mkdirSync(join(fixtureRoot, 'target'), { recursive: true })

    writeFileSync(join(fixtureRoot, 'source/AGENTS.md'), 'starter agents\n')
    writeFileSync(join(fixtureRoot, 'target/AGENTS.md'), 'child agents\n')

    const result = mod.copyManagedPath(join(fixtureRoot, 'source'), join(fixtureRoot, 'target'), 'AGENTS.md')

    expect(result.copied).toBe(true)
    expect(readFileSync(join(fixtureRoot, 'target/AGENTS.md'), 'utf8')).toBe('starter agents\n')

    rmSync(fixtureRoot, { recursive: true, force: true })
  })

  it('overwrites superpowers template files during managed path sync', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    rmSync(fixtureRoot, { recursive: true, force: true })
    mkdirSync(join(fixtureRoot, 'source/docs/superpowers/specs/_templates'), { recursive: true })
    mkdirSync(join(fixtureRoot, 'target/docs/superpowers/specs/_templates'), { recursive: true })

    writeFileSync(
      join(fixtureRoot, 'source/docs/superpowers/specs/_templates/product-spec.md'),
      'starter template\n',
    )
    writeFileSync(
      join(fixtureRoot, 'target/docs/superpowers/specs/_templates/product-spec.md'),
      'stale child template\n',
    )

    const result = mod.copyManagedPath(
      join(fixtureRoot, 'source'),
      join(fixtureRoot, 'target'),
      'docs/superpowers/specs/_templates',
    )

    expect(result.copied).toBe(true)
    expect(
      readFileSync(join(fixtureRoot, 'target/docs/superpowers/specs/_templates/product-spec.md'), 'utf8'),
    ).toBe('starter template\n')

    rmSync(fixtureRoot, { recursive: true, force: true })
  })

  it('copies a missing seed-only file', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    rmSync(fixtureRoot, { recursive: true, force: true })
    mkdirSync(join(fixtureRoot, 'source/src/collections'), { recursive: true })
    mkdirSync(join(fixtureRoot, 'target/src/collections'), { recursive: true })

    writeFileSync(join(fixtureRoot, 'source/src/collections/Posts.ts'), 'export const Posts = {}\n')

    const result = mod.copySeedOnlyPath(join(fixtureRoot, 'source'), join(fixtureRoot, 'target'), 'src/collections')

    expect(result.seeded).toEqual(['src/collections/Posts.ts'])
    expect(result.skipped).toEqual([])
    expect(readFileSync(join(fixtureRoot, 'target/src/collections/Posts.ts'), 'utf8')).toBe(
      'export const Posts = {}\n',
    )

    rmSync(fixtureRoot, { recursive: true, force: true })
  })

  it('does not overwrite an existing customized seed-only file', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    rmSync(fixtureRoot, { recursive: true, force: true })
    mkdirSync(join(fixtureRoot, 'source/src/components'), { recursive: true })
    mkdirSync(join(fixtureRoot, 'target/src/components'), { recursive: true })

    writeFileSync(join(fixtureRoot, 'source/src/components/Header.tsx'), 'export const Header = () => <header>starter</header>\n')
    writeFileSync(join(fixtureRoot, 'target/src/components/Header.tsx'), 'export const Header = () => <header>child</header>\n')

    const result = mod.copySeedOnlyPath(join(fixtureRoot, 'source'), join(fixtureRoot, 'target'), 'src/components')

    expect(result.seeded).toEqual([])
    expect(result.skipped).toEqual(['src/components/Header.tsx'])
    expect(readFileSync(join(fixtureRoot, 'target/src/components/Header.tsx'), 'utf8')).toBe(
      'export const Header = () => <header>child</header>\n',
    )

    rmSync(fixtureRoot, { recursive: true, force: true })
  })

  it('merges .gitignore while keeping existing child ignore rules', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    rmSync(fixtureRoot, { recursive: true, force: true })
    mkdirSync(join(fixtureRoot, 'source'), { recursive: true })
    mkdirSync(join(fixtureRoot, 'target'), { recursive: true })

    writeFileSync(
      join(fixtureRoot, 'source/.gitignore'),
      '.open-next\n.bemoat-check-tmp/\n.bemoat-sync-tmp/\n',
    )
    writeFileSync(join(fixtureRoot, 'target/.gitignore'), '.env\n/custom-artifacts\n.open-next\n')

    const result = mod.mergeKeepPath(join(fixtureRoot, 'source'), join(fixtureRoot, 'target'), '.gitignore')
    const merged = readFileSync(join(fixtureRoot, 'target/.gitignore'), 'utf8')

    expect(result.merged).toBe(true)
    expect(result.changed).toBe(true)
    expect(merged).toContain('.env')
    expect(merged).toContain('/custom-artifacts')
    expect(merged).toContain('.open-next')
    expect(merged).toContain('.bemoat-check-tmp/')
    expect(merged).toContain('.bemoat-sync-tmp/')
    expect(merged).toContain('# Added by bemoat boilerplate sync')

    rmSync(fixtureRoot, { recursive: true, force: true })
  })

  it('does not rewrite .gitignore when starter rules are already present', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    rmSync(fixtureRoot, { recursive: true, force: true })
    mkdirSync(join(fixtureRoot, 'source'), { recursive: true })
    mkdirSync(join(fixtureRoot, 'target'), { recursive: true })

    writeFileSync(join(fixtureRoot, 'source/.gitignore'), '.bemoat-check-tmp/\n')
    writeFileSync(join(fixtureRoot, 'target/.gitignore'), '.env\n.bemoat-check-tmp/\n')

    const result = mod.mergeKeepPath(join(fixtureRoot, 'source'), join(fixtureRoot, 'target'), '.gitignore')

    expect(result.merged).toBe(false)
    expect(result.changed).toBe(false)
    expect(readFileSync(join(fixtureRoot, 'target/.gitignore'), 'utf8')).toBe('.env\n.bemoat-check-tmp/\n')

    rmSync(fixtureRoot, { recursive: true, force: true })
  })

  it('writes a package sync proposal and only adds missing bemoat:* scripts', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    rmSync(fixtureRoot, { recursive: true, force: true })
    mkdirSync(join(fixtureRoot, 'source'), { recursive: true })
    mkdirSync(join(fixtureRoot, 'target'), { recursive: true })

    writeFileSync(
      join(fixtureRoot, 'source/package.json'),
      `${JSON.stringify(
        {
          scripts: {
            'bemoat:check': 'pnpm run bemoat:guard:safety',
            deploy: 'pnpm run deploy:app',
          },
          dependencies: { payload: '3.82.1' },
          devDependencies: { vitest: '3.0.0' },
        },
        null,
        2,
      )}\n`,
    )
    writeFileSync(
      join(fixtureRoot, 'target/package.json'),
      `${JSON.stringify(
        {
          scripts: {
            deploy: 'pnpm run custom-deploy',
          },
          dependencies: { payload: '3.80.0' },
          devDependencies: {},
        },
        null,
        2,
      )}\n`,
    )

    const result = mod.syncPackageManifest({
      sourceRootPath: join(fixtureRoot, 'source'),
      targetRootPath: join(fixtureRoot, 'target'),
      repo: 'boat1994/bemoat-web-starter',
      ref: 'main',
    })

    const childPackage = JSON.parse(readFileSync(join(fixtureRoot, 'target/package.json'), 'utf8'))
    const proposal = readFileSync(join(fixtureRoot, 'target/.bemoat/package-sync-proposal.md'), 'utf8')

    expect(result.addedScripts).toEqual(['bemoat:check'])
    expect(childPackage.scripts.deploy).toBe('pnpm run custom-deploy')
    expect(childPackage.dependencies.payload).toBe('3.80.0')
    expect(proposal).toContain('deploy')
    expect(proposal).toContain('Script drift report (human review only)')
    expect(proposal).toContain('Do not apply these changes automatically')

    rmSync(fixtureRoot, { recursive: true, force: true })
  })

  it('fails closed when bemoat:typecheck differs from the managed public contract', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    expect(() => mod.assertExactManagedPackageScripts(
      { scripts: { 'bemoat:typecheck': 'node scripts/bemoat-typecheck.mjs' } },
      { scripts: { 'bemoat:typecheck': 'echo bypassed' } },
    )).toThrow('bemoat:typecheck')
  })

  it('fails before package mutation when bemoat:typecheck diverges', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')
    const sourceRoot = join(fixtureRoot, 'exact-source')
    const targetRoot = join(fixtureRoot, 'exact-target')

    rmSync(fixtureRoot, { recursive: true, force: true })
    mkdirSync(sourceRoot, { recursive: true })
    mkdirSync(targetRoot, { recursive: true })
    writeFileSync(join(sourceRoot, 'package.json'), JSON.stringify({ scripts: { 'bemoat:typecheck': 'node scripts/bemoat-typecheck.mjs' } }))
    writeFileSync(join(targetRoot, 'package.json'), JSON.stringify({ scripts: { 'bemoat:typecheck': 'echo bypassed' } }))

    expect(() => mod.syncPackageManifest({ sourceRootPath: sourceRoot, targetRootPath: targetRoot })).toThrow('bemoat:typecheck')
    expect(JSON.parse(readFileSync(join(targetRoot, 'package.json'), 'utf8')).scripts['bemoat:typecheck']).toBe('echo bypassed')
    expect(existsSync(join(targetRoot, '.bemoat/package-sync-proposal.md'))).toBe(false)

    rmSync(fixtureRoot, { recursive: true, force: true })
  })

  it('allows first-sync bootstrap to reach copied-rail validation but rejects partial rails before mutation', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')
    const targetRoot = join(fixtureRoot, 'bootstrap-target')

    rmSync(fixtureRoot, { recursive: true, force: true })
    mkdirSync(targetRoot, { recursive: true })
    expect(mod.isFirstToolchainBootstrap(targetRoot)).toBe(true)
    const logs: string[] = []
    expect(mod.runToolchainPreflight({
      targetRootPath: targetRoot,
      contractRootPath: '/tmp/source',
      assertContract: () => { throw new Error('must wait for copied rails') },
      log: (line: string) => logs.push(line),
    })).toBe('bootstrap')
    expect(logs).toEqual(['[sync] first-sync toolchain bootstrap: validating copied rails before commit'])

    mkdirSync(join(targetRoot, '.bemoat'), { recursive: true })
    writeFileSync(join(targetRoot, '.bemoat/toolchain-contract.json'), '{}')
    expect(mod.isFirstToolchainBootstrap(targetRoot)).toBe(false)
    expect(() => mod.runToolchainPreflight({
      targetRootPath: targetRoot,
      contractRootPath: '/tmp/source',
      assertContract: () => { throw new Error('partial rails fail before mutation') },
    })).toThrow('partial rails fail before mutation')

    rmSync(fixtureRoot, { recursive: true, force: true })
  })

  it('does not commit synced rails when post-copy validation fails', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')
    const calls: string[] = []
    const git = {
      hasWorkingTreeChanges() { return false },
      stashPush() {},
      addPaths() { calls.push('add') },
      hasStagedChanges() { calls.push('staged'); return true },
      commit() { calls.push('commit') },
      stashPop() {},
    }

    expect(() => mod.commitValidatedSyncChanges(
      { repo: 'boat1994/bemoat-web-starter', ref: 'main', targetRoot: '/tmp/bemoat-child' },
      { git, validate: () => { throw new Error('post-copy validation failed') } },
    )).toThrow('post-copy validation failed')
    expect(calls).toEqual([])
  })
})

describe('boilerplate sync modes', () => {
  const fixtureRoot = resolve(process.cwd(), '.tmp-boilerplate-sync-mode-test')

  it('defaults parseSyncMode to harness-only', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    expect(mod.parseSyncMode([], {} as NodeJS.ProcessEnv)).toBe(mod.SYNC_MODES.HARNESS_ONLY)
  })

  it('parses --full and --harness-only CLI flags', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    expect(mod.parseSyncMode(['--full'], {} as NodeJS.ProcessEnv)).toBe(mod.SYNC_MODES.FULL)
    expect(mod.parseSyncMode(['--harness-only'], {} as NodeJS.ProcessEnv)).toBe(mod.SYNC_MODES.HARNESS_ONLY)
  })

  it('prefers CLI flags over BEMOAT_SYNC_MODE', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    expect(
      mod.parseSyncMode(
        ['--full'],
        { BEMOAT_SYNC_MODE: 'harness-only' } as unknown as NodeJS.ProcessEnv,
      ),
    ).toBe(mod.SYNC_MODES.FULL)
  })

  it('does not copy seed-only paths in harness-only mode', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    rmSync(fixtureRoot, { recursive: true, force: true })
    mkdirSync(join(fixtureRoot, 'source/src/collections'), { recursive: true })
    mkdirSync(join(fixtureRoot, 'target/src/collections'), { recursive: true })

    writeFileSync(join(fixtureRoot, 'source/src/collections/Posts.ts'), 'export const Posts = {}\n')
    seedManagedRuntimeClosureSource(join(fixtureRoot, 'source'))

    const result = mod.syncPathsFromSource({
      sourceRootPath: join(fixtureRoot, 'source'),
      targetRootPath: join(fixtureRoot, 'target'),
      mode: mod.SYNC_MODES.HARNESS_ONLY,
      onWarn: () => {},
      onLog: () => {},
    })

    expect(result.seedOnlyPathsSkipped).toBe(true)
    expect(result.seededFiles).toEqual([])
    expect(existsSync(join(fixtureRoot, 'target/src/collections/Posts.ts'))).toBe(false)

    rmSync(fixtureRoot, { recursive: true, force: true })
  })

  it('copies missing seed-only files in full mode', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    rmSync(fixtureRoot, { recursive: true, force: true })
    mkdirSync(join(fixtureRoot, 'source/src/collections'), { recursive: true })
    mkdirSync(join(fixtureRoot, 'target/src/collections'), { recursive: true })

    writeFileSync(join(fixtureRoot, 'source/src/collections/Posts.ts'), 'export const Posts = {}\n')
    seedManagedRuntimeClosureSource(join(fixtureRoot, 'source'))

    const result = mod.syncPathsFromSource({
      sourceRootPath: join(fixtureRoot, 'source'),
      targetRootPath: join(fixtureRoot, 'target'),
      mode: mod.SYNC_MODES.FULL,
      onWarn: () => {},
      onLog: () => {},
    })

    expect(result.seedOnlyPathsSkipped).toBe(false)
    expect(result.seededFiles).toEqual(['src/collections/Posts.ts'])
    expect(readFileSync(join(fixtureRoot, 'target/src/collections/Posts.ts'), 'utf8')).toBe(
      'export const Posts = {}\n',
    )

    rmSync(fixtureRoot, { recursive: true, force: true })
  })

  it('records harness-only syncMode and seedOnlyPathsSkipped in metadata', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    const metadata = mod.buildSyncMetadata(
      buildSyncMetadataInput({
        syncMode: mod.SYNC_MODES.HARNESS_ONLY,
        seedOnlyPathsSkipped: true,
        syncedManaged: ['AGENTS.md'],
        seededFiles: [],
      }),
    )

    expect(metadata.syncMode).toBe('harness-only')
    expect(metadata.seedOnlyPathsSkipped).toBe(true)
    expect(metadata.seededFiles).toEqual([])
    expect(metadata.lastSyncedManagedPaths).toEqual(['AGENTS.md'])
  })

  it('records full syncMode and seedOnlyPathsSkipped false in metadata', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    const metadata = mod.buildSyncMetadata(
      buildSyncMetadataInput({
        syncMode: mod.SYNC_MODES.FULL,
        seedOnlyPathsSkipped: false,
        seededFiles: ['src/collections/Posts.ts'],
      }),
    )

    expect(metadata.syncMode).toBe('full')
    expect(metadata.seedOnlyPathsSkipped).toBe(false)
    expect(metadata.seededFiles).toEqual(['src/collections/Posts.ts'])
  })

  it('suggests harness-only next commands without Payload migration steps', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    const commands = (mod.getSuggestedNextCommands as unknown as (mode: string, options: unknown) => string[])(mod.SYNC_MODES.HARNESS_ONLY, {
      proposalPath: '.bemoat/package-sync-proposal.md',
    })

    expect(commands).toContain('pnpm run check')
    expect(commands).not.toContain('pnpm run generate:importmap')
    expect(commands).not.toContain('pnpm payload migrate:create')
  })

  it('suggests full-mode next commands including Payload artifact steps', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    const commands = mod.getSuggestedNextCommands(mod.SYNC_MODES.FULL, {})

    expect(commands).toContain('pnpm run generate:importmap')
    expect(commands).toContain('pnpm run generate:types')
    expect(commands).toContain('pnpm payload migrate:create')
  })
})

describe('boilerplate drift check', () => {
  const fixtureRoot = resolve(process.cwd(), '.tmp-boilerplate-drift-test')

  it('detects boilerplate source repository at git root from package name and origin', async () => {
    const mod = await import('../../scripts/check-boilerplate-drift.mjs')

    rmSync(fixtureRoot, { recursive: true, force: true })
    mkdirSync(join(fixtureRoot, 'starter'), { recursive: true })
    mkdirSync(join(fixtureRoot, 'child'), { recursive: true })

    writeFileSync(
      join(fixtureRoot, 'starter/package.json'),
      `${JSON.stringify({ name: 'bemoat-web-starter' }, null, 2)}\n`,
    )

    writeFileSync(
      join(fixtureRoot, 'child/package.json'),
      `${JSON.stringify({ name: 'bogus-jewelry' }, null, 2)}\n`,
    )

    expect(
      mod.isBoilerplateSourceRepository(join(fixtureRoot, 'starter'), 'boat1994/bemoat-web-starter'),
    ).toBe(true)
    expect(
      mod.isBoilerplateSourceRepository(join(fixtureRoot, 'child'), 'boat1994/bemoat-web-starter'),
    ).toBe(false)

    rmSync(fixtureRoot, { recursive: true, force: true })
  })

  it('treats nested starter fixture inside child repo as source despite inherited parent git origin', async () => {
    const mod = await import('../../scripts/check-boilerplate-drift.mjs')

    rmSync(fixtureRoot, { recursive: true, force: true })
    mkdirSync(join(fixtureRoot, 'child-repo', 'starter-fixture'), { recursive: true })

    writeFileSync(
      join(fixtureRoot, 'child-repo/starter-fixture/package.json'),
      `${JSON.stringify({ name: 'bemoat-web-starter' }, null, 2)}\n`,
    )

    const nestedFixture = join(fixtureRoot, 'child-repo/starter-fixture')
    // Nested cwd inherits the parent checkout's git origin (any child repo), which must not
    // override package-name detection for harness test fixtures.
    expect(mod.isBoilerplateSourceRepository(nestedFixture, 'boat1994/bemoat-web-starter')).toBe(true)

    rmSync(fixtureRoot, { recursive: true, force: true })
  })

  it('reports missing, changed, and identical managed paths', async () => {
    const mod = await import('../../scripts/check-boilerplate-drift.mjs')

    rmSync(fixtureRoot, { recursive: true, force: true })
    mkdirSync(join(fixtureRoot, 'source'), { recursive: true })
    mkdirSync(join(fixtureRoot, 'target'), { recursive: true })

    writeFileSync(join(fixtureRoot, 'source/AGENTS.md'), 'starter agents\n')
    writeFileSync(join(fixtureRoot, 'target/AGENTS.md'), 'child agents\n')
    writeFileSync(join(fixtureRoot, 'source/README-child-only.md'), 'missing locally\n')

    const report = mod.compareBoilerplateDrift({
      sourceRoot: join(fixtureRoot, 'source'),
      targetRoot: join(fixtureRoot, 'target'),
      paths: ['AGENTS.md', 'README-child-only.md', 'docs/agent-loop'],
    })

    expect(report.changed).toEqual(['AGENTS.md'])
    expect(report.missing).toEqual(['README-child-only.md'])
    expect(report.identical).toEqual([])

    rmSync(fixtureRoot, { recursive: true, force: true })
  })

  it('does not treat child-owned package.json script or dependency drift as managed drift', async () => {
    const mod = await import('../../scripts/check-boilerplate-drift.mjs')

    rmSync(fixtureRoot, { recursive: true, force: true })
    mkdirSync(join(fixtureRoot, 'source'), { recursive: true })
    mkdirSync(join(fixtureRoot, 'target'), { recursive: true })

    writeFileSync(
      join(fixtureRoot, 'source/package.json'),
      `${JSON.stringify(
        {
          name: 'starter',
          scripts: { check: 'pnpm run lint', deploy: 'pnpm run deploy:app' },
          dependencies: { payload: '3.82.1' },
          devDependencies: { vitest: '3.0.0' },
        },
        null,
        2,
      )}\n`,
    )
    writeFileSync(
      join(fixtureRoot, 'target/package.json'),
      `${JSON.stringify(
        {
          name: 'child',
          scripts: { check: 'pnpm run lint' },
          dependencies: { payload: '3.80.0' },
          devDependencies: {},
        },
        null,
        2,
      )}\n`,
    )

    const report = mod.compareBoilerplateDrift({
      sourceRoot: join(fixtureRoot, 'source'),
      targetRoot: join(fixtureRoot, 'target'),
      paths: [],
    })

    expect(report.changed).toEqual([])
    expect(report.missing).toEqual([])
    expect(report.identical).toEqual([])

    const fullReport = mod.compareFullBoilerplateDrift({
      sourceRoot: join(fixtureRoot, 'source'),
      targetRoot: join(fixtureRoot, 'target'),
    })

    expect(fullReport.packageProposal).not.toBeNull()
    expect(mod.getDriftExitCode(fullReport)).toBe(0)

    rmSync(fixtureRoot, { recursive: true, force: true })
  })

  it('reports merge-keep drift when starter .gitignore rules are missing in child', async () => {
    const mod = await import('../../scripts/check-boilerplate-drift.mjs')

    rmSync(fixtureRoot, { recursive: true, force: true })
    mkdirSync(join(fixtureRoot, 'source'), { recursive: true })
    mkdirSync(join(fixtureRoot, 'target'), { recursive: true })

    writeFileSync(join(fixtureRoot, 'source/.gitignore'), '.bemoat-check-tmp/\n.bemoat-sync-tmp/\n')
    writeFileSync(join(fixtureRoot, 'target/.gitignore'), '.env\n')

    const report = mod.compareMergeKeepDrift({
      sourceRoot: join(fixtureRoot, 'source'),
      targetRoot: join(fixtureRoot, 'target'),
    })

    expect(report.changed).toEqual(['.gitignore'])
    expect(
      mod.getDriftExitCode({
        managed: { missing: [], changed: [] },
        seed: { missingSeed: [], customized: [], identical: [] },
        mergeKeep: report,
        packageProposal: null,
        seedOnlyPathsSkipped: true,
      }),
    ).toBe(1)

    rmSync(fixtureRoot, { recursive: true, force: true })
  })

  it('does not fail when only customized seed files differ', async () => {
    const mod = await import('../../scripts/check-boilerplate-drift.mjs')

    rmSync(fixtureRoot, { recursive: true, force: true })
    mkdirSync(join(fixtureRoot, 'source/src/app/(frontend)/blog/[slug]'), { recursive: true })
    mkdirSync(join(fixtureRoot, 'target/src/app/(frontend)/blog/[slug]'), { recursive: true })

    writeFileSync(join(fixtureRoot, 'source/src/app/(frontend)/blog/[slug]/page.tsx'), 'starter page\n')
    writeFileSync(join(fixtureRoot, 'target/src/app/(frontend)/blog/[slug]/page.tsx'), 'child page\n')

    const report = mod.compareFullBoilerplateDrift({
      sourceRoot: join(fixtureRoot, 'source'),
      targetRoot: join(fixtureRoot, 'target'),
    })

    expect(mod.getDriftExitCode(report)).toBe(0)
    expect(report.seed.customized).toContain('src/app/(frontend)/blog/[slug]/page.tsx')
    expect(report.managed.missing).toEqual([])
    expect(report.managed.changed).toEqual([])

    rmSync(fixtureRoot, { recursive: true, force: true })
  })

  it('reports missing seed files clearly', async () => {
    const mod = await import('../../scripts/check-boilerplate-drift.mjs')

    rmSync(fixtureRoot, { recursive: true, force: true })
    mkdirSync(join(fixtureRoot, 'source/src/app/(frontend)/custom-order'), { recursive: true })

    writeFileSync(join(fixtureRoot, 'source/src/app/(frontend)/custom-order/page.tsx'), 'starter page\n')

    const report = mod.compareFullBoilerplateDrift({
      sourceRoot: join(fixtureRoot, 'source'),
      targetRoot: join(fixtureRoot, 'target'),
      mode: mod.SYNC_MODES.FULL,
    })

    expect(mod.getDriftExitCode(report)).toBe(1)
    expect(report.seed.missingSeed).toContain('src/app/(frontend)/custom-order/page.tsx')

    rmSync(fixtureRoot, { recursive: true, force: true })
  })

  it('does not fail on missing starter app files in harness-only drift check', async () => {
    const syncMod = await import('../../scripts/sync-boilerplate.mjs')
    const mod = await import('../../scripts/check-boilerplate-drift.mjs')

    rmSync(fixtureRoot, { recursive: true, force: true })
    mkdirSync(join(fixtureRoot, 'source/src/app/(frontend)/custom-order'), { recursive: true })

    writeFileSync(join(fixtureRoot, 'source/src/app/(frontend)/custom-order/page.tsx'), 'starter page\n')

    const report = mod.compareBoilerplateDriftByMode({
      sourceRoot: join(fixtureRoot, 'source'),
      targetRoot: join(fixtureRoot, 'target'),
      mode: syncMod.SYNC_MODES.HARNESS_ONLY,
    })

    expect(report.seedOnlyPathsSkipped).toBe(true)
    expect(report.seed.missingSeed).toEqual([])
    expect(mod.getDriftExitCode(report)).toBe(0)

    rmSync(fixtureRoot, { recursive: true, force: true })
  })
})

function seedManagedRuntimeClosureSource(sourceRoot: string) {
  cpSync(join(process.cwd(), 'scripts'), join(sourceRoot, 'scripts'), { recursive: true })
}

const ISSUE_182_ALLOWLISTED_FILES = [
  'scripts/sync-boilerplate.mjs',
  '.bemoat/boilerplate-sync-manifest.json',
  'scripts/guard-harness-contract.mjs',
  'tests/int/harness-contract-guard.int.spec.ts',
  'tests/int/boilerplate-sync.int.spec.ts',
] as const

const ISSUE_182_CHILD_OWNED_SENTINELS = [
  'README.md',
  'wrangler.jsonc',
  'pnpm-lock.yaml',
  'src/payload-owned-sentinel.ts',
] as const

const ISSUE_182_FINANCE_SENTINELS = ['src/features/finance/child-owned-sentinel.ts'] as const

const ISSUE_182_PLANNING_SENTINELS = ['docs/superpowers/plans/child-owned/plan.md'] as const

const ISSUE_182_NON_MANAGED_SENTINELS = [
  ...ISSUE_182_CHILD_OWNED_SENTINELS,
  ...ISSUE_182_FINANCE_SENTINELS,
  ...ISSUE_182_PLANNING_SENTINELS,
] as const

function listAllFiles(root: string, relativePath = ''): string[] {
  const absolutePath = join(root, relativePath)
  if (!existsSync(absolutePath)) return []

  const stat = statSync(absolutePath)
  if (!stat.isDirectory()) return [relativePath.replace(/\\/g, '/')]

  const files: string[] = []
  for (const entry of readdirSync(absolutePath).sort()) {
    const childPath = relativePath ? `${relativePath}/${entry}` : entry
    files.push(...listAllFiles(root, childPath))
  }

  return files
}

function isManagedFilePath(filePath: string, managedPaths: string[]) {
  return managedPaths.some(
    (managedPath) => filePath === managedPath || filePath.startsWith(`${managedPath}/`),
  )
}

function snapshotNonManagedFiles(root: string, managedPaths: string[]) {
  const snapshot: Record<string, string> = {}

  for (const filePath of listAllFiles(root)) {
    if (!isManagedFilePath(filePath, managedPaths)) {
      snapshot[filePath] = readFileSync(join(root, filePath), 'utf8')
    }
  }

  return snapshot
}

function hashDirectory(root: string, relativePath = ''): string {
  const hash = createHash('sha256')
  const absolutePath = join(root, relativePath)

  if (!existsSync(absolutePath)) return hash.digest('hex')

  const stat = statSync(absolutePath)
  if (!stat.isDirectory()) {
    hash.update(relativePath)
    hash.update(readFileSync(absolutePath))
    return hash.digest('hex')
  }

  for (const entry of readdirSync(absolutePath).sort()) {
    const childPath = relativePath ? `${relativePath}/${entry}` : entry
    hash.update(hashDirectory(root, childPath))
  }

  return hash.digest('hex')
}

function copyManagedSnapshot(
  repoRoot: string,
  destinationRoot: string,
  managedPaths: string[],
  listPathFiles: (root: string, relativePath: string) => string[],
) {
  for (const managedPath of managedPaths) {
    for (const filePath of listPathFiles(repoRoot, managedPath)) {
      const sourceFile = join(repoRoot, filePath)
      const destinationFile = join(destinationRoot, filePath)
      mkdirSync(dirname(destinationFile), { recursive: true })
      cpSync(sourceFile, destinationFile)
    }
  }
}

function writeIssue182ChildFixture(targetRoot: string) {
  for (const relativePath of ISSUE_182_ALLOWLISTED_FILES) {
    const absolutePath = join(targetRoot, relativePath)
    mkdirSync(join(absolutePath, '..'), { recursive: true })
    writeFileSync(absolutePath, `OLD_SENTINEL:${relativePath}\n`)
  }

  const projectionPath = join(targetRoot, 'scripts/github-comment-projection.mjs')
  if (existsSync(projectionPath)) {
    rmSync(projectionPath, { force: true })
  }

  const prIdentityPath = join(targetRoot, 'scripts/pr-identity.mjs')
  if (existsSync(prIdentityPath)) {
    rmSync(prIdentityPath, { force: true })
  }

  for (const relativePath of ISSUE_182_NON_MANAGED_SENTINELS) {
    const absolutePath = join(targetRoot, relativePath)
    mkdirSync(join(absolutePath, '..'), { recursive: true })
    writeFileSync(absolutePath, `CHILD_OWNED:${relativePath}\n`)
  }
}

describe('issue #182 projection managed delivery regression', () => {
  it('delivers github-comment-projection and pr-identity during harness-only sync without touching child-owned paths', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')
    const guardMod = await import('../../scripts/guard-harness-contract.mjs')
    const tempRoot = mkdtempSync(join(tmpdir(), 'bemoat-182-'))
    const sourceRoot = join(tempRoot, 'source')
    const childRoot = join(tempRoot, 'child')

    try {
      mkdirSync(sourceRoot, { recursive: true })
      mkdirSync(childRoot, { recursive: true })

      copyManagedSnapshot(
        process.cwd(),
        sourceRoot,
        mod.managedPaths,
        mod.listPathFiles,
      )
      copyManagedSnapshot(
        sourceRoot,
        childRoot,
        mod.getSourceSyncConfig(sourceRoot).managedPaths,
        mod.listPathFiles,
      )
      writeIssue182ChildFixture(childRoot)

      const syncConfig = mod.getSourceSyncConfig(sourceRoot)
      const nonManagedBefore = snapshotNonManagedFiles(childRoot, syncConfig.managedPaths)

      const result = mod.syncPathsFromSource({
        sourceRootPath: sourceRoot,
        targetRootPath: childRoot,
        mode: mod.SYNC_MODES.HARNESS_ONLY,
        syncConfig,
        onWarn: () => {},
        onLog: () => {},
      })

      expect(result.seededFiles).toEqual([])
      expect(existsSync(join(childRoot, 'scripts/github-comment-projection.mjs'))).toBe(true)
      expect(existsSync(join(childRoot, 'scripts/agent-issue.mjs'))).toBe(true)
      expect(existsSync(join(childRoot, 'scripts/pr-identity.mjs'))).toBe(true)
      expect(readFileSync(join(childRoot, 'scripts/agent-issue.mjs'), 'utf8')).toContain(
        "./pr-identity.mjs'",
      )

      execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          "import('./scripts/pr-identity.mjs').then((module) => { if (typeof module.parseCompleteGitHubPullUrl !== 'function') { throw new Error('missing parseCompleteGitHubPullUrl export') } })",
        ],
        { cwd: childRoot, stdio: 'pipe' },
      )

      const runtimeViolations = guardMod.scanManagedRuntimeDeliveryClosure({
        root: childRoot,
        managedPaths: syncConfig.managedPaths,
      })
      expect(runtimeViolations).toEqual([])

      for (const relativePath of ISSUE_182_ALLOWLISTED_FILES) {
        expect(readFileSync(join(childRoot, relativePath), 'utf8')).toBe(
          readFileSync(join(sourceRoot, relativePath), 'utf8'),
        )
      }

      for (const relativePath of ISSUE_182_NON_MANAGED_SENTINELS) {
        expect(readFileSync(join(childRoot, relativePath), 'utf8')).toBe(
          `CHILD_OWNED:${relativePath}\n`,
        )
      }

      expect(snapshotNonManagedFiles(childRoot, syncConfig.managedPaths)).toEqual(nonManagedBefore)
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it.each([
    [
      'missing dependency',
      (sourceRoot: string) => {
        rmSync(join(sourceRoot, 'scripts/github-comment-projection.mjs'), { force: true })
      },
      '- [missing-managed-runtime-source] importer="managedPaths" -> callee="scripts/github-comment-projection.mjs" specifier="scripts/github-comment-projection.mjs"',
    ],
    [
      'renamed dependency',
      (sourceRoot: string) => {
        const projectionPath = join(sourceRoot, 'scripts/github-comment-projection.mjs')
        writeFileSync(
          join(sourceRoot, 'scripts/github-comment-projection-renamed.mjs'),
          readFileSync(projectionPath, 'utf8'),
        )
        rmSync(projectionPath, { force: true })
      },
      '- [missing-managed-runtime-source] importer="managedPaths" -> callee="scripts/github-comment-projection.mjs" specifier="scripts/github-comment-projection.mjs"',
    ],
    [
      'deleted dependency',
      (sourceRoot: string) => {
        rmSync(join(sourceRoot, 'scripts/github-comment-projection.mjs'), { force: true })
      },
      '- [missing-managed-runtime-source] importer="managedPaths" -> callee="scripts/github-comment-projection.mjs" specifier="scripts/github-comment-projection.mjs"',
    ],
    [
      'newly introduced unmanaged relative dependency',
      (sourceRoot: string) => {
        writeFileSync(join(sourceRoot, 'scripts/unmanaged-helper.mjs'), 'export const helper = 1\n')
        const projectionPath = join(sourceRoot, 'scripts/github-comment-projection.mjs')
        writeFileSync(
          projectionPath,
          `${readFileSync(projectionPath, 'utf8')}import { helper } from './unmanaged-helper.mjs'\n`,
        )
      },
      '- [unmanaged-relative-runtime-dependency] importer="scripts/github-comment-projection.mjs" -> callee="scripts/unmanaged-helper.mjs" specifier="./unmanaged-helper.mjs"',
    ],
    [
      'missing pr-identity dependency',
      (sourceRoot: string) => {
        rmSync(join(sourceRoot, 'scripts/pr-identity.mjs'), { force: true })
      },
      '- [missing-managed-runtime-source] importer="managedPaths" -> callee="scripts/pr-identity.mjs" specifier="scripts/pr-identity.mjs"',
    ],
    [
      'deleted pr-identity dependency',
      (sourceRoot: string) => {
        rmSync(join(sourceRoot, 'scripts/pr-identity.mjs'), { force: true })
      },
      '- [missing-managed-runtime-source] importer="managedPaths" -> callee="scripts/pr-identity.mjs" specifier="scripts/pr-identity.mjs"',
    ],
    [
      'renamed pr-identity dependency',
      (sourceRoot: string) => {
        const prIdentityPath = join(sourceRoot, 'scripts/pr-identity.mjs')
        writeFileSync(
          join(sourceRoot, 'scripts/pr-identity-renamed.mjs'),
          readFileSync(prIdentityPath, 'utf8'),
        )
        rmSync(prIdentityPath, { force: true })
      },
      '- [missing-managed-runtime-source] importer="managedPaths" -> callee="scripts/pr-identity.mjs" specifier="scripts/pr-identity.mjs"',
    ],
  ])(
    'fails closed before copy for %s and leaves the child byte-for-byte unchanged',
    async (_label, mutateSource, expectedLine) => {
      const mod = await import('../../scripts/guard-harness-contract.mjs')
      const syncMod = await import('../../scripts/sync-boilerplate.mjs')
      const tempRoot = mkdtempSync(join(tmpdir(), 'bemoat-182-negative-'))
      const sourceRoot = join(tempRoot, 'source')
      const childRoot = join(tempRoot, 'child')

      try {
        mkdirSync(sourceRoot, { recursive: true })
        mkdirSync(childRoot, { recursive: true })

        copyManagedSnapshot(
          process.cwd(),
          sourceRoot,
          syncMod.managedPaths,
          syncMod.listPathFiles,
        )
        mutateSource(sourceRoot)

        copyManagedSnapshot(
          sourceRoot,
          childRoot,
          syncMod.getSourceSyncConfig(sourceRoot).managedPaths,
          syncMod.listPathFiles,
        )
        writeIssue182ChildFixture(childRoot)

        const beforeHash = hashDirectory(childRoot)
        const syncConfig = syncMod.getSourceSyncConfig(sourceRoot)

        let caught: unknown
        try {
          syncMod.syncPathsFromSource({
            sourceRootPath: sourceRoot,
            targetRootPath: childRoot,
            mode: syncMod.SYNC_MODES.HARNESS_ONLY,
            syncConfig,
            onWarn: () => {},
            onLog: () => {},
          })
        } catch (error) {
          caught = error
        }

        expect(caught).toBeInstanceOf(mod.ManagedRuntimeDeliveryClosureError)
        const formatted = (caught as { formatted?: string[] }).formatted ?? []
        expect(formatted.join('\n')).toContain(expectedLine)
        expect(hashDirectory(childRoot)).toBe(beforeHash)
      } finally {
        rmSync(tempRoot, { recursive: true, force: true })
      }
    },
  )
})

describe('issue #219 managed corpus trailing whitespace regression', () => {
  it('fails when managed files contain trailing whitespace', async () => {
    const syncMod = await import('../../scripts/sync-boilerplate.mjs')
    const repoRoot = process.cwd()

    const BINARY_EXTENSIONS = new Set([
      '.png',
      '.jpg',
      '.jpeg',
      '.gif',
      '.ico',
      '.webp',
      '.pdf',
      '.woff',
      '.woff2',
      '.ttf',
      '.eot',
      '.zip',
      '.tar',
      '.gz',
    ])

    function isBinaryFile(filePath: string, buf: Buffer): boolean {
      const ext = extname(filePath).toLowerCase()
      if (BINARY_EXTENSIONS.has(ext)) return true
      if (buf.includes(0)) return true
      return false
    }

    const managedFiles = new Set<string>()
    for (const managedPath of syncMod.managedPaths) {
      for (const filePath of syncMod.listPathFiles(repoRoot, managedPath)) {
        managedFiles.add(filePath)
      }
    }

    const trailingHits: Array<{ file: string; line: number; text: string }> = []

    for (const relativePath of Array.from(managedFiles).sort()) {
      const absolutePath = join(repoRoot, relativePath)
      if (!existsSync(absolutePath)) continue

      const buffer = readFileSync(absolutePath)
      if (isBinaryFile(relativePath, buffer)) continue

      const content = buffer.toString('utf8')
      const lines = content.split('\n')

      lines.forEach((line, index) => {
        if (/[ \t]+$/.test(line)) {
          trailingHits.push({
            file: relativePath,
            line: index + 1,
            text: line,
          })
        }
      })
    }

    if (trailingHits.length > 0) {
      const formatted = trailingHits
        .map((hit) => `  ${hit.file}:${hit.line}:${JSON.stringify(hit.text)}`)
        .join('\n')
      expect.fail(
        `Found ${trailingHits.length} trailing-whitespace hit(s) in managed files:\n${formatted}`,
      )
    }
  })
})
