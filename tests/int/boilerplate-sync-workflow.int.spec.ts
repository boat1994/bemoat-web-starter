import { describe, expect, it } from 'vitest'

const ROOT_FACADE_EXPORTS = [
  'SYNC_MODES',
  'applyBuildContractFiles',
  'applyBuildContractScripts',
  'applyManagedPackageScripts',
  'assertExactManagedPackageScripts',
  'assertToolchainContract',
  'buildContractFilePaths',
  'buildContractPackageScripts',
  'buildPackageSyncProposal',
  'buildSyncMetadata',
  'commitSyncedChanges',
  'commitValidatedSyncChanges',
  'copyManagedPath',
  'copySeedOnlyPath',
  'exactManagedPackageScripts',
  'expandSeedOnlyFiles',
  'formatPackageSyncProposal',
  'getDefaultSyncConfig',
  'getSourceSyncConfig',
  'getSuggestedNextCommands',
  'getSyncCommitPaths',
  'isDirectExecution',
  'isFirstToolchainBootstrap',
  'listPathFiles',
  'managedPackageScripts',
  'managedPaths',
  'mergeGitignoreKeepTarget',
  'mergeKeepPath',
  'mergeKeepPaths',
  'normalizeGitignoreLine',
  'packageSyncProposalPath',
  'parseApplyBuildContract',
  'parseSyncMode',
  'readSourceSyncManifest',
  'restoreStashIfNeeded',
  'runToolchainPreflight',
  'seedOnlyPaths',
  'stashWorkingTreeIfNeeded',
  'suggestedPackageScripts',
  'suggestedPackageSections',
  'syncCommitPaths',
  'syncManifestPath',
  'syncPackageManifest',
  'syncPathsFromSource',
] as const

const targetRoot = '/non-mutating-child'
const tempRoot = '/non-mutating-child/.bemoat-sync-tmp'
const sourceRoot = '/non-mutating-child/.bemoat-sync-tmp/source'

function makeWorkflowDependencies(calls: string[], logs: string[] = []) {
  return {
    rmSync(path: string) {
      calls.push(`rm:${path}`)
    },
    mkdirSync(path: string) {
      calls.push(`mkdir:${path}`)
    },
    writeFileSync(path: string, content: string) {
      calls.push(`write:${path}:${content}`)
    },
    join(...paths: string[]) {
      return paths.join('/')
    },
    run(command: string, args: string[], options: { cwd?: string }) {
      calls.push(`run:${command}:${args.join(',')}:${options.cwd}`)
    },
    parseSyncMode() {
      calls.push('mode')
      return 'harness-only'
    },
    parseApplyBuildContract() {
      calls.push('build-mode')
      return true
    },
    createGitClient() {
      calls.push('git-client')
      return { name: 'git-client' }
    },
    getSourceSyncConfig(path: string) {
      calls.push(`config:${path}`)
      return {
        managedPaths: ['AGENTS.md'],
        seedOnlyPaths: [] as string[],
        mergeKeepPaths: [] as string[],
        managedPackageScripts: [] as string[],
        suggestedPackageScripts: [] as string[],
        suggestedPackageSections: [] as string[],
        buildContractPackageScripts: ['build'],
        buildContractFilePaths: ['open-next.config.ts'],
      }
    },
    readJSON(path: string) {
      calls.push(`read:${path}`)
      return { scripts: {} }
    },
    assertExactManagedPackageScripts() {
      calls.push('package-gate')
    },
    runToolchainPreflight() {
      calls.push('toolchain-preflight')
    },
    stashWorkingTreeIfNeeded() {
      calls.push('stash')
      return true
    },
    syncPathsFromSource(options: { assertManagedRuntimeDeliveryClosure: unknown }) {
      calls.push(`sync:${options.assertManagedRuntimeDeliveryClosure === 'closure'}`)
      return {
        syncedManaged: ['AGENTS.md'],
        seededFiles: [] as string[],
        skippedSeedFiles: [] as string[],
        mergedFiles: [] as string[],
        seedOnlyPathsSkipped: true,
      }
    },
    syncPackageManifest() {
      calls.push('package-sync')
      return {
        packageChanged: true,
        addedScripts: ['bemoat:check'],
        appliedBuildContractScripts: ['build'],
        updatedBuildContractScripts: [] as string[],
        proposalPath: '.bemoat/package-sync-proposal.md',
      }
    },
    applyBuildContractFiles() {
      calls.push('build-files')
      return { applied: ['open-next.config.ts'], updated: [] as string[], skipped: [] as string[] }
    },
    buildSyncMetadata() {
      calls.push('metadata')
      return { version: 1 }
    },
    commitValidatedSyncChanges(_options: unknown, { validate }: { validate: () => void }) {
      validate()
      calls.push('commit')
      return true
    },
    assertToolchainContract() {
      calls.push('validate')
    },
    restoreStashIfNeeded() {
      calls.push('restore-stash')
    },
    assertManagedRuntimeDeliveryClosure: 'closure',
    log(message: string) {
      logs.push(message)
    },
  }
}

