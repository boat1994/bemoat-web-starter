import { parseIssueBody } from './issue-parser.ts'
import type {
  ActivePullRequestEvidence,
  HeadVerificationEvidence,
  IssueEvidence,
  NativeReviewEvidence,
  ProtectionEvidence,
  RepositoryEvidence,
  RoleEvidence,
} from './model.ts'
import {
  asString,
  isFullSha,
  isPositiveInteger,
  isRepositoryObjectUrl,
  repositoryEvidence,
  type ContextCommandRunner,
} from './runtime.ts'
export interface GithubEvidenceResult {
  repository: RepositoryEvidence
  issue: IssueEvidence | null
  comments: RoleEvidence[]
  activePrs: ActivePullRequestEvidence[]
  exactHead: HeadVerificationEvidence | null
  protection: ProtectionEvidence
  errors: string[]
}

interface JsonResult<T> {
  value: T | null
  error: string | null
}
function readJson<T>(
  run: ContextCommandRunner,
  command: string,
  args: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv },
): JsonResult<T> {
  const result = run(command, args, options)
  if (result.status !== 0 || result.error) {
    return {
      value: null,
      error: result.error?.message || result.stderr.trim() || result.stdout.trim() || `${command} returned no evidence`,
    }
  }
  const text = result.stdout.trim()
  if (!text) return { value: null, error: `${command} returned no evidence` }
  try {
    return { value: JSON.parse(text) as T, error: null }
  } catch (error) {
    return { value: null, error: `${command} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '').map((entry) => entry.trim())
    : []
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : typeof value === 'string' && /^\d+$/.test(value.trim())
      ? Number(value)
      : 0
}

function requiredChecksFromLegacy(value: Record<string, unknown>): string[] {
  const required = value.required_status_checks
  if (!isRecord(required)) return []
  return stringArray(required.contexts ?? required.checks)
}

function requiredApprovalsFromLegacy(value: Record<string, unknown>): number {
  const reviews = value.required_pull_request_reviews
  return isRecord(reviews) ? numberValue(reviews.required_approving_review_count) : 0
}

function rulesetTargetsBranch(ruleset: Record<string, unknown>, baseBranch: string): boolean {
  const target = asString(ruleset.target)
  if (target && target !== 'branch') return false
  const conditions = ruleset.conditions
  if (!isRecord(conditions) || !isRecord(conditions.ref_name)) return true
  const include = stringArray(conditions.ref_name.include)
  if (include.length === 0) return true
  return include.some((pattern) => pattern === '~DEFAULT_BRANCH' || pattern === baseBranch || pattern === `refs/heads/${baseBranch}`)
}

function rulesetRules(ruleset: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(ruleset.rules) ? ruleset.rules.filter(isRecord) : []
}

function requiredRulesetRequirements(rulesets: Record<string, unknown>[]): { requiredChecks: string[]; requiredApprovals: number } {
  const requiredChecks = new Set<string>()
  let requiredApprovals = 0
  for (const ruleset of rulesets) {
    for (const rule of rulesetRules(ruleset)) {
      const type = asString(rule.type)
      const parameters = isRecord(rule.parameters) ? rule.parameters : {}
      if (type === 'required_status_checks' || type === 'required_status_check') {
        const checks = parameters.required_status_checks
        if (Array.isArray(checks)) {
          for (const check of checks) {
            if (typeof check === 'string' && check.trim()) requiredChecks.add(check.trim())
            else if (isRecord(check) && asString(check.context)) requiredChecks.add(asString(check.context) as string)
          }
        }
      }
      if (type === 'pull_request' || type === 'required_pull_request_reviews') {
        requiredApprovals = Math.max(requiredApprovals, numberValue(parameters.required_approving_review_count))
      }
    }
  }
  return { requiredChecks: [...requiredChecks].sort(), requiredApprovals }
}

function readNativeProtection({
  repo,
  baseBranch,
  run,
  cwd,
  env,
}: {
  repo: string
  baseBranch: string
  run: ContextCommandRunner
  cwd: string
  env: NodeJS.ProcessEnv
}): { available: boolean; requiredChecks: string[]; requiredApprovals: number; error: string | null } {
  const listed = readJson<unknown>(run, 'gh', ['api', `repos/${repo}/rulesets?includes_parents=true`], { cwd, env })
  if (!listed.value) return { available: false, requiredChecks: [], requiredApprovals: 0, error: listed.error }
  const entries = Array.isArray(listed.value)
    ? listed.value.filter(isRecord)
    : isRecord(listed.value) && Array.isArray(listed.value.rulesets)
      ? listed.value.rulesets.filter(isRecord)
      : []
  const active: Record<string, unknown>[] = []
  const details: Record<string, unknown>[] = []
  for (const entry of entries) {
    if (asString(entry.enforcement)?.toLowerCase() !== 'active' || !rulesetTargetsBranch(entry, baseBranch)) continue
    active.push(entry)
    const id = entry.id
    if (Array.isArray(entry.rules)) continue
    if (typeof id !== 'number' && typeof id !== 'string') continue
    const detail = readJson<Record<string, unknown>>(run, 'gh', ['api', `repos/${repo}/rulesets/${id}`], { cwd, env })
    if (detail.error) return { available: false, requiredChecks: [], requiredApprovals: 0, error: detail.error }
    if (detail.value && isRecord(detail.value)) details.push(detail.value)
  }
  const requirements = requiredRulesetRequirements([...active, ...details])
  return {
    available: active.length > 0,
    requiredChecks: requirements.requiredChecks,
    requiredApprovals: requirements.requiredApprovals,
    error: active.length > 0 ? null : 'no active native ruleset applies to the protected base',
  }
}

function checkEvidence(statusChecks: unknown, requiredChecks: string[]): HeadVerificationEvidence['checks'] {
  const checks = Array.isArray(statusChecks) ? statusChecks : []
  const terminal = new Set(['SUCCESS', 'FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'SKIPPED', 'NEUTRAL'])
  const failedConclusions = new Set(['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'])
  const names = new Set<string>()
  let failed = false
  let pending = requiredChecks.length > 0 && checks.length === 0
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
function reviewEvidence(value: unknown): NativeReviewEvidence {
  const record = isRecord(value) ? value : {}, rawId = record.id ?? record.databaseId ?? record.database_id ?? record.node_id
  const id = typeof rawId === 'string' || (typeof rawId === 'number' && Number.isSafeInteger(rawId)) ? rawId : null
  const state = typeof record.state === 'string' ? record.state : '', body = typeof record.body === 'string' ? record.body : '', rawCommitId = record.commitId ?? record.commit_id ?? (isRecord(record.commit) ? record.commit.oid : null)
  const commitId = typeof rawCommitId === 'string' && rawCommitId.trim() ? rawCommitId : null
  return { id, state, body, commitId }
}
function reviewCounts(reviews: unknown[], headSha: string): { approvedCount: number; exactHeadApprovedCount: number; nativeReviews: NativeReviewEvidence[] } {
  const latest = new Map<string, { approved: boolean; exactHead: boolean }>()
  reviews.forEach((value, index) => {
    if (!isRecord(value)) return
    const identity = asString(isRecord(value.user) ? value.user.login : null) ??
      asString(isRecord(value.author) ? value.author.login : null) ??
      asString(value.authorLogin) ?? `review-${index}`
    const state = String(value.state ?? '').toUpperCase()
    const commitId = String(value.commitId ?? value.commit_id ?? (isRecord(value.commit) ? value.commit.oid : ''))
    latest.set(identity, { approved: state === 'APPROVED', exactHead: state === 'APPROVED' && commitId === headSha })
  })
  const current = [...latest.values()].filter((review) => review.approved)
  return { approvedCount: current.length, exactHeadApprovedCount: current.filter((review) => review.exactHead).length, nativeReviews: reviews.map((value) => reviewEvidence(value)) }
}
function issueBound(record: Record<string, unknown>, repo: string, issueNumber: string): boolean {
  const refs = record.closingIssuesReferences
  if (Array.isArray(refs) && refs.some((reference) => {
    if (!isRecord(reference) || String(reference.number ?? '') !== issueNumber) return false
    const referenceRepo = isRecord(reference.repository) ? asString(reference.repository.nameWithOwner) : null
    return !referenceRepo || referenceRepo === repo
  })) return true
  const body = `${String(record.title ?? '')}\n${String(record.body ?? '')}`
  const escapedRepo = repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const relation = new RegExp(`(?:part of|refs?|references|related to|closes|fix(?:es)?|resolves|task\\s*[/:-]?\\s*issue|issue)\\s*(?:${escapedRepo})?\\s*#${issueNumber}\\b`, 'i')
  return relation.test(body)
}

function candidateNumber(value: unknown): string | null {
  if (!isPositiveInteger(value)) return null
  return String(value)
}

export function readGithubEvidence({
  cwd = process.cwd(),
  env = process.env,
  repo,
  issueNumber,
  branch: _branch,
  protectedBaseBranch = 'main',
  protectedBaseSha = null,
  run,
}: {
  cwd?: string
  env?: NodeJS.ProcessEnv
  repo: string
  issueNumber: string
  branch: string | null
  protectedBaseBranch?: string
  protectedBaseSha?: string | null
  run: ContextCommandRunner
}): GithubEvidenceResult {
  const errors: string[] = []
  const issueResult = readJson<Record<string, unknown>>(run, 'gh', ['issue', 'view', issueNumber, '--repo', repo, '--json', 'number,title,state,url,body,comments'], { cwd, env })
  const issuePayload = issueResult.value
  const comments: RoleEvidence[] = Array.isArray(issuePayload?.comments) ? issuePayload.comments.filter(isRecord).map((comment) => ({
    id: (comment.id as string | number | undefined) ?? '',
    body: String(comment.body ?? ''),
    createdAt: String(comment.createdAt ?? ''),
    url: String(comment.url ?? ''),
  })) : []

  let issue: IssueEvidence | null = null
  if (!issuePayload) {
    errors.push(`BLOCKED_EXTERNAL: Issue #${issueNumber} evidence is unavailable${issueResult.error ? ` (${issueResult.error})` : ''}`)
  } else {
    const number = candidateNumber(issuePayload.number)
    const title = asString(issuePayload.title)
    const state = asString(issuePayload.state)
    const url = asString(issuePayload.url)
    if (!number || number !== issueNumber || !title || !state || !isRepositoryObjectUrl(url, repo, 'issues', issueNumber)) {
      errors.push('EVIDENCE_CONFLICT: Issue identity fields are missing or malformed')
    } else {
      const parsed = parseIssueBody(typeof issuePayload.body === 'string' ? issuePayload.body : '')
      issue = {
        number,
        title,
        state,
        url,
        objective: parsed.objective,
        scope: parsed.scope,
        acceptanceCriteria: parsed.acceptanceCriteria,
        dependencies: parsed.dependencies,
        taskSize: parsed.taskSize, missionControlMode: parsed.missionControlMode, workflowProfile: parsed.workflowProfile,
      }
    }
  }

  const candidates = new Map<string, Record<string, unknown>>()
  const queryArgs: string[][] = [
    ['pr', 'list', '--repo', repo, '--state', 'all', '--search', `repo:${repo} #${issueNumber}`, '--json', 'number,url,headRefName,body,title,closingIssuesReferences', '--limit', '100'],
    ['pr', 'list', '--repo', repo, '--state', 'all', '--json', 'number,url,headRefName,body,title,closingIssuesReferences', '--limit', '100'],
  ]
  let successfulList = false
  for (const args of queryArgs) {
    const result = readJson<unknown[]>(run, 'gh', args, { cwd, env })
    if (!Array.isArray(result.value)) continue
    successfulList = true
    for (const value of result.value) {
      if (!isRecord(value) || !issueBound(value, repo, issueNumber)) continue
      const number = candidateNumber(value.number)
      if (!number) {
        errors.push('EVIDENCE_CONFLICT: Issue-bound PR identity is missing or malformed')
        continue
      }
      candidates.set(number, value)
    }
  }
  if (!successfulList) errors.push('BLOCKED_EXTERNAL: active PR lookup is unavailable')

  const legacy = readJson<Record<string, unknown>>(run, 'gh', ['api', `repos/${repo}/branches/${protectedBaseBranch}/protection`], { cwd, env })
  let protection: ProtectionEvidence
  if (isRecord(legacy.value)) {
    protection = {
      available: true,
      source: 'legacy',
      requiredChecks: requiredChecksFromLegacy(legacy.value),
      requiredApprovals: requiredApprovalsFromLegacy(legacy.value),
    }
  } else {
    const native = readNativeProtection({ repo, baseBranch: protectedBaseBranch, run, cwd, env })
    protection = {
      available: native.available,
      source: native.available ? 'native' : 'unavailable',
      requiredChecks: native.requiredChecks,
      requiredApprovals: native.requiredApprovals,
    }
    if (!native.available) {
      errors.push(`BLOCKED_EXTERNAL: required native protection evidence is unavailable${native.error ? ` (${native.error})` : ''}`)
    }
  }

  const activePrs: ActivePullRequestEvidence[] = []
  const verifications: HeadVerificationEvidence[] = []
  for (const candidate of candidates.values()) {
    const number = candidateNumber(candidate.number) as string
    const prResult = readJson<Record<string, unknown>>(run, 'gh', ['pr', 'view', number, '--repo', repo, '--json', 'number,state,isDraft,url,baseRefName,baseRefOid,headRefName,headRefOid,mergeCommit,reviews,statusCheckRollup'], { cwd, env })
    const pr = prResult.value
    if (!pr) {
      errors.push(`BLOCKED_EXTERNAL: PR #${number} evidence is unavailable${prResult.error ? ` (${prResult.error})` : ''}`)
      continue
    }
    const prNumber = candidateNumber(pr.number)
    const state = asString(pr.state)
    const url = asString(pr.url)
    const baseBranch = asString(pr.baseRefName)
    const baseSha = asString(pr.baseRefOid)
    const headBranch = asString(pr.headRefName)
    const headSha = asString(pr.headRefOid)
    const mergeCommitSha = isRecord(pr.mergeCommit) ? asString(pr.mergeCommit.oid) ?? asString(pr.mergeCommit.sha) : null
    if (!prNumber || prNumber !== number || !state || !url || !isRepositoryObjectUrl(url, repo, 'pull', number) || !baseBranch || !isFullSha(baseSha) || !headBranch || !isFullSha(headSha)) {
      errors.push(`EVIDENCE_CONFLICT: PR #${number} identity fields are missing or malformed`)
      continue
    }
    const normalizedState = state.toUpperCase(), merged = normalizedState === 'MERGED'
    if (!merged && pr.mergeCommit != null) { errors.push(`EVIDENCE_CONFLICT: PR #${number} state and merge commit evidence disagree`); continue }
    if (normalizedState === 'CLOSED' && !merged) continue
    if (merged && (!mergeCommitSha || !isFullSha(mergeCommitSha))) { errors.push(`EVIDENCE_CONFLICT: PR #${number} merge commit identity is missing or malformed`); continue }

    if (!merged && protectedBaseSha && (baseBranch !== protectedBaseBranch || baseSha.toLowerCase() !== protectedBaseSha.toLowerCase())) {
      errors.push(`EVIDENCE_CONFLICT: PR #${number} base does not match live protected ${protectedBaseBranch}@${protectedBaseSha}`)
    }
    const reviews = Array.isArray(pr.reviews) ? pr.reviews : []
    const counts = reviewCounts(reviews, headSha)
    const requiredApprovals = protection.requiredApprovals
    const verification: HeadVerificationEvidence = {
      exactHead: headSha,
      checks: checkEvidence(pr.statusCheckRollup, protection.requiredChecks),
      reviews: {
        required: requiredApprovals > 0,
        approved: requiredApprovals === 0 || counts.approvedCount >= requiredApprovals,
        exactHead: requiredApprovals === 0 || counts.exactHeadApprovedCount >= requiredApprovals,
        approvedCount: counts.approvedCount,
        exactHeadApprovedCount: counts.exactHeadApprovedCount,
        nativeReviews: counts.nativeReviews,
      },
      protection,
    }
    activePrs.push({
      number,
      state,
      draft: Boolean(pr.isDraft),
      url,
      baseBranch,
      baseSha,
      headBranch,
      headSha,
      merged, mergeCommitSha: merged ? mergeCommitSha : null,
    })
    verifications.push(verification)
  }
  const unmergedPrs = activePrs.filter((pr) => !pr.merged)
  // Merged history is terminal for CLOSED Issues, not active continuation evidence for OPEN Issues.
  const selectedPrs = unmergedPrs.length > 0 ? unmergedPrs : issue?.state.toUpperCase() === 'OPEN' ? [] : activePrs
  const selectedNumbers = new Set(selectedPrs.map((pr) => pr.number))
  const selectedVerifications = activePrs.flatMap((pr, index) =>
    selectedNumbers.has(pr.number) && verifications[index] ? [verifications[index]] : [])
  const exactHead = selectedPrs.length === 1 ? selectedVerifications[0] ?? null : null
  return {
    repository: repositoryEvidence(repo),
    issue,
    comments,
    activePrs: selectedPrs,
    exactHead,
    protection,
    errors: [...new Set(errors)],
  }
}
