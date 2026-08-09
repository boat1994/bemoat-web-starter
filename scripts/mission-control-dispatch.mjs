#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import {
  dispatchFounderAuthorizedCorrection,
  Coordinator,
  normalizeIssueComments,
  parsePaginatedGhApiJson,
  parseRoleCommentBody,
  verifyStatePostcondition,
  resolveProductionCommentTrust,
  verifyPostedCommentReadback,
} from './mission-control-reconcile.mjs'
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
  classifyDelegatedFailure,
} from './cli/command-result.mjs'
import { parseMissionControlState, projectMissionControlStateBlock } from './mission-control-state.mjs'
import { writeIssueBodyWithLease } from './mission-control-issue-body-cas.mjs'
import { preflightCanonicalBootstrapTask } from './mission-control/domain/task-bootstrap-preflight.mjs'
import {
  createResultRendering,
  createRuntimeErrorRendering,
  runtimeError,
} from './mission-control/domain/dispatch-result-rendering.mjs'

const COMMAND = 'bemoat:mission-control:dispatch'
const ENTRYPOINT = 'scripts/mission-control-dispatch.mjs'
const ROLE_COMMENT_ENTRYPOINT = fileURLToPath(new URL('./post-role-comment.mjs', import.meta.url))

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    input: options.input,
    env: options.env,
  })
  if (result.error || result.status !== 0) {
    const reason = result.stderr || result.stdout || result.error?.message || `${command} failed`
    throw runtimeError(
      classifyDelegatedFailure({
        command,
        stdout: result.stdout,
        stderr: result.stderr,
        error: result.error,
      }),
      reason,
    )
  }
  return result.stdout.trim()
}

