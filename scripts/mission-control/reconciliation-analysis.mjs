import { parseCorrectionContract } from './domain/correction-contract.ts'
import { normalizeAuthorityHead } from './review-verdict-binding.mjs'
import { normalizeTransitionIdentity, serializeTransitionIdentity } from './transition-identity.mjs'
import {
  classifyDeliveryLag,
  classifyReviewLag,
  proposeDeliveryReconciliation,
  proposeReviewReconciliation,
} from './reconciliation-proposals.mjs'
import {
  classifyReconciliation,
  proposedRepair,
} from './reconciliation-classification.mjs'

function sameValue(left, right) {
  const canonicalize = (value) => {
    if (Array.isArray(value)) return value.map(canonicalize)
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
      )
    }
    return value
  }
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right))
}

export function isGenuineStateConflict(evidence = {}) {
  if (evidence.competingPrs) return true
  if (evidence.headMismatch) return true
  if (evidence.staleCi) return true
  if ((evidence.stateConflictBlockers ?? []).some((blocker) => blocker.includes('STATE_CONFLICT'))) {
    return true
  }
  return false
}

export function analyzeReconciliation(context) {
  const terminalEvidence = context.terminal ?? null
  const reviewLag = classifyReviewLag(context.managedState, context.livePr, context.latestVerdict, context.exactHeadCi)
  const genuineConflict = isGenuineStateConflict({
    stateConflictBlockers: context.stateConflictBlockers,
    headMismatch: Boolean(
      !terminalEvidence?.prMerged &&
      context.managedState?.current_head &&
        context.livePr?.headRefOid &&
        normalizeAuthorityHead(context.managedState.current_head) !== normalizeAuthorityHead(context.livePr.headRefOid),
    ),
    staleCi: context.exactHeadCi?.exactHeadVerified === false && context.exactHeadCi?.olderShaSuccess === true,
  }) || reviewLag.kind === 'STATE_CONFLICT'

  const deliveryLag = classifyDeliveryLag(
    context.managedState,
    context.livePr,
    context.exactHeadCi,
    context.latestResult,
  )
  let bookkeepingProposal = null
  let bookkeepingType = null
  if (deliveryLag.kind === 'DETERMINISTIC_RECONCILIATION' && context.livePr) {
    bookkeepingType = 'delivery'
    bookkeepingProposal = proposeDeliveryReconciliation({
      managedState: context.managedState,
      livePr: context.livePr,
      activeTaskIssue: context.activeTaskIssue,
      approvedBase: context.managedState?.approved_base,
      latestResult: context.latestResult,
    })
  } else if (reviewLag.kind === 'DETERMINISTIC_RECONCILIATION' && context.latestVerdict?.parsed?.verdict) {
    const isPostBudget = reviewLag.postBudget === true
    const verdictBody = context.latestVerdict.comment?.body ?? ''
    bookkeepingType = 'review'
    bookkeepingProposal = proposeReviewReconciliation({
      ...(isPostBudget
        ? {
            postBudget: true,
            managedState: context.managedState,
            prNumber: context.livePr?.number,
            base: context.latestVerdict.parsed.base,
            authorization: context.managedState?.founder_decision,
            verdictCommentId: context.latestVerdict.comment?.id,
            verdictUrl: context.latestVerdict.comment?.html_url ?? context.latestVerdict.comment?.url,
            transitionIdentity: serializeTransitionIdentity(
              normalizeTransitionIdentity(verdictBody, { role: 'REVIEW_VERDICT' }),
            ),
            findingDispositions: reviewLag.findingDispositions,
          }
        : {}),
      verdict: context.latestVerdict.parsed.verdict,
      reviewedHead: context.latestVerdict.parsed.headSha || context.livePr?.headRefOid,
      reviewCycle: context.managedState?.review_cycle ?? 0,
      fullReviewCount: context.managedState?.full_review_count ?? 0,
    })
  }

  const authoritativeContract = parseCorrectionContract(context.latestVerdict?.comment?.body ?? '')
  if (authoritativeContract.ok) {
    const expectedBlockers = authoritativeContract.contract.findings.map((finding) => finding.id)
    const durableBlockers = context.managedState?.open_blockers ?? []
    if (!sameValue(expectedBlockers, durableBlockers)) {
      bookkeepingType = bookkeepingType ?? 'review'
      bookkeepingProposal = {
        ...(bookkeepingProposal ?? {}),
        open_blockers: expectedBlockers,
      }
    }
  }

  const classification = classifyReconciliation({
    authoritativeContradiction: genuineConflict,
    requiredEvidenceUnavailable:
      context.requiredEvidenceUnavailable || reviewLag.kind === 'BLOCKED_EXTERNAL',
    managedState: context.managedState,
    terminal: terminalEvidence,
    bookkeepingProposal,
  })

  const result = {
    genuineConflict,
    classification,
    delivery: deliveryLag,
    review: reviewLag,
    proposal: null,
  }

  if (classification.outcome === 'STATE_CONFLICT' || classification.outcome === 'BLOCKED_EXTERNAL') {
    return result
  }

  if (classification.outcome === 'TERMINAL_REPAIR') {
    result.proposal = {
      type: 'terminal',
      fields: proposedRepair(context, classification),
    }
  } else if (classification.outcome === 'BOOKKEEPING_REPAIR' && bookkeepingType) {
    result.proposal = {
      type: bookkeepingType,
      fields: bookkeepingProposal,
    }
  }

  return result
}
