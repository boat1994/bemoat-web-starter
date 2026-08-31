/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  COMMAND_CONTRACT_REGISTRY,
  COMMAND_CONTRACT_SCHEMA_VERSION,
} from '../../scripts/cli/command-contract-registry.ts'
import {
  getCommandContract,
  validateCommandContractRegistry,
} from '../../scripts/cli/command-contract.ts'

type JsonRecord = Record<string, unknown>
type PackageJson = { scripts: Record<string, string> }
type RegistryFixture = {
  schema_version: number
  commands: Record<string, JsonRecord>
  routes: JsonRecord[]
  [key: string]: unknown
}

const REPOSITORY_ROOT = process.cwd()
const MUTATING_COMMAND = 'bemoat:handoff'
const PACKAGE_JSON = JSON.parse(
  readFileSync(resolve(REPOSITORY_ROOT, 'package.json'), 'utf8'),
) as PackageJson
const EXPECTED_PACKAGE_SCRIPTS: Record<string, string> = {
  'bemoat:context': 'node scripts/agent-context.ts',
  'bemoat:context:sync-base': 'node scripts/agent-context-sync-base.ts',
  'bemoat:handoff': 'node scripts/agent-handoff.ts',
  'bemoat:boilerplate:check': 'node scripts/check-boilerplate-drift.mjs',
  'bemoat:boilerplate:sync': 'node scripts/sync-boilerplate.mjs',
  'bemoat:branch:check': 'bash scripts/check-branch-safety.sh',
  'bemoat:check': 'pnpm run bemoat:guard:safety && pnpm run lint && pnpm run typecheck && pnpm run bemoat:test:int',
  'bemoat:guard:cloudflare-env': 'node scripts/guard-cloudflare-env.ts',
  'bemoat:guard:harness-contract': 'node scripts/guard-harness-contract.ts',
  'bemoat:guard:pack': 'node scripts/guard-pack.ts',
  'bemoat:guard:safety': 'node scripts/guard-pack.ts',
  'bemoat:hooks:install': 'node scripts/install-git-hooks.mjs',
  'bemoat:test:int': 'cross-env NODE_OPTIONS=--no-deprecation vitest run --config ./vitest.config.mts',
  'bemoat:typecheck': 'node scripts/bemoat-typecheck.ts',
}

const EXPECTED_COMMAND_TIERS: Record<string, 'A' | 'B' | 'C'> = {
  'bemoat:context': 'B',
  'bemoat:context:sync-base': 'A',
  'bemoat:handoff': 'A',
  'bemoat:boilerplate:check': 'B',
  'bemoat:boilerplate:sync': 'A',
  'bemoat:branch:check': 'B',
  'bemoat:check': 'C',
  'bemoat:guard:cloudflare-env': 'B',
  'bemoat:guard:harness-contract': 'B',
  'bemoat:guard:pack': 'B',
  'bemoat:guard:safety': 'B',
  'bemoat:hooks:install': 'A',
  'bemoat:test:int': 'C',
  'bemoat:typecheck': 'C',
}

const COMMAND_FIELDS = [
  'schema_version',
  'command',
  'tier',
  'entrypoint',
  'purpose',
  'operation',
  'accepted_pre_states',
  'required_inputs',
  'optional_flags',
  'caller_supplied_values',
  'trusted_derived_values',
  'required_evidence',
  'reads',
  'writes',
  'success_classifications',
  'stop_classifications',
  'stop_conditions',
  'retry_contract',
  'role_contracts',
  'next_action_rules',
  'examples',
  'exceptional',
  'transport_role',
  'parser_owner',
  'delegated_executable',
  'help_meaningful',
  'safe_help_invocation',
  'exclusion_reason',
  'last_validation_before_mutation',
  'post_write_readback',
  'legacy_classification_map',
] as const

const INPUT_FIELDS = [
  'name',
  'syntax',
  'kind',
  'value_type',
  'required',
  'source',
  'multiple',
  'values',
  'description',
] as const

const RETRY_FIELDS = ['identical_retry', 'classification', 'condition'] as const
const ROUTE_FIELDS = [
  'route_key',
  'observed_state',
  'evidence_case',
  'required_evidence_condition',
  'forbidden_evidence_condition',
  'permitted_operation',
  'canonical_command',
  'required_review_type',
  'expected_post_state_or_gate',
  'prohibited_commands',
  'decision',
  'stop_condition',
] as const

const CANONICAL_CLASSIFICATIONS = new Set([
  'HELP',
  'SUCCESS',
  'NO_OP_IDENTICAL_RETRY',
  'INVALID_INVOCATION',
  'UNSUPPORTED_PRE_STATE',
  'STATE_CONFLICT',
  'AUTHORITY_CONFLICT',
  'HEAD_DRIFT',
  'BLOCKED_EXTERNAL',
  'EVIDENCE_CONFLICT',
  'AMBIGUOUS_RESULT',
  'INTERNAL_ERROR',
])

