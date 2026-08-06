import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { delimiter, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it } from 'vitest'

import {
  compareFileSystemSnapshots,
  runCliBoundaryCase,
  snapshotDirectory,
  type CliBoundaryResult,
  type FileSystemSnapshot,
} from '../helpers/cli-boundary-harness'
import { getCommandContract } from '../../scripts/cli/command-contract.mjs'
import { assertResultEnvelopeV1 } from '../../scripts/cli/command-result.mjs'

type TierACase = {
  command: string
  entrypoint: string
}

const TIER_A_CASES = [
  {
    command: 'bemoat:boilerplate:sync',
    entrypoint: 'scripts/sync-boilerplate.mjs',
  },
  {
    command: 'bemoat:hooks:install',
    entrypoint: 'scripts/install-git-hooks.mjs',
  },
] as const satisfies readonly TierACase[]

const TIER_A_ROWS = TIER_A_CASES.map((entry) => [entry.command, entry] as const)

const TIER_A_SECTIONS = [
  'NAME',
  'PURPOSE',
  'USAGE',
  'ACCEPTED PRE-STATE',
  'REQUIRED INPUTS',
  'OPTIONAL FLAGS',
  'AUTHORITY AND TRUST BOUNDARY',
  'READS',
  'WRITES',
  'RESULT CLASSIFICATIONS',
  'EXIT CODES',
  'RETRY CONTRACT',
  'NEXT ACTIONS',
  'STOP CONDITIONS',
  'EXAMPLES',
  'SAFE RECOVERY',
] as const

const HELP_KEYS = [
  'schema_version',
  'command',
  'mode',
  'classification',
  'tier',
  'purpose',
  'accepted_pre_states',
  'required_inputs',
  'optional_flags',
  'caller_supplied_values',
  'trusted_derived_values',
  'required_evidence',
  'reads',
  'writes',
  'retry_contract',
  'result_classifications',
  'next_action_rules',
  'stop_conditions',
  'examples',
] as const

const JSON_HELP_PERMUTATIONS = [
  ['--help', '--json'],
  ['--json', '--help'],
  ['-h', '--json'],
  ['--json', '-h'],
] as const

const HOOK_FIXTURE_FILES = {
  '.githooks/pre-commit': '#!/bin/sh\nexit 0\n',
  '.githooks/pre-push': '#!/bin/sh\nexit 0\n',
}

const TOOLCHAIN_CONTRACT = {
  version: 1,
  typescript: '6.0.3',
  node: '24.15.0',
  testedCompatibility: {
    '@types/node': '24.x',
    vitest: '4.1.6',
    'vite-tsconfig-paths': '6.0.5',
  },
  compiler: {
    strict: true,
    childStrictNullChecks: true,
    starterRootStrictNullChecks: false,
    harnessStrictConfig: 'tsconfig.harness-strict.json',
    ambientInput: 'cloudflare-env.d.ts',
    harnessRoots: [
      'tests/helpers/**/*.ts',
      'tests/int/**/*.int.spec.ts',
      'tests/setup/**/*.ts',
      'vitest.config.mts',
      'vitest.setup.ts',
    ],
  },
}

const temporaryRoots: string[] = []

function facadeEnvironment(
  entry: TierACase,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    ...extra,
    BEMOAT_FACADE_COMMAND: entry.command,
    BEMOAT_FACADE_ENTRYPOINT: entry.entrypoint,
    npm_lifecycle_event: entry.command,
  }
}

function runBoundary(
  entry: TierACase,
  argv: readonly string[],
  extraEnvironment: Record<string, string> = {},
): CliBoundaryResult {
  const syncGateBypass = entry.command === 'bemoat:boilerplate:sync'
    ? { BEMOAT_SKIP_MC_TRANSITION_CHILD_SYNC_GATE: '1' }
    : {}

  return runCliBoundaryCase({
    entrypoint: entry.entrypoint,
    argv,
    env: facadeEnvironment(entry, {
      ...syncGateBypass,
      ...extraEnvironment,
    }),
    files: entry.command === 'bemoat:hooks:install'
      ? HOOK_FIXTURE_FILES
      : undefined,
  })
}

