import { spawnSync } from 'node:child_process'

export function defaultRunGh(args, options = {}) {
  const result = spawnSync('gh', args, {
    encoding: 'utf8',
    input: options.input,
    env: options.env ?? process.env,
  })
  if (result.error || result.status !== 0) {
    const error = new Error(result.stderr || result.stdout || result.error?.message || 'GitHub CLI failed')
    error.classification = 'BLOCKED_EXTERNAL'
    throw error
  }
  return result.stdout.trim()
}

export function createProductionRecoverStateDeps({ runGh = defaultRunGh } = {}) {
  const runGit = (args) => {
    const result = spawnSync('git', args, { encoding: 'utf8' })
    if (result.error || result.status !== 0) throw new Error(result.stderr || result.stdout || result.error?.message || 'git failed')
    return result.stdout.trim()
  }
  return {
    runGh,
    runGit,
    readIssue: async (issueNumber, repo) => JSON.parse(runGh(['issue', 'view', String(issueNumber), '--repo', repo, '--json', 'number,id,title,body,state'])),
    readPullRequest: async (prNumber, repo) => JSON.parse(runGh(['pr', 'view', String(prNumber), '--repo', repo, '--json', 'number,state,isDraft,headRefName,headRefOid,baseRefName,baseRefOid'])),
    readComment: async (repo, commentId) => JSON.parse(runGh(['api', `repos/${repo}/issues/comments/${commentId}`])),
    readIssueComments: async (repo, issueNumber) => JSON.parse(runGh(['api', '--paginate', '--slurp', `repos/${repo}/issues/${issueNumber}/comments?per_page=100`])),
    readFounderLoginsVariable: async (repo) => JSON.parse(runGh(['api', `repos/${repo}/actions/variables/BEMOAT_FOUNDER_LOGINS`])),
    readCommit: async (repo, sha) => JSON.parse(runGh(['api', `repos/${repo}/commits/${sha}`])),
    readFile: async (repo, path, ref) => JSON.parse(runGh(['api', `repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`])),
    readProtectedRef: async (repo, ref) => JSON.parse(runGh(['api', `repos/${repo}/git/ref/heads/${ref}`])),
  }
}
