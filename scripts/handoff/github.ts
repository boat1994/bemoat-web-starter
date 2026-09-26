import { prOwnsIssue } from '../context/pr-issue-ownership.ts'
import { resolveApprovedBase } from '../context/approved-base.ts'
import type { HandoffRecord } from './schema.ts'
import {
  commandFailure,
  HandoffRuntimeError,
  parseJson,
  runHandoffCommand,
  type HandoffCommandResult,
  type HandoffCommandRunner,
} from './runtime.ts'

export type HandoffComment = {
  id: string
  body: string
  html_url: string
}

export type HandoffBinding = {
  repository: string
  issueNumber: string
  protectedBaseSha: string
  branch: string | null
  exactHead: string | null
  prNumber: string | null
  changedFiles: string[]
}

function output(result: HandoffCommandResult, label: string): string {
  if (result.error || result.status !== 0) {
    throw new HandoffRuntimeError('BLOCKED_EXTERNAL', `${label}: ${commandFailure(result, 'command failed')}`)
  }
  return result.stdout.trim()
}

function remoteRepository(remote: string): string | null {
  if (remote.startsWith('git@github.com:')) return remote.slice('git@github.com:'.length).replace(/\.git$/, '')
  if (remote.startsWith('https://github.com/')) return remote.slice('https://github.com/'.length).replace(/\.git$/, '')
  return null
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new HandoffRuntimeError('EVIDENCE_CONFLICT', `${message}: expected ${String(expected)}, got ${String(actual)}`)
}

function assertIssueUrl(url: unknown, repository: string, issueNumber: string): void {
  assertEqual(url, `https://github.com/${repository}/issues/${issueNumber}`, 'Issue URL binding')
}

function json<T>(run: HandoffCommandRunner, command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv, label: string): T {
  return parseJson<T>(run(command, args, { cwd, env }), label)
}

function readPullRequestFiles({ repository, prNumber, run, cwd, env }: {
  repository: string
  prNumber: string
  run: HandoffCommandRunner
  cwd: string
  env: NodeJS.ProcessEnv
}): string[] {
  const pages = json<unknown>(
    run,
    'gh',
    ['api', '--paginate', '--slurp', `repos/${repository}/pulls/${prNumber}/files`],
    cwd,
    env,
    'Pull Request changed files',
  )
  if (!Array.isArray(pages) || pages.length === 0 || pages.some((page) => !Array.isArray(page))) {
    throw new HandoffRuntimeError('EVIDENCE_CONFLICT', 'Pull Request changed-file evidence is empty or ambiguous')
  }
  const files: string[] = []
  for (const page of pages) {
    for (const entry of page) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof (entry as { filename?: unknown }).filename !== 'string') {
        throw new HandoffRuntimeError('EVIDENCE_CONFLICT', 'Pull Request changed-file evidence is malformed')
      }
      const fileEntry = entry as { filename: string; previous_filename?: unknown; status?: unknown }
      const filename = fileEntry.filename
      const validPath = (path: string) => Boolean(path) && !path.startsWith('/') && !path.split('/').includes('..')
      if (!validPath(filename)) {
        throw new HandoffRuntimeError('EVIDENCE_CONFLICT', 'Pull Request changed-file evidence contains an invalid path')
      }
      if (fileEntry.status !== undefined && !['added', 'removed', 'modified', 'renamed', 'copied', 'changed', 'unchanged'].includes(String(fileEntry.status))) {
        throw new HandoffRuntimeError('EVIDENCE_CONFLICT', 'Pull Request changed-file evidence has an unknown change status')
      }
      if (fileEntry.status === 'renamed' && typeof fileEntry.previous_filename !== 'string') {
        throw new HandoffRuntimeError('EVIDENCE_CONFLICT', 'renamed Pull Request file is missing its previous path')
      }
      if (fileEntry.previous_filename !== undefined) {
        if (typeof fileEntry.previous_filename !== 'string' || !validPath(fileEntry.previous_filename)) {
          throw new HandoffRuntimeError('EVIDENCE_CONFLICT', 'Pull Request changed-file evidence has an invalid previous path')
        }
        files.push(fileEntry.previous_filename)
      }
      files.push(filename)
    }
  }
  if (files.length === 0) throw new HandoffRuntimeError('EVIDENCE_CONFLICT', 'Pull Request changed-file evidence is empty')
  return [...new Set(files)].sort()
}

