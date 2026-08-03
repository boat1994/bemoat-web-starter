import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

import { parseMissionControlState, renderMissionControlState } from '../../scripts/mission-control-state.mjs'
import { Coordinator, normalizeTransitionIdentity, serializeTransitionIdentity } from '../../scripts/mission-control-reconcile.mjs'

const reconcileScript = resolve(process.cwd(), 'scripts/mission-control-reconcile.mjs')
const repo = 'boat1994/bemoat-web-starter'
const issueNumber = '259'
const prNumber = '260'
const reviewedHead = 'b1ce5f58e7ffd0178d955ef7e93395209a7c4d28'
const staleHead = '18640666402ade75003cbf0a3556eef6ad63d536'
const verdictCommentId = '5163387315'
const resultCommentId = '5163299772'
const tempRoots: string[] = []

const verdictBody = (head = reviewedHead, suffix = '') => `## REVIEW_VERDICT

### Task log
- Timestamp: 2026-08-03T14:00:00+07:00
- Task / Issue: #259
- Phase: Reviewer
- Executing role: Reviewer / Red Team

**Task:** Issue #259
**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/260 · \`main\` · \`${head}\`
**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**Managed state:** ELIGIBLE_FOR_FOUNDER_REVIEW · cycle 1 · last_reviewed_head \`${head}\`
**Findings:** Critical: None · Important: None
**Next:** Founder reviews PR #260${suffix}
`

function resultIdentity() {
  return JSON.stringify({
    taskId: issueNumber,
    phase: 'Implementation delivery',
    role: 'RESULT',
    contentHash: '9a8d501ad8492dec3664b1a948925d89ff971ee8b8cfd76dda9826c245a0c40a',
  })
}

function verdictIdentity() {
  return serializeTransitionIdentity(normalizeTransitionIdentity(verdictBody(), { role: 'REVIEW_VERDICT' }))
}

function initialState(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    state: 'ELIGIBLE_FOR_FOUNDER_REVIEW',
    review_cycle: 1,
    full_review_count: 1,
    approved_base: 'main',
    active_task_issue: '#259',
    active_pr: '#260',
    current_head: reviewedHead,
    last_reviewed_head: reviewedHead,
    workflow_mode: 'implementation_pr',
    planning_authorization_base_sha: '18640666402ade75003cbf0a3556eef6ad63d536',
    founder_decision: {
      status: 'approved',
      authority: 'Founder',
      scope: 'bounded_non_slice_campaign_blocker_completion_correction',
      action: 'implement',
      authorized_at: '2026-08-03T13:12:00+07:00',
      source: 'current Founder instruction',
      repository: repo,
      base: 'main',
      approved_base_sha: '18640666402ade75003cbf0a3556eef6ad63d536',
    },
    latest_transition_identity: resultIdentity(),
    guide_version: '1.3.0',
    guide_source_ref: 'main',
    guide_source_sha: '18640666402ade75003cbf0a3556eef6ad63d536',
    open_blockers: [] as string[],
    follow_up_issues: [257],
    next_permitted_action: 'Founder reviews and approves the bounded correction PR #260 for merge.',
    material_change_status: 'none',
    updated_at: '2026-08-03T07:13:37.625Z',
    updated_by: 'Reviewer / Red Team',
    latest_result_comment_id: resultCommentId,
    ...overrides,
  }
}

function issueBody(state: Record<string, unknown>) {
  return `Mission Control mode: required\n\n${renderMissionControlState(state)}`
}

function writeExecutable(path: string, body: string) {
  writeFileSync(path, body)
  chmodSync(path, 0o755)
}

