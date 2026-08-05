import { createHash } from 'node:crypto'

import { runCommand } from '../../adapters/command-runner.mjs'
import {
  compareAndSwapIssueBody,
  createGhContentsLeaseStore,
  hashIssueBody,
  leasePathForIssue,
} from '../../mission-control-issue-body-cas.mjs'
import {
  CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT,
  CAMPAIGN_SLICE_BOOTSTRAP_REGISTRY_SCHEMA,
} from '../domain/campaign-slice-bootstrap-authorization.mjs'
import { normalizeImmutableCommentId } from '../domain/campaign-slice-bootstrap-request.mjs'

const OPERATION_LEASE_PATH =
  `.bemoat/mission-control/leases/campaign-slice-bootstrap-${CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.campaignIssueNumber}-${CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.sliceId}.json`

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
    id: normalizeImmutableCommentId(comment.id) ?? comment.id,
    body: comment.body ?? '',
    user: comment.user ?? null,
    author: comment.user ?? null,
    issue_number: issueNumber ? Number(issueNumber) : null,
    issue_url: comment.issue_url ?? `https://api.github.com/repos/${repository}/issues/${issueNumber ?? ''}`,
    created_at: comment.created_at ?? null,
    updated_at: comment.updated_at ?? null,
  }
}

export function createCampaignSliceBootstrapGithubAdapter({
  repository,
  env = process.env,
  runGh = null,
  leaseStore = null,
} = {}) {
  if (!repository) throw new Error('campaign slice bootstrap GitHub adapter requires repository')
  const gh = runGh ?? ((args, options = {}) => runCommand('gh', args, { env, ...options }))
  const contentsLeaseStore = leaseStore ?? createGhContentsLeaseStore({ runGh: gh })
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

  const patchIssueBody = async (number, body) =>
    issueFromRest(
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

  async function acquireContentsFence({ path, requestId, observedBodySha256 = null }) {
    const existing = await contentsLeaseStore.read({ repo: repository, path })
    const identityKey = String(requestId)
    const sameIdentity = Boolean(
      existing?.content &&
      existing.content.transition_identity === identityKey,
    )
    const heldByOther = Boolean(
      existing?.content &&
      existing.content.status === 'held' &&
      !sameIdentity,
    )
    if (heldByOther) {
      const error = new Error('CAS_CONFLICT: another campaign bootstrap writer holds the repository lease')
      error.code = 'CAS_CONFLICT'
      throw error
    }
    if (existing?.content?.status === 'held' && sameIdentity) {
      return {
        ['token']: identityKey,
        path,
        sha: existing.sha,
        adopted: true,
      }
    }
    const content = {
      schema_version: 1,
      issue: String(CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.campaignIssueNumber),
      transition_identity: identityKey,
      observed_body_sha256: observedBodySha256,
      holder: 'mission-control-campaign-slice-bootstrap',
      status: 'held',
      updated_at: new Date().toISOString(),
    }
    try {
      const written = await contentsLeaseStore.write({
        repo: repository,
        path,
        content,
        sha: existing?.sha,
      })
      return {
        ['token']: identityKey,
        path,
        sha: written?.sha ?? null,
        adopted: false,
      }
    } catch (error) {
      if (error?.code === 'CAS_CONFLICT' || /CAS_CONFLICT|409|422/i.test(error?.message ?? '')) {
        const conflict = new Error('CAS_CONFLICT: campaign bootstrap repository lease winner could not be proven')
        conflict.code = 'CAS_CONFLICT'
        conflict.cause = error
        throw conflict
      }
      throw error
    }
  }

  async function releaseContentsFence({ path, lease }) {
    if (!lease?.token || !path) return
    const current = await contentsLeaseStore.read({ repo: repository, path })
    if (!current?.content || current.content.status !== 'held') return
    if (current.content.transition_identity !== lease.token) return
    await contentsLeaseStore.write({
      repo: repository,
      path,
      content: {
        ...current.content,
        status: 'released',
        updated_at: new Date().toISOString(),
      },
      sha: current.sha,
    })
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
      // Policy blob identity is authoritative; sourceCommit is the ref tip used to read it
      // and may advance beyond the historical planning baseline after merge.
      const tip = await this.getBranchCommit(ref)
      const version = content.match(/(?:^|\n)version:\s*([0-9]+\.[0-9]+\.[0-9]+)/)?.[1] ?? null
      return {
        path,
        version,
        blobSha: data.sha,
        sourceCommit: tip.sha,
        content,
      }
    },
    async getCampaignAuthorityEvidence({ planningBaselineSha = null, protectedBaseSha = null } = {}) {
      const comments = await getIssueComments(CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.campaignIssueNumber)
      const base = await this.getProtectedBase()
      // Expansion-authority currency is evaluated against the historical planning
      // baseline. The live protected execution tip is bound separately and may
      // advance after this transport merges.
      return {
        campaignExpansionAuthority: {
          comments,
          trustedFounderLogins: await this.getTrustedFounderLogins(),
          currentProtectedBaseSha: planningBaselineSha ?? protectedBaseSha ?? base.sha,
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
    /**
     * Low-level Issue PATCH used only as the write callback inside expected-body CAS.
     * Callers must not use this to bypass compareAndSwapIssueBody.
     */
    async updateIssueBody(number, body) {
      return patchIssueBody(number, body)
    },
    async compareAndSwapIssueBody({ number, expectedBody, body, requestId }) {
      if (typeof expectedBody !== 'string') {
        throw Object.assign(new Error('compareAndSwapIssueBody requires expectedBody'), {
          code: 'STATE_CONFLICT',
        })
      }
      await compareAndSwapIssueBody({
        repo: repository,
        issueNumber: number,
        expectedBody,
        nextBody: body,
        transitionIdentity: requestId,
        holder: 'mission-control-campaign-slice-bootstrap',
        deps: {
          leaseStore: contentsLeaseStore,
          readIssueBody: async () => (await this.getIssue(number)).body,
          writeIssueBody: async ({ body: nextBody }) => {
            await patchIssueBody(number, nextBody)
          },
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
      return acquireContentsFence({
        path: OPERATION_LEASE_PATH,
        requestId,
        observedBodySha256: hashIssueBody(requestId),
      })
    },
    async releaseCampaignLease({ requestId, lease }) {
      return releaseContentsFence({
        path: lease?.path ?? OPERATION_LEASE_PATH,
        lease: lease ?? { ['token']: requestId },
      })
    },
    async acquireIssueLease({ issueNumber, requestId, expectedBodySha256 }) {
      return acquireContentsFence({
        path: leasePathForIssue(issueNumber),
        requestId,
        observedBodySha256: expectedBodySha256 ?? createHash('sha256').update(String(requestId)).digest('hex'),
      })
    },
    async releaseIssueLease({ issueNumber, requestId, lease }) {
      return releaseContentsFence({
        path: lease?.path ?? leasePathForIssue(issueNumber),
        lease: lease ?? { ['token']: requestId },
      })
    },
    issueBodyLeaseStore: contentsLeaseStore,
    postIssueComment: postComment,
  }
}

export { OPERATION_LEASE_PATH }
