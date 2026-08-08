import { sameValue } from './transition-guards.mjs'

/**
 * Transactional READY -> IN_PROGRESS dispatch with compensating rollback.
 * The caller supplies durable Issue and role-comment operations so this logic
 * remains testable and transport-agnostic.
 */
export async function dispatchManagedTask({ readState, writeState, postHandoff, retractHandoff, handoffBody, transitionState }) {
  const original = await readState()
  if (original?.state !== 'READY') {
    throw new Error(`dispatch requires READY, received ${original?.state ?? 'missing state'}`)
  }
  if (!/^## (?:HANDOFF|AUTHORIZATION)\s*$/m.test(handoffBody ?? '')) {
    throw new Error('dispatch requires one HANDOFF or AUTHORIZATION role comment')
  }

  const defaultTransition = (state) => ({ ...structuredClone(state), state: 'IN_PROGRESS' })
  const dispatched = (transitionState ?? defaultTransition)(original)
  await writeState(dispatched)
  if (!sameValue(await readState(), dispatched)) {
    throw new Error('dispatch verification found a concurrent state change before HANDOFF')
  }
  let handoff = null
  try {
    handoff = await postHandoff(handoffBody)
  } catch (error) {
    const live = await readState()
    if (!sameValue(live, dispatched)) {
      throw new Error('dispatch failed and concurrent state change prevented rollback', { cause: error })
    }
    await writeState(original)
    throw new Error('dispatch rolled back after HANDOFF failure', { cause: error })
  }

  const verified = await readState()
  if (!sameValue(verified, dispatched)) {
    if (!retractHandoff || !handoff) {
      throw new Error('dispatch verification found a concurrent state change and cannot retract HANDOFF')
    }
    await retractHandoff(handoff)
    throw new Error('dispatch verification found a concurrent state change')
  }
  return { outcome: 'DISPATCHED', state: verified }
}
