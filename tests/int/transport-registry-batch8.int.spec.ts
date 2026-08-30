import { describe, expect, it } from 'vitest'

import {
  assertTransportRoute,
  CANONICAL_TRANSPORTS,
  getTransportRoute,
} from '../../scripts/mission-control/transport-registry.mjs'

const EXPECTED_TRANSPORT_COMMANDS = [
  'bemoat:mission-control:reconcile',
  'bemoat:mission-control:reopen',
  'bemoat:mission-control:adopt-finding',
  'bemoat:mission-control:recover-state',
  'bemoat:mission-control:recover-review-eligibility',
  'bemoat:mission-control:authorize-founder',
] as const

const EXPECTED_EXCEPTIONAL_COMMANDS = [
  'bemoat:mission-control:recover-state',
  'bemoat:mission-control:recover-review-eligibility',
] as const

describe('Batch 8 characterization — transport registry authority leaf', () => {
  it('exports CANONICAL_TRANSPORTS in exact registry order with frozen records', () => {
    expect(CANONICAL_TRANSPORTS.map((route) => route.command)).toEqual([
      ...EXPECTED_TRANSPORT_COMMANDS,
    ])
    expect(CANONICAL_TRANSPORTS).toHaveLength(EXPECTED_TRANSPORT_COMMANDS.length)
    expect(Object.isFrozen(CANONICAL_TRANSPORTS)).toBe(true)
    for (const route of CANONICAL_TRANSPORTS) {
      expect(Object.isFrozen(route)).toBe(true)
    }
  })

  it('preserves ordinary vs exceptional transport classification', () => {
    const exceptional = CANONICAL_TRANSPORTS.filter((route) => route.exceptional).map(
      (route) => route.command,
    )
    expect(exceptional).toEqual([...EXPECTED_EXCEPTIONAL_COMMANDS])

    const retainedReviewReaders = CANONICAL_TRANSPORTS.filter((route) => route.role === 'REVIEW_VERDICT')
    expect(retainedReviewReaders).toHaveLength(0)
  })

  it('preserves recover-state exceptional authority', () => {
    expect(getTransportRoute('bemoat:mission-control:recover-state')).toMatchObject({
      owner: 'Missing Managed-State Recovery Transport',
      role: 'STATE_PROJECTION',
      exceptional: true,
      purpose:
        'MIGRATION-ONLY HISTORICAL: recreate one uniquely reconstructed absent managed-state projection without review or finding adoption',
    })
    expect(getTransportRoute('bemoat:mission-control:recover-review-eligibility')).toMatchObject({
      owner: 'Missing-State Review Eligibility Recovery Transport',
      role: 'STATE_PROJECTION',
      exceptional: true,
    })
    expect(getTransportRoute('bemoat:mission-control:adopt-finding')).toMatchObject({
      role: 'STATE_PROJECTION',
      exceptional: false,
    })
    expect(getTransportRoute('bemoat:mission-control:authorize-founder')).toMatchObject({
      role: 'FOUNDER_AUTHORIZATION',
      exceptional: false,
    })
  })

  it('normalizes getTransportRoute input and returns null for unknown commands', () => {
    expect(getTransportRoute('bemoat:mission-control:dispatch')).toBeNull()
    expect(getTransportRoute(123 as unknown as string)).toBeNull()
    expect(getTransportRoute('bemoat:mission-control:unknown')).toBeNull()
    expect(getTransportRoute(null as unknown as string)).toBeNull()
  })

  it('assertTransportRoute fails closed with exact STATE_CONFLICT messages', () => {
    expect(() => assertTransportRoute('bemoat:mission-control:unknown')).toThrow(
      'STATE_CONFLICT: no canonical Mission Control transport is registered for bemoat:mission-control:unknown',
    )
    expect(() => assertTransportRoute('bemoat:mission-control:dispatch')).toThrow(
      'STATE_CONFLICT: no canonical Mission Control transport is registered for bemoat:mission-control:dispatch',
    )
  })

})
