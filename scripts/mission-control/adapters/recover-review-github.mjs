import { spawnSync } from 'node:child_process'

import { parseMissionControlState } from '../domain/task-state.mjs'
import { writeIssueBodyWithLease } from '../workflows/issue-body-cas.mjs'

const GUIDE_PATH = 'docs/mission-control/mission-control-guide.md'
const RECOVERY_FACADE_PATH = 'scripts/mission-control-recover-review.mjs'
const RECOVERY_WORKFLOW_PATH = 'scripts/mission-control/workflows/recover-review.mjs'
const TRANSPORT_REGISTRY_PATH = 'scripts/mission-control/transport-registry.mjs'
const CHILD_OVERRIDE_PATH = '.bemoat/mission-control-overrides.md'

function blockedExternal(message) {
  return new Error(`BLOCKED_EXTERNAL: ${message}`)
}

function flattenPages(value) {
  return Array.isArray(value)
    ? value.flat(Infinity).filter((entry) => entry && typeof entry === 'object')
    : []
}

function parseGuideFrontmatter(content) {
  if (!content.startsWith('---\n')) return null
  const end = content.indexOf('\n---\n', 4)
  if (end === -1) return null
  const frontmatter = {}
  for (const line of content.slice(4, end).split('\n')) {
    const match = line.match(/^([a-z_]+):\s*(.+)$/)
    if (match) frontmatter[match[1]] = match[2].trim()
  }
  return frontmatter
}

function defaultRunGh(args, options = {}) {
  const result = spawnSync('gh', args, {
    encoding: 'utf8',
    input: options.input,
    env: options.env ?? process.env,
  })
  if (result.error || result.status !== 0) {
    if (
      options.allowNotFound &&
      /\b404\b|not found/i.test(`${result.stderr ?? ''}\n${result.stdout ?? ''}`)
    )
      return null
    throw blockedExternal(
      result.stderr || result.stdout || result.error?.message || 'GitHub CLI failed',
    )
  }
  return result.stdout.trim()
}

