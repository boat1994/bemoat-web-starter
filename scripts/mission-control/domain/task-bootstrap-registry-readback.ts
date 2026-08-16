import { canonicalHash } from './task-attestation.ts'
import { parseTaskOwnershipRecord, verifyTaskOwnershipRecord } from './task-ownership-registry.ts'

type RuntimeObject = Record<string, unknown>
type RegistryError = Error & { code: string; classification: string }
type LegacyComment = Record<string, unknown>
type GithubClient = {
  getIssueComments: (parentIssueNumber: number) => Promise<LegacyComment[]>
}

function registryError(code: string, message: string, cause?: unknown): RegistryError {
  const error = new Error(`${code}: ${message}`, cause ? { cause } : undefined) as RegistryError
  error.code = code
  error.classification = code
  return error
}

function stateConflict(message: string, cause?: unknown): RegistryError {
  return registryError('STATE_CONFLICT', message, cause)
}

function blockedExternal(message: string, cause?: unknown): RegistryError {
  return registryError('BLOCKED_EXTERNAL', message, cause)
}

export async function readRegistryRecords(
  github: GithubClient,
  parentIssueNumber: number,
  publicKey: string,
  repository: string,
  signingKeyId: string,
  expected: RuntimeObject = {},
): Promise<{ comments: LegacyComment[]; records: RuntimeObject[] }> {
  const comments = await github.getIssueComments(parentIssueNumber)
  const records: RuntimeObject[] = []
  for (const comment of comments) {
    if (!String(comment?.body ?? '').includes('bemoat-mission-control-task-registry:v1')) continue
    const parsed = parseTaskOwnershipRecord(String(comment.body ?? '')) as RuntimeObject
    if (!parsed.ok) throw stateConflict(`parent ownership registry comment ${comment.id} is unreadable`)
    const verified = verifyTaskOwnershipRecord(parsed.envelope as RuntimeObject, {
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
}: RuntimeObject = {}): void {
  const record = registryRecord as RuntimeObject
  const attestationSha256 = canonicalHash(attestation)
  const registryVerification = verifyTaskOwnershipRecord(record, {
    publicKey: publicKey as string | undefined,
    repository: repository as string | undefined,
    signingKeyId: signingKeyId as string | undefined,
    expectedParentIssue: parentIssue as RuntimeObject | undefined,
    expectedTaskIssue: taskIssue as RuntimeObject | undefined,
    expectedPullRequest: pullRequest as RuntimeObject | undefined,
    expectedBase: base as string | undefined,
    expectedHead: head as string | undefined,
    expectedProtectedBaseSha: protectedBaseSha as string | undefined,
    expectedRequestId: requestId as string | undefined,
    expectedAttestationSha256: attestationSha256,
  })
  const payload = record?.payload as RuntimeObject | undefined
  const taskIssueRecord = taskIssue as RuntimeObject | undefined
  if (!registryVerification.ok || payload?.attestation_sha256 !== attestationSha256 ||
      Number(payload?.task_issue_number) !== Number(taskIssueRecord?.number) || payload?.task_issue_id !== taskIssueRecord?.id ||
      payload?.task_issue_node_id !== taskIssueRecord?.node_id) {
    throw blockedExternal('parent ownership registry readback does not match the allocated Task')
  }
}
