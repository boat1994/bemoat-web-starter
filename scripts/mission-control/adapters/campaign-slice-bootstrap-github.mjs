import { randomBytes } from 'node:crypto'

import { runCommand } from '../../adapters/command-runner.mjs'
import { compareAndSwapIssueBody } from '../../mission-control-issue-body-cas.mjs'
import {
  CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT,
  CAMPAIGN_SLICE_BOOTSTRAP_REGISTRY_SCHEMA,
} from '../domain/campaign-slice-bootstrap-authorization.mjs'

const LEASE_MARKER = '<!-- bemoat-mission-control-campaign-slice-bootstrap-lease:v1 -->'

function parseJson(value, label) {
  try {
    return JSON.parse(value)
  } catch (error) {
    throw externalError(`${label} returned invalid JSON`, error)
  }
}

function parsePaginatedJson(value, label) {
  const source = String(value ?? '').trim()
  if (!source) return []
  try {
    const one = JSON.parse(source)
    return Array.isArray(one) ? one : [one]
  } catch {
    const pages = []
    for (const line of source.split(/\n(?=\s*[\[{])/).map((entry) => entry.trim()).filter(Boolean)) {
      try {
        pages.push(JSON.parse(line))
      } catch (error) {
        throw externalError(`${label} returned incomplete paginated JSON`, error)
      }
    }
    return pages.flatMap((page) => Array.isArray(page) ? page : [page])
  }
}

function externalError(message, cause) {
  const error = new Error(message, cause ? { cause } : undefined)
  error.code = /404|not found/i.test(message) ? 'NOT_FOUND' : 'API_AMBIGUITY'
  return error
}

function issueFromRest(issue, repository) {
  const nodeId = String(issue.node_id ?? issue.id)
  return {
    number: Number(issue.number),
    id: nodeId,
    node_id: nodeId,
    url: issue.html_url ?? `https://github.com/${repository}/issues/${issue.number}`,
    state: String(issue.state ?? '').toUpperCase(),
    title: issue.title ?? '',
    body: issue.body ?? '',
    pull_request: issue.pull_request,
  }
}

function commentFromRest(comment, repository) {
  const issueNumber = String(comment.issue_url ?? '').match(/\/issues\/(\d+)$/)?.[1] ?? null
  return {
    id: comment.id,
    body: comment.body ?? '',
    user: comment.user ?? null,
    author: comment.user ?? null,
    issue_number: issueNumber ? Number(issueNumber) : null,
    issue_url: comment.issue_url ?? `https://api.github.com/repos/${repository}/issues/${issueNumber ?? ''}`,
    created_at: comment.created_at ?? null,
    updated_at: comment.updated_at ?? null,
  }
}

function leaseBody({ scope, requestId, status, leaseToken, issueNumber, observedBodySha256 = null }) {
  return [
    LEASE_MARKER,
    '```json',
    JSON.stringify({
      schema_version: 1,
      scope,
      issue_number: Number(issueNumber),
      request_id: requestId,
      status,
      ['token']: leaseToken,
      observed_body_sha256: observedBodySha256,
    }),
    '```',
    LEASE_MARKER.replace(':v1', ':end'),
  ].join('\n')
}

function parseLease(comment) {
  if (!String(comment?.body ?? '').includes(LEASE_MARKER)) return null
  const raw = String(comment.body)
    .replace(LEASE_MARKER, '')
    .replace(LEASE_MARKER.replace(':v1', ':end'), '')
    .replace(/```json\s*|```/g, '')
    .trim()
  try {
    const parsed = JSON.parse(raw)
    return parsed?.schema_version === 1 &&
      parsed.scope &&
      parsed.issue_number &&
      parsed.request_id &&
      parsed.status &&
      parsed.token
      ? { ...parsed, commentId: comment.id }
      : null
  } catch {
    return null
  }
}

export function createCampaignSliceBootstrapGithubAdapter({
  repository,
  env = process.env,
  runGh = null,
} = {}) {
  if (!repository) throw new Error('campaign slice bootstrap GitHub adapter requires repository')
  const gh = runGh ?? ((args, options = {}) => runCommand('gh', args, { env, ...options }))
  const api = (path, options = {}) => {
    const args = ['api']
    if (options.method) args.push('--method', options.method)
    args.push(path)
    if (options.input != null) args.push('--input', '-')
    try {
      return parseJson(gh(args, { input: options.input }), options.label ?? path)
    } catch (error) {
      if (error.code === 'NOT_FOUND' || /404|not found/i.test(error.message ?? String(error))) {
        throw externalError(`404: ${options.label ?? path} was not found`, error)
      }
      throw externalError(`${options.label ?? path} GitHub API request failed`, error)
    }
  }
  const apiPaginated = (path, label) => {
    try {
      return parsePaginatedJson(gh(['api', '--paginate', path], {}), label)
    } catch (error) {
      if (error.code === 'NOT_FOUND') throw error
      throw externalError(`${label} GitHub API request failed`, error)
    }
  }

  const getIssueComments = async (issueNumber) =>
    apiPaginated(
      `repos/${repository}/issues/${issueNumber}/comments?per_page=100`,
      `Issue #${issueNumber} comments`,
    ).map((comment) => commentFromRest(comment, repository))

  const postComment = async (issueNumber, body) =>
    commentFromRest(
      api(
        `repos/${repository}/issues/${issueNumber}/comments`,
        {
          method: 'POST',
          input: JSON.stringify({ body }),
          label: `Issue #${issueNumber} comment`,
        },
      ),
      repository,
    )

  async function acquireLease({ issueNumber, requestId, scope, expectedBodySha256 = null }) {
    const comments = await getIssueComments(issueNumber)
    const events = comments
      .map(parseLease)
      .filter((event) => event && event.scope === scope && Number(event.issue_number) === Number(issueNumber))
    const latestByRequest = new Map()
    for (const event of events) latestByRequest.set(`${event.request_id}:${event.scope}`, event)
    const heldByOther = [...latestByRequest.values()].find(
      (event) => event.status === 'held' && event.request_id !== requestId,
    )
    if (heldByOther) {
      const error = new Error('CAS_CONFLICT: another campaign bootstrap writer holds the Issue lease')
      error.code = 'CAS_CONFLICT'
      throw error
    }
    const sameHeld = latestByRequest.get(`${requestId}:${scope}`)
    if (sameHeld?.status === 'held') return { ['token']: sameHeld.token, commentId: sameHeld.commentId }
    const leaseToken = `${scope}:${requestId}:${Date.now()}:${randomBytes(8).toString('hex')}`
    const comment = await postComment(
      issueNumber,
      leaseBody({
        scope,
        requestId,
        status: 'held',
        leaseToken,
        issueNumber,
        observedBodySha256: expectedBodySha256,
      }),
    )
    const reread = (await getIssueComments(issueNumber))
      .map(parseLease)
      .filter((event) => event && event.scope === scope && Number(event.issue_number) === Number(issueNumber))
    const active = reread.filter((event) => event.status === 'held')
    if (active.length !== 1 || active[0].token !== leaseToken) {
      const error = new Error('CAS_CONFLICT: campaign Issue lease winner could not be proven')
      error.code = 'CAS_CONFLICT'
      throw error
    }
    return { ['token']: leaseToken, commentId: comment.id }
  }

  async function releaseLease({ issueNumber, requestId, scope, lease }) {
    if (!lease?.token) return
    await postComment(
      issueNumber,
      leaseBody({
        scope,
        requestId,
        status: 'released',
        leaseToken: lease.token,
        issueNumber,
      }),
    )
  }

  const issueBodyLeaseStore = async ({ issueNumber }) => {
    const scope = 'campaign-slice-bootstrap-projection'
    return {
      async read() {
        const events = (await getIssueComments(issueNumber))
          .map(parseLease)
          .filter((event) => event && event.scope === scope && Number(event.issue_number) === Number(issueNumber))
        const event = events.at(-1)
        if (!event) return null
        return {
          sha: String(event.commentId),
          content: {
            schema_version: 1,
            issue: String(issueNumber),
            transition_identity: event.request_id,
            observed_body_sha256: event.observed_body_sha256,
            holder: 'mission-control-campaign-slice-bootstrap',
            status: event.status,
            updated_at: null,
          },
        }
      },
      async write({ content, sha }) {
        const current = await this.read({})
        if (sha && String(current?.sha) !== String(sha)) {
          const error = new Error('CAS_CONFLICT: campaign Issue lease comment changed')
          error.code = 'CAS_CONFLICT'
          throw error
        }
        const requestId = content.transition_identity
        const lease = content.status === 'held'
          ? await acquireLease({
            issueNumber,
            requestId,
            scope,
            expectedBodySha256: content.observed_body_sha256,
          })
          : await (async () => {
            await releaseLease({ issueNumber, requestId, scope, lease: { ['token']: requestId } })
            return { ['token']: requestId }
          })()
        return { sha: lease.commentId ?? lease.token, content }
      },
    }
  }

  return {
    async getRepository() {
      const repo = api(`repos/${repository}`, { label: 'repository identity' })
      return {
        nameWithOwner: repo.full_name ?? repository,
        id: String(repo.id),
        node_id: String(repo.node_id),
        defaultBranch: repo.default_branch,
      }
    },
    async getIssue(number) {
      const issue = api(`repos/${repository}/issues/${number}`, { label: `Issue #${number}` })
      if (issue.pull_request) throw externalError(`Issue #${number} is a pull request`)
      return issueFromRest(issue, repository)
    },
    async listIssues() {
      return apiPaginated(`repos/${repository}/issues?state=all&per_page=100`, 'Issue listing')
        .map((issue) => issueFromRest(issue, repository))
    },
    getIssueComments,
    async listIssueComments(issueNumber) {
      return getIssueComments(issueNumber)
    },
    async getIssueComment(id) {
      return commentFromRest(
        api(`repos/${repository}/issues/comments/${id}`, { label: `Issue comment ${id}` }),
        repository,
      )
    },
    async getChildRepositoryProvisioning() {
      const repo = api(`repos/${repository}`, { label: 'child repository provisioning' })
      let workflow = false
      try {
        api(
          `repos/${repository}/contents/.github/workflows/mission-control-campaign-slice-bootstrap.yml?ref=${encodeURIComponent(CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.protectedBaseRef)}`,
          { label: 'campaign slice bootstrap workflow provisioning' },
        )
        workflow = true
      } catch (error) {
        if (error.code !== 'NOT_FOUND') throw error
      }
      return { childRepository: Boolean(repo.full_name), workflow }
    },
    async getWorkflowPermissions() {
      const data = api(
        `repos/${repository}/contents/.github/workflows/mission-control-campaign-slice-bootstrap.yml?ref=${encodeURIComponent(CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.protectedBaseRef)}`,
        { label: 'campaign slice bootstrap workflow permissions' },
      )
      const workflow = Buffer.from(String(data.content ?? '').replace(/\n/g, ''), 'base64').toString('utf8')
      const permission = (name) =>
        workflow.match(new RegExp(`^\\s{2}${name}:\\s*(read|write|none)\\s*$`, 'm'))?.[1] ?? null
      return {
        issues: permission('issues'),
        contents: permission('contents'),
      }
    },
    async getTrustedFounderLogins() {
      return String(env.BEMOAT_FOUNDER_LOGINS ?? '')
        .split(',')
        .map((login) => login.trim())
        .filter(Boolean)
    },
    async getFounderLogins() {
      return this.getTrustedFounderLogins()
    },
    async getProtectedBase() {
      const ref = api(
        `repos/${repository}/git/ref/heads/${encodeURIComponent(CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.protectedBaseRef)}`,
        { label: 'protected main ref' },
      )
      return { ref: CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.protectedBaseRef, sha: ref.object?.sha }
    },
    async getBranchCommit(branch) {
      const ref = api(
        `repos/${repository}/git/ref/heads/${encodeURIComponent(branch)}`,
        { label: `${branch} protected ref` },
      )
      return { ref: branch, sha: ref.object?.sha }
    },
    async getPolicy({ ref, path }) {
      const data = api(
        `repos/${repository}/contents/${path}?ref=${encodeURIComponent(ref)}`,
        { label: `policy ${path}` },
      )
      const content = Buffer.from(String(data.content ?? '').replace(/\n/g, ''), 'base64').toString('utf8')
      const base = await this.getProtectedBase()
      const version = content.match(/(?:^|\n)version:\s*([0-9]+\.[0-9]+\.[0-9]+)/)?.[1] ?? null
      return {
        path,
        version,
        blobSha: data.sha,
        sourceCommit: base.sha,
        content,
      }
    },
    async getCampaignAuthorityEvidence() {
      const comments = await getIssueComments(CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.campaignIssueNumber)
      const base = await this.getProtectedBase()
      return {
        campaignExpansionAuthority: {
          comments,
          trustedFounderLogins: await this.getTrustedFounderLogins(),
          currentProtectedBaseSha: base.sha,
        },
      }
    },
    async createIssue({ title, body }) {
      return issueFromRest(
        api(
          `repos/${repository}/issues`,
          {
            method: 'POST',
            input: JSON.stringify({ title, body }),
            label: 'provisional Task Issue creation',
          },
        ),
        repository,
      )
    },
    async updateIssueBody(number, body) {
      return issueFromRest(
        api(
          `repos/${repository}/issues/${number}`,
          {
            method: 'PATCH',
            input: JSON.stringify({ body }),
            label: `Issue #${number} body projection`,
          },
        ),
        repository,
      )
    },
    async compareAndSwapIssueBody({ number, expectedBody, body, requestId }) {
      await compareAndSwapIssueBody({
        repo: repository,
        issueNumber: number,
        expectedBody,
        nextBody: body,
        transitionIdentity: requestId,
        holder: 'mission-control-campaign-slice-bootstrap',
        deps: {
          leaseStore: await issueBodyLeaseStore({ issueNumber: number }),
          readIssueBody: async () => (await this.getIssue(number)).body,
          writeIssueBody: async ({ body: nextBody }) => this.updateIssueBody(number, nextBody),
        },
      })
      return this.getIssue(number)
    },
    async bindCampaignSliceOwnership({ body, record }) {
      if (record?.algorithm !== 'Ed25519' ||
          record?.attestation_schema !== CAMPAIGN_SLICE_BOOTSTRAP_REGISTRY_SCHEMA) {
        throw Object.assign(new Error('unsigned campaign ownership registry record rejected'), {
          code: 'STATE_CONFLICT',
        })
      }
      return postComment(CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.campaignIssueNumber, body)
    },
    async writeOwnershipRegistry(input) {
      return this.bindCampaignSliceOwnership(input)
    },
    async getCampaignSliceOwnershipRecords() {
      return getIssueComments(CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.campaignIssueNumber)
    },
    async acquireCampaignLease({ requestId }) {
      return acquireLease({
        issueNumber: CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.campaignIssueNumber,
        requestId,
        scope: 'campaign-slice-bootstrap',
      })
    },
    async releaseCampaignLease({ requestId, lease }) {
      return releaseLease({
        issueNumber: CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.campaignIssueNumber,
        requestId,
        scope: 'campaign-slice-bootstrap',
        lease,
      })
    },
    async acquireIssueLease({ issueNumber, requestId, scope, expectedBodySha256 }) {
      return acquireLease({ issueNumber, requestId, scope, expectedBodySha256 })
    },
    async releaseIssueLease({ issueNumber, requestId, scope, lease }) {
      return releaseLease({ issueNumber, requestId, scope, lease })
    },
    issueBodyLeaseStore,
    postIssueComment: postComment,
  }
}

export { LEASE_MARKER }
