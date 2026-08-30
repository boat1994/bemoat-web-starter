/**
 * Machine-readable historical Mission Control transport ownership.
 *
 * These stateful transports remain registered for migration/read compatibility
 * only. They are not the supported cross-agent protocol after the stateless
 * context-to-handoff cutover. New work uses bemoat:context and bemoat:handoff.
 * Durable legacy writers must still consult this registry before interpreting
 * an existing transport record. The recovery route is exceptional and
 * quarantines existing evidence; it does not grant ordinary
 * REVIEW_VERDICT publication authority.
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
  | 'FOUNDER_AUTHORIZATION'

export type CanonicalTransportRoute = {
  command: string
  role: MissionControlTransportRole
  owner: string
  purpose: string
  exceptional: boolean
}

export type AssertTransportRouteOptions = {
  role?: MissionControlTransportRole
  allowExceptional?: boolean
}

export const CANONICAL_TRANSPORTS: ReadonlyArray<Readonly<CanonicalTransportRoute>> = Object.freeze([
  Object.freeze({
    command: 'bemoat:mission-control:authorize-founder',
    role: 'FOUNDER_AUTHORIZATION',
    owner: 'Founder Authorization Recording Transport',
    purpose: 'MIGRATION-ONLY HISTORICAL: record one immutable Founder authorization with live ID/readback binding',
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
