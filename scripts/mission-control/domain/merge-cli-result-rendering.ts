import { CliInvocationError } from '../../cli/command-invocation.mjs'

export type MergeSuccessResult = {
  outcome: unknown
  prNumber: unknown
  reviewedHead: unknown
  mergeCommit: unknown
  issueNumber: unknown
}

export function renderMergeSuccess(result: MergeSuccessResult): string {
  return `Mission Control merge transport ${result.outcome}: PR #${result.prNumber} at ${result.reviewedHead} -> ${result.mergeCommit}; Issue #${result.issueNumber} DONE.\n`
}

export function renderMergeError(error: unknown): {
  output: string
  stream: 'stderr'
  exitCode: 1
} {
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
