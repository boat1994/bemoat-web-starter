import { describe, expect, it } from 'vitest'

import {
  compareFileSystemSnapshots,
  runCliBoundaryCase,
} from '../helpers/cli-boundary-harness'
import { getCommandContract } from '../../scripts/cli/command-contract.mjs'
import {
  CliInvocationError,
  parseCommandInvocation,
  resolveCommandIdentity,
} from '../../scripts/cli/command-invocation.mjs'
import {
  createHelpEnvelopeV1,
  formatTextHelp,
} from '../../scripts/cli/command-help.mjs'
import {
  assertResultEnvelopeV1,
  classificationExitCode,
  createResultEnvelopeV1,
} from '../../scripts/cli/command-result.mjs'

type JsonRecord = Record<string, unknown>

const TIER_A_COMMAND = 'bemoat:issue:comment'
const TIER_B_COMMAND = 'bemoat:agent:issue'
const BRANCH_COMMAND = 'bemoat:branch:check'
const REOPEN_COMMAND = 'bemoat:mission-control:reopen'
const PACK_COMMAND = 'bemoat:guard:pack'
const SAFETY_COMMAND = 'bemoat:guard:safety'
const FULL_UPPERCASE_SHA = 'ABCDEF0123456789ABCDEF0123456789ABCDEF01'
const SECOND_FULL_UPPERCASE_SHA = '1234567890ABCDEF1234567890ABCDEF12345678'
const FULL_LOWERCASE_SHA = FULL_UPPERCASE_SHA.toLowerCase()
const SECOND_FULL_LOWERCASE_SHA = SECOND_FULL_UPPERCASE_SHA.toLowerCase()

const ISSUE_COMMENT_COMMAND = 'bemoat:issue:comment'

const HELP_KEYS = [
  'schema_version',
  'command',
  'mode',
  'classification',
  'tier',
  'purpose',
  'accepted_pre_states',
  'required_inputs',
  'optional_flags',
  'caller_supplied_values',
  'trusted_derived_values',
  'required_evidence',
  'reads',
  'writes',
  'stop_classifications',
  'retry_contract',
  'role_contracts',
  'result_classifications',
  'next_action_rules',
  'stop_conditions',
  'examples',
] as const

const RESULT_KEYS = [
  'schema_version',
  'command',
  'mode',
  'outcome',
  'classification',
  'mutation_performed',
  'observed_pre_state',
  'resulting_state',
  'repository',
  'issue_number',
  'pr_number',
  'exact_head',
  'evidence_ids',
  'next_action',
  'details',
] as const

const TIER_A_SECTIONS = [
  'NAME',
  'PURPOSE',
  'USAGE',
  'ACCEPTED PRE-STATE',
  'REQUIRED INPUTS',
  'OPTIONAL FLAGS',
  'AUTHORITY AND TRUST BOUNDARY',
  'READS',
  'WRITES',
  'RESULT CLASSIFICATIONS',
  'EXIT CODES',
  'RETRY CONTRACT',
  'NEXT ACTIONS',
  'STOP CONDITIONS',
  'EXAMPLES',
  'SAFE RECOVERY',
] as const

const TIER_B_SECTIONS = [
  'NAME',
  'PURPOSE',
  'USAGE',
  'PRECONDITIONS',
  'REQUIRED INPUTS',
  'OPTIONAL FLAGS',
  'READS',
  'WRITES',
  'RESULT CLASSIFICATIONS',
  'EXIT CODES',
  'RETRY CONTRACT',
  'NEXT ACTIONS',
  'STOP CONDITIONS',
  'EXAMPLES',
  'SAFE RECOVERY',
] as const

function commandContract(command: string) {
  const contract = getCommandContract(command)
  if (contract === null) throw new Error(`missing Task 1 contract: ${command}`)
  return contract
}

function reopenArguments({
  issueNumber = '284',
  repository = 'BOAT1994/BEMOAT-WEB-STARTER',
  expectedPr = '285',
  expectedBase = 'main',
  expectedOldHead = FULL_UPPERCASE_SHA,
  expectedNewHead = SECOND_FULL_UPPERCASE_SHA,
  reviewCycle = '9007199254740991',
  fullReviewCount = '1',
  authorizationComment = '12345',
}: {
  issueNumber?: string
  repository?: string
  expectedPr?: string
  expectedBase?: string
  expectedOldHead?: string
  expectedNewHead?: string
  reviewCycle?: string
  fullReviewCount?: string
  authorizationComment?: string
} = {}) {
  return [
    issueNumber,
    '--repo',
    repository,
    '--expected-pr',
    expectedPr,
    '--expected-base',
    expectedBase,
    '--expected-state',
    'ELIGIBLE_FOR_FOUNDER_REVIEW',
    '--expected-old-head',
    expectedOldHead,
    '--expected-new-head',
    expectedNewHead,
    '--expected-review-cycle',
    reviewCycle,
    '--expected-full-review-count',
    fullReviewCount,
    '--authorization-comment',
    authorizationComment,
  ]
}

