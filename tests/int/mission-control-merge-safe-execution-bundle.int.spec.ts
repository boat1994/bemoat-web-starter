import { describe, expect, it } from 'vitest'

import * as facade from '../../scripts/mission-control/domain/merge-safe-execution-bundle.mjs'
import {
  SAFE_EXECUTION_BUNDLES,
  SAFE_EXECUTION_BUNDLE_SCOPES,
  validateSafeExecutionBundle,
} from '../../scripts/mission-control/domain/merge-safe-execution-bundle.ts'

const canonicalBundles = {
  'authorization-execution': {
    scope: 'authorization-execution',
    steps: [
      'record-founder-authorization',
      'execute-authorized-action',
      'project-task-state',
    ],
  },
  'task-initialization': {
    scope: 'task-initialization',
    steps: [
      'create-task-issue',
      'initialize-planning-state',
      'project-campaign',
    ],
  },
  delivery: {
    scope: 'delivery',
    steps: [
      'deliver-implementation',
      'verify-exact-head-ci',
      'post-result',
      'project-awaiting-review',
    ],
  },
  'merge-completion': {
    scope: 'merge',
    steps: [
      'verify-founder-merge-authority',
      'verify-exact-reviewed-head-and-ci',
      'merge-exact-reviewed-head',
      'verify-protected-base-merge-commit',
      'post-final-result',
      'close-task-issue',
      'write-task-done',
      'project-campaign-slice-done',
      'select-next-campaign-action',
    ],
  },
} as const

describe('canonical safe execution bundles', () => {
  it('exports the exact canonical kinds, scopes, and frozen step arrays', () => {
    expect(Object.keys(SAFE_EXECUTION_BUNDLES)).toEqual([
      'authorization-execution',
      'task-initialization',
      'delivery',
      'merge-completion',
    ])
    expect(SAFE_EXECUTION_BUNDLE_SCOPES).toEqual({
      'authorization-execution': 'authorization-execution',
      'task-initialization': 'task-initialization',
      delivery: 'delivery',
      'merge-completion': 'merge',
    })
    expect(Object.isFrozen(SAFE_EXECUTION_BUNDLES)).toBe(true)
    expect(Object.isFrozen(SAFE_EXECUTION_BUNDLE_SCOPES)).toBe(true)

    for (const [kind, expected] of Object.entries(canonicalBundles)) {
      expect(SAFE_EXECUTION_BUNDLES[kind as keyof typeof SAFE_EXECUTION_BUNDLES]).toEqual(expected.steps)
      expect(SAFE_EXECUTION_BUNDLES[kind as keyof typeof SAFE_EXECUTION_BUNDLES]).toHaveLength(expected.steps.length)
      expect(Object.isFrozen(SAFE_EXECUTION_BUNDLES[kind as keyof typeof SAFE_EXECUTION_BUNDLES])).toBe(true)
    }
  })

  it('keeps the mjs facade export identity exact', () => {
    expect(facade.SAFE_EXECUTION_BUNDLES).toBe(SAFE_EXECUTION_BUNDLES)
    expect(facade.SAFE_EXECUTION_BUNDLE_SCOPES).toBe(SAFE_EXECUTION_BUNDLE_SCOPES)
    expect(facade.validateSafeExecutionBundle).toBe(validateSafeExecutionBundle)
  })

  it.each(Object.entries(canonicalBundles))('accepts the complete canonical %s bundle', (kind, expected) => {
    const result = validateSafeExecutionBundle({
      kind,
      authority_scope: expected.scope,
      terminal_outcome: 'deterministic projection',
      steps: [...expected.steps],
    })

    expect(result).toEqual({ valid: true, kind, authority_scope: expected.scope })
  })

  it('accepts unknown object keys without changing the exact result shape', () => {
    expect(validateSafeExecutionBundle({
      kind: 'delivery',
      authority_scope: 'delivery',
      terminal_outcome: 'done',
      steps: [...SAFE_EXECUTION_BUNDLES.delivery],
      unknown_key: 'ignored',
    })).toEqual({ valid: true, kind: 'delivery', authority_scope: 'delivery' })
  })

  it.each([
    [undefined, 'safe execution bundle kind is not allowed'],
    [null, 'safe execution bundle must be a mapping'],
    [[], 'safe execution bundle must be a mapping'],
    ['delivery', 'safe execution bundle must be a mapping'],
    [42, 'safe execution bundle must be a mapping'],
    [true, 'safe execution bundle must be a mapping'],
    [{}, 'safe execution bundle kind is not allowed'],
    [{ kind: 'unknown' }, 'safe execution bundle kind is not allowed'],
  ])('rejects malformed/default input %j with the exact reason', (bundle, reason) => {
    expect(validateSafeExecutionBundle(bundle)).toEqual({ valid: false, reason })
  })

  it('requires a non-empty terminal outcome but accepts whitespace-only strings', () => {
    const base = {
      kind: 'delivery',
      authority_scope: 'delivery',
      steps: [...SAFE_EXECUTION_BUNDLES.delivery],
    }
    expect(validateSafeExecutionBundle({ ...base, terminal_outcome: '' })).toEqual({
      valid: false,
      reason: 'safe execution bundle requires one terminal durable outcome',
    })
    expect(validateSafeExecutionBundle({ ...base, terminal_outcome: '   ' })).toEqual({
      valid: true,
      kind: 'delivery',
      authority_scope: 'delivery',
    })
  })

  it('reports exact scope and step failures', () => {
    const base = {
      kind: 'delivery',
      authority_scope: 'delivery',
      terminal_outcome: 'done',
      steps: [...SAFE_EXECUTION_BUNDLES.delivery],
    }
    expect(validateSafeExecutionBundle({ ...base, authority_scope: 'merge' })).toEqual({
      valid: false,
      reason: 'safe execution bundle authority scope must be exactly delivery',
    })
    expect(validateSafeExecutionBundle({ ...base, steps: ['deliver-implementation'] })).toEqual({
      valid: false,
      reason: 'safe execution bundle steps are prohibited or cross an independent gate; use one canonical bundle shape',
    })
  })

  it('rejects a constructor-shaped bundle identically through the legacy facade and typed implementation', () => {
    const malformedConstructorBundle: Record<string, unknown> = {
      kind: 'constructor',
      authority_scope: Object,
      terminal_outcome: 'done',
      steps: [undefined],
    }

    const legacyResult = facade.validateSafeExecutionBundle(malformedConstructorBundle)
    const typedResult = validateSafeExecutionBundle(malformedConstructorBundle)

    expect(legacyResult).toEqual({
      valid: false,
      reason: 'safe execution bundle steps are prohibited or cross an independent gate; use one canonical bundle shape',
    })
    expect(typedResult).toEqual(legacyResult)
  })

  it('does not mutate the input or canonical constants', () => {
    const input = {
      kind: 'merge-completion',
      authority_scope: 'merge',
      terminal_outcome: 'done',
      steps: [...SAFE_EXECUTION_BUNDLES['merge-completion']],
      unknown_key: { preserved: true },
    }
    const before = structuredClone(input)
    const constantsBefore = structuredClone(SAFE_EXECUTION_BUNDLES)

    expect(validateSafeExecutionBundle(input)).toEqual({
      valid: true,
      kind: 'merge-completion',
      authority_scope: 'merge',
    })
    expect(input).toEqual(before)
    expect(SAFE_EXECUTION_BUNDLES).toEqual(constantsBefore)
  })
})
