import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  ALLOCATION_KINDS,
  classifyTaskBootstrapAllocation,
  matchesProvisional,
  registryForRequest,
} from '../../scripts/mission-control/domain/task-bootstrap-allocation.mjs'

const REQUEST = { requestId: 'mc-task-bootstrap-v1-' + 'a'.repeat(64) }
const CONTEXT = {
  repository: { nameWithOwner: 'boat1994/bemoat-web-starter' },
  parentIssue: { number: 262 },
  pullRequest: { number: 263, baseRefName: 'main', headRefOid: 'h'.repeat(40), baseRefOid: 'b'.repeat(40) },
  policy: { path: 'policy.md', version: '1.3.0', blobSha: 'p'.repeat(40) },
}
const ISSUE = { number: 300, id: 'task-id', node_id: 'task-node' }

function registryEntry(overrides = {}) {
  return {
    record: {
      payload: {
        request_id: REQUEST.requestId,
        pr_number: CONTEXT.pullRequest.number,
        task_issue_number: ISSUE.number,
        task_issue_id: ISSUE.id,
        task_issue_node_id: ISSUE.node_id,
        ...overrides,
      },
    },
  }
}

function expectStateConflict(callback: () => void) {
  try {
    callback()
  } catch (error) {
    expect(error).toMatchObject({ code: 'STATE_CONFLICT', classification: 'STATE_CONFLICT' })
    return
  }
  throw new Error('expected STATE_CONFLICT')
}


function provisional() {
  return {
    request_id: REQUEST.requestId,
    repository: CONTEXT.repository.nameWithOwner,
    parent_issue: 262,
    pr: 263,
    base: 'main',
    head: CONTEXT.pullRequest.headRefOid,
    protected_base_sha: CONTEXT.pullRequest.baseRefOid,
    policy_source: CONTEXT.policy.path,
    policy_version: CONTEXT.policy.version,
    policy_sha: CONTEXT.policy.blobSha,
  }
}

describe('task bootstrap allocation classification', () => {
  it('gives a valid signed parent registry owner precedence over scans', () => {
    const result = classifyTaskBootstrapAllocation({
      request: REQUEST, context: CONTEXT,
      registryRecords: [registryEntry()],
      scanned: { signed: { issue: { number: 301 } }, provisional: { issue: { number: 302 }, provisional: provisional() } },
    })
    expect(result).toMatchObject({ kind: ALLOCATION_KINDS.REGISTRY, outcome: 'RECOVERED' })
  })

  it('recovers a signed Issue before a provisional Issue', () => {
    const result = classifyTaskBootstrapAllocation({
      request: REQUEST, context: CONTEXT,
      scanned: { signed: { issue: ISSUE }, provisional: { issue: { number: 301 }, provisional: provisional() } },
    })
    expect(result).toMatchObject({ kind: ALLOCATION_KINDS.SIGNED_ISSUE, issue: ISSUE, outcome: 'IDEMPOTENT' })
  })

  it('recovers a valid provisional Issue and creates only when no owner exists', () => {
    expect(classifyTaskBootstrapAllocation({
      request: REQUEST, context: CONTEXT,
      scanned: { provisional: { issue: ISSUE, provisional: provisional() } },
    })).toMatchObject({ kind: ALLOCATION_KINDS.PROVISIONAL_ISSUE, outcome: 'RECOVERED' })
    expect(classifyTaskBootstrapAllocation({ request: REQUEST, context: CONTEXT })).toMatchObject({ kind: ALLOCATION_KINDS.CREATE_PROVISIONAL, outcome: 'CREATED' })
  })

  it('rejects competing owners and mismatched provisional metadata fail closed', () => {
    expect(() => classifyTaskBootstrapAllocation({
      request: REQUEST, context: CONTEXT,
      registryRecords: [{ record: { payload: { request_id: 'mc-task-bootstrap-v1-' + 'c'.repeat(64), pr_number: 263 } } }],
    })).toThrow('parent ownership registry already records a competing Task for PR #263')
    expect(() => classifyTaskBootstrapAllocation({
      request: REQUEST, context: CONTEXT,
      scanned: { provisional: { issue: ISSUE, provisional: { ...provisional(), head: 'x'.repeat(40) } } },
    })).toThrow(/mismatched deterministic binding/)
  })

  it('keeps the workflow registry readback wired to the canonical lookup helper', () => {
    const workflow = readFileSync(resolve(process.cwd(), 'scripts/mission-control/workflows/task-bootstrap.mjs'), 'utf8')
    expect(workflow).toContain("import { classifyTaskBootstrapAllocation, matchesProvisional, registryForRequest } from '../domain/task-bootstrap-allocation.mjs'")
    expect(workflow).toContain('const duplicate = registryForRequest(refreshedRegistry.records, request.requestId)')
    expect(workflow).not.toContain('recordForRequest')
    expect(registryForRequest([registryEntry()], REQUEST.requestId)).toMatchObject({ record: { payload: { task_issue_number: 300, task_issue_id: 'task-id', task_issue_node_id: 'task-node' } } })
  })

  it('rejects duplicate same-request registry owners with different complete Task identities', () => {
    expectStateConflict(() => classifyTaskBootstrapAllocation({
      request: REQUEST,
      context: CONTEXT,
      registryRecords: [
        registryEntry(),
        registryEntry({ task_issue_number: 301, task_issue_id: 'other-task-id', task_issue_node_id: 'other-task-node' }),
      ],
    }))
  })

  it('keeps duplicate same-request registry owners idempotent when complete Task identity matches', () => {
    const first = registryEntry()
    const duplicate = registryEntry()
    const result = classifyTaskBootstrapAllocation({
      request: REQUEST,
      context: CONTEXT,
      registryRecords: [first, duplicate],
    })
    expect(result).toMatchObject({ kind: ALLOCATION_KINDS.REGISTRY, outcome: 'RECOVERED', registry: first })
  })

  it('keeps provisional identity distinct from signed ownership', () => {
    expect(matchesProvisional(provisional(), { request: REQUEST, context: CONTEXT })).toBe(true)
    expect(classifyTaskBootstrapAllocation({
      request: REQUEST, context: CONTEXT,
      scanned: { provisional: { issue: ISSUE, provisional: provisional() } },
    }).kind).toBe(ALLOCATION_KINDS.PROVISIONAL_ISSUE)
  })
})
