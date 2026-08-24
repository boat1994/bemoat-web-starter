import { commentMatches, listHandoffComments, postHandoffComment, readHandoffBinding, type HandoffComment } from './github.ts'
import { parseHandoffBody, renderHandoffComment, type HandoffRecord } from './schema.ts'
import { commandFailure, HandoffRuntimeError, type HandoffCommandRunner } from './runtime.ts'

export type HandoffWorkflowResult = {
  classification: 'SUCCESS' | 'NO_OP_IDENTICAL_RETRY'
  mutationPerformed: boolean
  recovered: boolean
  comment: HandoffComment
  record: HandoffRecord
  body: string
  repository: string
  issueNumber: string
}

function ambiguous(message: string, mutationPerformed = true): never {
  throw new HandoffRuntimeError('AMBIGUOUS_RESULT', message, { mutationPerformed })
}

function readPostedId(stdout: string): string | null {
  try {
    const value = JSON.parse(stdout) as { id?: unknown }
    return value && typeof value.id !== 'undefined' ? String(value.id) : null
  } catch {
    return null
  }
}

function verifyReadback({
  comments,
  body,
  repository,
  issueNumber,
  postedId,
}: {
  comments: HandoffComment[]
  body: string
  repository: string
  issueNumber: string
  postedId: string | null
}): HandoffComment {
  const matches = commentMatches(comments, body, repository, issueNumber)
  if (matches.length !== 1) ambiguous(`HANDOFF readback is not unique: found ${matches.length} exact matches`)
  const comment = matches[0]
  if (postedId !== null && postedId !== comment.id) ambiguous('HANDOFF readback identity does not match the POST response')
  return comment
}

function successful({
  record,
  body,
  comment,
  repository,
  issueNumber,
  classification = 'SUCCESS',
  mutationPerformed,
  recovered = false,
}: {
  record: HandoffRecord
  body: string
  comment: HandoffComment
  repository: string
  issueNumber: string
  classification?: 'SUCCESS' | 'NO_OP_IDENTICAL_RETRY'
  mutationPerformed: boolean
  recovered?: boolean
}): HandoffWorkflowResult {
  return { classification, mutationPerformed, recovered, comment, record, body, repository, issueNumber }
}

export function runHandoffWorkflow({
  issueNumber,
  body: inputBody,
  cwd = process.cwd(),
  env = process.env,
  run,
}: {
  issueNumber: string
  body: string
  cwd?: string
  env?: NodeJS.ProcessEnv
  run?: HandoffCommandRunner
}): HandoffWorkflowResult {
  const record = parseHandoffBody(inputBody)
  if (record.issue_number !== issueNumber) {
    throw new HandoffRuntimeError('EVIDENCE_CONFLICT', `HANDOFF Issue binding does not match Issue #${issueNumber}`)
  }
  const commentBody = renderHandoffComment(record)
  const binding = readHandoffBinding({ cwd, env, issueNumber, record, run })
  const list = ( ) => listHandoffComments({
    repository: binding.repository,
    issueNumber,
    cwd,
    env,
    run,
  })
  const before = list()
  const existing = commentMatches(before, commentBody, binding.repository, issueNumber)
  if (existing.length > 1) ambiguous('multiple identical HANDOFF comments already exist', false)
  if (existing.length === 1) {
    return successful({
      record,
      body: commentBody,
      comment: existing[0],
      repository: binding.repository,
      issueNumber,
      classification: 'NO_OP_IDENTICAL_RETRY',
      mutationPerformed: false,
    })
  }

  const post = postHandoffComment({ repository: binding.repository, issueNumber, body: commentBody, cwd, env, run })
  const postedId = post.status === 0 && !post.error ? readPostedId(post.stdout) : null
  const after = list()
  const matches = commentMatches(after, commentBody, binding.repository, issueNumber)
  if (post.error || post.status !== 0) {
    if (matches.length === 1) {
      const comment = verifyReadback({ comments: after, body: commentBody, repository: binding.repository, issueNumber, postedId: null })
      return successful({
        record,
        body: commentBody,
        comment,
        repository: binding.repository,
        issueNumber,
        mutationPerformed: true,
        recovered: true,
      })
    }
    if (matches.length > 1) ambiguous('ambiguous HANDOFF POST produced competing exact comments')
    if (post.mutationPerformed === false) {
      const retry = postHandoffComment({ repository: binding.repository, issueNumber, body: commentBody, cwd, env, run })
      if (retry.error || retry.status !== 0) {
        ambiguous(`HANDOFF POST failed with no durable comment: ${commandFailure(retry, 'retry failed')}`, false)
      }
      const retryComments = list()
      const retryComment = verifyReadback({
        comments: retryComments,
        body: commentBody,
        repository: binding.repository,
        issueNumber,
        postedId: readPostedId(retry.stdout),
      })
      return successful({
        record,
        body: commentBody,
        comment: retryComment,
        repository: binding.repository,
        issueNumber,
        mutationPerformed: true,
      })
    }
    ambiguous(`HANDOFF POST outcome is unprovable: ${commandFailure(post, 'POST failed')}`)
  }

  const comment = verifyReadback({ comments: after, body: commentBody, repository: binding.repository, issueNumber, postedId })
  return successful({
    record,
    body: commentBody,
    comment,
    repository: binding.repository,
    issueNumber,
    mutationPerformed: true,
  })
}
