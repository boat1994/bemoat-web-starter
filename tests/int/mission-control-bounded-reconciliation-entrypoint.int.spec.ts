import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

import { parseMissionControlState, renderMissionControlState } from '../../scripts/mission-control/domain/task-state.mjs'

const reconcileScript = resolve(process.cwd(), 'scripts/mission-control-reconcile.mjs')
const repo = 'boat1994/bemoat-web-starter'
const issueNumber = '169'
const prNumber = '170'
const reviewedHead = 'abc1234deadbeef0000000000000000000000000'
const staleHead = 'oldhead0000000000000000000000000000000000'
const tempRoots: string[] = []

const sampleResultBody = `## RESULT

### Task log
- Timestamp: 2026-07-17T10:00:00+07:00
- Task / Issue: #169
- Phase: Dev (implementation)
- Executing role: Dev / Builder

**Completed:** Dev (implementation)
**State:** branch \`feature/169\` · base \`main\` · head \`${reviewedHead}\`
**PR:** https://github.com/boat1994/bemoat-web-starter/pull/170
**Managed state:** AWAITING_REVIEW_1 · PR #170 · \`${reviewedHead}\`
**Summary:** Phase 1 dogfood bounded implementation
**Next:** Reviewer ## REVIEW_VERDICT
`

function issueBody(state: Record<string, unknown>) {
  return `Mission Control mode: required\n\n${renderMissionControlState(state)}`
}

function baseManagedState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    state: 'IN_PROGRESS',
    review_cycle: 0,
    full_review_count: 0,
    approved_base: 'main',
    active_task_issue: '#169',
    active_pr: null,
    current_head: null,
    last_reviewed_head: null,
    guide_version: '1.3.0',
    guide_source_ref: 'main',
    guide_source_sha: '18640666402ade75003cbf0a3556eef6ad63d536',
    open_blockers: [],
    follow_up_issues: [],
    next_permitted_action: 'Reviewer posts REVIEW_VERDICT after delivery evidence is complete.',
    material_change_status: 'none',
    updated_at: '2026-07-17T09:00:00Z',
    updated_by: 'Dev / Builder',
    ...overrides,
  }
}

function writeExecutable(path: string, body: string) {
  writeFileSync(path, body)
  chmodSync(path, 0o755)
}

function createGhHarness({
  state = baseManagedState(),
  comments = [{
    id: '5070000001',
    body: sampleResultBody,
    user: { login: 'boat1994' },
    author_association: 'OWNER',
    createdAt: '2026-07-17T10:00:00Z',
  }],
  prHead = reviewedHead,
}: {
  state?: Record<string, unknown>
  comments?: Array<Record<string, unknown>>
  prHead?: string
} = {}) {
  const root = mkdtempSync('/tmp/bemoat-bounded-reconcile-')
  tempRoots.push(root)
  writeFileSync(join(root, 'issue.md'), issueBody(state))
  writeFileSync(join(root, 'comments.json'), JSON.stringify({ comments }))
  writeFileSync(join(root, 'pr.json'), JSON.stringify({
    number: Number(prNumber),
    headRefOid: prHead,
    baseRefName: 'main',
    state: 'OPEN',
    statusCheckRollup: [{ conclusion: 'SUCCESS', name: 'CI', targetUrl: `https://example.com/${prHead}` }],
  }))
  writeFileSync(join(root, 'lease.json'), JSON.stringify({ sha: 'lease-0', content: { status: 'released' } }))
  writeFileSync(join(root, 'metrics.json'), JSON.stringify({ issueEdits: 0, leaseWrites: 0, holders: [] as string[] }))

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
const jsonFields = args[args.indexOf('--json') + 1] ?? ''
const wantsBody = jsonFields.split(',').includes('body')
const wantsState = jsonFields.split(',').includes('state')
const wantsComments = jsonFields.split(',').includes('comments')

if (args[0] === 'repo' && args[1] === 'view') {
  process.stdout.write(JSON.stringify({ nameWithOwner: ${JSON.stringify(repo)} }))
  process.exit(0)
}

if (args[0] === 'issue' && args[1] === 'view') {
  const body = readFileSync(issuePath, 'utf8')
  if (wantsComments) {
    process.stdout.write(JSON.stringify(readJson(commentsPath)))
    process.exit(0)
  }
  if (wantsBody && wantsState) process.stdout.write(JSON.stringify({ body, state: 'OPEN' }))
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
    process.stdout.write(JSON.stringify(readJson(commentsPath).comments))
    process.exit(0)
  }
  if (target.includes('/git/ref/heads/bemoat/mission-control-leases')) {
    process.stdout.write(JSON.stringify({ ref: 'refs/heads/bemoat/mission-control-leases', object: { sha: 'lease-branch' } }))
    process.exit(0)
  }
  if (target.includes('/contents/.bemoat/mission-control/leases/')) {
    const isPut = args.includes('-X') && args[args.indexOf('-X') + 1] === 'PUT'
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
    const decoded = JSON.parse(Buffer.from(payload.content, 'base64').toString('utf8'))
    if (decoded.holder) metrics.holders.push(decoded.holder)
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
      GH_REPO: repo,
      PAYLOAD_SECRET: 'local-test-secret-169',
    },
  }
}

