// Pure PR identity parsing and validation; orchestration remains in its callers.
function asciiCaseFold(value) {
  return String(value).toLowerCase()
}

function foldedPrIdentityKey(owner, repo, number) {
  return `${asciiCaseFold(owner)}/${asciiCaseFold(repo)}#${number}`
}

/**
 * Parse one complete GitHub pull URL without normalizing or repairing it.
 */
export function parseCompleteGitHubPullUrl(raw) {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { ok: false, reason: 'live PR identity URL is missing or empty' }
  }
  if (raw !== raw.trim() || /[\s\u00a0\u2000-\u200b\u2028\u2029\u3000]/.test(raw)) {
    return { ok: false, reason: 'live PR identity URL contains whitespace' }
  }
  if (/[\u0000-\u001f\u007f\u0080-\u009f\\%]/.test(raw) || /\p{Cc}|\p{Cf}/u.test(raw)) {
    return { ok: false, reason: 'live PR identity URL contains forbidden raw characters' }
  }
  if (!raw.startsWith('https://')) {
    return { ok: false, reason: 'live PR identity URL must use literal lowercase https' }
  }

  const afterScheme = raw.slice('https://'.length)
  const slashIdx = afterScheme.indexOf('/')
  if (slashIdx <= 0) return { ok: false, reason: 'live PR identity URL authority is malformed' }
  const rawAuthority = afterScheme.slice(0, slashIdx)
  if (rawAuthority.includes('@') || rawAuthority.includes(':') || rawAuthority.includes('[')) {
    return { ok: false, reason: 'live PR identity URL must not include userinfo or port' }
  }
  if (asciiCaseFold(rawAuthority) !== 'github.com') {
    return { ok: false, reason: 'live PR identity URL host must be github.com' }
  }

  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    return { ok: false, reason: 'live PR identity URL is present but unparseable' }
  }
  if (parsed.protocol !== 'https:') return { ok: false, reason: 'live PR identity URL must use https' }
  if (parsed.hostname !== 'github.com') return { ok: false, reason: 'live PR identity URL host must be github.com' }
  if (parsed.username || parsed.password || parsed.port) {
    return { ok: false, reason: 'live PR identity URL must not include credentials or port' }
  }
  if (parsed.search || parsed.hash) {
    return { ok: false, reason: 'live PR identity URL must not include query or fragment' }
  }

  const rawPath = afterScheme.slice(slashIdx)
  if (rawPath !== parsed.pathname) {
    return { ok: false, reason: 'live PR identity URL path is not a complete canonical value' }
  }
  const segments = parsed.pathname.split('/')
  if (segments.length !== 5 || segments[0] !== '') {
    return { ok: false, reason: 'live PR identity URL path structure is invalid' }
  }
  const [, owner, repo, pullLiteral, number] = segments
  if (pullLiteral !== 'pull') return { ok: false, reason: 'live PR identity URL path must include /pull/' }
  if (!owner || !repo || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) {
    return { ok: false, reason: 'live PR identity URL owner/repository must be ASCII path segments' }
  }
  if (!/^[1-9][0-9]*$/.test(number)) {
    return { ok: false, reason: 'live PR identity URL pull number must be a positive integer' }
  }
  if (rawPath !== `/${owner}/${repo}/pull/${number}`) {
    return { ok: false, reason: 'live PR identity URL path is not a complete canonical value' }
  }
  return { ok: true, identity: { owner, repo, number, key: foldedPrIdentityKey(owner, repo, number) } }
}

function isGitHubReviewDiscussionFragment(fragment) {
  return typeof fragment === 'string' && /^#discussion_r[0-9]+$/i.test(fragment)
}

function isSourceThreadDiscussionPointer(candidate, canonicalIdentity, knownSourceThreads = null) {
  if (typeof candidate !== 'string' || candidate.length === 0 || !canonicalIdentity) return false
  const hashIdx = candidate.indexOf('#')
  if (hashIdx < 0 || !isGitHubReviewDiscussionFragment(candidate.slice(hashIdx))) return false
  const parsed = parseCompleteGitHubPullUrl(candidate.slice(0, hashIdx))
  if (!parsed.ok) return false
  if (canonicalIdentity.none === true) return Boolean(knownSourceThreads?.has(candidate))
  return parsed.identity.key === foldedPrIdentityKey(
    canonicalIdentity.owner,
    canonicalIdentity.repo,
    canonicalIdentity.number,
  )
}

