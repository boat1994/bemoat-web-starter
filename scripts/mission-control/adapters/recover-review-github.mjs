import { spawnSync } from 'node:child_process'

export function defaultRunGh(args, options = {}) {
  const result = spawnSync('gh', args, {
    encoding: 'utf8',
    input: options.input,
    env: options.env ?? process.env,
  })
  if (result.error || result.status !== 0) {
    if (options.allowNotFound && /\\b404\\b|not found/i.test(`${result.stderr ?? ''}\\n${result.stdout ?? ''}`)) return null
    const error = new Error(result.stderr || result.stdout || result.error?.message || 'GitHub CLI failed')
    error.classification = 'BLOCKED_EXTERNAL'
    throw error
  }
  return result.stdout.trim()
}

export function createProductionDeps({ runGh = defaultRunGh } = {}) {
  const runGit = (args) => {
    const result = spawnSync('git', args, { cwd: process.cwd(), encoding: 'utf8' })
    if (result.error || result.status !== 0) {
      throw new Error(result.stderr || result.stdout || result.error?.message || 'Git checkout inspection failed')
    }
    return result.stdout.trim()
  }
  const readFileAtRef = async (repo, path, ref, { optional = false } = {}) => {
    const raw = runGh(['api', `repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`], optional ? { allowNotFound: true } : {})
    if (!raw) return null
    const file = JSON.parse(raw)
    return {
      path: file.path ?? path,
      sha: file.sha,
      content: file.encoding === 'base64'
        ? Buffer.from(String(file.content ?? '').replace(/\\s/g, ''), 'base64').toString('utf8')
        : String(file.content ?? ''),
    }
  }
  return {
    runGh,
    runGit,
    readIssue: async (issueNumber, repo) => JSON.parse(runGh(['issue', 'view', String(issueNumber), '--repo', repo, '--json', 'number,id,title,body,state,stateReason'])),
    readPullRequest: async (prNumber, repo) => JSON.parse(runGh(['pr', 'view', String(prNumber), '--repo', repo, '--json', 'number,state,isDraft,headRefOid,baseRefName,baseRefOid,statusCheckRollup'])),
    readComment: async (repo, commentId) => JSON.parse(runGh(['api', `repos/${repo}/issues/comments/${commentId}`])),
    readIssueComments: async (repo, issueNumber) => JSON.parse(runGh(['api', '--paginate', '--slurp', `repos/${repo}/issues/${issueNumber}/comments?per_page=100`])),
    readExactHeadChecks: async (repo, _prNumber, head) => JSON.parse(runGh(['api', `repos/${repo}/commits/${head}/check-runs?per_page=100`])).check_runs ?? [],
    readProtectedBase: async (repo, base) => JSON.parse(runGh(['api', `repos/${repo}/git/ref/heads/${base}`])).object ?? {},
    readFileAtRef,
    readPolicyFiles: async (repo, ref, paths) => Promise.all(paths.map(({ path, optional }) => readFileAtRef(repo, path, ref, { optional }))),
    readFounderLoginsVariable: async (repo) => JSON.parse(runGh(['api', `repos/${repo}/actions/variables/BEMOAT_FOUNDER_LOGINS`])),
    postComment: async (repo, issueNumber, body) => JSON.parse(runGh(['api', '--method', 'POST', `repos/${repo}/issues/${issueNumber}/comments`, '--input', '-'], { input: JSON.stringify({ body }) })),
  }
}
