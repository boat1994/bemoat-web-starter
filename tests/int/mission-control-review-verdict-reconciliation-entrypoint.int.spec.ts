import { createHash } from 'node:crypto'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

import { parseMissionControlState, renderMissionControlState } from '../../scripts/mission-control-state.mjs'
import {
  Coordinator,
  normalizeTransitionIdentity,
  parseLegacyReviewVerdictBinding,
  serializeTransitionIdentity,
} from '../../scripts/mission-control-reconcile.mjs'

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
  prState = 'OPEN',
  prBase = 'main',
  prNumberOverride = Number(prNumber),
  containedHeads = [reviewedHead],
}: {
  state?: Record<string, unknown>
  comments?: Array<Record<string, unknown>>
  prHead?: string
  prState?: 'OPEN' | 'MERGED' | 'CLOSED'
  prBase?: string
  prNumberOverride?: number
  containedHeads?: string[]
} = {}) {
  const root = mkdtempSync('/tmp/bemoat-review-verdict-reconcile-')
  tempRoots.push(root)
  writeFileSync(join(root, 'issue.md'), issueBody(state))
  writeFileSync(join(root, 'comments.json'), JSON.stringify(comments))
  writeFileSync(join(root, 'pr.json'), JSON.stringify({
    number: prNumberOverride,
    headRefOid: prHead,
    baseRefName: prBase,
    state: prState,
  }))
  writeFileSync(join(root, 'contained.json'), JSON.stringify(containedHeads))
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
const containedPath = join(root, 'contained.json')
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
  const compareMatch = target.match(/\\/compare\\/([0-9a-f]{7,40})\\.\\.\\.([^/?]+)/)
  if (compareMatch) {
    const commit = compareMatch[1]
    const base = compareMatch[2]
    const contained = readJson(containedPath)
    const onBase = Array.isArray(contained) && contained.includes(commit)
    process.stdout.write(JSON.stringify({
      status: onBase ? (base === 'main' ? 'ahead' : 'behind') : 'diverged',
      ahead_by: onBase ? 3 : 0,
      behind_by: onBase ? 0 : 3,
      total_commits: onBase ? 3 : 0,
    }))
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
      writeState: async (next: Record<string, unknown>) => {
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

describe('merged managed active PR Review-verdict lineage reconciliation', () => {
  it('reconciles routing lineage when the managed active PR is merged and contained in protected main', () => {
    const harness = createGhHarness({
      prState: 'MERGED',
      containedHeads: [reviewedHead],
      state: initialState({ latest_transition_identity: resultIdentity() }),
    })
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
      founder_decision: initialState().founder_decision,
      guide_version: '1.3.0',
      guide_source_sha: '18640666402ade75003cbf0a3556eef6ad63d536',
    })
    expect(JSON.parse(String(parsed.latest_transition_identity))).toMatchObject({
      taskId: issueNumber,
      role: 'REVIEW_VERDICT',
    })
  })

  it('returns true NO_OP on identical merged-PR retry after lineage is canonical', () => {
    const harness = createGhHarness({ prState: 'MERGED', containedHeads: [reviewedHead] })
    const first = runReconcile(harness)
    expect(first.status, first.stderr || first.stdout).toBe(0)
    expect(first.stdout).toContain('RECONCILED')
    const edits = readMetrics(harness).issueEdits
    const second = runReconcile(harness)
    expect(second.status, second.stderr || second.stdout).toBe(0)
    expect(second.stdout).toContain('NO_OP')
    expect(readMetrics(harness).issueEdits).toBe(edits)
  })

  it('preserves existing OPEN-PR reconciliation when the PR remains open', () => {
    const harness = createGhHarness({ prState: 'OPEN' })
    const result = runReconcile(harness)
    expect(result.status, result.stderr || result.stdout).toBe(0)
    expect(result.stdout).toContain('RECONCILED')
    expect(readHarnessState(harness).latest_review_verdict_comment_id).toBe(verdictCommentId)
  })

  it('treats a historical transport REVIEW_VERDICT for a different PR as non-competing for managed lineage', () => {
    const transportHead = '34918d4cb75369778ade13fcc0cc3abcd6cb5f8b'
    const historicalTransportVerdict = `## REVIEW_VERDICT

### Task log
- Timestamp: 2026-08-04T09:54:00+07:00
- Task / Issue: #259
- Phase: Full Review 1
- Executing role: Reviewer (Independent)

**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/267 · \`main\` · \`${transportHead}\`
**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**Managed state:** ELIGIBLE_FOR_FOUNDER_REVIEW · cycle 1 · full_review_count 1 · last_reviewed_head \`${transportHead}\`
**Findings:** Critical: None · Important: None
**Next:** Founder reviews PR #267
`
    const harness = createGhHarness({
      prState: 'MERGED',
      containedHeads: [reviewedHead],
      comments: [
        {
          id: verdictCommentId,
          body: verdictBody(),
          user: { login: 'boat1994' },
          author_association: 'OWNER',
        },
        {
          id: '5174083215',
          body: historicalTransportVerdict,
          user: { login: 'boat1994' },
          author_association: 'OWNER',
        },
      ],
    })
    const result = runReconcile(harness)
    expect(result.status, result.stderr || result.stdout).toBe(0)
    expect(result.stdout).toContain('RECONCILED')
    expect(readHarnessState(harness).latest_review_verdict_comment_id).toBe(verdictCommentId)
    expect(readMetrics(harness).issueEdits).toBe(1)
  })

  it.each([
    ['closed but unmerged PR', { prState: 'CLOSED' as const }, /STATE_CONFLICT/],
    ['merged PR head differing from managed reviewed head', {
      prState: 'MERGED' as const,
      prHead: staleHead,
      state: initialState({ current_head: reviewedHead, last_reviewed_head: reviewedHead }),
    }, /STATE_CONFLICT.*exact head/i],
    ['merged head not contained in protected main', {
      prState: 'MERGED' as const,
      containedHeads: [] as string[],
    }, /STATE_CONFLICT.*protected main/i],
    ['protected main advancing without containing the reviewed head', {
      prState: 'MERGED' as const,
      containedHeads: [staleHead],
    }, /STATE_CONFLICT.*protected main/i],
    ['verdict binding a different PR', {
      prState: 'MERGED' as const,
      comments: [{
        id: verdictCommentId,
        body: verdictBody().replace('pull/260', 'pull/999').replace('Issue #259', 'Issue #259'),
        user: { login: 'boat1994' },
        author_association: 'OWNER',
      }],
    }, /BLOCKED_EXTERNAL: no active REVIEW_VERDICT evidence for the managed Issue/],
    ['verdict binding a different head', {
      prState: 'MERGED' as const,
      comments: [{
        id: verdictCommentId,
        body: verdictBody(staleHead),
        user: { login: 'boat1994' },
        author_association: 'OWNER',
      }],
    }, /STATE_CONFLICT/],
    ['verdict binding a different base', {
      prState: 'MERGED' as const,
      comments: [{
        id: verdictCommentId,
        body: verdictBody().replace('`main`', '`dev`'),
        user: { login: 'boat1994' },
        author_association: 'OWNER',
      }],
    }, /STATE_CONFLICT.*base/i],
    ['multiple competing active verdicts', {
      prState: 'MERGED' as const,
      comments: [
        { id: '5163387315', body: verdictBody(), user: { login: 'boat1994' }, author_association: 'OWNER' },
        { id: '5163387316', body: verdictBody(), user: { login: 'boat1994' }, author_association: 'OWNER' },
      ],
    }, /STATE_CONFLICT.*competing/i],
  ])('rejects %s without writing managed state', (_label, overrides, expected) => {
    const harness = createGhHarness(overrides)
    const result = runReconcile(harness)
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(expected)
    expect(readMetrics(harness).issueEdits).toBe(0)
    expect(readHarnessState(harness).latest_review_verdict_comment_id).toBeUndefined()
  })

  it('rejects when semantic counters would need mutation and writes nothing', async () => {
    let state: Record<string, unknown> = initialState({ review_cycle: 1, full_review_count: 1 })
    const coordinator = new Coordinator({
      readState: async () => structuredClone(state),
      writeState: async (next: Record<string, unknown>) => {
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
      projectReview: (prior: Record<string, unknown>) => ({
        ...prior,
        review_cycle: 2,
        full_review_count: 2,
      }),
    })).rejects.toThrow(/routing-only.*review_cycle|routing-only.*full_review_count/i)
    expect(state.review_cycle).toBe(1)
    expect(state.full_review_count).toBe(1)
  })

  it('treats already-correct merged routing lineage as NO_OP without a durable write', () => {
    const harness = createGhHarness({
      prState: 'MERGED',
      containedHeads: [reviewedHead],
      state: initialState({
        latest_review_verdict_comment_id: verdictCommentId,
        latest_transition_identity: verdictIdentity(),
      }),
    })
    const result = runReconcile(harness)
    expect(result.status, result.stderr || result.stdout).toBe(0)
    expect(result.stdout).toContain('NO_OP')
    expect(readMetrics(harness).issueEdits).toBe(0)
  })
})

/**
 * Synthetic legacy bodies for negative / boundary probes only.
 * The positive process-level path must use the byte-faithful live fixture below.
 */
const legacyVerdictBody = (
  overrides: {
    task?: string
    pr?: string
    base?: string
    head?: string
    omit?: Array<'task' | 'pr' | 'base' | 'head'>
    extra?: string
  } = {},
) => {
  const omit = new Set(overrides.omit ?? [])
  const lines = [
    '## REVIEW_VERDICT',
    '',
    '**Verdict:** ELIGIBLE FOR FOUNDER REVIEW',
  ]
  if (!omit.has('task')) {
    lines.push(`**Task:** ${overrides.task ?? 'Issue #259'}`)
  }
  if (!omit.has('pr')) {
    lines.push(`**PR:** ${overrides.pr ?? '#260'}`)
  }
  if (!omit.has('base')) {
    lines.push(
      overrides.base
        ?? '**Base:** `main` (`18640666402ade75003cbf0a3556eef6ad63d536`)',
    )
  }
  if (!omit.has('head')) {
    lines.push(`**Head:** \`${overrides.head ?? reviewedHead}\``)
  }
  lines.push(
    '**Review cycle:** 1',
    '',
    '### Findings',
    '- **Critical/Important:** None.',
    overrides.extra ?? '',
    '',
    '### Next Action',
    'Founder reviews and approves the bounded correction PR #260 for merge.',
  )
  return lines.filter((line, index, all) => !(line === '' && all[index - 1] === '')).join('\n')
}

const liveLegacyVerdictFixturePath = resolve(
  process.cwd(),
  'tests/fixtures/starter-only/mission-control/review-verdict-comment-5163387315.body.md',
)
const liveLegacyVerdictFixtureDigest =
  '97d58461c476f3e0244613ddae02c7370a114973ef8a22bea5808c7eac639f6d'

function readLiveLegacyVerdictFixture() {
  const body = readFileSync(liveLegacyVerdictFixturePath)
  const digest = createHash('sha256').update(body).digest('hex')
  expect(digest).toBe(liveLegacyVerdictFixtureDigest)
  return body.toString('utf8')
}

const historicalTransportVerdict267 = `## REVIEW_VERDICT

### Task log
- Timestamp: 2026-08-04T09:54:00+07:00
- Task / Issue: #259
- Phase: Full Review 1
- Executing role: Reviewer (Independent)

**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/267 · \`main\` · \`34918d4cb75369778ade13fcc0cc3abcd6cb5f8b\`
**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**Findings:** Critical: None · Important: None
**Next:** Founder reviews PR #267
`

const partialLegacyDifferentPrCompetitor = `## REVIEW_VERDICT

**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**Task:** Issue #259
**PR:** #267
`

const wrongFirstDuplicatedPrCompetitor = `## REVIEW_VERDICT

**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**Task:** Issue #259
**PR:** #267
**PR:** #260
**Base:** \`main\` (\`18640666402ade75003cbf0a3556eef6ad63d536\`)
**Head:** \`${reviewedHead}\`
`

const conflictingDuplicatedFieldsCompetitor = `## REVIEW_VERDICT

**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**Task:** Issue #259
**PR:** #260
**Base:** \`main\` (\`18640666402ade75003cbf0a3556eef6ad63d536\`)
**Base:** \`dev\` (\`18640666402ade75003cbf0a3556eef6ad63d536\`)
**Head:** \`${reviewedHead}\`
`

/** Conflicting Task fields: wrong Issue first, then current Issue. */
const wrongFirstConflictingTaskCompetitor = `## REVIEW_VERDICT

**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**Task:** Issue #999
**Task:** Issue #259
**PR:** #267
**Base:** \`main\` (\`18640666402ade75003cbf0a3556eef6ad63d536\`)
**Head:** \`${reviewedHead}\`
`

/** Conflicting Task fields: current Issue first, then wrong Issue. */
const currentFirstConflictingTaskCompetitor = `## REVIEW_VERDICT

**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**Task:** Issue #259
**Task:** Issue #999
**PR:** #267
**Base:** \`main\` (\`18640666402ade75003cbf0a3556eef6ad63d536\`)
**Head:** \`${reviewedHead}\`
`

/** Duplicated same-value Task fields must not silently use the first value. */
const duplicatedSameTaskCompetitor = `## REVIEW_VERDICT

**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**Task:** Issue #259
**Task:** Issue #259
**PR:** #267
**Base:** \`main\` (\`18640666402ade75003cbf0a3556eef6ad63d536\`)
**Head:** \`${reviewedHead}\`
`

/** Single unique Task binding to a different Issue — correctly out of scope. */
const uniqueDifferentIssueLegacyVerdict = `## REVIEW_VERDICT

**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**Task:** Issue #999
**PR:** #267
**Base:** \`main\` (\`18640666402ade75003cbf0a3556eef6ad63d536\`)
**Head:** \`${reviewedHead}\`
`

describe('legacy REVIEW_VERDICT binding (option 2)', () => {
  it('accepts the byte-faithful live comment 5163387315 binding for managed PR #260', () => {
    const liveBody = readLiveLegacyVerdictFixture()
    expect(liveBody).toContain('**Minor/Nit:** None.')
    expect(liveBody).toContain('Authority-backed contiguous empty rows append through Slice 11 is correctly bounded.')
    expect(liveBody).toContain('The recovery coverage for #254/#258 without double-merge was successfully added and passes tests.')
    expect(liveBody).toContain('Production parity checks pass cleanly against the specified constraints.')

    const harness = createGhHarness({
      prState: 'MERGED',
      containedHeads: [reviewedHead],
      comments: [
        {
          id: verdictCommentId,
          body: liveBody,
          user: { login: 'boat1994' },
          author_association: 'OWNER',
        },
        {
          id: '5174083215',
          body: historicalTransportVerdict267,
          user: { login: 'boat1994' },
          author_association: 'OWNER',
        },
      ],
    })
    const result = runReconcile(harness)
    expect(result.status, result.stderr || result.stdout).toBe(0)
    expect(result.stdout).toContain('RECONCILED')
    const parsed = readHarnessState(harness)
    expect(parsed).toMatchObject({
      state: 'ELIGIBLE_FOR_FOUNDER_REVIEW',
      review_cycle: 1,
      full_review_count: 1,
      active_pr: '#260',
      current_head: reviewedHead,
      last_reviewed_head: reviewedHead,
      latest_result_comment_id: resultCommentId,
      latest_review_verdict_comment_id: verdictCommentId,
    })
    expect(readMetrics(harness).issueEdits).toBe(1)

    const binding = parseLegacyReviewVerdictBinding(liveBody)
    expect(binding).toEqual({
      kind: 'legacy',
      issueNumber: '259',
      prNumber: '260',
      base: 'main',
      head: reviewedHead,
    })
  })

  it('preserves canonical new-verdict behavior unchanged', () => {
    const harness = createGhHarness({
      prState: 'MERGED',
      containedHeads: [reviewedHead],
      comments: [{
        id: verdictCommentId,
        body: verdictBody(),
        user: { login: 'boat1994' },
        author_association: 'OWNER',
      }],
    })
    const result = runReconcile(harness)
    expect(result.status, result.stderr || result.stdout).toBe(0)
    expect(result.stdout).toContain('RECONCILED')
    expect(readHarnessState(harness).latest_review_verdict_comment_id).toBe(verdictCommentId)
  })

  it.each([
    ['uppercase full SHA', reviewedHead.toUpperCase(), reviewedHead],
    ['uppercase abbreviated SHA', reviewedHead.slice(0, 7).toUpperCase(), reviewedHead.slice(0, 7)],
  ])('accepts and lowercases valid legacy Head metadata: %s', (_label, head, normalizedHead) => {
    const body = legacyVerdictBody({ head })
    expect(parseLegacyReviewVerdictBinding(body)).toMatchObject({
      kind: 'legacy',
      head: normalizedHead,
    })

    const harness = createGhHarness({
      prState: 'MERGED',
      containedHeads: [reviewedHead],
      comments: [{
        id: verdictCommentId,
        body,
        user: { login: 'boat1994' },
        author_association: 'OWNER',
      }],
    })
    const result = runReconcile(harness)

    expect(result.status, result.stderr || result.stdout).toBe(0)
    expect(result.stdout).toContain('RECONCILED')
    expect(readHarnessState(harness)).toMatchObject({
      current_head: reviewedHead,
      last_reviewed_head: reviewedHead,
    })
  })

  it.each([
    ['wrong Issue', {
      comments: [{
        id: verdictCommentId,
        body: legacyVerdictBody({ task: 'Issue #999' }),
        user: { login: 'boat1994' },
        author_association: 'OWNER',
      }],
    }, /BLOCKED_EXTERNAL|STATE_CONFLICT/],
    ['wrong PR', {
      comments: [{
        id: verdictCommentId,
        body: legacyVerdictBody({ pr: '#999' }),
        user: { login: 'boat1994' },
        author_association: 'OWNER',
      }],
    }, /BLOCKED_EXTERNAL|STATE_CONFLICT/],
    ['wrong base', {
      comments: [{
        id: verdictCommentId,
        body: legacyVerdictBody({ base: '**Base:** `dev` (`18640666402ade75003cbf0a3556eef6ad63d536`)' }),
        user: { login: 'boat1994' },
        author_association: 'OWNER',
      }],
    }, /STATE_CONFLICT.*base/i],
    ['wrong head', {
      comments: [{
        id: verdictCommentId,
        body: legacyVerdictBody({ head: staleHead }),
        user: { login: 'boat1994' },
        author_association: 'OWNER',
      }],
    }, /STATE_CONFLICT/],
    ['missing field', {
      comments: [{
        id: verdictCommentId,
        body: legacyVerdictBody({ omit: ['head'] }),
        user: { login: 'boat1994' },
        author_association: 'OWNER',
      }],
    }, /STATE_CONFLICT: legacy REVIEW_VERDICT binding is missing a required field/],
    ['incidental prose and URL rejection', {
      comments: [{
        id: verdictCommentId,
        body: `## REVIEW_VERDICT

**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
See also PR #260 and https://github.com/boat1994/bemoat-web-starter/pull/260 on main at \`${reviewedHead}\`.
`,
        user: { login: 'boat1994' },
        author_association: 'OWNER',
      }],
    }, /STATE_CONFLICT: live REVIEW_VERDICT is missing canonical PR\/base\/head evidence/],
    ['duplicate or ambiguous binding rejection', {
      comments: [{
        id: verdictCommentId,
        body: `${legacyVerdictBody()}\n**PR:** #260\n`,
        user: { login: 'boat1994' },
        author_association: 'OWNER',
      }],
    }, /STATE_CONFLICT: legacy REVIEW_VERDICT binding fields are duplicated or ambiguous/],
    ['same-PR competitor remains fail-closed', {
      comments: [
        {
          id: verdictCommentId,
          body: legacyVerdictBody(),
          user: { login: 'boat1994' },
          author_association: 'OWNER',
        },
        {
          id: '5163387316',
          body: legacyVerdictBody({ extra: '**Note:** competing same-lineage verdict' }),
          user: { login: 'boat1994' },
          author_association: 'OWNER',
        },
      ],
    }, /STATE_CONFLICT.*competing/i],
    ['partial legacy different-PR competitor', {
      comments: [
        {
          id: verdictCommentId,
          body: legacyVerdictBody(),
          user: { login: 'boat1994' },
          author_association: 'OWNER',
        },
        {
          id: '5163387401',
          body: partialLegacyDifferentPrCompetitor,
          user: { login: 'boat1994' },
          author_association: 'OWNER',
        },
      ],
    }, /STATE_CONFLICT: legacy REVIEW_VERDICT binding is missing a required field/],
    ['wrong-first duplicated PR competitor', {
      comments: [
        {
          id: verdictCommentId,
          body: legacyVerdictBody(),
          user: { login: 'boat1994' },
          author_association: 'OWNER',
        },
        {
          id: '5163387402',
          body: wrongFirstDuplicatedPrCompetitor,
          user: { login: 'boat1994' },
          author_association: 'OWNER',
        },
      ],
    }, /STATE_CONFLICT: legacy REVIEW_VERDICT binding fields are duplicated or ambiguous/],
    ['conflicting duplicated fields competitor', {
      comments: [
        {
          id: verdictCommentId,
          body: legacyVerdictBody(),
          user: { login: 'boat1994' },
          author_association: 'OWNER',
        },
        {
          id: '5163387403',
          body: conflictingDuplicatedFieldsCompetitor,
          user: { login: 'boat1994' },
          author_association: 'OWNER',
        },
      ],
    }, /STATE_CONFLICT: legacy REVIEW_VERDICT binding fields are duplicated or ambiguous/],
    ['malformed active evidence alongside valid #260 verdict', {
      comments: [
        {
          id: verdictCommentId,
          body: legacyVerdictBody(),
          user: { login: 'boat1994' },
          author_association: 'OWNER',
        },
        {
          id: '5163387404',
          body: `## REVIEW_VERDICT

**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**Task:**
Issue #259
**PR:** #267
`,
          user: { login: 'boat1994' },
          author_association: 'OWNER',
        },
      ],
    }, /STATE_CONFLICT/],
    ['wrong-first conflicting Tasks alongside valid #260', {
      comments: [
        {
          id: verdictCommentId,
          body: legacyVerdictBody(),
          user: { login: 'boat1994' },
          author_association: 'OWNER',
        },
        {
          id: '5163387405',
          body: wrongFirstConflictingTaskCompetitor,
          user: { login: 'boat1994' },
          author_association: 'OWNER',
        },
      ],
    }, /STATE_CONFLICT/],
    ['current-Issue-first conflicting Tasks alongside valid #260', {
      comments: [
        {
          id: verdictCommentId,
          body: legacyVerdictBody(),
          user: { login: 'boat1994' },
          author_association: 'OWNER',
        },
        {
          id: '5163387406',
          body: currentFirstConflictingTaskCompetitor,
          user: { login: 'boat1994' },
          author_association: 'OWNER',
        },
      ],
    }, /STATE_CONFLICT/],
    ['duplicated recognized Task fields do not silently use first value', {
      comments: [
        {
          id: verdictCommentId,
          body: legacyVerdictBody(),
          user: { login: 'boat1994' },
          author_association: 'OWNER',
        },
        {
          id: '5163387407',
          body: duplicatedSameTaskCompetitor,
          user: { login: 'boat1994' },
          author_association: 'OWNER',
        },
      ],
    }, /STATE_CONFLICT/],
  ])('rejects %s without writing managed state', (_label, overrides, expected) => {
    const harness = createGhHarness({
      prState: 'MERGED',
      containedHeads: [reviewedHead],
      ...overrides,
    })
    const result = runReconcile(harness)
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(expected)
    expect(readMetrics(harness).issueEdits).toBe(0)
    expect(readHarnessState(harness).latest_review_verdict_comment_id).toBeUndefined()
  })

  it('keeps one valid unique Task binding to a different Issue correctly out of scope', () => {
    const harness = createGhHarness({
      prState: 'MERGED',
      containedHeads: [reviewedHead],
      comments: [
        {
          id: verdictCommentId,
          body: legacyVerdictBody(),
          user: { login: 'boat1994' },
          author_association: 'OWNER',
        },
        {
          id: '5163387408',
          body: uniqueDifferentIssueLegacyVerdict,
          user: { login: 'boat1994' },
          author_association: 'OWNER',
        },
      ],
    })
    const result = runReconcile(harness)
    expect(result.status, result.stderr || result.stdout).toBe(0)
    expect(result.stdout).toContain('RECONCILED')
    expect(readHarnessState(harness).latest_review_verdict_comment_id).toBe(verdictCommentId)
    expect(readMetrics(harness).issueEdits).toBe(1)
  })

  it.each([
    ['label and value on separate lines', `## REVIEW_VERDICT

**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**Task:**
Issue #259
**PR:**
#260
**Base:**
\`main\` (\`18640666402ade75003cbf0a3556eef6ad63d536\`)
**Head:**
\`${reviewedHead}\`
`],
    ['embedded newline before Task value', `## REVIEW_VERDICT

**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**Task:**\nIssue #259
**PR:** #260
**Base:** \`main\` (\`18640666402ade75003cbf0a3556eef6ad63d536\`)
**Head:** \`${reviewedHead}\`
`],
    ['multiline Base value', `## REVIEW_VERDICT

**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**Task:** Issue #259
**PR:** #260
**Base:** \`main
branch\` (\`18640666402ade75003cbf0a3556eef6ad63d536\`)
**Head:** \`${reviewedHead}\`
`],
    ['multiline Head value', `## REVIEW_VERDICT

**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**Task:** Issue #259
**PR:** #260
**Base:** \`main\` (\`18640666402ade75003cbf0a3556eef6ad63d536\`)
**Head:** \`b1ce5f58e7ffd0178d955ef7e9339520
9a7c4d28\`
`],
    ['too-short Head SHA rejected', `## REVIEW_VERDICT

**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**Task:** Issue #259
**PR:** #260
**Base:** \`main\` (\`18640666402ade75003cbf0a3556eef6ad63d536\`)
**Head:** \`b1ce5f\`
`],
    ['lowercase task label rejected', `## REVIEW_VERDICT

**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**task:** Issue #259
**PR:** #260
**Base:** \`main\` (\`18640666402ade75003cbf0a3556eef6ad63d536\`)
**Head:** \`${reviewedHead}\`
`],
  ])('rejects multiline/case/boundary legacy form: %s', (_label, body) => {
    let binding: ReturnType<typeof parseLegacyReviewVerdictBinding> = null
    try {
      binding = parseLegacyReviewVerdictBinding(body)
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toMatch(/STATE_CONFLICT/)
      binding = null
    }
    expect(binding).toBeNull()

    const harness = createGhHarness({
      prState: 'MERGED',
      containedHeads: [reviewedHead],
      comments: [{
        id: verdictCommentId,
        body,
        user: { login: 'boat1994' },
        author_association: 'OWNER',
      }],
    })
    const result = runReconcile(harness)
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/STATE_CONFLICT/)
    expect(readMetrics(harness).issueEdits).toBe(0)
    expect(readHarnessState(harness).latest_review_verdict_comment_id).toBeUndefined()
  })
})
