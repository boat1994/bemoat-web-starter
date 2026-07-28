export function parseAgentIssueArgs(argv = process.argv.slice(2)) {
  const tokens = argv.filter((arg) => arg !== '--')
  let phase = null
  const positional = []

  for (let index = 0; index < tokens.length; index += 1) {
    const argument = tokens[index]
    if (argument === '--phase') {
      const value = tokens[index + 1]
      if (!value || value.startsWith('-')) {
        return { error: '--phase requires a value' }
      }
      if (phase) return { error: '--phase may be provided only once' }
      phase = value
      index += 1
      continue
    }
    if (argument.startsWith('-')) {
      return { error: `unexpected argument: ${argument}` }
    }
    positional.push(argument)
  }

  if (positional.length !== 1 || !/^[1-9]\d*$/.test(positional[0])) {
    return { error: 'missing or invalid issue number' }
  }
  if (phase !== null && phase !== 'correction') {
    return { error: '--phase supports only correction' }
  }

  return { issueNumber: positional[0], phase }
}
