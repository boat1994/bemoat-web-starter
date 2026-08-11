import { describe, expect, it } from 'vitest'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped runtime .mjs boundary */
import {
  compareAndSwapIssueBody,
  createMemoryLeaseStore,
  hashIssueBody,
  leasePathForIssue,
} from '../../scripts/mission-control/workflows/issue-body-cas.mjs'
import {
  Coordinator as CoordinatorClass,
  normalizeTransitionIdentity,
  serializeTransitionIdentity,
  verifyStatePostcondition,
} from '../../scripts/mission-control-reconcile.mjs'

describe('mission-control issue-body lease CAS', () => {
  const repo = 'boat1994/bemoat-web-starter'
  const issueNumber = '213'
  const transitionIdentity = serializeTransitionIdentity(
    normalizeTransitionIdentity('## HANDOFF\n\n**Task / Issue:** #213\n**Phase:** Dev (implementation)\nWork', { role: 'HANDOFF' }),
  )

  it('hashes issue bodies stably', () => {
    expect(hashIssueBody('abc')).toBe(hashIssueBody('abc'))
    expect(hashIssueBody('abc')).not.toBe(hashIssueBody('abd'))
    expect(leasePathForIssue(213)).toBe('.bemoat/mission-control/leases/issue-213.json')
  })

  it('fails closed when body mutates after observed snapshot and before Issue update', async () => {
    let body = 'observed-body-v1'
    const winnerBody = 'winner-should-not-land'
    const alienBody = 'concurrent-mc-shaped-body'
    const leaseStore = createMemoryLeaseStore()
    const writes: string[] = []
    const path = leasePathForIssue(issueNumber)

    await expect(compareAndSwapIssueBody({
      repo,
      issueNumber,
      expectedBody: body,
      nextBody: winnerBody,
      transitionIdentity,
      holder: 'writer-a',
      deps: {
        leaseStore,
        readIssueBody: async () => body,
        writeIssueBody: async ({ body: next }: { body: string }) => {
          writes.push(next)
          body = next
        },
        beforeIssueUpdate: async () => {
          // Injected TOCTOU seam: mutation after lease win / snapshot, before Issue update.
          body = alienBody
        },
      },
    })).rejects.toThrow(/STATE_CONFLICT: concurrent Issue body change detected before state write/)

    expect(writes).toEqual([])
    expect(body).toBe(alienBody)
    // MC-R1-001 Case A: conflict after lease win must not leave a poisoning held lease.
    const leaseAfter = await leaseStore.read({ path })
    expect(leaseAfter?.content?.status).not.toBe('held')
    expect(leaseAfter?.content?.status).toBe('released')
  })

  it('gives empty transition identities distinct claim keys so they cannot dual-adopt', async () => {
    let body = 'shared-observed-body'
    const leaseStore = createMemoryLeaseStore()
    const writes: string[] = []
    let releaseSecond: (() => void) | null = null
    const secondBlocked = new Promise<void>((resolve) => {
      releaseSecond = resolve
    })
    let firstEnteredCritical = false

    const first = compareAndSwapIssueBody({
      repo,
      issueNumber,
      expectedBody: body,
      nextBody: 'body-from-empty-first',
      transitionIdentity: '',
      holder: 'writer-empty-first',
      deps: {
        leaseStore,
        readIssueBody: async () => body,
        writeIssueBody: async ({ body: next }: { body: string }) => {
          writes.push(next)
          body = next
        },
        beforeIssueUpdate: async () => {
          firstEnteredCritical = true
          releaseSecond?.()
          await new Promise((resolve) => setTimeout(resolve, 20))
        },
      },
    })

    await secondBlocked
    expect(firstEnteredCritical).toBe(true)

    const second = compareAndSwapIssueBody({
      repo,
      issueNumber,
      expectedBody: 'shared-observed-body',
      nextBody: 'body-from-empty-second',
      transitionIdentity: null,
      holder: 'writer-empty-second',
      deps: {
        leaseStore,
        readIssueBody: async () => body,
        writeIssueBody: async ({ body: next }: { body: string }) => {
          writes.push(next)
          body = next
        },
      },
    })

    const results = await Promise.allSettled([first, second])
    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter((result) => result.status === 'rejected')

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toEqual(
      expect.objectContaining({
        message: expect.stringMatching(/STATE_CONFLICT: issue-body lease CAS lost/),
      }),
    )
    expect(writes).toEqual(['body-from-empty-first'])
    expect(body).toBe('body-from-empty-first')
  })

  it('permits exactly one winner under contended lease CAS; loser is STATE_CONFLICT', async () => {
    let body = 'shared-observed-body'
    const leaseStore = createMemoryLeaseStore()
    const writes: string[] = []
    let releaseSecond: (() => void) | null = null
    const secondBlocked = new Promise<void>((resolve) => {
      releaseSecond = resolve
    })
    let firstEnteredCritical = false

    const first = compareAndSwapIssueBody({
      repo,
      issueNumber,
      expectedBody: body,
      nextBody: 'body-from-first',
      transitionIdentity: `${transitionIdentity}:first`,
      holder: 'writer-first',
      deps: {
        leaseStore,
        readIssueBody: async () => body,
        writeIssueBody: async ({ body: next }: { body: string }) => {
          writes.push(next)
          body = next
        },
        beforeIssueUpdate: async () => {
          firstEnteredCritical = true
          // Hold the lease while the contender attempts CAS.
          releaseSecond?.()
          await new Promise((resolve) => setTimeout(resolve, 20))
        },
      },
    })

    await secondBlocked
    expect(firstEnteredCritical).toBe(true)

    const second = compareAndSwapIssueBody({
      repo,
      issueNumber,
      expectedBody: 'shared-observed-body',
      nextBody: 'body-from-second',
      transitionIdentity: `${transitionIdentity}:second`,
      holder: 'writer-second',
      deps: {
        leaseStore,
        readIssueBody: async () => body,
        writeIssueBody: async ({ body: next }: { body: string }) => {
          writes.push(next)
          body = next
        },
      },
    })

    const results = await Promise.allSettled([first, second])
    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter((result) => result.status === 'rejected')

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toEqual(
      expect.objectContaining({
        message: expect.stringMatching(/STATE_CONFLICT: issue-body lease CAS lost/),
      }),
    )
    expect(writes).toEqual(['body-from-first'])
    expect(body).toBe('body-from-first')
  })

  it('Issue #255: CAS lease winner and loser produce one durable body transition', async () => {
    let body = 'issue-255-observed-body'
    const leaseStore = createMemoryLeaseStore()
    const writes: string[] = []
    let releaseContender: (() => void) | null = null
    const contenderReady = new Promise<void>((resolve) => {
      releaseContender = resolve
    })

    const winner = compareAndSwapIssueBody({
      repo,
      issueNumber: '255',
      expectedBody: body,
      nextBody: 'issue-255-winner-transition',
      transitionIdentity: 'issue-255-transition',
      holder: 'issue-255-winner',
      deps: {
        leaseStore,
        readIssueBody: async () => body,
        writeIssueBody: async ({ body: next }: { body: string }) => {
          writes.push(next)
          body = next
        },
        beforeIssueUpdate: async () => {
          releaseContender?.()
          await new Promise((resolve) => setTimeout(resolve, 20))
        },
      },
    })

    await contenderReady
    const loser = compareAndSwapIssueBody({
      repo,
      issueNumber: '255',
      expectedBody: 'issue-255-observed-body',
      nextBody: 'issue-255-loser-transition',
      transitionIdentity: 'issue-255-competing-transition',
      holder: 'issue-255-loser',
      deps: {
        leaseStore,
        readIssueBody: async () => body,
        writeIssueBody: async ({ body: next }: { body: string }) => {
          writes.push(next)
          body = next
        },
      },
    })

    const results = await Promise.allSettled([winner, loser])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(results.find((result) => result.status === 'rejected')).toEqual(expect.objectContaining({
      reason: expect.objectContaining({ message: expect.stringMatching(/STATE_CONFLICT: issue-body lease CAS lost/) }),
    }))
    expect(writes).toEqual(['issue-255-winner-transition'])
    expect(body).toBe('issue-255-winner-transition')
  })

  it('keeps post-write verification green for the winning projection', async () => {
    let body = '<!-- bemoat-mission-control-state:start -->\nstate: IN_PROGRESS\n<!-- bemoat-mission-control-state:end -->'
    const nextBody = '<!-- bemoat-mission-control-state:start -->\nstate: AWAITING_REVIEW_1\n<!-- bemoat-mission-control-state:end -->'
    const leaseStore = createMemoryLeaseStore()
    const expected = { state: 'AWAITING_REVIEW_1', review_cycle: 0, full_review_count: 0 }

    await compareAndSwapIssueBody({
      repo,
      issueNumber,
      expectedBody: body,
      nextBody,
      transitionIdentity,
      deps: {
        leaseStore,
        readIssueBody: async () => body,
        writeIssueBody: async ({ body: next }: { body: string }) => {
          body = next
        },
      },
    })

    expect(body).toBe(nextBody)
    expect(verifyStatePostcondition(
      expected,
      { state: 'AWAITING_REVIEW_1', review_cycle: 0, full_review_count: 0 },
      ['state', 'review_cycle', 'full_review_count'],
    )).toBe(true)
  })

  it('adopts an identical-rerun lease and preserves #184 comment reuse', async () => {
    const handoffBody = `## HANDOFF

**Target:** Dev / Builder
**Task / Issue:** #213
**Phase:** Dev (implementation)

Bounded implementation work.
`
    const identity = serializeTransitionIdentity(normalizeTransitionIdentity(handoffBody, { role: 'HANDOFF' }))
    let state: any = { state: 'READY', review_cycle: 0, full_review_count: 0 }
    const comments = [{ id: 'posted-1', body: handoffBody }]
    let postCalls = 0
    let body = 'issue-body-before-state-write'
    const leaseStore = createMemoryLeaseStore()
    let writeAttempts = 0

    // First write wins lease then fails before Issue update (comment already posted).
    await expect(compareAndSwapIssueBody({
      repo,
      issueNumber,
      expectedBody: body,
      nextBody: 'projected-after-comment',
      transitionIdentity: identity,
      holder: 'dispatch',
      deps: {
        leaseStore,
        readIssueBody: async () => body,
        writeIssueBody: async () => {
          throw new Error('simulated state write transport failure')
        },
      },
    })).rejects.toThrow(/simulated state write transport failure/)

    const coordinator = new CoordinatorClass({
      readState: async () => state,
      writeState: async (next: any) => {
        writeAttempts += 1
        await compareAndSwapIssueBody({
          repo,
          issueNumber,
          expectedBody: body,
          nextBody: `projected:${String(next.state)}`,
          transitionIdentity: identity,
          holder: 'dispatch',
          deps: {
            leaseStore,
            readIssueBody: async () => body,
            writeIssueBody: async ({ body: nextBody }: { body: string }) => {
              body = nextBody
            },
          },
        })
        state = structuredClone(next)
        return state
      },
      listComments: async () => comments,
      postComment: async () => {
        postCalls += 1
        throw new Error('should not post duplicate')
      },
    })

    const resumed = await coordinator.integrateHandoff({ handoffBody } as any)
    expect(resumed.outcome).toBe('DISPATCHED')
    expect(postCalls).toBe(0)
    expect(writeAttempts).toBe(1)
    expect(state.state).toBe('IN_PROGRESS')
    expect(state.latest_handoff_comment_id).toBe('posted-1')
    expect(comments).toHaveLength(1)
    expect(body).toBe('projected:IN_PROGRESS')
  })
})
