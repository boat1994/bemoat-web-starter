import { buildTransitionMatchOptions } from './transition-match-options.mjs'
import { authorizeCoordinatorTransition } from './transition-authorization.mjs'
import { coordinatorOwnedRoutingProjection } from './coordinator-projection.mjs'
import { assertCompatibleSnapshot, integrateHandoff, integrateResult, resumeProjection } from './coordinator-transitions.mjs'

/** Retained transition coordinator used by Context/Handoff. */
export class Coordinator {
  constructor(transports) {
    this.readState = transports.readState
    this.writeState = transports.writeState
    this.listComments = transports.listComments
    this.postComment = transports.postComment
    this.readIssueBody = transports.readIssueBody ?? null
    this.trustedAuthors = transports.trustedAuthors ?? null
    this.requireTrustedAuthor = transports.requireTrustedAuthor ?? false
    this.trustedAssociations = transports.trustedAssociations ?? null
    this.verifiedHead = transports.verifiedHead ?? null
    this.verifiedBase = transports.verifiedBase ?? null
  }

  authorizeTransition({ role = null, roleBody = '', comment = null, prior = {}, projected = null, policy: rawPolicy = {} } = {}) {
    return authorizeCoordinatorTransition({ role, roleBody, comment, prior, projected, policy: rawPolicy, verifiedHead: this.verifiedHead })
  }

  _matchOptions(roleBody, role) {
    return buildTransitionMatchOptions({ roleBody, role, trustedAuthors: this.trustedAuthors, requireTrustedAuthor: this.requireTrustedAuthor, trustedAssociations: this.trustedAssociations, verifiedHead: this.verifiedHead, verifiedBase: this.verifiedBase })
  }

  async _resolveComment(roleBody, role) {
    const { identity, options } = this._matchOptions(roleBody, role)
    const { resolveRoleComment } = await import('./comment-resolution.mjs')
    return resolveRoleComment({ roleBody, role, identity, options, listComments: this.listComments, postComment: this.postComment })
  }

  _coordinatorOwnedRouting(input) { return coordinatorOwnedRoutingProjection(input) }
  async integrateHandoff(input) { return integrateHandoff(this, input) }
  async integrateResult(input) { return integrateResult(this, input) }
  async resumeProjection(input) { return resumeProjection(this, input) }
  async assertCompatibleSnapshot(input) { return assertCompatibleSnapshot(this, input) }
}
