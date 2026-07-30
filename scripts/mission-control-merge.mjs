#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

import { analyzeExactHeadCi, normalizeStatusChecks, isCheckSuccessful } from './agent-issue/exact-head-ci.mjs'
import { parseMissionControlState } from './mission-control-state.mjs'

const STARTER_REPOSITORY = 'boat1994/bemoat-web-starter'

function stateConflict(message) {
  return new Error(`STATE_CONFLICT: ${message}`)
}

function blockedExternal(message) {
  return new Error(`BLOCKED_EXTERNAL: ${message}`)
}

function normalizeNumber(value) {
  const match = String(value ?? '').match(/#?(\d+)$/)
  return match ? Number(match[1]) : null
}

function parseJsonBlock(body = '') {
  const fenced = String(body).match(/```json\s*([\s\S]*?)```/i)?.[1]
  try {
    return JSON.parse(fenced ?? String(body).trim())
  } catch {
    throw stateConflict('Founder merge authorization comment does not contain valid JSON evidence')
  }
}

export function normalizePaginatedCommitMessages(pages) {
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
    throw blockedExternal('GitHub PR commit pagination did not return complete page arrays')
  }
  return pages.flat().map((entry) => {
    const message = String(entry?.commit?.message ?? '')
    const [messageHeadline = '', ...bodyLines] = message.split('\n')
    return { messageHeadline, messageBody: bodyLines.join('\n') }
  })
}

export function validateFounderMergeAuthorization({
  authorization,
  authorizationCommentId,
  issueNumber,
  prNumber,
  reviewedHead,
  trustedFounderLogins,
}) {
  if (!Array.isArray(trustedFounderLogins) || trustedFounderLogins.length === 0) {
    throw stateConflict('repository-owned Founder identity configuration is missing or empty')
  }
  const valid =
    authorization && typeof authorization === 'object' && !Array.isArray(authorization) &&
    authorization.schema_version === 1 &&
    authorization.authority === 'Founder' &&
    authorization.scope === 'merge' &&
    authorization.action === 'merge' &&
    normalizeNumber(authorization.task_issue) === issueNumber &&
    normalizeNumber(authorization.pr) === prNumber &&
    authorization.reviewed_head === reviewedHead &&
    String(authorization.comment_id) === String(authorizationCommentId)
  if (!valid) throw stateConflict('explicit Founder merge authorization does not bind the managed task, PR, reviewed head, and action')
  if (!trustedFounderLogins.includes(authorization.author_login)) {
    throw stateConflict('authorization comment author does not match repository-owned Founder identity configuration')
  }
  return true
}

function verifyRequiredExactHeadCi(pr, repo) {
  const analysis = analyzeExactHeadCi(pr)
  if (!analysis.exactHeadVerified) {
    throw stateConflict(`required exact-head CI is not successful: ${analysis.summary}`)
  }
  const checks = normalizeStatusChecks(pr.statusCheckRollup)
  const successfulNames = new Set(checks.filter(isCheckSuccessful).map((check) => check.name ?? check.context))
  const requiredChecks = repo === STARTER_REPOSITORY ? ['ci', 'starter-ci'] : ['ci']
  const missing = requiredChecks.filter((name) => !successfulNames.has(name))
  if (missing.length > 0) throw stateConflict(`required exact-head CI checks are missing or unsuccessful: ${missing.join(', ')}`)
}

function verifyDirectOwnership(issueNumber, issue, pr) {
  const state = issue?.managedState
  if (!state) throw stateConflict('managed Issue state is unavailable')
  if (normalizeNumber(state.active_task_issue) !== issueNumber) {
    throw stateConflict('merge transport may operate only on the directly managed task Issue')
  }
  const prNumber = normalizeNumber(state.active_pr)
  if (!prNumber) throw stateConflict('directly managed task has no active PR terminal ownership')
  if (pr?.number != null && normalizeNumber(pr.number) !== prNumber) {
    throw stateConflict('live PR does not match the managed task active PR')
  }
  return prNumber
}

