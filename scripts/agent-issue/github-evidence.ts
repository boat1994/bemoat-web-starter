import { projectComments } from '../mission-control/diagnostics/github-comment-projection.mjs'
import { run } from './process-runner.ts'
import { getDefaultRepo } from './local-git-evidence.ts'
import { parseIssueReference, parsePrReference } from './issue-references.ts'
import type { IssueReference, PrReference } from './issue-references.ts'
import { assertGhJsonValue, invalidJsonMessage, parseGhPrListPayload } from './github-evidence-schemas.ts'

interface IssueMetadataResult {
  available: boolean
  title: string | null
  url: string | null
  body: unknown
  labels: Array<string | undefined>
  reason: string | null
}

export function fetchIssueMetadata(
  cwd: string,
  issueNumber: string | number,
  env: NodeJS.ProcessEnv = process.env,
): IssueMetadataResult | { available: false; reason: string } {
  const result = run(
    'gh',
    ['issue', 'view', String(issueNumber), '--json', 'title,url,body,labels'],
    { cwd, env },
  )
  if (result.error) {
    return {
      available: false,
      reason: `GitHub CLI is unavailable: ${result.error.message}`,
    }
  }

  if (result.status !== 0) {
    const failure = result.stderr.trim() || result.stdout.trim() || 'GitHub CLI request failed.'
    return {
      available: false,
      reason: failure,
    }
  }

  try {
    const parsed = assertGhJsonValue(JSON.parse(result.stdout)) as {
      title?: string
      url?: string
      body?: unknown
      labels?: unknown
    }
    return {
      available: Boolean(parsed?.title && parsed?.url),
      title: parsed?.title ?? null,
      url: parsed?.url ?? null,
      body: parsed?.body ?? '',
      labels: Array.isArray(parsed?.labels)
        ? parsed.labels.map((label: { name?: string }) => label.name)
        : [],
      reason:
        parsed?.title && parsed?.url ? null : 'GitHub CLI response was missing issue metadata.',
    }
  } catch (error) {
    return {
      available: false,
      reason: `GitHub CLI returned invalid JSON: ${invalidJsonMessage(error)}`,
    }
  }
}

type IssueByReferenceFailure = {
  ok: false
  reason: string
  reference?: IssueReference
}

type IssueByReferenceSuccess = {
  ok: true
  reference: IssueReference
  issue: unknown
}

export function fetchIssueByReference(
  cwd: string,
  reference: string,
  env: NodeJS.ProcessEnv = process.env,
): IssueByReferenceFailure | IssueByReferenceSuccess {
  const defaultRepo = getDefaultRepo(cwd, env)
  const parsed = parseIssueReference(reference, defaultRepo)
  if (!parsed?.number) {
    return { ok: false, reason: `Could not parse issue reference: ${reference}` }
  }

  const args = ['issue', 'view', parsed.number, '--json', 'number,id,url,title,body,state']
  if (parsed.repo) {
    args.push('--repo', parsed.repo)
  }

  const result = run('gh', args, { cwd, env })
  if (result.status !== 0) {
    return {
      ok: false,
      reason: result.stderr.trim() || result.stdout.trim() || 'GitHub issue lookup failed.',
      reference: parsed,
    }
  }

  try {
    const issue = assertGhJsonValue(JSON.parse(result.stdout))
    return {
      ok: true,
      reference: parsed,
      issue,
    }
  } catch (error) {
    return {
      ok: false,
      reason: `Invalid issue JSON: ${invalidJsonMessage(error)}`,
      reference: parsed,
    }
  }
}

export function fetchIssueComments(
  cwd: string,
  issueNumber: string | number | false | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): { ok: false; reason: string } | { ok: true; comments: ReturnType<typeof projectComments> } {
  if (!issueNumber) {
    return { ok: false, reason: 'Issue number is required for comment lookup.' }
  }

  const args: string[] = ['issue', 'view', String(issueNumber), '--json', 'comments']
  const defaultRepo = getDefaultRepo(cwd, env)
  if (defaultRepo) {
    args.push('--repo', defaultRepo)
  }

  const result = run('gh', args, { cwd, env })
  if (result.status !== 0) {
    return {
      ok: false,
      reason:
        result.stderr.trim() || result.stdout.trim() || 'GitHub issue comment lookup failed.',
    }
  }

  try {
    const payload = assertGhJsonValue(JSON.parse(result.stdout)) as { comments?: unknown }
    return {
      ok: true,
      comments: Array.isArray(payload.comments) ? projectComments(payload.comments) : [],
    }
  } catch (error) {
    return {
      ok: false,
      reason: `Invalid issue comments JSON: ${invalidJsonMessage(error)}`,
    }
  }
}

export function fetchIssueCommentById(
  cwd: string,
  commentId: string | number,
  env: NodeJS.ProcessEnv = process.env,
): { ok: false; reason: string } | { ok: true; comment: unknown } {
  const defaultRepo = getDefaultRepo(cwd, env)
  if (!defaultRepo || !/^[1-9]\d*$/.test(String(commentId))) {
    return { ok: false, reason: 'repository identity or pinned comment ID is unavailable' }
  }
  const result = run('gh', ['api', `repos/${defaultRepo}/issues/comments/${commentId}`], {
    cwd,
    env,
  })
  if (result.status !== 0) {
    return {
      ok: false,
      reason: result.stderr.trim() || result.stdout.trim() || 'GitHub comment lookup failed',
    }
  }
  try {
    const comment = assertGhJsonValue(JSON.parse(result.stdout))
    return { ok: true, comment }
  } catch (error) {
    return {
      ok: false,
      reason: `Invalid issue comment JSON: ${invalidJsonMessage(error)}`,
    }
  }
}

