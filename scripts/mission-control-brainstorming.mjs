/**
 * Brainstorming Response Profile contract helpers.
 *
 * Formatting/routing only — no durable state, role-comment type, counter
 * mutation, or implicit implementation authority.
 */

export const BRAINSTORMING_PROFILE_HEADINGS = ['BRAINSTORMING', 'DESIGN RESULT']

const BRAINSTORMING_PROFILE_HEADING_RE = /^##\s+(BRAINSTORMING|DESIGN\s+RESULT)\s*$/m

const ROLE_TRANSPORT_HEADING_RE = /^##\s+(HANDOFF|RESULT|REVIEW_VERDICT)\s*$/m

const EXPLICIT_IMPLEMENTATION_AUTH_RE =
  /\b(?:implement\s+this|start\s+dev|create\s+the\s+implementation\s+HANDOFF)\b/i

const BARE_DESIGN_APPROVAL_RE =
  /^\s*(?:approve|approved|looks?\s+good|use\s+option\s+[A-Za-z0-9]+)\s*\.?\s*$/i

/**
 * @param {string} body
 */
export function isBrainstormingProfileResponse(body = '') {
  return BRAINSTORMING_PROFILE_HEADING_RE.test(body)
}

/**
 * @param {string} body
 */
export function hasRoleTransportHeading(body = '') {
  return ROLE_TRANSPORT_HEADING_RE.test(body)
}

/**
 * @param {string} body
 */
export function parseBrainstormingProfileBody(body = '') {
  if (!isBrainstormingProfileResponse(body)) {
    return { profile: null, body, violatesContract: hasRoleTransportHeading(body) }
  }

  return {
    profile: body.match(BRAINSTORMING_PROFILE_HEADING_RE)?.[1]?.replace(/\s+/g, ' ') ?? null,
    body,
    violatesContract: hasRoleTransportHeading(body),
  }
}

/**
 * @param {string} reply
 * @param {{ scopedImplementationDecision?: boolean }} [options]
 */
export function classifyFounderAuthorizationReply(reply = '', options = {}) {
  const normalized = reply.trim()
  if (!normalized) {
    return {
      kind: 'ambiguous',
      authorizesImplementation: false,
      remainInBrainstorming: true,
      failClosed: true,
    }
  }

  if (EXPLICIT_IMPLEMENTATION_AUTH_RE.test(normalized)) {
    return {
      kind: 'implementation',
      authorizesImplementation: true,
      remainInBrainstorming: false,
      failClosed: false,
    }
  }

  if (options.scopedImplementationDecision === true && BARE_DESIGN_APPROVAL_RE.test(normalized)) {
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

/**
 * @param {{
 *   inBrainstorming?: boolean,
 *   responseBody?: string,
 *   founderReply?: string,
 *   scopedImplementationDecision?: boolean,
 * }} input
 */
export function evaluateBrainstormingTransition(input = {}) {
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
 *
 * @param {Record<string, unknown> | null | undefined} managedState
 * @param {string} responseBody
 */
export function guardBrainstormingStateMutation(managedState, responseBody = '') {
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