describe('boilerplate sync workflow child portability', () => {
  it('keeps the root facade at its 45-export public contract', async () => {
    const facade = await import('../../scripts/sync-boilerplate.mjs')

    expect(Object.keys(facade).sort()).toEqual([...ROOT_FACADE_EXPORTS].sort())
  })

  it('orders a harness-only child simulation without cloning or mutating a child', async () => {
    const workflowModule = await import('../../scripts/boilerplate/workflow.mjs')
    const calls: string[] = []
    const logs: string[] = []
    const workflow = workflowModule.createBoilerplateSyncWorkflow(
      makeWorkflowDependencies(calls, logs),
    )

    workflow.run({
      repo: 'example/starter',
      ref: 'slice-4',
      targetRoot,
      tempRoot,
      sourceRoot,
    })

    expect(calls).toEqual([
      'mode',
      'build-mode',
      'git-client',
      `rm:${tempRoot}`,
      `mkdir:${tempRoot}`,
      `run:git:clone,--depth,1,--branch,slice-4,https://github.com/example/starter.git,${sourceRoot}:${targetRoot}`,
      `config:${sourceRoot}`,
      `read:${sourceRoot}/package.json`,
      `read:${targetRoot}/package.json`,
      'package-gate',
      'toolchain-preflight',
      'stash',
      'sync:true',
      'package-sync',
      'build-files',
      'metadata',
      `write:${targetRoot}/.bemoat-boilerplate-sync.json:{\n  "version": 1\n}\n`,
      `rm:${tempRoot}`,
      'validate',
      'commit',
      `rm:${tempRoot}`,
      'restore-stash',
    ])
    expect(logs).toContain('Syncing Bemoat boilerplate from example/starter#slice-4 (harness-only mode)')
    expect(logs).toContain('Applying build contract scripts: build')
    expect(logs).toContain('Applying build contract files: open-next.config.ts')
    expect(logs).toContain('[sync] committed sync changes')
    expect(logs).toContain('Review remaining drift in .bemoat/package-sync-proposal.md (build contract scripts and files were applied automatically)')
    expect(logs).toContain('pnpm run check')
    expect(logs).toContain('(or pnpm run bemoat:check if check is not defined yet)')
  })

  it('cleans up and restores a stashed non-mutating simulation when projection fails', async () => {
    const workflowModule = await import('../../scripts/boilerplate/workflow.mjs')
    const calls: string[] = []
    const dependencies = makeWorkflowDependencies(calls)
    dependencies.syncPathsFromSource = () => {
      calls.push('sync-failure')
      throw new Error('projection failed')
    }
    const workflow = workflowModule.createBoilerplateSyncWorkflow(dependencies)

    expect(() => workflow.run({
      repo: 'example/starter',
      ref: 'slice-4',
      targetRoot,
      tempRoot,
      sourceRoot,
    })).toThrow('projection failed')

    expect(calls.slice(-3)).toEqual(['sync-failure', `rm:${tempRoot}`, 'restore-stash'])
  })

  it('classifies post-mutation failures as ambiguous and preserves legacy diagnostics', async () => {
    const workflowModule = await import('../../scripts/boilerplate/workflow.mjs')
    const calls: string[] = []
    const logs: string[] = []
    const dependencies = makeWorkflowDependencies(calls, logs)
    dependencies.commitValidatedSyncChanges = () => {
      calls.push('commit-failure')
      throw new Error('commit failed after copy')
    }
    const workflow = workflowModule.createBoilerplateSyncWorkflow(dependencies)

    let thrown: unknown
    try {
      workflow.run({
        repo: 'example/starter',
        ref: 'slice-4',
        targetRoot,
        tempRoot,
        sourceRoot,
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toMatchObject({
      message: 'commit failed after copy',
      classification: 'AMBIGUOUS_RESULT',
      mutationPerformed: true,
      legacyOutput: expect.arrayContaining([
        'Syncing Bemoat boilerplate from example/starter#slice-4 (harness-only mode)',
        '[sync] package sync proposal written to .bemoat/package-sync-proposal.md',
      ]),
    })
  })

  it('keeps final preflight failures non-mutating', async () => {
    const workflowModule = await import('../../scripts/boilerplate/workflow.mjs')
    const calls: string[] = []
    const dependencies = makeWorkflowDependencies(calls)
    dependencies.runToolchainPreflight = () => {
      calls.push('preflight-failure')
      throw new Error('final preflight failed')
    }
    const workflow = workflowModule.createBoilerplateSyncWorkflow(dependencies)

    let thrown: unknown
    try {
      workflow.run({
        repo: 'example/starter',
        ref: 'slice-4',
        targetRoot,
        tempRoot,
        sourceRoot,
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toMatchObject({
      message: 'final preflight failed',
      mutationPerformed: false,
    })
    expect((thrown as { classification?: string }).classification).not.toBe('AMBIGUOUS_RESULT')
    expect(calls).not.toContain('stash')
  })

})