function verifyHeadBindings(state, pr, authorization, repo) {
  const reviewedHead = state?.last_reviewed_head
  if (!state?.approved_base || pr.baseRefName !== state.approved_base) {
    throw stateConflict('live PR base differs from the managed protected base')
  }
  if (!reviewedHead || state.current_head !== reviewedHead || pr.headRefOid !== reviewedHead) {
    throw stateConflict('current, reviewed, and live PR heads must match exactly')
  }
  if (authorization.reviewed_head !== reviewedHead) {
    throw stateConflict('Founder authorization reviewed head differs from managed/live head')
  }
  verifyRequiredExactHeadCi(pr, repo)
  return reviewedHead
}

function verifyNoAutomaticClosure(pr, issueNumber, repo) {
  const linkedClosure = (pr.closingIssuesReferences ?? []).some((reference) =>
    normalizeNumber(reference.number) === issueNumber &&
    (reference.repository?.nameWithOwner ?? repo) === repo
  )
  const escapedRepo = repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const closingPattern = new RegExp(
    `\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s+(?:#${issueNumber}\\b|${escapedRepo}#${issueNumber}\\b|https://github\\.com/${escapedRepo}/issues/${issueNumber}\\b)`,
    'i',
  )
  const closingSources = [
    pr.title,
    pr.body,
    ...(pr.commits ?? []).flatMap((commit) => [commit.messageHeadline, commit.messageBody]),
  ]
  const closingKeyword = closingSources.some((source) => closingPattern.test(String(source ?? '')))
  if (linkedClosure || closingKeyword) {
    throw stateConflict('PR contains an automatic closing reference to the managed Issue; use Refs so merge transport remains the closure owner')
  }
}

function mergeCommitOid(pr, mergeResult) {
  return pr?.mergeCommit?.oid ?? pr?.mergeCommit?.sha ?? mergeResult?.mergeCommit?.oid ?? mergeResult?.mergeCommit?.sha ?? null
}

function normalizeIssueState(issue) {
  return String(issue?.state ?? '').toUpperCase()
}

function normalizeIssueReason(issue) {
  return String(issue?.stateReason ?? issue?.state_reason ?? '').toUpperCase()
}

