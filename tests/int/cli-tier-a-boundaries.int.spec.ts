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
  const syncGateBypass: Record<string, string> =
    entry.command === 'bemoat:boilerplate:sync'
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

function expectJsonInvalidInvocation(run: CliBoundaryResult, entry: TierACase) {
  expect(run.status, `${entry.command}\n${run.stdout}\n${run.stderr}`).toBe(2)
  expect(run.stderr).toBe('')
  expectNoBoundarySideEffects(run)

  const result = parseSingleJson(run.stdout)
  assertResultEnvelopeV1(result)
  expect(result).toMatchObject({
    command: entry.command,
    mode: 'result',
    outcome: 'ERROR',
    classification: 'INVALID_INVOCATION',
    mutation_performed: false,
    next_action: {
      type: 'STOP',
      command: null,
    },
    details: {
      argument: '--definitely-invalid',
      reason: 'unknown flag: --definitely-invalid',
    },
  })
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

function createSyncMutationFixture({
  emitToolOutput = false,
  includeGitignore = false,
  failCommit = false,
} = {}) {
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
if (${emitToolOutput}) process.stdout.write('fake git output\\n')

if (args[0] === 'clone') {
  const sourceRoot = args[args.length - 1]
  const manifest = {
    managedPaths: ['AGENTS.md'],
    seedOnlyPaths: [],
    mergeKeepPaths: ${includeGitignore ? "['.gitignore']" : '[]'},
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
  if (${includeGitignore}) writeFileSync(join(sourceRoot, '.gitignore'), 'dist\\n')
  process.exit(0)
}

if (${failCommit} && args[0] === 'commit') {
  process.stderr.write('fake commit failure\\n')
  process.exit(42)
}

if (args[0] === 'diff' && args.includes('--cached') && args.includes('--quiet')) {
  process.exit(1)
}

process.exit(0)
`,
  )

  return { root, bin }
}

function createHooksMutationFixture({ gitRepository = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'bemoat-cli-tier-a-hooks-'))
  temporaryRoots.push(root)

  if (gitRepository) {
    const init = spawnSync('git', ['init', '--quiet'], {
      cwd: root,
      encoding: 'utf8',
    })
    if (init.status !== 0) {
      throw new Error(`git init failed: ${init.stderr}`)
    }
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

  it('boilerplate sync and hooks JSON invalid invocations return schema-v1 errors without I/O', () => {
    for (const entry of TIER_A_CASES) {
      expectJsonInvalidInvocation(
        runBoundary(entry, ['--json', '--definitely-invalid']),
        entry,
      )
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

  it('boilerplate sync JSON isolates workflow and tool output to one envelope', () => {
    const fixture = createSyncMutationFixture({
      emitToolOutput: true,
      includeGitignore: true,
    })
    const entry = TIER_A_CASES[0]
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

    expect(run.error ?? null).toBeNull()
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    expect(run.stderr).toContain('fake git output')

    const result = parseSingleJson(run.stdout)
    assertResultEnvelopeV1(result)
    expect(result).toMatchObject({
      command: entry.command,
      mode: 'result',
      outcome: 'SUCCESS',
      classification: 'SUCCESS',
      mutation_performed: true,
      details: {
        merged_files: ['.gitignore'],
      },
    })
  })

  it('boilerplate sync JSON reports ambiguous mutation and preserves diagnostics after commit failure', () => {
    const fixture = createSyncMutationFixture({ failCommit: true })
    const entry = TIER_A_CASES[0]
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
            PATH: [fixture.bin, process.env.PATH].filter(Boolean).join(delimiter),
          }),
        },
        maxBuffer: 4 * 1024 * 1024,
      },
    )

    expect(run.error ?? null).toBeNull()
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(4)
    expect(run.stderr).toContain('fake commit failure')

    const result = parseSingleJson(run.stdout)
    assertResultEnvelopeV1(result)
    expect(result).toMatchObject({
      command: entry.command,
      mode: 'result',
      outcome: 'ERROR',
      classification: 'AMBIGUOUS_RESULT',
      mutation_performed: true,
      next_action: {
        type: 'STOP',
        command: null,
      },
      details: {
        legacy_output: expect.arrayContaining([
          'Syncing Bemoat boilerplate from example/starter#slice-4 (harness-only mode)',
          '[sync] package sync proposal written to .bemoat/package-sync-proposal.md',
        ]),
      },
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

  it('hooks install JSON keeps Git stdout out of the result envelope', () => {
    const root = createHooksMutationFixture()
    const bin = mkdtempSync(join(tmpdir(), 'bemoat-cli-tier-a-hook-bin-'))
    temporaryRoots.push(bin)
    writeExecutable(
      join(bin, 'git'),
      `#!/usr/bin/env sh
printf '%s\n' 'fake git config stdout'
exit 0
`,
    )
    const entry = TIER_A_CASES[1]
    const run = spawnSync(
      process.execPath,
      [resolve(process.cwd(), entry.entrypoint), '--json'],
      {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          ...facadeEnvironment(entry),
          PATH: [bin, process.env.PATH].filter(Boolean).join(delimiter),
        },
        maxBuffer: 4 * 1024 * 1024,
      },
    )

    expect(run.error ?? null).toBeNull()
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    expect(run.stderr).toBe('fake git config stdout\n')
    expect(run.stdout.trim().split(/\r?\n/)).toHaveLength(1)

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

  it('hooks install JSON reports ambiguous mutation when git config fails after chmod', () => {
    const root = createHooksMutationFixture({ gitRepository: false })
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
      },
    )
    const after = snapshotDirectory(root)

    expect(run.error ?? null).toBeNull()
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(4)
    expect(changedSnapshotPaths(before, after)).toEqual([
      '.githooks/pre-commit',
      '.githooks/pre-push',
    ])
    expect(after['.githooks/pre-commit']?.mode).toBe(0o755)
    expect(after['.githooks/pre-push']?.mode).toBe(0o755)

    const result = parseSingleJson(run.stdout)
    assertResultEnvelopeV1(result)
    expect(result).toMatchObject({
      command: entry.command,
      mode: 'result',
      outcome: 'ERROR',
      classification: 'AMBIGUOUS_RESULT',
      mutation_performed: true,
      next_action: {
        type: 'STOP',
        command: null,
      },
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

const CANONICAL_FULL_UPPERCASE_SHA = 'ABCDEF0123456789ABCDEF0123456789ABCDEF01'
const CANONICAL_FULL_LOWERCASE_SHA = CANONICAL_FULL_UPPERCASE_SHA.toLowerCase()
const CANONICAL_REPOSITORY = 'boat1994/bemoat-web-starter'
const CANONICAL_UPPERCASE_REPOSITORY = 'BOAT1994/BEMOAT-WEB-STARTER'

const CANONICAL_ROLE_COMMENT_BODY = `## RESULT
### Task log
- Timestamp: 2026-08-06T00:00:00+00:00
- Task / Issue: #284
- Phase: Dev
- Executing role: Dev / Builder
**Completed:** Implementation
**Summary:** Added the bounded change.
**Next:** Reviewer posts REVIEW_VERDICT
`

const CANONICAL_HANDOFF_BODY = `## HANDOFF
### Task log
- Timestamp: 2026-08-06T00:00:00+00:00
- Task / Issue: #284
- Phase: Dev
- Executing role: Mission Control
**Target:** Dev
**Objective:** Implement the bounded change.
**Links:** Issue #284
**Next:** Dev posts RESULT
`

const CANONICAL_DELIVERY_BODY = `## RESULT
### Task log
- Timestamp: 2026-08-06T00:00:00+00:00
- Task / Issue: #284
- Phase: Dev
- Executing role: Dev / Builder
**Task:** #284 · \`feature/284\` → \`main\` · head \`${CANONICAL_FULL_UPPERCASE_SHA}\`
**PR:** https://github.com/${CANONICAL_REPOSITORY}/pull/285
**Completed:** Added the bounded change.
**Evidence:** Local — focused test → pass; GitHub — exact-head CI → pass
**AC audit:** Done
**Risks / escalation:** None
**Next:** Reviewer posts REVIEW_VERDICT
`

const CANONICAL_REVIEW_BODY = `## REVIEW_VERDICT
### Task log
- Timestamp: 2026-08-06T00:00:00+00:00
- Task / Issue: #284
- Phase: Reviewer
- Executing role: Reviewer
**PR / base / head:** PR #285 / main / · \`${CANONICAL_FULL_UPPERCASE_SHA}\`
**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**Findings:** Critical: None · Important: None
**Gates:** exact-head CI pass
**Next:** Founder merge authorization
`

type CanonicalTransportCase = TierACase & {
  label: string
  bodyFile: string
  body: string
  registryArgs: readonly string[]
  resultArgs: readonly string[]
  expectedClassification: 'SUCCESS' | 'BLOCKED_EXTERNAL'
  expectedExit: number
  expectedPrNumber: string | null
  expectedExactHead: string | null
  invalidAuthorityArgs?: readonly string[]
}

const CANONICAL_TRANSPORT_CASES = [
  {
    label: 'role comment',
    command: 'bemoat:issue:comment',
    entrypoint: 'scripts/post-role-comment.mjs',
    bodyFile: 'comment.md',
    body: CANONICAL_ROLE_COMMENT_BODY,
    registryArgs: [
      '284',
      '--repo',
      CANONICAL_REPOSITORY,
      '--body-file',
      './comment.md',
    ],
    resultArgs: [
      '284',
      '--repo',
      CANONICAL_UPPERCASE_REPOSITORY,
      '--body-file',
      './comment.md',
      '--check',
    ],
    expectedClassification: 'SUCCESS',
    expectedExit: 0,
    expectedPrNumber: null,
    expectedExactHead: null,
  },
  {
    label: 'dispatch',
    command: 'bemoat:mission-control:dispatch',
    entrypoint: 'scripts/mission-control-dispatch.mjs',
    bodyFile: 'handoff.md',
    body: CANONICAL_HANDOFF_BODY,
    registryArgs: [
      '284',
      '--repo',
      CANONICAL_REPOSITORY,
      '--body-file',
      './handoff.md',
    ],
    resultArgs: [
      '284',
      '--repo',
      CANONICAL_UPPERCASE_REPOSITORY,
      '--body-file',
      './handoff.md',
    ],
    expectedClassification: 'BLOCKED_EXTERNAL',
    expectedExit: 3,
    expectedPrNumber: null,
    expectedExactHead: null,
    invalidAuthorityArgs: [
      '284',
      '--repo',
      CANONICAL_REPOSITORY,
      '--body-file',
      './handoff.md',
      '--planning-base-sha',
      'abc1234',
    ],
  },
  {
    label: 'delivery',
    command: 'bemoat:agent:delivery',
    entrypoint: 'scripts/agent-delivery.mjs',
    bodyFile: 'result.md',
    body: CANONICAL_DELIVERY_BODY,
    registryArgs: [
      '284',
      '--repo',
      CANONICAL_REPOSITORY,
      '--body-file',
      './result.md',
    ],
    resultArgs: [
      '284',
      '--repo',
      CANONICAL_UPPERCASE_REPOSITORY,
      '--body-file',
      './result.md',
    ],
    expectedClassification: 'BLOCKED_EXTERNAL',
    expectedExit: 3,
    expectedPrNumber: '285',
    expectedExactHead: CANONICAL_FULL_LOWERCASE_SHA,
  },
  {
    label: 'ordinary review',
    command: 'bemoat:mission-control:review',
    entrypoint: 'scripts/mission-control-review.mjs',
    bodyFile: 'review.md',
    body: CANONICAL_REVIEW_BODY,
    registryArgs: [
      '284',
      '--body-file',
      './review.md',
      '--expected-state',
      'AWAITING_REVIEW_1',
      '--review-type',
      'full',
      '--expected-head',
      CANONICAL_FULL_UPPERCASE_SHA,
    ],
    resultArgs: [
      '284',
      '--repo',
      CANONICAL_UPPERCASE_REPOSITORY,
      '--body-file',
      './review.md',
      '--expected-state',
      'AWAITING_REVIEW_1',
      '--review-type',
      'full',
      '--expected-head',
      CANONICAL_FULL_UPPERCASE_SHA,
    ],
    expectedClassification: 'BLOCKED_EXTERNAL',
    expectedExit: 3,
    expectedPrNumber: '285',
    expectedExactHead: CANONICAL_FULL_LOWERCASE_SHA,
    invalidAuthorityArgs: [
      '284',
      '--body-file',
      './review.md',
      '--expected-state',
      'AWAITING_REVIEW_1',
      '--review-type',
      'full',
      '--expected-head',
      'abc1234',
    ],
  },
] as const satisfies readonly CanonicalTransportCase[]

const CANONICAL_TRANSPORT_ROWS = CANONICAL_TRANSPORT_CASES.map(
  (entry) => [entry.label, entry] as const,
)

function runCanonicalTransport(
  entry: CanonicalTransportCase,
  argv: readonly string[],
): CliBoundaryResult {
  return runCliBoundaryCase({
    entrypoint: entry.entrypoint,
    argv,
    env: facadeEnvironment(entry),
    files: {
      [entry.bodyFile]: entry.body,
    },
  })
}

function expectCanonicalExternalPreflight(run: CliBoundaryResult) {
  expect(run.error).toBeNull()
  expect(run.status).toBe(3)
  expect(run.stderr).toBe('')
  expect(run.stdout).toContain('BLOCKED_EXTERNAL')
  expect(run.poison_invocations.length).toBeGreaterThan(0)
}

function expectCanonicalJsonResult(
  run: CliBoundaryResult,
  entry: CanonicalTransportCase,
) {
  expect(run.error).toBeNull()
  expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(entry.expectedExit)
  expect(run.stderr).toBe('')

  const result = parseSingleJson(run.stdout)
  assertResultEnvelopeV1(result)
  expect(result).toMatchObject({
    command: entry.command,
    mode: 'result',
    outcome: entry.expectedClassification === 'SUCCESS' ? 'SUCCESS' : 'ERROR',
    classification: entry.expectedClassification,
    mutation_performed: false,
    repository: CANONICAL_REPOSITORY,
    issue_number: '284',
    pr_number: entry.expectedPrNumber,
    exact_head: entry.expectedExactHead,
  })
}

describe('Task 5 Tier A canonical role transport boundaries', () => {
  it.each(CANONICAL_TRANSPORT_ROWS)(
    'Tier A %s help forms exit zero without network write or adapter construction',
    (_label, entry) => {
      for (const argv of [
        ['--help'],
        ['-h'],
        ['--help', '--json'],
        ['--json', '--help'],
        ['-h', '--json'],
        ['--json', '-h'],
      ]) {
        const run = runCanonicalTransport(entry, argv)
        expect(run.error).toBeNull()
        expect(run.status, `${entry.command}\n${run.stdout}\n${run.stderr}`).toBe(0)
        expect(run.stderr).toBe('')
        expectNoBoundarySideEffects(run)

        if (argv.includes('--json')) {
          const help = parseSingleJson(run.stdout)
          expect(help).toMatchObject({
            schema_version: 1,
            command: entry.command,
            mode: 'help',
            classification: 'HELP',
            tier: 'A',
          })
        } else {
          expect(run.stdout).toContain(`HELP: ${entry.command}`)
        }
      }
    },
  )

  it.each(CANONICAL_TRANSPORT_ROWS)(
    'Tier A %s registry examples reach the documented preflight',
    (_label, entry) => {
      const run = runCanonicalTransport(entry, entry.registryArgs)
      expectCanonicalExternalPreflight(run)
    },
  )

  it.each(CANONICAL_TRANSPORT_ROWS)(
    'Tier A %s invalid syntax exits two before durable reads',
    (_label, entry) => {
      for (const argv of [
        ['--definitely-invalid'],
        ['--json', '--definitely-invalid'],
      ]) {
        const run = runCanonicalTransport(entry, argv)
        if (argv.includes('--json')) {
          expectJsonInvalidInvocation(run, entry)
        } else {
          expectInvalidInvocation(run)
        }
      }

      if (entry.invalidAuthorityArgs) {
        expectInvalidInvocation(runCanonicalTransport(entry, entry.invalidAuthorityArgs))
      }
    },
  )

  it.each(CANONICAL_TRANSPORT_ROWS)(
    'Tier A %s emits one v1 result object with the expected exit',
    (_label, entry) => {
      expectCanonicalJsonResult(
        runCanonicalTransport(entry, [...entry.resultArgs, '--json']),
        entry,
      )
    },
  )

  it.each(CANONICAL_TRANSPORT_ROWS)(
    'Tier A %s plain and JSON modes share one classification',
    (_label, entry) => {
      const plain = runCanonicalTransport(entry, entry.resultArgs)
      const json = runCanonicalTransport(entry, [...entry.resultArgs, '--json'])

      expect(plain.error).toBeNull()
      expect(json.error).toBeNull()
      expect(plain.status).toBe(entry.expectedExit)
      expect(json.status).toBe(entry.expectedExit)
      expect(plain.stderr).toBe('')
      expect(json.stderr).toBe('')

      const result = parseSingleJson(json.stdout)
      assertResultEnvelopeV1(result)
      expect(result.classification).toBe(entry.expectedClassification)
      expect(plain.stdout).toContain(entry.expectedClassification)
    },
  )
})
