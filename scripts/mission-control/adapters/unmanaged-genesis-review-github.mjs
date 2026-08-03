import { runCommand } from '../../adapters/command-runner.mjs'
import { UGR_CONTRACT } from '../domain/unmanaged-genesis-review.mjs'

function parseJson(value, label) {
  try { return JSON.parse(value) } catch (error) { throw externalError(`${label} returned invalid JSON`, error) }
}

function parsePaginatedJson(value, label) {
  const source = String(value ?? '').trim()
  if (!source) return []
  try {
    const one = JSON.parse(source)
    return Array.isArray(one) ? one : [one]
  } catch { /* gh --paginate emits one JSON value per page */ }
  const pages = []
  for (const line of source.split(/\n(?=\s*[\[{])/).map((entry) => entry.trim()).filter(Boolean)) {
    try { pages.push(JSON.parse(line)) } catch (error) { throw externalError(`${label} returned incomplete paginated JSON`, error) }
  }
  return pages.flatMap((page) => Array.isArray(page) ? page : [page])
}

function externalError(message, cause) {
  const error = new Error(message, cause ? { cause } : undefined)
  error.code = /404|not found/i.test(message) ? 'NOT_FOUND' : 'API_AMBIGUITY'
  return error
}

function issueState(value) { return String(value ?? '').toUpperCase() }

function issueFromRest(issue, repo) {
  const nodeId = String(issue.node_id ?? issue.id)
  return {
    number: Number(issue.number),
    id: nodeId,
    node_id: nodeId,
    url: issue.html_url ?? `https://github.com/${repo}/issues/${issue.number}`,
    state: issueState(issue.state),
    title: issue.title ?? '',
    body: issue.body ?? '',
    pull_request: issue.pull_request,
  }
}

function commentFromRest(comment, repo) {
  const issueNumber = String(comment.issue_url ?? '').match(/\/issues\/(\d+)$/)?.[1] ?? null
  return {
    id: Number(comment.id),
    node_id: comment.node_id ?? null,
    body: comment.body ?? '',
    user: comment.user ?? null,
    author: comment.user ?? null,
    issue_number: issueNumber ? Number(issueNumber) : null,
    issue_url: comment.issue_url ?? `https://github.com/${repo}/issues/${issueNumber ?? ''}`,
    created_at: comment.created_at ?? null,
    updated_at: comment.updated_at ?? null,
    performed_via_github_app: comment.performed_via_github_app ?? null,
  }
}

function pullRequestFromGraphql(pr) {
  return {
    number: Number(pr.number),
    id: String(pr.id),
    node_id: String(pr.id),
    url: pr.url,
    state: issueState(pr.state),
    isDraft: Boolean(pr.isDraft),
    baseRefName: pr.baseRefName,
    baseRefOid: pr.baseRefOid,
    headRefName: pr.headRefName,
    headRefOid: pr.headRefOid,
    statusCheckRollup: Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : [],
    commits: Array.isArray(pr.commits) ? pr.commits : [],
  }
}

/**
 * GitHub adapter for unmanaged-genesis review transport.
 * Issue-comment write only for Issue #262. No Issue-body, PR, or contents writes.
 * Hard-constrained to the Issue #262 / PR #266 tuple.
 */
export function createUnmanagedGenesisReviewGithubAdapter({ repository, env = process.env, runGh = null } = {}) {
  if (!repository) throw new Error('unmanaged-genesis review GitHub adapter requires repository')
  if (repository !== UGR_CONTRACT.repository) {
    const error = new Error('unmanaged-genesis review transport is not enabled for child repositories')
    error.code = 'BLOCKED_EXTERNAL'
    throw error
  }

  const gh = runGh ?? ((args, options = {}) => runCommand('gh', args, { env, ...options }))
  const api = (path, options = {}) => {
    const args = ['api']
    if (options.method) args.push('--method', options.method)
    if (options.paginate) args.push('--paginate')
    args.push(path)
    if (options.input != null) args.push('--input', '-')
    try {
      return parseJson(gh(args, { input: options.input }), options.label ?? path)
    } catch (error) {
      if (error.code === 'NOT_FOUND') throw error
      throw externalError(`${options.label ?? path} GitHub API request failed`, error)
    }
  }
  const apiPaginated = (path, label) => {
    try { return parsePaginatedJson(gh(['api', '--paginate', path], {}), label) } catch (error) {
      if (error.code === 'NOT_FOUND') throw error
      throw externalError(`${label} GitHub API request failed`, error)
    }
  }

  const assertIssue = (issueNumber) => {
    if (Number(issueNumber) !== UGR_CONTRACT.taskIssue) {
      const error = new Error('unmanaged-genesis review adapter may access only Issue #262')
      error.code = 'STATE_CONFLICT'
      throw error
    }
  }
  const assertPullRequest = (prNumber) => {
    if (Number(prNumber) !== UGR_CONTRACT.pullRequest) {
      const error = new Error('unmanaged-genesis review adapter may access only PR #266')
      error.code = 'STATE_CONFLICT'
      throw error
    }
  }

  return {
    async getRepository() {
      const raw = api(`repos/${repository}`, { label: 'repository' })
      return {
        nameWithOwner: repository,
        id: String(raw.id),
        node_id: String(raw.node_id ?? raw.id),
        defaultBranch: raw.default_branch ?? 'main',
      }
    },

    async getIssue(issueNumber) {
      assertIssue(issueNumber)
      return issueFromRest(api(`repos/${repository}/issues/${issueNumber}`, { label: `Issue #${issueNumber}` }), repository)
    },

    async getIssueComments(issueNumber) {
      assertIssue(issueNumber)
      return apiPaginated(`repos/${repository}/issues/${issueNumber}/comments?per_page=100`, `Issue #${issueNumber} comments`)
        .map((comment) => commentFromRest(comment, repository))
    },

    async getIssueComment(commentId) {
      const comment = commentFromRest(api(`repos/${repository}/issues/comments/${commentId}`, { label: `comment ${commentId}` }), repository)
      if (comment.issue_number != null && Number(comment.issue_number) !== UGR_CONTRACT.taskIssue) {
        const error = new Error('comment does not belong to Issue #262')
        error.code = 'STATE_CONFLICT'
        throw error
      }
      return comment
    },

    async getPullRequest(prNumber) {
      assertPullRequest(prNumber)
      const query = `
        query($owner: String!, $name: String!, $number: Int!) {
          repository(owner: $owner, name: $name) {
            pullRequest(number: $number) {
              number
              id
              url
              state
              isDraft
              baseRefName
              baseRefOid
              headRefName
              headRefOid
              commits(last: 100) {
                nodes { commit { oid messageHeadline } }
              }
              statusCheckRollup {
                __typename
                ... on CheckRun { name conclusion status databaseId }
                ... on StatusContext { context state }
              }
            }
          }
        }
      `
      const [owner, name] = repository.split('/')
      const raw = parseJson(gh([
        'api', 'graphql',
        '-f', `query=${query}`,
        '-F', `owner=${owner}`,
        '-F', `name=${name}`,
        '-F', `number=${prNumber}`,
      ], {}), `PR #${prNumber}`)
      const pr = raw?.data?.repository?.pullRequest
      if (!pr) throw externalError(`PR #${prNumber} was not returned`)
      return pullRequestFromGraphql({
        ...pr,
        commits: (pr.commits?.nodes ?? []).map((node) => ({
          oid: node.commit?.oid,
          messageHeadline: node.commit?.messageHeadline,
        })),
        statusCheckRollup: (pr.statusCheckRollup ?? []).map((check) => ({
          name: check.name ?? check.context,
          conclusion: check.conclusion ?? check.state,
          state: check.state ?? check.conclusion,
          id: check.databaseId ?? null,
        })),
      })
    },

    async getPullRequestDiff(prNumber, { base, head } = {}) {
      assertPullRequest(prNumber)
      if (!base || !head) throw externalError('diff requires base and head')
      const text = gh(['api', `repos/${repository}/compare/${base}...${head}`, '-H', 'Accept: application/vnd.github.v3.diff'], {})
      return String(text ?? '')
    },

    async postIssueComment(issueNumber, body) {
      assertIssue(issueNumber)
      return commentFromRest(api(`repos/${repository}/issues/${issueNumber}/comments`, {
        method: 'POST',
        input: JSON.stringify({ body }),
        label: `Issue #${issueNumber} comment`,
      }), repository)
    },

    async updateIssueBody() {
      const error = new Error('unmanaged-genesis review transport must never write Issue bodies')
      error.code = 'STATE_CONFLICT'
      throw error
    },
  }
}
