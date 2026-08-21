import { parseIssueDeclarations, deriveWorkflowProfile } from '../../agent-issue/issue-declarations.ts'
import { parseMissionControlState } from './task-state.ts'

export const STANDARD_POLICY_PATH = 'docs/mission-control/mission-control-guide.md'
const STANDARD_POLICY_VERSION = '1.3.0'
const FULL_SHA_RE = /^[0-9a-f]{40}$/
const STARTER_REPOSITORY = 'boat1994/bemoat-web-starter'

type PolicyEvidence = {
  path?: unknown
  version?: unknown
  blobSha?: unknown
  sourceCommit?: unknown
  content?: unknown
}

type EligibilityInput = {
  repository: unknown
  issueBody: unknown
  policy: PolicyEvidence
  protectedBaseSha: unknown
}

export type StandardNonManagedEligibility = Readonly<{
  eligible: true
  profile: 'STANDARD'
  managed: false
}>

function stateConflict(message: string): Error {
  return Object.assign(new Error(`STATE_CONFLICT: ${message}`), { classification: 'STATE_CONFLICT' })
}

function validatePolicy({ repository, policy, protectedBaseSha }: Pick<EligibilityInput, 'repository' | 'policy' | 'protectedBaseSha'>): void {
  const content = String(policy.content ?? '')
  const sourceCommit = String(policy.sourceCommit ?? '').toLowerCase()
  const protectedSha = String(protectedBaseSha ?? '').toLowerCase()
  const blobSha = String(policy.blobSha ?? '').toLowerCase()

  if (repository !== STARTER_REPOSITORY) throw stateConflict('STANDARD eligibility is not enabled for this repository')
  if (policy.path !== STANDARD_POLICY_PATH || policy.version !== STANDARD_POLICY_VERSION) {
    throw stateConflict('trusted Mission Control policy path or version is not canonical')
  }
  if (!FULL_SHA_RE.test(sourceCommit) || !FULL_SHA_RE.test(blobSha) || !FULL_SHA_RE.test(protectedSha) || sourceCommit !== protectedSha) {
    throw stateConflict('trusted protected-base and Mission Control policy identities are incomplete or stale')
  }
  if (
    !content.includes(`canonical_repository: ${STARTER_REPOSITORY}`) ||
    !/Mission Control mode:\s*required/i.test(content) ||
    !/\|\s*Medium\/Core\b[^|]*\|\s*STANDARD\s*\|/i.test(content)
  ) {
    throw stateConflict('trusted Mission Control policy does not authorize the STANDARD optional profile')
  }
}

export function classifyStandardNonManagedEligibility({ repository, issueBody, policy, protectedBaseSha }: EligibilityInput): StandardNonManagedEligibility {
  validatePolicy({ repository, policy, protectedBaseSha })

  const body = String(issueBody ?? '')
  const state = parseMissionControlState(body)
  if (state.present) throw stateConflict('STANDARD/non-managed route cannot consume an Issue with managed state')

  const declarations = parseIssueDeclarations(body)
  const profile = deriveWorkflowProfile(declarations)
  if (declarations.taskSize !== 'medium' && declarations.taskSize !== 'core') {
    throw stateConflict('STANDARD/non-managed route requires a canonical Medium or Core task declaration')
  }
  if (declarations.missionControlMode !== 'optional') {
    throw stateConflict('STANDARD/non-managed route requires an explicit optional or not required Mission Control declaration')
  }
  if (declarations.taskSize === 'core' && (declarations.declaresMainIssue || declarations.declaresImplementationPlan)) {
    throw stateConflict('legacy Core Main Issue and Implementation Plan declarations require managed state')
  }
  if (profile?.name !== 'STANDARD') throw stateConflict('Issue declarations do not derive the STANDARD profile')

  return { eligible: true, profile: 'STANDARD', managed: false }
}
