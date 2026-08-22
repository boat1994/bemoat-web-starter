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

export function runNodeTransport(args, env = process.env) {
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', env })
  if (result.error || result.status !== 0) {
    throw new Error(result.stderr || result.stdout || result.error?.message || 'Mission Control reconciler failed')
  }
  return result.stdout.trim()
}

export function readProtectedRef(runGh, repo, base = 'main') {
  return JSON.parse(runGh([
    'api', `repos/${repo}/git/ref/heads/${base}`,
  ]))
}

export function createProductionMergeDeps({ runGh = defaultRunGh, runNode = runNodeTransport } = {}) {
  return {
    runGh,
    runNode,
    readIssue: async (issueNumber, repo) => JSON.parse(runGh([
      'issue', 'view', String(issueNumber), '--repo', repo,
      '--json', 'number,id,title,body,state,stateReason',
    ])),
    readPullRequest: async (prNumber, repo) => JSON.parse(runGh([
      'pr', 'view', String(prNumber), '--repo', repo,
      '--json', 'number,id,state,isDraft,mergeable,headRefOid,baseRefName,baseRefOid,statusCheckRollup,mergeCommit,url,title,body,closingIssuesReferences',
    ])),
    readPullRequestCommits: async (prNumber, repo) => JSON.parse(runGh([
      'api', '--paginate', '--slurp', `repos/${repo}/pulls/${prNumber}/commits?per_page=100`,
    ])),
    readIssue: async (issueNumber, repo) => JSON.parse(runGh([
      'issue', 'view', String(issueNumber), '--repo', repo, '--json', 'number,id,title,body,state,stateReason',
    ])),
    readComment: async (repo, commentId) => JSON.parse(runGh([
      'api', `repos/${repo}/issues/comments/${commentId}`,
    ])),
    readIssueComments: async (repo, issueNumber) => JSON.parse(runGh([
      'api', '--paginate', '--slurp', `repos/${repo}/issues/${issueNumber}/comments?per_page=100`,
    ])),
    readFounderLoginsVariable: async (repo) => JSON.parse(runGh([
      'api', `repos/${repo}/actions/variables/BEMOAT_FOUNDER_LOGINS`,
    ])),
    readProtectedRef: async (repo, base = 'main') => readProtectedRef(runGh, repo, base),
    markReadyForReview: async (prNumber, repo) => runGh(['pr', 'ready', String(prNumber), '--repo', repo]),
    mergePullRequest: async ({ prNumber, repo, expectedHead }) => runGh([
      'pr', 'merge', String(prNumber), '--repo', repo, '--merge', '--match-head-commit', expectedHead,
    ]),
    compareCommits: async ({ repo, commit, base }) => JSON.parse(runGh([
      'api', `repos/${repo}/compare/${commit}...${base}`,
    ])),
    postIssueComment: async ({ repo, issueNumber, body }) => JSON.parse(runGh([
      'api', '-X', 'POST', `repos/${repo}/issues/${issueNumber}/comments`, '--input', '-',
    ], { input: JSON.stringify({ body }) })),
    closeIssue: async (issueNumber, repo) => runGh([
      'issue', 'close', String(issueNumber), '--repo', repo, '--reason', 'completed',
    ]),
  }
}
