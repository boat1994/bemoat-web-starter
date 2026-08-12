import { spawnSync } from 'node:child_process'

function blockedExternal(message) {
  const error = new Error(`BLOCKED_EXTERNAL: ${message}`)
  error.classification = 'BLOCKED_EXTERNAL'
  return error
}

export function defaultRunGh(args, options = {}, spawn = spawnSync) {
  const result = spawn('gh', args, {
    encoding: 'utf8',
    input: options.input,
    env: options.env ?? process.env,
  })
  if (result.error || result.status !== 0) {
    throw blockedExternal(
      result.stderr || result.stdout || result.error?.message || 'GitHub CLI failed',
    )
  }
  return result.stdout.trim()
}

export function createProductionDeps({ runGh = defaultRunGh } = {}) {
  const readIssue = async (issueNumber, repo) => JSON.parse(runGh([
    'issue', 'view', String(issueNumber), '--repo', repo, '--json', 'number,id,title,body,state',
  ]))

  const readPullRequest = async (prNumber, repo) => JSON.parse(runGh([
    'pr', 'view', String(prNumber), '--repo', repo,
    '--json', 'number,state,isDraft,headRefOid,baseRefName,baseRefOid',
  ]))

  const readComment = async (repo, commentId) => JSON.parse(runGh([
    'api', `repos/${repo}/issues/comments/${commentId}`,
  ]))

  const readIssueComments = async (repo, issueNumber) => {
    const pages = JSON.parse(runGh([
      'api', '--paginate', '--slurp',
      `repos/${repo}/issues/${issueNumber}/comments?per_page=100`,
    ]))
    if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
      throw blockedExternal('live Issue comment pagination is incomplete')
    }
    return pages.flat()
  }

  const readFounderLoginsVariable = async (repo) => JSON.parse(runGh([
    'api', `repos/${repo}/actions/variables/BEMOAT_FOUNDER_LOGINS`,
  ]))

  return {
    runGh,
    readIssue,
    readPullRequest,
    readComment,
    readIssueComments,
    readFounderLoginsVariable,
  }
}
