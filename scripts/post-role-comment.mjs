#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  isCorrectionPhaseResult,
  parseCorrectionContract,
  validateCorrectionRoleComment,
} from './correction-contract.mjs'
import {
  createHelpEnvelopeV1,
  formatTextHelp,
} from './cli/command-help.mjs'
import {
  CliInvocationError,
  parseCommandInvocation,
  resolveCommandIdentity,
} from './cli/command-invocation.mjs'
import {
  CLI_EXIT_CODES,
  classificationExitCode,
  createResultEnvelopeV1,
} from './cli/command-result.mjs'
import {
  findLatestRoleComment,
  normalizeIssueComments,
  parsePaginatedGhApiJson,
  parseRoleCommentBody,
  resolveProductionCommentTrust,
  verifyPostedCommentReadback,
} from './mission-control-reconcile.mjs'
import { projectComments } from './github-comment-projection.mjs'

const ROLE_HEADINGS = ['HANDOFF', 'RESULT', 'REVIEW_VERDICT']
const CORE_VERDICTS = [
  'CORRECTION REQUIRED',
  'ELIGIBLE FOR FOUNDER REVIEW',
  'BLOCKED FOR FOUNDER DECISION',
  'BLOCKED EXTERNAL',
  'STATE CONFLICT',
]
const TASK_LOG_FIELDS = ['### Task log', 'Timestamp:', 'Task / Issue:', 'Phase:', 'Executing role:']
const REQUIRED_FIELD_SHAPES = {
  HANDOFF: [[...TASK_LOG_FIELDS, '**Target:**', '**Objective:**', '**Links:**', '**Next:**']],
  RESULT: [
    [...TASK_LOG_FIELDS, '**Completed:**', '**Summary:**', '**Next:**'],
    [...TASK_LOG_FIELDS, '**Role / phase completed:**', '### Summary', '### Files or artifacts changed', '### Commands run', '### Next handoff'],
    ['**Profile:**', '**Task:**', '**PR:**', '**Completed:**', '**Evidence:**', '**AC audit:**', '**Risks / escalation:**', '**Next:**'],
  ],
  REVIEW_VERDICT: [
    [...TASK_LOG_FIELDS, '**PR / base / head:**', '**Verdict:**', '**Findings:**', '**Gates:**', '**Next:**'],
    [...TASK_LOG_FIELDS, '**Reviewed PR:**', '**Approved base:**', '**Exact head reviewed:**', '**Verdict:**', '### Critical / Important findings summary', '### Gate status', '### Next handoff'],
  ],
}
const MAX_COMPACT_LENGTH = 6_000
const DOUBLE_LOOP_FIELDS = [
  '**Loop gate:**',
  '**Failure class:**',
  '**Invalidated assumptions:**',
  '**Decision:**',
  '**Next experiment:**',
  '**Material difference:**',
  '**Allowed / prohibited:**',
  '**Verify / stop:**',
]
const DOUBLE_LOOP_FAILURE_CLASSES = [
  'IMPLEMENTATION',
  'SPECIFICATION',
  'VALIDATION',
  'DECOMPOSITION',
  'TOOL_OR_MODEL',
  'ENVIRONMENT',
  'UNKNOWN',
]
const DOUBLE_LOOP_ALLOWED_DECISIONS = [
  'CONTINUE_IMPLEMENTATION',
  'REVISE_SPECIFICATION',
  'REVISE_VALIDATION',
  'SPLIT_OR_REDECOMPOSE_TASK',
  'CHANGE_TOOL_OR_MODEL',
  'REPAIR_ENVIRONMENT',
  'BLOCKED_EXTERNAL',
  'BLOCKED_FOR_FOUNDER_DECISION',
  'CREATE_FOLLOW_UP_ISSUE',
]

const COMMAND = 'bemoat:issue:comment'
const ENTRYPOINT = 'scripts/post-role-comment.mjs'

function runtimeError(classification, message, details = {}) {
  const error = new Error(message)
  error.classification = classification
  Object.assign(error, details)
  return error
}

function resolveRoleCommentCommand() {
  const env = process.env.npm_lifecycle_event === 'test:int'
    ? { ...process.env, npm_lifecycle_event: undefined }
    : process.env

  return resolveCommandIdentity({
    fallback: COMMAND,
    env,
    entrypoint: ENTRYPOINT,
  })
}

function renderHelp(invocation) {
  if (invocation.format === 'json') {
    process.stdout.write(`${JSON.stringify(createHelpEnvelopeV1(invocation.contract))}\n`)
    return
  }

  process.stdout.write(formatTextHelp(invocation.contract))
}

