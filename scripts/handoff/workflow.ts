import { commentMatches, listHandoffComments, postHandoffComment, readHandoffBinding, type HandoffBinding, type HandoffComment } from './github.ts'
import { parseHandoffBody, renderHandoffComment, type HandoffEvidence, type HandoffRecord } from './schema.ts'
import { commandFailure, HandoffRuntimeError, runHandoffCommand, type HandoffCommandRunner } from './runtime.ts'

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

type ValidationTier = 'docs-only' | 'code'

type ValidationProof = {
  status: 'PASS'
  tier: ValidationTier
  command: 'pnpm run bemoat:guard:safety' | 'pnpm run bemoat:check'
  exact_head: string
}

function validationTier(files: string[]): ValidationTier {
  if (files.length === 0) throw new HandoffRuntimeError('EVIDENCE_CONFLICT', 'changed-file evidence is empty')
  let hasCode = false
  for (const file of files) {
    const lower = file.toLowerCase()
    if (/\.(md|mdx)$/.test(lower)) continue
    if (/^\.github\/workflows\/.+\.(ya?ml)$/.test(lower) || lower === '.github/dependabot.yml') continue
    if (
      /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|css|scss|html|vue|svelte|py|sh|sql|json|jsonc|ya?ml|toml|lock|prisma|graphql|gql)$/.test(lower)
      || /^(src|scripts|tests|components|\.agents|\.codex)\//.test(file)
      || /^(package\.json|pnpm-lock\.yaml|tsconfig[^/]*\.json|vitest\.config\.[^/]+|next\.config\.[^/]+|wrangler\.jsonc)$/.test(file)
    ) {
      hasCode = true
      continue
    }
    if (file.startsWith('docs/') && /\.(rst|adoc|txt|pdf|png|jpe?g|webp|gif|svg)$/.test(lower)) continue
    throw new HandoffRuntimeError('EVIDENCE_CONFLICT', `cannot determine required validation tier for changed file: ${file}`)
  }
  return hasCode ? 'code' : 'docs-only'
}

function validationProof(tier: ValidationTier, exactHead: string): ValidationProof {
  return {
    status: 'PASS',
    tier,
    command: tier === 'docs-only' ? 'pnpm run bemoat:guard:safety' : 'pnpm run bemoat:check',
    exact_head: exactHead,
  }
}

function runRequiredValidation({ tier, cwd, env, run }: {
  tier: ValidationTier
  cwd: string
  env: NodeJS.ProcessEnv
  run: HandoffCommandRunner
}): void {
  const command = tier === 'docs-only' ? ['run', 'bemoat:guard:safety'] : ['run', 'bemoat:check']
  const result = run('pnpm', command, { cwd, env })
  if (result.error || result.status !== 0) {
    throw new HandoffRuntimeError('BLOCKED_EXTERNAL', `required validation failed: ${commandFailure(result, 'command failed')}`)
  }
}

function withValidationProof(record: HandoffRecord, proof: ValidationProof): HandoffRecord {
  const evidence: HandoffEvidence[] = record.verified_evidence.filter((entry) => entry.kind !== 'validation-proof')
  evidence.push({ kind: 'validation-proof', value: JSON.stringify(proof), url: null })
  return { ...record, verified_evidence: evidence }
}

function assertStableValidationScope(initial: HandoffBinding, current: HandoffBinding): void {
  if (JSON.stringify(initial.changedFiles) !== JSON.stringify(current.changedFiles)) {
    throw new HandoffRuntimeError('EVIDENCE_CONFLICT', 'changed-file evidence drifted during required validation')
  }
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
  let record = parseHandoffBody(inputBody)
  if (record.issue_number !== issueNumber) {
    throw new HandoffRuntimeError('EVIDENCE_CONFLICT', `HANDOFF Issue binding does not match Issue #${issueNumber}`)
  }
  let binding = readHandoffBinding({ cwd, env, issueNumber, record, run })
  const tier = validationTier(binding.changedFiles)
  runRequiredValidation({ tier, cwd, env, run: run ?? runHandoffCommand })
  const exactHead = binding.exactHead
  if (!exactHead) throw new HandoffRuntimeError('EVIDENCE_CONFLICT', 'exact HEAD is required for validation proof')
  record = withValidationProof(record, validationProof(tier, exactHead))
  // Validation may run tools that touch the worktree or advance the branch; rebind immediately afterwards.
  const postValidationBinding = readHandoffBinding({ cwd, env, issueNumber, record, run })
  assertStableValidationScope(binding, postValidationBinding)
  binding = postValidationBinding
  const commentBody = renderHandoffComment(record)
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

  // Immediate pre-POST revalidation to prevent drift.
  const prePostBinding = readHandoffBinding({ cwd, env, issueNumber, record, run })
  assertStableValidationScope(binding, prePostBinding)
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
      // Immediate pre-POST revalidation before retry.
      const retryBinding = readHandoffBinding({ cwd, env, issueNumber, record, run })
      assertStableValidationScope(binding, retryBinding)
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