function readBranchFiles({ protectedBaseSha, exactHead, run, cwd, env }: {
  protectedBaseSha: string
  exactHead: string
  run: HandoffCommandRunner
  cwd: string
  env: NodeJS.ProcessEnv
}): string[] {
  const result = run(
    'git',
    ['diff', '--name-only', '--no-renames', '-z', protectedBaseSha + '...' + exactHead],
    { cwd, env },
  )
  if (result.error || result.status !== 0) {
    throw new HandoffRuntimeError(
      'BLOCKED_EXTERNAL',
      'protected-base-to-HEAD changed files: ' + commandFailure(result, 'command failed'),
    )
  }
  if (result.stdout === '') {
    return []
  }
  if (!result.stdout.endsWith('\0')) {
    throw new HandoffRuntimeError('EVIDENCE_CONFLICT', 'protected-base-to-HEAD changed-file evidence is malformed')
  }
  const files = result.stdout.slice(0, -1).split('\0')
  if (files.some((filename) => filename === '')) {
    throw new HandoffRuntimeError('EVIDENCE_CONFLICT', 'protected-base-to-HEAD changed-file evidence is malformed')
  }
  if (files.some((filename) => filename.startsWith('/') || filename.split('/').includes('..'))) {
    throw new HandoffRuntimeError('EVIDENCE_CONFLICT', 'protected-base-to-HEAD changed-file evidence contains an invalid path')
  }
  return [...new Set(files)].sort()
}

