function blockedExternal(message) {
  return new Error(`BLOCKED_EXTERNAL: ${message}`)
}

export function normalizePaginatedCommitMessages(pages) {
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
    throw blockedExternal('GitHub PR commit pagination did not return complete page arrays')
  }
  return pages.flat().map((entry) => {
    const message = String(entry?.commit?.message ?? '')
    const [messageHeadline = '', ...bodyLines] = message.split('\n')
    return { messageHeadline, messageBody: bodyLines.join('\n') }
  })
}