function isPlausiblePullIdentityCandidate(candidate) {
  if (typeof candidate !== 'string' || candidate.length === 0) return false
  return /^https:\/\//i.test(candidate) ? /\/pull\//i.test(candidate) : /^\/(?:[\w.-]+\/[\w.-]+\/)?pull\//i.test(candidate)
}

const CANONICAL_PR_TARGET_LINE_RE = /\*\*PR\s*\/\s*base\s*\/\s*head:\*\*([^\n]*)/gi

export function extractVerdictPrBaseAndHead(verdictBody) {
  let match = verdictBody.match(/\*\*PR\s*\/\s*base\s*\/\s*head:\*\*[^\n]*·\s*`([^`]+)`\s*·\s*`([0-9a-f]{7,40})`/i)
  if (!match) {
    match = verdictBody.match(/\*\*PR\s*\/\s*base\s*\/\s*head:\*\*[^\n]*·\s*(?:base\s+)?`?([^`\s·]+)`?\s*·\s*(?:head\s+)?`?([0-9a-f]{7,40})`?/i)
  }
  return { base: match?.[1]?.trim() ?? null, head: match?.[2] ?? null }
}

function extractCanonicalPrTargetLines(verdictBody) {
  return [...verdictBody.matchAll(CANONICAL_PR_TARGET_LINE_RE)].map((match) => match[1] ?? '')
}

