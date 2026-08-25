export type ContextRoute =
  | 'IMPLEMENT'
  | 'VERIFY'
  | 'FIX'
  | 'REVIEW'
  | 'FOUNDER_GATE'
  | 'COMPLETE'
  | 'STOP'

export type ContextActionType = 'COMMAND' | 'FOUNDER_GATE' | 'COMPLETE' | 'STOP'

export interface RepositoryEvidence {
  owner: string
  name: string
  nameWithOwner: string
  url: string
}

export interface ProtectedBaseEvidence {
  branch: string
  sha: string
  source: string
  url: string
}

export interface PolicyEvidence {
  path: string
  policyId: string
  version: string
  sourceSha: string
  url: string
}

export interface IssueEvidence {
  number: string
  title: string
  state: string
  url: string
  objective: string | null
  scope: string | null
  acceptanceCriteria: string[]
  dependencies: string[]
  taskSize: string | null
  missionControlMode: string | null
  workflowProfile: string | null
}

export interface LocalGitEvidence {
  branch: string
  head: string | null
  upstream: string | null
  originRepository: string | null
  clean: boolean
  detached: boolean
  pushed: boolean
  durable: boolean
  reasons: string[]
}

export interface ActivePullRequestEvidence {
  number: string
  state: string
  draft: boolean
  url: string
  baseBranch: string
  baseSha: string
  headBranch: string
  headSha: string
  merged: boolean
  mergeCommitSha: string | null
}

export interface HeadVerificationEvidence {
  exactHead: string
  checks: {
    status: string
    complete: boolean
    failed: boolean
    pending: boolean
    required: boolean
  }
  reviews: {
    required: boolean
    approved: boolean
    exactHead: boolean
    approvedCount?: number
    exactHeadApprovedCount?: number
  }
  protection: ProtectionEvidence
}

export interface ProtectionEvidence {
  available: boolean
  source?: 'legacy' | 'native' | 'legacy+native' | 'unavailable'
  requiredChecks: string[]
  requiredApprovals: number
}

export interface RoleEvidence {
  id: string | number
  body: string
  createdAt: string
  url: string
}

export interface DurableContextEvidence {
  latestHandoff: RoleEvidence | null
  historicalResults: RoleEvidence[]
}

export interface NormalizedContextEvidence {
  repository: RepositoryEvidence
  protectedBase: ProtectedBaseEvidence
  policy: PolicyEvidence
  issue: IssueEvidence
  localGit: LocalGitEvidence
  activePr: ActivePullRequestEvidence | ActivePullRequestEvidence[] | null
  currentHeadVerification: HeadVerificationEvidence | null
  durableContext: DurableContextEvidence
  evidenceErrors: string[]
}

export interface ContextDecision {
  route: ContextRoute
  reasons: string[]
  nextAction: {
    type: ContextActionType
    command: string | null
    description: string
  }
  evidenceUrls: string[]
}

export function normalizeContextEvidence(
  evidence: NormalizedContextEvidence,
): NormalizedContextEvidence {
  const normalized = structuredClone(evidence)
  normalized.evidenceErrors = [...new Set(normalized.evidenceErrors)].sort()
  normalized.issue.acceptanceCriteria = [...normalized.issue.acceptanceCriteria]
  normalized.issue.dependencies = [...normalized.issue.dependencies]
  normalized.localGit.reasons = [...new Set(normalized.localGit.reasons)].sort()
  normalized.durableContext.historicalResults = [
    ...normalized.durableContext.historicalResults,
  ].sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  return normalized
}
