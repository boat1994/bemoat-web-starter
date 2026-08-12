const USAGE = 'Usage: pnpm run bemoat:mission-control:merge -- <issue-number> --repo owner/repo --authorization-comment <id>'

export type MergeCliOptions = {
  issueNumber: number | null
  repo: string | null
  authorizationCommentId: string | null
}

function hasIssueNumber(value: number | null): value is number {
  return Boolean(value)
}

function isInteger(value: number | null): value is number {
  return Number.isInteger(value)
}

export function parseMergeCliArgs(argv: string[]): MergeCliOptions {
  const options: MergeCliOptions = { issueNumber: null, repo: null, authorizationCommentId: null }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--') continue
    if (argument === '--repo' || argument === '--authorization-comment') {
      const value = argv[++index]
      if (!value) throw new Error(`${argument} requires a value`)
      if (argument === '--repo') options.repo = value
      else options.authorizationCommentId = value
      continue
    }
    if (argument.startsWith('-') || hasIssueNumber(options.issueNumber)) throw new Error(`unexpected argument: ${argument}`)
    options.issueNumber = Number(argument)
  }
  const issueNumber = options.issueNumber
  if (!isInteger(issueNumber) || issueNumber <= 0 || !options.repo || !options.authorizationCommentId) {
    throw new Error(USAGE)
  }
  return options
}
