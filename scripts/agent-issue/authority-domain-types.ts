import type { ExactHeadCiAnalysis } from './exact-head-ci.ts'

export interface ValidationResult {
  ok: boolean
  errors: string[]
}

export interface GitHubIssueComment {
  id?: string | number
  body?: string
  html_url?: string
  url?: string
  author?: string
  user?: { login?: string }
  author_association?: string
  created_at?: string
  updated_at?: string
  createdAt?: string
  updatedAt?: string
}

export interface GitHubPullReviewComment extends GitHubIssueComment {
  pull_request_url?: string
}

export type IssueCommentFetchFailure = { ok: false; reason: string }
export type IssueCommentFetchSuccess = { ok: true; comment: GitHubIssueComment }
export type IssueCommentFetchResult = IssueCommentFetchFailure | IssueCommentFetchSuccess

export type PullReviewCommentFetchFailure = { ok: false; reason: string }
export type PullReviewCommentFetchSuccess = { ok: true; comment: GitHubPullReviewComment }
export type PullReviewCommentFetchResult = PullReviewCommentFetchFailure | PullReviewCommentFetchSuccess

export interface HandoffSemanticPayload {
  phase?: string
  authorization_id?: string
  task_issue?: string
  target?: string
  scope?: string
  exact_reviewed_head?: string
  findings?: string[]
  review_4_prohibition?: boolean
  pr_repository?: string
  pr_number?: string
  pr_identity?: string
}

export type HandoffParseFailure = { ok: false; errors: string[] }
export type HandoffParseSuccess = { ok: true; payload: HandoffSemanticPayload }
export type HandoffParseResult = HandoffParseFailure | HandoffParseSuccess

export interface ContractFinding {
  id: string
}

export interface CorrectionContract {
  reviewed_head: string
  findings: ContractFinding[]
}

export interface PinnedFinding {
  id: string
  canonical_summary: string
  source_thread: string | null
  required_evidence: string[]
  expected_areas: string[]
  prohibited_areas: string[]
}

export interface LivePullRequestEvidence {
  url?: string
  headRefOid?: string
  headRefName?: string
  baseRefName?: string
  state?: string
  isDraft?: boolean
}

export type PrByReferenceFailure = { ok: false; reason: string }
export type PrByReferenceSuccess = { ok: true; pr: LivePullRequestEvidence }
export type PrByReferenceResult = PrByReferenceFailure | PrByReferenceSuccess

export type CurrentAuthorityPhase =
  | 'approved_unconsumed'
  | 'consumed_historical'
  | 'consumed_current_dispatch'
  | 'consumed_review_eight_dispatch'

export interface AuthorityRecord {
  schema_version?: number
  status?: string
  authority?: string
  scope?: string
  canonical_repository?: string
  issue?: string
  pr?: string
  content_sha256?: string
  comment_id?: string | number
  specification_result_comment_id?: string | number
  review_7_verdict_comment_id?: string | number
  historical_review_3_source_comment_id?: string | number
  historical_handoff_comment_id?: string | number
  historical_authorization_id?: string
  historical_reviewed_head?: string
  historical_action?: string
  historical_authorized_at?: string
  historical_finding_ids?: string[]
  finding_ids?: string[]
  correction_base?: string
  approved_action?: string
  author_login?: string
  author_association?: string
  created_at?: string
  updated_at?: string
  repository_id?: string
  canonical_handoff_source_binding?: Record<string, unknown>
  [key: string]: unknown
}

export interface PostBudgetReviewRecord {
  review_number?: number
  verdict_comment_id?: string | number
  reviewed_head?: string
  verdict_url?: string
  authorization?: Record<string, unknown>
  finding_dispositions?: Array<Record<string, unknown>>
  [key: string]: unknown
}

export interface DecisionRecord {
  status?: string
  authority?: string
  scope?: string
  for_review_number?: number
  reviewed_head?: string
  finding_ids?: string[]
  action?: string
  authorized_at?: string
  old_pr?: string
  old_base?: string
  replacement_pr?: string
  finding_scope?: string
  source_comment_id?: string | number
  new_correction_base?: string
  [key: string]: unknown
}

export interface DispatchRecord {
  status?: string
  target?: string
  handoff_comment_id?: string | number
  active_pr?: string
  correction_base?: string
  finding_ids?: string[]
  implementation_head?: string
  branch?: string
  authorized_replacement_base?: string
  exact_head?: string
  review_number?: number
  historical_correction_base?: string
  [key: string]: unknown
}

