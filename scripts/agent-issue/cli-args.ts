export type ParseAgentIssueArgsSuccess = {
  issueNumber: string
  phase: null | 'correction'
}

export type ParseAgentIssueArgsFailure = {
  error: string
}

export type ParseAgentIssueArgsResult = ParseAgentIssueArgsSuccess | ParseAgentIssueArgsFailure

export function parseAgentIssueArgs(
  argv: unknown = undefined,
): ParseAgentIssueArgsResult {
  const tokens = (argv === undefined ? process.argv.slice(2) : (argv as unknown[])).filter(
    (arg: unknown) => arg !== '--',
  )
  let phase: null | string = null
  const positional: unknown[] = []

  for (let index = 0; index < tokens.length; index += 1) {
    const argument = tokens[index]
    if (argument === '--phase') {
      const value = tokens[index + 1]
      if (
        !value ||
        (value as string).startsWith('-')
      ) {
        return { error: '--phase requires a value' }
      }
      if (phase) return { error: '--phase may be provided only once' }
      phase = value as string
      index += 1
      continue
    }
    if ((argument as string).startsWith('-')) {
      return { error: `unexpected argument: ${argument}` }
    }
    positional.push(argument)
  }

  if (positional.length !== 1 || !/^[1-9]\d*$/.test(positional[0] as string)) {
    return { error: 'missing or invalid issue number' }
  }
  if (phase !== null && phase !== 'correction') {
    return { error: '--phase supports only correction' }
  }

  return { issueNumber: positional[0] as string, phase: phase as null | 'correction' }
}
