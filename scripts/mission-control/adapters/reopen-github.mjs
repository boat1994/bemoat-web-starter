import { spawnSync } from 'node:child_process'

function blockedExternal(message) {
  const error = new Error(`BLOCKED_EXTERNAL: ${message}`)
  error.classification = 'BLOCKED_EXTERNAL'
  return error
}

export function defaultRunGh(args, options = {}) {
  const result = spawnSync('gh', args, {
    encoding: 'utf8',
    input: options.input,
    env: options.env ?? process.env,
  })
  if (result.error || result.status !== 0) {
    if (options.allowNotFound && /\b404\b|not found/i.test(`${result.stderr ?? ''}\n${result.stdout ?? ''}`)) {
      return null
    }
    throw blockedExternal(result.stderr || result.stdout || result.error?.message || 'GitHub CLI failed')
  }
  return result.stdout.trim()
}

function invokeGh(runGh, args, options = {}) {
  try {
    return runGh(args, options)
  } catch (error) {
    if (error?.classification === 'BLOCKED_EXTERNAL') throw error
    throw blockedExternal(error instanceof Error ? error.message : String(error))
  }
}

export function createProductionReopenTransport({ runGh = defaultRunGh } = {}) {
  return {
    runGh: (args, options = {}) => invokeGh(runGh, args, options),
    readManagedIssue: async (issueNumber, repo) => JSON.parse(invokeGh(runGh, [
      'issue', 'view', String(issueNumber), '--repo', repo,
      '--json', 'number,id,title,body,state,stateReason',
    ])),
    readPullRequest: async (prNumber, repo) => JSON.parse(invokeGh(runGh, [
      'pr', 'view', String(prNumber), '--repo', repo,
      '--json', 'number,state,isDraft,headRefOid,baseRefName,baseRefOid,statusCheckRollup',
    ])),
    readComment: async (repo, commentId) => JSON.parse(invokeGh(runGh, [
      'api', `repos/${repo}/issues/comments/${commentId}`,
    ])),
    readOptionalComment: async (repo, commentId) => {
      const response = invokeGh(runGh, [
        'api', `repos/${repo}/issues/comments/${commentId}`,
      ], { allowNotFound: true })
      return response === null ? null : JSON.parse(response)
    },
    readIssueComments: async (repo, issueNumber) => {
      const pages = JSON.parse(invokeGh(runGh, [
        'api', '--paginate', '--slurp',
        `repos/${repo}/issues/${issueNumber}/comments?per_page=100`,
      ]))
      if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
        throw blockedExternal('live Issue comment pagination is incomplete')
      }
      return pages.flat()
    },
    readFounderLoginsVariable: async (repo) => JSON.parse(invokeGh(runGh, [
      'api', `repos/${repo}/actions/variables/BEMOAT_FOUNDER_LOGINS`,
    ])),
  }
}
