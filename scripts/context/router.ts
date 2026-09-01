import type {
  ActivePullRequestEvidence,
  ContextDecision,
  NormalizedContextEvidence,
} from './model.ts'
import { isFullSha, isPositiveInteger, isRepositoryObjectUrl } from './runtime.ts'
import { parseProductionMergeReviewVerdict, classifyMergeReviewVerdict } from './merge-review-verdict.ts'

function evidenceUrls(evidence: NormalizedContextEvidence): string[] {
  const urls = [
    evidence.repository.url,
    evidence.protectedBase.url,
    evidence.policy.url,
    evidence.issue.url,
  ]
  const activePr = evidence.activePr
  if (activePr && !Array.isArray(activePr)) urls.push(activePr.url)
  return [...new Set(urls)]
}

function decision(
  evidence: NormalizedContextEvidence,
  route: ContextDecision['route'],
  reasons: string[],
  nextAction: ContextDecision['nextAction'],
): ContextDecision {
  return {
    route,
    reasons: [...new Set(reasons)],
    nextAction,
    evidenceUrls: evidenceUrls(evidence),
  }
}

function commandAction(description: string): ContextDecision['nextAction'] {
  return { type: 'COMMAND', command: null, description }
}

function identityErrors(evidence: NormalizedContextEvidence): string[] {
  const errors: string[] = []
  const repo = evidence.repository?.nameWithOwner ?? ''
  if (!evidence.issue || typeof evidence.issue.number !== 'string' || !isPositiveInteger(evidence.issue.number)) {
    errors.push('EVIDENCE_CONFLICT: Issue identity is missing or malformed')
  }
  if (!evidence.issue || typeof evidence.issue.title !== 'string' || typeof evidence.issue.state !== 'string' || !evidence.issue.title.trim() || !evidence.issue.state.trim() || !isRepositoryObjectUrl(evidence.issue.url, repo, 'issues', evidence.issue.number)) {
    errors.push('EVIDENCE_CONFLICT: Issue identity fields are missing or empty')
  }
  if (evidence.issue && !evidence.issue.workflowProfile) {
    errors.push('EVIDENCE_CONFLICT: Issue workflow profile cannot be derived from task size and Mission Control mode')
  }

  if (!evidence.protectedBase || !evidence.protectedBase.branch.trim() || !isFullSha(evidence.protectedBase.sha)) {
    errors.push('EVIDENCE_CONFLICT: protected base identity is missing or malformed')
  }

  const active = Array.isArray(evidence.activePr) ? evidence.activePr : evidence.activePr ? [evidence.activePr] : []
  for (const pr of active) {
    const number = pr && typeof pr.number === 'string' ? pr.number : '<unknown>'
    if (!pr || typeof pr.number !== 'string' || !isPositiveInteger(pr.number) || !isRepositoryObjectUrl(pr.url, repo, 'pull', pr.number) || typeof pr.headBranch !== 'string' || !pr.headBranch.trim() || !isFullSha(pr.headSha) || typeof pr.state !== 'string' || !pr.state.trim()) {
      errors.push(`EVIDENCE_CONFLICT: PR identity for #${number} is missing or malformed`)
    }
    const stateMerged = pr?.state?.toUpperCase() === 'MERGED'
    const mergeCommitPresent = pr?.mergeCommitSha !== null && pr?.mergeCommitSha !== undefined
    const validMergeCommit = typeof pr?.mergeCommitSha === 'string' && isFullSha(pr.mergeCommitSha)
    if (!pr || Boolean(pr.merged) !== stateMerged || (stateMerged ? !validMergeCommit : mergeCommitPresent)) {
      errors.push(`EVIDENCE_CONFLICT: PR #${number} state and merge commit evidence disagree`)
    }
    const merged = stateMerged && Boolean(pr?.merged) && validMergeCommit
    if (!pr || typeof pr.baseBranch !== 'string' || !pr.baseBranch.trim() || typeof pr.baseSha !== 'string' || !isFullSha(pr.baseSha) || pr.baseBranch !== evidence.protectedBase.branch || (!merged && pr.baseSha.toLowerCase() !== evidence.protectedBase.sha.toLowerCase())) {
      errors.push(`EVIDENCE_CONFLICT: PR #${number} base identity is missing or malformed`)
    }
    if (merged && (!pr || typeof pr.mergeCommitSha !== 'string' || !isFullSha(pr.mergeCommitSha))) {
      errors.push(`EVIDENCE_CONFLICT: PR #${number} merge commit identity is missing or malformed`)
    }
  }
  return errors
}

