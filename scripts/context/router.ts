import type {
  ActivePullRequestEvidence,
  ContextDecision,
  NormalizedContextEvidence,
} from './model.ts'

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

export function routeContext(evidence: NormalizedContextEvidence): ContextDecision {
  const baseReasons = [...evidence.evidenceErrors]
  if (!evidence.localGit.clean || evidence.localGit.detached || !evidence.localGit.pushed || !evidence.localGit.durable) {
    baseReasons.push(
      ...evidence.localGit.reasons,
      'LOCAL_STATE_NOT_DURABLE: required local work is not clean, pushed, and attached to a durable branch',
    )
  }

  if (baseReasons.length > 0) {
    return decision(evidence, 'STOP', baseReasons, {
      type: 'STOP',
      command: null,
      description: 'Resolve the evidence and local durability blockers before continuing.',
    })
  }

  if (Array.isArray(evidence.activePr)) {
    return decision(evidence, 'STOP', [
      'EVIDENCE_CONFLICT: competing active PRs cannot be uniquely resolved',
    ], {
      type: 'STOP',
      command: null,
      description: 'Resolve competing active PR evidence before continuing.',
    })
  }

  const activePr = evidence.activePr as ActivePullRequestEvidence | null
  if (!activePr) {
    if (evidence.issue.state === 'CLOSED') {
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

  if (verification.reviews.required && !(verification.reviews.approved && verification.reviews.exactHead)) {
    return decision(evidence, 'REVIEW', [
      `Exact-head checks pass, but required review evidence is not approved at ${activePr.headSha}.`,
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