function clone<T>(value: T): T {
  return structuredClone(value)
}

function asRecord(value: unknown, label: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as JsonRecord
}

function commandRecord(registry: RegistryFixture, command: string): JsonRecord {
  const record = registry.commands[command]
  if (!record) throw new Error(`missing command fixture: ${command}`)
  return record
}

function validationResultIsRejected(result: unknown): boolean {
  if (result === false) return true
  if (Array.isArray(result)) return result.length > 0
  if (typeof result !== 'object' || result === null) return false
  const record = result as JsonRecord
  return record.valid === false ||
    (Array.isArray(record.errors) && record.errors.length > 0) ||
    (Array.isArray(record.violations) && record.violations.length > 0)
}

function validateRegistry(
  registry: unknown = COMMAND_CONTRACT_REGISTRY,
  packageJson: PackageJson = PACKAGE_JSON,
) {
  return validateCommandContractRegistry({
    registry,
    packageJson,
    states: [],
  })
}

function expectRegistryValid(
  registry: unknown = COMMAND_CONTRACT_REGISTRY,
  packageJson: PackageJson = PACKAGE_JSON,
) {
  let result: unknown
  try {
    result = validateRegistry(registry, packageJson)
  } catch (error) {
    throw new Error(
      `expected a valid command registry, received: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (validationResultIsRejected(result)) {
    throw new Error(`expected a valid command registry, received: ${JSON.stringify(result, null, 2)}`)
  }
  expect(validationResultIsRejected(result)).toBe(false)
}

function expectRegistryRejected(
  registry: unknown,
  packageJson: PackageJson = PACKAGE_JSON,
) {
  let threw = false
  let result: unknown
  try {
    result = validateRegistry(registry, packageJson)
  } catch {
    threw = true
  }
  expect(threw || validationResultIsRejected(result)).toBe(true)
}

describe('Task 1 command contract registry', () => {
  it('classifies the exact package command inventory once', () => {
    const packageCommands = Object.keys(PACKAGE_JSON.scripts)
      .filter((command) => command.startsWith('bemoat:'))
      .sort()
    const registryCommands = Object.keys(COMMAND_CONTRACT_REGISTRY.commands).sort()
    const classifiedCommands = Object.values(COMMAND_CONTRACT_REGISTRY.commands)
      .map((contract) => String((contract as any).command))
      .sort()

    expect(packageCommands).toEqual(Object.keys(EXPECTED_PACKAGE_SCRIPTS).sort())
    expect(packageCommands).toHaveLength(14)
    expect(registryCommands).toEqual(packageCommands)
    expect(classifiedCommands).toEqual(packageCommands)
    expect(new Set(classifiedCommands).size).toBe(14)

    for (const command of packageCommands) {
      expect(getCommandContract(command)).toBe(COMMAND_CONTRACT_REGISTRY.commands[command])
    }
    expect(getCommandContract('bemoat:unregistered')).toBeNull()
  })

  it('uses tier totals A=4 B=7 C=3', () => {
    const counts = { A: 0, B: 0, C: 0 }

    for (const [command, expectedTier] of Object.entries(EXPECTED_COMMAND_TIERS)) {
      const contract = getCommandContract(command)
      expect(contract?.tier, command).toBe(expectedTier)
      counts[expectedTier] += 1
    }

    expect(counts).toEqual({ A: 4, B: 7, C: 3 })
    expect(Object.keys(EXPECTED_COMMAND_TIERS)).toHaveLength(14)
    expect(Object.keys(COMMAND_CONTRACT_REGISTRY.commands)).toHaveLength(14)
    expectRegistryValid()
  })

  it('registers one optional absolute target worktree path for context base synchronization', () => {
    const contract = getCommandContract('bemoat:context:sync-base')
    expect(contract?.optional_flags).toContainEqual(expect.objectContaining({
      name: 'target_worktree',
      syntax: '--target-worktree <absolute-path>',
      kind: 'flag',
      value_type: 'path',
      required: false,
      source: 'caller',
      multiple: false,
    }))
    expect(contract?.optional_flags?.filter((input) => input.name === 'target_worktree')).toHaveLength(1)
  })

  it('requires every schema-v1 command field and existing entrypoint', () => {
    expect(COMMAND_CONTRACT_SCHEMA_VERSION).toBe(1)
    expect(COMMAND_CONTRACT_REGISTRY.schema_version).toBe(1)
    expect(Array.isArray(COMMAND_CONTRACT_REGISTRY.routes)).toBe(true)

    for (const command of Object.keys(EXPECTED_COMMAND_TIERS)) {
      const contract = asRecord(getCommandContract(command), command)
      expect(Object.keys(contract).sort()).toEqual([...COMMAND_FIELDS].sort())
      expect(contract.schema_version).toBe(1)
      expect((contract as any).command).toBe(command)
      expect(['A', 'B', 'C']).toContain(contract.tier)
      expect(typeof contract.entrypoint).toBe('string')
      expect(String(contract.entrypoint).trim()).not.toBe('')
      expect(
        existsSync(resolve(REPOSITORY_ROOT, String(contract.entrypoint))),
        `${command} entrypoint ${String(contract.entrypoint)}`,
      ).toBe(true)

      for (const field of [
        'accepted_pre_states',
        'required_inputs',
        'optional_flags',
        'caller_supplied_values',
        'trusted_derived_values',
        'required_evidence',
        'reads',
        'writes',
        'success_classifications',
        'stop_classifications',
        'stop_conditions',
        'next_action_rules',
        'examples',
      ]) {
        expect(Array.isArray(contract[field]), `${command}.${field}`).toBe(true)
      }

      const retry = asRecord(contract.retry_contract, `${command}.retry_contract`)
      expect(Object.keys(retry).sort()).toEqual([...RETRY_FIELDS].sort())
      expect(typeof contract.role_contracts).toBe('object')
      expect(['allowed', 'forbidden', 'conditional']).toContain(retry.identical_retry)
      expect(
        retry.classification === null ||
          (typeof retry.classification === 'string' &&
            CANONICAL_CLASSIFICATIONS.has(retry.classification)),
      ).toBe(true)
      expect(typeof retry.condition).toBe('string')

      for (const input of [
        ...(contract.required_inputs as unknown[]),
        ...(contract.optional_flags as unknown[]),
      ]) {
        const inputRecord = asRecord(input, `${command} input`)
        expect(Object.keys(inputRecord).sort()).toEqual([...INPUT_FIELDS].sort())
        expect(typeof inputRecord.name).toBe('string')
        expect(typeof inputRecord.syntax).toBe('string')
        expect(['positional', 'flag', 'environment', 'stdin']).toContain(inputRecord.kind)
        expect(['boolean', 'positive_integer', 'repository', 'full_sha', 'path', 'enum', 'string'])
          .toContain(inputRecord.value_type)
        expect(typeof inputRecord.required).toBe('boolean')
        expect(['caller', 'trusted_derived']).toContain(inputRecord.source)
        expect(inputRecord.multiple).toBe(false)
        expect(Array.isArray(inputRecord.values)).toBe(true)
        expect(typeof inputRecord.description).toBe('string')
      }
    }

    for (const route of COMMAND_CONTRACT_REGISTRY.routes as any[]) {
      expect(Object.keys(route).sort()).toEqual([...ROUTE_FIELDS].sort())
    }
    expectRegistryValid()
  })

  it('keeps the public registry containers frozen', () => {
    expect(Object.isFrozen(COMMAND_CONTRACT_REGISTRY)).toBe(true)
    expect(Object.isFrozen(COMMAND_CONTRACT_REGISTRY.commands)).toBe(true)
    expect(Object.isFrozen(COMMAND_CONTRACT_REGISTRY.routes)).toBe(true)
  })

  it('proves Tier C delegates without a repository parser', () => {
    const tierCCommands = Object.entries(EXPECTED_COMMAND_TIERS)
      .filter(([, tier]) => tier === 'C')
      .map(([command]) => command)

    expect(tierCCommands).toEqual([
      'bemoat:check',
      'bemoat:test:int',
      'bemoat:typecheck',
    ])

    for (const command of tierCCommands) {
      const contract = asRecord(getCommandContract(command), command)
      expect(contract.parser_owner, command).toBeNull()
      expect(typeof contract.delegated_executable, command).toBe('string')
      expect(String(contract.delegated_executable).trim(), command).not.toBe('')
      expect(contract.required_inputs, command).toEqual([])
      expect(contract.optional_flags, command).toEqual([])
      expect(contract.caller_supplied_values, command).toEqual([])
      expect(contract.writes, command).toEqual([])
      expect(typeof contract.safe_help_invocation, command).toBe('string')
      expect(String(contract.safe_help_invocation).trim(), command).not.toBe('')
      expect(typeof contract.exclusion_reason, command).toBe('string')
      expect(String(contract.exclusion_reason).trim(), command).toMatch(
        /delegat|wrapper|parser|pipeline/i,
      )
    }
  })

  it('matches package scripts byte-for-byte', () => {
    for (const [command, script] of Object.entries(EXPECTED_PACKAGE_SCRIPTS)) {
      expect(PACKAGE_JSON.scripts[command], command).toBe(script)
    }

    expect(Object.fromEntries(
      Object.keys(PACKAGE_JSON.scripts)
        .filter((command) => command.startsWith('bemoat:'))
        .sort()
        .map((command) => [command, PACKAGE_JSON.scripts[command]]),
    )).toEqual(
      Object.fromEntries(
        Object.entries(EXPECTED_PACKAGE_SCRIPTS).sort(([left], [right]) => left.localeCompare(right)),
      ),
    )
    expectRegistryValid()
  })

  it('gives every Tier A command one route or explicit exceptional record', () => {
    const routes = COMMAND_CONTRACT_REGISTRY.routes

    for (const [command, tier] of Object.entries(EXPECTED_COMMAND_TIERS)) {
      if (tier !== 'A') continue
      const contract = asRecord(getCommandContract(command), command)
      const commandRoutes = routes.filter((route: any) => route.canonical_command === command)
      const hasExplicitExceptionalRecord =
        contract.exceptional === true &&
        typeof contract.exclusion_reason === 'string' &&
        contract.exclusion_reason.trim().length > 0

      expect(
        commandRoutes.length > 0 || hasExplicitExceptionalRecord,
        `${command} must have a route or explicit exceptional record`,
      ).toBe(true)
    }

    for (const route of routes) {
      if (route.canonical_command !== null) {
        expect(Object.hasOwn(EXPECTED_COMMAND_TIERS, route.canonical_command)).toBe(true)
      }
    }
    expectRegistryValid()
  })

  const registryRejectionCases: Array<[string, (registry: RegistryFixture) => void]> = [
    ['missing schema field', (registry) => {
      delete commandRecord(registry, MUTATING_COMMAND).purpose
    }],
    ['extra command key', (registry) => {
      registry.commands['bemoat:fake'] = clone(commandRecord(registry, MUTATING_COMMAND))
    }],
    ['duplicate command identity', (registry) => {
      commandRecord(registry, MUTATING_COMMAND).command = 'bemoat:context'
    }],
    ['non-v1 schema', (registry) => {
      registry.schema_version = 2
    }],
    ['missing entrypoint', (registry) => {
      commandRecord(registry, MUTATING_COMMAND).entrypoint = 'scripts/not-an-entrypoint.mjs'
    }],
    ['stale package binding', (registry) => {
      commandRecord(registry, MUTATING_COMMAND).entrypoint = 'scripts/agent-context.ts'
    }],
    ['unclassified package command', (registry) => {
      delete registry.commands[MUTATING_COMMAND]
    }],
    ['Tier C custom parser', (registry) => {
      commandRecord(registry, 'bemoat:check').parser_owner = 'scripts/custom-parser.mjs'
    }],
    ['missing Tier C delegation rationale', (registry) => {
      commandRecord(registry, 'bemoat:check').exclusion_reason = null
    }],
    ['Tier A route removed', (registry) => {
      registry.routes = registry.routes.filter(
        (route) => route.canonical_command !== MUTATING_COMMAND,
      )
    }],
    ['duplicate singleton syntax', (registry) => {
      const inputs = commandRecord(registry, MUTATING_COMMAND).required_inputs as JsonRecord[]
      inputs[1].syntax = inputs[0].syntax
    }],
  ]

  it.each(registryRejectionCases)('rejects one registry drift mutation: %s', (_label, mutate) => {
    const registry = clone(COMMAND_CONTRACT_REGISTRY) as RegistryFixture
    mutate(registry)
    expectRegistryRejected(registry)
  })

  it('rejects an unregistered package command and a stale package binding fixture', () => {
    const unregisteredPackage = clone(PACKAGE_JSON)
    unregisteredPackage.scripts['bemoat:unregistered'] = 'node scripts/not-registered.mjs'
    expectRegistryRejected(clone(COMMAND_CONTRACT_REGISTRY), unregisteredPackage)

    const stalePackage = clone(PACKAGE_JSON)
    stalePackage.scripts['bemoat:mission-control:dispatch'] = 'node scripts/agent-context.ts'
    expectRegistryRejected(clone(COMMAND_CONTRACT_REGISTRY), stalePackage)
  })

  it('rejects caller input reclassified as trusted-derived', () => {
    const registry = clone(COMMAND_CONTRACT_REGISTRY) as RegistryFixture
    const command = commandRecord(registry, MUTATING_COMMAND)
    const issueNumber = (command.required_inputs as JsonRecord[]).find(
      (input) => input.name === 'issue_number',
    )
    if (!issueNumber) throw new Error('mutation command issue_number fixture is missing')

    issueNumber.source = 'trusted_derived'
    command.caller_supplied_values = (command.caller_supplied_values as string[])
      .filter((value) => value !== 'issue_number')
    command.trusted_derived_values = [
      'issue_number',
      ...(command.trusted_derived_values as string[]),
    ]

    expectRegistryRejected(registry)
  })
})
