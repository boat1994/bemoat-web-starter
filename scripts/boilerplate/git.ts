import { execFileSync, spawnSync, type ExecFileSyncOptions } from 'node:child_process'

import { managedPaths, packageSyncProposalPath } from './inventory.ts'

const syncMetadataPath = '.bemoat-boilerplate-sync.json'
const stashMessage = 'bemoat-boilerplate-sync: pre-sync stash'

export const syncCommitPaths = [...managedPaths, syncMetadataPath, packageSyncProposalPath]

type GitOptions = ExecFileSyncOptions

type GitStatus = {
  status: number
  stderr: string
}

export type GitClient = {
  hasWorkingTreeChanges: (cwd: string, excludedPaths: string[]) => boolean
  stashPush: (cwd: string, excludedPaths: string[]) => void
  addPaths: (cwd: string, paths: string[]) => void
  hasStagedChanges: (cwd: string, paths: string[]) => boolean
  commit: (cwd: string, message: string) => void
  stashPop: (cwd: string) => void
}

function run(command: string, args: string[], options: GitOptions = {}): void {
  execFileSync(command, args, {
    stdio: 'inherit',
    ...options,
  })
}

function getCommandOutput(command: string, args: string[], options: GitOptions = {}): string {
  const output = execFileSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  })
  return typeof output === 'string' ? output : output.toString('utf8')
}

function getCommandStatus(command: string, args: string[], options: GitOptions = {}): GitStatus {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  })

  if (result.error) throw result.error
  return {
    status: result.status ?? 1,
    stderr: String(result.stderr ?? ''),
  }
}

function getScopedGitPathArgs(paths: string[]): string[] {
  return ['--', '.', ...paths.map((path) => `:(exclude)${path}`)]
}

export function createGitClient({ suppressStdout = false }: { suppressStdout?: boolean } = {}): GitClient {
  const runOptions: ExecFileSyncOptions = suppressStdout
    ? { stdio: ['ignore', 2, 'inherit'] as const }
    : {}

  return {
    hasWorkingTreeChanges(cwd, excludedPaths = []) {
      return getCommandOutput('git', ['status', '--short', ...getScopedGitPathArgs(excludedPaths)], { cwd }).trim().length > 0
    },
    stashPush(cwd, excludedPaths = []) {
      run('git', [
        'stash',
        'push',
        '--include-untracked',
        '-m',
        stashMessage,
        ...getScopedGitPathArgs(excludedPaths),
      ], { cwd, ...runOptions })
    },
    addPaths(cwd, paths) {
      run('git', ['add', '--', ...paths], { cwd, ...runOptions })
    },
    hasStagedChanges(cwd, paths) {
      const result = getCommandStatus('git', ['diff', '--cached', '--quiet', '--', ...paths], { cwd })

      if (result.status === 0) return false
      if (result.status === 1) return true

      const diagnostic = String(result.stderr).trim()
      throw new Error(
        diagnostic
          ? `Unable to determine staged sync changes: ${diagnostic}`
          : 'Unable to determine staged sync changes',
      )
    },
    commit(cwd, message) {
      run('git', ['commit', '-m', message], { cwd, ...runOptions })
    },
    stashPop(cwd) {
      run('git', ['stash', 'pop'], { cwd, ...runOptions })
    },
  }
}

export function getSyncCommitPaths(
  pathsSynced: string[] = managedPaths,
  { includePackageJson = false }: { includePackageJson?: boolean } = {},
): string[] {
  const paths = [...pathsSynced, syncMetadataPath, packageSyncProposalPath]
  if (includePackageJson) paths.push('package.json')
  return paths
}

export function stashWorkingTreeIfNeeded(
  cwd: string,
  git: GitClient = createGitClient(),
  { onMutation = () => {} }: { onMutation?: () => void } = {},
): boolean {
  const excludedPaths = getSyncCommitPaths()

  if (!git.hasWorkingTreeChanges(cwd, excludedPaths)) return false

  onMutation()
  git.stashPush(cwd, excludedPaths)
  return true
}

export function commitSyncedChanges(
  {
    repo,
    ref,
    targetRoot,
    syncedPaths = managedPaths,
    includePackageJson = false,
  }: {
    repo: string
    ref: string
    targetRoot: string
    syncedPaths?: string[]
    includePackageJson?: boolean
  },
  git: GitClient = createGitClient(),
): boolean {
  const pathsToCommit = getSyncCommitPaths(syncedPaths, { includePackageJson })

  git.addPaths(targetRoot, pathsToCommit)

  if (!git.hasStagedChanges(targetRoot, pathsToCommit)) return false

  git.commit(targetRoot, `sync boilerplate from ${repo}#${ref}`)
  return true
}

export function commitValidatedSyncChanges(
  options: {
    repo: string
    ref: string
    targetRoot: string
    syncedPaths?: string[]
    includePackageJson?: boolean
  },
  {
    validate = () => {},
    git = createGitClient(),
  }: { validate?: () => void; git?: GitClient } = {},
): boolean {
  validate()
  return commitSyncedChanges(options, git)
}

export function restoreStashIfNeeded(
  cwd: string,
  stashCreated: boolean,
  git: GitClient = createGitClient(),
): void {
  if (!stashCreated) return

  git.stashPop(cwd)
}
