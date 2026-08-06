import { execFileSync, spawnSync } from 'node:child_process'

import { managedPaths, packageSyncProposalPath } from './inventory.mjs'

const syncMetadataPath = '.bemoat-boilerplate-sync.json'
const stashMessage = 'bemoat-boilerplate-sync: pre-sync stash'

export const syncCommitPaths = [...managedPaths, syncMetadataPath, packageSyncProposalPath]

function run(command, args, options = {}) {
  execFileSync(command, args, {
    stdio: 'inherit',
    ...options,
  })
}

function getCommandOutput(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  })
}

function getCommandStatus(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  })

  if (result.error) throw result.error
  return {
    status: result.status ?? 1,
    stderr: result.stderr ?? '',
  }
}

function getScopedGitPathArgs(paths) {
  return ['--', '.', ...paths.map((path) => `:(exclude)${path}`)]
}

export function createGitClient({ suppressStdout = false } = {}) {
  const runOptions = suppressStdout
    ? { stdio: ['ignore', 2, 'inherit'] }
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

export function getSyncCommitPaths(pathsSynced = managedPaths, { includePackageJson = false } = {}) {
  const paths = [...pathsSynced, syncMetadataPath, packageSyncProposalPath]
  if (includePackageJson) paths.push('package.json')
  return paths
}

export function stashWorkingTreeIfNeeded(
  cwd,
  git = createGitClient(),
  { onMutation = () => {} } = {},
) {
  const excludedPaths = getSyncCommitPaths()

  if (!git.hasWorkingTreeChanges(cwd, excludedPaths)) return false

  onMutation()
  git.stashPush(cwd, excludedPaths)
  return true
}

export function commitSyncedChanges(
  { repo, ref, targetRoot, syncedPaths = managedPaths, includePackageJson = false },
  git = createGitClient(),
) {
  const pathsToCommit = getSyncCommitPaths(syncedPaths, { includePackageJson })

  git.addPaths(targetRoot, pathsToCommit)

  if (!git.hasStagedChanges(targetRoot, pathsToCommit)) return false

  git.commit(targetRoot, `sync boilerplate from ${repo}#${ref}`)
  return true
}

export function commitValidatedSyncChanges(options, { validate = () => {}, git = createGitClient() } = {}) {
  validate()
  return commitSyncedChanges(options, git)
}

export function restoreStashIfNeeded(cwd, stashCreated, git = createGitClient()) {
  if (!stashCreated) return

  git.stashPop(cwd)
}
