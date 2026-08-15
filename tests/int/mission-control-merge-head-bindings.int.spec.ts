import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const STARTER_REPOSITORY = 'boat1994/bemoat-web-starter'
const OTHER_REPOSITORY = 'boat1994/other-project'
const HEAD = 'a'.repeat(40)
const GUIDE_SHA = 'b'.repeat(40)
const PROTECTED_BASE_SHA = 'c'.repeat(40)

type Inputs = {
  state?: Record<string, unknown> | null
  pr?: Record<string, unknown> | null
  authorization?: Record<string, unknown> | null
  repo?: unknown
}

function validInputs(repo = STARTER_REPOSITORY): Required<Inputs> {
  return {
    state: {
      approved_base: 'main',
      current_head: HEAD,
      last_reviewed_head: HEAD,
      guide_source_sha: GUIDE_SHA,
    },
    pr: {
      baseRefName: 'main',
      baseRefOid: PROTECTED_BASE_SHA,
      headRefOid: HEAD,
      statusCheckRollup: [
        { name: 'ci', conclusion: 'SUCCESS' },
        { name: 'starter-ci', state: 'SUCCESS' },
      ],
    },
    authorization: {
      policy_source_sha: GUIDE_SHA,
      protected_base_sha: PROTECTED_BASE_SHA,
      reviewed_head: HEAD,
    },
    repo,
  }
}