export interface HistoricalAuthorizationRecord {
  schema_version?: number
  status?: string
  authority?: string
  scope?: string
  for_review_number?: number
  authorization_id?: string
  reviewed_head?: string
  action?: string
  authorized_at?: string
  handoff_comment_id?: string | number
  handoff_url?: string
  handoff_binding?: Record<string, unknown>
  finding_ids?: string[]
  [key: string]: unknown
}

export interface ReviewEightAuthorizationRecord extends DispatchRecord {
  for_review_number?: number
  reviewed_head?: string
  historical_correction_base?: string
  authorized_replacement_base?: string
  implementation_head?: string
  review_8_verdict_comment_id?: string | number
  review_8_verdict_url?: string
  review_9_authorized?: boolean
  handoff_url?: string
  consumed_at?: string
  [key: string]: unknown
}

export type MissionControlStateValue = Record<string, unknown> & {
  review_cycle: number
  full_review_count: number
  state: string
  active_task_issue: string | null
  active_pr: string | null
  current_head: string | null
  approved_base: string | null
  open_blockers: unknown[]
  post_budget_reviews?: PostBudgetReviewRecord[]
  founder_migration_authority?: AuthorityRecord
  founder_decision?: DecisionRecord
  founder_correction_authorization?: HistoricalAuthorizationRecord
  founder_base_change_decision?: DecisionRecord
  replacement_dispatch?: DispatchRecord
  founder_review_8_correction_authorization?: ReviewEightAuthorizationRecord
  correction_dispatch?: DispatchRecord
}

export interface CurrentAuthorityStateCheck {
  authority: AuthorityRecord
  decision?: DecisionRecord
  dispatch?: DispatchRecord
  reviewEightAuthorization?: ReviewEightAuthorizationRecord
  correctionDispatch?: DispatchRecord
  phase: CurrentAuthorityPhase
  ok: boolean
  errors: string[]
}

export function asAuthorityRecord(value: Record<string, unknown>): AuthorityRecord {
  return value
}

export function asDecisionRecord(value: Record<string, unknown>): DecisionRecord {
  return value
}

export function asDispatchRecord(value: Record<string, unknown>): DispatchRecord {
  return value
}

export function asHistoricalAuthorizationRecord(value: Record<string, unknown>): HistoricalAuthorizationRecord {
  return value
}

export function asReviewEightAuthorizationRecord(value: Record<string, unknown>): ReviewEightAuthorizationRecord {
  return value
}

export type AnalyzeExactHeadCi = (pr: LivePullRequestEvidence) => ExactHeadCiAnalysis

export type FetchIssueCommentById = (
  cwd: string,
  commentId: string | number,
  env: NodeJS.ProcessEnv,
) => IssueCommentFetchResult

export type FetchPullReviewCommentById = (
  cwd: string,
  commentId: string | number,
  env: NodeJS.ProcessEnv,
) => PullReviewCommentFetchResult

export type FetchPrByReference = (
  cwd: string,
  reference: string,
  env: NodeJS.ProcessEnv,
) => PrByReferenceResult

export function pinnedCommentId(comment: GitHubIssueComment | null | undefined): string | null {
  const match = String(comment?.url ?? comment?.html_url ?? '').match(/#issuecomment-(\d+)$/)
  return match?.[1] ?? null
}

export function findExactlyOnePinnedComment(
  comments: GitHubIssueComment[],
  commentId: string | number,
): GitHubIssueComment | null {
  const matches = comments.filter((comment) => pinnedCommentId(comment) === String(commentId))
  return matches.length === 1 ? matches[0] : null
}

export interface VerifyReviewThreeCorrectionAuthorizationInput {
  issueBody: string
  contract: CorrectionContract
  comments: GitHubIssueComment[]
  issueNumber: number
  defaultRepo: string
  cwd: string
  env: NodeJS.ProcessEnv
  fetchIssueCommentById: FetchIssueCommentById
}

export type ReviewThreeAuthorizationResult =
  | { ok: true; errors: string[]; reviewThree: boolean }
  | { ok: false; errors: string[] }

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readRecordField(record: Record<string, unknown>, key: string): unknown {
  return record[key]
}

export function readStringField(record: Record<string, unknown>, key: string): string {
  return String(record[key] ?? '')
}

export function readStringArrayField(record: Record<string, unknown>, key: string): string[] {
  const value = record[key]
  return Array.isArray(value) ? value.map((entry) => String(entry)) : []
}

export function readLegacyField(value: unknown, key: string): unknown {
  if (value === null || value === undefined) return undefined
  return Reflect.get(Object(value), key)
}

export function readRecordArrayField(record: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = record[key]
  if (!Array.isArray(value)) return []
  return value.filter(isPlainObject)
}
