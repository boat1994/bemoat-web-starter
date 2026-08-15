import { execFileSync } from 'node:child_process'
import { afterAll, describe, expect, it } from 'vitest'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import * as allocationFacade from '../../scripts/mission-control/domain/task-bootstrap-allocation.ts'
import { BOOTSTRAP_CONTRACT } from '../../scripts/mission-control/domain/task-bootstrap-authorization.ts'
import {
  ALLOCATION_KINDS,
  classifyTaskBootstrapAllocation,
  matchesProvisional,
  registryForRequest,
} from '../../scripts/mission-control/domain/task-bootstrap-allocation.ts'

const REQUEST = { requestId: 'mc-task-bootstrap-v1-' + 'a'.repeat(64) }
const CONTEXT = {
  repository: { nameWithOwner: 'boat1994/bemoat-web-starter' },
  parentIssue: { number: 262 },
  pullRequest: { number: 263, baseRefName: 'main', headRefOid: 'h'.repeat(40), baseRefOid: 'b'.repeat(40) },
  policy: { path: 'policy.md', version: '1.3.0', blobSha: 'p'.repeat(40) },
}
const ISSUE = { number: 300, id: 'task-id', node_id: 'task-node' }

const LEGACY_COMMIT = '17bf1de65eba9f2c798ab531b25c1f8c2619fa63^'
const ALLOCATION_MODULE = 'scripts/mission-control/domain/task-bootstrap-allocation.mjs'
let legacyModulePath: string | undefined

async function loadLegacyAllocation() {
  if (!legacyModulePath) {
    const legacySource = execFileSync('git', ['show', `${LEGACY_COMMIT}:${ALLOCATION_MODULE}`], {
      encoding: 'utf8',
    }).replace(
      "from './task-bootstrap-authorization.mjs'",
      `from ${JSON.stringify(pathToFileURL(resolve(process.cwd(), 'scripts/mission-control/domain/task-bootstrap-authorization.ts')).href)}`,
    )
    legacyModulePath = resolve(process.cwd(), 'tests/.task-bootstrap-allocation-legacy.mjs')
    writeFileSync(legacyModulePath, legacySource)
  }
  return import(/* @vite-ignore */ legacyModulePath)
}

