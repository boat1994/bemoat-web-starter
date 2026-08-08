export function mergeCommitOid(pr, mergeResult) {
  return pr?.mergeCommit?.oid ?? pr?.mergeCommit?.sha ?? mergeResult?.mergeCommit?.oid ?? mergeResult?.mergeCommit?.sha ?? null
}
