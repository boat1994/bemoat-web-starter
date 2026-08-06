import { createHash } from 'node:crypto'
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { assertResultEnvelopeV1 } from '../../scripts/cli/command-result.mjs'

const INCIDENT_HEAD = 'c44bf1bc379fe4160946dce96e5a4d7abae7b5b0'
const PREVIOUS_REVIEW_HEAD = '301ae166052af036ce4d727be59d8d20cc8c02d1'
const INCIDENT_BASE_SHA = '88b306c7e055751f78b9ced5922607eee2d1037f'
const EXECUTION_POLICY_SHA = 'ce8d67b19c6c5d210024434f532dcc32ebdc6daf'
const POLICY_SOURCE_SHA = 'e'.repeat(40)
const GUIDE_PATH = 'docs/mission-control/mission-control-guide.md'
const RECOVERY_FACADE_PATH = 'scripts/mission-control-recover-review.mjs'
const RECOVERY_WORKFLOW_PATH = 'scripts/mission-control/workflows/recover-review.mjs'
const TRANSPORT_REGISTRY_PATH = 'scripts/mission-control/transport-registry.mjs'
const AUTHORIZED_HOTFIX_BRANCH = 'hotfix/incident-vs-execution-policy-base'
const ORIGINAL_REVIEW_COMMENT = '5187488219'
const CORRECTION_RESULT_COMMENT = '5187802812'
const FINDING_IDS = Array.from({ length: 7 }, (_, index) => `MC-R1-00${index + 1}`)

const recoveryModulePromise = import('../../scripts/mission-control/domain/review-recovery.mjs')
const registryModulePromise = import('../../scripts/mission-control/transport-registry.mjs')
const workflowModulePromise = import('../../scripts/mission-control/workflows/recover-review.mjs')
const reconcileModulePromise = import('../../scripts/mission-control-reconcile.mjs')
const stateModulePromise = import('../../scripts/mission-control-state.mjs')

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function rawIncidentBody(): string {
  return `## REVIEW_VERDICT

**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**State:** head \`${INCIDENT_HEAD}\`
**Findings:** Critical: None · Important: ${FINDING_IDS.join(', ')} resolved
`
}

function buildIncidentRecord(
  buildRecoveryRecord: (input: Record<string, unknown>) => Record<string, unknown>,
  issueBody: string,
  prBody: string,
  {
    incidentBaseSha = INCIDENT_BASE_SHA,
    executionPolicySha = EXECUTION_POLICY_SHA,
  }: {
    incidentBaseSha?: string
    executionPolicySha?: string
  } = {},
) {
  return buildRecoveryRecord({
    repository: 'boat1994/bemoat-web-starter',
    task_issue: 274,
    pr: 275,
    base: 'main',
    exact_head: INCIDENT_HEAD,
    prior_last_reviewed_head: PREVIOUS_REVIEW_HEAD,
    review_type: 'delta',
    verdict: 'ELIGIBLE FOR FOUNDER REVIEW',
    reviewer_identity: {
      login: 'boat1994',
      github_database_id: 36528988,
      author_association: 'OWNER',
      trust_source: 'repository-owned reviewer trust policy',
    },
    expected_prior_state: 'AWAITING_REVIEW_2',
    expected_prior_counters: { review_cycle: 1, full_review_count: 1 },
    resulting_counters: { review_cycle: 2, full_review_count: 1 },
    lineage: {
      original_review_comment_id: 5187488219,
      correction_result_comment_id: 5187802812,
    },
    source_evidence: [
      {
        location: 'issue:274',
        comment_id: 5187836238,
        classification: 'noncanonical_malformed',
        body_sha256: sha256(issueBody),
      },
      {
        location: 'pull:275',
        comment_id: 5187837555,
        classification: 'noncanonical_duplicate',
        body_sha256: sha256(prBody),
      },
    ],
    resolved_findings: FINDING_IDS,
    ci: [
      { name: 'ci', check_run_id: 92212805944, conclusion: 'success', head_sha: INCIDENT_HEAD },
      { name: 'starter-ci', check_run_id: 92212805950, conclusion: 'success', head_sha: INCIDENT_HEAD },
    ],
    incident_base_sha: incidentBaseSha,
    execution_policy_sha: executionPolicySha,
    policy_source_sha: POLICY_SOURCE_SHA,
  })
}

function correctionFindingContract() {
  return FINDING_IDS.map((id) => ({
    id,
    canonical_summary: `${id} immutable pinned recovery finding`,
    source_thread: `https://github.com/boat1994/bemoat-web-starter/pull/275#discussion_${id}`,
    required_evidence: ['exact pinned recovery fixture'],
    expected_areas: ['tests/int'],
    prohibited_areas: ['scripts/mission-control'],
  }))
}

function originalReviewBody(): string {
  return `## REVIEW_VERDICT

### Task log
- Timestamp: 2026-08-05T10:00:00+07:00
- Task / Issue: #274
- Phase: Review 1
- Executing role: Reviewer

**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/275 · \`main\` · \`${PREVIOUS_REVIEW_HEAD}\`
**Verdict:** CORRECTION REQUIRED
**Findings:** Critical: None · Important: ${FINDING_IDS.join(', ')}

\`\`\`json
${JSON.stringify({
  schema_version: 1,
  reviewed_head: PREVIOUS_REVIEW_HEAD,
  findings: correctionFindingContract(),
}, null, 2)}
\`\`\`
`
}

function correctionResultBody(): string {
  return `## RESULT

### Task log
- Timestamp: 2026-08-05T11:00:00+07:00
- Task / Issue: #274
- Phase: Dev (correction)
- Executing role: Dev

**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/275 · \`main\` · \`${INCIDENT_HEAD}\`
**Findings:** Critical: None · Important: ${FINDING_IDS.join(', ')} resolved

\`\`\`json
${JSON.stringify({
  schema_version: 2,
  correction_base: PREVIOUS_REVIEW_HEAD,
  finding_results: Object.fromEntries(FINDING_IDS.map((id) => [
    id,
    {
      changed_files: ['tests/int/mission-control-recover-review.int.spec.ts'],
      tests: ['pnpm exec vitest run tests/int/mission-control-recover-review.int.spec.ts'],
      status: 'CLAIMED_RESOLVED',
    },
  ])),
}, null, 2)}
\`\`\`
`
}

function initialManagedState(): Record<string, unknown> {
  return {
    schema_version: 1,
    state: 'AWAITING_REVIEW_2',
    review_cycle: 1,
    full_review_count: 1,
    approved_base: 'main',
    active_task_issue: '#274',
    active_pr: '#275',
    current_head: INCIDENT_HEAD,
    last_reviewed_head: PREVIOUS_REVIEW_HEAD,
    guide_version: '1.3.0',
    guide_source_ref: 'main',
    guide_source_sha: POLICY_SOURCE_SHA,
    open_blockers: [...FINDING_IDS],
    follow_up_issues: [],
    next_permitted_action: 'Review 2 on the corrected exact head.',
    material_change_status: 'none',
    updated_at: '2026-08-05T11:00:00+07:00',
    updated_by: 'Mission Control',
    latest_result_comment_id: CORRECTION_RESULT_COMMENT,
    latest_review_verdict_comment_id: ORIGINAL_REVIEW_COMMENT,
  }
}

