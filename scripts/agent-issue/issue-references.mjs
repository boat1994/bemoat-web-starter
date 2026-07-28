export function parseIssueReference(reference, defaultRepo = null) {
  if (!reference) return null

  const trimmed = reference.trim()
  const repoMatch = trimmed.match(/^([\w.-]+\/[\w.-]+)#(\d+)$/)
  if (repoMatch) {
    return { repo: repoMatch[1], number: repoMatch[2] }
  }

  const hashMatch = trimmed.match(/#(\d+)/)
  if (hashMatch) {
    return { repo: defaultRepo, number: hashMatch[1] }
  }

  const bareNumber = trimmed.match(/^(\d+)$/)
  if (bareNumber) {
    return { repo: defaultRepo, number: bareNumber[1] }
  }

  return null
}

export function parsePrReference(reference) {
  if (!reference) return null

  const trimmed = reference.trim()
  const repoMatch = trimmed.match(/^([\w.-]+\/[\w.-]+)#(\d+)$/)
  if (repoMatch) {
    return { repo: repoMatch[1], number: repoMatch[2] }
  }

  const hashMatch = trimmed.match(/#(\d+)/)
  if (hashMatch) {
    return { number: hashMatch[1] }
  }

  const bareNumber = trimmed.match(/^(\d+)$/)
  if (bareNumber) {
    return { number: bareNumber[1] }
  }

  return null
}
