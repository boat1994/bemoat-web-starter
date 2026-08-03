#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { createTaskBootstrapGithubAdapter } from './mission-control/adapters/task-bootstrap-github.mjs'
import { BOOTSTRAP_CONTRACT } from './mission-control/domain/task-bootstrap-authorization.mjs'
import { createTaskBootstrapService } from './mission-control/workflows/task-bootstrap.mjs'

function parseArgs(argv) {
  const options = { founderAuthorizationCommentId: null }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--') continue
    if (argument === '--founder-authorization-comment-id') {
      if (options.founderAuthorizationCommentId != null) throw new Error('founder authorization comment ID may be provided only once')
      options.founderAuthorizationCommentId = argv[++index]
      continue
    }
    throw new Error(`unexpected argument: ${argument}`)
  }
  if (!/^[1-9]\d*$/.test(String(options.founderAuthorizationCommentId ?? ''))) {
    throw new Error('founder authorization comment ID is required')
  }
  return options
}

function protectedPublicKey() {
  try {
    return readFileSync(resolve(process.cwd(), '.bemoat/mission-control/task-bootstrap-public-key.pem'), 'utf8')
  } catch (error) {
    const blocked = new Error('committed public verification key is unavailable', { cause: error })
    blocked.code = 'BLOCKED_EXTERNAL'
    throw blocked
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const env = process.env
  const workflowRef = env.GITHUB_REF ?? ''
  const workflowSha = env.GITHUB_SHA ?? ''
  const workflowRunId = env.GITHUB_RUN_ID ?? ''
  const repository = env.GITHUB_REPOSITORY ?? ''
  const workflow = {
    file: BOOTSTRAP_CONTRACT.workflowFile,
    ref: workflowRef,
    sha: workflowSha,
    runId: workflowRunId,
  }
  const github = createTaskBootstrapGithubAdapter({ repository, env })
  const service = createTaskBootstrapService({
    github,
    repository,
    publicKey: protectedPublicKey(),
    signingPrivateKey: env.BEMOAT_TASK_BOOTSTRAP_SIGNING_PRIVATE_KEY ?? null,
    signingKeyId: env.BEMOAT_TASK_BOOTSTRAP_SIGNING_KEY_ID ?? null,
    workflow,
  })
  const result = await service.bootstrap({ founderAuthorizationCommentId: options.founderAuthorizationCommentId })
  // Never serialize the private key or the full Issue body into the workflow
  // log. The durable evidence remains on GitHub for the next preflight.
  process.stdout.write(`${JSON.stringify({
    ok: true,
    outcome: result.outcome,
    request_id: result.requestId,
    task_issue: result.issue.number,
    task_issue_url: result.issue.url,
    pr: BOOTSTRAP_CONTRACT.pullRequest,
    head: BOOTSTRAP_CONTRACT.head,
    policy_sha: BOOTSTRAP_CONTRACT.policySha,
    attestation_schema: result.attestation.attestation_schema,
    signing_key_id: result.attestation.key_id,
  })}\n`)
}

main().catch((error) => {
  // Deliberately emit only classification and a safe message; private signing
  // material and GitHub credentials are never included in diagnostics.
  const code = error?.code ?? 'BLOCKED_EXTERNAL'
  process.stderr.write(`${code}: ${error instanceof Error ? error.message.replace(/-----BEGIN[\s\S]*?-----[\s\S]*?-----END[\s\S]*?-----/g, '[redacted-key]') : String(error)}\n`)
  process.exitCode = 1
})
