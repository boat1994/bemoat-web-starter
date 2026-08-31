import { describe, expect, it } from 'vitest'

import {
  compareFileSystemSnapshots,
  runCliBoundaryCase,
} from '../helpers/cli-boundary-harness'
import { getCommandContract } from '../../scripts/cli/command-contract.ts'
import {
  CliInvocationError,
  parseCommandInvocation,
  resolveCommandIdentity,
} from '../../scripts/cli/command-invocation.ts'
import {
  createHelpEnvelopeV1,
  formatTextHelp,
} from '../../scripts/cli/command-help.ts'
import {
  CLI_EXIT_CODES,
  assertResultEnvelopeV1,
  classificationExitCode,
  classifyDelegatedFailure,
  createResultEnvelopeV1,
} from '../../scripts/cli/command-result.ts'

type JsonRecord = Record<string, unknown>

const BOILERPLATE_SYNC = 'bemoat:boilerplate:sync'
const HOOKS = 'bemoat:hooks:install'
const PACK = 'bemoat:guard:pack'
const CHECK = 'bemoat:boilerplate:check'
const BRANCH = 'bemoat:branch:check'
const MIXED_SHA = 'ABCDEF0123456789ABCDEF0123456789ABCDEF01'
const LOWER_SHA = MIXED_SHA.toLowerCase()

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

function expectCliInvocation(
  error: unknown,
  argument: string | null,
  reason: string,
) {
  expect(error).toBeInstanceOf(CliInvocationError)
  const invocationError = error as CliInvocationError
  expect(invocationError.classification).toBe('INVALID_INVOCATION')
  expect(invocationError.exit_code).toBe(2)
  expect(invocationError.details).toEqual({ argument, reason })
  expect(invocationError.message).toBe(reason)
}

function expectThrown(run: () => unknown) {
  try {
    run()
  } catch (error) {
    return error
  }
  throw new Error('expected a thrown error')
}

function minimalResult(overrides: Record<string, unknown> = {}) {
  return createResultEnvelopeV1({
    command: BOILERPLATE_SYNC,
    outcome: 'SUCCESS',
    classification: 'SUCCESS',
    ...overrides,
  })
}

function runHelpCli(
  argv: readonly string[],
  env: Record<string, string | undefined> = {},
) {
  return runCliBoundaryCase({
    entrypoint: 'scripts/cli/command-help.ts',
    argv,
    env,
  })
}