function capture(callback: () => unknown) {
  try {
    return { kind: 'return' as const, value: callback() }
  } catch (error) {
    return {
      kind: 'throw' as const,
      name: error instanceof Error ? error.constructor.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

afterAll(() => {
  if (legacyModulePath) rmSync(legacyModulePath, { force: true })
})

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

function expectStateConflict(callback: () => void, message?: string) {
  try {
    callback()
  } catch (error) {
    expect(error).toMatchObject({ code: 'STATE_CONFLICT', classification: 'STATE_CONFLICT' })
    if (message) expect(error).toHaveProperty('message', message)
    return
  }
  throw new Error('expected STATE_CONFLICT')
}


function provisional(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
    ...overrides,
  }
}

describe('task bootstrap allocation classification', () => {
  it('matches legacy native null TypeErrors and exact messages', async () => {
    const legacy = await loadLegacyAllocation()
    const cases = [
      {
        name: 'null matches options',
        invoke: (module: typeof legacy) => module.matchesProvisional(provisional(), null as never),
        message: "Cannot destructure property 'request' of '(intermediate value)(intermediate value)(intermediate value)' as it is null.",
      },
      {
        name: 'null scanned input',
        invoke: (module: typeof legacy) => module.classifyTaskBootstrapAllocation({ request: REQUEST, context: CONTEXT, scanned: null }),
        message: "Cannot read properties of null (reading 'signed')",
      },
      {
        name: 'null registry entry',
        invoke: (module: typeof legacy) => module.registryForRequest([null], REQUEST.requestId),
        message: "Cannot destructure property 'record' of 'object null' as it is null.",
      },
    ]

    for (const testCase of cases) {
      const legacyOutcome = capture(() => testCase.invoke(legacy))
      const typedOutcome = capture(() => testCase.invoke(allocationFacade))
      expect(legacyOutcome, testCase.name).toMatchObject({ kind: 'throw', name: 'TypeError', message: testCase.message })
      expect(typedOutcome, testCase.name).toEqual(legacyOutcome)
    }
  })

  it('preserves legacy varying pull-request and policy getter results and access order', async () => {
    const legacy = await loadLegacyAllocation()

    function createVaryingContext(log: string[]) {
      let pullRequestRead = 0
      let policyRead = 0
      const pullRequests = [
        { number: CONTEXT.pullRequest.number },
        { baseRefName: CONTEXT.pullRequest.baseRefName },
        { headRefOid: CONTEXT.pullRequest.headRefOid },
        { baseRefOid: CONTEXT.pullRequest.baseRefOid },
      ]
      const policies = [
        { path: CONTEXT.policy.path },
        { version: CONTEXT.policy.version },
        { blobSha: CONTEXT.policy.blobSha },
      ]
      return {
        get repository() {
          log.push('context.repository')
          return new Proxy(CONTEXT.repository, {
            get(target, key, receiver) {
              log.push(`repository.${String(key)}`)
              return Reflect.get(target, key, receiver)
            },
          })
        },
        get parentIssue() {
          log.push('context.parentIssue')
          return new Proxy(CONTEXT.parentIssue, {
            get(target, key, receiver) {
              log.push(`parentIssue.${String(key)}`)
              return Reflect.get(target, key, receiver)
            },
          })
        },
        get pullRequest() {
          log.push(`context.pullRequest.${pullRequestRead}`)
          return pullRequests[pullRequestRead++]
        },
        get policy() {
          log.push(`context.policy.${policyRead}`)
          return policies[policyRead++]
        },
      }
    }

    function invoke(module: typeof legacy) {
      const log: string[] = []
      const result = module.matchesProvisional(provisional(), {
        request: REQUEST,
        context: createVaryingContext(log),
      })
      return { result, log }
    }

    const legacyOutcome = capture(() => invoke(legacy))
    const typedOutcome = capture(() => invoke(allocationFacade))
    expect(legacyOutcome).toEqual({
      kind: 'return',
      value: {
        result: true,
        log: [
          'context.repository',
          'repository.nameWithOwner',
          'context.parentIssue',
          'parentIssue.number',
          'context.pullRequest.0',
          'context.pullRequest.1',
          'context.pullRequest.2',
          'context.pullRequest.3',
          'context.policy.0',
          'context.policy.1',
          'context.policy.2',
        ],
      },
    })
    expect(typedOutcome).toEqual(legacyOutcome)
  })

  it('preserves legacy varying signed-scan getter behavior', async () => {
    const legacy = await loadLegacyAllocation()
    const issue = { number: 301 }

    function invoke(module: typeof legacy) {
      let signedRead = 0
      const scanned: { signed?: { issue: typeof issue }, provisional?: undefined } = {
        get signed() {
          signedRead += 1
          return signedRead === 1 ? { issue } : undefined
        },
        provisional: undefined,
      }
      return module.classifyTaskBootstrapAllocation({ request: REQUEST, context: CONTEXT, scanned })
    }

    const legacyOutcome = capture(() => invoke(legacy))
    const typedOutcome = capture(() => invoke(allocationFacade))
    expect(legacyOutcome).toMatchObject({
      kind: 'throw',
      name: 'TypeError',
      message: "Cannot read properties of undefined (reading 'issue')",
    })
    expect(typedOutcome).toEqual(legacyOutcome)
  })

  it('keeps the frozen allocation kinds and exact result shapes', () => {
    expect(ALLOCATION_KINDS).toEqual({
      REGISTRY: 'REGISTRY',
      SIGNED_ISSUE: 'SIGNED_ISSUE',
      PROVISIONAL_ISSUE: 'PROVISIONAL_ISSUE',
      CREATE_PROVISIONAL: 'CREATE_PROVISIONAL',
    })
    expect(Object.isFrozen(ALLOCATION_KINDS)).toBe(true)

    const registry = registryEntry()
    const signedIssue = { number: 301 }
    const provisionalIssue = { number: 302 }
    expect(classifyTaskBootstrapAllocation({ request: REQUEST, context: CONTEXT, registryRecords: [registry] })).toEqual({
      kind: 'REGISTRY', outcome: 'RECOVERED', registry, issue: null,
    })
    expect(classifyTaskBootstrapAllocation({ request: REQUEST, context: CONTEXT, scanned: { signed: { issue: signedIssue } } })).toEqual({
      kind: 'SIGNED_ISSUE', outcome: 'IDEMPOTENT', registry: null, issue: signedIssue,
    })
    expect(classifyTaskBootstrapAllocation({ request: REQUEST, context: CONTEXT, scanned: { provisional: { issue: provisionalIssue, provisional: provisional() } } })).toEqual({
      kind: 'PROVISIONAL_ISSUE', outcome: 'RECOVERED', registry: null, issue: provisionalIssue,
    })
    expect(classifyTaskBootstrapAllocation({ request: REQUEST, context: CONTEXT })).toEqual({
      kind: 'CREATE_PROVISIONAL', outcome: 'CREATED', registry: null, issue: null,
    })
  })

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
    })).toThrow('provisional Task Issue has a mismatched deterministic binding')
  })

  it('keeps the workflow registry readback wired to the canonical lookup helper', () => {
    const workflow = readFileSync(resolve(process.cwd(), 'scripts/mission-control/workflows/task-bootstrap.mjs'), 'utf8')
    expect(workflow).toContain("import { classifyTaskBootstrapAllocation, matchesProvisional, registryForRequest } from '../domain/task-bootstrap-allocation.ts'")
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

  it('rejects every incomplete duplicate Task identity with the exact conflict', () => {
    const incompleteVariants = [
      { task_issue_number: undefined },
      { task_issue_number: 0 },
      { task_issue_number: -1 },
      { task_issue_number: 1.5 },
      { task_issue_number: '300' },
      { task_issue_id: undefined },
      { task_issue_id: '' },
      { task_issue_id: 300 },
      { task_issue_node_id: undefined },
      { task_issue_node_id: '' },
      { task_issue_node_id: 300 },
    ]

    for (const variant of incompleteVariants) {
      expectStateConflict(() => registryForRequest([
        registryEntry(),
        registryEntry(variant),
      ], REQUEST.requestId), 'parent ownership registry contains conflicting Task identities for the deterministic request')
    }
  })

  it('keeps complete duplicate identity variants idempotent and preserves the first reference', () => {
    const first = registryEntry({ unknown_key: 'first' })
    const duplicate = registryEntry({ unknown_key: 'second' })
    expect(registryForRequest([first, duplicate], REQUEST.requestId)).toBe(first)
    expect(classifyTaskBootstrapAllocation({
      request: REQUEST,
      context: CONTEXT,
      registryRecords: [first, duplicate],
    }).registry).toBe(first)
  })

  it('checks competing ownership before every other allocation outcome', () => {
    const competing = registryEntry({ request_id: 'other-request', pr_number: '263' })
    const mismatched = { ...provisional(), head: 'x'.repeat(40) }
    expectStateConflict(() => classifyTaskBootstrapAllocation({
      request: REQUEST,
      context: CONTEXT,
      registryRecords: [competing, registryEntry()],
      scanned: { signed: { issue: { number: 301 } }, provisional: { issue: { number: 302 }, provisional: mismatched } },
    }), 'parent ownership registry already records a competing Task for PR #263')
  })

  it('uses strict request equality and string-coercive PR comparison only for competing records', () => {
    const sameRequest = registryEntry({ pr_number: '263' })
    expect(registryForRequest([sameRequest], REQUEST.requestId)).toBe(sameRequest)
    expect(classifyTaskBootstrapAllocation({
      request: REQUEST,
      context: CONTEXT,
      registryRecords: [sameRequest],
    }).kind).toBe(ALLOCATION_KINDS.REGISTRY)

    const strictRequestMismatch = registryEntry({ request_id: new String(REQUEST.requestId), pr_number: '263' })
    expectStateConflict(() => classifyTaskBootstrapAllocation({
      request: REQUEST,
      context: CONTEXT,
      registryRecords: [strictRequestMismatch],
    }), 'parent ownership registry already records a competing Task for PR #263')
  })

  it('accepts every truthy signed scan without validating its shape', () => {
    const issue = { number: 301 }
    expect(classifyTaskBootstrapAllocation({ request: REQUEST, context: CONTEXT, scanned: { signed: { issue } } }).issue).toBe(issue)
    expect(classifyTaskBootstrapAllocation({ request: REQUEST, context: CONTEXT, scanned: { signed: true } })).toEqual({
      kind: ALLOCATION_KINDS.SIGNED_ISSUE, outcome: 'IDEMPOTENT', registry: null, issue: undefined,
    })
    expect(classifyTaskBootstrapAllocation({ request: REQUEST, context: CONTEXT, scanned: { signed: 'legacy-signed-scan' } })).toEqual({
      kind: ALLOCATION_KINDS.SIGNED_ISSUE, outcome: 'IDEMPOTENT', registry: null, issue: undefined,
    })
    expect(classifyTaskBootstrapAllocation({ request: REQUEST, context: CONTEXT, scanned: { signed: 1 } }).kind).toBe(ALLOCATION_KINDS.SIGNED_ISSUE)
  })

  it('requires strict provisional bindings except for Number-coercive parent and PR fields', () => {
    expect(matchesProvisional(provisional({ parent_issue: '262', pr: '263' }), { request: REQUEST, context: CONTEXT })).toBe(true)
    expect(matchesProvisional(provisional({ parent_issue: 262n, pr: 263n }), { request: REQUEST, context: CONTEXT })).toBe(true)
    for (const key of ['request_id', 'repository', 'base', 'head', 'protected_base_sha', 'policy_source', 'policy_version', 'policy_sha']) {
      expect(matchesProvisional(provisional({ [key]: new String(provisional()[key]) }), { request: REQUEST, context: CONTEXT }), key).toBe(false)
    }
    expect(matchesProvisional(provisional({ parent_issue: 262, pr: 263, repository: CONTEXT.repository.nameWithOwner }), { request: REQUEST, context: CONTEXT })).toBe(true)
    expect(matchesProvisional(provisional({ parent_issue: { valueOf: () => 262 }, pr: { valueOf: () => 263 } }), { request: REQUEST, context: CONTEXT })).toBe(true)
  })

  it('uses BOOTSTRAP_CONTRACT fallbacks only for the legacy fallback fields', () => {
    const request = { requestId: 'fallback-request' }
    const context = {
      repository: { nameWithOwner: BOOTSTRAP_CONTRACT.repository },
      parentIssue: {},
      pullRequest: {},
      policy: {
        path: BOOTSTRAP_CONTRACT.policySource,
        version: BOOTSTRAP_CONTRACT.policyVersion,
        blobSha: BOOTSTRAP_CONTRACT.policySha,
      },
    }
    expect(matchesProvisional({
      request_id: request.requestId,
      repository: BOOTSTRAP_CONTRACT.repository,
      parent_issue: String(BOOTSTRAP_CONTRACT.parentIssue),
      pr: String(BOOTSTRAP_CONTRACT.pullRequest),
      base: BOOTSTRAP_CONTRACT.base,
      head: BOOTSTRAP_CONTRACT.head,
      protected_base_sha: BOOTSTRAP_CONTRACT.protectedBaseSha,
      policy_source: BOOTSTRAP_CONTRACT.policySource,
      policy_version: BOOTSTRAP_CONTRACT.policyVersion,
      policy_sha: BOOTSTRAP_CONTRACT.policySha,
    }, { request, context })).toBe(true)
  })

  it('accepts unknown keys, preserves references, and does not mutate inputs', () => {
    const issue = { number: 301, unknown: { preserved: true } }
    const input: Record<string, unknown> = {
      request: REQUEST,
      context: CONTEXT,
      registryRecords: [] as unknown[],
      scanned: { signed: { issue, unknown_scan_key: true }, unknown_scan_key: 'ignored' },
      unknown_input_key: 'ignored',
    }
    const before = structuredClone(input)
    const result = classifyTaskBootstrapAllocation(input)
    expect(result.issue).toBe(issue)
    expect(input).toEqual(before)

    const frozenInput = Object.freeze({
      request: Object.freeze({ ...REQUEST }),
      context: Object.freeze({ ...CONTEXT }),
      registryRecords: Object.freeze([]) as unknown as readonly unknown[],
      scanned: Object.freeze({}),
      unknown_input_key: 'ignored',
    })
    expect(classifyTaskBootstrapAllocation(frozenInput).kind).toBe(ALLOCATION_KINDS.CREATE_PROVISIONAL)

    const provisionalMetadata = provisional({ unknown_provisional_key: 'ignored' })
    expect(matchesProvisional(provisionalMetadata, { request: REQUEST, context: CONTEXT })).toBe(true)
    expect(provisionalMetadata.unknown_provisional_key).toBe('ignored')
  })

  it('preserves native defaults, null failures, and malformed input boundaries', () => {
    expect(classifyTaskBootstrapAllocation()).toEqual({
      kind: ALLOCATION_KINDS.CREATE_PROVISIONAL, outcome: 'CREATED', registry: null, issue: null,
    })
    expect(classifyTaskBootstrapAllocation({})).toEqual({
      kind: ALLOCATION_KINDS.CREATE_PROVISIONAL, outcome: 'CREATED', registry: null, issue: null,
    })
    expect(registryForRequest()).toBeNull()
    expect(() => matchesProvisional()).toThrow(TypeError)
    expect(() => classifyTaskBootstrapAllocation(null as never)).toThrow(TypeError)
    expect(() => classifyTaskBootstrapAllocation({ registryRecords: null as never })).toThrow(TypeError)
    expect(() => classifyTaskBootstrapAllocation({ scanned: null as never })).toThrow(TypeError)
    expect(() => registryForRequest(null as never, REQUEST.requestId)).toThrow(TypeError)
    expect(() => matchesProvisional(provisional(), null as never)).toThrow(TypeError)
  })

  it('keeps the canonical TypeScript module export set after facade removal', async () => {
    const { existsSync } = await import('node:fs')
    const typed = await import('../../scripts/mission-control/domain/task-bootstrap-allocation.ts')
    expect(existsSync('scripts/mission-control/domain/task-bootstrap-allocation.mjs')).toBe(false)
    expect(Object.keys(allocationFacade).sort()).toEqual(Object.keys(typed).sort())
    expect(Object.keys(allocationFacade).sort()).toEqual([
      'ALLOCATION_KINDS', 'classifyTaskBootstrapAllocation', 'matchesProvisional', 'registryForRequest',
    ])
    for (const name of Object.keys(allocationFacade) as Array<keyof typeof allocationFacade>) {
      expect(allocationFacade[name]).toBe(typed[name])
    }
  })

  it('keeps provisional identity distinct from signed ownership', () => {
    expect(matchesProvisional(provisional(), { request: REQUEST, context: CONTEXT })).toBe(true)
    expect(matchesProvisional({ ...provisional(), parent_issue: '262', pr: '263' }, { request: REQUEST, context: CONTEXT })).toBe(true)
    expect(matchesProvisional({ ...provisional(), parent_issue: undefined }, { request: REQUEST, context: CONTEXT })).toBe(false)
    expect(classifyTaskBootstrapAllocation({
      request: REQUEST, context: CONTEXT,
      scanned: { provisional: { issue: ISSUE, provisional: provisional() } },
    }).kind).toBe(ALLOCATION_KINDS.PROVISIONAL_ISSUE)
  })
})
