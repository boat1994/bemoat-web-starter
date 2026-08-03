import { projectComments } from '../github-comment-projection.mjs'
import { run } from './process-runner.mjs'
import { getDefaultRepo } from './local-git-evidence.mjs'
import { parseIssueReference, parsePrReference } from './issue-references.mjs'

export function fetchIssueMetadata(cwd, issueNumber, env = process.env) {
  const result = run(
    'gh',
    ['issue', 'view', issueNumber, '--json', 'title,url,body,labels'],
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
    const parsed = JSON.parse(result.stdout)
    return {
      available: Boolean(parsed?.title && parsed?.url),
      title: parsed?.title ?? null,
      url: parsed?.url ?? null,
      body: parsed?.body ?? '',
      labels: Array.isArray(parsed?.labels) ? parsed.labels.map((label) => label.name) : [],
      reason: parsed?.title && parsed?.url ? null : 'GitHub CLI response was missing issue metadata.',
    }
  } catch (error) {
    return {
      available: false,
      reason: `GitHub CLI returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

export function fetchIssueByReference(cwd, reference, env = process.env) {
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
    const issue = JSON.parse(result.stdout)
    return {
      ok: true,
      reference: parsed,
      issue,
    }
  } catch (error) {
    return {
      ok: false,
      reason: `Invalid issue JSON: ${error instanceof Error ? error.message : String(error)}`,
      reference: parsed,
    }
  }
}

export function fetchIssueComments(cwd, issueNumber, env = process.env) {
  if (!issueNumber) {
    return { ok: false, reason: 'Issue number is required for comment lookup.' }
  }

  const args = ['issue', 'view', issueNumber, '--json', 'comments']
  const defaultRepo = getDefaultRepo(cwd, env)
  if (defaultRepo) {
    args.push('--repo', defaultRepo)
  }

  const result = run('gh', args, { cwd, env })
  if (result.status !== 0) {
    return {
      ok: false,
      reason: result.stderr.trim() || result.stdout.trim() || 'GitHub issue comment lookup failed.',
    }
  }

  try {
    const payload = JSON.parse(result.stdout)
    return {
      ok: true,
      comments: Array.isArray(payload.comments) ? projectComments(payload.comments) : [],
    }
  } catch (error) {
    return {
      ok: false,
      reason: `Invalid issue comments JSON: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

export function fetchIssueCommentById(cwd, commentId, env = process.env) {
  const defaultRepo = getDefaultRepo(cwd, env)
  if (!defaultRepo || !/^[1-9]\d*$/.test(String(commentId))) {
    return { ok: false, reason: 'repository identity or pinned comment ID is unavailable' }
  }
  const result = run('gh', ['api', `repos/${defaultRepo}/issues/comments/${commentId}`], { cwd, env })
  if (result.status !== 0) {
    return { ok: false, reason: result.stderr.trim() || result.stdout.trim() || 'GitHub comment lookup failed' }
  }
  try {
    const comment = JSON.parse(result.stdout)
    return { ok: true, comment }
  } catch (error) {
    return { ok: false, reason: `Invalid issue comment JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
}

export function fetchPullReviewCommentById(cwd, commentId, env = process.env) {
  const defaultRepo = getDefaultRepo(cwd, env)
  if (!defaultRepo || !/^[1-9]\d*$/.test(String(commentId))) {
    return { ok: false, reason: 'repository identity or pinned finding thread ID is unavailable' }
  }
  const result = run('gh', ['api', `repos/${defaultRepo}/pulls/comments/${commentId}`], { cwd, env })
  if (result.status !== 0) {
    return { ok: false, reason: result.stderr.trim() || result.stdout.trim() || 'GitHub pull review comment lookup failed' }
  }
  try {
    const comment = JSON.parse(result.stdout)
    return { ok: true, comment }
  } catch (error) {
    return {
      ok: false,
      reason: `Invalid pull review comment JSON: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

export function fetchPrByReference(cwd, reference, env = process.env) {
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
    const pr = JSON.parse(result.stdout)
    return {
      ok: true,
      reference: parsed,
      pr,
    }
  } catch (error) {
    return {
      ok: false,
      reason: `Invalid PR JSON: ${error instanceof Error ? error.message : String(error)}`,
      reference: parsed,
    }
  }
}

export function parseGhPrListPayload(stdout) {
  let parsed
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return { ok: false, reason: 'malformed GitHub PR list JSON' }
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, reason: 'GitHub PR list evidence is not an array' }
  }
  return { ok: true, openPrs: parsed }
}

export function fetchOpenPrsByGhArgs(cwd, env, args) {
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

export function prClosesIssue(pr, issueNumber) {
  const refs = pr?.closingIssuesReferences
  if (!Array.isArray(refs)) return false
  const target = String(issueNumber)
  return refs.some((ref) => {
    if (!ref || typeof ref !== 'object') return false
    const number = ref.number != null ? String(ref.number) : null
    return number === target
  })
}

export function checkOpenPrsForIssueOrBranch(cwd, env, branchName, issueNumber) {
  const ghJsonFields = ['number', 'title', 'headRefName', 'url', 'closingIssuesReferences']
  const seen = new Map()
  const queries = []

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
      if (!pr || pr.number == null) continue
      seen.set(String(pr.number), pr)
    }
  }

  const conflicting = []
  for (const pr of seen.values()) {
    const matchesBranch = branchName && pr.headRefName === branchName
    const matchesIssue = issueNumber && (String(pr.number) === String(issueNumber) || prClosesIssue(pr, issueNumber))
    if (matchesBranch || matchesIssue) conflicting.push(pr)
  }

  return { ok: true, openPrs: conflicting }
}
