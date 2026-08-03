#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { createUnmanagedGenesisReviewGithubAdapter } from './mission-control/adapters/unmanaged-genesis-review-github.mjs'
import { UGR_CONTRACT } from './mission-control/domain/unmanaged-genesis-review.mjs'
import { createUnmanagedGenesisReviewService } from './mission-control/workflows/unmanaged-genesis-review.mjs'

function parseArgs(argv) {
  const options = { founderAuthorizationCommentId: null }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--') continue
    if (argument === '--founder-authorization-comment-id' || argument === '--authorization-comment') {
      if (options.founderAuthorizationCommentId != null) {
        throw new Error('founder authorization comment ID may be provided only once')
      }
      options.founderAuthorizationCommentId = argv[++index]
      continue
    }
    throw new Error(`unexpected argument: ${argument}`)
  }
  if (!/^[1-9]\d*$/.test(String(options.founderAuthorizationCommentId ?? ''))) {
    throw new Error('founder_authorization_comment_id is required')
  }
  return options
}

function protectedPublicKey() {
  try {
    return readFileSync(resolve(process.cwd(), UGR_CONTRACT.publicKeyPath), 'utf8')
  } catch (error) {
    const blocked = new Error('committed public verification key is unavailable', { cause: error })
    blocked.code = 'BLOCKED_EXTERNAL'
    throw blocked
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const env = process.env
  const repository = env.GITHUB_REPOSITORY ?? UGR_CONTRACT.repository
  const workflow = {
    file: env.BEMOAT_UGR_WORKFLOW_FILE ?? 'scripts/mission-control-unmanaged-genesis-review.mjs',
    ref: env.GITHUB_REF ?? null,
    sha: env.GITHUB_SHA ?? null,
    runId: env.GITHUB_RUN_ID ?? null,
  }
  const github = createUnmanagedGenesisReviewGithubAdapter({ repository, env })
  const service = createUnmanagedGenesisReviewService({
    github,
    repository,
    publicKey: protectedPublicKey(),
    signingPrivateKey: env.BEMOAT_UNMANAGED_GENESIS_REVIEW_SIGNING_PRIVATE_KEY ?? null,
    signingKeyId: env.BEMOAT_UNMANAGED_GENESIS_REVIEW_SIGNING_KEY_ID ?? null,
    workflow,
    env,
  })
  const result = await service.recordReview({
    founderAuthorizationCommentId: options.founderAuthorizationCommentId,
  })
  process.stdout.write(`${JSON.stringify({
    ok: true,
    outcome: result.outcome,
    evidence_class: result.evidenceClass,
    record_id: result.recordId,
    comment_id: result.commentId,
    reviewed_head: result.reviewedHead,
    merge_eligible: Boolean(result.mergeEligibility?.eligible),
    merge_reason: result.mergeEligibility?.reason ?? null,
    issue_body_writes: result.issueBodyWrites,
    task_issue: UGR_CONTRACT.taskIssue,
    pull_request: UGR_CONTRACT.pullRequest,
  })}\n`)
}

main().catch((error) => {
  const code = error?.code ?? error?.classification ?? 'BLOCKED_EXTERNAL'
  process.stderr.write(`${code}: ${error instanceof Error ? error.message.replace(/-----BEGIN[\s\S]*?-----[\s\S]*?-----END[\s\S]*?-----/g, '[redacted-key]') : String(error)}\n`)
  process.exit(1)
})
