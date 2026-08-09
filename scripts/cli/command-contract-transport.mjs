function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function validateTransportBindings(commands, transports) {
  const errors = []

  if (!Array.isArray(transports)) {
    errors.push('transports must be the canonical transport array')
    return errors
  }

  const seenCommands = new Set()
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
    if (seenCommands.has(transport.command)) {
      errors.push(`transports contains duplicate command ${transport.command}`)
    }
    seenCommands.add(transport.command)
    const contract = commands[transport.command]
    if (!contract) {
      errors.push(`transport command is not registered: ${transport.command}`)
      continue
    }
    if (contract.transport_role !== transport.role) {
      errors.push(`${transport.command} transport role differs from canonical authority`)
    }
    if (contract.exceptional !== transport.exceptional) {
      errors.push(`${transport.command} transport exceptional bit differs from canonical authority`)
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
