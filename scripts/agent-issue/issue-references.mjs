function unwrapManagedReferenceQuotes(value) {
  let current = String(value).trim()
  // Managed-state YAML may preserve one or more quoted layers, e.g. '"#226"'.
  while (
    current.length >= 2 &&
    ((current.startsWith('"') && current.endsWith('"')) ||
      (current.startsWith("'") && current.endsWith("'")))
  ) {
    current = current.slice(1, -1).trim()
  }
  return current
}

function isSafePositiveIssueNumber(digits) {
  if (!/^[1-9]\d*$/.test(digits)) return false
  const number = Number(digits)
  return Number.isSafeInteger(number) && number > 0
}

function normalizeReferenceInput(reference) {
  if (reference == null || reference === '') return null
  if (typeof reference === 'number') {
    if (!Number.isSafeInteger(reference) || reference <= 0) return null
    return String(reference)
  }
  if (typeof reference !== 'string') return null
  const unwrapped = unwrapManagedReferenceQuotes(reference)
  return unwrapped === '' ? null : unwrapped
}

export function parseIssueReference(reference, defaultRepo = null) {
  const trimmed = normalizeReferenceInput(reference)
  if (!trimmed) return null

  const repoMatch = trimmed.match(/^([\w.-]+\/[\w.-]+)#(\d+)$/)
  if (repoMatch && isSafePositiveIssueNumber(repoMatch[2])) {
    return { repo: repoMatch[1], number: repoMatch[2] }
  }

  const hashMatch = trimmed.match(/^#(\d+)$/)
  if (hashMatch && isSafePositiveIssueNumber(hashMatch[1])) {
    return { repo: defaultRepo, number: hashMatch[1] }
  }

  const bareNumber = trimmed.match(/^(\d+)$/)
  if (bareNumber && isSafePositiveIssueNumber(bareNumber[1])) {
    return { repo: defaultRepo, number: bareNumber[1] }
  }

  return null
}

export function parsePrReference(reference) {
  const trimmed = normalizeReferenceInput(reference)
  if (!trimmed) return null

  const repoMatch = trimmed.match(/^([\w.-]+\/[\w.-]+)#(\d+)$/)
  if (repoMatch && isSafePositiveIssueNumber(repoMatch[2])) {
    return { repo: repoMatch[1], number: repoMatch[2] }
  }

  const hashMatch = trimmed.match(/^#(\d+)$/)
  if (hashMatch && isSafePositiveIssueNumber(hashMatch[1])) {
    return { number: hashMatch[1] }
  }

  const bareNumber = trimmed.match(/^(\d+)$/)
  if (bareNumber && isSafePositiveIssueNumber(bareNumber[1])) {
    return { number: bareNumber[1] }
  }

  return null
}

export function resolveIssueNumber(reference, defaultRepo = null) {
  const parsed = parseIssueReference(reference, defaultRepo)
  return parsed ? Number(parsed.number) : null
}

export function resolvePrNumber(reference) {
  const parsed = parsePrReference(reference)
  return parsed ? Number(parsed.number) : null
}
