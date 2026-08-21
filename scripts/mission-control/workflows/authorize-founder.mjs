#!/usr/bin/env node
import { createHelpEnvelopeV1, formatTextHelp } from '../../cli/command-help.mjs'
import { parseCommandInvocation, resolveCommandIdentity } from '../../cli/command-invocation.mjs'
import { createResultEnvelopeV1, classificationExitCode } from '../../cli/command-result.mjs'
import { recordFounderMergeAuthorization } from '../domain/founder-merge-authorization-recording.ts'
import { parseMissionControlState } from '../domain/task-state.ts'
import { normalizePrNumber } from '../domain/merge-issue-references.ts'
import { resolveMergeReviewVerdictBinding } from '../domain/merge-review-verdict.ts'
import { classifyStandardNonManagedEligibility, STANDARD_POLICY_PATH } from '../domain/standard-non-managed-eligibility.ts'
import {
  classifyReviewVerdictBindingEvidence,
  resolveIssueScopingTaskNumber,
  selectActiveRoleComments,
  selectLiveReviewVerdictComment,
} from '../review-verdict-binding.mjs'
import { createTaskBootstrapGithubAdapter } from '../adapters/task-bootstrap-github.mjs'
import { defaultRunGh, readProtectedRef } from '../adapters/merge-github.mjs'

const COMMAND = 'bemoat:mission-control:authorize-founder'
const ENTRYPOINT = 'scripts/mission-control-authorize-founder.mjs'

function fail(classification, message, mutationPerformed = false) {
  return Object.assign(new Error(message), { classification, mutationPerformed })
}

function resolvePrNumber(value) {
  const num = normalizePrNumber(value)
  if (!num) throw fail('STATE_CONFLICT', 'managed task state does not expose an active PR')
  return num
}

const runGh = defaultRunGh

async function resolveStandardReviewContext({ comments, issueNumber, repository }) {
  const active = selectActiveRoleComments(comments, 'REVIEW_VERDICT')
  const prNumbers = new Set()
  for (const comment of active) {
    const taskIssue = resolveIssueScopingTaskNumber(comment.body ?? '')
    if (taskIssue != null && String(taskIssue) !== String(issueNumber)) continue
    const classification = classifyReviewVerdictBindingEvidence(comment.body ?? '', { issueNumber })
    if (classification.status === 'malformed') throw classification.error
    if (classification.status !== 'valid') throw fail('STATE_CONFLICT', 'active REVIEW_VERDICT is missing canonical PR/base/head evidence')
    prNumbers.add(resolvePrNumber(classification.binding.prNumber))
  }
  if (prNumbers.size !== 1) throw fail('STATE_CONFLICT', 'STANDARD authorization requires exactly one canonical active REVIEW_VERDICT PR target')

  const prNumber = [...prNumbers][0]
  const pr = JSON.parse(runGh(['pr', 'view', String(prNumber), '--repo', repository, '--json', 'number,state,baseRefName,headRefOid']))
  let selected
  try {
    selected = selectLiveReviewVerdictComment({
      comments,
      issueNumber,
      livePr: pr,
      exactHead: pr.headRefOid,
      requireExactIssueBinding: true,
      requireNonSuperseded: true,
      requireImmutableCommentId: true,
      rejectNonExactTargets: true,
    })
  } catch (error) {
    throw fail('STATE_CONFLICT', error instanceof Error ? error.message : String(error))
  }
  const binding = resolveMergeReviewVerdictBinding(selected.body)
  return { comment: selected, binding, pr }
}

