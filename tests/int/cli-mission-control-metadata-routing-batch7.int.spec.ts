/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest'

import { missionControlPrimaryCommands } from '../../scripts/cli/mission-control-command-metadata-primary.mjs'
import { missionControlRecoveryCommands } from '../../scripts/cli/mission-control-command-metadata-recovery.mjs'
import { missionControlReviewCommands } from '../../scripts/cli/mission-control-command-metadata-review.mjs'
import {
  ALL_MUTATING_COMMANDS,
  missionControlPrimaryRoutes,
} from '../../scripts/cli/mission-control-routing-policy-primary.mjs'
import { missionControlRecoveryRoutes } from '../../scripts/cli/mission-control-routing-policy-recovery.mjs'
import { COMMAND_CONTRACT_REGISTRY } from '../../scripts/cli/command-contract-registry.mjs'

const EXPECTED_ALL_MUTATING_COMMANDS = [
  'bemoat:boilerplate:sync',
  'bemoat:hooks:install',
  'bemoat:issue:comment',
  'bemoat:mission-control:adopt-finding',
  'bemoat:mission-control:authorize-founder',
  'bemoat:mission-control:merge',
  'bemoat:mission-control:merge-standard',
  'bemoat:mission-control:reconcile',
  'bemoat:mission-control:recover-review',
  'bemoat:mission-control:recover-state',
  'bemoat:mission-control:recover-review-eligibility',
  'bemoat:mission-control:reopen',
  'bemoat:mission-control:review',
  'bemoat:mission-control:task-bootstrap',
] as const

const EXPECTED_PRIMARY_COMMANDS = [
  'bemoat:mission-control:authorize-founder',
  'bemoat:mission-control:merge',
  'bemoat:mission-control:merge-standard',
  'bemoat:mission-control:reconcile',
  'bemoat:mission-control:recover-review',
] as const

const EXPECTED_RECOVERY_COMMANDS = [
  'bemoat:mission-control:adopt-finding',
  'bemoat:mission-control:recover-state',
  'bemoat:mission-control:recover-review-eligibility',
] as const

const EXPECTED_REVIEW_COMMANDS = [
  'bemoat:mission-control:reopen',
  'bemoat:mission-control:review',
  'bemoat:mission-control:task-bootstrap',
] as const

const EXPECTED_PRIMARY_ROUTE_KEYS = [
  'no-task/founder-authorization-recording',
  'no-task/exact-task-bootstrap-founder-authorization-workflow-tuple',
  'READY/retired-stateful-dispatch',
  'IN_PROGRESS/retired-delivery-coordinator',
  'AWAITING_REVIEW_1/exact-full-review-evidence',
  'CORRECTION_REQUIRED_1/founder-authorized-finding-adoption',
  'AWAITING_REVIEW_2/exact-delta-review-evidence',
  'CORRECTION_REQUIRED_2/founder-authorized-finding-adoption',
  'AWAITING_REVIEW_3/exact-bounded-delta-review-evidence',
  'AWAITING_REVIEW_3/exact-blocker-verification-evidence',
  'FOUNDER_AUTHORIZED_CORRECTION/unconsumed-exact-authorization',
  'ELIGIBLE_FOR_FOUNDER_REVIEW/exact-merge-authorization-recording',
  'BLOCKED_FOR_FOUNDER_DECISION/missing-named-authorization',
  'ELIGIBLE_FOR_FOUNDER_REVIEW/missing-merge-authorization',
  'NOT_STATEFUL/standard-non-managed-founder-merge-completion',
] as const

const EXPECTED_RECOVERY_ROUTE_KEYS = [
  'ELIGIBLE_FOR_FOUNDER_REVIEW/exact-merge-authorization-current-reviewed-head',
  'ELIGIBLE_FOR_FOUNDER_REVIEW/complete-founder-old-new-head-reopen-tuple',
  'ANY_STATE/unauthorized-head-drift',
  'ANY_STATE/proven-routing-only-projection-drift',
  'ANY_STATE/exact-quarantined-274-275-incident-tuple',
  'ANY_STATE/absent-managed-state-unique-reconstruction',
  'ANY_STATE/absent-managed-state-review-eligibility-reconstruction',
  'DONE/exact-identical-merge-completion-retry',
  'DONE/no-retry-request',
  'BLOCKED_EXTERNAL/state-conflict-or-migration-required',
  'STATE_CONFLICT/explicit-stop',
  'STATE_MIGRATION_REQUIRED/explicit-stop',
  'ANY_STATE/malformed-stale-superseded-duplicated-competing-evidence',
  'NOT_STATEFUL/explicit-fast-unmanaged-role-comment',
  'NOT_STATEFUL/explicit-authorized-starter-child-sync',
  'NOT_STATEFUL/explicit-local-hook-install',
] as const

function metadataDependencies() {
  return {
    contract: <T extends Record<string, unknown>>(value: T) => value,
    positional: () => ({}),
    stdinInput: () => ({}),
    flag: () => ({}),
    environment: () => ({}),
    nextAction: (type: string, command: string | null, reason: string) => ({
      type,
      command,
      reason,
    }),
  }
}