export function fetchPullReviewCommentById(
  cwd: string,
  commentId: string | number,
  env: NodeJS.ProcessEnv = process.env,
): { ok: false; reason: string } | { ok: true; comment: unknown } {
  const defaultRepo = getDefaultRepo(cwd, env)
  if (!defaultRepo || !/^[1-9]\d*$/.test(String(commentId))) {
    return { ok: false, reason: 'repository identity or pinned finding thread ID is unavailable' }
  }
  const result = run('gh', ['api', `repos/${defaultRepo}/pulls/comments/${commentId}`], {
    cwd,
    env,
  })
  if (result.status !== 0) {
    return {
      ok: false,
      reason:
        result.stderr.trim() || result.stdout.trim() || 'GitHub pull review comment lookup failed',
    }
  }
  try {
    const comment = assertGhJsonValue(JSON.parse(result.stdout))
    return { ok: true, comment }
  } catch (error) {
    return {
      ok: false,
      reason: `Invalid pull review comment JSON: ${invalidJsonMessage(error)}`,
    }
  }
}

type PrByReferenceFailure = {
  ok: false
  reason: string
  reference?: PrReference
}

type PrByReferenceSuccess = {
  ok: true
  reference: PrReference
  pr: unknown
}

export function fetchPrByReference(
  cwd: string,
  reference: string,
  env: NodeJS.ProcessEnv = process.env,
): PrByReferenceFailure | PrByReferenceSuccess {
  const parsed = parsePrReference(reference)
  if (!parsed?.number) {
    return { ok: false, reason: `Could not parse PR reference: ${reference}` }
  }

  const args = [
    'pr',
    'view',
    parsed.number,
    '--json',
    'number,id,url,title,headRefName,baseRefName,headRefOid,state,isDraft,statusCheckRollup,commits,headRepository,mergeCommit',
  ]
  if (parsed.repo) {
    args.push('--repo', parsed.repo)
  }

  const result = run('gh', args, { cwd, env })
  if (result.status !== 0) {
    return {
      ok: false,
      reason: result.stderr.trim() || result.stdout.trim() || 'GitHub PR lookup failed.',
      reference: parsed,
    }
  }

  try {
    const pr = assertGhJsonValue(JSON.parse(result.stdout))
    return {
      ok: true,
      reference: parsed,
      pr,
    }
  } catch (error) {
    return {
      ok: false,
      reason: `Invalid PR JSON: ${invalidJsonMessage(error)}`,
      reference: parsed,
    }
  }
}

export { parseGhPrListPayload } from './github-evidence-schemas.ts'

export function fetchOpenPrsByGhArgs(
  cwd: string,
  env: NodeJS.ProcessEnv,
  args: string[],
): { ok: false; reason: string } | { ok: true; openPrs: unknown[] } {
  const result = run('gh', args, { cwd, env })
  if (result.status !== 0) {
    return {
      ok: false,
      reason: result.stderr.trim() || result.stdout.trim() || 'gh pr list check failed',
    }
  }
  const parsed = parseGhPrListPayload(result.stdout)
  if (!parsed.ok) return parsed
  return parsed
}

interface PrClosingRef {
  number?: string | number | null
}

interface PrEvidence {
  number?: string | number | null
  headRefName?: string
  closingIssuesReferences?: unknown
}

export function prClosesIssue(pr: PrEvidence | null | undefined, issueNumber: string | number): boolean {
  const refs = pr?.closingIssuesReferences
  if (!Array.isArray(refs)) return false
  const target = String(issueNumber)
  return refs.some((ref) => {
    if (!ref || typeof ref !== 'object') return false
    const closingRef = ref as PrClosingRef
    const number = closingRef.number != null ? String(closingRef.number) : null
    return number === target
  })
}

export function checkOpenPrsForIssueOrBranch(
  cwd: string,
  env: NodeJS.ProcessEnv,
  branchName: string | null,
  issueNumber: string | number | null,
): { ok: false; reason: string } | { ok: true; openPrs: PrEvidence[] } {
  const ghJsonFields = ['number', 'title', 'headRefName', 'url', 'closingIssuesReferences']
  const seen = new Map<string, PrEvidence>()
  const queries: string[][] = []

  if (branchName) {
    queries.push([
      'pr',
      'list',
      '--state',
      'open',
      '--head',
      branchName,
      '--json',
      ghJsonFields.join(','),
      '--limit',
      '100',
    ])
  }

  if (issueNumber) {
    queries.push([
      'pr',
      'list',
      '--state',
      'open',
      '--search',
      `closes #${issueNumber} repo:${getDefaultRepo(cwd) ?? ''}`.trim(),
      '--json',
      ghJsonFields.join(','),
      '--limit',
      '100',
    ])
  }

  if (queries.length === 0) {
    return { ok: false, reason: 'branch or issue number is required for conflicting-PR evidence' }
  }

  for (const args of queries) {
    const result = fetchOpenPrsByGhArgs(cwd, env, args)
    if (!result.ok) return result
    for (const pr of result.openPrs) {
      const evidence = pr as PrEvidence
      if (!evidence || evidence.number == null) continue
      seen.set(String(evidence.number), evidence)
    }
  }

  const conflicting: PrEvidence[] = []
  for (const pr of seen.values()) {
    const matchesBranch = branchName && pr.headRefName === branchName
    const matchesIssue =
      issueNumber &&
      (String(pr.number) === String(issueNumber) || prClosesIssue(pr, issueNumber))
    if (matchesBranch || matchesIssue) conflicting.push(pr)
  }

  return { ok: true, openPrs: conflicting }
}
