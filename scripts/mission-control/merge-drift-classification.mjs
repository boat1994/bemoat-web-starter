import { normalizeAuthorityHead } from './review-verdict-binding.mjs'

export function classifyMergeDrift(authorizedHead, liveHead) {
  if (!authorizedHead || !liveHead) {
    return { drift: true, reason: 'missing authorized or live head for merge transition' }
  }
  if (normalizeAuthorityHead(authorizedHead) !== normalizeAuthorityHead(liveHead)) {
    return { drift: true, reason: 'authorized merge head does not match live PR head' }
  }
  return { drift: false, reason: null }
}