function resolveDispatchCommand() {
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

function renderRuntimeError({ command, format, error, values = {} }) {
  const rendering = createRuntimeErrorRendering({ command, format, error, values })
  process[rendering.stream].write(rendering.output)
  process.exitCode = rendering.exitCode
}

function renderResult({ command, format, options, result, observedPreState, handoffBody }) {
  const parsedBody = parseRoleCommentBody(handoffBody)
  const rendering = createResultRendering({
    command,
    format,
    options,
    result,
    observedPreState,
    parsedBody,
  })
  process[rendering.stream].write(rendering.output)
  process.exitCode = rendering.exitCode
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
  let command = null
  let invocation = null
  let observedPreState = null

  try {
    command = resolveDispatchCommand()
    invocation = parseCommandInvocation(command, process.argv.slice(2))

    if (invocation.mode === 'help') {
      renderHelp(invocation)
      return
    }

    const options = {
      issue: invocation.values.issue_number,
      repo: invocation.values.repository ?? null,
      bodyFile: invocation.values.body_file ?? null,
      founderCorrection: invocation.values.founder_correction === true,
      workflowMode: invocation.values.workflow_mode ?? null,
      planningBaseSha: invocation.values.planning_base_sha ?? null,
    }
    const repo = options.repo || run('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'])
    let handoffBody
    try {
      const stdin = !process.stdin.isTTY ? readFileSync(0, 'utf8') : ''
      if (options.bodyFile && stdin.length > 0) {
        throw new CliInvocationError('--body-file', '--body-file and stdin are mutually exclusive')
      }
      handoffBody = options.bodyFile
        ? readFileSync(options.bodyFile, 'utf8')
        : stdin
    } catch (error) {
      if (error instanceof CliInvocationError) throw error
      throw new CliInvocationError(
        options.bodyFile ?? 'stdin',
        error instanceof Error ? error.message : String(error),
      )
    }
    if (!handoffBody) {
      throw new CliInvocationError('stdin', 'provide a HANDOFF through --body-file or stdin')
    }

    let expectedBody = null
    const readIssue = () => {
      const issue = JSON.parse(run('gh', issueArgs(options, 'number,id,title,body,state')))
      const parsed = parseMissionControlState(issue.body)
      if (!parsed.present || !parsed.valid) {
        throw new Error(`invalid managed state: ${parsed.reason ?? 'missing state block'}`)
      }
      if (observedPreState === null) observedPreState = parsed.state?.state ?? null
      if (String(issue.body ?? '').includes('bemoat-mission-control-task-attestation:v1') && parsed.state?.active_pr) {
        const prNumber = String(parsed.state.active_pr).match(/#?(\d+)/)?.[1]
        if (!prNumber) throw new Error('STATE_CONFLICT: bootstrap Task active PR reference is unreadable')
        const pr = JSON.parse(run('gh', ['pr', 'view', prNumber, '--repo', repo, '--json', 'number,id,headRefOid,baseRefName,statusCheckRollup']))
        const bootstrapPreflight = preflightCanonicalBootstrapTask({
          issue,
          pullRequest: pr,
          repository: repo,
        })
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
        const args = [ROLE_COMMENT_ENTRYPOINT, options.issue, '--body-file', bodyFile, '--check']
        if (options.repo) args.push('--repo', options.repo)
        run(process.execPath, args, {
          env: { ...process.env, npm_lifecycle_event: undefined },
        })
        writeFileSync(payloadFile, JSON.stringify({ body }))
        let posted
        try {
          posted = JSON.parse(run('gh', [
            'api', '--method', 'POST', `repos/${repo}/issues/${options.issue}/comments`, '--input', payloadFile,
          ]))
        } catch (error) {
          if (options.founderCorrection) throw error
          throw runtimeError(
            'AMBIGUOUS_RESULT',
            `HANDOFF POST outcome is unknown: ${error instanceof Error ? error.message : String(error)}`,
            {
              mutationPerformed: true,
              postedCommentId: null,
            },
          )
        }
        if (posted?.id == null) {
          if (options.founderCorrection) {
            throw new Error('posted HANDOFF did not return a comment identifier')
          }
          throw runtimeError(
            'AMBIGUOUS_RESULT',
            'HANDOFF POST did not return an authoritative comment identifier',
            {
              mutationPerformed: true,
              postedCommentId: null,
            },
          )
        }
        if (options.founderCorrection) {
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
        }
        try {
          return verifyPostedCommentReadback({
            comments: listLiveComments(),
            body,
            role: 'HANDOFF',
            postedId: posted.id,
            matchOptions: resolveProductionCommentTrust(),
          })
        } catch (error) {
          throw runtimeError(
            'AMBIGUOUS_RESULT',
            `posted HANDOFF comment could not be confirmed by live readback: ${
              error instanceof Error ? error.message : String(error)
            }`,
            {
              mutationPerformed: true,
              postedCommentId: posted.id,
              legacyClassification: 'POSTED',
            },
          )
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
      renderResult({
        command,
        format: invocation.format,
        options: { ...options, repo },
        result,
        observedPreState,
        handoffBody,
      })
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
    let liveComments
    try {
      liveComments = listLiveComments()
      verifyPostedCommentReadback({
        comments: liveComments,
        body: handoffBody,
        role: 'HANDOFF',
        postedId: result.comment?.id ?? null,
        matchOptions: resolveProductionCommentTrust(),
      })
    } catch (error) {
      throw runtimeError(
        'AMBIGUOUS_RESULT',
        `posted HANDOFF comment could not be confirmed on final live readback: ${
          error instanceof Error ? error.message : String(error)
        }`,
        {
          mutationPerformed: true,
          postedCommentId: result.comment?.id ?? null,
          legacyClassification: 'POSTED',
        },
      )
    }
    if (result.state?.state !== 'IN_PROGRESS') {
      throw new Error('postcondition: live Issue state is not IN_PROGRESS after HANDOFF')
    }
    if (!result.state?.latest_handoff_comment_id || String(result.state.latest_handoff_comment_id) !== String(result.comment.id)) {
      throw new Error('postcondition: live state is not bound to the posted HANDOFF comment id')
    }
    renderResult({
      command,
      format: invocation.format,
      options: { ...options, repo },
      result,
      observedPreState,
      handoffBody,
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
