const MERGE_TRANSPORT_UPDATED_BY = 'Founder-authorized merge transport'

type ManagedState = Record<string, unknown>
type TaskDoneProjectionOptions = {
  mergeCommit: unknown
  resultCommentId: unknown
  updatedAt?: string
  updatedBy?: string
}

type TaskDoneState = {
  state: 'DONE'
  merged_commit_sha: unknown
  latest_result_comment_id: string
  open_blockers: unknown[]
  next_permitted_action: 'none on this task'
  updated_at: string
  updated_by: string
}

export function projectTaskDoneState<T extends ManagedState>(
  managedState: T,
  {
    mergeCommit,
    resultCommentId,
    updatedAt = new Date().toISOString(),
    updatedBy = MERGE_TRANSPORT_UPDATED_BY,
  }: TaskDoneProjectionOptions,
): T & TaskDoneState {
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