export function readHandoffBinding({
  cwd,
  env,
  issueNumber,
  record,
  run = runHandoffCommand,
}: {
  cwd: string
  env: NodeJS.ProcessEnv
  issueNumber: string
  record: HandoffRecord
  run?: HandoffCommandRunner
}): HandoffBinding {
  const repositoryPayload = json<{ nameWithOwner?: unknown }>(
    run,
    'gh',
    ['repo', 'view', '--json', 'nameWithOwner'],
    cwd,
    env,
    'repository identity',
  )
  const repository = typeof repositoryPayload.nameWithOwner === 'string' ? repositoryPayload.nameWithOwner : ''
  if (!repository) throw new HandoffRuntimeError('EVIDENCE_CONFLICT', 'repository identity is incomplete')
  assertEqual(repository, record.repository, 'repository binding')

  const approvedBase = resolveApprovedBase({ repo: repository, run, cwd, env })
  if (!approvedBase.branch || !approvedBase.sha) {
    const message = approvedBase.errors.find((error) => error.includes('approved-base-unresolved'))
      ?? approvedBase.errors[0]
      ?? 'EVIDENCE_CONFLICT: approved-base-unresolved'
    throw new HandoffRuntimeError(
      message.startsWith('BLOCKED_EXTERNAL:') ? 'BLOCKED_EXTERNAL' : 'EVIDENCE_CONFLICT',
      message,
    )
  }
  const baseBranch = approvedBase.branch
  assertEqual(baseBranch, record.protected_base.branch, 'protected base branch binding')

  const origin = output(run('git', ['remote', 'get-url', 'origin'], { cwd, env }), 'origin repository')
  assertEqual(remoteRepository(origin), repository, 'origin repository binding')

  const branch = output(run('git', ['branch', '--show-current'], { cwd, env }), 'local branch') || null
  const head = output(run('git', ['rev-parse', 'HEAD'], { cwd, env }), 'local HEAD') || null
  if (record.branch !== null) assertEqual(branch, record.branch, 'branch binding')
  if (record.exact_head !== null) assertEqual(head, record.exact_head, 'exact head binding')

  if (record.local_durability.required || record.branch !== null || record.exact_head !== null) {
    const status = output(run('git', ['status', '--short'], { cwd, env }), 'local working tree')
    if (status !== '') throw new HandoffRuntimeError('EVIDENCE_CONFLICT', 'LOCAL_STATE_NOT_DURABLE: working tree is dirty')
    const upstream = output(run('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], { cwd, env }), 'branch upstream')
    assertEqual(upstream, `origin/${record.branch}`, 'upstream branch binding')
    const remoteHead = output(run('git', ['ls-remote', '--heads', 'origin', record.branch ?? branch ?? ''], { cwd, env }), 'live upstream head')
      .split(/\s+/, 1)[0] || null
    assertEqual(remoteHead, record.exact_head, 'pushed exact head binding')
    if (!record.local_durability.durable) throw new HandoffRuntimeError('EVIDENCE_CONFLICT', record.local_durability.reason ?? 'LOCAL_STATE_NOT_DURABLE: local work is not durable')
  }

  const protectedBaseSha = approvedBase.sha.toLowerCase()
  assertEqual(protectedBaseSha, record.protected_base.sha, 'protected base SHA binding')

  const issue = json<{ number?: unknown; url?: unknown; state?: unknown }>(
    run,
    'gh',
    ['issue', 'view', issueNumber, '--repo', repository, '--json', 'number,url,state'],
    cwd,
    env,
    'Issue identity',
  )
  assertEqual(String(issue.number), issueNumber, 'Issue number binding')
  assertIssueUrl(issue.url, repository, issueNumber)
  assertEqual(String(issue.state).toUpperCase(), 'OPEN', 'Issue state binding')

  if (record.pr !== null) {
    const pr = json<{
      number?: unknown
      url?: unknown
      baseRefName?: unknown
      baseRefOid?: unknown
      headRefName?: unknown
      headRefOid?: unknown
      state?: unknown
      title?: unknown
      body?: unknown
      closingIssuesReferences?: unknown[]
    }>(run, 'gh', ['pr', 'view', record.pr.number, '--repo', repository, '--json', 'number,url,baseRefName,baseRefOid,headRefName,headRefOid,state,title,body,closingIssuesReferences'], cwd, env, 'Pull Request identity')
    assertEqual(String(pr.number), record.pr.number, 'PR number binding')
    assertEqual(pr.url, record.pr.url, 'PR URL binding')
    assertEqual(String(pr.state).toUpperCase(), 'OPEN', 'PR state binding')
    assertEqual(pr.baseRefName, baseBranch, 'PR live base branch binding')
    assertEqual(pr.baseRefName, record.pr.base, 'PR base branch binding')
    assertEqual(String(pr.baseRefOid).toLowerCase(), record.protected_base.sha, 'PR base SHA binding')
    assertEqual(pr.headRefName, branch, 'PR live head branch binding')
    assertEqual(pr.headRefName, record.pr.head, 'PR head branch binding')
    assertEqual(String(pr.headRefOid).toLowerCase(), record.pr.head_sha, 'PR exact head binding')

    assertEqual(prOwnsIssue(pr, repository, issueNumber), true, 'PR Issue linkage binding')
  } else {
    const prs = json<unknown[]>(run, 'gh', ['pr', 'list', '--repo', repository, '--state', 'open', '--search', `repo:${repository} #${issueNumber}`, '--json', 'number,state,title,body,closingIssuesReferences'], cwd, env, 'Active PR lookup')
    if (!Array.isArray(prs)) {
      throw new HandoffRuntimeError('EVIDENCE_CONFLICT', 'Active PR lookup evidence is malformed')
    }
    const hasApplicable = prs.some((p) => {
      if (!p || typeof p !== 'object' || Array.isArray(p)) {
        throw new HandoffRuntimeError('EVIDENCE_CONFLICT', 'Active PR lookup evidence is malformed')
      }
      const pr = p as { state?: unknown, title?: unknown, body?: unknown, closingIssuesReferences?: unknown }
      if (typeof pr.state !== 'string') {
        throw new HandoffRuntimeError('EVIDENCE_CONFLICT', 'Active PR lookup state evidence is malformed')
      }
      if (typeof pr.title !== 'string' || typeof pr.body !== 'string' || !Array.isArray(pr.closingIssuesReferences)) {
        throw new HandoffRuntimeError('EVIDENCE_CONFLICT', 'Active PR lookup ownership evidence is malformed')
      }
      if (pr.closingIssuesReferences.some((reference) => !reference || typeof reference !== 'object' || Array.isArray(reference) || typeof (reference as Record<string, unknown>).number !== 'string' && typeof (reference as Record<string, unknown>).number !== 'number')) {
        throw new HandoffRuntimeError('EVIDENCE_CONFLICT', 'Active PR lookup closing-issue evidence is malformed')
      }
      if (String(pr.state).toUpperCase() !== 'OPEN') return false
      return prOwnsIssue(pr, repository, issueNumber)
    })
    if (hasApplicable) {
      throw new HandoffRuntimeError('EVIDENCE_CONFLICT', 'applicable active PR exists but was omitted from the HANDOFF record')
    }
  }

  const changedFiles = record.pr
    ? readPullRequestFiles({ repository, prNumber: record.pr.number, run, cwd, env })
    : readBranchFiles({ protectedBaseSha, exactHead: head ?? '', run, cwd, env })

  return {
    repository,
    issueNumber,
    protectedBaseSha,
    branch,
    exactHead: head,
    prNumber: record.pr?.number ?? null,
    changedFiles,
  }
}

function normalizeComments(value: unknown): HandoffComment[] {
  const pages = Array.isArray(value) && value.every(Array.isArray) ? value.flat() : value
  if (!Array.isArray(pages)) throw new HandoffRuntimeError('EVIDENCE_CONFLICT', 'Issue comments evidence is not an array')
  return pages.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new HandoffRuntimeError('EVIDENCE_CONFLICT', 'Issue comments contain malformed evidence')
    }
    const comment = entry as Record<string, unknown>
    if (comment.id === undefined || typeof comment.body !== 'string' || typeof comment.html_url !== 'string') {
      throw new HandoffRuntimeError('EVIDENCE_CONFLICT', 'Issue comments are missing identity, URL, or body')
    }
    return {
      id: String(comment.id),
      body: comment.body,
      html_url: comment.html_url,
    }
  })
}