function expectNoBoundarySideEffects(run: CliBoundaryResult) {
  expect(run.error).toBeNull()
  expect(run.poison_invocations).toEqual([])
  expect(run.filesystem_unchanged).toBe(true)
  expect(compareFileSystemSnapshots(run.before, run.after)).toBe(true)
}

function expectSectionsInOrder(help: string) {
  let previousIndex = -1

  for (const section of TIER_A_SECTIONS) {
    const index = help.indexOf(`${section}:`)
    expect(index, `missing help section ${section}`).toBeGreaterThanOrEqual(0)
    expect(index, `${section} is out of order`).toBeGreaterThan(previousIndex)
    previousIndex = index
  }
}

function helpSections(help: string): readonly string[] {
  return TIER_A_SECTIONS.filter((section) => help.includes(`${section}:`))
}

function expectTextHelp(run: CliBoundaryResult, entry: TierACase) {
  expect(run.status, `${entry.command}\n${run.stdout}\n${run.stderr}`).toBe(0)
  expect(run.stderr).toBe('')
  expect(run.stdout).toContain(`HELP: ${entry.command}`)
  expect(run.stdout).toContain(`Direct entrypoint: ${entry.entrypoint}`)
  expectSectionsInOrder(run.stdout)
  expectNoBoundarySideEffects(run)
}

function parseSingleJson(stdout: string): Record<string, unknown> {
  const serialized = stdout.trim()
  expect(serialized).toMatch(/^\{[\s\S]*\}$/)
  return JSON.parse(serialized) as Record<string, unknown>
}

function expectHelpJson(run: CliBoundaryResult, entry: TierACase) {
  expect(run.status, `${entry.command}\n${run.stdout}\n${run.stderr}`).toBe(0)
  expect(run.stderr).toBe('')
  expectNoBoundarySideEffects(run)

  const help = parseSingleJson(run.stdout)
  expect(Object.keys(help).sort()).toEqual([...HELP_KEYS].sort())
  expect(help).toMatchObject({
    schema_version: 1,
    command: entry.command,
    mode: 'help',
    classification: 'HELP',
    tier: 'A',
  })
  expect(typeof help.purpose).toBe('string')
}

function expectInvalidInvocation(run: CliBoundaryResult) {
  expect(run.status).toBe(2)
  expect(run.stdout).toBe('')
  expect(run.stderr).toMatch(/^INVALID_INVOCATION:/)
  expectNoBoundarySideEffects(run)
}

function changedSnapshotPaths(
  before: FileSystemSnapshot,
  after: FileSystemSnapshot,
): string[] {
  const paths = new Set([...Object.keys(before), ...Object.keys(after)])

  return [...paths]
    .filter((path) => JSON.stringify(before[path]) !== JSON.stringify(after[path]))
    .sort()
}

function writeExecutable(path: string, source: string) {
  writeFileSync(path, source, 'utf8')
  chmodSync(path, 0o755)
}

function writeFixtureFile(root: string, relativePath: string, content: string) {
  const path = join(root, relativePath)
  mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true })
  writeFileSync(path, content, 'utf8')
}

function writeToolchainFixture(root: string) {
  const packageJson = {
    name: 'child-fixture',
    scripts: {},
    devDependencies: { typescript: '6.0.3' },
    engines: { node: '>=24.15.0' },
  }
  const strictInclude = [
    'cloudflare-env.d.ts',
    'tests/helpers/**/*.ts',
    'tests/int/**/*.int.spec.ts',
    'tests/setup/**/*.ts',
    'vitest.config.mts',
    'vitest.setup.ts',
  ]
  const tsConfig = JSON.stringify({
    compilerOptions: { strict: true, strictNullChecks: true },
    include: strictInclude,
  })

  writeFixtureFile(root, 'package.json', `${JSON.stringify(packageJson)}\n`)
  writeFixtureFile(root, 'pnpm-lock.yaml', `lockfileVersion: '9.0'
importers:
  .:
    devDependencies:
      typescript:
        specifier: 6.0.3
        version: 6.0.3

packages:
`)
  writeFixtureFile(root, '.bemoat/toolchain-contract.json', `${JSON.stringify(TOOLCHAIN_CONTRACT)}\n`)
  writeFixtureFile(root, 'tsconfig.json', `${tsConfig}\n`)
  writeFixtureFile(root, 'tsconfig.harness-strict.json', `${tsConfig}\n`)
  writeFixtureFile(root, 'node_modules/typescript/package.json', '{"version":"6.0.3"}\n')
  writeFixtureFile(root, 'scripts/guard-toolchain-contract.mjs', 'export {}\n')
  writeFixtureFile(root, 'scripts/bemoat-typecheck.mjs', 'export {}\n')
  writeFixtureFile(root, 'cloudflare-env.d.ts', 'declare const fixture: unique symbol\n')
  writeFixtureFile(root, 'tests/helpers/fixture.ts', 'export {}\n')
  writeFixtureFile(root, 'tests/int/fixture.int.spec.ts', 'export {}\n')
  writeFixtureFile(root, 'tests/setup/fixture.ts', 'export {}\n')
  writeFixtureFile(root, 'vitest.config.mts', 'export default {}\n')
  writeFixtureFile(root, 'vitest.setup.ts', 'export {}\n')
}

