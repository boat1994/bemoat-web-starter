import { describe, expect, it } from 'vitest'

import { parseRoleCommentBody } from '../../scripts/mission-control-reconcile.mjs'
import { projectComments, selectAuthoritativeRoleComments } from '../../scripts/github-comment-projection.mjs'
import {
  BRAINSTORMING_PROFILE_HEADINGS,
  classifyFounderAuthorizationReply,
  evaluateBrainstormingTransition,
  guardBrainstormingStateMutation,
  isBrainstormingProfileResponse,
  parseBrainstormingProfileBody,
} from '../../scripts/mission-control-brainstorming.mjs'

const SAMPLE_BRAINSTORMING = [
  '## BRAINSTORMING',
  '',
  '## Brainstorming objective',
  '',
  'Choose remote E2E fixture cleanup policy for a child repository.',
  '',
  '## Confirmed context',
  '',
  '- Child repo uses Playwright against staging.',
  '- No implementation authorization yet.',
  '',
  '## Current design decisions',
  '',
  '- Prefer per-test isolation over shared mutable fixtures.',
  '',
  '## Options and trade-offs',
  '',
  '- Option A: truncate tables after each spec — slower, simpler reasoning.',
  '- Option B: seeded baseline snapshot — faster, higher setup cost.',
  '',
  '## Recommendation',
  '',
  'Start with Option A until flake rate is measured.',
  '',
  '## Open question',
  '',
  'Should cleanup run in `afterEach` or a dedicated teardown worker?',
  '',
  '## Durable GitHub impact',
  '',
  'None',
  '',
  '## Do not do yet',
  '',
  '- branch creation',
  '- commits or PRs',
  '- managed state updates',
].join('\n')

const SAMPLE_DESIGN_RESULT = [
  '## DESIGN RESULT',
  '',
  '### Selected approach',
  '',
  'Dedicated Brainstorming Response Profile',
  '',
  '## Durable GitHub impact',
  '',
  'None',
].join('\n')