function invoke(fn: () => unknown) {
  try {
    return {
      kind: 'return' as const,
      value: fn(),
    }
  } catch (error) {
    return {
      kind: 'throw' as const,
      value: {
        name: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

describe('Mission Control merge head bindings', () => {
  it('preserves every rejection gate, first-failure reason, and success shape', async () => {
    const typed = await import('../../scripts/mission-control/domain/merge-head-bindings.ts')
    const cases: Array<{ name: string; input: Inputs; reason: string }> = [
      {
        name: 'managed base mismatch',
        input: { ...validInputs(), pr: { ...validInputs().pr, baseRefName: 'dev' } },
        reason: 'live PR base differs from the managed protected base',
      },
      {
        name: 'strict current, reviewed, and live head mismatch',
        input: { ...validInputs(), state: { ...validInputs().state, current_head: 'd'.repeat(40) } },
        reason: 'current, reviewed, and live PR heads must match exactly',
      },
      {
        name: 'missing reviewed head',
        input: { ...validInputs(), state: { ...validInputs().state, last_reviewed_head: undefined } },
        reason: 'current, reviewed, and live PR heads must match exactly',
      },
      {
        name: 'live PR head mismatch',
        input: { ...validInputs(), pr: { ...validInputs().pr, headRefOid: 'd'.repeat(40) } },
        reason: 'current, reviewed, and live PR heads must match exactly',
      },
      {
        name: 'malformed guide policy SHA',
        input: { ...validInputs(), state: { ...validInputs().state, guide_source_sha: 'not-a-sha' } },
        reason: 'merged policy source SHA does not match the managed policy evidence',
      },
      {
        name: 'strict guide policy SHA mismatch',
        input: { ...validInputs(), authorization: { ...validInputs().authorization, policy_source_sha: GUIDE_SHA.toUpperCase() } },
        reason: 'merged policy source SHA does not match the managed policy evidence',
      },
      {
        name: 'malformed protected base SHA',
        input: { ...validInputs(), pr: { ...validInputs().pr, baseRefOid: 'short' } },
        reason: 'protected base commit SHA does not match the live PR base evidence',
      },
      {
        name: 'null optional protected base SHA',
        input: { ...validInputs(), pr: { ...validInputs().pr, baseRefOid: null } },
        reason: 'protected base commit SHA does not match the live PR base evidence',
      },
      {
        name: 'strict protected base SHA mismatch',
        input: { ...validInputs(), authorization: { ...validInputs().authorization, protected_base_sha: PROTECTED_BASE_SHA.toUpperCase() } },
        reason: 'protected base commit SHA does not match the live PR base evidence',
      },
      {
        name: 'Founder reviewed-head mismatch',
        input: { ...validInputs(), authorization: { ...validInputs().authorization, reviewed_head: 'd'.repeat(40) } },
        reason: 'Founder authorization reviewed head differs from managed/live head',
      },
      {
        name: 'unverified exact-head CI',
        input: { ...validInputs(), pr: { ...validInputs().pr, statusCheckRollup: [] } },
        reason: 'required exact-head CI is not successful: No CI checks reported for the active PR.',
      },
      {
        name: 'missing required starter check',
        input: { ...validInputs(), pr: { ...validInputs().pr, statusCheckRollup: [{ name: 'ci', conclusion: 'SUCCESS' }] } },
        reason: 'required exact-head CI checks are missing or unsuccessful: starter-ci',
      },
      {
        name: 'missing required check for another repository',
        input: { ...validInputs(OTHER_REPOSITORY), pr: { ...validInputs().pr, statusCheckRollup: [{ name: 'starter-ci', conclusion: 'SUCCESS' }] } },
        reason: 'required exact-head CI checks are missing or unsuccessful: ci',
      },
    ]

    for (const testCase of cases) {
      const typedResult = invoke(() =>
        typed.classifyHeadBindings(
          testCase.input.state,
          testCase.input.pr,
          testCase.input.authorization,
          testCase.input.repo,
        ),
      )
      expect(typedResult, testCase.name).toEqual({
        kind: 'return',
        value: { valid: false, reviewedHead: testCase.input.state?.last_reviewed_head, reason: testCase.reason },
      })
    }

    for (const repo of [STARTER_REPOSITORY, OTHER_REPOSITORY]) {
      const input = validInputs(repo)
      const typedResult = invoke(() => typed.classifyHeadBindings(input.state, input.pr, input.authorization, input.repo))
      expect(typedResult).toEqual({ kind: 'return', value: { valid: true, reviewedHead: HEAD, reason: null } })
    }
  })

  it('preserves optional, null, default, and native TypeError behavior', async () => {
    const typed = await import('../../scripts/mission-control/domain/merge-head-bindings.ts')
    const missingState: Inputs = { ...validInputs(), state: undefined }
    const nullState: Inputs = { ...validInputs(), state: null }
    const missingAuthorization: Inputs = { ...validInputs(), authorization: undefined }
    const nullAuthorization: Inputs = { ...validInputs(), authorization: null }
    const missingPr: Inputs = { ...validInputs(), pr: undefined }
    const nullPr: Inputs = { ...validInputs(), pr: null }

    expect(invoke(() => typed.classifyHeadBindings(missingState.state, missingState.pr, missingState.authorization, missingState.repo))).toEqual({
      kind: 'return',
      value: { valid: false, reviewedHead: undefined, reason: 'live PR base differs from the managed protected base' },
    })
    expect(invoke(() => typed.classifyHeadBindings(nullState.state, nullState.pr, nullState.authorization, nullState.repo))).toEqual({
      kind: 'return',
      value: { valid: false, reviewedHead: undefined, reason: 'live PR base differs from the managed protected base' },
    })
    const missingRepo: Inputs = { ...validInputs(), repo: undefined }
    expect(invoke(() => typed.classifyHeadBindings(missingRepo.state, missingRepo.pr, missingRepo.authorization, missingRepo.repo))).toEqual({
      kind: 'return',
      value: { valid: true, reviewedHead: HEAD, reason: null },
    })

    for (const input of [missingAuthorization, nullAuthorization, missingPr, nullPr]) {
      expect(invoke(() => typed.classifyHeadBindings(input.state, input.pr, input.authorization, input.repo))).toMatchObject({
        kind: 'throw',
        value: { name: 'TypeError' },
      })
    }
  })

  it('preserves strict evidence comparisons, getter errors, frozen inputs, and no mutation', async () => {
    const typed = await import('../../scripts/mission-control/domain/merge-head-bindings.ts')
    const input = validInputs()
    const snapshot = structuredClone(input)
    deepFreeze(input)
    expect(invoke(() => typed.classifyHeadBindings(input.state, input.pr, input.authorization, input.repo))).toEqual({
      kind: 'return',
      value: { valid: true, reviewedHead: HEAD, reason: null },
    })
    expect(input).toEqual(snapshot)

    const getterError = new Error('native getter failure')
    const getterInput = validInputs()
    Object.defineProperty(getterInput.pr, 'baseRefName', {
      configurable: true,
      get() {
        throw getterError
      },
    })
    expect(invoke(() => typed.classifyHeadBindings(getterInput.state, getterInput.pr, getterInput.authorization, getterInput.repo))).toEqual({
      kind: 'throw',
      value: { name: 'Error', message: 'native getter failure' },
    })
  })

  it('keeps the TypeScript implementation, named exports, and consumer wiring aligned after facade removal', async () => {
    const typed = await import('../../scripts/mission-control/domain/merge-head-bindings.ts')

    expect(existsSync('scripts/mission-control/domain/merge-head-bindings.mjs')).toBe(false)
    expect(Object.keys(typed)).toEqual(['classifyHeadBindings'])
    expect(readFileSync('scripts/mission-control/workflows/merge.mjs', 'utf8')).toContain(
      "import { classifyHeadBindings } from '../domain/merge-head-bindings.ts'",
    )
  })
})
