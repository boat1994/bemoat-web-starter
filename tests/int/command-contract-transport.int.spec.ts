import { describe, expect, it } from 'vitest'

import { COMMAND_CONTRACT_REGISTRY } from '../../scripts/cli/command-contract-registry.mjs'
import { CANONICAL_TRANSPORTS } from '../../scripts/mission-control/transport-registry.mjs'

type TransportValidator = (
  commands: Record<string, Record<string, unknown>>,
  transports: Array<Record<string, unknown>>,
) => string[]

async function loadTransportValidator(): Promise<TransportValidator | undefined> {
  const modulePath = '../../scripts/cli/' + 'command-contract-transport.mjs'
  const transportModule = await import(/* @vite-ignore */ modulePath).catch((): null => null)
  return transportModule?.validateTransportBindings as TransportValidator | undefined
}

describe('command contract transport binding validator', () => {
  it('accepts the canonical transport bindings without changing inputs', async () => {
    const validateTransportBindings = await loadTransportValidator()
    expect(validateTransportBindings).toEqual(expect.any(Function))
    if (!validateTransportBindings) throw new Error('transport validator was not loaded')

    const commands = structuredClone(COMMAND_CONTRACT_REGISTRY.commands) as Record<string, Record<string, unknown>>
    const transports = structuredClone(CANONICAL_TRANSPORTS).map(
      (transport) => ({ ...transport }) as Record<string, unknown>,
    )
    const before = structuredClone({ commands, transports })

    expect(validateTransportBindings(commands, transports)).toEqual([])
    expect({ commands, transports }).toEqual(before)
  })

  it('preserves deterministic mismatch diagnostics without changing inputs', async () => {
    const validateTransportBindings = await loadTransportValidator()
    expect(validateTransportBindings).toEqual(expect.any(Function))
    if (!validateTransportBindings) throw new Error('transport validator was not loaded')

    const commands = structuredClone(COMMAND_CONTRACT_REGISTRY.commands) as Record<string, Record<string, unknown>>
    const transports = structuredClone(CANONICAL_TRANSPORTS).map(
      (transport) => ({ ...transport }) as Record<string, unknown>,
    )
    const firstTransport = transports[0]
    const before = structuredClone({ commands, transports })
    firstTransport.role = 'INVALID_ROLE'

    expect(validateTransportBindings(commands, transports)).toEqual([
      `${firstTransport.command} transport role differs from canonical authority`,
    ])
    expect(commands).toEqual(before.commands)
  })
})
