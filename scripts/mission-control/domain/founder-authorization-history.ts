import { createHash } from 'node:crypto'

type Comment = {
  id?: unknown
  body?: unknown
  issue_number?: unknown
  issue_url?: unknown
  user?: { login?: unknown } | null
  author?: { login?: unknown } | null
  author_login?: unknown
  created_at?: unknown
  updated_at?: unknown
}

type Context = {
  repository: string
  issueNumber: number
  protectedBaseSha: string
  policySource: string
  policyVersion: string
  policySha: string
  policySourceCommit: string
  founderLogin: string
}

type Dependencies = {
  looksAuthorizationShaped: (body: unknown) => boolean
  sameBody: (comment: Comment, body: string) => boolean
  assertUnmutatedComment: (comment: Comment, label: string) => void
  commentAuthor: (comment: Comment) => string
  hasAuthoritativeIssueIdentity: (comment: Comment, context: Context) => boolean
  parseFinalBody: (body: string, context: Context) => unknown
  validateReceipt: (comment: Comment, context: Context, authorizationId: string, bodySha256: string, mutationPerformed?: boolean) => void
  recordingError: (classification: string, message: string, mutationPerformed?: boolean) => Error
}

export type ClassifiedAuthorizationEvidence = Readonly<{ matches: Comment[]; historicalReceiptIds: Set<string> }>

export function classifyExistingAuthorizationComments(
  comments: readonly Comment[], context: Context, body: string, receipts: readonly Comment[], deps: Dependencies,
): ClassifiedAuthorizationEvidence {
  const matches: Comment[] = []; const historicalReceiptIds = new Set<string>(); let historicalPairs = 0
  for (const comment of comments) {
    if (!deps.looksAuthorizationShaped(comment.body)) continue
    if (deps.sameBody(comment, body)) {
      deps.assertUnmutatedComment(comment, 'authorization comment')
      if (!/^\d+$/.test(String(comment.id ?? '')) || deps.commentAuthor(comment) !== context.founderLogin || !deps.hasAuthoritativeIssueIdentity(comment, context)) throw deps.recordingError('STATE_CONFLICT', 'authorization evidence has an invalid identity or repository/Issue binding', false)
      matches.push(comment); continue
    }
    let parsed: Record<string, unknown>
    try { parsed = JSON.parse(String(comment.body ?? '')) } catch { throw deps.recordingError('STATE_CONFLICT', 'conflicting, malformed, or semantically different authorization evidence already exists', false) }
    const protectedBaseSha = parsed.protected_base_sha
    if (typeof protectedBaseSha !== 'string' || !/^[0-9a-f]{40}$/.test(protectedBaseSha) || protectedBaseSha === context.protectedBaseSha) throw deps.recordingError('STATE_CONFLICT', 'conflicting, malformed, or semantically different authorization evidence already exists', false)
    const historicalContext = { ...context, protectedBaseSha, policySourceCommit: protectedBaseSha }
    try { deps.parseFinalBody(String(comment.body ?? ''), historicalContext) } catch { throw deps.recordingError('STATE_CONFLICT', 'conflicting, malformed, or semantically different authorization evidence already exists', false) }
    deps.assertUnmutatedComment(comment, 'authorization comment')
    if (!/^\d+$/.test(String(comment.id ?? '')) || deps.commentAuthor(comment) !== context.founderLogin || !deps.hasAuthoritativeIssueIdentity(comment, context)) throw deps.recordingError('STATE_CONFLICT', 'authorization evidence has an invalid identity or repository/Issue binding', false)
    const authorizationId = String(comment.id); const authorizationBodySha256 = createHash('sha256').update(String(comment.body), 'utf8').digest('hex')
    const matchingReceipts = receipts.filter((receipt) => { try { deps.validateReceipt(receipt, historicalContext, authorizationId, authorizationBodySha256, false); return true } catch { return false } })
    if (matchingReceipts.length !== 1) throw deps.recordingError('STATE_CONFLICT', 'older authorization evidence is incomplete or has conflicting receipts', false)
    if (++historicalPairs > 1) throw deps.recordingError('STATE_CONFLICT', 'multiple complete historical authorization pairs are durable', false)
    historicalReceiptIds.add(String(matchingReceipts[0].id))
  }
  return { matches, historicalReceiptIds }
}
