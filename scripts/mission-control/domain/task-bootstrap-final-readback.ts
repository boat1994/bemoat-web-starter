import { BOOTSTRAP_CONTRACT } from './task-bootstrap-authorization.ts'
import { canonicalHash, parseTaskAttestation } from './task-attestation.ts'
import { runCanonicalManagedTaskPreflight } from './task-bootstrap-preflight.ts'
import { verifyFinalTaskRegistryReadback } from './task-bootstrap-registry-readback.ts'

type RuntimeObject = Record<string, unknown>
type ReadbackError = Error & { code: string; classification: string }
type GithubClient = {
  getIssue: (issueNumber: number) => Promise<RuntimeObject>
  getPullRequest: (pullRequest: number) => Promise<RuntimeObject>
}

function readbackError(code: string, message: string, cause?: unknown): ReadbackError {
  const error = new Error(`${code}: ${message}`, cause ? { cause } : undefined) as ReadbackError
  error.code = code
  error.classification = code
  return error
}

function blockedExternal(message: string, cause?: unknown): ReadbackError {
  return readbackError('BLOCKED_EXTERNAL', message, cause)
}

/**
 * Admit the exact Task projection after mutation. Transport remains injected;
 * this domain owns only terminal readback and fail-closed admission.
 */
export async function verifyFinalTask(input: RuntimeObject = {}): Promise<RuntimeObject> {
  const github = input.github as GithubClient | undefined
  const issueNumber = input.issueNumber as number | undefined
  const context = input.context as RuntimeObject | undefined
  const authorization = input.authorization as RuntimeObject | undefined
  const requestId = input.requestId as string | undefined
  const attestation = input.attestation as RuntimeObject | undefined
  const registryRecord = input.registryRecord as RuntimeObject | undefined
  const expectedBody = input.expectedBody as string | undefined

  let issue: RuntimeObject
  try {
    issue = await github!.getIssue(issueNumber!)
  } catch (error) {
    throw blockedExternal(`allocated Task Issue #${issueNumber} could not be read back`, error)
  }
  if (expectedBody != null && issue.body !== expectedBody) {
    throw blockedExternal('Task Issue body readback differs from the body projected by the winning lease')
  }
  let pullRequest: RuntimeObject
  try {
    pullRequest = await github!.getPullRequest(BOOTSTRAP_CONTRACT.pullRequest)
  } catch (error) {
    throw blockedExternal('PR evidence was unavailable during final Task readback', error)
  }
  const repository = context?.repository as RuntimeObject | undefined
  const preflight = runCanonicalManagedTaskPreflight({
    issue,
    pullRequest,
    repository: repository?.nameWithOwner as string | undefined,
    publicKey: context?.publicKey as string | undefined,
    signingKeyId: context?.signingKeyId as string | undefined,
    expectedProtectedBaseSha: BOOTSTRAP_CONTRACT.protectedBaseSha,
    expectedAuthorization: { ...authorization, parentIssue: context?.parentIssue } as RuntimeObject,
    expectedWorkflow: context?.workflow as RuntimeObject | undefined,
    policy: context?.policy as RuntimeObject | undefined,
    repositoryIdentity: repository,
    requireBootstrapAttestation: true,
  })
  if (!preflight.ok) {
    throw blockedExternal(`canonical managed-task preflight failed after projection: ${preflight.reason}`)
  }
  const parsedAttestation = parseTaskAttestation(String(issue.body ?? ''))
  const parsedEnvelope = parsedAttestation.envelope as RuntimeObject | undefined
  const parsedPayload = parsedEnvelope?.payload as RuntimeObject | undefined
  if (!parsedAttestation.ok || parsedPayload?.request_id !== requestId) {
    throw blockedExternal('readback Task attestation does not match the deterministic request')
  }
  if (canonicalHash(parsedAttestation.envelope) !== canonicalHash(attestation)) {
    throw blockedExternal('readback Task attestation changed after projection')
  }
  verifyFinalTaskRegistryReadback({
    registryRecord,
    publicKey: context?.publicKey,
    repository: repository?.nameWithOwner,
    signingKeyId: context?.signingKeyId,
    parentIssue: context?.parentIssue,
    taskIssue: issue,
    pullRequest,
    base: BOOTSTRAP_CONTRACT.base,
    head: BOOTSTRAP_CONTRACT.head,
    protectedBaseSha: BOOTSTRAP_CONTRACT.protectedBaseSha,
    requestId,
    attestation: parsedAttestation.envelope,
  })
  return issue
}
