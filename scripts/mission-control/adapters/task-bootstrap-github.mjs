import { runCommand } from '../../adapters/command-runner.mjs'
import {
  LEASE_MARKER,
  createTaskBootstrapLeaseProtocol,
} from '../domain/task-bootstrap-lease.ts'

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

function isProtectedBootstrapWorkflow(env, repository) {
  return env?.GITHUB_ACTIONS === 'true' &&
    env.GITHUB_REPOSITORY === repository &&
    env.GITHUB_WORKFLOW === 'Mission Control Task Bootstrap' &&
    env.GITHUB_REF === 'refs/heads/main' &&
    /^[0-9a-f]{40}$/i.test(String(env.GITHUB_SHA ?? '')) &&
    /^[1-9]\d*$/.test(String(env.GITHUB_RUN_ID ?? ''))
}

function issueFromRest(issue, repo) {
  const nodeId = String(issue.node_id ?? issue.id)
  return {
    number: Number(issue.number),
    // GitHub CLI exposes the GraphQL node ID as `id`; use that same immutable
    // identity for REST reads so bootstrap and canonical readers share one
    // representation instead of mixing REST database IDs with node IDs.
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
    id: comment.id,
    body: comment.body ?? '',
    user: comment.user ?? null,
    author: comment.user ?? null,
    issue_number: issueNumber ? Number(issueNumber) : null,
    issue_url: comment.issue_url ?? `https://github.com/${repo}/issues/${issueNumber ?? ''}`,
    created_at: comment.created_at ?? null,
    updated_at: comment.updated_at ?? null,
  }
}

/**
 * GitHub REST/CLI adapter for the bootstrap workflow. It intentionally exposes
 * only Issue writes; the workflow does not receive Contents write access.
 */