function createGhHarness({
  state = initialState(),
  comments = [{ id: verdictCommentId, body: verdictBody(), user: { login: 'boat1994' }, author_association: 'OWNER' }],
  prHead = reviewedHead,
}: {
  state?: Record<string, unknown>
  comments?: Array<Record<string, unknown>>
  prHead?: string
} = {}) {
  const root = mkdtempSync('/tmp/bemoat-review-verdict-reconcile-')
  tempRoots.push(root)
  writeFileSync(join(root, 'issue.md'), issueBody(state))
  writeFileSync(join(root, 'comments.json'), JSON.stringify(comments))
  writeFileSync(join(root, 'pr.json'), JSON.stringify({ number: Number(prNumber), headRefOid: prHead, baseRefName: 'main', state: 'OPEN' }))
  writeFileSync(join(root, 'lease.json'), JSON.stringify({ sha: 'lease-0', content: { status: 'released' } }))
  writeFileSync(join(root, 'metrics.json'), JSON.stringify({ issueEdits: 0, leaseWrites: 0 }))

  const gh = join(root, 'gh')
  writeExecutable(gh, `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = ${JSON.stringify(root)}
const args = process.argv.slice(2)
const issuePath = join(root, 'issue.md')
const commentsPath = join(root, 'comments.json')
const prPath = join(root, 'pr.json')
const leasePath = join(root, 'lease.json')
const metricsPath = join(root, 'metrics.json')
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value))
const fail = (message) => { process.stderr.write(message + '\\n'); process.exit(1) }
const has = (value) => args.includes(value)
const jsonFields = args[args.indexOf('--json') + 1] ?? ''
const wantsBody = jsonFields.split(',').includes('body')
const wantsState = jsonFields.split(',').includes('state')

if (args[0] === 'issue' && args[1] === 'view') {
  const body = readFileSync(issuePath, 'utf8')
  const state = body.includes('state:') ? 'OPEN' : 'OPEN'
  if (wantsBody && wantsState) process.stdout.write(JSON.stringify({ body, state }))
  else if (wantsBody) process.stdout.write(JSON.stringify({ body }))
  else fail('unsupported issue view fields')
  process.exit(0)
}

if (args[0] === 'issue' && args[1] === 'edit') {
  const bodyFileIndex = args.indexOf('--body-file')
  if (bodyFileIndex < 0) fail('missing body file')
  const metrics = readJson(metricsPath)
  metrics.issueEdits += 1
  writeJson(metricsPath, metrics)
  writeFileSync(issuePath, readFileSync(args[bodyFileIndex + 1], 'utf8'))
  process.exit(0)
}

if (args[0] === 'pr' && args[1] === 'view') {
  process.stdout.write(JSON.stringify(readJson(prPath)))
  process.exit(0)
}

if (args[0] === 'api') {
  const target = args.find((value) => value.includes('repos/${repo}/')) ?? ''
  if (target.includes('/issues/${issueNumber}/comments')) {
    process.stdout.write(JSON.stringify(readJson(commentsPath)))
    process.exit(0)
  }
  if (target.includes('/git/ref/heads/bemoat/mission-control-leases')) {
    process.stdout.write(JSON.stringify({ ref: 'refs/heads/bemoat/mission-control-leases', object: { sha: 'lease-branch' } }))
    process.exit(0)
  }
  if (target.includes('/contents/.bemoat/mission-control/leases/')) {
    const isPut = has('-X') && args[args.indexOf('-X') + 1] === 'PUT'
    if (!isPut) {
      const lease = readJson(leasePath)
      process.stdout.write(JSON.stringify({ sha: lease.sha, content: Buffer.from(JSON.stringify(lease.content)).toString('base64') }))
      process.exit(0)
    }
    let input = ''
    process.stdin.setEncoding('utf8')
    for await (const chunk of process.stdin) input += chunk
    const payload = JSON.parse(input)
    const lease = readJson(leasePath)
    if (payload.sha && payload.sha !== lease.sha) fail('409 Conflict')
    const metrics = readJson(metricsPath)
    metrics.leaseWrites += 1
    writeJson(metricsPath, metrics)
    const next = { sha: 'lease-' + metrics.leaseWrites, content: JSON.parse(Buffer.from(payload.content, 'base64').toString('utf8')) }
    writeJson(leasePath, next)
    process.stdout.write(JSON.stringify({ content: { sha: next.sha } }))
    process.exit(0)
  }
  fail('unsupported gh api target: ' + target)
}

fail('unsupported gh command: ' + args.join(' '))
`)

  return {
    root,
    env: {
      ...process.env,
      PATH: `${root}:${process.env.PATH ?? ''}`,
      BEMOAT_MC_TRUSTED_AUTHORS: 'boat1994',
      GITHUB_REPOSITORY_OWNER: 'boat1994',
      PAYLOAD_SECRET: 'local-test-secret-262',
    },
  }
}

function runReconcile(harness: ReturnType<typeof createGhHarness>) {
  return spawnSync(process.execPath, [reconcileScript, issueNumber, '--repo', repo], {
    cwd: process.cwd(),
    env: harness.env,
    encoding: 'utf8',
  })
}

function readHarnessState(harness: ReturnType<typeof createGhHarness>) {
  const parsed = parseMissionControlState(readFileSync(join(harness.root, 'issue.md'), 'utf8'))
  if (!parsed.valid || parsed.state == null) {
    throw new Error(`invalid harness state: ${parsed.reason ?? 'missing state'}`)
  }
  return parsed.state as NonNullable<typeof parsed.state>
}