export function listHandoffComments({ repository, issueNumber, cwd, env, run = runHandoffCommand }: {
  repository: string
  issueNumber: string
  cwd: string
  env: NodeJS.ProcessEnv
  run?: HandoffCommandRunner
}): HandoffComment[] {
  const result = run('gh', ['api', '--paginate', '--slurp', `repos/${repository}/issues/${issueNumber}/comments`], { cwd, env })
  return normalizeComments(parseJson<unknown>(result, 'Issue comments'))
}

export function postHandoffComment({ repository, issueNumber, body, cwd, env, run = runHandoffCommand }: {
  repository: string
  issueNumber: string
  body: string
  cwd: string
  env: NodeJS.ProcessEnv
  run?: HandoffCommandRunner
}): HandoffCommandResult {
  return run('gh', ['api', '--method', 'POST', `repos/${repository}/issues/${issueNumber}/comments`, '--input', '-'], {
    cwd,
    env,
    input: JSON.stringify({ body }),
  })
}

export function commentMatches(comments: HandoffComment[], body: string, repository: string, issueNumber: string): HandoffComment[] {
  return comments.filter((comment) => {
    if (comment.body !== body) return false
    return comment.html_url === `https://github.com/${repository}/issues/${issueNumber}#issuecomment-${comment.id}`
  })
}
