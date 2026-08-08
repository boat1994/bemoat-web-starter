const MERGE_TRANSPORT_UPDATED_BY = 'Founder-authorized merge transport'

export function projectTaskDoneState(managedState, {
  mergeCommit,
  resultCommentId,
  updatedAt = new Date().toISOString(),
  updatedBy = MERGE_TRANSPORT_UPDATED_BY,
}) {
  return {
    ...structuredClone(managedState),
    state: 'DONE',
    merged_commit_sha: mergeCommit,
    latest_result_comment_id: String(resultCommentId),
    open_blockers: [],
    next_permitted_action: 'none on this task',
    updated_at: updatedAt,
    updated_by: updatedBy,
  }
}