export function createProductionDeps({ runGh = defaultRunGh } = {}) {
  const readGitOutput = (args) => {
    const result = spawnSync('git', args, { cwd: process.cwd(), encoding: 'utf8' })
    if (result.error || result.status !== 0) {
      throw blockedExternal(
        result.stderr || result.stdout || result.error?.message || 'Git checkout inspection failed',
      )
    }
    return result.stdout.trim()
  }
  const readExecutingCheckout = async (_repo, trustedSha) => {
    const headSha = readGitOutput(['rev-parse', 'HEAD'])
    const ref = readGitOutput(['symbolic-ref', '--short', 'HEAD'])
    const status = readGitOutput(['status', '--porcelain', '--untracked-files=all'])
    const baseSha = readGitOutput(['merge-base', trustedSha, headSha])
    const implementationPaths = readGitOutput(['ls-tree', '-r', '--name-only', headSha])
      .split('\n')
      .filter(Boolean)
    return {
      ref,
      head_sha: headSha,
      base_sha: baseSha,
      ancestor_verified: baseSha === trustedSha,
      clean: status === '',
      implementation_paths: implementationPaths,
    }
  }
  const readFileAtRef = async (repo, path, ref, { optional = false } = {}) => {
    const raw = runGh(
      ['api', `repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`],
      optional ? { allowNotFound: true } : {},
    )
    if (!raw) return null
    const file = JSON.parse(raw)
    const content =
      file.encoding === 'base64'
        ? Buffer.from(String(file.content ?? '').replace(/\s/g, ''), 'base64').toString('utf8')
        : String(file.content ?? '')
    return { path: file.path ?? path, sha: file.sha, content }
  }
  const readManagedIssue = async (issueNumber, repo) => {
    const issue = JSON.parse(
      runGh([
        'issue',
        'view',
        String(issueNumber),
        '--repo',
        repo,
        '--json',
        'number,id,title,body,state,stateReason',
      ]),
    )
    const parsed = parseMissionControlState(issue.body)
    if (!parsed.present || !parsed.valid)
      throw new Error(
        `STATE_CONFLICT: Issue has invalid managed state: ${parsed.reason ?? 'missing state block'}`,
      )
    return { ...issue, managedState: parsed.state }
  }
  const readPullRequest = async (prNumber, repo) =>
    JSON.parse(
      runGh([
        'pr',
        'view',
        String(prNumber),
        '--repo',
        repo,
        '--json',
        'number,state,isDraft,headRefOid,baseRefName,baseRefOid,statusCheckRollup',
      ]),
    )
  const readIssueComments = async (repo, issueNumber) =>
    flattenPages(
      JSON.parse(
        runGh([
          'api',
          '--paginate',
          '--slurp',
          `repos/${repo}/issues/${issueNumber}/comments?per_page=100`,
        ]),
      ),
    )
  const readComment = async (repo, commentId) =>
    JSON.parse(runGh(['api', `repos/${repo}/issues/comments/${commentId}`]))
  const readExactHeadChecks = async (repo, _prNumber, head) => {
    const payload = JSON.parse(
      runGh(['api', `repos/${repo}/commits/${head}/check-runs?per_page=100`]),
    )
    const checks = Array.isArray(payload) ? payload : payload.check_runs
    return (Array.isArray(checks) ? checks : []).map((check) => ({
      id: check.id,
      name: check.name,
      context: check.name,
      conclusion: check.conclusion,
      head_sha: check.head_sha,
    }))
  }
  const readProtectedBase = async (repo, base) =>
    JSON.parse(runGh(['api', `repos/${repo}/git/ref/heads/${base}`])).object ?? {}
  const readPolicySource = async (repo, ref) => {
    const guide = JSON.parse(
      runGh(['api', `repos/${repo}/contents/${GUIDE_PATH}?ref=${encodeURIComponent(ref)}`]),
    )
    const guideContent =
      guide.encoding === 'base64'
        ? Buffer.from(String(guide.content ?? '').replace(/\s/g, ''), 'base64').toString('utf8')
        : String(guide.content ?? '')
    const [recoveryFacade, recoveryWorkflow, transportRegistry, childOverride] = await Promise.all([
      readFileAtRef(repo, RECOVERY_FACADE_PATH, ref),
      readFileAtRef(repo, RECOVERY_WORKFLOW_PATH, ref),
      readFileAtRef(repo, TRANSPORT_REGISTRY_PATH, ref),
      readFileAtRef(repo, CHILD_OVERRIDE_PATH, ref, { optional: true }),
    ])
    const frontmatter = parseGuideFrontmatter(guideContent)
    return {
      path: guide.path ?? GUIDE_PATH,
      sha: guide.sha,
      content: guideContent,
      source_commit: ref,
      version: frontmatter?.version,
      recovery_facade: recoveryFacade,
      recovery_workflow: recoveryWorkflow,
      transport_registry: transportRegistry,
      child_override: childOverride,
      executing_checkout: { ref: 'refs/heads/main', sha: ref, based_on_sha: ref },
    }
  }
  const postComment = async (repo, issueNumber, body) =>
    JSON.parse(
      runGh(
        ['api', '--method', 'POST', `repos/${repo}/issues/${issueNumber}/comments`, '--input', '-'],
        { input: JSON.stringify({ body }) },
      ),
    )
  const writeIssueBody = async ({
    repo,
    issueNumber,
    expectedBody,
    nextBody,
    transitionIdentity,
  }) =>
    writeIssueBodyWithLease({
      repo,
      issueNumber,
      expectedBody,
      nextBody,
      transitionIdentity,
      holder: 'mission-control-recover-review',
      repoFlag: repo,
      deps: { runGh },
    })
  return {
    readManagedIssue,
    readPullRequest,
    readIssueComments,
    readComment,
    readExactHeadChecks,
    readProtectedBase,
    readExecutingCheckout,
    readPolicySource,
    postComment,
    writeIssueBody,
  }
}

export { defaultRunGh }
