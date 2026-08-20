/**
 * Machine-readable Mission Control transport ownership.
 *
 * Durable writers must consult this registry before choosing a transport. The
 * recovery route is exceptional and quarantines existing evidence; it does not
 * grant ordinary REVIEW_VERDICT publication authority.
 *
 * The recovery route's receipt contract keeps three identities separate:
 * incident_base_sha is immutable PR #275 incident lineage, execution_policy_sha
 * is the live protected policy commit used for trusted recovery, and
 * policy_source_sha is the separately verified guide-content identity. The two
 * base SHAs may differ. A legacy recovery receipt that supplies only the
 * ambiguous protected_base_sha field must fail closed.
 */

export type MissionControlTransportRole =
  | 'HANDOFF'
  | 'RESULT'
  | 'REVIEW_VERDICT'
  | 'STATE_PROJECTION'
  | 'MERGE'
  | 'FOUNDER_AUTHORIZATION'

export type CanonicalTransportRoute = {
  command: string
  role: MissionControlTransportRole
  owner: string
  purpose: string
  exceptional: boolean
  ordinary_owner?: string
}

export type AssertTransportRouteOptions = {
  role?: MissionControlTransportRole
  allowExceptional?: boolean
}

export const CANONICAL_TRANSPORTS: ReadonlyArray<Readonly<CanonicalTransportRoute>> = Object.freeze([
  Object.freeze({
    command: 'bemoat:mission-control:dispatch',
    role: 'HANDOFF',
    owner: 'Mission Control Dispatch',
    purpose: 'claim IN_PROGRESS and bind one HANDOFF',
    exceptional: false,
  }),
  Object.freeze({
    command: 'bemoat:agent:delivery',
    role: 'RESULT',
    owner: 'Delivery Coordinator',
    purpose: 'project a successful implementation to AWAITING_REVIEW_1',
    exceptional: false,
  }),
  Object.freeze({
    command: 'bemoat:mission-control:review',
    role: 'REVIEW_VERDICT',
    owner: 'Reviewer',
    purpose: 'publish an ordinary Full or Delta Review verdict',
    exceptional: false,
  }),
  Object.freeze({
    command: 'bemoat:mission-control:recover-review',
    role: 'REVIEW_VERDICT',
    owner: 'Mission Control Recovery Transport',
    ordinary_owner: 'bemoat:mission-control:review',
    purpose: 'quarantine the exact approved #274/#275 raw-review incident and project its proven Review 2 result',
    exceptional: true,
  }),
  Object.freeze({
    command: 'bemoat:mission-control:reconcile',
    role: 'STATE_PROJECTION',
    owner: 'State Reconciler',
    purpose: 'repair routing-only projection drift after a failed canonical transport',
    exceptional: false,
  }),
  Object.freeze({
    command: 'bemoat:mission-control:merge',
    role: 'MERGE',
    owner: 'Founder-authorized Merge Transport',
    purpose: 'execute an existing Founder-authorized merge completion bundle',
    exceptional: false,
  }),
  Object.freeze({
    command: 'bemoat:mission-control:reopen',
    role: 'STATE_PROJECTION',
    owner: 'Founder-authorized Reopen Transport',
    purpose: 'project Founder-authorized PR head drift to FOUNDER_AUTHORIZED_CORRECTION',
    exceptional: false,
  }),
  Object.freeze({
    command: 'bemoat:mission-control:adopt-finding',
    role: 'STATE_PROJECTION',
    owner: 'Founder-authorized Finding Adoption Transport',
    purpose: 'append one Founder-authorized finding to the active correction contract without changing CORRECTION_REQUIRED state',
    exceptional: false,
  }),
  Object.freeze({
    command: 'bemoat:mission-control:recover-state',
    role: 'STATE_PROJECTION',
    owner: 'Missing Managed-State Recovery Transport',
    purpose: 'recreate one uniquely reconstructed absent managed-state projection without review or finding adoption',
    exceptional: true,
  }),
  Object.freeze({
    command: 'bemoat:mission-control:authorize-founder',
    role: 'FOUNDER_AUTHORIZATION',
    owner: 'Founder Authorization Recording Transport',
    purpose: 'record one immutable Founder authorization with live ID/readback binding',
    exceptional: false,
  }),
])

const routeByCommand = new Map<string, Readonly<CanonicalTransportRoute>>(
  CANONICAL_TRANSPORTS.map((route) => [route.command, route]),
)

export function getTransportRoute(command: unknown): Readonly<CanonicalTransportRoute> | null {
  return routeByCommand.get(String(command)) ?? null
}

export function assertTransportRoute(
  command: string,
  { role, allowExceptional = true }: AssertTransportRouteOptions = {},
): Readonly<CanonicalTransportRoute> {
  const route = getTransportRoute(command)
  if (!route) throw new Error(`STATE_CONFLICT: no canonical Mission Control transport is registered for ${command}`)
  if (role && route.role !== role) {
    throw new Error(`STATE_CONFLICT: ${command} does not own ${role} evidence`)
  }
  if (!allowExceptional && route.exceptional) {
    throw new Error(`STATE_CONFLICT: exceptional transport ${command} is not allowed on the ordinary path`)
  }
  return route
}
