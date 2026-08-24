import { describe, expect, it } from 'vitest'

import { createHelpEnvelopeV1 } from '../../scripts/cli/command-help.mjs'
import { getCommandContract } from '../../scripts/cli/command-contract.mjs'

describe('bemoat:handoff public CLI contract', () => {
  it('is discoverable as a write-capable command with strict readback boundaries', () => {
    const contract = getCommandContract('bemoat:handoff')

    expect(contract).not.toBeNull()
    expect(contract).toMatchObject({
      command: 'bemoat:handoff',
      tier: 'A',
      entrypoint: 'scripts/agent-handoff.mjs',
      writes: ['exactly one top-level Issue HANDOFF comment; no other protocol mutation'],
      last_validation_before_mutation: expect.stringMatching(/repository|Issue|head|PR/i),
      post_write_readback: expect.stringMatching(/read back|exact/i),
    })

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
