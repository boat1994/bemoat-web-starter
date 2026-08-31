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

const TIER_A_COMMAND = 'bemoat:hooks:install'
const TIER_B_COMMAND = 'bemoat:guard:pack'
const BRANCH_COMMAND = 'bemoat:branch:check'
const PACK_COMMAND = 'bemoat:guard:pack'
const SAFETY_COMMAND = 'bemoat:guard:safety'
const FULL_UPPERCASE_SHA = 'ABCDEF0123456789ABCDEF0123456789ABCDEF01'
const FULL_LOWERCASE_SHA = FULL_UPPERCASE_SHA.toLowerCase()


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
