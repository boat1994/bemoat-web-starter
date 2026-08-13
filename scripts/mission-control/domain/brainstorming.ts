/**
 * Brainstorming Response Profile contract helpers.
 *
 * Formatting/routing only — no durable state, role-comment type, counter
 * mutation, or implicit implementation authority.
 */

export const BRAINSTORMING_PROFILE_HEADINGS = ['BRAINSTORMING', 'DESIGN RESULT'] as const

const BRAINSTORMING_PROFILE_HEADING_RE = /^##\s+(BRAINSTORMING|DESIGN\s+RESULT)\s*$/m

const ROLE_TRANSPORT_HEADING_RE = /^##\s+(HANDOFF|RESULT|REVIEW_VERDICT)\s*$/m

const EXPLICIT_IMPLEMENTATION_AUTH_RE =
  /\b(?:implement\s+this|start\s+dev|create\s+the\s+implementation\s+HANDOFF)\b/i

const BARE_DESIGN_APPROVAL_RE =
  /^\s*(?:approve|approved|looks?\s+good|use\s+option\s+[A-Za-z0-9]+)\s*\.?\s*$/i

/**
 * Negation, prohibition, delay, conditionals, or conflicting intent that must
 * never be treated as affirmative implementation authorization.
 */
const NON_AFFIRMATIVE_INTENT_RE =
  /\b(?:do\s+not|don'?t|does\s+not|doesn'?t|never|not\s+(?:authorized|ready|now)|later|unless)\b/i

export type FounderAuthorizationOptions = {
  scopedImplementationDecision?: boolean
}

export type FounderAuthorizationResult = {
  kind: 'ambiguous' | 'implementation' | 'scoped_implementation' | 'design_only'
  authorizesImplementation: boolean
  remainInBrainstorming: boolean
  failClosed: boolean
}

export type BrainstormingTransitionInput = {
  inBrainstorming?: boolean
  responseBody?: string
  founderReply?: string
  scopedImplementationDecision?: boolean
}

export type BrainstormingTransitionResult = {
  mode: 'normal' | 'implementation' | 'brainstorming'
  remainInBrainstorming: boolean
  authorizesImplementation: boolean
  failClosed: boolean
  useNormalMissionControlTemplate: boolean
}

export type BrainstormingManagedState = Record<string, unknown> | null | undefined

export type BrainstormingStateMutationGuardResult = {
  mutatesState: false
  state: Record<string, unknown> | null
  countersUnchanged?: true
  reason?: 'brainstorming profile is formatting-only'
}

function hasNonAffirmativeIntent(reply: string = ''): boolean {
  return NON_AFFIRMATIVE_INTENT_RE.test(reply)
}

export function isBrainstormingProfileResponse(body: string = ''): boolean {
  return BRAINSTORMING_PROFILE_HEADING_RE.test(body)
}

export function hasRoleTransportHeading(body: string = ''): boolean {
  return ROLE_TRANSPORT_HEADING_RE.test(body)
}

export function parseBrainstormingProfileBody(body: string = ''): {
  profile: string | null
  body: string
  violatesContract: boolean
} {
  if (!isBrainstormingProfileResponse(body)) {
    return { profile: null, body, violatesContract: hasRoleTransportHeading(body) }
  }

  return {
    profile: body.match(BRAINSTORMING_PROFILE_HEADING_RE)?.[1]?.replace(/\s+/g, ' ') ?? null,
    body,
    violatesContract: hasRoleTransportHeading(body),
  }
}

export function classifyFounderAuthorizationReply(
  reply: string = '',
  options: FounderAuthorizationOptions = {},
): FounderAuthorizationResult {
  const normalized = reply.trim()
  if (!normalized) {
    return {
      kind: 'ambiguous',
      authorizesImplementation: false,
      remainInBrainstorming: true,
      failClosed: true,
    }
  }

  const nonAffirmative = hasNonAffirmativeIntent(normalized)

  if (EXPLICIT_IMPLEMENTATION_AUTH_RE.test(normalized)) {
    if (nonAffirmative) {
      return {
        kind: 'ambiguous',
        authorizesImplementation: false,
        remainInBrainstorming: true,
        failClosed: true,
      }
    }

    return {
      kind: 'implementation',
      authorizesImplementation: true,
      remainInBrainstorming: false,
      failClosed: false,
    }
  }

  if (
    options.scopedImplementationDecision === true &&
    BARE_DESIGN_APPROVAL_RE.test(normalized) &&
    !nonAffirmative
  ) {
    return {
      kind: 'scoped_implementation',
      authorizesImplementation: true,
      remainInBrainstorming: false,
      failClosed: false,
    }
  }

  if (BARE_DESIGN_APPROVAL_RE.test(normalized)) {
    return {
      kind: 'design_only',
      authorizesImplementation: false,
      remainInBrainstorming: true,
      failClosed: false,
    }
  }

  return {
    kind: 'ambiguous',
    authorizesImplementation: false,
    remainInBrainstorming: true,
    failClosed: true,
  }
}

export function evaluateBrainstormingTransition(
  input: BrainstormingTransitionInput = {},
): BrainstormingTransitionResult {
  const inBrainstorming = input.inBrainstorming === true
  const responseBody = input.responseBody ?? ''
  const founderReply = input.founderReply ?? ''

  if (!inBrainstorming && !isBrainstormingProfileResponse(responseBody)) {
    return {
      mode: 'normal',
      remainInBrainstorming: false,
      authorizesImplementation: false,
      failClosed: false,
      useNormalMissionControlTemplate: true,
    }
  }

  if (isBrainstormingProfileResponse(responseBody)) {
    const authorization = classifyFounderAuthorizationReply(founderReply, {
      scopedImplementationDecision: input.scopedImplementationDecision,
    })

    if (authorization.authorizesImplementation) {
      return {
        mode: 'implementation',
        remainInBrainstorming: false,
        authorizesImplementation: true,
        failClosed: false,
        useNormalMissionControlTemplate: true,
      }
    }

    return {
      mode: 'brainstorming',
      remainInBrainstorming: true,
      authorizesImplementation: false,
      failClosed: authorization.failClosed,
      useNormalMissionControlTemplate: false,
    }
  }

  const authorization = classifyFounderAuthorizationReply(founderReply, {
    scopedImplementationDecision: input.scopedImplementationDecision,
  })

  if (authorization.authorizesImplementation) {
    return {
      mode: 'implementation',
      remainInBrainstorming: false,
      authorizesImplementation: true,
      failClosed: false,
      useNormalMissionControlTemplate: true,
    }
  }

  return {
    mode: inBrainstorming ? 'brainstorming' : 'normal',
    remainInBrainstorming: inBrainstorming || authorization.remainInBrainstorming,
    authorizesImplementation: false,
    failClosed: inBrainstorming && authorization.failClosed,
    useNormalMissionControlTemplate: !inBrainstorming,
  }
}

/**
 * Brainstorming responses must never mutate managed state or review counters.
 */
export function guardBrainstormingStateMutation(
  managedState: BrainstormingManagedState,
  responseBody: string = '',
): BrainstormingStateMutationGuardResult {
  if (!isBrainstormingProfileResponse(responseBody)) {
    return { mutatesState: false, state: managedState ?? null }
  }

  return {
    mutatesState: false,
    state: managedState ?? null,
    countersUnchanged: true,
    reason: 'brainstorming profile is formatting-only',
  }
}
