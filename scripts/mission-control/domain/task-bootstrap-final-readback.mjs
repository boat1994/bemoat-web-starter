import { BOOTSTRAP_CONTRACT } from './task-bootstrap-authorization.mjs'
import { canonicalHash, parseTaskAttestation } from './task-attestation.mjs'
import { runCanonicalManagedTaskPreflight } from './task-bootstrap-preflight.mjs'
import { verifyFinalTaskRegistryReadback } from './task-bootstrap-registry-readback.mjs'

function readbackError(code, message, cause) {
  const error = new Error(`${code}: ${message}`, cause ? { cause } : undefined)
  error.code = code
  error.classification = code
  return error
}

function blockedExternal(message, cause) { return readbackError('BLOCKED_EXTERNAL', message, cause) }

/**
 * Admit the exact Task projection after mutation. Transport remains injected;
 * this domain owns only terminal readback and fail-closed admission.
 */
export async function verifyFinalTask({
  github,
  issueNumber,
  context,
  authorization,
  requestId,
  attestation,
  registryRecord,
  expectedBody,
} = {}) {
  let issue
  try { issue = await github.getIssue(issueNumber) } catch (error) { throw blockedExternal(`allocated Task Issue #${issueNumber} could not be read back`, error) }
  if (expectedBody != null && issue.body !== expectedBody) throw blockedExternal('Task Issue body readback differs from the body projected by the winning lease')
  let pullRequest
  try { pullRequest = await github.getPullRequest(BOOTSTRAP_CONTRACT.pullRequest) } catch (error) { throw blockedExternal('PR evidence was unavailable during final Task readback', error) }
  const preflight = runCanonicalManagedTaskPreflight({
    issue,
    pullRequest,
    repository: context.repository.nameWithOwner,
    publicKey: context.publicKey,
    signingKeyId: context.signingKeyId,
    expectedProtectedBaseSha: BOOTSTRAP_CONTRACT.protectedBaseSha,
    expectedAuthorization: { ...authorization, parentIssue: context.parentIssue },
    expectedWorkflow: context.workflow,
    policy: context.policy,
    repositoryIdentity: context.repository,
    requireBootstrapAttestation: true,
  })
  if (!preflight.ok) throw blockedExternal(`canonical managed-task preflight failed after projection: ${preflight.reason}`)
  const parsedAttestation = parseTaskAttestation(issue.body)
  if (!parsedAttestation.ok || parsedAttestation.envelope.payload.request_id !== requestId) throw blockedExternal('readback Task attestation does not match the deterministic request')
  if (canonicalHash(parsedAttestation.envelope) !== canonicalHash(attestation)) throw blockedExternal('readback Task attestation changed after projection')
  verifyFinalTaskRegistryReadback({
    registryRecord,
    publicKey: context.publicKey,
    repository: context.repository.nameWithOwner,
    signingKeyId: context.signingKeyId,
    parentIssue: context.parentIssue,
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