function expectInvalidInvocation(command: string, argv: string[]) {
  let thrown: unknown

  try {
    parseCommandInvocation(command, argv)
  } catch (error) {
    thrown = error
  }

  expect(thrown).toBeInstanceOf(CliInvocationError)
  const invocationError = thrown as {
    classification: string
    exit_code: number
    details: { argument: string | null; reason: string }
  }
  expect(invocationError.classification).toBe('INVALID_INVOCATION')
  expect(invocationError.exit_code).toBe(2)
  expect(
    invocationError.details.argument === null ||
      typeof invocationError.details.argument === 'string',
  ).toBe(true)
  expect(typeof invocationError.details.reason).toBe('string')
}

function expectSectionsInOrder(help: string, sections: readonly string[]) {
  let previousIndex = -1

  for (const section of sections) {
    const index = help.indexOf(section)
    expect(index, `missing help section ${section}`).toBeGreaterThanOrEqual(0)
    expect(index, `${section} is out of order`).toBeGreaterThan(previousIndex)
    previousIndex = index
  }
}

function makeResultEnvelope() {
  return createResultEnvelopeV1({
    command: TIER_A_COMMAND,
    outcome: 'SUCCESS',
    classification: 'SUCCESS',
    mutation_performed: true,
    observed_pre_state: 'IN_PROGRESS',
    resulting_state: 'AWAITING_REVIEW_1',
    repository: 'boat1994/bemoat-web-starter',
    issue_number: '284',
    pr_number: '285',
    exact_head: FULL_LOWERCASE_SHA,
    evidence_ids: {
      result_comment: '12345',
      exact_head: FULL_LOWERCASE_SHA,
    },
    next_action: {
      type: 'FOUNDER_GATE',
      command: null,
      reason: 'The managed review writer is retired.',
    },
    details: {
      legacy_classification: 'DELIVERED',
      narrative: 'The RESULT was delivered.',
    },
  })
}