function recoveryBody(
  record: Record<string, unknown>,
  renderRecoveryReceipt: (value: Record<string, unknown>) => string,
): string {
  return `## REVIEW_VERDICT

### Task log
- Timestamp: 2026-08-05T13:00:00+07:00
**Task / Issue:** #274
- Phase: Review Recovery
- Executing role: Mission Control Recovery Transport

**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/275 · \`main\` · \`${INCIDENT_HEAD}\`
**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**Review type:** delta
**Resulting counters:** 2 / 1
**Findings:** Critical: None · Important: None
**Gates:** exact-head CI pass
**Next:** Founder merge authorization

${renderRecoveryReceipt(record)}
`
}

function executionPolicyEvidence(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    path: GUIDE_PATH,
    sha: POLICY_SOURCE_SHA,
    source_commit: EXECUTION_POLICY_SHA,
    version: '1.3.0',
    recovery_facade: {
      path: RECOVERY_FACADE_PATH,
      content: "import { main } from './mission-control/workflows/recover-review.mjs'",
    },
    recovery_workflow: {
      path: RECOVERY_WORKFLOW_PATH,
      content: 'export async function runReviewRecovery() {}',
    },
    transport_registry: {
      path: TRANSPORT_REGISTRY_PATH,
      content: "command: 'bemoat:mission-control:recover-review'",
    },
    child_override: null,
    ...overrides,
  }
}

async function createPinnedRecoveryScenario() {
  const { buildRecoveryRecord, renderRecoveryReceipt } = await recoveryModulePromise
  const { parseRecoveryArgs } = await workflowModulePromise
  const { parseMissionControlState, renderMissionControlState } = await stateModulePromise

  const sourceBody = rawIncidentBody()
  const originalReview = originalReviewBody()
  const correctionResult = correctionResultBody()
  const record = buildIncidentRecord(buildRecoveryRecord, sourceBody, sourceBody)
  const body = recoveryBody(record, renderRecoveryReceipt)
  const options = parseRecoveryArgs([
    '274',
    '--repo', 'boat1994/bemoat-web-starter',
    '--expected-pr', '275',
    '--expected-base', 'main',
    '--expected-state', 'AWAITING_REVIEW_2',
    '--expected-head', INCIDENT_HEAD,
    '--expected-review-cycle', '1',
    '--expected-full-review-count', '1',
    '--review-type', 'delta',
    '--issue-source-comment', '5187836238',
    '--pr-source-comment', '5187837555',
    '--original-review-comment', ORIGINAL_REVIEW_COMMENT,
    '--correction-result-comment', CORRECTION_RESULT_COMMENT,
    '--body-file', 'pinned-recovery.md',
  ])

  const initialState = initialManagedState()
  const issueSource = {
    id: '5187836238',
    body: sourceBody,
    issue_url: 'https://api.github.com/repos/boat1994/bemoat-web-starter/issues/274',
    user: { login: 'boat1994' },
    author_association: 'OWNER',
  }
  const prSource = {
    id: '5187837555',
    body: sourceBody,
    issue_url: 'https://api.github.com/repos/boat1994/bemoat-web-starter/issues/275',
    user: { login: 'boat1994' },
    author_association: 'OWNER',
  }
  const commentsById = new Map<string, Record<string, unknown>>([
    [issueSource.id, issueSource],
    [prSource.id, prSource],
    [ORIGINAL_REVIEW_COMMENT, { id: ORIGINAL_REVIEW_COMMENT, body: originalReview }],
    [CORRECTION_RESULT_COMMENT, { id: CORRECTION_RESULT_COMMENT, body: correctionResult }],
  ])
  const scenario = {
    managedIssue: {
      number: 274,
      body: `Mission Control mode: required\n\n${renderMissionControlState(initialState)}`,
      managedState: initialState,
    },
    pullRequest: {
      number: 275,
      baseRefName: 'main',
      baseRefOid: INCIDENT_BASE_SHA,
      headRefOid: INCIDENT_HEAD,
      state: 'OPEN',
      isDraft: false,
      statusCheckRollup: [
        { name: 'CI', conclusion: 'SUCCESS' },
        { name: 'CI (starter strict)', conclusion: 'SUCCESS' },
      ],
    },
    issueComments: [issueSource] as Array<Record<string, unknown>>,
    prComments: [prSource] as Array<Record<string, unknown>>,
    policy: executionPolicyEvidence(),
    protectedSha: EXECUTION_POLICY_SHA,
    executingCheckout: {
      ref: 'refs/heads/main',
      head_sha: EXECUTION_POLICY_SHA,
      base_sha: EXECUTION_POLICY_SHA,
      ancestor_verified: true,
      clean: true,
      implementation_paths: [RECOVERY_FACADE_PATH, RECOVERY_WORKFLOW_PATH, TRANSPORT_REGISTRY_PATH],
    },
    policyRefs: [] as string[],
    postCount: 0,
    writeCount: 0,
  }

  const checks = [
    { id: 92212805944, name: 'CI', conclusion: 'success', head_sha: INCIDENT_HEAD },
    { id: 92212805950, name: 'CI (starter strict)', conclusion: 'success', head_sha: INCIDENT_HEAD },
  ]
  const deps = {
    readManagedIssue: async () => structuredClone(scenario.managedIssue),
    readPullRequest: async () => structuredClone(scenario.pullRequest),
    readIssueComments: async (_repo: string, issueNumber: string) =>
      structuredClone(issueNumber === '274' ? scenario.issueComments : scenario.prComments),
    readComment: async (_repo: string, commentId: string) => {
      const comment = commentsById.get(String(commentId))
      if (!comment) throw new Error(`missing pinned comment ${commentId}`)
      return structuredClone(comment)
    },
    readExactHeadChecks: async () => structuredClone(checks),
    readProtectedBase: async () => ({ sha: scenario.protectedSha }),
    readExecutingCheckout: async () => structuredClone(scenario.executingCheckout),
    readPolicySource: async (_repo: string, ref: string) => {
      scenario.policyRefs.push(ref)
      return structuredClone(scenario.policy)
    },
    postComment: async (_repo: string, _issueNumber: string, commentBody: string) => {
      scenario.postCount += 1
      const comment = {
        id: 'recovery-1',
        body: commentBody,
        author: 'boat1994',
        user: { login: 'boat1994' },
        author_association: 'OWNER',
        createdAt: '2026-08-05T13:00:00+07:00',
      }
      scenario.issueComments = [...scenario.issueComments, comment]
      return comment
    },
    writeIssueBody: async ({ nextBody }: { nextBody: string }) => {
      scenario.writeCount += 1
      const parsed = parseMissionControlState(nextBody)
      if (!parsed.valid || !parsed.state) throw new Error(`invalid projected fixture state: ${parsed.reason}`)
      scenario.managedIssue = {
        ...scenario.managedIssue,
        body: nextBody,
        managedState: parsed.state,
      }
    },
  }

  return { body, deps, options, record, scenario }
}

