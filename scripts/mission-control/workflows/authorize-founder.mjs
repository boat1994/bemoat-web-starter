#!/usr/bin/env node
import { createHelpEnvelopeV1, formatTextHelp } from '../../cli/command-help.mjs'
import { parseCommandInvocation, resolveCommandIdentity } from '../../cli/command-invocation.mjs'
import { createResultEnvelopeV1, classificationExitCode } from '../../cli/command-result.mjs'
import { recordFounderMergeAuthorization } from '../domain/founder-merge-authorization-recording.ts'
import { recordFounderAuthorization } from '../domain/founder-authorization-recording.ts'
import { BOOTSTRAP_CONTRACT } from '../domain/task-bootstrap-authorization.ts'
import { parseMissionControlState } from '../domain/task-state.ts'
import { normalizePrNumber } from '../domain/merge-issue-references.ts'
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
    
    if (scope !== 'merge' && scope !== 'task-bootstrap') {
      throw fail('UNSUPPORTED_PRE_STATE', `only --scope merge and task-bootstrap are supported`)
    }

    const github = createTaskBootstrapGithubAdapter({ repository, env: process.env })
    let result
    let nextActionCommand
    let nextActionReason

    if (scope === 'merge') {
      const readTrustedContext = async () => {
        const issueJson = JSON.parse(runGh(['issue', 'view', String(issueNumber), '--repo', repository, '--json', 'number,body']))
        if (issueJson.number !== issueNumber) throw fail('STATE_CONFLICT', 'authorization target Issue readback is inconsistent')
        
        const parsedState = parseMissionControlState(issueJson.body)
        if (!parsedState.present || !parsedState.valid) throw fail('STATE_CONFLICT', `Issue has invalid managed state: ${parsedState.reason ?? 'missing state block'}`)
        const state = parsedState.state
        
        const prNumber = resolvePrNumber(state.active_pr)
        const exactHead = state.last_reviewed_head
        const base = state.approved_base
        const policySource = state.guide_source_path ?? 'docs/mission-control/mission-control-guide.md'
        const policyVersion = state.guide_version ?? '1.3.0'
        const policySha = state.guide_source_sha
        
        if (!exactHead || !base || !policySha) {
          throw fail('STATE_CONFLICT', 'managed task state is missing exact head, base, or policy identity')
        }

        const mainRef = await readProtectedRef(runGh, repository, 'main')
        if (!mainRef?.object?.sha) throw fail('STATE_CONFLICT', 'live protected main ref is unavailable')

        const authActor = JSON.parse(runGh(['api', 'user']))
        const variable = JSON.parse(runGh(['api', `repos/${repository}/actions/variables/BEMOAT_FOUNDER_LOGINS`]))
        const logins = String(variable.value ?? '').trim().split(',').map((l) => l.trim()).filter(Boolean)
        if (!authActor?.login || !logins.includes(authActor.login)) throw fail('AUTHORITY_CONFLICT', 'authenticated GitHub actor is not a trusted Founder')
        
        return {
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
          founderLogin: authActor.login,
        }
      }
      
      const trustedContext = await readTrustedContext()
      
      result = await recordFounderMergeAuthorization({
        context: trustedContext,
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
        readContext: readTrustedContext,
        acquireLease: (request) => github.acquireIssueLease({ ...request, scope: 'founder-merge-authorization-recording' }),
        releaseLease: (request) => github.releaseIssueLease({ ...request, scope: 'founder-merge-authorization-recording' }),
      })

      nextActionCommand = 'bemoat:mission-control:merge'
      nextActionReason = 'Merge completion bundle must independently revalidate the immutable authorization.'
    } else if (scope === 'task-bootstrap') {
      const readTrustedContext = async () => {
        const mainRef = await readProtectedRef(runGh, repository, 'main')
        if (!mainRef?.object?.sha) throw fail('EVIDENCE_CONFLICT', 'live protected main ref is unavailable')

        let policyBlobSha
        try {
          const lsTree = runGh(['api', `repos/${repository}/git/trees/${mainRef.object.sha}?recursive=1`])
          const tree = JSON.parse(lsTree).tree
          const node = tree.find((t) => t.path === BOOTSTRAP_CONTRACT.policy_source)
          if (!node?.sha) throw new Error('policy not found in tree')
          policyBlobSha = node.sha
        } catch {
          throw fail('EVIDENCE_CONFLICT', 'failed to resolve Mission Control policy blob SHA')
        }

        const authActor = JSON.parse(runGh(['api', 'user']))
        const variable = JSON.parse(runGh(['api', `repos/${repository}/actions/variables/BEMOAT_FOUNDER_LOGINS`]))
        const logins = String(variable.value ?? '').trim().split(',').map((l) => l.trim()).filter(Boolean)
        if (!authActor?.login || !logins.includes(authActor.login)) throw fail('AUTHORITY_CONFLICT', 'authenticated GitHub actor is not a trusted Founder')

        return {
          issueNumber,
          repository,
          action: BOOTSTRAP_CONTRACT.action,
          scope: BOOTSTRAP_CONTRACT.scope,
          protectedBaseSha: mainRef.object.sha,
          policySource: BOOTSTRAP_CONTRACT.policy_source,
          policyVersion: BOOTSTRAP_CONTRACT.policy_version,
          policySha: policyBlobSha,
          founderLogin: authActor.login,
        }
      }

      const trustedContext = await readTrustedContext()
      
      result = await recordFounderAuthorization({
        context: trustedContext,
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
      })

      nextActionCommand = 'bemoat:mission-control:task-bootstrap'
      nextActionReason = 'Bootstrap must independently revalidate the immutable authorization.'
    }
    
    const envelope = createResultEnvelopeV1({
      command, outcome: result.classification === 'NO_OP_IDENTICAL_RETRY' ? 'NO_OP' : 'SUCCESS', classification: result.classification,
      mutation_performed: result.mutationPerformed, repository: repository, issue_number: String(issueNumber),
      next_action: { type: 'COMMAND', command: nextActionCommand, reason: nextActionReason },
      details: { comment_id: result.commentId, body_sha256: result.bodySha256, receipt_comment_id: result.receiptId },
    })
    if (invocation.format === 'json') process.stdout.write(`${JSON.stringify(envelope)}\n`)
    else process.stdout.write(`${result.classification}: immutable Founder authorization ${result.commentId}\n`)
    process.exitCode = classificationExitCode(result.classification)
  } catch (error) {
    const classification = error?.classification ?? error?.code ?? 'INTERNAL_ERROR'
    const reason = error instanceof Error ? error.message : String(error)
    if (invocation?.format === 'json' || argv.includes('--json')) process.stdout.write(`${JSON.stringify(createResultEnvelopeV1({ command, outcome: 'ERROR', classification, mutation_performed: error?.mutationPerformed === true, repository: 'boat1994/bemoat-web-starter', issue_number: null, next_action: { type: 'STOP', command: null, reason }, details: { reason } }))}\n`)
    else process.stderr.write(`${classification}: ${reason}\n`)
    process.exitCode = classificationExitCode(classification)
  }
}
