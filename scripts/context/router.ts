import type {
  ActivePullRequestEvidence,
  ContextDecision,
  NormalizedContextEvidence,
} from './model.ts'
import { isFullSha, isPositiveInteger, isRepositoryObjectUrl } from './runtime.ts'

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
    if (!pr || typeof pr.baseBranch !== 'string' || !pr.baseBranch.trim() || typeof pr.baseSha !== 'string' || !isFullSha(pr.baseSha) || pr.baseBranch !== evidence.protectedBase.branch || pr.baseSha.toLowerCase() !== evidence.protectedBase.sha.toLowerCase()) {
      errors.push(`EVIDENCE_CONFLICT: PR #${number} base identity is missing or malformed`)
    }
  }
  return errors
}

function isProtectedOrIntegrationBranch(branch: string): boolean {
  return /^(?:main|master|dev|develop|integration|staging|production)(?:\/.*)?$/i.test(branch)
}

export function routeContext(evidence: NormalizedContextEvidence): ContextDecision {
  const baseReasons = [...evidence.evidenceErrors, ...identityErrors(evidence)]
  if (!evidence.localGit.clean || evidence.localGit.detached || !evidence.localGit.pushed || !evidence.localGit.durable) {
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

  if (isProtectedOrIntegrationBranch(evidence.localGit.branch)) {
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

  const isStandard = evidence.issue.workflowProfile === 'STANDARD'
  const semanticReviewRequired = isStandard
  const semanticReviewSatisfied = verification.reviews.exactHeadApprovedCount && verification.reviews.exactHeadApprovedCount > 0

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
