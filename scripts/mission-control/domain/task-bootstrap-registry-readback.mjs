import { canonicalHash } from './task-attestation.mjs'
import { parseTaskOwnershipRecord, verifyTaskOwnershipRecord } from './task-ownership-registry.mjs'

function registryError(code, message, cause) {
  const error = new Error(`${code}: ${message}`, cause ? { cause } : undefined)
  error.code = code
  error.classification = code
  return error
}

function stateConflict(message, cause) { return registryError('STATE_CONFLICT', message, cause) }
function blockedExternal(message, cause) { return registryError('BLOCKED_EXTERNAL', message, cause) }

export async function readRegistryRecords(github, parentIssueNumber, publicKey, repository, signingKeyId, expected = {}) {
  const comments = await github.getIssueComments(parentIssueNumber)
  const records = []
  for (const comment of comments) {
    if (!String(comment?.body ?? '').includes('bemoat-mission-control-task-registry:v1')) continue
    const parsed = parseTaskOwnershipRecord(comment.body)
    if (!parsed.ok) throw stateConflict(`parent ownership registry comment ${comment.id} is unreadable`)
    const verified = verifyTaskOwnershipRecord(parsed.envelope, {
      publicKey,
      repository,
      signingKeyId,
      ...expected,
    })
    if (!verified.ok) throw stateConflict(`parent ownership registry comment ${comment.id} failed verification: ${verified.reason}`)
    records.push({ comment, ...verified })
  }
  return { comments, records }
}

export function verifyFinalTaskRegistryReadback({
  registryRecord,
  publicKey,
  repository,
  signingKeyId,
  parentIssue,
  taskIssue,
  pullRequest,
  base,
  head,
  protectedBaseSha,
  requestId,
  attestation,
}) {
  const attestationSha256 = canonicalHash(attestation)
  const registryVerification = verifyTaskOwnershipRecord(registryRecord, {
    publicKey,
    repository,
    signingKeyId,
    expectedParentIssue: parentIssue,
    expectedTaskIssue: taskIssue,
    expectedPullRequest: pullRequest,
    expectedBase: base,
    expectedHead: head,
    expectedProtectedBaseSha: protectedBaseSha,
    expectedRequestId: requestId,
    expectedAttestationSha256: attestationSha256,
  })
  if (!registryVerification.ok || registryRecord.payload.attestation_sha256 !== attestationSha256 ||
      Number(registryRecord.payload.task_issue_number) !== Number(taskIssue.number) || registryRecord.payload.task_issue_id !== taskIssue.id ||
      registryRecord.payload.task_issue_node_id !== taskIssue.node_id) {
    throw blockedExternal('parent ownership registry readback does not match the allocated Task')
  }
}