const recoveryCliRoots: string[] = []

function writeExecutable(path: string, source: string) {
  writeFileSync(path, source, 'utf8')
  chmodSync(path, 0o755)
}

function createRecoveryCliHarness({
  scenario,
  body,
  skipProjection = false,
}: {
  scenario: Awaited<ReturnType<typeof createPinnedRecoveryScenario>>['scenario']
  body: string
  skipProjection?: boolean
}) {
  const root = mkdtempSync(join('/tmp', 'bemoat-recover-review-cli-'))
  recoveryCliRoots.push(root)

  const issue = {
    ...scenario.managedIssue,
    number: 274,
    state: 'OPEN',
  }
  const sourceIssue = scenario.issueComments[0]
  const sourcePr = scenario.prComments[0]
  const issueComments = [
    sourceIssue,
    {
      id: ORIGINAL_REVIEW_COMMENT,
      body: originalReviewBody(),
      user: { login: 'boat1994' },
      author_association: 'OWNER',
    },
    {
      id: CORRECTION_RESULT_COMMENT,
      body: correctionResultBody(),
      user: { login: 'boat1994' },
      author_association: 'OWNER',
    },
  ]
  const prComments = [sourcePr]
  const comments = [...issueComments, ...prComments]
  const checks = [
    { id: 92212805944, name: 'CI', conclusion: 'success', head_sha: INCIDENT_HEAD },
    { id: 92212805950, name: 'starter-ci', conclusion: 'success', head_sha: INCIDENT_HEAD },
  ]
  const policyFiles = {
    guide: readFileSync(resolve(GUIDE_PATH), 'utf8'),
    recoveryFacade: readFileSync(resolve(RECOVERY_FACADE_PATH), 'utf8'),
    recoveryWorkflow: readFileSync(resolve(RECOVERY_WORKFLOW_PATH), 'utf8'),
    transportRegistry: readFileSync(resolve(TRANSPORT_REGISTRY_PATH), 'utf8'),
  }

  writeFileSync(join(root, 'issue.json'), JSON.stringify(issue))
  writeFileSync(join(root, 'pr.json'), JSON.stringify(scenario.pullRequest))
  writeFileSync(join(root, 'issue-comments.json'), JSON.stringify(issueComments))
  writeFileSync(join(root, 'pr-comments.json'), JSON.stringify(prComments))
  writeFileSync(join(root, 'comments.json'), JSON.stringify(comments))
  writeFileSync(join(root, 'checks.json'), JSON.stringify(checks))
  writeFileSync(join(root, 'policy.json'), JSON.stringify({ ...scenario.policy, ...policyFiles }))
  writeFileSync(join(root, 'checkout.json'), JSON.stringify(scenario.executingCheckout))
  writeFileSync(join(root, 'protected.json'), JSON.stringify({ sha: scenario.protectedSha }))
  writeFileSync(join(root, 'metrics.json'), JSON.stringify({
    issueEdits: 0,
    posts: 0,
    leaseWrites: 0,
  }))
  writeFileSync(join(root, 'body.md'), body)

  const gh = join(root, 'gh')
  writeExecutable(gh, `#!/usr/bin/env node
import {
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

const root = ${JSON.stringify(root)}
const args = process.argv.slice(2)
const endpoint = args.find((value) => value.startsWith('repos/')) ?? ''
const readJson = (name) => JSON.parse(readFileSync(join(root, name), 'utf8'))
const writeJson = (name, value) => writeFileSync(join(root, name), JSON.stringify(value))
const fail = (message) => {
  process.stderr.write(message + '\\n')
  process.exit(1)
}
const stdinText = async () => {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}
const methodIndex = args.indexOf('--method')
const method = methodIndex >= 0 ? args[methodIndex + 1] : (
  args.includes('-X') ? args[args.indexOf('-X') + 1] : 'GET'
)

if (args[0] === 'issue' && args[1] === 'view') {
  process.stdout.write(JSON.stringify(readJson('issue.json')))
  process.exit(0)
}

if (args[0] === 'pr' && args[1] === 'view') {
  process.stdout.write(JSON.stringify(readJson('pr.json')))
  process.exit(0)
}

if (args[0] === 'issue' && args[1] === 'edit') {
  const metrics = readJson('metrics.json')
  metrics.issueEdits += 1
  writeJson('metrics.json', metrics)
  if (${skipProjection ? 'false' : 'true'}) {
    const bodyFile = args[args.indexOf('--body-file') + 1]
    const issue = readJson('issue.json')
    issue.body = readFileSync(bodyFile, 'utf8')
    writeJson('issue.json', issue)
  }
  process.exit(0)
}

if (args[0] === 'api' && method === 'POST' && endpoint.endsWith('/issues/274/comments')) {
  const payload = JSON.parse(await stdinText())
  const comments = readJson('issue-comments.json')
  const metrics = readJson('metrics.json')
  metrics.posts += 1
  const comment = {
    id: 'recovery-' + metrics.posts,
    body: payload.body,
    user: { login: 'boat1994' },
    author_association: 'OWNER',
    issue_number: 274,
  }
  comments.push(comment)
  writeJson('issue-comments.json', comments)
  writeJson('comments.json', [...comments, ...readJson('pr-comments.json')])
  writeJson('metrics.json', metrics)
  process.stdout.write(JSON.stringify(comment))
  process.exit(0)
}

if (args[0] === 'api' && args.includes('--paginate') && endpoint.endsWith('/issues/274/comments?per_page=100')) {
  process.stdout.write(JSON.stringify([readJson('issue-comments.json')]))
  process.exit(0)
}

if (args[0] === 'api' && args.includes('--paginate') && endpoint.endsWith('/issues/275/comments?per_page=100')) {
  process.stdout.write(JSON.stringify([readJson('pr-comments.json')]))
  process.exit(0)
}

const commentMatch = endpoint.match(/\\/issues\\/comments\\/(\\d+)$/)
if (args[0] === 'api' && commentMatch) {
  const comment = readJson('comments.json').find((entry) => String(entry.id) === commentMatch[1])
  if (!comment) fail('404 Not Found')
  process.stdout.write(JSON.stringify(comment))
  process.exit(0)
}

if (args[0] === 'api' && endpoint.includes('/commits/') && endpoint.includes('/check-runs')) {
  process.stdout.write(JSON.stringify({ check_runs: readJson('checks.json') }))
  process.exit(0)
}

if (args[0] === 'api' && endpoint.endsWith('/git/ref/heads/main')) {
  process.stdout.write(JSON.stringify({ object: { sha: readJson('protected.json').sha } }))
  process.exit(0)
}

if (args[0] === 'api' && endpoint.includes('/git/ref/heads/bemoat/mission-control-leases')) {
  process.stdout.write(JSON.stringify({ ref: 'refs/heads/bemoat/mission-control-leases', object: { sha: 'lease-branch' } }))
  process.exit(0)
}

if (args[0] === 'api' && endpoint.includes('/contents/.bemoat/mission-control/leases/')) {
  const leasePath = join(root, 'lease.json')
  const isPut = args.includes('-X') && args[args.indexOf('-X') + 1] === 'PUT'
  if (!isPut) {
    if (!existsSync(leasePath)) fail('404 Not Found')
    const lease = readJson('lease.json')
    process.stdout.write(JSON.stringify({
      sha: lease.sha,
      content: Buffer.from(JSON.stringify(lease.content), 'utf8').toString('base64'),
    }))
    process.exit(0)
  }

  const payload = JSON.parse(await stdinText())
  const current = existsSync(leasePath) ? readJson('lease.json') : null
  if (payload.sha && (!current || payload.sha !== current.sha)) fail('409 Conflict')
  const metrics = readJson('metrics.json')
  metrics.leaseWrites += 1
  const next = {
    sha: 'lease-' + metrics.leaseWrites,
    content: JSON.parse(Buffer.from(payload.content, 'base64').toString('utf8')),
  }
  writeJson('lease.json', next)
  writeJson('metrics.json', metrics)
  process.stdout.write(JSON.stringify({ content: { sha: next.sha } }))
  process.exit(0)
}

if (args[0] === 'api' && endpoint.endsWith('/contents/docs/mission-control/mission-control-guide.md?ref=${EXECUTION_POLICY_SHA}')) {
  const policy = readJson('policy.json')
  process.stdout.write(JSON.stringify({
    path: '${GUIDE_PATH}',
    sha: '${POLICY_SOURCE_SHA}',
    encoding: 'base64',
    content: Buffer.from(policy.guide, 'utf8').toString('base64'),
  }))
  process.exit(0)
}

if (args[0] === 'api' && endpoint.includes('/contents/scripts/mission-control-recover-review.mjs?ref=')) {
  const policy = readJson('policy.json')
  process.stdout.write(JSON.stringify({
    path: '${RECOVERY_FACADE_PATH}',
    sha: 'f'.repeat(40),
    encoding: 'base64',
    content: Buffer.from(policy.recoveryFacade, 'utf8').toString('base64'),
  }))
  process.exit(0)
}

if (args[0] === 'api' && endpoint.includes('/contents/scripts/mission-control/workflows/recover-review.mjs?ref=')) {
  const policy = readJson('policy.json')
  process.stdout.write(JSON.stringify({
    path: '${RECOVERY_WORKFLOW_PATH}',
    sha: 'f'.repeat(40),
    encoding: 'base64',
    content: Buffer.from(policy.recoveryWorkflow, 'utf8').toString('base64'),
  }))
  process.exit(0)
}

if (args[0] === 'api' && endpoint.includes('/contents/scripts/mission-control/transport-registry.mjs?ref=')) {
  const policy = readJson('policy.json')
  process.stdout.write(JSON.stringify({
    path: '${TRANSPORT_REGISTRY_PATH}',
    sha: 'f'.repeat(40),
    encoding: 'base64',
    content: Buffer.from(policy.transportRegistry, 'utf8').toString('base64'),
  }))
  process.exit(0)
}

if (args[0] === 'api' && endpoint.includes('/contents/.bemoat/mission-control-overrides.md?ref=')) {
  fail('404 Not Found')
}

fail('unsupported gh call: ' + args.join(' '))
`)

  const git = join(root, 'git')
  writeExecutable(git, `#!/bin/sh
if [ "$1" = "rev-parse" ] && [ "$2" = "HEAD" ]; then
  printf '%s' '${EXECUTION_POLICY_SHA}'
elif [ "$1" = "symbolic-ref" ] && [ "$2" = "--short" ] && [ "$3" = "HEAD" ]; then
  printf '%s' 'main'
elif [ "$1" = "merge-base" ]; then
  printf '%s' '${EXECUTION_POLICY_SHA}'
elif [ "$1" = "ls-tree" ]; then
  printf '%s\\n' '${RECOVERY_FACADE_PATH}' '${RECOVERY_WORKFLOW_PATH}' '${TRANSPORT_REGISTRY_PATH}'
elif [ "$1" = "status" ]; then
  :
else
  printf 'unexpected git call\\n' >&2
  exit 1
fi
`)

  return {
    root,
    env: {
      PATH: `${root}:${process.env.PATH ?? ''}`,
      BEMOAT_FACADE_COMMAND: 'bemoat:mission-control:recover-review',
      BEMOAT_FACADE_ENTRYPOINT: RECOVERY_FACADE_PATH,
      npm_lifecycle_event: 'bemoat:mission-control:recover-review',
    },
  }
}