function readMetrics(harness: ReturnType<typeof createGhHarness>) {
  return JSON.parse(readFileSync(join(harness.root, 'metrics.json'), 'utf8'))
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('production Review-verdict lineage reconciliation', () => {
  it('reconciles the exact Issue #259 verdict projection without changing semantic state', () => {
    const harness = createGhHarness({ state: initialState({ latest_transition_identity: resultIdentity() }) })
    const result = runReconcile(harness)

    expect(result.status, result.stderr || result.stdout).toBe(0)
    expect(result.stdout).toContain('RECONCILED')
    const parsed = readHarnessState(harness)
    expect(parsed).toMatchObject({
      state: 'ELIGIBLE_FOR_FOUNDER_REVIEW',
      review_cycle: 1,
      full_review_count: 1,
      current_head: reviewedHead,
      last_reviewed_head: reviewedHead,
      latest_result_comment_id: resultCommentId,
      latest_review_verdict_comment_id: verdictCommentId,
      approved_base: 'main',
      active_task_issue: '#259',
      active_pr: '#260',
      workflow_mode: 'implementation_pr',
      planning_authorization_base_sha: '18640666402ade75003cbf0a3556eef6ad63d536',
      founder_decision: initialState().founder_decision,
      guide_version: '1.3.0',
      guide_source_ref: 'main',
      guide_source_sha: '18640666402ade75003cbf0a3556eef6ad63d536',
    })
    expect(JSON.parse(String(parsed.latest_transition_identity))).toMatchObject({
      taskId: issueNumber,
      phase: 'Reviewer',
      role: 'REVIEW_VERDICT',
      contentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
  })

  it('returns true NO_OP on duplicate retry only after lineage is canonical', () => {
    const harness = createGhHarness()
    const first = runReconcile(harness)
    expect(first.status, first.stderr || first.stdout).toBe(0)
    expect(first.stdout).toContain('RECONCILED')
    expect(readHarnessState(harness).latest_transition_identity).toBe(verdictIdentity())
    const issueEditsAfterFirst = readMetrics(harness).issueEdits
    const second = runReconcile(harness)
    expect(second.status, second.stderr || second.stdout).toBe(0)
    expect(second.stdout).toContain('NO_OP')
    expect(readMetrics(harness).issueEdits).toBe(issueEditsAfterFirst)
  })

  it.each([
    ['stale verdict', { body: verdictBody(staleHead) }, /STATE_CONFLICT/],
    ['superseded verdict', { body: verdictBody(reviewedHead, '\\n\\n[superseded] not authoritative') }, /BLOCKED_EXTERNAL/],
    ['mismatched-head verdict', { body: verdictBody(staleHead, '\\n\\n**Review note:** mismatched head') }, /STATE_CONFLICT/],
  ])('rejects %s without writing managed state', (_label, comment, expected) => {
    const harness = createGhHarness({ comments: [{ id: verdictCommentId, user: { login: 'boat1994' }, author_association: 'OWNER', ...comment }] })
    const result = runReconcile(harness)
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(expected)
    expect(readMetrics(harness).issueEdits).toBe(0)
    expect(readHarnessState(harness).latest_review_verdict_comment_id).toBeUndefined()
  })

  it('fails closed when duplicate active verdict evidence competes for the exact head', () => {
    const body = verdictBody()
    const harness = createGhHarness({
      comments: [
        { id: '5163387315', body, user: { login: 'boat1994' }, author_association: 'OWNER' },
        { id: '5163387316', body, user: { login: 'boat1994' }, author_association: 'OWNER' },
      ],
    })
    const result = runReconcile(harness)
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/STATE_CONFLICT.*competing/i)
    expect(readMetrics(harness).issueEdits).toBe(0)
  })
})

describe('Review-verdict identity normalization', () => {
  it('derives task identity from the exact live Task: Issue form', () => {
    const identity = normalizeTransitionIdentity(verdictBody(), { role: 'REVIEW_VERDICT' })
    expect(identity.taskId).toBe(issueNumber)
    expect(serializeTransitionIdentity(identity)).toContain('"taskId":"259"')
  })

  it('rejects semantic state mutation through a routing-only coordinator repair', async () => {
    let state: Record<string, unknown> = initialState()
    const coordinator = new Coordinator({
      readState: async () => structuredClone(state),
      writeState: async (next) => {
        state = structuredClone(next)
        return structuredClone(state)
      },
      listComments: async () => [{
        id: verdictCommentId,
        body: verdictBody(),
        author: 'boat1994',
        author_association: 'OWNER',
      }],
      postComment: async () => { throw new Error('must not post a verdict') },
      trustedAuthors: ['boat1994'],
      requireTrustedAuthor: true,
      trustedAssociations: ['OWNER'],
    })

    await expect(coordinator.reconcileReviewVerdict({
      verdictBody: verdictBody(),
      routingOnly: true,
      projectReview: (prior: Record<string, unknown>) => ({ ...prior, state: 'CORRECTION_REQUIRED_1' }),
    })).rejects.toThrow(/routing-only.*state/i)
    expect(state.state).toBe('ELIGIBLE_FOR_FOUNDER_REVIEW')
  })
})
