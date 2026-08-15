import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  dispatchFounderAuthorizedCorrection,
  Coordinator,
  normalizeIssueComments,
  parsePaginatedGhApiJson,
  verifyStatePostcondition,
  resolveProductionCommentTrust,
  verifyPostedCommentReadback,
} from '../../mission-control-reconcile.mjs'
import { parseMissionControlState, projectMissionControlStateBlock } from '../domain/task-state.mjs'
import { writeIssueBodyWithLease } from './issue-body-cas.mjs'
import { preflightCanonicalBootstrapTask } from '../domain/task-bootstrap-preflight.ts'
import { runtimeError } from '../domain/dispatch-result-rendering.ts'

function issueArgs(options, fields) {
  const args = ['issue', 'view', options.issue, '--json', fields]
  if (options.repo) args.push('--repo', options.repo)
  return args
}

function sameState(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

export async function executeDispatchWorkflow({
  options,
  handoffBody,
  updatedAt,
  updatedBy,
  onObservedPreState,
  dependencies,
}) {
  const { run, execPath, env, roleCommentEntrypoint } = dependencies
  const repo = options.repo
  let expectedBody = null
  const readIssue = () => {
    const issue = JSON.parse(run('gh', issueArgs(options, 'number,id,title,body,state')))
    const parsed = parseMissionControlState(issue.body)
    if (!parsed.present || !parsed.valid) {
      throw new Error(`invalid managed state: ${parsed.reason ?? 'missing state block'}`)
    }
    onObservedPreState?.(parsed.state?.state ?? null)
    if (String(issue.body ?? '').includes('bemoat-mission-control-task-attestation:v1') && parsed.state?.active_pr) {
      const prNumber = String(parsed.state.active_pr).match(/#?(\d+)/)?.[1]
      if (!prNumber) throw new Error('STATE_CONFLICT: bootstrap Task active PR reference is unreadable')
      const pr = JSON.parse(run('gh', ['pr', 'view', prNumber, '--repo', repo, '--json', 'number,id,headRefOid,baseRefName,statusCheckRollup']))
      const bootstrapPreflight = preflightCanonicalBootstrapTask({ issue, pullRequest: pr, repository: repo })
      if (!bootstrapPreflight.ok) throw new Error(`${bootstrapPreflight.classification ?? 'STATE_CONFLICT'}: ${bootstrapPreflight.reason}`)
    }
    expectedBody = issue.body
    return parsed.state
  }
  const writeState = async (state, expectedState) => {
    const live = JSON.parse(run('gh', issueArgs(options, 'body')))
    const liveParsed = parseMissionControlState(live.body)
    if (!liveParsed.present || !liveParsed.valid) {
      throw new Error(`invalid managed state during write: ${liveParsed.reason ?? 'missing state block'}`)
    }
    if (expectedState && !sameState(liveParsed.state, expectedState)) throw new Error('STATE_CONFLICT: concurrent Issue write detected')
    if (expectedBody !== null && live.body !== expectedBody) throw new Error('STATE_CONFLICT: concurrent Issue write detected')
    const observedBody = live.body
    const nextBody = projectMissionControlStateBlock(observedBody, state)
    await writeIssueBodyWithLease({
      repo,
      issueNumber: options.issue,
      expectedBody: observedBody,
      nextBody,
      transitionIdentity: state?.latest_transition_identity ?? null,
      holder: 'mission-control-dispatch',
      repoFlag: options.repo,
      deps: { runGh: (args, ghOptions) => run('gh', args, ghOptions) },
    })
    const verified = JSON.parse(run('gh', issueArgs(options, 'body')))
    const verifiedParsed = parseMissionControlState(verified.body)
    if (!verifiedParsed.present || !verifiedParsed.valid) throw new Error('postcondition: Issue state unreadable after write')
    try {
      verifyStatePostcondition(state, verifiedParsed.state, ['state', 'latest_transition_identity', 'latest_handoff_comment_id', 'next_permitted_action'])
    } catch (error) {
      throw new Error(`STATE_CONFLICT: concurrent Issue write detected after state write: ${error instanceof Error ? error.message : String(error)}`)
    }
    expectedBody = verified.body
    return verifiedParsed.state
  }
  const listLiveComments = () => normalizeIssueComments(parsePaginatedGhApiJson(run('gh', ['api', '--paginate', `repos/${repo}/issues/${options.issue}/comments`])))
  const postHandoff = async (body) => {
    const temp = mkdtempSync(join(tmpdir(), 'bemoat-dispatch-comment-'))
    const bodyFile = join(temp, 'handoff.md')
    const payloadFile = join(temp, 'payload.json')
    try {
      writeFileSync(bodyFile, body)
      const args = [roleCommentEntrypoint, options.issue, '--body-file', bodyFile, '--check']
      if (options.repo) args.push('--repo', options.repo)
      run(execPath, args, { env: { ...env, npm_lifecycle_event: undefined } })
      writeFileSync(payloadFile, JSON.stringify({ body }))
      let posted
      try {
        posted = JSON.parse(run('gh', ['api', '--method', 'POST', `repos/${repo}/issues/${options.issue}/comments`, '--input', payloadFile]))
      } catch (error) {
        if (options.founderCorrection) throw error
        throw runtimeError('AMBIGUOUS_RESULT', `HANDOFF POST outcome is unknown: ${error instanceof Error ? error.message : String(error)}`, { mutationPerformed: true, postedCommentId: null })
      }
      if (posted?.id == null) {
        if (options.founderCorrection) throw new Error('posted HANDOFF did not return a comment identifier')
        throw runtimeError('AMBIGUOUS_RESULT', 'HANDOFF POST did not return an authoritative comment identifier', { mutationPerformed: true, postedCommentId: null })
      }
      if (options.founderCorrection) return { ...posted, id: posted.id, body: posted.body ?? body, url: posted.html_url ?? posted.url ?? null, createdAt: posted.created_at ?? posted.createdAt ?? null, updatedAt: posted.updated_at ?? posted.updatedAt ?? null, author: posted.user?.login ?? null, author_association: posted.author_association ?? null }
      try {
        return verifyPostedCommentReadback({ comments: listLiveComments(), body, role: 'HANDOFF', postedId: posted.id, matchOptions: resolveProductionCommentTrust() })
      } catch (error) {
        throw runtimeError('AMBIGUOUS_RESULT', `posted HANDOFF comment could not be confirmed by live readback: ${error instanceof Error ? error.message : String(error)}`, { mutationPerformed: true, postedCommentId: posted.id, legacyClassification: 'POSTED' })
      }
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  }
  const retractHandoff = async (comment) => {
    if (!comment?.id) throw new Error('posted HANDOFF did not return a comment identifier for compensation')
    run('gh', ['api', '--method', 'DELETE', `repos/${repo}/issues/comments/${comment.id}`])
  }
  const reserveAuthorization = async (authorization) => {
    const safeIdentity = String(authorization.authorization_id).replace(/[^a-zA-Z0-9._-]/g, '-')
    const refPath = `tags/bemoat-mc-reservation/${options.issue}-${safeIdentity}`
    const temp = mkdtempSync(join(tmpdir(), 'bemoat-dispatch-reservation-'))
    const payloadFile = join(temp, 'payload.json')
    try {
      writeFileSync(payloadFile, JSON.stringify({ ref: `refs/${refPath}`, sha: authorization.reviewed_head }))
      run('gh', ['api', '--method', 'POST', `repos/${repo}/git/refs`, '--input', payloadFile])
      return { refPath }
    } catch (error) {
      throw new Error('Founder correction authorization reservation is already held or unavailable', { cause: error })
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  }
  const releaseAuthorization = async (reservation) => {
    if (!reservation?.refPath) throw new Error('correction reservation identifier is missing')
    run('gh', ['api', '--method', 'DELETE', `repos/${repo}/git/refs/${reservation.refPath}`])
  }

  if (options.founderCorrection) {
    return dispatchFounderAuthorizedCorrection({ readState: async () => readIssue(), writeState, postHandoff, retractHandoff, reserveAuthorization, releaseAuthorization, handoffBody, updatedAt, updatedBy })
  }
  const coordinator = new Coordinator({ readState: async () => readIssue(), writeState, listComments: async () => listLiveComments(), postComment: async (body) => postHandoff(body), ...resolveProductionCommentTrust() })
  const transitionState = options.workflowMode ? (state) => ({ ...structuredClone(state), workflow_mode: options.workflowMode }) : undefined
  const result = await coordinator.integrateHandoff({ handoffBody, transitionState, updatedAt, updatedBy, planningAuthorizationBaseSha: options.planningBaseSha })
  try {
    verifyPostedCommentReadback({ comments: listLiveComments(), body: handoffBody, role: 'HANDOFF', postedId: result.comment?.id ?? null, matchOptions: resolveProductionCommentTrust() })
  } catch (error) {
    throw runtimeError('AMBIGUOUS_RESULT', `posted HANDOFF comment could not be confirmed on final live readback: ${error instanceof Error ? error.message : String(error)}`, { mutationPerformed: true, postedCommentId: result.comment?.id ?? null, legacyClassification: 'POSTED' })
  }
  if (result.state?.state !== 'IN_PROGRESS') throw new Error('postcondition: live Issue state is not IN_PROGRESS after HANDOFF')
  if (!result.state?.latest_handoff_comment_id || String(result.state.latest_handoff_comment_id) !== String(result.comment.id)) throw new Error('postcondition: live state is not bound to the posted HANDOFF comment id')
  return result
}
