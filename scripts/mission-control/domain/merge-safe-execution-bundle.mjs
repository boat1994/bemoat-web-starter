export const SAFE_EXECUTION_BUNDLES = Object.freeze({
  'authorization-execution': Object.freeze([
    'record-founder-authorization',
    'execute-authorized-action',
    'project-task-state',
  ]),
  'task-initialization': Object.freeze([
    'create-task-issue',
    'initialize-planning-state',
    'project-campaign',
  ]),
  delivery: Object.freeze([
    'deliver-implementation',
    'verify-exact-head-ci',
    'post-result',
    'project-awaiting-review',
  ]),
  'merge-completion': Object.freeze([
    'verify-founder-merge-authority',
    'verify-exact-reviewed-head-and-ci',
    'merge-exact-reviewed-head',
    'verify-protected-base-merge-commit',
    'post-final-result',
    'close-task-issue',
    'write-task-done',
    'project-campaign-slice-done',
    'select-next-campaign-action',
  ]),
})

export const SAFE_EXECUTION_BUNDLE_SCOPES = Object.freeze({
  'authorization-execution': 'authorization-execution',
  'task-initialization': 'task-initialization',
  delivery: 'delivery',
  'merge-completion': 'merge',
})

function sameArray(left, right) {
  return Array.isArray(left) && Array.isArray(right) &&
    left.length === right.length && left.every((value, index) => value === right[index])
}

export function validateSafeExecutionBundle(bundle = {}) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    return { valid: false, reason: 'safe execution bundle must be a mapping' }
  }
  const expectedSteps = SAFE_EXECUTION_BUNDLES[bundle.kind]
  if (!expectedSteps) return { valid: false, reason: 'safe execution bundle kind is not allowed' }
  const expectedScope = SAFE_EXECUTION_BUNDLE_SCOPES[bundle.kind]
  if (bundle.authority_scope !== expectedScope) {
    return { valid: false, reason: `safe execution bundle authority scope must be exactly ${expectedScope}` }
  }
  if (typeof bundle.terminal_outcome !== 'string' || bundle.terminal_outcome.length === 0) {
    return { valid: false, reason: 'safe execution bundle requires one terminal durable outcome' }
  }
  if (!sameArray(bundle.steps, expectedSteps)) {
    return {
      valid: false,
      reason: 'safe execution bundle steps are prohibited or cross an independent gate; use one canonical bundle shape',
    }
  }
  return { valid: true, kind: bundle.kind, authority_scope: bundle.authority_scope }
}