describe('Mission Control brainstorming profile contract (#144)', () => {
  it('exposes the approved brainstorming profile headings', () => {
    expect(BRAINSTORMING_PROFILE_HEADINGS).toEqual(['BRAINSTORMING', 'DESIGN RESULT'])
  })

  it('does not parse brainstorming headings as HANDOFF, RESULT, or REVIEW_VERDICT', () => {
    for (const body of [SAMPLE_BRAINSTORMING, SAMPLE_DESIGN_RESULT]) {
      expect(parseRoleCommentBody(body).role).toBeNull()
      expect(isBrainstormingProfileResponse(body)).toBe(true)
    }

    for (const role of ['HANDOFF', 'RESULT', 'REVIEW_VERDICT'] as const) {
      const parsed = parseRoleCommentBody(`## ${role}\n\nBody`)
      expect(parsed.role).toBe(role)
      expect(isBrainstormingProfileResponse(`## ${role}\n\nBody`)).toBe(false)
    }
  })

  it('flags brainstorming responses that illegally include role-transport headings', () => {
    const illegal = `${SAMPLE_BRAINSTORMING}\n\n## RESULT\n\noops`
    expect(parseBrainstormingProfileBody(illegal).violatesContract).toBe(true)
    expect(parseBrainstormingProfileBody(SAMPLE_BRAINSTORMING).violatesContract).toBe(false)
  })

  it('does not treat brainstorming comments as authoritative role transport', () => {
    const comments = [
      {
        id: 'brainstorm',
        body: SAMPLE_BRAINSTORMING,
        createdAt: '2026-07-24T00:00:00Z',
        url: 'http://brainstorm',
      },
      {
        id: 'delivery',
        body: '## RESULT\n\n**PR:** #144 · head `abc1234`',
        createdAt: '2026-07-23T00:00:00Z',
        url: 'http://delivery',
      },
    ]

    for (const role of ['HANDOFF', 'RESULT', 'REVIEW_VERDICT'] as const) {
      const selected = [...selectAuthoritativeRoleComments(comments, role)]
      if (role === 'RESULT') {
        expect(selected.map((comment) => comment.id)).toEqual(['delivery'])
      } else {
        expect(selected).toEqual([])
      }
    }

    const projected = projectComments(comments)
    const brainstorm = projected.find((comment) => comment.id === 'brainstorm')
    expect(brainstorm?.body).toContain('## BRAINSTORMING')
    expect(brainstorm?.body).not.toContain('## RESULT')
  })

  it('cannot mutate managed state or review counters from a brainstorming response', () => {
    const managedState = {
      state: 'READY',
      review_cycle: 0,
      full_review_count: 0,
    }

    const guard = guardBrainstormingStateMutation(managedState, SAMPLE_BRAINSTORMING)
    expect(guard.mutatesState).toBe(false)
    expect(guard.countersUnchanged).toBe(true)
    expect(guard.state).toEqual(managedState)
  })

  it('treats bare approve as design-only approval, not implementation authorization', () => {
    for (const reply of ['approve', 'Approve', 'looks good', 'use option A']) {
      const result = classifyFounderAuthorizationReply(reply)
      expect(result.kind).toBe('design_only')
      expect(result.authorizesImplementation).toBe(false)
      expect(result.remainInBrainstorming).toBe(true)
    }
  })

  it('authorizes implementation only on explicit implementation language', () => {
    for (const reply of ['implement this', 'Start dev', 'create the implementation HANDOFF']) {
      const result = classifyFounderAuthorizationReply(reply)
      expect(result.kind).toBe('implementation')
      expect(result.authorizesImplementation).toBe(true)
      expect(result.remainInBrainstorming).toBe(false)
    }
  })

  it('allows scoped Founder approval to authorize implementation when explicitly framed', () => {
    const result = classifyFounderAuthorizationReply('approve', {
      scopedImplementationDecision: true,
    })
    expect(result.kind).toBe('scoped_implementation')
    expect(result.authorizesImplementation).toBe(true)
    expect(result.remainInBrainstorming).toBe(false)
  })

  it('remains fail-closed on ambiguous approval', () => {
    const result = classifyFounderAuthorizationReply('sounds fine I guess')
    expect(result.kind).toBe('ambiguous')
    expect(result.failClosed).toBe(true)
    expect(result.authorizesImplementation).toBe(false)
    expect(result.remainInBrainstorming).toBe(true)
  })

  it('exits brainstorming only after valid explicit implementation authorization', () => {
    const stillBrainstorming = evaluateBrainstormingTransition({
      inBrainstorming: true,
      responseBody: SAMPLE_BRAINSTORMING,
      founderReply: 'approve',
    })
    expect(stillBrainstorming.mode).toBe('brainstorming')
    expect(stillBrainstorming.remainInBrainstorming).toBe(true)
    expect(stillBrainstorming.useNormalMissionControlTemplate).toBe(false)

    const authorized = evaluateBrainstormingTransition({
      inBrainstorming: true,
      responseBody: SAMPLE_BRAINSTORMING,
      founderReply: 'start dev',
    })
    expect(authorized.mode).toBe('implementation')
    expect(authorized.remainInBrainstorming).toBe(false)
    expect(authorized.useNormalMissionControlTemplate).toBe(true)
  })

  it('resumes the normal Mission Control template only after a valid authorized transition', () => {
    const ambiguous = evaluateBrainstormingTransition({
      inBrainstorming: true,
      founderReply: 'maybe',
    })
    expect(ambiguous.useNormalMissionControlTemplate).toBe(false)
    expect(ambiguous.failClosed).toBe(true)

    const normal = evaluateBrainstormingTransition({
      inBrainstorming: false,
      responseBody: '## RESULT\n\n**PR:** #1',
      founderReply: '',
    })
    expect(normal.mode).toBe('normal')
    expect(normal.useNormalMissionControlTemplate).toBe(true)
  })
})