function recoveryCliArgs(bodyFile: string): string[] {
  return [
    '274',
    '--repo', 'boat1994/bemoat-web-starter',
    '--expected-pr', '275',
    '--expected-base', 'main',
    '--expected-state', 'AWAITING_REVIEW_2',
    '--expected-head', INCIDENT_HEAD,
    '--expected-review-cycle', '1',
    '--expected-full-review-count', '1',
    '--review-type', 'delta',
    '--issue-source-comment', '5187836238',
    '--pr-source-comment', '5187837555',
    '--original-review-comment', ORIGINAL_REVIEW_COMMENT,
    '--correction-result-comment', CORRECTION_RESULT_COMMENT,
    '--body-file', bodyFile,
    '--json',
  ]
}

function runRecoveryCli(
  harness: ReturnType<typeof createRecoveryCliHarness>,
) {
  return spawnSync(
    process.execPath,
    [resolve(process.cwd(), RECOVERY_FACADE_PATH), ...recoveryCliArgs(join(harness.root, 'body.md'))],
    {
      cwd: process.cwd(),
      env: { ...process.env, ...harness.env },
      encoding: 'utf8',
    },
  )
}

function recoveryMetrics(harness: ReturnType<typeof createRecoveryCliHarness>) {
  return JSON.parse(readFileSync(join(harness.root, 'metrics.json'), 'utf8')) as {
    issueEdits: number
    posts: number
    leaseWrites: number
  }
}