describe('Batch 7 characterization — CLI command metadata and routing policy leaves', () => {
  it('exports ALL_MUTATING_COMMANDS in exact registry order', () => {
    expect([...ALL_MUTATING_COMMANDS]).toEqual([...EXPECTED_ALL_MUTATING_COMMANDS])
    expect(new Set(ALL_MUTATING_COMMANDS).size).toBe(EXPECTED_ALL_MUTATING_COMMANDS.length)
  })

  it('exports mission-control command metadata partitions with stable command keys', () => {
    const deps = metadataDependencies()
    expect(Object.keys(missionControlPrimaryCommands(deps))).toEqual([...EXPECTED_PRIMARY_COMMANDS])
    expect(Object.keys(missionControlRecoveryCommands(deps))).toEqual([...EXPECTED_RECOVERY_COMMANDS])
    expect(Object.keys(missionControlReviewCommands(deps))).toEqual([...EXPECTED_REVIEW_COMMANDS])
  })

  it('exports primary and recovery route keys in exact order', () => {
    expect(missionControlPrimaryRoutes().map((route: any) => route.route_key)).toEqual([
      ...EXPECTED_PRIMARY_ROUTE_KEYS,
    ])
    expect(missionControlRecoveryRoutes().map((route: any) => route.route_key)).toEqual([
      ...EXPECTED_RECOVERY_ROUTE_KEYS,
    ])
    expect(missionControlPrimaryRoutes()).toHaveLength(15)
    expect(missionControlRecoveryRoutes()).toHaveLength(16)
  })

  it('expands prohibited_commands from ALL_MUTATING_COMMANDS for founder-gate routes', () => {
    const founderGateRoutes = missionControlPrimaryRoutes().filter((route: any) => route.decision === 'FOUNDER_GATE')
    expect(founderGateRoutes).toHaveLength(5)
    for (const route of founderGateRoutes) {
      expect(route.prohibited_commands).toEqual([...ALL_MUTATING_COMMANDS])
    }

    const recoveryStopRoutes = missionControlRecoveryRoutes().filter(
      (route: any) => route.prohibited_commands.length === ALL_MUTATING_COMMANDS.length,
    )
    expect(recoveryStopRoutes.length).toBeGreaterThan(0)
    for (const route of recoveryStopRoutes) {
      expect(route.prohibited_commands).toEqual([...ALL_MUTATING_COMMANDS])
    }
  })

  it('preserves registry composition through the compatibility facades', () => {
    const routeKeys = COMMAND_CONTRACT_REGISTRY.routes.map((route: any) => route.route_key)
    expect(routeKeys.slice(0, EXPECTED_PRIMARY_ROUTE_KEYS.length)).toEqual([...EXPECTED_PRIMARY_ROUTE_KEYS])
    expect(routeKeys.slice(
      EXPECTED_PRIMARY_ROUTE_KEYS.length,
      EXPECTED_PRIMARY_ROUTE_KEYS.length + EXPECTED_RECOVERY_ROUTE_KEYS.length,
    )).toEqual([...EXPECTED_RECOVERY_ROUTE_KEYS])
    expect(routeKeys.at(-2)).toBe('context_sync_base')
    expect(routeKeys.at(-1)).toBe('NOT_STATEFUL_HANDOFF')
    expect(routeKeys).toHaveLength(
      EXPECTED_PRIMARY_ROUTE_KEYS.length + EXPECTED_RECOVERY_ROUTE_KEYS.length + 2,
    )
  })

  it('publishes a disjoint STANDARD/non-managed merge contract and route', () => {
    const deps = metadataDependencies()
    const primary = missionControlPrimaryCommands(deps)
    expect(primary['bemoat:mission-control:merge-standard']).toMatchObject({
      accepted_pre_states: ['STANDARD_NON_MANAGED_ELIGIBLE'],
      next_action_rules: expect.arrayContaining([
        expect.objectContaining({ next_action: expect.objectContaining({ type: 'COMPLETE', command: null }) }),
      ]),
    })
    expect(COMMAND_CONTRACT_REGISTRY.commands['bemoat:mission-control:merge-standard']).toMatchObject({ transport_role: 'MERGE' })
    expect(missionControlPrimaryRoutes()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        route_key: 'NOT_STATEFUL/standard-non-managed-founder-merge-completion',
        observed_state: 'NOT_STATEFUL',
        canonical_command: 'bemoat:mission-control:merge-standard',
        prohibited_commands: ['bemoat:mission-control:merge'],
      }),
    ]))
  })

  it('preserves Class C recover-review and Class D recover-state metadata bindings', () => {
    const deps = metadataDependencies()
    const primary = missionControlPrimaryCommands(deps)
    const recovery = missionControlRecoveryCommands(deps)

    expect(primary['bemoat:mission-control:recover-review'].parser_owner).toBe(
      'scripts/mission-control/workflows/recover-review.mjs',
    )
    expect(recovery['bemoat:mission-control:recover-state'].accepted_pre_states).toEqual([
      'MANAGED_STATE_BLOCK_ABSENT',
    ])
    expect(recovery['bemoat:mission-control:recover-state'].stop_conditions?.length).toBeGreaterThan(0)
  })
})
