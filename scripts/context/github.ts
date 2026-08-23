import { parseIssueBody, parseRoleEvidence } from './issue-parser.ts'
import type { ActivePullRequestEvidence, HeadVerificationEvidence, IssueEvidence, RepositoryEvidence, RoleEvidence } from './model.ts'
import { asString, json, repositoryEvidence, type ContextCommandRunner } from './runtime.ts'

export interface GithubEvidenceResult {
  repository: RepositoryEvidence
  issue: IssueEvidence | null
  comments: RoleEvidence[]
  activePrs: ActivePullRequestEvidence[]
  exactHead: HeadVerificationEvidence | null
  errors: string[]
}

function checkEvidence(statusChecks: unknown, requiredChecks: string[]): HeadVerificationEvidence['checks'] {
  const checks = Array.isArray(statusChecks) ? statusChecks : []
  const terminal = new Set(['SUCCESS', 'FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'SKIPPED', 'NEUTRAL'])
  const failedConclusions = new Set(['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'])
  const names = new Set<string>()
  let failed = false
  let pending = checks.length === 0
  for (const item of checks) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const name = asString(record.name) ?? asString(record.context)
    if (name) names.add(name)
    const state = String(record.conclusion ?? record.state ?? '').toUpperCase()
    if (!terminal.has(state)) pending = true
    if (failedConclusions.has(state)) failed = true
  }
  const missingRequired = requiredChecks.some((name) => !names.has(name))
  return {
    status: failed ? 'FAILURE' : pending || missingRequired ? 'PENDING' : 'SUCCESS',
    complete: !pending && !missingRequired,
    failed,
    pending: pending || missingRequired,
    required: requiredChecks.length > 0,
  }
}

export function readGithubEvidence({ cwd = process.cwd(), env = process.env, repo, issueNumber, branch, run }: {
  cwd?: string
  env?: NodeJS.ProcessEnv
  repo: string
  issueNumber: string
  branch: string | null
  run: ContextCommandRunner
}): GithubEvidenceResult {
  const errors: string[] = []
  const issueResult = json<Record<string, unknown>>(run, 'gh', ['issue', 'view', issueNumber, '--repo', repo, '--json', 'number,title,state,url,body,comments'], { cwd, env })
  const issuePayload = issueResult.value
  const issueParsed = parseIssueBody(typeof issuePayload?.body === 'string' ? issuePayload.body : '')
  const comments = Array.isArray(issuePayload?.comments) ? issuePayload.comments.map((comment) => {
    const record = comment as Record<string, unknown>
    return { id: (record.id as string | number | undefined) ?? '', body: String(record.body ?? ''), createdAt: String(record.createdAt ?? ''), url: String(record.url ?? '') }
  }) : []
  parseRoleEvidence(comments)
  const issue: IssueEvidence | null = issuePayload ? {
    number: String(issuePayload.number ?? issueNumber),
    title: String(issuePayload.title ?? ''),
    state: String(issuePayload.state ?? ''),
    url: String(issuePayload.url ?? `https://github.com/${repo}/issues/${issueNumber}`),
    objective: issueParsed.objective,
    scope: issueParsed.scope,
    acceptanceCriteria: issueParsed.acceptanceCriteria,
    dependencies: issueParsed.dependencies,
  } : null
  if (!issue) errors.push(`BLOCKED_EXTERNAL: Issue #${issueNumber} evidence is unavailable${issueResult.error ? ` (${issueResult.error})` : ''}`)

  const candidates = new Map<string, Record<string, unknown>>()
  const queries: string[][] = []
  if (branch) queries.push(['pr', 'list', '--repo', repo, '--state', 'open', '--head', branch, '--json', 'number,url,headRefName,closingIssuesReferences', '--limit', '100'])
  queries.push(['pr', 'list', '--repo', repo, '--state', 'open', '--search', `closes #${issueNumber} repo:${repo}`, '--json', 'number,url,headRefName,closingIssuesReferences', '--limit', '100'])
  for (const args of queries) {
    const result = json<unknown[]>(run, 'gh', args, { cwd, env })
    if (!result.value) {
      errors.push(`BLOCKED_EXTERNAL: active PR lookup is unavailable${result.error ? ` (${result.error})` : ''}`)
      continue
    }
    for (const value of result.value) {
      if (!value || typeof value !== 'object') continue
      const record = value as Record<string, unknown>
      const closesIssue = Array.isArray(record.closingIssuesReferences) && record.closingIssuesReferences.some((reference) => reference && typeof reference === 'object' && String((reference as Record<string, unknown>).number) === issueNumber)
      if (record.number != null && (closesIssue || record.headRefName === branch)) candidates.set(String(record.number), record)
    }
  }

  const protection = json<Record<string, unknown>>(run, 'gh', ['api', `repos/${repo}/branches/main/protection`], { cwd, env })
  const requiredChecks = Array.isArray(protection.value?.required_status_checks && (protection.value.required_status_checks as Record<string, unknown>).contexts)
    ? ((protection.value?.required_status_checks as Record<string, unknown>).contexts as unknown[]).map(String) : []
  const requiredApprovals = Number((protection.value?.required_pull_request_reviews as Record<string, unknown> | undefined)?.required_approving_review_count ?? 0) || 0
  if (!protection.value) errors.push(`BLOCKED_EXTERNAL: protected branch policy is unavailable${protection.error ? ` (${protection.error})` : ''}`)

  const activePrs: ActivePullRequestEvidence[] = []
  let exactHead: HeadVerificationEvidence | null = null
  for (const candidate of candidates.values()) {
    const number = String(candidate.number)
    const prResult = json<Record<string, unknown>>(run, 'gh', ['pr', 'view', number, '--repo', repo, '--json', 'number,state,isDraft,url,baseRefName,baseRefOid,headRefName,headRefOid,mergeCommit,reviews,statusCheckRollup'], { cwd, env })
    const pr = prResult.value
    if (!pr) {
      errors.push(`BLOCKED_EXTERNAL: PR #${number} evidence is unavailable${prResult.error ? ` (${prResult.error})` : ''}`)
      continue
    }
    const headSha = String(pr.headRefOid ?? '')
    const reviews = Array.isArray(pr.reviews) ? pr.reviews : []
    const approvedReview = reviews.find((review) => review && typeof review === 'object' && String((review as Record<string, unknown>).state ?? '').toUpperCase() === 'APPROVED') as Record<string, unknown> | undefined
    const verification: HeadVerificationEvidence = {
      exactHead: headSha,
      checks: checkEvidence(pr.statusCheckRollup, requiredChecks),
      reviews: { required: requiredApprovals > 0, approved: Boolean(approvedReview), exactHead: Boolean(approvedReview && String(approvedReview.commitId ?? approvedReview.commit_id ?? '') === headSha) },
      protection: { available: Boolean(protection.value), requiredChecks, requiredApprovals },
    }
    const active: ActivePullRequestEvidence = {
      number,
      state: String(pr.state ?? 'OPEN'),
      draft: Boolean(pr.isDraft),
      url: String(pr.url ?? `https://github.com/${repo}/pull/${number}`),
      baseBranch: String(pr.baseRefName ?? ''),
      baseSha: String(pr.baseRefOid ?? ''),
      headBranch: String(pr.headRefName ?? ''),
      headSha,
      merged: Boolean(pr.mergeCommit) || String(pr.state ?? '').toUpperCase() === 'MERGED',
    }
    activePrs.push(active)
    if (activePrs.length === 1) exactHead = verification
  }
  return { repository: repositoryEvidence(repo), issue, comments, activePrs, exactHead, errors: [...new Set(errors)] }
}
