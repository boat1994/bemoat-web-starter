import { CliInvocationError } from '../../cli/command-invocation.mjs'

export function renderMergeSuccess(result) {
  return `Mission Control merge transport ${result.outcome}: PR #${result.prNumber} at ${result.reviewedHead} -> ${result.mergeCommit}; Issue #${result.issueNumber} DONE.\n`
}

export function renderMergeError(error) {
  const message = error instanceof Error ? error.message : String(error)
  const output = error instanceof CliInvocationError
    ? `ERROR: [${error.classification}] ${message}\n`
    : `ERROR: ${message}\n`

  return {
    output,
    stream: 'stderr',
    exitCode: 1,
  }
}