function reviewedHeadForApplicability(body: string): string | null {
  // A parse failure is ignorable only when the recognized head proves that the
  // malformed record belongs to an older PR head. Unknown or ambiguous heads
  // remain fail-closed below.
  const candidates: string[] = []
  const canonicalLines = [...body.matchAll(/^\*\*PR \/ base \/ head:\*\*[ \t]*(.*)$/gm)]
  for (const line of canonicalLines) {
    const target = line[1]?.match(/^[^\r\n]*?\s*·\s*`[^`\r\n@]+`\s*·\s*`([^`\r\n]+)`[ \t]*$/)?.[1]
    if (!target || !isFullSha(target)) return null
    candidates.push(target.toLowerCase())
  }

  const exactHeadLines = [...body.matchAll(/^\*\*(?:Exact head reviewed|Exact reviewed head):\*\*[ \t]*(.*)$/gim)]
  for (const line of exactHeadLines) {
    const match = line[1]?.match(/^[ \t]*(?:`([0-9a-f]{40})`|([0-9a-f]{40}))[ \t]*$/i)
    const target = match?.[1] ?? match?.[2]
    if (!target) return null
    candidates.push(target.toLowerCase())
  }

  const unique = [...new Set(candidates)]
  return unique.length === 1 ? unique[0] ?? null : null
}

function hasBlockingFinding(body: string, expectedHead: string): boolean {
  const section = body.match(/###\s+Immutable finding disposition\s*\n([\s\S]*?)(?=\n###|\n##|$)/i)?.[1] ?? ''
  const fenced = [...section.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)]
  if (fenced.length > 1) return false
  const serialized = fenced[0]?.[1]
    ?? section.match(/`(\{[\s\S]*\})`/)?.[1]
  if (!serialized) return false

  try {
    const parsed: unknown = JSON.parse(serialized)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
    const record = parsed as { schema_version?: unknown; reviewed_head?: unknown; findings?: unknown }
    if (record.schema_version !== 1 || typeof record.reviewed_head !== 'string' ||
      record.reviewed_head.toLowerCase() !== expectedHead.toLowerCase()) return false
    const findings = record.findings
    if (!Array.isArray(findings) || findings.length === 0) return false
    const findingIds = new Set<string>()
    return findings.every((finding) => {
      if (!finding || typeof finding !== 'object' || Array.isArray(finding)) return false
      const findingRecord = finding as { id?: unknown; canonical_summary?: unknown; source_thread?: unknown; required_evidence?: unknown }
      const id = typeof findingRecord.id === 'string' ? findingRecord.id.trim() : ''
      if (!id || findingIds.has(id)) return false
      findingIds.add(id)
      return typeof findingRecord.canonical_summary === 'string' && findingRecord.canonical_summary.trim() !== '' &&
        typeof findingRecord.source_thread === 'string' && findingRecord.source_thread.trim() !== '' &&
        Array.isArray(findingRecord.required_evidence) && findingRecord.required_evidence.length > 0 &&
        findingRecord.required_evidence.every((item) => typeof item === 'string' && item.trim() !== '')
    })
  } catch {
    return false
  }
}

function isProtectedOrIntegrationBranch(branch: string): boolean {
  return /^(?:main|master|dev|develop|integration|staging|production)(?:\/.*)?$/i.test(branch)
}

export function routeContext(evidence: NormalizedContextEvidence): ContextDecision {
  const baseReasons = [...evidence.evidenceErrors, ...identityErrors(evidence)]
  const activeEvidence = evidence.activePr as ActivePullRequestEvidence | ActivePullRequestEvidence[] | null
  const mergedPr = activeEvidence && !Array.isArray(activeEvidence) && (activeEvidence.merged || activeEvidence.state.toUpperCase() === 'MERGED')
  if (!mergedPr && (!evidence.localGit.clean || evidence.localGit.detached || !evidence.localGit.pushed || !evidence.localGit.durable)) {
    baseReasons.push(
      ...evidence.localGit.reasons,
      'LOCAL_STATE_NOT_DURABLE: required local work is not clean, pushed, and attached to a durable branch',
    )
  }
  if (Array.isArray(evidence.activePr)) baseReasons.push('EVIDENCE_CONFLICT: competing active PRs cannot be uniquely resolved')

  if (baseReasons.length > 0) {
    return decision(evidence, 'STOP', baseReasons, {
      type: 'STOP',
      command: null,
      description: Array.isArray(evidence.activePr)
        ? 'Resolve competing active PR evidence before continuing.'
        : 'Resolve the evidence and local durability blockers before continuing.',
    })
  }

  if (!mergedPr && isProtectedOrIntegrationBranch(evidence.localGit.branch)) {
    return decision(evidence, 'STOP', [
      'EVIDENCE_CONFLICT: protected or integration branch cannot route IMPLEMENT',
    ], {
      type: 'STOP',
      command: null,
      description: 'Switch to a durable topic branch before continuing.',
    })
  }

  const activePr = evidence.activePr as ActivePullRequestEvidence | null
  if (!activePr) {
    if (evidence.issue.state.toUpperCase() === 'CLOSED') {
      return decision(evidence, 'STOP', [
        'EVIDENCE_CONFLICT: Issue is closed without a uniquely resolved merged PR',
      ], {
        type: 'STOP',
        command: null,
        description: 'Resolve the closed Issue and PR evidence before continuing.',
      })
    }
    return decision(evidence, 'IMPLEMENT', [
      'No active PR is present and the local topic branch is durable.',
    ], commandAction('Implement the bounded Issue objective on the durable topic branch.'))
  }

  if (activePr.merged || activePr.state === 'MERGED') {
    return decision(evidence, 'COMPLETE', [
      'The active PR is merged and the bounded objective is terminal under native evidence.',
    ], {
      type: 'COMPLETE',
      command: null,
      description: 'No further implementation action is permitted for this bounded objective.',
    })
  }

  const verification = evidence.currentHeadVerification
  if (!verification || verification.exactHead !== activePr.headSha) {
    return decision(evidence, 'STOP', [
      'EVIDENCE_CONFLICT: exact-head verification is missing or bound to a different PR head',
    ], {
      type: 'STOP',
      command: null,
      description: 'Re-establish exact-head evidence before continuing.',
    })
  }

  if (verification.checks.failed) {
    return decision(evidence, 'FIX', [
      `Exact-head required checks failed at ${activePr.headSha}.`,
    ], commandAction('Fix the bounded defect identified by the failed exact-head checks.'))
  }

  if (!verification.checks.complete || verification.checks.pending) {
    return decision(evidence, 'VERIFY', [
      `Exact-head required checks are incomplete at ${activePr.headSha}.`,
    ], commandAction('Wait for or verify the exact-head checks bound to the active PR.'))
  }

  const semanticReviewRequired =
    evidence.issue.workflowProfile === 'STANDARD' ||
    evidence.issue.workflowProfile === 'MANAGED'

  let semanticReviewSatisfied = false
  let blockingSemanticReview = false
  if (semanticReviewRequired) {
    const verdicts = evidence.durableContext.historicalResults.filter((r) =>
      /^##\s+REVIEW_VERDICT\b/i.test(r.body),
    )
    const applicableVerdicts: Array<{ verdict: string; body: string }> = []
    let malformedEvidence = false
    let conflictingLiveHeadEvidence = false

    const inspectVerdict = (id: string | number, body: string): void => {
      try {
        const parsed = parseProductionMergeReviewVerdict(body, id)
        const classification = classifyMergeReviewVerdict({
          // The existing classifier intentionally recognizes only the
          // non-blocking founder-review verdict. Reuse its complete identity
          // binding for both current-protocol semantic outcomes below.
          reviewVerdict: { ...parsed, verdict: 'ELIGIBLE FOR FOUNDER REVIEW' },
          expected: {
            commentId: id,
            exactHead: activePr.headSha,
            pr: activePr.number,
            base: evidence.protectedBase.branch,
            repository: evidence.repository.nameWithOwner,
            issue: evidence.issue.number,
          },
        })
        const acceptedVerdict = parsed.verdict === 'ELIGIBLE FOR FOUNDER REVIEW' || parsed.verdict === 'CORRECTION REQUIRED'
          ? parsed.verdict
          : null
        const validCorrection = acceptedVerdict === 'CORRECTION REQUIRED' &&
          hasBlockingFinding(body, activePr.headSha)
        if (classification.valid && (acceptedVerdict === 'ELIGIBLE FOR FOUNDER REVIEW' || validCorrection)) {
          applicableVerdicts.push({ verdict: acceptedVerdict, body })
        }
        else if (parsed.reviewed_head?.toLowerCase() === activePr.headSha.toLowerCase()) conflictingLiveHeadEvidence = true
      } catch {
        const reviewedHead = reviewedHeadForApplicability(body)
        if (!reviewedHead || reviewedHead === activePr.headSha.toLowerCase()) malformedEvidence = true
      }
    }

    for (const verdict of verdicts) {
      if (/evidence reconciliation\s*\(no semantic re-review\)/i.test(verdict.body)) continue
      inspectVerdict(verdict.id, verdict.body)
    }

    for (const review of verification.reviews.nativeReviews ?? []) {
      if (!/^##\s+REVIEW_VERDICT\b/i.test(review.body)) continue
      if (!review.commitId || !isFullSha(review.commitId)) {
        malformedEvidence = true
        continue
      }
      if (review.commitId.toLowerCase() !== activePr.headSha.toLowerCase()) continue
      if (review.id === null || !review.state.trim()) {
        malformedEvidence = true
        continue
      }
      inspectVerdict(review.id, review.body)
    }

    const uniqueVerdicts = [...new Set(applicableVerdicts.map((v) => v.verdict))]
    if (uniqueVerdicts.length > 1) {
      conflictingLiveHeadEvidence = true
    }

    semanticReviewSatisfied = !malformedEvidence && !conflictingLiveHeadEvidence && applicableVerdicts.length >= 1
    blockingSemanticReview = semanticReviewSatisfied && uniqueVerdicts[0] === 'CORRECTION REQUIRED'
  }

  if (blockingSemanticReview) {
    return decision(evidence, 'FIX', [
      `Exact-head STANDARD semantic review identified a blocking finding at ${activePr.headSha}.`,
    ], commandAction('Apply the bounded correction identified by the exact-head semantic review.'))
  }

  if (
    (verification.reviews.required && !(verification.reviews.approved && verification.reviews.exactHead)) ||
    (semanticReviewRequired && !semanticReviewSatisfied)
  ) {
    const reason = (verification.reviews.required && !(verification.reviews.approved && verification.reviews.exactHead))
      ? `Exact-head checks pass, but required review evidence is not approved at ${activePr.headSha}.`
      : `Exact-head checks pass, but STANDARD semantic review is missing at ${activePr.headSha}.`

    return decision(evidence, 'REVIEW', [
      reason,
    ], commandAction('Review the durable implementation at the exact active PR head.'))
  }

  return decision(evidence, 'FOUNDER_GATE', [
    `Exact-head checks and required review evidence pass at ${activePr.headSha}.`,
  ], {
    type: 'FOUNDER_GATE',
    command: null,
    description: 'Founder authorization is required before the next merge or scope mutation.',
  })
}
