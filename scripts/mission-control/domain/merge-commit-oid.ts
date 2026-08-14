function property(value: unknown, key: string): unknown {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return undefined
  return Reflect.get(value, key)
}

function mergeCommit(value: unknown): unknown {
  return property(value, 'mergeCommit')
}

export function mergeCommitOid(pr: unknown, mergeResult: unknown): unknown {
  return property(mergeCommit(pr), 'oid')
    ?? property(mergeCommit(pr), 'sha')
    ?? property(mergeCommit(mergeResult), 'oid')
    ?? property(mergeCommit(mergeResult), 'sha')
    ?? null
}
