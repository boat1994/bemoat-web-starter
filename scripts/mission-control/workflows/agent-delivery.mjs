import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { analyzeExactHeadCi } from '../../agent-issue/exact-head-ci.mjs'
import { classifyDelegatedFailure } from '../../cli/command-result.mjs'
import { parseMissionControlState, projectMissionControlStateBlock, renderMissionControlState } from '../domain/task-state.mjs'
import { normalizeIssueComments, parsePaginatedGhApiJson, resolveProductionCommentTrust, verifyPostedCommentReadback } from '../comment-evidence.ts'
import { proposeDeliveryReconciliation } from '../reconciliation-proposals.mjs'
import { parseRoleCommentBody, normalizeAuthorityBase, normalizeAuthorityHead } from '../review-verdict-binding.mjs'
import { verifyStatePostcondition } from '../state-verification.mjs'

function runtimeError(classification, message, details = {}) {
  const error = new Error(message)
  error.classification = classification
  Object.assign(error, details)
  return error
}

function sameState(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function parseExactRemoteCommit(stdout, branch) {
  const expectedRef = `refs/heads/${branch}`
  const matches = String(stdout ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim().match(/^([0-9a-f]{40})\s+(\S+)$/i))
    .filter((match) => match?.[2] === expectedRef)

  return matches.length === 1 ? matches[0][1].toLowerCase() : null
}

/**
 * Execute the delivery workflow after the public CLI has parsed its inputs.
 * Process, Coordinator, and CAS transports are injected by the root facade so
 * this workflow owner never imports root implementation modules.
 */
export async function runAgentDeliveryWorkflow({
  issue,
  repo: requestedRepo = null,
  body,
  dependencies,
  onMutation = () => {},
}) {
  const {
    run,
    tryRun,
    createCoordinator,
    writeIssueBodyWithLease,
  } = dependencies

  const parsedBody = parseRoleCommentBody(body)
  if (parsedBody.role !== 'RESULT') {
    throw runtimeError('EVIDENCE_CONFLICT', 'Delivery requires a RESULT comment body')
  }

  const resultPr = parsedBody.prNumber
  if (!resultPr) {
    throw runtimeError('STATE_CONFLICT', 'RESULT PR identifier missing')
  }

  let localCommit
  try {
    localCommit = normalizeAuthorityHead(run('git', ['rev-parse', 'HEAD']))
  } catch (error) {
    throw runtimeError(
      'BLOCKED_EXTERNAL',
      `Could not resolve local commit: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!/^[0-9a-f]{40}$/i.test(localCommit)) {
    throw runtimeError('STATE_CONFLICT', `Local commit is not a full SHA: ${localCommit}`)
  }

  const currentBranch = run('git', ['branch', '--show-current'])
  const lsRemote = tryRun('git', ['ls-remote', 'origin', currentBranch])
  const remoteCommit = lsRemote.status === 0
    ? parseExactRemoteCommit(lsRemote.stdout, currentBranch)
    : null
  if (remoteCommit !== localCommit) {
    throw runtimeError('STATE_CONFLICT', `Remote branch ref does not equal local commit ${localCommit}`)
  }

  const ghArgs = ['pr', 'view', resultPr, '--json', 'headRefOid,statusCheckRollup,headRepository,headRefName,baseRefName']
  if (requestedRepo) ghArgs.push('--repo', requestedRepo)
  const prResult = tryRun('gh', ghArgs)
  if (prResult.status !== 0) throw runtimeError('BLOCKED_EXTERNAL', 'GitHub PR lookup failed')

  let prData
  try {
    prData = JSON.parse(prResult.stdout)
  } catch {
    throw runtimeError('BLOCKED_EXTERNAL', 'Invalid PR JSON')
  }

  const prHead = normalizeAuthorityHead(prData.headRefOid)
  if (prHead !== localCommit) {
    throw runtimeError('STATE_CONFLICT', `PR head ${prHead} does not match local commit ${localCommit}`)
  }
  if (prData.headRefName !== currentBranch) {
    throw runtimeError('STATE_CONFLICT', `PR headRefName ${prData.headRefName} does not match local branch ${currentBranch}`)
  }

  let expectedRepo = requestedRepo
  if (!expectedRepo) {
    const repoResult = tryRun('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'])
    if (repoResult.status === 0) expectedRepo = repoResult.stdout.trim()
  }
  if (!expectedRepo) throw runtimeError('BLOCKED_EXTERNAL', 'Canonical PR repository is unavailable')
  if (prData.headRepository?.nameWithOwner && prData.headRepository.nameWithOwner !== expectedRepo) {
    throw runtimeError(
      'STATE_CONFLICT',
      `PR head repository ${prData.headRepository.nameWithOwner} does not match expected repository ${expectedRepo}`,
    )
  }

  const ciAnalysis = analyzeExactHeadCi(prData)
  if (!ciAnalysis.exactHeadVerified) {
    throw runtimeError('STATE_CONFLICT', `Exact-head CI not verified: ${ciAnalysis.summary}`)
  }

  const issueArgs = ['issue', 'view', issue, '--json', 'body']
  if (requestedRepo) issueArgs.push('--repo', requestedRepo)
  const issueResult = tryRun('gh', issueArgs)
  if (issueResult.status !== 0) throw runtimeError('BLOCKED_EXTERNAL', 'GitHub issue lookup failed')
  const issueData = JSON.parse(issueResult.stdout)
  const currentState = parseMissionControlState(issueData.body)
  if (currentState.present && !currentState.valid) {
    throw runtimeError('STATE_CONFLICT', `Issue has invalid Mission Control state: ${currentState.reason}`)
  }

  const liveBase = normalizeAuthorityBase(prData.baseRefName)
  const resultBase = normalizeAuthorityBase(parsedBody.base)
  const approvedBase = normalizeAuthorityBase(currentState.state?.approved_base)
  if (!liveBase || !approvedBase || liveBase !== approvedBase) {
    throw runtimeError('STATE_CONFLICT', 'live PR base differs from managed approved base')
  }
  if (!resultBase || resultBase !== liveBase) {
    throw runtimeError('STATE_CONFLICT', `RESULT base ${resultBase || '(missing)'} does not match live PR base ${liveBase}`)
  }

  const deliveryTimestamp = new Date().toISOString()
  const newStateProposal = proposeDeliveryReconciliation({
    managedState: currentState.state,
    livePr: { number: resultPr, headRefOid: localCommit, baseRefName: liveBase },
    activeTaskIssue: issue,
    approvedBase,
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
    if (livePrResult.status !== 0) throw runtimeError('BLOCKED_EXTERNAL', 'GitHub PR lookup failed during final validation')
    let livePr
    try {
      livePr = JSON.parse(livePrResult.stdout)
    } catch {
      throw runtimeError('BLOCKED_EXTERNAL', 'Invalid PR JSON during final validation')
    }
    const liveHead = normalizeAuthorityHead(livePr.headRefOid)
    if (liveHead !== localCommit) throw runtimeError('HEAD_DRIFT', `PR head ${liveHead} drifted from local commit ${localCommit}`)
    if (livePr.headRefName !== currentBranch) throw runtimeError('HEAD_DRIFT', `PR headRefName ${livePr.headRefName} drifted from local branch ${currentBranch}`)
    if (normalizeAuthorityBase(livePr.baseRefName) !== liveBase) {
      throw runtimeError('STATE_CONFLICT', `PR base ${livePr.baseRefName ?? '(missing)'} drifted from expected base ${liveBase}`)
    }
    const liveCiAnalysis = analyzeExactHeadCi(livePr)
    if (!liveCiAnalysis.exactHeadVerified) throw runtimeError('STATE_CONFLICT', `Exact-head CI not verified during final validation: ${liveCiAnalysis.summary}`)
    return livePr
  }

  const listLiveComments = () => {
    verifyLivePullRequest()
    const listResult = tryRun('gh', ['api', '--paginate', `repos/${expectedRepo}/issues/${issue}/comments`])
    if (listResult.status !== 0) throw new Error(`BLOCKED_EXTERNAL: GitHub issue comment lookup failed\n${listResult.stderr || listResult.stdout || ''}`)
    return normalizeIssueComments(parsePaginatedGhApiJson(listResult.stdout))
  }

  const commentTrust = resolveProductionCommentTrust()
  const coordinator = createCoordinator({
    readState: async () => {
      const liveIssueResult = tryRun('gh', issueArgs)
      if (liveIssueResult.status !== 0) throw new Error('BLOCKED_EXTERNAL: GitHub issue lookup failed')
      const live = JSON.parse(liveIssueResult.stdout)
      const parsedState = parseMissionControlState(live.body)
      if (parsedState.present && !parsedState.valid) throw new Error(`STATE_CONFLICT: Issue has invalid Mission Control state: ${parsedState.reason}`)
      expectedBody = live.body
      return parsedState.state ?? {}
    },
    writeState: async (nextState, expectedState) => {
      const liveIssueResult = tryRun('gh', issueArgs)
      if (liveIssueResult.status !== 0) throw new Error('BLOCKED_EXTERNAL: GitHub issue lookup failed before state write')
      const live = JSON.parse(liveIssueResult.stdout)
      const liveParsed = parseMissionControlState(live.body)
      if (liveParsed.present && !liveParsed.valid) throw new Error(`STATE_CONFLICT: Issue has invalid Mission Control state: ${liveParsed.reason}`)
      if (expectedState && !sameState(liveParsed.state ?? {}, expectedState)) throw new Error('STATE_CONFLICT: concurrent Issue write detected before state write')
      if (expectedBody !== null && live.body !== expectedBody) throw new Error('STATE_CONFLICT: concurrent Issue body change detected before state write')
      const observedBody = live.body
      const newBody = liveParsed.present
        ? projectMissionControlStateBlock(observedBody, nextState)
        : `${observedBody}\n\n${renderMissionControlState(nextState)}\n`
      onMutation()
      await writeIssueBodyWithLease({
        repo: expectedRepo,
        issueNumber: issue,
        expectedBody: observedBody,
        nextBody: newBody,
        transitionIdentity: nextState?.latest_transition_identity ?? null,
        holder: 'agent-delivery',
        repoFlag: requestedRepo,
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
      if (!verifiedParsed.present || !verifiedParsed.valid) throw new Error('STATE_CONFLICT: Issue state unreadable after write')
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
        const checkArgs = ['scripts/post-role-comment.mjs', issue, '--body-file', tmpComment, '--check']
        if (requestedRepo) checkArgs.push('--repo', requestedRepo)
        const checkResult = tryRun('node', checkArgs, { env: { ...process.env, npm_lifecycle_event: undefined } })
        if (checkResult.status !== 0) {
          const reason = checkResult.stderr || checkResult.stdout || checkResult.error?.message || 'delegated role-comment validation failed'
          throw runtimeError(
            classifyDelegatedFailure({ command: 'node', stdout: checkResult.stdout, stderr: checkResult.stderr, error: checkResult.error }),
            `Failed to validate RESULT comment\n${reason}`,
          )
        }
        writeFileSync(payloadFile, JSON.stringify({ body: commentBody }))
        const postResult = tryRun('gh', ['api', '--method', 'POST', `repos/${expectedRepo}/issues/${issue}/comments`, '--input', payloadFile])
        let posted = null
        if (postResult.status !== 0) {
          throw runtimeError('AMBIGUOUS_RESULT', `Failed to post RESULT comment\n${postResult.stderr || postResult.stdout || ''}`, {
            mutationPerformed: true, postedCommentId: null, legacyClassification: 'STATE_CONFLICT',
          })
        }
        onMutation()
        try {
          posted = JSON.parse(postResult.stdout)
        } catch (error) {
          throw runtimeError('AMBIGUOUS_RESULT', `Posted RESULT response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`, {
            mutationPerformed: true, postedCommentId: posted?.id ?? null, legacyClassification: 'STATE_CONFLICT',
          })
        }
        try {
          return verifyPostedCommentReadback({ comments: listLiveComments(), body: commentBody, role: 'RESULT', postedId: posted?.id ?? null, matchOptions: commentTrust })
        } catch (error) {
          throw runtimeError('AMBIGUOUS_RESULT', `posted RESULT comment could not be confirmed by live readback: ${error instanceof Error ? error.message : String(error)}`, {
            mutationPerformed: true, postedCommentId: posted?.id ?? null, legacyClassification: 'STATE_CONFLICT',
          })
        }
      } finally {
        rmSync(tmpDir, { recursive: true, force: true })
      }
    },
    ...commentTrust,
    verifiedHead: localCommit,
    verifiedBase: liveBase,
  })

  let result
  try {
    result = await coordinator.integrateResult({
      resultBody: body,
      projectState: () => stateObj,
      verifyPreconditions: async () => undefined,
      updatedAt: deliveryTimestamp,
      updatedBy: 'Mission Control',
    })
  } catch (error) {
    if (onMutation) {
      if (error && typeof error === 'object' && error.mutationPerformed === true) onMutation()
    }
    throw error
  }

  if (result.outcome === 'RECOVERABLE_ROUTING_DRIFT') {
    throw runtimeError('AMBIGUOUS_RESULT', `comment posted but state update failed: ${result.error}`, {
      mutationPerformed: true, legacyClassification: result.outcome,
    })
  }
  if (!result.comment?.id) {
    throw runtimeError('AMBIGUOUS_RESULT', 'RESULT integration did not retain a live comment id', {
      mutationPerformed: true, legacyClassification: 'STATE_CONFLICT',
    })
  }

  try {
    verifyPostedCommentReadback({ comments: listLiveComments(), body, role: 'RESULT', postedId: result.comment.id, matchOptions: commentTrust })
  } catch (error) {
    throw runtimeError('AMBIGUOUS_RESULT', `RESULT comment could not be confirmed on final live readback: ${error instanceof Error ? error.message : String(error)}`, {
      mutationPerformed: true, postedCommentId: result.comment.id, legacyClassification: 'STATE_CONFLICT',
    })
  }
  if (normalizeAuthorityHead(prData.headRefOid) !== localCommit) {
    throw runtimeError('AMBIGUOUS_RESULT', 'PR head drifted during delivery', {
      mutationPerformed: true, legacyClassification: 'STATE_CONFLICT',
    })
  }
  if (result.state?.latest_result_comment_id && String(result.state.latest_result_comment_id) !== String(result.comment.id)) {
    throw runtimeError('AMBIGUOUS_RESULT', 'live state is not bound to the posted RESULT comment id', {
      mutationPerformed: true, legacyClassification: 'STATE_CONFLICT',
    })
  }

  return {
    result,
    expectedRepo,
    localCommit,
    prNumber: resultPr,
    observedPreState: currentState.state?.state ?? null,
  }
}
