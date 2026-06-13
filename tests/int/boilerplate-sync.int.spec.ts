import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/** Integration tests under tests/int that are starter-only and intentionally not synced. */
const STARTER_ONLY_INT_TESTS: { path: string; reason: string }[] = [
  // All current tests/int/**/*.int.spec.ts files are shared harness tests for child projects.
]

const MANAGED_BEMOAT_PACKAGE_SCRIPTS = [
  'bemoat:guard:safety',
  'bemoat:guard:cloudflare-env',
  'bemoat:test:int',
  'bemoat:check',
  'bemoat:boilerplate:sync',
  'bemoat:boilerplate:check',
  'bemoat:hooks:install',
]

const PROPOSAL_ONLY_PACKAGE_SCRIPTS = [
  'build',
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
]

describe('boilerplate sync managed paths', () => {
  it('includes repository agent instructions and Cursor rules', () => {
    const script = readFileSync(resolve(process.cwd(), 'scripts/sync-boilerplate.mjs'), 'utf8')

    expect(script).toContain("'AGENTS.md'")
    expect(script).toContain("'.cursor/rules'")
    expect(script).toContain("'scripts/sync-boilerplate.mjs'")
    expect(script).toContain("'scripts/check-boilerplate-drift.mjs'")
  })

  it('includes harness workflow rails in managedPaths and managedPackageScripts', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    const harnessPaths = [
      'docs/schema-evolution.md',
      'docs/cloudflare-environments.md',
      'docs/boilerplate-sync-command.md',
      'scripts/guard-repo-safety.mjs',
      'scripts/guard-cloudflare-env.mjs',
      'scripts/install-git-hooks.mjs',
      '.githooks',
      'vitest.config.mts',
      'vitest.setup.ts',
      'tests/int/api.int.spec.ts',
      'tests/int/repo-safety-guard.int.spec.ts',
      'tests/int/cloudflare-env-guard.int.spec.ts',
      'tests/int/boilerplate-sync.int.spec.ts',
      'tests/int/open-next-config.int.spec.ts',
    ]

    for (const path of harnessPaths) {
      expect(mod.managedPaths).toContain(path)
    }

    for (const scriptName of MANAGED_BEMOAT_PACKAGE_SCRIPTS) {
      expect(mod.managedPackageScripts).toContain(scriptName)
    }

    for (const scriptName of PROPOSAL_ONLY_PACKAGE_SCRIPTS) {
      expect(mod.managedPackageScripts).not.toContain(scriptName)
      expect(mod.suggestedPackageScripts).toContain(scriptName)
    }
  })

  it('lists every shared harness int test in managedPaths', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

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

  it('adds missing bemoat:* scripts only and never auto-merges dependencies', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    const sourcePackage = {
      scripts: {
        'bemoat:check': 'pnpm run bemoat:guard:safety',
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

    expect(result.addedScripts).toEqual(['bemoat:check'])
    expect(result.packageJSON.scripts.deploy).toBe('pnpm run custom-deploy')
    expect(result.packageJSON.scripts.check).toBe('pnpm run custom-check')
    expect(result.packageJSON.dependencies).toEqual({ payload: '3.80.0' })
    expect(result.packageJSON.devDependencies).toEqual({})
  })

  it('builds a package sync proposal without mutating child package.json', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    const sourcePackage = {
      scripts: {
        deploy: 'pnpm run deploy:app',
        check: 'pnpm run lint',
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

    expect(proposal.missingScripts.map((entry: { name: string }) => entry.name)).toContain('deploy')
    expect(proposal.differentScripts.map((entry: { name: string }) => entry.name)).toContain('check')
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
  })

  it('exports managedPaths and seedOnlyPaths for drift check reuse', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    expect(mod.managedPaths).toContain('AGENTS.md')
    expect(mod.managedPaths).toContain('scripts/check-boilerplate-drift.mjs')
    expect(mod.managedPaths).not.toContain('src/payload.config.ts')
    expect(mod.managedPaths).not.toContain('package.json')
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
    expect(proposal).toContain('proposal only')

    rmSync(fixtureRoot, { recursive: true, force: true })
  })
})

describe('boilerplate drift check', () => {
  const fixtureRoot = resolve(process.cwd(), '.tmp-boilerplate-drift-test')

  it('detects the starter source repository and skips remote drift comparison', async () => {
    const mod = await import('../../scripts/check-boilerplate-drift.mjs')

    expect(mod.isBoilerplateSourceRepository(process.cwd(), 'boat1994/bemoat-web-starter')).toBe(true)
    expect(mod.isBoilerplateSourceRepository(process.cwd(), 'boat1994/other-repo')).toBe(false)
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
    expect(mod.getDriftExitCode({ managed: { missing: [], changed: [] }, seed: { missingSeed: [], customized: [], identical: [] }, mergeKeep: report, packageProposal: null })).toBe(1)

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
    })

    expect(mod.getDriftExitCode(report)).toBe(1)
    expect(report.seed.missingSeed).toContain('src/app/(frontend)/custom-order/page.tsx')

    rmSync(fixtureRoot, { recursive: true, force: true })
  })
})
