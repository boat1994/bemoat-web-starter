#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { createCampaignSliceBootstrapGithubAdapter } from './mission-control/adapters/campaign-slice-bootstrap-github.mjs'
import { runCampaignSliceBootstrap } from './mission-control/workflows/campaign-slice-bootstrap.mjs'

const FLAG_TO_INPUT = Object.freeze({
  '--founder-authorization-comment-id': 'founder_authorization_comment_id',
  '--campaign-issue-number': 'campaign_issue_number',
  '--slice-id': 'slice_id',
  '--planning-handoff-comment-id': 'planning_handoff_comment_id',
  '--planning-result-comment-id': 'planning_result_comment_id',
  '--planning-baseline-sha': 'planning_baseline_sha',
})

function parseArgs(argv) {
  const input = {}
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--') continue
    const key = FLAG_TO_INPUT[flag]
    if (!key) throw new Error(`unexpected argument: ${flag}`)
    if (Object.hasOwn(input, key)) throw new Error(`${flag} may be provided only once`)
    const value = argv[++index]
    if (value == null || value.startsWith('--')) throw new Error(`${flag} requires a value`)
    input[key] = value
  }
  const missing = Object.values(FLAG_TO_INPUT).filter((key) => !Object.hasOwn(input, key))
  if (missing.length > 0) throw new Error(`missing required campaign-slice bootstrap flags: ${missing.join(', ')}`)
  return input
}

function protectedPublicKey() {
  try {
    return readFileSync(
      resolve(process.cwd(), '.bemoat/mission-control/task-bootstrap-public-key.pem'),
      'utf8',
    )
  } catch (error) {
    const blocked = new Error('committed public verification key is unavailable', { cause: error })
    blocked.code = 'BLOCKED_EXTERNAL'
    throw blocked
  }
}

async function main() {
  const input = parseArgs(process.argv.slice(2))
  const env = process.env
  const repository = env.GITHUB_REPOSITORY ?? ''
  const github = createCampaignSliceBootstrapGithubAdapter({ repository, env })
  const result = await runCampaignSliceBootstrap(input, {
    github,
    publicKey: protectedPublicKey(),
    signingPrivateKey: env.BEMOAT_CAMPAIGN_SLICE_BOOTSTRAP_SIGNING_PRIVATE_KEY ??
      env.BEMOAT_TASK_BOOTSTRAP_SIGNING_PRIVATE_KEY ??
      null,
    signingKeyId: env.BEMOAT_CAMPAIGN_SLICE_BOOTSTRAP_SIGNING_KEY_ID ??
      env.BEMOAT_TASK_BOOTSTRAP_SIGNING_KEY_ID ??
      null,
  })
  process.stdout.write(`${JSON.stringify({
    ok: true,
    outcome: result.outcome,
    request_id: result.requestId,
    task_issue: result.issue.number,
    task_issue_url: result.issue.url,
    campaign_issue: result.campaign?.campaign_issue ?? '#215',
    slice_id: 5,
    attestation_schema: result.attestation.attestation_schema,
    signing_key_id: result.attestation.key_id,
  })}\n`)
}

main().catch((error) => {
  const code = error?.code ?? 'BLOCKED_EXTERNAL'
  process.stderr.write(`${code}: ${error instanceof Error
    ? error.message.replace(/-----BEGIN[\s\S]*?-----[\s\S]*?-----END[\s\S]*?-----/g, '[redacted-key]')
    : String(error)}\n`)
  process.exitCode = 1
})