function runtimeClassification(error) {
  if (
    error &&
    typeof error === 'object' &&
    typeof error.classification === 'string' &&
    Object.hasOwn(CLI_EXIT_CODES, error.classification)
  ) {
    return error.classification
  }

  const reason = error instanceof Error ? error.message : String(error)
  const prefix = reason.match(/^([A-Z_]+):/)
  if (prefix && Object.hasOwn(CLI_EXIT_CODES, prefix[1])) return prefix[1]
  if (/\b(?:gh|GitHub|network|remote)\b/i.test(reason)) return 'BLOCKED_EXTERNAL'
  return 'INTERNAL_ERROR'
}

function runtimeDetails(error) {
  const details = error instanceof CliInvocationError
    ? {
      argument: error.details.argument,
      reason: error.details.reason,
    }
    : {
      argument: null,
      reason: error instanceof Error ? error.message : String(error),
    }

  if (error && typeof error === 'object') {
    if (Array.isArray(error.errors)) details.errors = error.errors
    if (Array.isArray(error.legacyOutput)) details.legacy_output = error.legacyOutput
    if (typeof error.legacyClassification === 'string') {
      details.legacy_classification = error.legacyClassification
    }
  }

  return details
}

function renderRuntimeError({ command, format, error, values = {} }) {
  const classification = runtimeClassification(error)
  const details = runtimeDetails(error)
  const mutationPerformed = Boolean(
    error &&
    typeof error === 'object' &&
    error.mutationPerformed === true,
  )

  if (format === 'json' && command) {
    process.stdout.write(`${JSON.stringify(createResultEnvelopeV1({
      command,
      outcome: 'ERROR',
      classification,
      mutation_performed: mutationPerformed,
      repository: values.repository ?? null,
      issue_number: values.issue_number ?? null,
      next_action: {
        type: 'STOP',
        command: null,
        reason: details.reason,
      },
      details,
    }))}\n`)
  } else if (error instanceof CliInvocationError) {
    process.stderr.write(`${classification}: ${details.reason}\n`)
  } else if (classification === 'BLOCKED_EXTERNAL') {
    process.stdout.write(`${classification}: ${details.reason}\n`)
  } else {
    const legacyPrefix = details.legacy_classification
      ? `${details.legacy_classification}: `
      : ''
    process.stderr.write(`ERROR: ${classification}: ${legacyPrefix}${details.reason}\n`)
    for (const line of details.legacy_output ?? []) process.stderr.write(`${line}\n`)
  }

  process.exitCode = classificationExitCode(classification)
}

function renderResult({
  command,
  format,
  options,
  role,
  legacyClassification,
  legacyOutput,
  mutationPerformed,
  parsedBody,
  commentId = null,
}) {
  const exactHead = /^[0-9a-f]{40}$/i.test(parsedBody.headSha ?? '')
    ? parsedBody.headSha.toLowerCase()
    : null
  const result = createResultEnvelopeV1({
    command,
    outcome: 'SUCCESS',
    classification: 'SUCCESS',
    mutation_performed: mutationPerformed,
    repository: options.repo,
    issue_number: options.issue,
    pr_number: parsedBody.prNumber,
    exact_head: exactHead,
    next_action: {
      type: 'COMPLETE',
      command: null,
      reason: 'The role comment operation completed without owning a state transition.',
    },
    details: {
      role,
      ...(legacyClassification ? { legacy_classification: legacyClassification } : {}),
      ...(legacyOutput.length > 0 ? { legacy_output: legacyOutput } : {}),
      ...(options.check ? { check: true } : {}),
      ...(commentId != null ? { comment_id: String(commentId) } : {}),
    },
  })

  if (format === 'json') {
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } else {
    for (const line of legacyOutput) {
      if (line.startsWith('WARNING:')) process.stderr.write(`${line}\n`)
    }
    const message = options.check
      ? `validated ${role} comment for Issue #${options.issue}`
      : `posted ${role} comment to Issue #${options.issue}; no durable-state transition was performed`
    process.stdout.write(`SUCCESS: ${message}\n`)
  }

  process.exitCode = classificationExitCode('SUCCESS')
}