function createSyncMutationFixture() {
  const root = mkdtempSync(join(tmpdir(), 'bemoat-cli-tier-a-sync-'))
  const bin = mkdtempSync(join(tmpdir(), 'bemoat-cli-tier-a-bin-'))
  temporaryRoots.push(root, bin)

  writeToolchainFixture(root)
  writeFixtureFile(root, 'child-owned.txt', 'child-owned\n')

  writeExecutable(
    join(bin, 'git'),
    `#!/usr/bin/env node
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const logPath = process.env.BEMOAT_FAKE_GIT_LOG
if (logPath) appendFileSync(logPath, args.join(' ') + '\\n')

if (args[0] === 'clone') {
  const sourceRoot = args[args.length - 1]
  const manifest = {
    managedPaths: ['AGENTS.md'],
    seedOnlyPaths: [],
    mergeKeepPaths: [],
    managedPackageScripts: [],
    suggestedPackageScripts: [],
    buildContractPackageScripts: [],
    buildContractFilePaths: [],
    suggestedPackageSections: [],
  }
  const toolchainContract = ${JSON.stringify(TOOLCHAIN_CONTRACT)}

  mkdirSync(join(sourceRoot, '.bemoat'), { recursive: true })
  writeFileSync(
    join(sourceRoot, 'package.json'),
    JSON.stringify({ name: 'bemoat-web-starter', scripts: {} }),
  )
  writeFileSync(
    join(sourceRoot, '.bemoat/boilerplate-sync-manifest.json'),
    JSON.stringify(manifest),
  )
  writeFileSync(
    join(sourceRoot, '.bemoat/toolchain-contract.json'),
    JSON.stringify(toolchainContract),
  )
  writeFileSync(join(sourceRoot, 'AGENTS.md'), 'starter managed rail\\n')
  process.exit(0)
}

if (args[0] === 'diff' && args.includes('--cached') && args.includes('--quiet')) {
  process.exit(1)
}

process.exit(0)
`,
  )

  return { root, bin }
}

