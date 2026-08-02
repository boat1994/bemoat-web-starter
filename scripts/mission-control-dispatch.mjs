#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import {
  dispatchFounderAuthorizedCorrection,
  Coordinator,
  normalizeIssueComments,
  parsePaginatedGhApiJson,
  verifyStatePostcondition,
  resolveProductionCommentTrust,
} from './mission-control-reconcile.mjs'
import { parseMissionControlState, projectMissionControlStateBlock } from './mission-control-state.mjs'
import { writeIssueBodyWithLease } from './mission-control-issue-body-cas.mjs'

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    input: options.input,
    env: options.env,
  })
  if (result.error || result.status !== 0) {
    throw new Error(result.stderr || result.stdout || result.error?.message || `${command} failed`)
  }
  return result.stdout.trim()
}

function parseArgs(argv) {
  const options = { issue: null, repo: null, bodyFile: null, founderCorrection: false, workflowMode: null, planningBaseSha: null }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--') continue
    if (argument === '--founder-correction') {
      options.founderCorrection = true
      continue
    }
    if (argument === '--repo' || argument === '--body-file' || argument === '--workflow-mode' || argument === '--planning-base-sha') {
      const value = argv[++index]
      if (!value) throw new Error(`${argument} requires a value`)
      if (argument === '--repo') options.repo = value
      else if (argument === '--body-file') options.bodyFile = value
      else if (argument === '--workflow-mode') options.workflowMode = value
      else if (argument === '--planning-base-sha') options.planningBaseSha = value
      continue
    }
    if (argument.startsWith('-') || options.issue) throw new Error(`unexpected argument: ${argument}`)
    options.issue = argument
  }
  if (!options.issue || !/^[1-9]\d*$/.test(options.issue)) {
    throw new Error('a positive Issue number is required')
  }
  return options
}

function issueArgs(options, fields) {
  const args = ['issue', 'view', options.issue, '--json', fields]
  if (options.repo) args.push('--repo', options.repo)
  return args
}

function replaceStateBlock(body, state) {
  return projectMissionControlStateBlock(body, state)
}

function sameState(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const repo = options.repo || run('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'])
  const handoffBody = options.bodyFile
    ? readFileSync(options.bodyFile, 'utf8')
    : (!process.stdin.isTTY ? readFileSync(0, 'utf8') : '')
  if (!handoffBody) throw new Error('provide HANDOFF through --body-file or stdin')

  let expectedBody = null
  const readIssue = () => {
    const issue = JSON.parse(run('gh', issueArgs(options, 'body,state')))
    const parsed = parseMissionControlState(issue.body)
    if (!parsed.present || !parsed.valid) {
      throw new Error(`invalid managed state: ${parsed.reason ?? 'missing state block'}`)
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
    if (expectedState && !sameState(liveParsed.state, expectedState)) {
      throw new Error('STATE_CONFLICT: concurrent Issue write detected')
    }
    if (expectedBody !== null && live.body !== expectedBody) {
      throw new Error('STATE_CONFLICT: concurrent Issue write detected')
    }
    const observedBody = live.body
    const nextBody = replaceStateBlock(observedBody, state)
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
    if (!verifiedParsed.present || !verifiedParsed.valid) {
      throw new Error('postcondition: Issue state unreadable after write')
    }
    try {
      verifyStatePostcondition(state, verifiedParsed.state, [
        'state', 'latest_transition_identity', 'latest_handoff_comment_id', 'next_permitted_action',
      ])
    } catch (error) {
      throw new Error(`STATE_CONFLICT: concurrent Issue write detected after state write: ${error instanceof Error ? error.message : String(error)}`)
    }
    expectedBody = verified.body
    return verifiedParsed.state
  }
  const listLiveComments = () => {
    const stdout = run('gh', [
      'api',
      '--paginate',
      `repos/${repo}/issues/${options.issue}/comments`,
    ])
    return normalizeIssueComments(parsePaginatedGhApiJson(stdout))
  }
  const postHandoff = async (body) => {
    const temp = mkdtempSync(join(tmpdir(), 'bemoat-dispatch-comment-'))
    const bodyFile = join(temp, 'handoff.md')
    const payloadFile = join(temp, 'payload.json')
    try {
      writeFileSync(bodyFile, body)
      const args = ['scripts/post-role-comment.mjs', options.issue, '--body-file', bodyFile, '--check']
      if (options.repo) args.push('--repo', options.repo)
      run(process.execPath, args)
      writeFileSync(payloadFile, JSON.stringify({ body }))
      const posted = JSON.parse(run('gh', [
        'api', '--method', 'POST', `repos/${repo}/issues/${options.issue}/comments`, '--input', payloadFile,
      ]))
      if (posted?.id == null) throw new Error('posted HANDOFF did not return a comment identifier')
      return {
        ...posted,
        id: posted.id,
        body: posted.body ?? body,
        url: posted.html_url ?? posted.url ?? null,
        createdAt: posted.created_at ?? posted.createdAt ?? null,
        updatedAt: posted.updated_at ?? posted.updatedAt ?? null,
        author: posted.user?.login ?? null,
        author_association: posted.author_association ?? null,
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
      writeFileSync(payloadFile, JSON.stringify({
        ref: `refs/${refPath}`,
        sha: authorization.reviewed_head,
      }))
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

  const timestamp = new Date().toISOString()
  if (options.founderCorrection) {
    const result = await dispatchFounderAuthorizedCorrection({
      readState: async () => readIssue(),
      writeState,
      postHandoff,
      retractHandoff,
      reserveAuthorization,
      releaseAuthorization,
      handoffBody,
      updatedAt: timestamp,
      updatedBy: 'Mission Control',
    })
    process.stdout.write(`Mission Control dispatch ${result.outcome}: FOUNDER_AUTHORIZED_CORRECTION -> IN_PROGRESS + HANDOFF\n`)
    return
  }

  const coordinator = new Coordinator({
    readState: async () => readIssue(),
    writeState,
    listComments: async () => listLiveComments(),
    postComment: async (body) => postHandoff(body),
    ...resolveProductionCommentTrust(),
  })

  const transitionState = options.workflowMode
    ? (state) => ({ ...structuredClone(state), workflow_mode: options.workflowMode })
    : undefined

  // Coordinator owns latest_transition_identity, comment binding, and next_permitted_action.
  const result = await coordinator.integrateHandoff({
    handoffBody,
    transitionState,
    updatedAt: timestamp,
    updatedBy: 'Mission Control',
    planningAuthorizationBaseSha: options.planningBaseSha,
  })
  const liveComments = listLiveComments()
  const bound = liveComments.find((comment) => String(comment.id) === String(result.comment?.id))
  if (!bound) {
    throw new Error('postcondition: posted HANDOFF comment id was not found on live Issue comments')
  }
  if (result.state?.state !== 'IN_PROGRESS') {
    throw new Error('postcondition: live Issue state is not IN_PROGRESS after HANDOFF')
  }
  if (!result.state?.latest_handoff_comment_id || String(result.state.latest_handoff_comment_id) !== String(result.comment.id)) {
    throw new Error('postcondition: live state is not bound to the posted HANDOFF comment id')
  }
  process.stdout.write(`Mission Control dispatch ${result.outcome}: READY -> IN_PROGRESS + HANDOFF comment ${result.comment.id}\n`)
}

main().catch((error) => {
  process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
