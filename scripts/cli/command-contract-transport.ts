import type { CanonicalTransportRoute } from '../mission-control/transport-registry.js'

export type CommandContractTransportSubset = {
  readonly transport_role: string | null
  readonly exceptional: boolean
}

export type CommandContractDictionarySubset = Readonly<
  Record<string, Readonly<CommandContractTransportSubset>>
>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function validateTransportBindings(
  commands: CommandContractDictionarySubset,
  transports: unknown,
): string[] {
  const errors: string[] = []

  if (!Array.isArray(transports)) {
    errors.push('transports must be the canonical transport array')
    return errors
  }

  const seenCommands = new Set<string>()
  for (const [index, transport] of transports.entries()) {
    if (
      !isRecord(transport) ||
      typeof transport.command !== 'string' ||
      typeof transport.role !== 'string' ||
      typeof transport.exceptional !== 'boolean'
    ) {
      errors.push(`transports[${index}] has invalid ownership fields`)
      continue
    }

    // The boundary validation above guarantees these fields exist and match the
    // shape expected for CanonicalTransportRoute routing.
    const route = transport as Pick<CanonicalTransportRoute, 'command' | 'role' | 'exceptional'>

    if (seenCommands.has(route.command)) {
      errors.push(`transports contains duplicate command ${route.command}`)
    }
    seenCommands.add(route.command)

    const contract = commands[route.command]
    if (!contract) {
      errors.push(`transport command is not registered: ${route.command}`)
      continue
    }

    if (contract.transport_role !== route.role) {
      errors.push(`${route.command} transport role differs from canonical authority`)
    }
    if (contract.exceptional !== route.exceptional) {
      errors.push(`${route.command} transport exceptional bit differs from canonical authority`)
    }
  }

  for (const [command, contract] of Object.entries(commands)) {
    if (!seenCommands.has(command) && contract.transport_role !== null) {
      errors.push(`${command} claims a transport role without a canonical transport`)
    }
    if (seenCommands.has(command) && contract.transport_role === null) {
      errors.push(`${command} is bound by a canonical transport but has no transport role`)
    }
    if (!seenCommands.has(command) && contract.exceptional !== false) {
      errors.push(`${command} is exceptional without a canonical transport`)
    }
  }

  return errors
}