function runReconcile(harness: ReturnType<typeof createGhHarness>, extraArgs: string[] = []) {
  return spawnSync(process.execPath, [reconcileScript, issueNumber, '--repo', repo, ...extraArgs], {
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

describe('production bounded reconciliation entrypoint (#328 boundary)', () => {
  it('returns help on --help without requiring an issue number', () => {
    const result = spawnSync(process.execPath, [reconcileScript, '--help'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })
    expect(result.status, result.stderr || result.stdout).toBe(0)
    expect(result.stdout).toContain('bemoat:mission-control:reconcile')
    expect(result.stdout).toContain('Repair routing-only Mission Control projection drift.')
  })

  it('fails closed on bounded STATE_CONFLICT with stderr ERROR and zero durable writes', () => {
    const harness = createGhHarness({
      state: baseManagedState({
        active_pr: '#170',
        current_head: staleHead,
      }),
      prHead: reviewedHead,
    })
    const result = runReconcile(harness)

    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/^ERROR: /)
    expect(result.stderr).toMatch(/authoritative live evidence contradicts/)
    expect(readMetrics(harness).issueEdits).toBe(0)
    expect(readMetrics(harness).leaseWrites).toBe(0)
    expect(readHarnessState(harness)).toMatchObject({
      state: 'IN_PROGRESS',
      current_head: staleHead,
    })
  })

  it('repairs delivery bookkeeping lag through the production gh/CAS composition layer', () => {
    const harness = createGhHarness()
    const result = runReconcile(harness)

    expect(result.status, result.stderr || result.stdout).toBe(0)
    expect(result.stdout).toMatch(
      /^Mission Control reconciliation NO_OP: 2 attempt\(s\), 1 durable write\(s\)\n$/,
    )
    expect(readMetrics(harness).issueEdits).toBeGreaterThanOrEqual(1)
    expect(readMetrics(harness).holders).toContain('mission-control-reconcile')
    expect(readHarnessState(harness)).toMatchObject({
      state: 'AWAITING_REVIEW_1',
      active_pr: '#170',
      current_head: reviewedHead,
      review_cycle: 0,
      full_review_count: 0,
    })
  })

  it('returns identical bounded NO_OP without a second durable write', () => {
    const harness = createGhHarness()
    const first = runReconcile(harness)
    expect(first.status, first.stderr || first.stdout).toBe(0)
    const editsAfterFirst = readMetrics(harness).issueEdits
    const second = runReconcile(harness)
    expect(second.status, second.stderr || second.stdout).toBe(0)
    expect(second.stdout).toMatch(/Mission Control reconciliation NO_OP:/)
    expect(readMetrics(harness).issueEdits).toBe(editsAfterFirst)
  })
})