export async function runFounderAuthorizedMerge({
  issueNumber,
  repo,
  authorizationCommentId,
  deps,
}) {
  if (!Number.isInteger(issueNumber) || issueNumber <= 0 || !repo || !/^[1-9]\d*$/.test(String(authorizationCommentId))) {
    throw stateConflict('task Issue, repository, and Founder authorization comment ID are required')
  }

  let issue = await deps.readManagedIssue(issueNumber, repo)
  const state = issue?.managedState
  const prNumber = normalizeNumber(state?.active_pr)
  if (!prNumber) throw stateConflict('directly managed task has no active PR terminal ownership')
  let pr = await deps.readPullRequest(prNumber, repo)
  verifyDirectOwnership(issueNumber, issue, pr)

  const authorization = await deps.readFounderAuthorization(repo, issueNumber, authorizationCommentId)
  const trustedFounderLogins = await deps.readTrustedFounderLogins(repo)
  validateFounderMergeAuthorization({
    authorization,
    authorizationCommentId,
    issueNumber,
    prNumber,
    reviewedHead: state.last_reviewed_head,
    trustedFounderLogins,
  })
  const reviewedHead = verifyHeadBindings(state, pr, authorization, repo)
  verifyNoAutomaticClosure(pr, issueNumber, repo)

  const alreadyDone = state.state === 'DONE'
  if (!alreadyDone && state.state !== 'ELIGIBLE_FOR_FOUNDER_REVIEW') {
    throw stateConflict(`managed task state ${state.state ?? 'unknown'} is not eligible for Founder-authorized merge`)
  }

  let mergeResult = null
  if (String(pr.state).toUpperCase() !== 'MERGED') {
    if (normalizeIssueState(issue) !== 'OPEN') throw stateConflict('an unmerged PR cannot belong to an already-closed managed Issue')
    if (String(pr.state).toUpperCase() !== 'OPEN' || pr.mergeable !== 'MERGEABLE') {
      throw stateConflict('PR must be open and mergeable before merge')
    }
    if (pr.isDraft) {
      await deps.markReadyForReview(prNumber, repo)
      pr = await deps.readPullRequest(prNumber, repo)
      verifyHeadBindings(state, pr, authorization, repo)
      verifyNoAutomaticClosure(pr, issueNumber, repo)
      if (pr.isDraft) throw stateConflict('Draft PR did not become ready for review')
    }
    mergeResult = await deps.mergePullRequest({ prNumber, repo, expectedHead: reviewedHead })
    pr = await deps.readPullRequest(prNumber, repo)
    if (pr.headRefOid !== reviewedHead || String(pr.state).toUpperCase() !== 'MERGED') {
      throw stateConflict('merge result does not preserve the authorized expected head')
    }
  }

  const commit = mergeCommitOid(pr, mergeResult)
  if (!commit) throw stateConflict('merged PR does not expose a merge commit')
  const onBase = await deps.verifyCommitOnProtectedBase({ repo, base: state.approved_base, commit })
  if (!onBase) throw stateConflict('verified merge commit has not reached the protected base')

  issue = await deps.readManagedIssue(issueNumber, repo)
  if (normalizeIssueState(issue) === 'OPEN') {
    await deps.closeIssueCompleted(issueNumber, repo)
    issue = await deps.readManagedIssue(issueNumber, repo)
  }
  if (normalizeIssueState(issue) !== 'CLOSED' || normalizeIssueReason(issue) !== 'COMPLETED') {
    throw stateConflict('managed task Issue was not closed as completed')
  }

  const first = await deps.reconcile(issueNumber, repo)
  if (first?.state?.state !== 'DONE') throw stateConflict('bounded reconciliation did not verify DONE')
  if (first.finalOutcome === 'NO_OP') {
    return { outcome: 'NO_OP', issueNumber, prNumber, reviewedHead, mergeCommit: commit }
  }

  const second = await deps.reconcile(issueNumber, repo)
  if (second?.finalOutcome !== 'NO_OP' || second?.state?.state !== 'DONE') {
    throw stateConflict('idempotent reconciliation rerun did not return NO_OP with DONE state')
  }
  return { outcome: 'DONE', issueNumber, prNumber, reviewedHead, mergeCommit: commit }
}

function runGh(args, options = {}) {
  const result = spawnSync('gh', args, { encoding: 'utf8', input: options.input, env: options.env ?? process.env })
  if (result.error || result.status !== 0) {
    throw blockedExternal(result.stderr || result.stdout || result.error?.message || 'GitHub CLI failed')
  }
  return result.stdout.trim()
}

function runNode(args, env = process.env) {
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', env })
  if (result.error || result.status !== 0) {
    throw new Error(result.stderr || result.stdout || result.error?.message || 'Mission Control reconciler failed')
  }
  return result.stdout.trim()
}

function parseArgs(argv) {
  const options = { issueNumber: null, repo: null, authorizationCommentId: null }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--') continue
    if (argument === '--repo' || argument === '--authorization-comment') {
      const value = argv[++index]
      if (!value) throw new Error(`${argument} requires a value`)
      if (argument === '--repo') options.repo = value
      else options.authorizationCommentId = value
      continue
    }
    if (argument.startsWith('-') || options.issueNumber) throw new Error(`unexpected argument: ${argument}`)
    options.issueNumber = Number(argument)
  }
  if (!Number.isInteger(options.issueNumber) || options.issueNumber <= 0 || !options.repo || !options.authorizationCommentId) {
    throw new Error('Usage: pnpm run bemoat:mission-control:merge -- <issue-number> --repo owner/repo --authorization-comment <id>')
  }
  return options
}

