import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('boilerplate sync managed paths', () => {
  it('includes repository agent instructions and Cursor rules', () => {
    const script = readFileSync(resolve(process.cwd(), 'scripts/sync-boilerplate.mjs'), 'utf8')

    expect(script).toContain("'AGENTS.md'")
    expect(script).toContain("'.cursor/rules'")
    expect(script).toContain("'scripts/sync-boilerplate.mjs'")
    expect(script).toContain("'scripts/check-boilerplate-drift.mjs'")
  })

  it('includes harness workflow rails in managedPaths and packageScripts', async () => {
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
      'tests/int/repo-safety-guard.int.spec.ts',
      'tests/int/boilerplate-sync.int.spec.ts',
      'tests/int/open-next-config.int.spec.ts',
    ]

    for (const path of harnessPaths) {
      expect(mod.managedPaths).toContain(path)
    }

    expect(mod.packageScripts).toContain('guard:safety')
    expect(mod.packageScripts).toContain('hooks:install')
  })

  it('exports managedPaths and seedOnlyPaths for drift check reuse', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    expect(mod.managedPaths).toContain('AGENTS.md')
    expect(mod.managedPaths).toContain('scripts/check-boilerplate-drift.mjs')
    expect(mod.managedPaths).not.toContain('src/payload.config.ts')
    expect(mod.seedOnlyPaths).toContain('src/payload.config.ts')
    expect(mod.seedOnlyPaths).toContain('src/app/(frontend)')
    expect(mod.packageScripts).toContain('boilerplate:check')
    expect(mod.packageScripts).toContain('smoke:deploy')
  })

  it('exports the sync commit scope including the sync metadata file', async () => {
    const mod = await import('../../scripts/sync-boilerplate.mjs')

    expect(mod.syncCommitPaths).toContain('.bemoat-boilerplate-sync.json')
    expect(mod.syncCommitPaths).toContain('package.json')
    expect(mod.syncCommitPaths).toContain('AGENTS.md')
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
    expect(statusCall).toContain('package.json')
    expect(statusCall).toContain('scripts/sync-boilerplate.mjs')

    const stashCall = calls.find((call) => call.startsWith(`stashPush:${targetRoot}:`))
    expect(stashCall).toContain('.bemoat-boilerplate-sync.json')
    expect(stashCall).toContain('package.json')
    expect(stashCall).toContain('scripts/sync-boilerplate.mjs')
    expect(calls).toContain(`stashPop:${targetRoot}`)
    expect(calls).toContain(`commit:${targetRoot}:sync boilerplate from boat1994/bemoat-web-starter#main`)

    const addCall = calls.find((call) => call.startsWith(`addPaths:${targetRoot}:`))
    expect(addCall).toContain('.bemoat-boilerplate-sync.json')
    expect(addCall).toContain('package.json')
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
})

describe('boilerplate drift check', () => {
  const fixtureRoot = resolve(process.cwd(), '.tmp-boilerplate-drift-test')

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

  it('detects package.json drift using the same merge rules as sync', async () => {
    const mod = await import('../../scripts/check-boilerplate-drift.mjs')

    rmSync(fixtureRoot, { recursive: true, force: true })
    mkdirSync(join(fixtureRoot, 'source'), { recursive: true })
    mkdirSync(join(fixtureRoot, 'target'), { recursive: true })

    writeFileSync(
      join(fixtureRoot, 'source/package.json'),
      `${JSON.stringify(
        {
          name: 'starter',
          scripts: { check: 'pnpm run lint', 'boilerplate:check': 'node scripts/check-boilerplate-drift.mjs' },
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

    expect(report.changed).toEqual(['package.json'])
    expect(report.missing).toEqual([])
    expect(report.identical).toEqual([])

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
