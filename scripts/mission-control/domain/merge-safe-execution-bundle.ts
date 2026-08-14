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

type SafeExecutionBundle = Record<string, unknown>

function sameArray(left: unknown, right: readonly string[]): boolean {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => value === right[index])
}

export function validateSafeExecutionBundle(bundle: unknown = {}):
  | { valid: true; kind: string; authority_scope: string; reason?: never }
  | { valid: false; reason: string } {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    return { valid: false, reason: 'safe execution bundle must be a mapping' }
  }

  const mapping = bundle as SafeExecutionBundle
  const expectedSteps = SAFE_EXECUTION_BUNDLES[mapping.kind as keyof typeof SAFE_EXECUTION_BUNDLES]
  if (!expectedSteps) return { valid: false, reason: 'safe execution bundle kind is not allowed' }

  const expectedScope = SAFE_EXECUTION_BUNDLE_SCOPES[mapping.kind as keyof typeof SAFE_EXECUTION_BUNDLE_SCOPES]
  if (mapping.authority_scope !== expectedScope) {
    return { valid: false, reason: `safe execution bundle authority scope must be exactly ${expectedScope}` }
  }
  if (typeof mapping.terminal_outcome !== 'string' || mapping.terminal_outcome.length === 0) {
    return { valid: false, reason: 'safe execution bundle requires one terminal durable outcome' }
  }
  if (!sameArray(mapping.steps, expectedSteps)) {
    return {
      valid: false,
      reason: 'safe execution bundle steps are prohibited or cross an independent gate; use one canonical bundle shape',
    }
  }
  return { valid: true, kind: mapping.kind as string, authority_scope: mapping.authority_scope as string }
}
