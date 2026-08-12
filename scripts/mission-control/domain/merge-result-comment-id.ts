type ResultComment = {
  id?: unknown
  commentId?: unknown
}

export function resultCommentId(result: ResultComment | null | undefined): unknown {
  return result?.id ?? result?.commentId ?? null
}