afterEach(() => {
  for (const root of recoveryCliRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('Mission Control review recovery transport', () => {
  it('registers one exceptional recovery route without changing ordinary review ownership', async () => {
    const { CANONICAL_TRANSPORTS, getTransportRoute } = await registryModulePromise

    expect(getTransportRoute('bemoat:mission-control:recover-review')).toMatchObject({
      owner: 'Mission Control Recovery Transport',
      role: 'REVIEW_VERDICT',
      exceptional: true,
      ordinary_owner: 'bemoat:mission-control:review',
    })
    expect(CANONICAL_TRANSPORTS.filter((route) => route.role === 'REVIEW_VERDICT')).toHaveLength(2)
  })

  it('requires the merged-guide Review 2 projection to be exactly 2/1', async () => {
    const { buildRecoveryRecord, validateRecoveryRecord } = await recoveryModulePromise
    const issueBody = rawIncidentBody()
    const record = buildIncidentRecord(buildRecoveryRecord, issueBody, issueBody)

    expect(record).toMatchObject({
      record_kind: 'review_recovery',
      resulting_counters: { review_cycle: 2, full_review_count: 1 },
      source_evidence: [
        { comment_id: 5187836238, location: 'issue:274' },
        { comment_id: 5187837555, location: 'pull:275' },
      ],
    })
    expect(validateRecoveryRecord(record)).toMatchObject({ ok: true })

    const malformed = {
      ...record,
      resulting_counters: { review_cycle: 1, full_review_count: 1 },
    }
    expect(validateRecoveryRecord(malformed)).toMatchObject({
      ok: false,
      errors: expect.arrayContaining(['resulting counters must be exactly 2/1']),
    })
  })

  it('round-trips divergent recovery bindings and changes identity independently', async () => {
    const {
      buildRecoveryRecord,
      parseRecoveryReceipt,
      renderRecoveryReceipt,
      validateRecoveryRecord,
    } = await recoveryModulePromise
    const issueBody = rawIncidentBody()
    const record = buildIncidentRecord(buildRecoveryRecord, issueBody, issueBody, {
      incidentBaseSha: INCIDENT_BASE_SHA.toUpperCase(),
      executionPolicySha: EXECUTION_POLICY_SHA.toUpperCase(),
    })

    expect(record).toMatchObject({
      schema_version: 2,
      incident_base_sha: INCIDENT_BASE_SHA,
      execution_policy_sha: EXECUTION_POLICY_SHA,
      policy_source_sha: POLICY_SOURCE_SHA,
    })
    expect(record).not.toHaveProperty('protected_base_sha')
    expect(INCIDENT_BASE_SHA).not.toBe(EXECUTION_POLICY_SHA)
    expect(validateRecoveryRecord(record)).toMatchObject({ ok: true })

    const parsed = parseRecoveryReceipt(renderRecoveryReceipt(record))
    expect(parsed).toMatchObject({ ok: true, record })

    const incidentChanged = buildIncidentRecord(buildRecoveryRecord, issueBody, issueBody, {
      incidentBaseSha: '1'.repeat(40),
    })
    const executionChanged = buildIncidentRecord(buildRecoveryRecord, issueBody, issueBody, {
      executionPolicySha: '2'.repeat(40),
    })
    expect(incidentChanged.transition_identity_sha256).not.toBe(record.transition_identity_sha256)
    expect(executionChanged.transition_identity_sha256).not.toBe(record.transition_identity_sha256)
  })

  it('rejects missing and legacy single-field recovery bindings', async () => {
    const { buildRecoveryRecord, parseRecoveryReceipt, validateRecoveryRecord } =
      await recoveryModulePromise
    const issueBody = rawIncidentBody()
    const record = buildIncidentRecord(buildRecoveryRecord, issueBody, issueBody)

    const missingIncident = { ...record }
    delete missingIncident.incident_base_sha
    expect(validateRecoveryRecord(missingIncident)).toMatchObject({
      ok: false,
      errors: expect.arrayContaining(['incident_base_sha must be a full SHA']),
    })

    const missingExecution = { ...record }
    delete missingExecution.execution_policy_sha
    expect(validateRecoveryRecord(missingExecution)).toMatchObject({
      ok: false,
      errors: expect.arrayContaining(['execution_policy_sha must be a full SHA']),
    })

    const legacyRecord: Record<string, unknown> = {
      ...record,
      schema_version: 1,
      protected_base_sha: INCIDENT_BASE_SHA,
    }
    delete legacyRecord.incident_base_sha
    delete legacyRecord.execution_policy_sha
    expect(validateRecoveryRecord(legacyRecord)).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([
        'schema_version must be 2',
        'protected_base_sha is an ambiguous legacy recovery binding',
      ]),
    })

    const legacyReceipt = [
      '<!-- bemoat:review-recovery:v1 -->',
      '```json',
      JSON.stringify(legacyRecord),
      '```',
      '<!-- /bemoat:review-recovery:v1 -->',
    ].join('\n')
    expect(parseRecoveryReceipt(legacyReceipt)).toMatchObject({
      ok: false,
    })
  })

  it('quarantines the two raw incident comments only after a matching typed receipt exists', async () => {
    const { buildRecoveryRecord, detectUnaccountedReviewEvidence, renderRecoveryReceipt } =
      await recoveryModulePromise
    const issueBody = rawIncidentBody()
    const prBody = issueBody
    const record = buildIncidentRecord(buildRecoveryRecord, issueBody, prBody)
    const receipt = {
      id: 'recovery-1',
      body: renderRecoveryReceipt(record),
      createdAt: '2026-08-05T13:00:00+07:00',
    }
    const issueComments = [
      {
        id: '5187836238',
        body: issueBody,
        createdAt: '2026-08-05T12:00:00+07:00',
        author: 'boat1994',
        author_association: 'OWNER',
      },
    ]
    const prComments = [
      {
        id: '5187837555',
        body: prBody,
        createdAt: '2026-08-05T12:01:00+07:00',
        author: 'boat1994',
        author_association: 'OWNER',
      },
    ]
    const context = {
      repository: 'boat1994/bemoat-web-starter',
      taskIssue: 274,
      activePr: 275,
      managedState: {
        state: 'AWAITING_REVIEW_2',
        active_pr: '#275',
        current_head: INCIDENT_HEAD,
        updated_at: '2026-08-05T11:00:00+07:00',
        latest_review_verdict_comment_id: '5187488219',
      },
    }

    const blocked = detectUnaccountedReviewEvidence({
      ...context,
      issueComments,
      prComments,
    })
    expect(blocked.ok).toBe(false)
    expect(blocked.code).toBe('NONCANONICAL_ROLE_EVIDENCE')
    expect(blocked.recoveryCommand).toContain('bemoat:mission-control:recover-review')

    const accounted = detectUnaccountedReviewEvidence({
      ...context,
      issueComments: [...issueComments, receipt],
      prComments,
    })
    expect(accounted).toMatchObject({ ok: true, quarantined: ['5187836238', '5187837555'] })
  })

  it('does not loosen the ordinary parser for prose-only PR references', async () => {
    const { parseOrdinaryReviewEvidence } = await recoveryModulePromise

    expect(parseOrdinaryReviewEvidence(`## REVIEW_VERDICT

The PR #275 is ready, but this is not a canonical binding.
`)).toMatchObject({
      canonical: false,
      pr: null,
    })
  })

  it('accepts only the pinned exact-incident CLI contract', async () => {
    const { parseRecoveryArgs } = await workflowModulePromise
    const options = parseRecoveryArgs([
      '274',
      '--repo', 'boat1994/bemoat-web-starter',
      '--expected-pr', '275',
      '--expected-base', 'main',
      '--expected-state', 'AWAITING_REVIEW_2',
      '--expected-head', INCIDENT_HEAD,
      '--expected-review-cycle', '1',
      '--expected-full-review-count', '1',
      '--review-type', 'delta',
      '--issue-source-comment', '5187836238',
      '--pr-source-comment', '5187837555',
      '--original-review-comment', '5187488219',
      '--correction-result-comment', '5187802812',
      '--body-file', 'recovery.md',
    ])

    expect(options).toMatchObject({ issueNumber: '274', expectedPr: '275', reviewType: 'delta' })
    expect(() => parseRecoveryArgs(['274', '--repo', 'other/repo'])).toThrow(
      /--expected-pr is required/,
    )
  })

  it('accepts divergent incident and execution bases', async () => {
    const { parseRecoveryReceipt } = await recoveryModulePromise
    const { runReviewRecovery } = await workflowModulePromise
    const { body, deps, options, record, scenario } = await createPinnedRecoveryScenario()
    const sourceIssueBody = scenario.issueComments[0].body
    const sourcePrBody = scenario.prComments[0].body

    expect(record).toMatchObject({
      expected_prior_state: 'AWAITING_REVIEW_2',
      expected_prior_counters: { review_cycle: 1, full_review_count: 1 },
      incident_base_sha: INCIDENT_BASE_SHA,
      execution_policy_sha: EXECUTION_POLICY_SHA,
      policy_source_sha: POLICY_SOURCE_SHA,
      exact_head: INCIDENT_HEAD,
      prior_last_reviewed_head: PREVIOUS_REVIEW_HEAD,
      lineage: {
        original_review_comment_id: 5187488219,
        correction_result_comment_id: 5187802812,
      },
      resolved_findings: FINDING_IDS,
      ci: [
        { name: 'ci', conclusion: 'success', head_sha: INCIDENT_HEAD },
        { name: 'starter-ci', conclusion: 'success', head_sha: INCIDENT_HEAD },
      ],
    })
    expect(scenario.managedIssue.managedState).toMatchObject({
      state: 'AWAITING_REVIEW_2',
      review_cycle: 1,
      full_review_count: 1,
      active_pr: '#275',
      current_head: INCIDENT_HEAD,
      last_reviewed_head: PREVIOUS_REVIEW_HEAD,
      latest_result_comment_id: CORRECTION_RESULT_COMMENT,
      latest_review_verdict_comment_id: ORIGINAL_REVIEW_COMMENT,
      open_blockers: FINDING_IDS,
    })
    expect(scenario.pullRequest).toMatchObject({
      baseRefOid: INCIDENT_BASE_SHA,
      headRefOid: INCIDENT_HEAD,
      state: 'OPEN',
    })

    await expect(runReviewRecovery({ options, body, deps })).resolves.toMatchObject({
      outcome: 'RECOVERED',
    })
    expect(scenario.policyRefs).toEqual([EXECUTION_POLICY_SHA])
    expect(scenario.postCount).toBe(1)
    expect(scenario.managedIssue.managedState).toMatchObject({
      state: 'ELIGIBLE_FOR_FOUNDER_REVIEW',
      review_cycle: 2,
      full_review_count: 1,
      current_head: INCIDENT_HEAD,
      last_reviewed_head: INCIDENT_HEAD,
    })
    expect(scenario.issueComments.find((comment) => comment.id === '5187836238')?.body).toBe(sourceIssueBody)
    expect(scenario.prComments.find((comment) => comment.id === '5187837555')?.body).toBe(sourcePrBody)
    const receipts = scenario.issueComments.filter((comment) => parseRecoveryReceipt(String(comment.body ?? '')).ok)
    expect(receipts).toHaveLength(1)
    expect(parseRecoveryReceipt(String(receipts[0].body ?? ''))).toMatchObject({
      ok: true,
      record: {
        incident_base_sha: INCIDENT_BASE_SHA,
        execution_policy_sha: EXECUTION_POLICY_SHA,
        transition_identity_sha256: record.transition_identity_sha256,
      },
    })
  })

  it('valid and identical retry fixtures map to canonical success classes', async () => {
    const { body, scenario } = await createPinnedRecoveryScenario()
    const harness = createRecoveryCliHarness({ scenario, body })

    const first = runRecoveryCli(harness)
    expect(first.status, first.stderr || first.stdout).toBe(0)
    expect(first.stderr).toBe('')
    const firstEnvelope = JSON.parse(first.stdout) as Record<string, unknown>
    assertResultEnvelopeV1(firstEnvelope)
    expect(firstEnvelope).toMatchObject({
      command: 'bemoat:mission-control:recover-review',
      mode: 'result',
      outcome: 'SUCCESS',
      classification: 'SUCCESS',
      mutation_performed: true,
      details: {
        legacy_classification: 'RECOVERED',
      },
    })

    const second = runRecoveryCli(harness)
    expect(second.status, second.stderr || second.stdout).toBe(0)
    expect(second.stderr).toBe('')
    const secondEnvelope = JSON.parse(second.stdout) as Record<string, unknown>
    assertResultEnvelopeV1(secondEnvelope)
    expect(secondEnvelope).toMatchObject({
      command: 'bemoat:mission-control:recover-review',
      mode: 'result',
      outcome: 'NO_OP',
      classification: 'NO_OP_IDENTICAL_RETRY',
      mutation_performed: false,
      details: {
        legacy_classification: 'NO_OP',
      },
    })

    expect(recoveryMetrics(harness)).toMatchObject({
      issueEdits: 1,
      posts: 1,
    })
  }, 20000)

  it('unproved partial writes exit four', async () => {
    const { body, scenario } = await createPinnedRecoveryScenario()
    const harness = createRecoveryCliHarness({
      scenario,
      body,
      skipProjection: true,
    })

    const result = runRecoveryCli(harness)
    expect(result.status, result.stderr || result.stdout).toBe(4)
    expect(result.stderr).toBe('')
    const envelope = JSON.parse(result.stdout) as Record<string, unknown>
    assertResultEnvelopeV1(envelope)
    expect(envelope).toMatchObject({
      command: 'bemoat:mission-control:recover-review',
      mode: 'result',
      outcome: 'ERROR',
      classification: 'AMBIGUOUS_RESULT',
      mutation_performed: true,
      next_action: {
        type: 'STOP',
        command: null,
      },
    })
    expect(recoveryMetrics(harness)).toMatchObject({
      issueEdits: 1,
      posts: 1,
    })
  }, 20000)

  it('ordinary review evidence cannot enter recover-review', async () => {
    const { scenario } = await createPinnedRecoveryScenario()
    const harness = createRecoveryCliHarness({
      scenario,
      body: originalReviewBody(),
    })

    const result = runRecoveryCli(harness)
    expect(result.status, result.stderr || result.stdout).toBe(3)
    expect(result.stderr).toBe('')
    const envelope = JSON.parse(result.stdout) as Record<string, unknown>
    assertResultEnvelopeV1(envelope)
    expect(envelope).toMatchObject({
      command: 'bemoat:mission-control:recover-review',
      mode: 'result',
      outcome: 'ERROR',
      classification: 'EVIDENCE_CONFLICT',
      mutation_performed: false,
      next_action: {
        type: 'STOP',
        command: null,
      },
    })
    expect(recoveryMetrics(harness)).toMatchObject({
      issueEdits: 0,
      posts: 0,
    })
  })

  it('returns a deterministic NO_OP on retry without a second winner or source mutation', async () => {
    const { parseRecoveryReceipt } = await recoveryModulePromise
    const { runReviewRecovery } = await workflowModulePromise
    const { body, deps, options, scenario } = await createPinnedRecoveryScenario()
    const sourceIssueBody = scenario.issueComments[0].body
    const sourcePrBody = scenario.prComments[0].body

    const first = await runReviewRecovery({ options, body, deps })
    const firstState = structuredClone(scenario.managedIssue.managedState)
    const firstReceipt = scenario.issueComments.find((comment) => parseRecoveryReceipt(String(comment.body ?? '')).ok)

    const retry = await runReviewRecovery({ options, body, deps })

    expect(first).toMatchObject({ outcome: 'RECOVERED', comment: { id: 'recovery-1' } })
    expect(retry).toMatchObject({ outcome: 'NO_OP', comment: { id: 'recovery-1' } })
    expect(retry.comment?.id).toBe(first.comment?.id)
    expect(retry.recoveryComments).toHaveLength(1)
    expect(scenario.policyRefs).toEqual([EXECUTION_POLICY_SHA, EXECUTION_POLICY_SHA])
    expect(scenario.postCount).toBe(1)
    expect(scenario.writeCount).toBe(1)
    expect(scenario.managedIssue.managedState).toEqual(firstState)
    expect(scenario.issueComments.find((comment) => comment.id === '5187836238')?.body).toBe(sourceIssueBody)
    expect(scenario.prComments.find((comment) => comment.id === '5187837555')?.body).toBe(sourcePrBody)
    expect(scenario.issueComments.filter((comment) => parseRecoveryReceipt(String(comment.body ?? '')).ok)).toEqual([firstReceipt])
  })

  it('rejects incident-base drift before any recovery mutation', async () => {
    const { runReviewRecovery } = await workflowModulePromise
    const { body, deps, options, scenario } = await createPinnedRecoveryScenario()
    scenario.pullRequest.baseRefOid = '1'.repeat(40)

    await expect(runReviewRecovery({ options, body, deps })).rejects.toThrow(
      'STATE_CONFLICT: incident base SHA differs from the recovery record',
    )
    expect(scenario.policyRefs).toEqual([])
    expect(scenario.postCount).toBe(0)
    expect(scenario.writeCount).toBe(0)
  })

  it('rejects an untrusted execution-policy SHA before any recovery mutation', async () => {
    const { runReviewRecovery } = await workflowModulePromise
    const { body, deps, options, scenario } = await createPinnedRecoveryScenario()
    scenario.protectedSha = '2'.repeat(40)

    await expect(runReviewRecovery({ options, body, deps })).rejects.toThrow(
      'STATE_CONFLICT: execution policy SHA differs from the recovery record',
    )
    expect(scenario.policyRefs).toEqual([])
    expect(scenario.postCount).toBe(0)
    expect(scenario.writeCount).toBe(0)
  })

  it('rejects execution-policy evidence missing the reviewed recovery implementation', async () => {
    const { runReviewRecovery } = await workflowModulePromise
    const { body, deps, options, scenario } = await createPinnedRecoveryScenario()
    scenario.policy = executionPolicyEvidence({ recovery_facade: null })

    await expect(runReviewRecovery({ options, body, deps })).rejects.toThrow(
      'STATE_CONFLICT: recovery facade is missing from the execution policy commit',
    )
    expect(scenario.postCount).toBe(0)
    expect(scenario.writeCount).toBe(0)
  })

  it('rejects current guide or policy-source mismatches', async () => {
    const { runReviewRecovery } = await workflowModulePromise
    for (const policyOverride of [
      { version: '1.2.0' },
      { sha: 'f'.repeat(40) },
    ]) {
      const { body, deps, options, scenario } = await createPinnedRecoveryScenario()
      scenario.policy = executionPolicyEvidence(policyOverride)

      await expect(runReviewRecovery({ options, body, deps })).rejects.toThrow(
        /STATE_CONFLICT: (current Mission Control guide version|merged Mission Control policy source)/,
      )
      expect(scenario.postCount).toBe(0)
      expect(scenario.writeCount).toBe(0)
    }
  })

  it('rejects execution-policy evidence loaded from the historical incident base', async () => {
    const { runReviewRecovery } = await workflowModulePromise
    const { body, deps, options, scenario } = await createPinnedRecoveryScenario()
    scenario.policy = executionPolicyEvidence({ source_commit: INCIDENT_BASE_SHA })

    await expect(runReviewRecovery({ options, body, deps })).rejects.toThrow(
      'STATE_CONFLICT: Mission Control policy was not loaded from the execution policy SHA',
    )
    expect(scenario.postCount).toBe(0)
    expect(scenario.writeCount).toBe(0)
  })

  it('rejects self-declared policy identity when the observed checkout does not match', async () => {
    const { runReviewRecovery } = await workflowModulePromise
    const { body, deps, options, scenario } = await createPinnedRecoveryScenario()
    scenario.executingCheckout.head_sha = '1'.repeat(40)

    await expect(runReviewRecovery({ options, body, deps })).rejects.toThrow(
      'STATE_CONFLICT: executing recovery checkout does not match trusted policy implementation',
    )
    expect(scenario.postCount).toBe(0)
    expect(scenario.writeCount).toBe(0)
  })

  it('rejects an unrelated hotfix checkout', async () => {
    const { runReviewRecovery } = await workflowModulePromise
    const { body, deps, options, scenario } = await createPinnedRecoveryScenario()
    scenario.executingCheckout = {
      ...scenario.executingCheckout,
      ref: 'hotfix/unrelated-recovery',
      head_sha: '2'.repeat(40),
      base_sha: EXECUTION_POLICY_SHA,
      ancestor_verified: true,
    }

    await expect(runReviewRecovery({ options, body, deps })).rejects.toThrow(
      'STATE_CONFLICT: executing recovery checkout does not match trusted policy implementation',
    )
    expect(scenario.postCount).toBe(0)
    expect(scenario.writeCount).toBe(0)
  })

  it('accepts only the explicitly authorized hotfix based on the trusted policy tip', async () => {
    const { runReviewRecovery } = await workflowModulePromise
    const { body, deps, options, scenario } = await createPinnedRecoveryScenario()
    scenario.executingCheckout = {
      ...scenario.executingCheckout,
      ref: AUTHORIZED_HOTFIX_BRANCH,
      head_sha: '3'.repeat(40),
      base_sha: EXECUTION_POLICY_SHA,
      ancestor_verified: true,
    }

    await expect(runReviewRecovery({ options, body, deps })).resolves.toMatchObject({
      outcome: 'RECOVERED',
    })
    expect(scenario.postCount).toBe(1)
  })

  it('rejects a child override that relaxes shared invariants', async () => {
    const { runReviewRecovery } = await workflowModulePromise
    const { body, deps, options, scenario } = await createPinnedRecoveryScenario()
    scenario.policy = executionPolicyEvidence({
      child_override: {
        path: '.bemoat/mission-control-overrides.md',
        content: 'max_review_cycles: 4',
      },
    })

    await expect(runReviewRecovery({ options, body, deps })).rejects.toThrow(
      'STATE_CONFLICT: child Mission Control override relaxes shared invariants',
    )
    expect(scenario.postCount).toBe(0)
    expect(scenario.writeCount).toBe(0)
  })

  it('rejects structured, unsupported, and malformed child overrides', async () => {
    const { runReviewRecovery } = await workflowModulePromise
    for (const content of [
      'allow_auto_merge: true',
      'remove_exact_head_checks: true',
      'minor_nit_blocking: true',
      'allow_destructive_migrations: true',
      'chat_history_authoritative: true',
      'allow_silent_state_reset: true',
      'required_checks: null',
      'required_checks: true',
      'manual_qa: {}',
      'protected_paths: [true]',
      'unknown_policy_key: [',
    ]) {
      const { body, deps, options, scenario } = await createPinnedRecoveryScenario()
      scenario.policy = executionPolicyEvidence({
        child_override: {
          path: '.bemoat/mission-control-overrides.md',
          content,
        },
      })

      await expect(runReviewRecovery({ options, body, deps })).rejects.toThrow(
        'STATE_CONFLICT: child Mission Control override relaxes shared invariants',
      )
      expect(scenario.postCount).toBe(0)
      expect(scenario.writeCount).toBe(0)
    }
  })

  it('fails closed when competing canonical evidence appears before recovery projection', async () => {
    const { runReviewRecovery } = await workflowModulePromise
    const { body, deps, options, scenario } = await createPinnedRecoveryScenario()
    scenario.issueComments = [
      ...scenario.issueComments,
      {
        id: 'later-canonical-review',
        body: `## REVIEW_VERDICT

**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/275 · \`main\` · \`${INCIDENT_HEAD}\`
`,
        author: 'boat1994',
        author_association: 'OWNER',
      },
    ]

    await expect(runReviewRecovery({ options, body, deps })).rejects.toThrow(
      'STATE_CONFLICT: later canonical role evidence later-canonical-review blocks recovery',
    )
    expect(scenario.policyRefs).toEqual([EXECUTION_POLICY_SHA])
    expect(scenario.postCount).toBe(0)
    expect(scenario.writeCount).toBe(0)
    expect(scenario.issueComments).toHaveLength(2)
  })

  it('recovers an ambiguous pinned comment POST without creating a duplicate winner', async () => {
    const { parseRecoveryReceipt } = await recoveryModulePromise
    const { runReviewRecovery } = await workflowModulePromise
    const { body, deps, options, scenario } = await createPinnedRecoveryScenario()
    const postComment = deps.postComment
    let postAttempts = 0
    deps.postComment = async (repo: string, issueNumber: string, commentBody: string) => {
      postAttempts += 1
      await postComment(repo, issueNumber, commentBody)
      throw new Error('ambiguous network response after pinned recovery comment POST')
    }

    const result = await runReviewRecovery({ options, body, deps })
    const receipts = scenario.issueComments.filter((comment) => parseRecoveryReceipt(String(comment.body ?? '')).ok)

    expect(result).toMatchObject({
      outcome: 'RECOVERED',
      comment: { id: 'recovery-1' },
    })
    expect(postAttempts).toBe(1)
    expect(scenario.postCount).toBe(1)
    expect(scenario.writeCount).toBe(1)
    expect(receipts).toHaveLength(1)
    expect(scenario.managedIssue.managedState).toMatchObject({
      state: 'ELIGIBLE_FOR_FOUNDER_REVIEW',
      review_cycle: 2,
      full_review_count: 1,
      latest_review_verdict_comment_id: 'recovery-1',
    })
  })

  it('resumes an ambiguous recovery comment POST without posting a duplicate', async () => {
    const { Coordinator } = await reconcileModulePromise
    const body = `## REVIEW_VERDICT

### Task log
- Timestamp: 2026-08-05T13:00:00+07:00
- Task / Issue: #274
- Phase: Review Recovery
- Executing role: Mission Control Recovery Transport

**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/275 · \`main\` · \`${INCIDENT_HEAD}\`
**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**Findings:** Critical: None · Important: None
**Gates:** exact-head CI pass
**Next:** Founder merge authorization
`
    let state: Record<string, unknown> = {
      state: 'AWAITING_REVIEW_2',
      review_cycle: 1,
      full_review_count: 1,
      current_head: INCIDENT_HEAD,
      last_reviewed_head: PREVIOUS_REVIEW_HEAD,
      open_blockers: FINDING_IDS,
    }
    const comments: Array<Record<string, unknown>> = []
    let postAttempts = 0
    const coordinator = new Coordinator({
      readState: async () => structuredClone(state),
      writeState: async (next: Record<string, unknown>) => {
        state = structuredClone(next)
        return structuredClone(state)
      },
      listComments: async () => structuredClone(comments),
      postComment: async (commentBody: string) => {
        postAttempts += 1
        comments.push({ id: 'recovery-1', body: commentBody, author: 'boat1994', author_association: 'OWNER' })
        throw new Error('ambiguous network response after comment POST')
      },
      trustedAuthors: ['boat1994'],
      requireTrustedAuthor: true,
      trustedAssociations: ['OWNER'],
    })
    const result = await coordinator.integrateReviewVerdict({
      verdictBody: body,
      verifyPreconditions: async (): Promise<void> => undefined,
      projectState: (prior: Record<string, unknown>, comment: Record<string, unknown>, identity: unknown) => ({
        ...prior,
        state: 'ELIGIBLE_FOR_FOUNDER_REVIEW',
        review_cycle: 2,
        full_review_count: 1,
        last_reviewed_head: INCIDENT_HEAD,
        open_blockers: [] as string[],
        latest_review_verdict_comment_id: comment.id,
        latest_transition_identity: JSON.stringify(identity),
      }),
      updatedAt: '2026-08-05T13:00:00+07:00',
      updatedBy: 'Mission Control Recovery Transport',
    })

    expect(result).toMatchObject({ outcome: 'REVIEWED', recovered: true, comment: { id: 'recovery-1' } })
    expect(postAttempts).toBe(1)
    expect(comments).toHaveLength(1)
  })
})