function createHooksMutationFixture() {
  const root = mkdtempSync(join(tmpdir(), 'bemoat-cli-tier-a-hooks-'))
  temporaryRoots.push(root)

  const init = spawnSync('git', ['init', '--quiet'], {
    cwd: root,
    encoding: 'utf8',
  })
  if (init.status !== 0) {
    throw new Error(`git init failed: ${init.stderr}`)
  }

  for (const [relativePath, content] of Object.entries(HOOK_FIXTURE_FILES)) {
    const path = join(root, relativePath)
    const directory = path.slice(0, path.lastIndexOf('/'))
    mkdirSync(directory, { recursive: true })
    writeFileSync(path, content, 'utf8')
    chmodSync(path, 0o644)
  }

  return root
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('Task 4 Tier A CLI boundaries: boilerplate sync and hooks install', () => {
  it.each(TIER_A_ROWS)(
    'registers %s as Tier A with the approved direct entrypoint',
    (command, entry) => {
      expect(command).toBe(entry.command)
      expect(getCommandContract(command)).toMatchObject({
        command,
        tier: 'A',
        entrypoint: entry.entrypoint,
      })
    },
  )

  it('boilerplate sync and hooks expose equivalent text help', () => {
    const runs = TIER_A_CASES.map((entry) => runBoundary(entry, ['--help']))

    for (const [index, run] of runs.entries()) {
      expectTextHelp(run, TIER_A_CASES[index])
    }

    expect(runs.map((run) => helpSections(run.stdout))).toEqual([
      TIER_A_SECTIONS,
      TIER_A_SECTIONS,
    ])
  })

  it('boilerplate sync and hooks normalize all JSON-help permutations', () => {
    for (const entry of TIER_A_CASES) {
      const runs = JSON_HELP_PERMUTATIONS.map((flags) => runBoundary(entry, flags))

      for (const run of runs) expectHelpJson(run, entry)
      expect(runs.map((run) => run.stdout)).toEqual([
        runs[0].stdout,
        runs[0].stdout,
        runs[0].stdout,
        runs[0].stdout,
      ])
    }
  })

  it('boilerplate sync and hooks help and invalid syntax perform zero I/O', () => {
    for (const entry of TIER_A_CASES) {
      for (const argv of [['--help'], ['-h']] as const) {
        expectTextHelp(runBoundary(entry, argv), entry)
      }

      expectInvalidInvocation(runBoundary(entry, ['--definitely-invalid']))
    }
  })

  it('boilerplate sync JSON writes only the documented allowlist', () => {
    const fixture = createSyncMutationFixture()
    const entry = TIER_A_CASES[0]
    const before = snapshotDirectory(fixture.root)
    const run = spawnSync(
      process.execPath,
      [
        resolve(process.cwd(), entry.entrypoint),
        '--harness-only',
        '--skip-mc-transition-gate',
        '--json',
      ],
      {
        cwd: fixture.root,
        encoding: 'utf8',
        env: {
          ...process.env,
          ...facadeEnvironment(entry, {
            BEMOAT_BOILERPLATE_REPO: 'example/starter',
            BEMOAT_BOILERPLATE_REF: 'slice-4',
            BEMOAT_FAKE_GIT_LOG: join(fixture.bin, 'git.log'),
            PATH: [fixture.bin, process.env.PATH].filter(Boolean).join(delimiter),
          }),
        },
        maxBuffer: 4 * 1024 * 1024,
      },
    )
    const after = snapshotDirectory(fixture.root)

    expect(run.error ?? null).toBeNull()
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    expect(run.stderr).toBe('')
    expect(existsSync(join(fixture.root, '.bemoat-sync-tmp'))).toBe(false)

    const documentedAllowlist = new Set([
      'AGENTS.md',
      '.bemoat-boilerplate-sync.json',
      '.bemoat/package-sync-proposal.md',
      'package.json',
    ])
    const changed = changedSnapshotPaths(before, after)
    expect(changed).toEqual([
      '.bemoat-boilerplate-sync.json',
      '.bemoat/package-sync-proposal.md',
      'AGENTS.md',
    ])
    for (const path of changed) expect(documentedAllowlist.has(path)).toBe(true)

    const result = parseSingleJson(run.stdout)
    assertResultEnvelopeV1(result)
    expect(result).toMatchObject({
      command: entry.command,
      mode: 'result',
      outcome: 'SUCCESS',
      classification: 'SUCCESS',
      mutation_performed: true,
    })
  })

  it('hooks install JSON changes only hook modes and core.hooksPath', () => {
    const root = createHooksMutationFixture()
    const entry = TIER_A_CASES[1]
    const before = snapshotDirectory(root)
    const run = spawnSync(
      process.execPath,
      [resolve(process.cwd(), entry.entrypoint), '--json'],
      {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          ...facadeEnvironment(entry),
        },
        maxBuffer: 4 * 1024 * 1024,
      },
    )
    const after = snapshotDirectory(root)

    expect(run.error ?? null).toBeNull()
    expect(run.status).toBe(0)
    expect(run.stderr).toBe('')
    expect(changedSnapshotPaths(before, after)).toEqual([
      '.git/config',
      '.githooks/pre-commit',
      '.githooks/pre-push',
    ])
    expect(after['.githooks/pre-commit']?.mode).toBe(0o755)
    expect(after['.githooks/pre-push']?.mode).toBe(0o755)
    expect(readFileSync(join(root, '.git/config'), 'utf8')).toContain(
      'hooksPath = .githooks',
    )

    const result = parseSingleJson(run.stdout)
    assertResultEnvelopeV1(result)
    expect(result).toMatchObject({
      command: entry.command,
      mode: 'result',
      outcome: 'SUCCESS',
      classification: 'SUCCESS',
      mutation_performed: true,
    })
  })

  it('repository mutation begins only after the final preflight', async () => {
    const calls: string[] = []
    const targetRoot = '/tmp/bemoat-tier-a-target'
    const tempRoot = `${targetRoot}/.bemoat-sync-tmp`
    const sourceRoot = `${tempRoot}/source`
    const workflowModule = await import('../../scripts/boilerplate/workflow.mjs')
    const workflow = workflowModule.createBoilerplateSyncWorkflow({
      rmSync(path: string) {
        calls.push(path === tempRoot ? 'temp-cleanup' : `rm:${path}`)
      },
      mkdirSync(path: string) {
        calls.push(path === tempRoot ? 'temp-create' : `mkdir:${path}`)
      },
      writeFileSync(path: string) {
        calls.push(path === `${targetRoot}/.bemoat-boilerplate-sync.json`
          ? 'write-metadata'
          : `write:${path}`)
      },
      join(...paths: string[]) {
        return paths.join('/')
      },
      run() {
        calls.push('clone')
      },
      parseSyncMode() {
        calls.push('parse-mode')
        return 'harness-only'
      },
      parseApplyBuildContract() {
        calls.push('parse-build-contract')
        return false
      },
      createGitClient() {
        calls.push('create-git-client')
        return {}
      },
      getSourceSyncConfig() {
        calls.push('source-config')
        return {
          managedPaths: ['AGENTS.md'],
          seedOnlyPaths: [] as string[],
          mergeKeepPaths: [] as string[],
          managedPackageScripts: [] as string[],
          suggestedPackageScripts: [] as string[],
          buildContractPackageScripts: [] as string[],
          buildContractFilePaths: [] as string[],
          suggestedPackageSections: [] as string[],
        }
      },
      readJSON() {
        calls.push('read-package')
        return { scripts: {} }
      },
      assertExactManagedPackageScripts() {
        calls.push('managed-package-preflight')
      },
      runToolchainPreflight() {
        calls.push('final-preflight')
      },
      stashWorkingTreeIfNeeded() {
        calls.push('stash')
        return false
      },
      syncPathsFromSource() {
        calls.push('sync-managed-paths')
        return {
          syncedManaged: ['AGENTS.md'],
          seededFiles: [] as string[],
          skippedSeedFiles: [] as string[],
          mergedFiles: [] as string[],
          seedOnlyPathsSkipped: true,
        }
      },
      syncPackageManifest() {
        calls.push('sync-package-manifest')
        return {
          packageChanged: false,
          addedScripts: [] as string[],
          appliedBuildContractScripts: [] as string[],
          updatedBuildContractScripts: [] as string[],
          proposalPath: null as string | null,
        }
      },
      applyBuildContractFiles() {
        calls.push('apply-build-files')
        return {
          applied: [] as string[],
          updated: [] as string[],
          skipped: [] as string[],
        }
      },
      buildSyncMetadata() {
        calls.push('build-metadata')
        return { version: 1 }
      },
      commitValidatedSyncChanges(_options: unknown, { validate }: { validate: () => void }) {
        calls.push('commit-validation')
        validate()
        calls.push('commit')
        return true
      },
      assertToolchainContract() {
        calls.push('commit-preflight')
      },
      restoreStashIfNeeded() {
        calls.push('restore-stash')
      },
      assertManagedRuntimeDeliveryClosure: 'closure',
      log() {},
    })

    workflow.run({
      repo: 'example/starter',
      ref: 'slice-4',
      targetRoot,
      tempRoot,
      sourceRoot,
      enforceChildSyncGate: () => calls.push('transition-gate'),
    })

    const finalPreflight = calls.indexOf('final-preflight')
    expect(finalPreflight).toBeGreaterThanOrEqual(0)
    for (const mutation of [
      'stash',
      'sync-managed-paths',
      'sync-package-manifest',
      'write-metadata',
      'commit-validation',
      'commit',
    ]) {
      expect(calls.indexOf(mutation), mutation).toBeGreaterThan(finalPreflight)
    }
  })
})
