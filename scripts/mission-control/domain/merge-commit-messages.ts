function blockedExternal(message: string): Error {
  return new Error(`BLOCKED_EXTERNAL: ${message}`)
}

function property(value: unknown, key: string): unknown {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return undefined
  return Reflect.get(value, key)
}

export type NormalizedCommitMessage = {
  messageHeadline: string
  messageBody: string
}

export function normalizePaginatedCommitMessages(pages: unknown): NormalizedCommitMessage[] {
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
    throw blockedExternal('GitHub PR commit pagination did not return complete page arrays')
  }
  return pages.flat().map((entry) => {
    const message = String(property(property(entry, 'commit'), 'message') ?? '')
    const [messageHeadline = '', ...bodyLines] = message.split('\n')
    return { messageHeadline, messageBody: bodyLines.join('\n') }
  })
}
