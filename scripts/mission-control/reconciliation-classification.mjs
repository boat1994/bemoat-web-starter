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

/**
 * Exhaustive, ordered reconciliation classification. Only contradictory live
 * authority is a conflict; schema and bookkeeping lag remain repairable.
 */
export function classifyReconciliation(evidence = {}) {
  if (evidence.classification) return evidence.classification
  if (evidence.requiredEvidenceUnavailable) {
    return { outcome: 'BLOCKED_EXTERNAL', reason: 'required live evidence is unavailable' }
  }
  if (
    evidence.authoritativeContradiction ||
    evidence.competingPrs ||
    evidence.headMismatch ||
    evidence.staleCi
  ) {
    return { outcome: 'STATE_CONFLICT', reason: 'authoritative live evidence contradicts' }
  }

  const terminal = evidence.terminal ?? {}
  if (
    terminal.prMerged && !terminal.issueClosed &&
    terminal.reviewedHeadMatches && terminal.currentHeadMatches &&
    typeof terminal.mergeCommit === 'string' && terminal.mergeCommit.length > 0 &&
    terminal.exactHeadCi === true
  ) {
    return {
      outcome: 'STATE_CONFLICT',
      reason: 'merged PR is verified but the managed Issue remains open; merge transport must close the Issue before terminal reconciliation',
    }
  }
  if (terminal.prMerged && (
    !terminal.issueClosed ||
    !terminal.reviewedHeadMatches ||
    !terminal.currentHeadMatches ||
    typeof terminal.mergeCommit !== 'string' || terminal.mergeCommit.length === 0 ||
    terminal.exactHeadCi !== true
  )) {
    return { outcome: 'STATE_CONFLICT', reason: 'terminal evidence is incomplete or does not bind the reviewed head' }
  }
  if (terminal.issueClosed && terminal.prMerged && terminal.reviewedHeadMatches && terminal.currentHeadMatches && terminal.mergeCommit && terminal.exactHeadCi) {
    if (evidence.managedState?.state === 'DONE') {
      return { outcome: 'NO_OP', reason: 'terminal evidence already recorded' }
    }
    return { outcome: 'TERMINAL_REPAIR', reason: 'terminal bookkeeping lags live merge evidence' }
  }

  if (evidence.bookkeepingProposal) {
    const proposed = { ...(evidence.managedState ?? {}), ...evidence.bookkeepingProposal }
    if (sameValue(proposed, evidence.managedState ?? {})) {
      return { outcome: 'NO_OP', reason: 'bookkeeping evidence is already recorded' }
    }
    return { outcome: 'BOOKKEEPING_REPAIR', reason: 'unambiguous live evidence is ahead of bookkeeping' }
  }
  return { outcome: 'NO_OP', reason: 'no authoritative evidence changed' }
}

export function proposedRepair(evidence, classification) {
  if (evidence.proposedState) {
    // Bookkeeping deltas must merge onto the live managed state so additive
    // fields (for example planning_authorization_base_sha) are preserved.
    return {
      ...structuredClone(evidence.managedState ?? {}),
      ...structuredClone(evidence.proposedState),
    }
  }
  const managedState = structuredClone(evidence.managedState ?? {})
  if (classification.outcome === 'TERMINAL_REPAIR') {
    return {
      ...managedState,
      state: 'DONE',
      merged_commit_sha: evidence.terminal?.mergeCommit ?? managedState.merged_commit_sha ?? null,
      open_blockers: [],
      next_permitted_action: 'none on this task',
    }
  }
  if (classification.outcome === 'BOOKKEEPING_REPAIR') {
    return { ...managedState, ...evidence.bookkeepingProposal }
  }
  return managedState
}