function readBody(bodyFile) {
  const stdinIsPipe = !process.stdin.isTTY
  const stdin = stdinIsPipe ? readFileSync(0, 'utf8') : ''
  if (bodyFile && stdin.length > 0) {
    throw new CliInvocationError('--body-file', '--body-file and stdin are mutually exclusive')
  }
  if (bodyFile) {
    try {
      return readFileSync(bodyFile, 'utf8')
    } catch (error) {
      throw new CliInvocationError(
        bodyFile,
        error instanceof Error ? error.message : String(error),
      )
    }
  }
  if (!stdin) throw new CliInvocationError('stdin', 'provide a comment body through --body-file or stdin')
  return stdin
}

function validationErrors(body) {
  const errors = []
  if (/\\n/.test(body)) errors.push('literal \\n sequences are not allowed')
  if (/\$\([^)]*\)/.test(body)) errors.push('unresolved $(...) shell substitutions are not allowed')
  if (/^\s*(?:\$ |(?:PASS|FAIL|RUN)\s)/m.test(body)) errors.push('command transcripts are not allowed')
  if (/^>\s*(?:[$#]\s*|(?:pnpm|npm|yarn|git|gh|node|npx)\b)/im.test(body)) errors.push('quoted command transcripts are not allowed')
  if (/^\s*Command:\s*\S+/im.test(body)) errors.push('command-labelled transcripts are not allowed')
  if (/^ {4,}(?:(?:PASS|FAIL|RUN)\b|(?:Error|Warning):)/m.test(body)) errors.push('indented command transcripts are not allowed')

  const headings = [...body.matchAll(/^##\s+([^\n#]+)\s*$/gm)].map((match) => match[1].trim())
  const recognized = headings.filter((heading) => ROLE_HEADINGS.includes(heading))
  if (headings.length !== 1 || recognized.length !== 1) {
    errors.push('body must contain exactly one recognized role heading and no other ## headings')
    return { errors, role: null }
  }

  const role = recognized[0]
  const matchedShape = REQUIRED_FIELD_SHAPES[role].find((shape) => shape.every((field) => hasNonEmptyField(body, field)))
  if (!matchedShape) {
    errors.push(`${role} is missing required operational fields or values`)
  }
  if (role === 'RESULT' && /^\*\*Profile:\*\*/m.test(body) && !/^\*\*Profile:\*\*\s*FAST\s*$/m.test(body)) {
    errors.push('RESULT profile transport is only supported for FAST')
  }
  const hasDoubleLoopFields = /^\*\*Loop gate:\*\*/m.test(body)
  if (hasDoubleLoopFields && !['HANDOFF', 'RESULT'].includes(role)) {
    errors.push('Double-Loop Review fields are only supported for HANDOFF or RESULT')
  }
  if (hasDoubleLoopFields) {
    for (const field of DOUBLE_LOOP_FIELDS) {
      if (!hasNonEmptyField(body, field)) errors.push(`Double-Loop Review is missing required field: ${field}`)
    }
    const failureClass = readFieldValue(body, '**Failure class:**')
    const decision = readFieldValue(body, '**Decision:**')
    if (!DOUBLE_LOOP_FAILURE_CLASSES.includes(failureClass)) {
      errors.push('Double-Loop Review failure class must use the constrained vocabulary')
    }
    if (!DOUBLE_LOOP_ALLOWED_DECISIONS.includes(decision)) {
      errors.push('Double-Loop Review decision must use the constrained vocabulary')
    }
    if (failureClass === 'UNKNOWN' && decision === 'CONTINUE_IMPLEMENTATION') {
      errors.push('UNKNOWN cannot authorize CONTINUE_IMPLEMENTATION')
    }
  }
  if (role === 'REVIEW_VERDICT') {
    const verdict = body.match(/^\*\*Verdict:\*\*\s*(.+?)\s*$/m)?.[1]?.trim()
    if (!CORE_VERDICTS.includes(verdict)) errors.push('Verdict must use the Core review verdict enum')
  }
  return { errors, role }
}

/**
 * Reconstruct the immutable canonical correction contract from the latest
 * correction-eligible REVIEW_VERDICT on the live Issue. This is the only
 * supported source of canonical findings for a correction RESULT — there is
 * no caller-supplied override, so the normal posting path cannot bypass
 * identity, base, diff, or prohibited-scope validation by omitting an input.
 * @param {{ issue: string, repo: string | null }} options
 */
function reconstructCanonicalContract({ issue, repo }) {
  const args = ['issue', 'view', issue, '--json', 'comments']
  if (repo) args.push('--repo', repo)
  const result = spawnSync('gh', args, { encoding: 'utf8' })
  if (result.error || result.status !== 0) {
    return {
      ok: false,
      errors: [
        `unable to reconstruct the canonical correction contract from Issue #${issue}: ${
          result.stderr?.trim() || result.error?.message || 'gh issue view failed'
        }`,
      ],
    }
  }

  let payload
  try {
    payload = JSON.parse(result.stdout)
  } catch (error) {
    return {
      ok: false,
      errors: [`invalid issue comments JSON while reconstructing the canonical contract: ${
        error instanceof Error ? error.message : String(error)
      }`],
    }
  }

  const comments = Array.isArray(payload.comments) ? projectComments(payload.comments) : []
  const latestVerdict = findLatestRoleComment(comments, 'REVIEW_VERDICT')
  if (!latestVerdict?.comment?.body) {
    return { ok: false, errors: ['no REVIEW_VERDICT comment was found on the Issue to reconstruct the canonical contract'] }
  }
  if (latestVerdict.parsed?.verdict !== 'CORRECTION REQUIRED') {
    return {
      ok: false,
      errors: [`latest REVIEW_VERDICT is ${latestVerdict.parsed?.verdict ?? 'unknown'}, not CORRECTION REQUIRED`],
    }
  }

  const parsed = parseCorrectionContract(latestVerdict.comment.body)
  if (!parsed.ok) return { ok: false, errors: parsed.errors }
  return { ok: true, contract: parsed.contract }
}

/**
 * Reconstruct the actual changed files for the correction by diffing the
 * working tree against the immutable canonical reviewed_head — never a
 * caller-supplied path list.
 * @param {{ reviewedHead: string }} options
 */
function reconstructCorrectionDiffFiles({ reviewedHead }) {
  const result = spawnSync('git', ['diff', '--name-only', reviewedHead, 'HEAD'], { encoding: 'utf8' })
  if (result.error || result.status !== 0) {
    return {
      ok: false,
      errors: [
        `unable to reconstruct the actual correction diff against reviewed_head ${reviewedHead}: ${
          result.stderr?.trim() || result.error?.message || 'git diff failed'
        }`,
      ],
    }
  }
  const files = result.stdout.split('\n').map((line) => line.trim()).filter(Boolean)
  return { ok: true, files }
}

function hasNonEmptyField(body, field) {
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (field.startsWith('###')) {
    return new RegExp(`^${escapedField}[ \\t]*\\r?\\n(?![ \\t]*(?:#|<!--))[ \\t]*(?:[-*][ \\t]+)?\\S`, 'mi').test(body)
  }
  return new RegExp(`^[ \\t]*(?:[-*][ \\t]+)?${escapedField}[ \\t]*\\S`, 'mi').test(body)
}

function readFieldValue(body, field) {
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^[ \\t]*${escapedField}[ \\t]*(.+?)\\s*$`, 'mi').exec(body)?.[1]?.trim() ?? ''
}

function createBodyFile(body) {
  const directory = mkdtempSync(join(tmpdir(), 'bemoat-role-comment-'))
  const path = join(directory, 'comment.md')
  writeFileSync(path, body, 'utf8')
  return { directory, path }
}

function readLiveRoleComments({ issue, repo }) {
  const args = ['issue', 'view', issue, '--json', 'comments']
  if (repo) args.push('--repo', repo)
  const result = spawnSync('gh', args, { encoding: 'utf8' })
  if (result.error || result.status !== 0) {
    throw new Error(
      result.stderr || result.stdout || result.error?.message || 'live role-comment readback failed',
    )
  }
  const payload = JSON.parse(result.stdout)
  if (Array.isArray(payload)) return normalizeIssueComments(payload)
  if (Array.isArray(payload?.comments)) return normalizeIssueComments(payload.comments)
  return parsePaginatedGhApiJson(result.stdout)
}

function extractPostedCommentId(stdout) {
  const text = String(stdout ?? '').trim()
  if (!text) return null
  try {
    const payload = JSON.parse(text)
    if (payload?.id != null) return String(payload.id)
  } catch {
    // `gh issue comment` normally returns a URL rather than JSON.
  }
  return text.match(/(?:issuecomment-|comments\/)(\d+)/i)?.[1] ?? null
}

function main() {
  let command = null
  let invocation = null

  try {
    command = resolveRoleCommentCommand()
    invocation = parseCommandInvocation(command, process.argv.slice(2))

    if (invocation.mode === 'help') {
      renderHelp(invocation)
      return
    }

    const options = {
      issue: invocation.values.issue_number,
      repo: invocation.values.repository ?? null,
      bodyFile: invocation.values.body_file ?? null,
      check: invocation.values.check === true,
      allowWarning: invocation.values.allow_warning === true,
    }

    const body = readBody(options.bodyFile)
    const { errors, role } = validationErrors(body)
    if (errors.length) {
      throw runtimeError('EVIDENCE_CONFLICT', errors.join('; '), { errors })
    }

    let canonicalContract = null
    let diffFiles = []
    if (role === 'RESULT' && isCorrectionPhaseResult(body)) {
      const contractResult = reconstructCanonicalContract({ issue: options.issue, repo: options.repo })
      if (!contractResult.ok) {
        throw runtimeError('EVIDENCE_CONFLICT', contractResult.errors.join('; '), {
          errors: contractResult.errors,
        })
      }
      const diffResult = reconstructCorrectionDiffFiles({
        reviewedHead: contractResult.contract.reviewed_head,
      })
      if (!diffResult.ok) {
        throw runtimeError('EVIDENCE_CONFLICT', diffResult.errors.join('; '), {
          errors: diffResult.errors,
        })
      }
      canonicalContract = contractResult.contract
      diffFiles = diffResult.files
    }

    const correction = validateCorrectionRoleComment({
      role,
      body,
      diffFiles,
      canonicalContract,
    })
    if (!correction.ok) {
      throw runtimeError('EVIDENCE_CONFLICT', correction.errors.join('; '), {
        errors: correction.errors,
      })
    }

    const legacyOutput = []
    if (body.length > MAX_COMPACT_LENGTH && !options.allowWarning) {
      throw runtimeError(
        'EVIDENCE_CONFLICT',
        `WARNING: ${role} is ${body.length} characters; rerun with --allow-warning to acknowledge.`,
        {
          legacyOutput: [
            `WARNING: ${role} is ${body.length} characters; rerun with --allow-warning to acknowledge.`,
          ],
        },
      )
    }
    if (body.length > MAX_COMPACT_LENGTH) {
      legacyOutput.push(`WARNING: posting acknowledged long ${role} comment.`)
    }

    const parsedBody = parseRoleCommentBody(body)

    if (options.check) {
      renderResult({
        command,
        format: invocation.format,
        options,
        role,
        legacyClassification: null,
        legacyOutput,
        mutationPerformed: false,
        parsedBody,
      })
      return
    }

    let priorComments
    try {
      priorComments = readLiveRoleComments(options)
    } catch (error) {
      throw runtimeError(
        'BLOCKED_EXTERNAL',
        error instanceof Error ? error.message : String(error),
      )
    }
    const temporary = createBodyFile(body)
    const args = ['issue', 'comment', options.issue]
    if (options.repo) args.push('--repo', options.repo)
    args.push('--body-file', temporary.path)
    let postResult
    try {
      postResult = spawnSync('gh', args, { encoding: 'utf8' })
    } finally {
      rmSync(temporary.directory, { recursive: true, force: true })
    }
    if (postResult.error || postResult.status !== 0) {
      throw runtimeError(
        'AMBIGUOUS_RESULT',
        postResult.stderr || postResult.error?.message || 'gh issue comment failed',
        { mutationPerformed: true },
      )
    }

    let durableComment
    let readbackId = null
    try {
      const postedId = extractPostedCommentId(postResult.stdout)
      readbackId = postedId
      const liveComments = readLiveRoleComments(options)
      const priorIds = new Set(
        priorComments
          .map((comment) => comment.id)
          .filter((id) => id != null)
          .map((id) => String(id)),
      )
      const newComments = liveComments.filter(
        (comment) => comment.id != null && !priorIds.has(String(comment.id)),
      )
      readbackId = postedId ?? (newComments.length === 1 ? newComments[0].id : null)
      durableComment = verifyPostedCommentReadback({
        comments: liveComments,
        body,
        role,
        postedId: readbackId,
        matchOptions: resolveProductionCommentTrust(),
      })
    } catch (error) {
      throw runtimeError(
        'AMBIGUOUS_RESULT',
        `posted ${role} comment could not be confirmed by live readback: ${
          error instanceof Error ? error.message : String(error)
        }`,
        {
          mutationPerformed: true,
          postedCommentId: readbackId,
          legacyClassification: 'POSTED',
        },
      )
    }

    renderResult({
      command,
      format: invocation.format,
      options,
      role,
      legacyClassification: 'POSTED',
      legacyOutput,
      mutationPerformed: true,
      parsedBody,
      commentId: durableComment.id,
    })
  } catch (error) {
    const format = invocation?.format ?? (process.argv.includes('--json') ? 'json' : 'text')
    renderRuntimeError({
      command: command ?? COMMAND,
      format,
      error,
      values: invocation?.values,
    })
  }
}

main()
