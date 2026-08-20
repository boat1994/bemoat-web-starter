#!/usr/bin/env node
<<<<<<< HEAD
import { main } from './mission-control/workflows/authorize-founder.mjs'

main().catch(() => {
  process.exitCode = 1
})
=======
import { createHelpEnvelopeV1, formatTextHelp } from './cli/command-help.mjs'
import { parseCommandInvocation, resolveCommandIdentity } from './cli/command-invocation.mjs'
import { createResultEnvelopeV1, classificationExitCode } from './cli/command-result.mjs'
import { createTaskBootstrapGithubAdapter } from './mission-control/adapters/task-bootstrap-github.mjs'
import { recordFounderAuthorization } from './mission-control/domain/founder-authorization-recording.ts'
import { BOOTSTRAP_CONTRACT } from './mission-control/domain/task-bootstrap-authorization.ts'

const COMMAND = 'bemoat:mission-control:authorize-founder'
const ENTRYPOINT = 'scripts/mission-control-authorize-founder.mjs'

function fail(classification, message, mutationPerformed = false) {
  return Object.assign(new Error(message), { classification, mutationPerformed })
}

async function main(argv = process.argv.slice(2)) {
  let invocation
  const command = resolveCommandIdentity({ fallback: COMMAND, env: process.env, entrypoint: ENTRYPOINT })
  try {
    invocation = parseCommandInvocation(command, argv)
    if (invocation.mode === 'help') {
      if (invocation.format === 'json') process.stdout.write(`${JSON.stringify(createHelpEnvelopeV1(invocation.contract))}\n`)
      else process.stdout.write(formatTextHelp(invocation.contract))
      return
    }
    const repository = invocation.values.repository ?? process.env.GITHUB_REPOSITORY ?? BOOTSTRAP_CONTRACT.repository
    const issueNumber = Number(invocation.values.issue_number)
    const github = createTaskBootstrapGithubAdapter({ repository, env: process.env })
    const readTrustedContext = async () => {
      const [liveRepository, targetIssue, mainCommit, founderLogins, actor] = await Promise.all([
        github.getRepository(), github.getIssue(issueNumber), github.getBranchCommit('main'), github.getFounderLogins(), github.getAuthenticatedUser(),
      ])
      if (liveRepository.nameWithOwner !== BOOTSTRAP_CONTRACT.repository) throw fail('STATE_CONFLICT', 'authorization repository does not match the protected starter')
      if (targetIssue.number !== issueNumber) throw fail('STATE_CONFLICT', 'authorization target Issue readback is inconsistent')
      if (!actor?.login || !founderLogins.includes(actor.login)) throw fail('AUTHORITY_CONFLICT', 'authenticated GitHub actor is not a trusted Founder')
      const policy = await github.getPolicy({ ref: mainCommit.sha, path: BOOTSTRAP_CONTRACT.policySource, sourceCommit: mainCommit.sha })
      if (policy.sourceCommit !== mainCommit.sha) throw fail('STATE_CONFLICT', 'Mission Control policy source commit does not match protected main')
      return { repository: liveRepository.nameWithOwner, issueNumber, protectedBaseSha: mainCommit.sha, policySource: policy.path, policyVersion: policy.version, policySha: policy.blobSha, policySourceCommit: policy.sourceCommit, founderLogin: actor.login }
    }
    const trustedContext = await readTrustedContext()
    const result = await recordFounderAuthorization({
      context: trustedContext,
      readComments: () => github.getIssueComments(issueNumber),
      postComment: (number, body) => github.postIssueComment(number, body),
      readComment: (id) => github.getIssueComment(id),
      readContext: readTrustedContext,
      acquireLease: (request) => github.acquireIssueLease({ ...request, scope: 'founder-authorization-recording' }),
      releaseLease: (request) => github.releaseIssueLease({ ...request, scope: 'founder-authorization-recording' }),
    })
    const envelope = createResultEnvelopeV1({
      command, outcome: result.classification === 'NO_OP_IDENTICAL_RETRY' ? 'NO_OP' : 'SUCCESS', classification: result.classification,
      mutation_performed: result.mutationPerformed, repository: trustedContext.repository, issue_number: String(issueNumber),
      next_action: { type: 'COMMAND', command: 'bemoat:mission-control:task-bootstrap', reason: 'Bootstrap must independently revalidate the immutable authorization.' },
      details: { comment_id: result.commentId, body_sha256: result.bodySha256, receipt_comment_id: result.receiptId },
    })
    if (invocation.format === 'json') process.stdout.write(`${JSON.stringify(envelope)}\n`)
    else process.stdout.write(`${result.classification}: immutable Founder authorization ${result.commentId}\n`)
    process.exitCode = classificationExitCode(result.classification)
  } catch (error) {
    const classification = error?.classification ?? error?.code ?? 'INTERNAL_ERROR'
    const reason = error instanceof Error ? error.message : String(error)
    if (invocation?.format === 'json' || argv.includes('--json')) process.stdout.write(`${JSON.stringify(createResultEnvelopeV1({ command, outcome: 'ERROR', classification, mutation_performed: error?.mutationPerformed === true, repository: BOOTSTRAP_CONTRACT.repository, issue_number: null, next_action: { type: 'STOP', command: null, reason }, details: { reason } }))}\n`)
    else process.stderr.write(`${classification}: ${reason}\n`)
    process.exitCode = classificationExitCode(classification)
  }
}

main()
>>>>>>> 862d426 (fix(mission-control): record immutable Founder authorization)