function createProductionDeps() {
  const readManagedIssue = async (issueNumber, repo) => {
    const issue = JSON.parse(runGh(['issue', 'view', String(issueNumber), '--repo', repo, '--json', 'body,state,stateReason']))
    const parsed = parseMissionControlState(issue.body)
    if (!parsed.present || !parsed.valid) throw stateConflict(`Issue has invalid managed state: ${parsed.reason ?? 'missing state block'}`)
    return { ...issue, managedState: parsed.state }
  }
  const readPullRequest = async (prNumber, repo) => {
    const pr = JSON.parse(runGh([
      'pr', 'view', String(prNumber), '--repo', repo,
      '--json', 'number,state,isDraft,mergeable,headRefOid,baseRefName,statusCheckRollup,mergeCommit,url,title,body,closingIssuesReferences',
    ]))
    const commitPages = JSON.parse(runGh([
      'api', '--paginate', '--slurp', `repos/${repo}/pulls/${prNumber}/commits?per_page=100`,
    ]))
    return { ...pr, commits: normalizePaginatedCommitMessages(commitPages) }
  }

  return {
    readManagedIssue,
    readPullRequest,
    readFounderAuthorization: async (repo, issueNumber, commentId) => {
      const comment = JSON.parse(runGh(['api', `repos/${repo}/issues/comments/${commentId}`]))
      const expectedIssueUrl = `https://api.github.com/repos/${repo}/issues/${issueNumber}`
      if (comment.issue_url !== expectedIssueUrl || !comment.user?.login) {
        throw stateConflict('Founder merge authorization comment is not bound to this Issue and an authenticated author')
      }
      return { ...parseJsonBlock(comment.body), comment_id: String(comment.id), author_login: comment.user.login }
    },
    readTrustedFounderLogins: async (repo) => {
      const variable = JSON.parse(runGh(['api', `repos/${repo}/actions/variables/BEMOAT_FOUNDER_LOGINS`]))
      const value = String(variable.value ?? '').trim()
      const logins = value.split(',').map((login) => login.trim()).filter(Boolean)
      if (logins.length === 0 || logins.some((login) => !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(login))) {
        throw stateConflict('repository Actions variable BEMOAT_FOUNDER_LOGINS must contain a comma-separated list of GitHub logins')
      }
      return logins
    },
    markReadyForReview: async (prNumber, repo) => { runGh(['pr', 'ready', String(prNumber), '--repo', repo]) },
    mergePullRequest: async ({ prNumber, repo, expectedHead }) => {
      runGh(['pr', 'merge', String(prNumber), '--repo', repo, '--merge', '--match-head-commit', expectedHead])
      return {}
    },
    verifyCommitOnProtectedBase: async ({ repo, base, commit }) => {
      const comparison = JSON.parse(runGh(['api', `repos/${repo}/compare/${commit}...${base}`]))
      return comparison.status === 'ahead' || comparison.status === 'identical'
    },
    closeIssueCompleted: async (issueNumber, repo) => {
      runGh(['issue', 'close', String(issueNumber), '--repo', repo, '--reason', 'completed'])
    },
    reconcile: async (issueNumber, repo) => {
      const stdout = runNode(
        ['scripts/mission-control-reconcile.mjs', String(issueNumber), '--repo', repo],
        { ...process.env, GH_REPO: repo },
      )
      const finalOutcome = stdout.match(/Mission Control reconciliation\s+(\S+):/)?.[1] ?? null
      const issue = await readManagedIssue(issueNumber, repo)
      return { finalOutcome, state: issue.managedState }
    },
  }
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2))
    const result = await runFounderAuthorizedMerge({ ...options, deps: createProductionDeps() })
    process.stdout.write(`Mission Control merge transport ${result.outcome}: PR #${result.prNumber} at ${result.reviewedHead} -> ${result.mergeCommit}; Issue #${result.issueNumber} DONE.\n`)
  } catch (error) {
    process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

if (process.argv[1]?.endsWith('/mission-control-merge.mjs')) main()