describe('Task 2 CLI invocation and result contracts', () => {
  it('publishes the correction RESULT evidence-map contract from the issue comment help', () => {
    const help = createHelpEnvelopeV1(getCommandContract(ISSUE_COMMENT_COMMAND)) as JsonRecord
    const roleContracts = help.role_contracts as JsonRecord
    const resultContract = roleContracts.RESULT as JsonRecord
    const evidenceMap = resultContract.correction_evidence_map as JsonRecord
    const findingResults = evidenceMap.finding_results as JsonRecord

    expect(evidenceMap.representation).toBe('fenced_json_object')
    expect(evidenceMap.schema_version).toBe(2)
    expect(evidenceMap.required_keys).toEqual([
      'schema_version',
      'correction_base',
      'finding_results',
    ])
    expect(evidenceMap.correction_base).toEqual({
      type: 'string',
      binding: 'must equal the immutable reviewed head',
    })
    expect(findingResults.representation).toBe('object keyed by immutable finding ID')
    expect(findingResults.entry_fields).toEqual(['changed_files', 'tests', 'status'])
    expect(findingResults.status_enum).toEqual(['CLAIMED_RESOLVED', 'UNPROVEN'])
    expect(evidenceMap.bindings).toEqual(expect.arrayContaining([
      'correction_base must equal the immutable reviewed head',
      'finding IDs must exactly match the immutable correction finding set; omitted, added, or substituted IDs are invalid',
      'referenced changed files must exist in the actual correction diff',
    ]))
    expect(evidenceMap.claimed_resolved_requirements).toEqual([
      'changed_files must be non-empty',
      'tests must be non-empty',
    ])
    expect(evidenceMap.multiplicity).toBe('Exactly one correction evidence-map block is permitted')
    expect(typeof evidenceMap.canonical_example).toBe('string')
    expect(evidenceMap.canonical_example).toContain('"correction_base"')
    expect(evidenceMap.canonical_example).toContain('"finding_results"')
  })

  it('normalizes all four Tier A JSON-help permutations', () => {
    const permutations = [
      ['--help', '--json'],
      ['--json', '--help'],
      ['-h', '--json'],
      ['--json', '-h'],
    ]

    const parsed = permutations.map((argv) => (
      parseCommandInvocation(TIER_A_COMMAND, argv)
    ))

    expect(parsed).toHaveLength(4)
    expect(parsed[0]).toMatchObject({
      mode: 'help',
      format: 'json',
    })
    for (const result of parsed.slice(1)) {
      expect(result).toEqual(parsed[0])
    }

    for (const argv of permutations) {
      expect(parseCommandInvocation(TIER_A_COMMAND, ['--', ...argv])).toEqual(parsed[0])
    }
  })

  it('renders Tier A and Tier B sections in contract order', () => {
    const tierAHelp = formatTextHelp(commandContract(TIER_A_COMMAND))
    const tierBHelp = formatTextHelp(commandContract(TIER_B_COMMAND))

    expectSectionsInOrder(tierAHelp, TIER_A_SECTIONS)
    expectSectionsInOrder(tierBHelp, TIER_B_SECTIONS)
    expect(tierBHelp).toMatch(/WRITES\s*:\s*none/i)
    expect(tierAHelp).toContain(TIER_A_COMMAND)
    expect(tierAHelp).toContain(commandContract(TIER_A_COMMAND).entrypoint)
    expect(tierBHelp).toContain(TIER_B_COMMAND)
    expect(tierBHelp).toContain(commandContract(TIER_B_COMMAND).entrypoint)
  })

  it('normalizes positive integers repositories and full lowercase SHAs without lossy coercion', () => {
    const invocation = parseCommandInvocation(
      REOPEN_COMMAND,
      reopenArguments(),
    )

    expect(invocation).toMatchObject({
      mode: 'run',
      format: 'text',
      values: {
        issue_number: '284',
        repository: 'boat1994/bemoat-web-starter',
        expected_pr: '285',
        expected_state: 'ELIGIBLE_FOR_FOUNDER_REVIEW',
        expected_old_head: FULL_LOWERCASE_SHA,
        expected_new_head: SECOND_FULL_LOWERCASE_SHA,
        expected_review_cycle: '9007199254740991',
        expected_full_review_count: '1',
        authorization_comment: '12345',
      },
    })

    const values = (invocation as { values: Record<string, string | boolean> }).values
    for (const [name, value] of Object.entries(values)) {
      if (name !== 'some_boolean_flag') expect(typeof value).toBe('string')
    }
    expect(values.expected_old_head).toMatch(/^[0-9a-f]{40}$/)
    expect(values.expected_new_head).toMatch(/^[0-9a-f]{40}$/)
    expect(values.issue_number).not.toBe(284)
    expect(values.expected_review_cycle).not.toBe(9007199254740991)

    expectInvalidInvocation(REOPEN_COMMAND, reopenArguments({
      issueNumber: '9007199254740992',
    }))
    expectInvalidInvocation(REOPEN_COMMAND, reopenArguments({
      expectedPr: '0',
    }))
    expectInvalidInvocation(REOPEN_COMMAND, reopenArguments({
      expectedOldHead: FULL_LOWERCASE_SHA.slice(0, 39),
    }))
    expectInvalidInvocation(REOPEN_COMMAND, reopenArguments({
      expectedNewHead: `${SECOND_FULL_UPPERCASE_SHA}0`,
    }))
  })

  it('rejects duplicate singleton unknown missing and conflicting inputs before execute', () => {
    expectInvalidInvocation(REOPEN_COMMAND, [
      ...reopenArguments(),
      '--repo',
      'other/repository',
    ])
    expectInvalidInvocation(REOPEN_COMMAND, [
      ...reopenArguments(),
      '--not-registered',
      'value',
    ])
    expectInvalidInvocation(REOPEN_COMMAND, ['284', '--repo'])
    expectInvalidInvocation(REOPEN_COMMAND, [
      '284',
      '285',
      ...reopenArguments().slice(1),
    ])
    expectInvalidInvocation('bemoat:boilerplate:check', [
      '--harness-only',
      '--full',
    ])
  })

  it('accepts npm_lifecycle_event only when its registry entrypoint matches', () => {
    const pack = commandContract(PACK_COMMAND)
    const safety = commandContract(SAFETY_COMMAND)

    expect(resolveCommandIdentity({
      fallback: PACK_COMMAND,
      env: {},
      entrypoint: pack.entrypoint,
    })).toBe(PACK_COMMAND)
    expect(resolveCommandIdentity({
      fallback: PACK_COMMAND,
      env: { npm_lifecycle_event: PACK_COMMAND },
      entrypoint: pack.entrypoint,
    })).toBe(PACK_COMMAND)
    expect(resolveCommandIdentity({
      fallback: PACK_COMMAND,
      env: { npm_lifecycle_event: SAFETY_COMMAND },
      entrypoint: pack.entrypoint,
    })).toBe(SAFETY_COMMAND)
    expect(resolveCommandIdentity({
      fallback: SAFETY_COMMAND,
      env: { npm_lifecycle_event: SAFETY_COMMAND },
      entrypoint: safety.entrypoint,
    })).toBe(SAFETY_COMMAND)

    expect(() => resolveCommandIdentity({
      fallback: PACK_COMMAND,
      env: { npm_lifecycle_event: 'bemoat:mission-control:retired-dispatch' },
      entrypoint: pack.entrypoint,
    })).toThrow(CliInvocationError)
    expect(() => resolveCommandIdentity({
      fallback: PACK_COMMAND,
      env: { npm_lifecycle_event: 'bemoat:not-registered' },
      entrypoint: pack.entrypoint,
    })).toThrow(CliInvocationError)
  })

  it('validates the exact v1 help and result key/type sets', () => {
    const help = createHelpEnvelopeV1(commandContract(TIER_A_COMMAND)) as JsonRecord

    expect(Object.keys(help).sort()).toEqual([...HELP_KEYS].sort())
    expect(help.schema_version).toBe(1)
    expect(typeof help.command).toBe('string')
    expect(help.mode).toBe('help')
    expect(help.classification).toBe('HELP')
    expect(help.tier).toBe('A')
    expect(typeof help.purpose).toBe('string')
    for (const key of [
      'accepted_pre_states',
      'required_inputs',
      'optional_flags',
      'caller_supplied_values',
      'trusted_derived_values',
      'required_evidence',
      'reads',
      'writes',
      'stop_classifications',
      'result_classifications',
      'next_action_rules',
      'stop_conditions',
      'examples',
    ]) {
      expect(Array.isArray(help[key]), key).toBe(true)
    }
    expect(typeof help.retry_contract).toBe('object')
    expect(typeof help.role_contracts).toBe('object')

    const result = makeResultEnvelope() as JsonRecord
    expect(Object.keys(result).sort()).toEqual([...RESULT_KEYS].sort())
    expect(result.schema_version).toBe(1)
    expect(typeof result.command).toBe('string')
    expect(result.mode).toBe('result')
    expect(['SUCCESS', 'NO_OP', 'STOP', 'ERROR']).toContain(result.outcome)
    expect(result.classification).not.toBe('HELP')
    expect(typeof result.mutation_performed).toBe('boolean')
    for (const key of [
      'observed_pre_state',
      'resulting_state',
      'repository',
      'issue_number',
      'pr_number',
      'exact_head',
    ]) {
      expect(
        result[key] === null || typeof result[key] === 'string',
        key,
      ).toBe(true)
    }
    expect(typeof result.evidence_ids).toBe('object')
    expect(Array.isArray(result.evidence_ids)).toBe(false)
    expect(typeof result.next_action).toBe('object')
    expect(typeof result.details).toBe('object')
    expect(Array.isArray(result.details)).toBe(false)
    expect(() => assertResultEnvelopeV1(result)).not.toThrow()
  })

  it('rejects command data outside details', () => {
    const valid = makeResultEnvelope() as JsonRecord
    const withTopLevelLegacyData = {
      ...valid,
      legacy_classification: 'DELIVERED',
    }
    const withTopLevelNarrative = {
      ...valid,
      narrative: 'This field belongs under details.',
    }

    expect(() => assertResultEnvelopeV1(withTopLevelLegacyData)).toThrow()
    expect(() => assertResultEnvelopeV1(withTopLevelNarrative)).toThrow()
    expect(() => assertResultEnvelopeV1(valid)).not.toThrow()
  })

  it('maps every canonical classification to one exit code', () => {
    const expectedExitCodes = {
      HELP: 0,
      SUCCESS: 0,
      NO_OP_IDENTICAL_RETRY: 0,
      INTERNAL_ERROR: 1,
      INVALID_INVOCATION: 2,
      UNSUPPORTED_PRE_STATE: 3,
      STATE_CONFLICT: 3,
      AUTHORITY_CONFLICT: 3,
      HEAD_DRIFT: 3,
      BLOCKED_EXTERNAL: 3,
      EVIDENCE_CONFLICT: 3,
      AMBIGUOUS_RESULT: 4,
    } as const

    for (const [classification, exitCode] of Object.entries(expectedExitCodes)) {
      expect(classificationExitCode(classification), classification).toBe(exitCode)
    }
  })

  it('renders the explicitly selected direct help command', () => {
    const run = runCliBoundaryCase({
      entrypoint: 'scripts/cli/command-help.mjs',
      argv: [BRANCH_COMMAND, '--help', '--json'],
      env: {},
    })

    expect(run.status).toBe(0)
    expect(run.error).toBeNull()
    expect(run.stderr).toBe('')
    expect(run.poison_invocations).toEqual([])
    expect(compareFileSystemSnapshots(run.before, run.after)).toBe(true)

    const json = JSON.parse(run.stdout.trim()) as JsonRecord
    expect(json.command).toBe(BRANCH_COMMAND)
    expect(json.tier).toBe('B')
    expect(json.classification).toBe('HELP')
  })

  it('renders all direct JSON-help permutations byte-identically', () => {
    const permutations = [
      ['--help', '--json'],
      ['--json', '--help'],
      ['-h', '--json'],
      ['--json', '-h'],
    ]
    const runs = permutations.map((flags) => runCliBoundaryCase({
      entrypoint: 'scripts/cli/command-help.mjs',
      argv: [BRANCH_COMMAND, ...flags],
      env: {},
    }))

    for (const run of runs) {
      expect(run.status).toBe(0)
      expect(run.error).toBeNull()
      expect(run.stderr).toBe('')
      expect(run.poison_invocations).toEqual([])
      expect(compareFileSystemSnapshots(run.before, run.after)).toBe(true)
    }
    expect(runs.map((run) => run.stdout)).toEqual([
      runs[0].stdout,
      runs[0].stdout,
      runs[0].stdout,
      runs[0].stdout,
    ])
  })

  it('rejects a mismatched lifecycle entrypoint at the direct boundary', () => {
    const run = runCliBoundaryCase({
      entrypoint: 'scripts/cli/command-help.mjs',
      argv: [BRANCH_COMMAND, '--help', '--json'],
      env: {
        BEMOAT_FACADE_COMMAND: PACK_COMMAND,
        npm_lifecycle_event: TIER_A_COMMAND,
      },
    })

    expect(run.status).toBe(2)
    expect(run.error).toBeNull()
    expect(run.stderr).toBe('')
    expect(run.poison_invocations).toEqual([])
    expect(compareFileSystemSnapshots(run.before, run.after)).toBe(true)

    const json = JSON.parse(run.stdout.trim()) as JsonRecord
    expect(json.command).toBe(BRANCH_COMMAND)
    expect(json.classification).toBe('INVALID_INVOCATION')
  })

  it('emits one JSON object with plain-text classification parity', () => {
    const jsonRun = runCliBoundaryCase({
      entrypoint: 'scripts/cli/command-help.mjs',
      argv: [TIER_A_COMMAND, '--help', '--json'],
      env: {},
    })
    const textRun = runCliBoundaryCase({
      entrypoint: 'scripts/cli/command-help.mjs',
      argv: [TIER_A_COMMAND, '--help'],
      env: {},
    })

    expect(jsonRun.status).toBe(0)
    expect(jsonRun.error).toBeNull()
    expect(jsonRun.stderr).toBe('')
    expect(jsonRun.poison_invocations).toEqual([])
    expect(compareFileSystemSnapshots(jsonRun.before, jsonRun.after)).toBe(true)

    const serialized = jsonRun.stdout.trim()
    expect(serialized).toMatch(/^\{[\s\S]*\}$/)
    const json = JSON.parse(serialized) as JsonRecord
    expect(Object.keys(json).sort()).toEqual([...HELP_KEYS].sort())
    expect(json.classification).toBe('HELP')

    expect(textRun.status).toBe(0)
    expect(textRun.error).toBeNull()
    expect(textRun.stderr).toBe('')
    expect(textRun.poison_invocations).toEqual([])
    expect(compareFileSystemSnapshots(textRun.before, textRun.after)).toBe(true)
    expect(textRun.stdout.trimStart()).toMatch(/^HELP\b/)
    expect(textRun.stdout).toContain(String(json.classification))
  })
})
