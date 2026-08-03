import { randomBytes } from 'node:crypto'

import { runCommand } from '../../adapters/command-runner.mjs'
import { BOOTSTRAP_CONTRACT } from '../domain/task-bootstrap-authorization.mjs'

const LEASE_MARKER = '<!-- bemoat-mission-control-task-bootstrap-lease:v1 -->'

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

function workflowLeaseBody({ scope, requestId, status, leaseToken, issueNumber, observedBodySha256 = null }) {
  return [LEASE_MARKER, '```json', JSON.stringify({
    schema_version: 1,
    scope,
    issue_number: Number(issueNumber),
    request_id: requestId,
    status,
    ['token']: leaseToken,
    observed_body_sha256: observedBodySha256,
  }), '```', LEASE_MARKER.replace(':v1', ':end')].join('\n')
}

function parseLeaseComment(comment) {
  if (!String(comment?.body ?? '').includes(LEASE_MARKER)) return null
  const raw = String(comment.body).replace(LEASE_MARKER, '').replace(LEASE_MARKER.replace(':v1', ':end'), '').replace(/```json\s*|```/g, '').trim()
  try {
    const parsed = JSON.parse(raw)
    return parsed?.schema_version === 1 && parsed.status && parsed.scope && parsed.request_id && parsed.token
      ? { ...parsed, commentId: comment.id }
      : null
  } catch { return null }
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

  async function acquireLease({ issueNumber, requestId, scope, expectedBodySha256 = null }) {
    const comments = await getIssueComments(issueNumber)
    const events = comments.map(parseLeaseComment).filter((event) => event && event.scope === scope && Number(event.issue_number) === Number(issueNumber))
    const latestByRequest = new Map()
    for (const event of events) latestByRequest.set(`${event.request_id}:${event.scope}`, event)
    const heldByOther = [...latestByRequest.values()].find((event) => event.status === 'held' && event.request_id !== requestId)
    if (heldByOther) {
      const error = new Error('CAS_CONFLICT: another bootstrap writer holds the Issue lease')
      error.code = 'CAS_CONFLICT'
      throw error
    }
    const sameHeld = latestByRequest.get(`${requestId}:${scope}`)
    if (sameHeld?.status === 'held') return { ['token']: sameHeld.token, commentId: sameHeld.commentId }
    const leaseToken = `${scope}:${requestId}:${Date.now()}:${randomBytes(8).toString('hex')}`
    const comment = await postComment(issueNumber, workflowLeaseBody({ scope, requestId, status: 'held', leaseToken, issueNumber, observedBodySha256: expectedBodySha256 }))
    const reread = (await getIssueComments(issueNumber)).map(parseLeaseComment).filter((event) => event && event.scope === scope && Number(event.issue_number) === Number(issueNumber))
    const active = reread.filter((event) => event.status === 'held')
    if (active.length !== 1 || active[0].token !== leaseToken) {
      const error = new Error('CAS_CONFLICT: Issue-only lease winner could not be proven')
      error.code = 'CAS_CONFLICT'
      throw error
    }
    return { ['token']: leaseToken, commentId: comment.id }
  }

  async function releaseLease({ issueNumber, requestId, scope, lease }) {
    if (!lease?.token) return
    await postComment(issueNumber, workflowLeaseBody({ scope, requestId, status: 'released', leaseToken: lease.token, issueNumber }))
  }

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
    async getPolicy({ ref, path }) {
      const data = api(`repos/${repository}/contents/${path}?ref=${encodeURIComponent(ref)}`, { label: `policy ${path}` })
      const content = Buffer.from(String(data.content ?? '').replace(/\n/g, ''), 'base64').toString('utf8')
      const version = content.match(/(?:^|\n)version:\s*([0-9]+\.[0-9]+\.[0-9]+)/)?.[1] ?? null
      // The genesis policy tuple is pinned to the approved protected-base
      // commit while the file is read from the protected main ref. This keeps
      // the post-genesis workflow usable after main advances by the reviewed
      // genesis merge itself.
      return { path, version, blobSha: data.sha, sourceCommit: BOOTSTRAP_CONTRACT.protectedBaseSha, content }
    },
    async getFounderLogins() {
      return String(env.BEMOAT_FOUNDER_LOGINS ?? '').split(',').map((login) => login.trim()).filter(Boolean)
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
    async acquireCreationLease({ requestId }) {
      return acquireLease({ issueNumber: 262, requestId, scope: 'repository-task-creation' })
    },
    async releaseCreationLease({ requestId, lease }) {
      return releaseLease({ issueNumber: 262, requestId, scope: 'repository-task-creation', lease })
    },
    async acquireIssueLease({ issueNumber, requestId, scope = 'task-bootstrap-projection', expectedBodySha256 }) {
      return acquireLease({ issueNumber, requestId, scope, expectedBodySha256 })
    },
    async releaseIssueLease({ issueNumber, requestId, lease, scope = 'task-bootstrap-projection' }) {
      return releaseLease({ issueNumber, requestId, scope, lease })
    },
    async issueBodyLeaseStore({ issueNumber }) {
      const scope = 'task-bootstrap-projection'
      return {
        async read() {
          const events = (await getIssueComments(issueNumber)).map(parseLeaseComment).filter((event) => event && event.scope === scope && Number(event.issue_number) === Number(issueNumber))
          const event = events.at(-1)
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
            ? await acquireLease({ issueNumber, requestId, scope, expectedBodySha256: content.observed_body_sha256 })
            : await (async () => { await releaseLease({ issueNumber, requestId, scope, lease: { ['token']: requestId } }); return { ['token']: requestId } })()
          return { sha: lease.commentId ?? lease.token, content }
        },
      }
    },
  }
}

export { LEASE_MARKER }
