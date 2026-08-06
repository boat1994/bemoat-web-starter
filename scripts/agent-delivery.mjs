#!/usr/bin/env node
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { analyzeExactHeadCi } from './agent-issue.mjs'
import { parseMissionControlState, projectMissionControlStateBlock, renderMissionControlState as renderStateBlock } from './mission-control-state.mjs'
import {
  proposeDeliveryReconciliation,
  parseRoleCommentBody,
  Coordinator,
  normalizeIssueComments,
  parsePaginatedGhApiJson,
  findMatchingComments,
  normalizeTransitionIdentity,
  verifyStatePostcondition,
  resolveProductionCommentTrust,
} from './mission-control-reconcile.mjs'
import { writeIssueBodyWithLease } from './mission-control-issue-body-cas.mjs'
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

const COMMAND = 'bemoat:agent:delivery'
const ENTRYPOINT = 'scripts/agent-delivery.mjs'

function runtimeError(classification, message, details = {}) {
  const error = new Error(message)
  error.classification = classification
  Object.assign(error, details)
  return error
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options })
  if (result.error || result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}\n${result.stderr || result.stdout || result.error?.message}`)
  }
  return result.stdout.trim()
}

function tryRun(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', input: options.input, env: options.env, ...options })
}

function resolveDeliveryCommand() {
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
    if (typeof error.legacyClassification === 'string') {
      details.legacy_classification = error.legacyClassification
    }
  }

  return details
}

function renderRuntimeError({
  command,
  format,
  error,
  mutationPerformed = false,
  values = {},
  parsedBody = null,
}) {
  const classification = runtimeClassification(error)
  const details = runtimeDetails(error)
  const mutated = Boolean(
    mutationPerformed ||
    (error && typeof error === 'object' && error.mutationPerformed === true),
  )

  if (format === 'json' && command) {
    process.stdout.write(`${JSON.stringify(createResultEnvelopeV1({
      command,
      outcome: 'ERROR',
      classification,
      mutation_performed: mutated,
      repository: values.repository ?? null,
      issue_number: values.issue_number ?? null,
      pr_number: parsedBody?.prNumber ?? null,
      exact_head: /^[0-9a-f]{40}$/i.test(parsedBody?.headSha ?? '')
        ? parsedBody.headSha.toLowerCase()
        : null,
      next_action: {
        type: 'STOP',
        command: null,
        reason: details.reason,
      },
      details,
    }))}\n`)
  } else if (error instanceof CliInvocationError) {
    process.stderr.write(`${classification}: ${details.reason}\n`)
  } else if (
    classification === 'BLOCKED_EXTERNAL' &&
    !/ambiguous POST|Failed to validate RESULT comment/i.test(details.reason)
  ) {
    process.stdout.write(`${classification}: ${details.reason}\n`)
  } else {
    const legacyPrefix = details.legacy_classification
      ? `${details.legacy_classification}: `
      : ''
    process.stderr.write(`ERROR: ${classification}: ${legacyPrefix}${details.reason}\n`)
  }

  process.exitCode = classificationExitCode(classification)
}

function renderResult({
  command,
  format,
  options,
  result,
  expectedRepo,
  localCommit,
  observedPreState,
}) {
  const output = `Delivery reconciliation successful. RESULT comment ${result.comment.id} posted and state updated.`
  const envelope = createResultEnvelopeV1({
    command,
    outcome: 'SUCCESS',
    classification: 'SUCCESS',
    mutation_performed: true,
    observed_pre_state: observedPreState,
    resulting_state: result.state?.state ?? null,
    repository: expectedRepo,
    issue_number: options.issue,
    pr_number: options.prNumber,
    exact_head: /^[0-9a-f]{40}$/i.test(localCommit) ? localCommit.toLowerCase() : null,
    next_action: {
      type: 'COMMAND',
      command: 'bemoat:mission-control:review',
      reason: 'The delivered head is ready for the registered review route.',
    },
    details: {
      legacy_classification: result.outcome,
      legacy_output: [output],
      comment_id: String(result.comment.id),
    },
  })

  if (format === 'json') {
    process.stdout.write(`${JSON.stringify(envelope)}\n`)
  } else {
    process.stdout.write(`SUCCESS: ${output}\n`)
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

function sameState(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function main() {
  mainAsync()
}

async function mainAsync() {
  let command = null
  let invocation = null
  let mutationPerformed = false
  let parsed = null
  let body = null
  let parsedBody = null

  try {
    command = resolveDeliveryCommand()
    invocation = parseCommandInvocation(command, process.argv.slice(2))

    if (invocation.mode === 'help') {
      renderHelp(invocation)
      return
    }

    parsed = {
      options: {
        issue: invocation.values.issue_number,
        repo: invocation.values.repository ?? null,
        bodyFile: invocation.values.body_file ?? null,
      },
    }

    body = readBody(parsed.options.bodyFile)

  parsedBody = parseRoleCommentBody(body)
  if (parsedBody.role !== 'RESULT') {
    throw runtimeError('EVIDENCE_CONFLICT', 'Delivery requires a RESULT comment body')
  }

  const resultPr = parsedBody.prNumber
  if (!resultPr) {
    throw runtimeError('STATE_CONFLICT', 'RESULT PR identifier missing')
  }

  // 1. resolve expected delivered commit
  let localCommit
  try {
    localCommit = run('git', ['rev-parse', 'HEAD'])
  } catch (error) {
    throw runtimeError(
      'BLOCKED_EXTERNAL',
      `Could not resolve local commit: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  // 2. verifies the remote branch ref equals that commit
  const currentBranch = run('git', ['branch', '--show-current'])
  const lsRemote = tryRun('git', ['ls-remote', 'origin', currentBranch])
  if (lsRemote.status !== 0 || !lsRemote.stdout.includes(localCommit)) {
    throw runtimeError('STATE_CONFLICT', `Remote branch ref does not equal local commit ${localCommit}`)
  }

  // 3. & 4. verifies the live Pulls API head equals the same commit, and expected transport target
  const ghArgs = ['pr', 'view', resultPr, '--json', 'headRefOid,statusCheckRollup,headRepository,headRefName,baseRefName']
  if (parsed.options.repo) ghArgs.push('--repo', parsed.options.repo)
  const prResult = tryRun('gh', ghArgs)
  if (prResult.status !== 0) {
    throw runtimeError('BLOCKED_EXTERNAL', 'GitHub PR lookup failed')
  }

  let prData
  try {
    prData = JSON.parse(prResult.stdout)
  } catch {
    throw runtimeError('BLOCKED_EXTERNAL', 'Invalid PR JSON')
  }

  if (prData.headRefOid !== localCommit) {
    throw runtimeError('STATE_CONFLICT', `PR head ${prData.headRefOid} does not match local commit ${localCommit}`)
  }

  if (prData.headRefName !== currentBranch) {
    throw runtimeError('STATE_CONFLICT', `PR headRefName ${prData.headRefName} does not match local branch ${currentBranch}`)
  }

  let expectedRepo = parsed.options.repo
  if (!expectedRepo) {
    const repoResult = tryRun('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'])
    if (repoResult.status === 0) expectedRepo = repoResult.stdout.trim()
  }
  if (!expectedRepo) {
    throw runtimeError('BLOCKED_EXTERNAL', 'Canonical PR repository is unavailable')
  }
  if (prData.headRepository?.nameWithOwner && expectedRepo && prData.headRepository.nameWithOwner !== expectedRepo) {
    throw runtimeError(
      'STATE_CONFLICT',
      `PR head repository ${prData.headRepository.nameWithOwner} does not match expected repository ${expectedRepo}`,
    )
  }

  // 5. requires all configured exact-head workflows on that commit
  const ciAnalysis = analyzeExactHeadCi(prData)
  if (!ciAnalysis.exactHeadVerified) {
    throw runtimeError('STATE_CONFLICT', `Exact-head CI not verified: ${ciAnalysis.summary}`)
  }

  // 6. updates the canonical Issue state only after all evidence agrees
  const issueArgs = ['issue', 'view', parsed.options.issue, '--json', 'body']
  if (parsed.options.repo) issueArgs.push('--repo', parsed.options.repo)
  const issueResult = tryRun('gh', issueArgs)
  if (issueResult.status !== 0) {
    throw runtimeError('BLOCKED_EXTERNAL', 'GitHub issue lookup failed')
  }
  const issueData = JSON.parse(issueResult.stdout)
  const currentState = parseMissionControlState(issueData.body)

  if (currentState.present && !currentState.valid) {
    throw runtimeError('STATE_CONFLICT', `Issue has invalid Mission Control state: ${currentState.reason}`)
  }

  const deliveryTimestamp = new Date().toISOString()
  const newStateProposal = proposeDeliveryReconciliation({
    managedState: currentState.state,
    livePr: { number: resultPr, headRefOid: localCommit, baseRefName: prData.baseRefName || 'main' },
    activeTaskIssue: parsed.options.issue,
    approvedBase: currentState.state?.approved_base ?? prData.baseRefName ?? 'main',
    latestResult: { parsed: parsedBody },
    updatedAt: deliveryTimestamp,
    updatedBy: 'Mission Control',
  })

  let stateObj = currentState.state || {}
  stateObj = { ...stateObj, ...newStateProposal }
  if (!stateObj.schema_version) stateObj.schema_version = 1
  if (!stateObj.guide_version) stateObj.guide_version = '1.0.0'
  if (!stateObj.guide_source_ref) stateObj.guide_source_ref = 'main'
  if (!stateObj.material_change_status) stateObj.material_change_status = 'none'

  let expectedBody = issueData.body
  const verifyLivePullRequest = () => {
    const livePrResult = tryRun('gh', ghArgs)
    if (livePrResult.status !== 0) {
      throw runtimeError('BLOCKED_EXTERNAL', 'GitHub PR lookup failed during final validation')
    }
    let livePr
    try {
      livePr = JSON.parse(livePrResult.stdout)
    } catch {
      throw runtimeError('BLOCKED_EXTERNAL', 'Invalid PR JSON during final validation')
    }
    if (livePr.headRefOid !== localCommit) {
      throw runtimeError('HEAD_DRIFT', `PR head ${livePr.headRefOid} drifted from local commit ${localCommit}`)
    }
    if (livePr.headRefName !== currentBranch) {
      throw runtimeError('HEAD_DRIFT', `PR headRefName ${livePr.headRefName} drifted from local branch ${currentBranch}`)
    }
    const liveCiAnalysis = analyzeExactHeadCi(livePr)
    if (!liveCiAnalysis.exactHeadVerified) {
      throw runtimeError('STATE_CONFLICT', `Exact-head CI not verified during final validation: ${liveCiAnalysis.summary}`)
    }
    return livePr
  }
  const listLiveComments = () => {
    verifyLivePullRequest()
    const listResult = tryRun('gh', [
      'api',
      '--paginate',
      `repos/${expectedRepo}/issues/${parsed.options.issue}/comments`,
    ])
    if (listResult.status !== 0) {
      throw new Error(`BLOCKED_EXTERNAL: GitHub issue comment lookup failed\n${listResult.stderr || listResult.stdout || ''}`)
    }
    return normalizeIssueComments(parsePaginatedGhApiJson(listResult.stdout))
  }

  const commentTrust = resolveProductionCommentTrust()
  const coordinator = new Coordinator({
    readState: async () => {
      const liveIssueResult = tryRun('gh', issueArgs)
      if (liveIssueResult.status !== 0) throw new Error('BLOCKED_EXTERNAL: GitHub issue lookup failed')
      const live = JSON.parse(liveIssueResult.stdout)
      const parsedState = parseMissionControlState(live.body)
      if (parsedState.present && !parsedState.valid) {
        throw new Error(`STATE_CONFLICT: Issue has invalid Mission Control state: ${parsedState.reason}`)
      }
      expectedBody = live.body
      return parsedState.state ?? {}
    },
    writeState: async (nextState, expectedState) => {
      const liveIssueResult = tryRun('gh', issueArgs)
      if (liveIssueResult.status !== 0) throw new Error('BLOCKED_EXTERNAL: GitHub issue lookup failed before state write')
      const live = JSON.parse(liveIssueResult.stdout)
      const liveParsed = parseMissionControlState(live.body)
      if (liveParsed.present && !liveParsed.valid) {
        throw new Error(`STATE_CONFLICT: Issue has invalid Mission Control state: ${liveParsed.reason}`)
      }
      if (expectedState && !sameState(liveParsed.state ?? {}, expectedState)) {
        throw new Error('STATE_CONFLICT: concurrent Issue write detected before state write')
      }
      if (expectedBody !== null && live.body !== expectedBody) {
        throw new Error('STATE_CONFLICT: concurrent Issue body change detected before state write')
      }
      const observedBody = live.body
      let newBody = observedBody
      if (liveParsed.present) {
        newBody = projectMissionControlStateBlock(newBody, nextState)
      } else {
        newBody = `${newBody}\n\n${renderStateBlock(nextState)}\n`
      }
      mutationPerformed = true
      await writeIssueBodyWithLease({
        repo: expectedRepo,
        issueNumber: parsed.options.issue,
        expectedBody: observedBody,
        nextBody: newBody,
        transitionIdentity: nextState?.latest_transition_identity ?? null,
        holder: 'agent-delivery',
        repoFlag: parsed.options.repo,
        deps: {
          runGh: (args, ghOptions = {}) => {
            const result = tryRun('gh', args, ghOptions)
            if (result.error || result.status !== 0) {
              const detail = result.stderr || result.stdout || result.error?.message || 'gh failed'
              const error = new Error(detail)
              error.status = result.status
              error.stderr = result.stderr
              error.stdout = result.stdout
              throw error
            }
            return result.stdout.trim()
          },
        },
      })
      const verifiedResult = tryRun('gh', issueArgs)
      if (verifiedResult.status !== 0) throw new Error('BLOCKED_EXTERNAL: GitHub issue lookup failed after state write')
      const verified = JSON.parse(verifiedResult.stdout)
      const verifiedParsed = parseMissionControlState(verified.body)
      if (!verifiedParsed.present || !verifiedParsed.valid) {
        throw new Error('STATE_CONFLICT: Issue state unreadable after write')
      }
      try {
        verifyStatePostcondition(nextState, verifiedParsed.state, [
          'state', 'active_pr', 'current_head', 'review_cycle', 'full_review_count',
          'latest_transition_identity', 'latest_result_comment_id',
        ])
      } catch (error) {
        throw new Error(`STATE_CONFLICT: concurrent Issue write detected after state write: ${error instanceof Error ? error.message : String(error)}`)
      }
      expectedBody = verified.body
      return verifiedParsed.state
    },
    listComments: async () => listLiveComments(),
    postComment: async (commentBody) => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'bemoat-delivery-'))
      const tmpComment = join(tmpDir, 'comment.md')
      const payloadFile = join(tmpDir, 'payload.json')
      try {
        writeFileSync(tmpComment, commentBody)
        const checkArgs = ['scripts/post-role-comment.mjs', parsed.options.issue, '--body-file', tmpComment, '--check']
        if (parsed.options.repo) checkArgs.push('--repo', parsed.options.repo)
        const checkResult = tryRun('node', checkArgs, {
          env: { ...process.env, npm_lifecycle_event: undefined },
        })
        if (checkResult.status !== 0) {
          throw new Error(`STATE_CONFLICT: Failed to validate RESULT comment\n${checkResult.stderr || checkResult.stdout || ''}`)
        }
        writeFileSync(payloadFile, JSON.stringify({ body: commentBody }))
        const postResult = tryRun('gh', [
          'api',
          '--method',
          'POST',
          `repos/${expectedRepo}/issues/${parsed.options.issue}/comments`,
          '--input',
          payloadFile,
        ])
        if (postResult.status !== 0) {
          // Ambiguous POST: recovery rereads live comments (not a process-local array).
          throw runtimeError(
            'AMBIGUOUS_RESULT',
            `Failed to post RESULT comment\n${postResult.stderr || postResult.stdout || ''}`,
            {
              mutationPerformed: true,
              legacyClassification: 'STATE_CONFLICT',
            },
          )
        }
        mutationPerformed = true
        let posted
        try {
          posted = JSON.parse(postResult.stdout)
        } catch (error) {
          throw runtimeError(
            'AMBIGUOUS_RESULT',
            `Posted RESULT response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
            {
              mutationPerformed: true,
              legacyClassification: 'STATE_CONFLICT',
            },
          )
        }
        if (posted?.id == null) {
          const identity = normalizeTransitionIdentity(commentBody, { role: 'RESULT' })
          const recovered = findMatchingComments(listLiveComments(), identity, {
            activeOnly: true,
            ...commentTrust,
          })
          if (recovered.length === 1) return recovered[0]
          throw runtimeError(
            'AMBIGUOUS_RESULT',
            'posted RESULT did not return a durable comment identifier',
            {
              mutationPerformed: true,
              legacyClassification: 'STATE_CONFLICT',
            },
          )
        }
        return {
          id: posted.id,
          body: posted.body ?? commentBody,
          author: posted.user?.login ?? null,
          author_association: posted.author_association ?? null,
          url: posted.html_url ?? posted.url ?? null,
          createdAt: posted.created_at ?? null,
        }
      } finally {
        rmSync(tmpDir, { recursive: true, force: true })
      }
    },
    ...commentTrust,
  })

  const result = await coordinator.integrateResult({
    resultBody: body,
    projectState: () => stateObj,
    verifyPreconditions: async () => undefined,
    updatedAt: deliveryTimestamp,
    updatedBy: 'Mission Control',
  })

  if (result.outcome === 'RECOVERABLE_ROUTING_DRIFT') {
    throw runtimeError(
      'AMBIGUOUS_RESULT',
      `comment posted but state update failed: ${result.error}`,
      {
        mutationPerformed: true,
        legacyClassification: result.outcome,
      },
    )
  }

  // Live postconditions: Issue state + comment id + PR head.
  if (!result.comment?.id) {
    throw runtimeError('STATE_CONFLICT', 'RESULT integration did not retain a live comment id')
  }
  const liveComments = listLiveComments()
  const bound = liveComments.find((comment) => String(comment.id) === String(result.comment.id))
  if (!bound) {
    throw runtimeError('AMBIGUOUS_RESULT', `RESULT comment ${result.comment.id} was not found on live Issue comments`, {
      mutationPerformed: true,
      legacyClassification: 'STATE_CONFLICT',
    })
  }
  if (prData.headRefOid !== localCommit) {
    throw runtimeError('AMBIGUOUS_RESULT', 'PR head drifted during delivery', {
      mutationPerformed: true,
      legacyClassification: 'STATE_CONFLICT',
    })
  }
  if (result.state?.latest_result_comment_id && String(result.state.latest_result_comment_id) !== String(result.comment.id)) {
    throw runtimeError('AMBIGUOUS_RESULT', 'live state is not bound to the posted RESULT comment id', {
      mutationPerformed: true,
      legacyClassification: 'STATE_CONFLICT',
    })
  }

  renderResult({
    command,
    format: invocation.format,
    options: { ...parsed.options, prNumber: resultPr },
    result,
    expectedRepo,
    localCommit,
    observedPreState: currentState.state?.state ?? null,
  })
  } catch (error) {
    renderRuntimeError({
      command: command ?? COMMAND,
      format: invocation?.format ?? (process.argv.includes('--json') ? 'json' : 'text'),
      error,
      mutationPerformed,
      values: invocation?.values,
      parsedBody,
    })
  }
}

main()