function collectMalformedPrIdentityCandidates(verdictBody, canonicalIdentity = null, knownSourceThreads = null) {
  const malformedCandidates = []
  const seenMalformed = new Set()
  const consider = (rawCandidate) => {
    let candidate = rawCandidate.replace(/[),.;:]+$/g, '')
    const hashIdx = candidate.indexOf('#')
    if (hashIdx >= 0 && isGitHubReviewDiscussionFragment(candidate.slice(hashIdx))) {
      if (isSourceThreadDiscussionPointer(candidate, canonicalIdentity, knownSourceThreads)) return
      candidate = candidate.slice(0, hashIdx)
    }
    if (!isPlausiblePullIdentityCandidate(candidate)) return
    const parsed = parseCompleteGitHubPullUrl(candidate)
    if (!parsed.ok && !seenMalformed.has(candidate)) {
      seenMalformed.add(candidate)
      malformedCandidates.push({ candidate, reason: parsed.reason, source: 'url' })
    }
  }
  for (const match of verdictBody.matchAll(/https:\/\/[^\s"'<>\]]+/gi)) consider(match[0])
  for (const match of verdictBody.matchAll(/(?:^|[\s"'<>(\[])(\/(?:[\w.-]+\/[\w.-]+\/)?pull\/[^\s"'<>\]]*)/gi)) consider(match[1])
  return { malformedCandidates }
}

function parseCanonicalPrTargetLine(line, defaultRepo) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.toLowerCase().startsWith('none')) return { ok: true, none: true, identity: { none: true } }
  if (!defaultRepo || !defaultRepo.includes('/')) {
    return { ok: false, errors: ['current repository identity is unavailable for PR reconciliation'] }
  }
  const [defaultOwner, defaultRepoName] = defaultRepo.split('/')
  const identities = []
  const firstToken = trimmed.split(/\s+/)[0] ?? ''
  const parsedLineUrl = parseCompleteGitHubPullUrl(firstToken)
  if (parsedLineUrl.ok) identities.push(parsedLineUrl.identity)
  for (const match of trimmed.matchAll(/\bPR\s*#([1-9][0-9]*)\b/gi)) {
    const number = match[1]
    identities.push({ owner: defaultOwner, repo: defaultRepoName, number, key: foldedPrIdentityKey(defaultOwner, defaultRepoName, number) })
  }
  for (const match of trimmed.matchAll(/https:\/\/[^\s·]+/gi)) {
    const parsed = parseCompleteGitHubPullUrl(match[0])
    if (parsed.ok) identities.push(parsed.identity)
  }
  const distinctKeys = [...new Set(identities.map((identity) => identity.key))]
  if (distinctKeys.length > 1) {
    return { ok: false, errors: [`REVIEW_VERDICT canonical \`PR / base / head\` field contains multiple distinct PR identities (${distinctKeys.join(', ')})`] }
  }
  if (identities.length === 0) {
    if (!parsedLineUrl.ok && firstToken && isPlausiblePullIdentityCandidate(firstToken)) {
      return { ok: false, errors: [`REVIEW_VERDICT contains malformed PR identity evidence (${firstToken})`] }
    }
    return { ok: false, errors: ['REVIEW_VERDICT does not uniquely identify a live PR by number or URL'] }
  }
  const canonical = identities[0]
  const canonicalKey = foldedPrIdentityKey(canonical.owner, canonical.repo, canonical.number)
  if (asciiCaseFold(canonical.owner) !== asciiCaseFold(defaultOwner) || asciiCaseFold(canonical.repo) !== asciiCaseFold(defaultRepoName)) {
    return { ok: false, errors: [`REVIEW_VERDICT PR identity ${canonicalKey} does not match the current repository ${defaultRepo}`] }
  }
  return { ok: true, none: false, identity: { owner: defaultOwner, repo: defaultRepoName, number: canonical.number, key: foldedPrIdentityKey(defaultOwner, defaultRepoName, canonical.number) } }
}

function validateFindingSourceThreads(canonicalIdentity, contract) {
  const errors = []
  if (!contract?.findings?.length || canonicalIdentity?.none) return { ok: true, errors }
  for (const finding of contract.findings) {
    const thread = typeof finding.source_thread === 'string' ? finding.source_thread.trim() : ''
    if (!thread) continue
    const hashIdx = thread.indexOf('#')
    const parsed = parseCompleteGitHubPullUrl(hashIdx >= 0 ? thread.slice(0, hashIdx) : thread)
    if (!parsed.ok) errors.push(`finding ${finding.id} source_thread is not a complete canonical pull URL`)
    else if (parsed.identity.key !== canonicalIdentity.key) errors.push(`finding ${finding.id} source_thread PR identity ${parsed.identity.key} does not match canonical REVIEW_VERDICT target ${canonicalIdentity.key}`)
  }
  return { ok: errors.length === 0, errors }
}

export function resolveCanonicalVerdictPrIdentity(verdictBody, defaultRepo, mode = 'implementation_pr', knownSourceThreads = null, contract = null) {
  if (!defaultRepo || !defaultRepo.includes('/')) return { ok: false, errors: ['current repository identity is unavailable for PR reconciliation'] }
  const canonicalLines = extractCanonicalPrTargetLines(verdictBody)
  if (canonicalLines.length === 0) return { ok: false, errors: ['REVIEW_VERDICT is missing a `PR / base / head` line with an exact head SHA'] }
  if (canonicalLines.length > 1) return { ok: false, errors: ['REVIEW_VERDICT contains multiple canonical `PR / base / head` fields'] }
  const parsedTarget = parseCanonicalPrTargetLine(canonicalLines[0], defaultRepo)
  if (!parsedTarget.ok) return { ok: false, errors: parsedTarget.errors }
  if (mode === 'planning_no_pr') {
    if (!parsedTarget.none) return { ok: false, errors: ['REVIEW_VERDICT does not uniquely identify a live PR by number or URL'] }
    const { malformedCandidates } = collectMalformedPrIdentityCandidates(verdictBody, { none: true }, knownSourceThreads)
    if (malformedCandidates.length > 0) return { ok: false, errors: [`REVIEW_VERDICT contains malformed PR identity evidence (${malformedCandidates.slice(0, 3).map((entry) => entry.candidate).join(', ')})`] }
    return { ok: true, identity: { none: true } }
  }
  if (parsedTarget.none) return { ok: false, errors: ['REVIEW_VERDICT does not uniquely identify a live PR by number or URL'] }
  const canonical = parsedTarget.identity
  const { malformedCandidates } = collectMalformedPrIdentityCandidates(verdictBody, canonical, knownSourceThreads)
  if (malformedCandidates.length > 0) return { ok: false, errors: [`REVIEW_VERDICT contains malformed PR identity evidence (${malformedCandidates.slice(0, 3).map((entry) => entry.candidate).join(', ')})`] }
  const sourceThreadCheck = validateFindingSourceThreads(canonical, contract)
  if (!sourceThreadCheck.ok) return { ok: false, errors: sourceThreadCheck.errors }
  return { ok: true, identity: canonical }
}

export function collectKnownSourceThreads(contract) {
  return new Set((contract?.findings ?? []).map((finding) => typeof finding.source_thread === 'string' ? finding.source_thread.trim() : '').filter(Boolean))
}