export async function main(argv = process.argv.slice(2)) {
  let invocation
  const command = resolveCommandIdentity({ fallback: COMMAND, env: process.env, entrypoint: ENTRYPOINT })
  try {
    invocation = parseCommandInvocation(command, argv)
    if (invocation.mode === 'help') {
      if (invocation.format === 'json') process.stdout.write(`${JSON.stringify(createHelpEnvelopeV1(invocation.contract))}\n`)
      else process.stdout.write(formatTextHelp(invocation.contract))
      return
    }
    
    const repository = invocation.values.repository ?? process.env.GITHUB_REPOSITORY ?? 'boat1994/bemoat-web-starter'
    const issueNumber = Number(invocation.values.issue_number)
    const scope = invocation.values.scope
    
    if (scope !== 'merge') {
      throw fail('UNSUPPORTED_PRE_STATE', `only --scope merge is supported by this authorization transport right now`)
    }

    const github = createTaskBootstrapGithubAdapter({ repository, env: process.env })

    const readTrustedFounderLogin = async () => {
      const authActor = JSON.parse(runGh(['api', 'user']))
      const variable = JSON.parse(runGh(['api', `repos/${repository}/actions/variables/BEMOAT_FOUNDER_LOGINS`]))
      const logins = String(variable.value ?? '').trim().split(',').map((l) => l.trim()).filter(Boolean)
      if (!authActor?.login || !logins.includes(authActor.login)) throw fail('AUTHORITY_CONFLICT', 'authenticated GitHub actor is not a trusted Founder')
      return authActor.login
    }

    const readTrustedContext = async () => {
      const issueJson = JSON.parse(runGh(['issue', 'view', String(issueNumber), '--repo', repository, '--json', 'number,body']))
      if (issueJson.number !== issueNumber) throw fail('STATE_CONFLICT', 'authorization target Issue readback is inconsistent')
      
      const parsedState = parseMissionControlState(issueJson.body)
      let prNumber, exactHead, base, policySource, policyVersion, policySha

      const mainRef = await readProtectedRef(runGh, repository, 'main')
      if (!mainRef?.object?.sha) throw fail('STATE_CONFLICT', 'live protected main ref is unavailable')

      if (parsedState.present && parsedState.valid) {
        const state = parsedState.state
        prNumber = resolvePrNumber(state.active_pr)
        exactHead = state.last_reviewed_head
        base = state.approved_base
        policySource = state.guide_source_path ?? 'docs/mission-control/mission-control-guide.md'
        policyVersion = state.guide_version ?? '1.3.0'
        policySha = state.guide_source_sha
        
        if (!exactHead || !base || !policySha) {
          throw fail('STATE_CONFLICT', 'managed task state is missing exact head, base, or policy identity')
        }
        return { standard: false, context: {
          repository,
          issueNumber,
          prNumber,
          exactHead,
          base,
          protectedBaseSha: mainRef.object.sha,
          policySource,
          policyVersion,
          policySha,
          policySourceCommit: mainRef.object.sha,
          founderLogin: await readTrustedFounderLogin(),
        } }
      } else if (!parsedState.present) {
        const pages = JSON.parse(runGh(['api', '--paginate', '--slurp', `repos/${repository}/issues/${issueNumber}/comments?per_page=100`]))
        const comments = pages.flat()
        const policy = await github.getPolicy({ ref: mainRef.object.sha, path: STANDARD_POLICY_PATH, sourceCommit: mainRef.object.sha })
        classifyStandardNonManagedEligibility({ repository, issueBody: issueJson.body, policy, protectedBaseSha: mainRef.object.sha })
        const review = await resolveStandardReviewContext({ comments, issueNumber, repository })
        prNumber = resolvePrNumber(review.binding.pr)
        exactHead = review.binding.reviewed_head
        base = review.binding.base
        policySource = policy.path
        policyVersion = policy.version
        policySha = policy.blobSha
        const founderLogin = await readTrustedFounderLogin()
        return { standard: true, context: {
          repository,
          issueNumber,
          prNumber,
          exactHead,
          base,
          protectedBaseSha: mainRef.object.sha,
          policySource,
          policyVersion,
          policySha,
          policySourceCommit: policy.sourceCommit,
          reviewVerdictCommentId: String(review.comment.id),
          founderLogin,
        } }
      } else {
        throw fail('STATE_CONFLICT', `Issue has invalid managed state: ${parsedState.reason}`)
      }
    }

    const trustedContext = await readTrustedContext()
    
    const result = await recordFounderMergeAuthorization({
      context: trustedContext.context,
      readComments: async () => {
        const pages = JSON.parse(runGh(['api', '--paginate', '--slurp', `repos/${repository}/issues/${issueNumber}/comments?per_page=100`]))
        return pages.flat()
      },
      postComment: async (number, body) => {
        return JSON.parse(runGh(['api', '-X', 'POST', `repos/${repository}/issues/${number}/comments`, '-f', `body=${body}`]))
      },
      readComment: async (id) => {
        return JSON.parse(runGh(['api', `repos/${repository}/issues/comments/${id}`]))
      },
      readContext: async () => (await readTrustedContext()).context,
      acquireLease: (request) => github.acquireIssueLease({ ...request, scope: 'founder-merge-authorization-recording' }),
      releaseLease: (request) => github.releaseIssueLease({ ...request, scope: 'founder-merge-authorization-recording' }),
    })
    
    const envelope = createResultEnvelopeV1({
      command, outcome: result.classification === 'NO_OP_IDENTICAL_RETRY' ? 'NO_OP' : 'SUCCESS', classification: result.classification,
      mutation_performed: result.mutationPerformed, repository: trustedContext.context.repository, issue_number: String(issueNumber),
      next_action: { type: 'COMMAND', command: trustedContext.standard ? 'bemoat:mission-control:merge-standard' : 'bemoat:mission-control:merge', reason: 'Merge completion transport must independently revalidate the immutable authorization.' },
      details: { comment_id: result.commentId, body_sha256: result.bodySha256, receipt_comment_id: result.receiptId },
    })
    if (invocation.format === 'json') process.stdout.write(`${JSON.stringify(envelope)}\n`)
    else process.stdout.write(`${result.classification}: immutable Founder merge authorization ${result.commentId}\n`)
    process.exitCode = classificationExitCode(result.classification)
  } catch (error) {
    const classification = error?.classification ?? error?.code ?? 'INTERNAL_ERROR'
    const reason = error instanceof Error ? error.message : String(error)
    if (invocation?.format === 'json' || argv.includes('--json')) process.stdout.write(`${JSON.stringify(createResultEnvelopeV1({ command, outcome: 'ERROR', classification, mutation_performed: error?.mutationPerformed === true, repository: 'boat1994/bemoat-web-starter', issue_number: null, next_action: { type: 'STOP', command: null, reason }, details: { reason } }))}\n`)
    else process.stderr.write(`${classification}: ${reason}\n`)
    process.exitCode = classificationExitCode(classification)
  }
}