export function createTaskBootstrapGithubAdapter({ repository, env = process.env, runGh = null } = {}) {
  if (!repository) throw new Error('task bootstrap GitHub adapter requires repository')
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
      const wrapped = externalError(`${options.label ?? path} GitHub API request failed`, error)
      throw wrapped
    }
  }
  const apiPaginated = (path, label) => {
    try { return parsePaginatedJson(gh(['api', '--paginate', path], {}), label) } catch (error) {
      if (error.code === 'NOT_FOUND') throw error
      throw externalError(`${label} GitHub API request failed`, error)
    }
  }

  const getIssueComments = async (issueNumber) => apiPaginated(`repos/${repository}/issues/${issueNumber}/comments?per_page=100`, `Issue #${issueNumber} comments`).map((comment) => commentFromRest(comment, repository))

  const postComment = async (issueNumber, body) => commentFromRest(api(`repos/${repository}/issues/${issueNumber}/comments`, { method: 'POST', input: JSON.stringify({ body }), label: `Issue #${issueNumber} comment` }), repository)
  const leaseProtocol = createTaskBootstrapLeaseProtocol({ readComments: getIssueComments, postComment })

  return {
    async getRepository() {
      const repo = api(`repos/${repository}`, { label: 'repository identity' })
      return { nameWithOwner: repo.full_name ?? repository, id: repo.id, node_id: repo.node_id, defaultBranch: repo.default_branch }
    },
    async getIssue(number) {
      const issue = api(`repos/${repository}/issues/${number}`, { label: `Issue #${number}` })
      if (issue.pull_request) throw externalError(`Issue #${number} is a pull request`)
      return issueFromRest(issue, repository)
    },
    async listIssues() {
      return apiPaginated(`repos/${repository}/issues?state=all&per_page=100`, 'Issue listing').map((issue) => issueFromRest(issue, repository))
    },
    getIssueComments,
    async getIssueComment(id) {
      const comment = api(`repos/${repository}/issues/comments/${id}`, { label: `Issue comment ${id}` })
      return commentFromRest(comment, repository)
    },
    async getPullRequest(number) {
      const rest = api(`repos/${repository}/pulls/${number}`, { label: `PR #${number} identity` })
      const output = gh(['pr', 'view', String(number), '--repo', repository, '--json', 'number,id,headRefOid,baseRefName,baseRefOid,headRefName,state,isDraft,statusCheckRollup,url'], {})
      const pr = parseJson(output, `PR #${number}`)
      return {
        number: Number(pr.number),
        id: String(rest.node_id ?? rest.id),
        node_id: String(rest.node_id ?? rest.id),
        url: pr.url,
        state: issueState(pr.state),
        isDraft: pr.isDraft === true,
        baseRefName: pr.baseRefName,
        baseRefOid: pr.baseRefOid,
        headRefName: pr.headRefName,
        headRefOid: pr.headRefOid,
        statusCheckRollup: pr.statusCheckRollup ?? [],
      }
    },
    async getBranchCommit(branch) {
      const ref = api(`repos/${repository}/git/ref/heads/${encodeURIComponent(branch)}`, { label: `${branch} protected ref` })
      return { sha: ref.object?.sha }
    },
    /** @param {{ ref: string, path: string, sourceCommit?: string }} options */
    async getPolicy({ ref, path, sourceCommit = null }) {
      const data = api(`repos/${repository}/contents/${path}?ref=${encodeURIComponent(ref)}`, { label: `policy ${path}` })
      const content = Buffer.from(String(data.content ?? '').replace(/\n/g, ''), 'base64').toString('utf8')
      const version = content.match(/(?:^|\n)version:\s*([0-9]+\.[0-9]+\.[0-9]+)/)?.[1] ?? null
      return { path, version, blobSha: data.sha, sourceCommit, content }
    },
    async getFounderLogins() {
      // The protected workflow injects this repository-owned variable into the
      // canonical bootstrap process. The workflow token cannot read Actions
      // variables through REST, so do not replace the trusted injection with a
      // second API read that is unavailable to that token. Arbitrary process
      // input is never accepted as Founder authority: non-workflow callers use
      // the existing repository REST read instead.
      const value = isProtectedBootstrapWorkflow(env, repository)
        ? String(env.BEMOAT_FOUNDER_LOGINS ?? '').trim()
        : String(api(`repos/${repository}/actions/variables/BEMOAT_FOUNDER_LOGINS`, { label: 'repository Founder allowlist' }).value ?? '').trim()
      const logins = value.split(',').map((login) => login.trim()).filter(Boolean)
      if (logins.length === 0 || logins.some((login) => !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(login))) {
        throw externalError('repository Actions variable BEMOAT_FOUNDER_LOGINS is invalid')
      }
      return logins
    },
    async getAuthenticatedUser() {
      const user = api('user', { label: 'authenticated GitHub actor' })
      return { login: user.login }
    },
    async createIssue({ title, body }) {
      const issue = api(`repos/${repository}/issues`, { method: 'POST', input: JSON.stringify({ title, body }), label: 'provisional Issue creation' })
      return issueFromRest(issue, repository)
    },
    async updateIssueBody(number, body) {
      const issue = api(`repos/${repository}/issues/${number}`, { method: 'PATCH', input: JSON.stringify({ body }), label: `Issue #${number} body projection` })
      return issueFromRest(issue, repository)
    },
    postIssueComment: postComment,
    async acquireCreationLease({ issueNumber, requestId }) {
      return leaseProtocol.acquireLease({ issueNumber, requestId, scope: 'repository-task-creation' })
    },
    async releaseCreationLease({ issueNumber, requestId, lease }) {
      return leaseProtocol.releaseLease({ issueNumber, requestId, scope: 'repository-task-creation', lease })
    },
    async acquireIssueLease({ issueNumber, requestId, scope = 'task-bootstrap-projection', expectedBodySha256 }) {
      return leaseProtocol.acquireLease({ issueNumber, requestId, scope, expectedBodySha256 })
    },
    async releaseIssueLease({ issueNumber, requestId, lease, scope = 'task-bootstrap-projection' }) {
      return leaseProtocol.releaseLease({ issueNumber, requestId, scope, lease })
    },
    async issueBodyLeaseStore({ issueNumber }) {
      const scope = 'task-bootstrap-projection'
      return {
        async read() {
          const event = await leaseProtocol.readLatestLease({ issueNumber, scope })
          if (!event) return null
          return {
            sha: String(event.commentId),
            content: {
              schema_version: 1,
              issue: String(issueNumber),
              transition_identity: event.request_id,
              observed_body_sha256: event.observed_body_sha256,
              holder: 'mission-control-task-bootstrap',
              status: event.status,
              updated_at: null,
            },
          }
        },
        async write({ content, sha }) {
          const current = await this.read({})
          if (sha && String(current?.sha) !== String(sha)) {
            const error = new Error('CAS_CONFLICT: Issue-only lease comment changed')
            error.code = 'CAS_CONFLICT'
            throw error
          }
          const requestId = content.transition_identity
          const lease = content.status === 'held'
            ? await leaseProtocol.acquireLease({ issueNumber, requestId, scope, expectedBodySha256: content.observed_body_sha256 })
            : await (async () => {
              const held = await leaseProtocol.readHeldLease({ issueNumber, requestId, scope })
              await leaseProtocol.releaseLease({ issueNumber, requestId, scope, lease: held })
              return { ['token']: held.token, commentId: held.commentId }
            })()
          return { sha: lease.commentId ?? lease.token, content }
        },
      }
    },
  }
}

export { LEASE_MARKER }