describe('CLI envelope runtime characterization', () => {
  describe('classifyDelegatedFailure', () => {
    it('extracts canonical classifications from stderr, stdout, and error.message', () => {
      expect(classifyDelegatedFailure({
        command: 'node',
        stderr: 'ERROR: STATE_CONFLICT: delegated state evidence is stale',
      })).toBe('STATE_CONFLICT')
      expect(classifyDelegatedFailure({
        command: 'node',
        stdout: 'foo\nINVALID_INVOCATION: x',
      })).toBe('INVALID_INVOCATION')
      expect(classifyDelegatedFailure({
        error: { message: 'AUTHORITY_CONFLICT: from error' },
      })).toBe('AUTHORITY_CONFLICT')
      expect(classifyDelegatedFailure({
        stderr: '  SUCCESS: indented',
      })).toBe('SUCCESS')
      expect(classifyDelegatedFailure({
        stderr: 'HELP: x',
      })).toBe('HELP')
      expect(classifyDelegatedFailure({
        stderr: 'ERROR: HELP: x',
      })).toBe('HELP')
    })

    it('defaults unknown delegated output by command identity', () => {
      expect(classifyDelegatedFailure({
        command: 'gh',
        stderr: 'boom',
      })).toBe('BLOCKED_EXTERNAL')
      expect(classifyDelegatedFailure({
        command: 'gh',
        stderr: 'SUCCESS: ok',
      })).toBe('SUCCESS')
      expect(classifyDelegatedFailure({
        command: 'node',
        stderr: 'boom',
      })).toBe('INTERNAL_ERROR')
      expect(classifyDelegatedFailure({
        stderr: 'NOT_A_CLASS: x',
      })).toBe('INTERNAL_ERROR')
      expect(classifyDelegatedFailure({
        stderr: 'STATE_CONFLICT without colon suffix',
      })).toBe('INTERNAL_ERROR')
      expect(classifyDelegatedFailure({})).toBe('INTERNAL_ERROR')
    })
  })

  describe('classificationExitCode', () => {
    it('throws RangeError for unknown classifications with the exact message', () => {
      expect(() => classificationExitCode('NOT_REAL')).toThrowError(
        new RangeError('unknown CLI classification: NOT_REAL'),
      )
      expect(() => classificationExitCode('')).toThrowError(
        new RangeError('unknown CLI classification: '),
      )
      expect(() => classificationExitCode(null as unknown as string)).toThrowError(
        new RangeError('unknown CLI classification: null'),
      )
      expect(classificationExitCode('HELP')).toBe(0)
    })
  })

  describe('createResultEnvelopeV1 and assertResultEnvelopeV1', () => {
    it('applies schema-v1 defaults and strips unknown create-input keys', () => {
      const envelope = createResultEnvelopeV1({
        command: BOILERPLATE_SYNC,
        outcome: 'SUCCESS',
        classification: 'SUCCESS',
        extra: 'stripped',
      } as Record<string, unknown>)

      expect(Object.keys(envelope).sort()).toEqual([...RESULT_KEYS].sort())
      expect(envelope).toMatchObject({
        schema_version: 1,
        command: BOILERPLATE_SYNC,
        mode: 'result',
        outcome: 'SUCCESS',
        classification: 'SUCCESS',
        mutation_performed: false,
        observed_pre_state: null,
        resulting_state: null,
        repository: null,
        issue_number: null,
        pr_number: null,
        exact_head: null,
        evidence_ids: {},
        next_action: {
          type: 'COMPLETE',
          command: null,
          reason: 'The command completed its registered operation.',
        },
        details: {},
      })
      expect(Object.hasOwn(envelope, 'extra')).toBe(false)
    })

    it('normalizes repository and SHA on create, then requires lowercase SHA on assert', () => {
      const created = minimalResult({
        repository: 'Boat1994/Bemoat-Web-Starter',
        exact_head: MIXED_SHA,
      })
      expect(created.repository).toBe('boat1994/bemoat-web-starter')
      expect(created.exact_head).toBe(LOWER_SHA)
      expect(() => assertResultEnvelopeV1(created)).not.toThrow()
      expect(() => assertResultEnvelopeV1({
        ...created,
        exact_head: MIXED_SHA,
      })).toThrowError(new TypeError('exact_head must be a lowercase full SHA or null'))
    })

    it('does not couple outcome to classification', () => {
      expect(minimalResult({
        outcome: 'STOP',
        classification: 'SUCCESS',
      })).toMatchObject({
        outcome: 'STOP',
        classification: 'SUCCESS',
      })
      expect(minimalResult({
        outcome: 'NO_OP',
        classification: 'NO_OP_IDENTICAL_RETRY',
      })).toMatchObject({
        outcome: 'NO_OP',
        classification: 'NO_OP_IDENTICAL_RETRY',
      })
    })

    it('accepts null-prototype details objects and rejects arrays', () => {
      const details = Object.create(null) as Record<string, unknown>
      expect(minimalResult({ details }).details).toEqual({})
      expect(() => minimalResult({ details: [] })).toThrowError(
        new TypeError('details must be an object'),
      )
      expect(() => minimalResult({ evidence_ids: [] })).toThrowError(
        new TypeError('evidence_ids must be an object'),
      )
    })

    it.each([
      [
        'HELP classification',
        { classification: 'HELP' },
        'result classification is invalid: HELP',
      ],
      [
        'numeric issue_number',
        { issue_number: 284 },
        'issue_number must be a positive integer string or null',
      ],
      [
        'leading-zero issue_number',
        { issue_number: '0284' },
        'issue_number must be a positive integer string or null',
      ],
      [
        'empty pr_number',
        { pr_number: '' },
        'pr_number must be a positive integer string or null',
      ],
      [
        'unregistered command',
        { command: 'bemoat:nope' },
        'result command must be a registered command',
      ],
      [
        'whitespace observed_pre_state',
        { observed_pre_state: '  ' },
        'observed_pre_state must be a non-empty string or null',
      ],
      [
        'unregistered next_action command',
        { next_action: { type: 'COMMAND', command: 'bemoat:nope', reason: 'x' } },
        'next_action.command must be a registered command',
      ],
      [
        'non-command next_action with command',
        { next_action: { type: 'STOP', command: BOILERPLATE_SYNC, reason: 'x' } },
        'next_action.command must be null for a non-command action',
      ],
      [
        'extra next_action key',
        { next_action: { type: 'STOP', command: null, reason: 'x', extra: 1 } },
        'next_action must contain exactly type, command, and reason',
      ],
      [
        'empty evidence key',
        { evidence_ids: { '': 'x' } },
        'evidence_ids must contain non-empty string values',
      ],
      [
        'empty evidence value',
        { evidence_ids: { a: '' } },
        'evidence_ids must contain non-empty string values',
      ],
    ] as const)('rejects %s with the exact TypeError', (_label, overrides, message) => {
      expect(() => minimalResult(overrides as Record<string, unknown>)).toThrowError(
        new TypeError(message),
      )
    })

    it('rejects extra keys on assert while create already stripped them', () => {
      const valid = minimalResult()
      expect(() => assertResultEnvelopeV1({
        ...valid,
        extra: 'nope',
      })).toThrowError(
        new TypeError('result envelope must contain exactly the schema-v1 result fields'),
      )
    })
  })

  describe('parseCommandInvocation', () => {
    it('treats empty argv, discarded --, and --json-only as run mode for no-input commands', () => {
      expect(parseCommandInvocation(HOOKS, [])).toMatchObject({
        mode: 'run',
        format: 'text',
        values: {},
      })
      expect(parseCommandInvocation(HOOKS, ['--'])).toMatchObject({
        mode: 'run',
        format: 'text',
        values: {},
      })
      expect(parseCommandInvocation(HOOKS, ['--json'])).toMatchObject({
        mode: 'run',
        format: 'json',
        values: {},
      })
    })

    it('short-circuits help before positional validation and skips stdin/environment parsing', () => {
      expect(parseCommandInvocation(CHECK, ['--help', '--harness-only'])).toMatchObject({
        mode: 'help',
        format: 'text',
      })
      expect(parseCommandInvocation(BOILERPLATE_SYNC, [])).toMatchObject({
        mode: 'run',
        values: {},
      })
      expect(parseCommandInvocation(CHECK, ['--harness-only'])).toMatchObject({
        mode: 'run',
        values: { harness_only: true },
      })
    })

    it('sets boolean flags to true and rejects a following leftover positional', () => {
      expect(parseCommandInvocation(BOILERPLATE_SYNC, ['--harness-only'])).toMatchObject({
        values: { harness_only: true },
      })
      expectCliInvocation(
        expectThrown(() => parseCommandInvocation(BOILERPLATE_SYNC, ['--harness-only', 'oops'])),
        'oops',
        'multiple positional values are not allowed',
      )
    })

    it('rejects invalid identity, argv, duplicates, enums, and missing required flags with exact details', () => {
      expectCliInvocation(
        expectThrown(() => parseCommandInvocation('', [])),
        '',
        'command identity is required',
      )
      expectCliInvocation(
        expectThrown(() => parseCommandInvocation(null as unknown as string, [])),
        null,
        'command identity is required',
      )
      expectCliInvocation(
        expectThrown(() => parseCommandInvocation('bemoat:nope', [])),
        'bemoat:nope',
        'command is not registered: bemoat:nope',
      )
      expectCliInvocation(
        expectThrown(() => parseCommandInvocation(HOOKS, 'nope' as unknown as string[])),
        null,
        'argv must be an array of strings',
      )
      expectCliInvocation(
        expectThrown(() => parseCommandInvocation(HOOKS, [1 as unknown as string])),
        null,
        'argv must be an array of strings',
      )
      expectCliInvocation(
        expectThrown(() => parseCommandInvocation(CHECK, ['--help', '-h'])),
        '-h',
        'help may be provided only once',
      )
      expectCliInvocation(
        expectThrown(() => parseCommandInvocation(CHECK, ['--json', '--json'])),
        '--json',
        '--json may be provided only once',
      )
      expectCliInvocation(
        expectThrown(() => parseCommandInvocation(BOILERPLATE_SYNC, ['--harness-only', '--harness-only'])),
        '--harness-only',
        'input may be provided only once: --harness-only',
      )
      expectCliInvocation(
        expectThrown(() => parseCommandInvocation(CHECK, ['--nope'])),
        '--nope',
        'unknown flag: --nope',
      )
      expectCliInvocation(
        expectThrown(() => parseCommandInvocation(CHECK, ['--harness-only', '--full'])),
        null,
        'harness_only and full are mutually exclusive',
      )
      expectCliInvocation(
        expectThrown(() => parseCommandInvocation(BOILERPLATE_SYNC, ['--harness-only', '--full'])),
        null,
        'harness_only and full are mutually exclusive',
      )
    })
  })

  describe('resolveCommandIdentity', () => {
    it('treats empty lifecycle as absent and matches relative or absolute entrypoints', () => {
      expect(resolveCommandIdentity({
        fallback: PACK,
        env: { npm_lifecycle_event: '' },
        entrypoint: 'scripts/guard-pack.ts',
      })).toBe(PACK)
      expect(resolveCommandIdentity({
        fallback: PACK,
        env: {},
        entrypoint: 'scripts/guard-pack.ts',
      })).toBe(PACK)
    })

    it('rejects mismatched entrypoint, non-string lifecycle, and empty entrypoint with exact details', () => {
      expectCliInvocation(
        expectThrown(() => resolveCommandIdentity({
          fallback: PACK,
          env: {},
          entrypoint: 'scripts/not-a-facade.mjs',
        })),
        PACK,
        `fallback command entrypoint does not match the running facade: ${PACK}`,
      )
      expectCliInvocation(
        expectThrown(() => resolveCommandIdentity({
          fallback: PACK,
          env: { npm_lifecycle_event: 1 as unknown as string },
          entrypoint: 'scripts/guard-pack.ts',
        })),
        null,
        'npm_lifecycle_event must be a registered command',
      )
      expectCliInvocation(
        expectThrown(() => resolveCommandIdentity({
          fallback: PACK,
          env: {},
          entrypoint: '',
        })),
        PACK,
        'running facade entrypoint is required',
      )
    })
  })

  describe('help envelopes and text rendering', () => {
    it('rejects unregistered contracts, deep-copies nested values, and keeps ROLE CONTRACTS optional', () => {
      expect(() => createHelpEnvelopeV1(null as unknown as Record<string, unknown>))
        .toThrowError(new TypeError('help requires a registered command contract'))
      expect(() => createHelpEnvelopeV1({ command: 'bemoat:nope' }))
        .toThrowError(new TypeError('help requires a registered command contract'))

      const boilerplateContract = getCommandContract(BOILERPLATE_SYNC)
      if (!boilerplateContract) throw new Error('missing boilerplate sync contract')
      const envelope = createHelpEnvelopeV1(boilerplateContract) as JsonRecord
      const roleContracts = envelope.role_contracts as JsonRecord
      roleContracts.HANDOFF = 'hacked'
      ;(envelope.retry_contract as JsonRecord).identical_retry = 'hacked'
      expect((boilerplateContract.role_contracts as JsonRecord).HANDOFF).not.toBe('hacked')
      expect((boilerplateContract.retry_contract as JsonRecord).identical_retry).toBe('conditional')

      const tierA = formatTextHelp(getCommandContract(BOILERPLATE_SYNC) as Record<string, unknown>)
      const tierB = formatTextHelp(getCommandContract(CHECK) as Record<string, unknown>)
      const boilerplateHelp = formatTextHelp(boilerplateContract as Record<string, unknown>)
      expect(tierA).toContain('AUTHORITY AND TRUST BOUNDARY')
      expect(tierB).not.toContain('AUTHORITY AND TRUST BOUNDARY')
      expect(tierB).toMatch(/WRITES: none/)
      expect(tierB).not.toContain('ROLE CONTRACTS')
      expect(boilerplateHelp).not.toContain('ROLE CONTRACTS')
      for (const classification of Object.keys(CLI_EXIT_CODES)) {
        expect(tierA).toContain(`${classification}:`)
      }
    })
  })

  describe('command-help process boundary', () => {
    it('writes text INVALID_INVOCATION to stderr when the command is missing or unregistered, even with --json', () => {
      const missing = runHelpCli([])
      const jsonFirst = runHelpCli(['--json'])
      const helpFirst = runHelpCli(['--help'])
      const unregistered = runHelpCli(['bemoat:nope'])
      const unregisteredJson = runHelpCli(['bemoat:nope', '--json'])

      for (const run of [missing, jsonFirst, helpFirst]) {
        expect(run.status).toBe(2)
        expect(run.error).toBeNull()
        expect(run.stdout).toBe('')
        expect(run.stderr).toBe(
          'INVALID_INVOCATION: command-help requires a registry command before its flags\n',
        )
        expect(run.poison_invocations).toEqual([])
        expect(compareFileSystemSnapshots(run.before, run.after)).toBe(true)
      }

      expect(unregistered.status).toBe(2)
      expect(unregistered.stdout).toBe('')
      expect(unregistered.stderr).toBe('INVALID_INVOCATION: command is not registered: bemoat:nope\n')
      expect(unregisteredJson.status).toBe(2)
      expect(unregisteredJson.stdout).toBe('')
      expect(unregisteredJson.stderr).toBe(
        'INVALID_INVOCATION: command is not registered: bemoat:nope\n',
      )
    })

    it('writes JSON result envelopes to stdout only after a registered command is captured', () => {
      const missingHelp = runHelpCli([HOOKS])
      const jsonMissingHelp = runHelpCli([HOOKS, '--json'])
      const duplicateHelp = runHelpCli([HOOKS, '--help', '--help'])
      const emptyFacade = runHelpCli([BRANCH, '--help', '--json'], {
        BEMOAT_FACADE_COMMAND: '',
      })

      expect(missingHelp.status).toBe(2)
      expect(missingHelp.stdout).toBe('')
      expect(missingHelp.stderr).toBe(
        'INVALID_INVOCATION: command-help requires --help or -h\n',
      )

      expect(jsonMissingHelp.status).toBe(2)
      expect(jsonMissingHelp.stderr).toBe('')
      const jsonEnvelope = JSON.parse(jsonMissingHelp.stdout.trim()) as JsonRecord
      expect(jsonEnvelope).toMatchObject({
        schema_version: 1,
        command: HOOKS,
        mode: 'result',
        outcome: 'ERROR',
        classification: 'INVALID_INVOCATION',
        mutation_performed: false,
        next_action: {
          type: 'STOP',
          command: null,
          reason: 'command-help requires --help or -h',
        },
        details: {
          argument: null,
          reason: 'command-help requires --help or -h',
        },
      })

      expect(duplicateHelp.status).toBe(2)
      expect(duplicateHelp.stdout).toBe('')
      expect(duplicateHelp.stderr).toBe('INVALID_INVOCATION: help may be provided only once\n')

      expect(emptyFacade.status).toBe(2)
      expect(emptyFacade.stderr).toBe('')
      const facadeEnvelope = JSON.parse(emptyFacade.stdout.trim()) as JsonRecord
      expect(facadeEnvelope).toMatchObject({
        command: BRANCH,
        classification: 'INVALID_INVOCATION',
        outcome: 'ERROR',
        details: {
          argument: '',
          reason: 'BEMOAT_FACADE_COMMAND is required with a running facade identity',
        },
      })
    })
  })
})
