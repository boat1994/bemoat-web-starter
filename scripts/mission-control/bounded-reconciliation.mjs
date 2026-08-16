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

/**
 * Run at most one deterministic repair and one live verification. A second
 * repair is never attempted in the same run.
 */
export async function runBoundedReconciliation({ readEvidence, writeState }) {
  const measurements = {
    coordination_runs: 1,
    state_writes: 0,
    role_comments: 0,
    model_required_stages: 0,
    reconciliation_attempts: 0,
    false_state_conflicts: 0,
  }

  const initialEvidence = await readEvidence()
  measurements.reconciliation_attempts += 1
  const initial = classifyReconciliation(initialEvidence)
  if (!new Set(['BOOKKEEPING_REPAIR', 'TERMINAL_REPAIR']).has(initial.outcome)) {
    return {
      ...initial,
      finalOutcome: initial.outcome,
      finalReason: initial.reason,
      measurements,
    }
  }

  let proposed
  try {
    proposed = proposedRepair(initialEvidence, initial)
  } catch (error) {
    return {
      ...initial,
      finalOutcome: 'STATE_CONFLICT',
      finalReason: error instanceof Error ? error.message : String(error),
      measurements,
    }
  }
  const written = await writeState(proposed, initialEvidence.managedState)
  if (!sameValue(written, proposed)) {
    throw new Error('durable reconciliation write was not confirmed')
  }
  measurements.state_writes += 1

  const verifiedEvidence = await readEvidence()
  measurements.reconciliation_attempts += 1
  const verified = classifyReconciliation(verifiedEvidence)
  const verificationStillRequestsRepair = new Set([
    'BOOKKEEPING_REPAIR',
    'TERMINAL_REPAIR',
  ]).has(verified.outcome)
  return {
    ...initial,
    finalOutcome: verificationStillRequestsRepair ? 'STATE_CONFLICT' : verified.outcome,
    finalReason: verificationStillRequestsRepair
      ? 'bounded repair was not confirmed by the single verification'
      : verified.reason,
    measurements,
  }
}

export function reconciliationFailureReason(result = {}) {
  return result.finalReason ?? result.reason ?? 'Mission Control reconciliation failed without a diagnostic'
}
