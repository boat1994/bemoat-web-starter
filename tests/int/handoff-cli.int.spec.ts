import { describe, expect, it } from 'vitest'

import { runCliBoundaryCase } from '../helpers/cli-boundary-harness'
import { createHelpEnvelopeV1 } from '../../scripts/cli/command-help.ts'
import { getCommandContract } from '../../scripts/cli/command-contract.ts'

describe('bemoat:handoff public CLI contract', () => {
  it('characterizes the future TypeScript help boundary and lifecycle identity', () => {
    const result = runCliBoundaryCase({
      entrypoint: 'scripts/agent-handoff.ts',
      argv: ['--help', '--json'],
      env: { BEMOAT_FACADE_COMMAND: 'bemoat:handoff', BEMOAT_FACADE_ENTRYPOINT: 'scripts/agent-handoff.ts', npm_lifecycle_event: 'bemoat:handoff' },
    })

    expect(result.error).toBeNull()
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ command: 'bemoat:handoff', mode: 'help', classification: 'HELP' })
    expect(result.stderr).toBe('')
    expect(result.filesystem_unchanged).toBe(true)
    expect(result.poison_invocations).toEqual([])
  })

  it('characterizes the future TypeScript handoff validation boundary before mutation', () => {
    const result = runCliBoundaryCase({
      entrypoint: 'scripts/agent-handoff.ts',
      argv: ['410', '--body-file', 'missing.json', '--json'],
      env: { BEMOAT_FACADE_COMMAND: 'bemoat:handoff', BEMOAT_FACADE_ENTRYPOINT: 'scripts/agent-handoff.ts', npm_lifecycle_event: 'bemoat:handoff' },
    })

    expect(result.error).toBeNull()
    expect(result.status).toBe(2)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toMatchObject({ classification: 'INVALID_INVOCATION', mutation_performed: false })
    expect(result.filesystem_unchanged).toBe(true)
    expect(result.poison_invocations).toEqual([])
  })

  it('is discoverable as a write-capable command with strict readback boundaries', () => {
    const contract = getCommandContract('bemoat:handoff')

    expect(contract).not.toBeNull()
    expect(contract).toMatchObject({
      command: 'bemoat:handoff',
      tier: 'A',
      entrypoint: 'scripts/agent-handoff.ts',
      writes: ['exactly one top-level Issue HANDOFF comment; no other protocol mutation'],
      last_validation_before_mutation: expect.stringMatching(/runtime-generated PASS proof.*exact HEAD/i),
      post_write_readback: expect.stringMatching(/read back|exact/i),
    })
    expect(contract?.required_evidence).toContain(
      'Runtime-generated PASS proof bound to the selected tier, canonical command, and exact HEAD; read_only uses tier `read-only` and `pnpm run bemoat:guard:safety`.',
    )
    expect(contract?.operation).toMatch(/schema-v2.*read_only.*empty protected-base diff.*safety validation/i)

    const help = createHelpEnvelopeV1(contract)
    expect(help.command).toBe('bemoat:handoff')
    expect(help.writes).toEqual(['exactly one top-level Issue HANDOFF comment; no other protocol mutation'])
  })

  it('declares the only supported invocation shape', () => {
    const contract = getCommandContract('bemoat:handoff')
    expect(contract?.required_inputs.map((input) => input.name)).toEqual(['issue_number', 'body_file'])
    expect(contract?.optional_flags).toEqual([])
  })
})
