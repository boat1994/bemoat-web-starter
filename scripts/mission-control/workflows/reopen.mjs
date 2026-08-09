import { spawnSync } from 'node:child_process'

import {
  parseMissionControlState,
  projectMissionControlStateBlock,
} from '../../mission-control-state.mjs'
import { writeIssueBodyWithLease } from '../../mission-control-issue-body-cas.mjs'
import {
  assertFounderAuthorization,
  parseFounderReopenAuthorization,
} from '../domain/reopen-authorization.mjs'
import {
  buildNextState,
  sameReopenValue,
} from '../domain/reopen-state-projection.mjs'
import {
  createResultRendering,
  createRuntimeErrorRendering,
} from '../domain/reopen-result-rendering.mjs'

export { REOPEN_AUTHORIZATION_BUNDLE_KIND, parseFounderReopenAuthorization } from '../domain/reopen-authorization.mjs'

export const REOPEN_NEXT_ACTION = 'Execute exactly one bounded correction RESULT, then one Delta Review.'
export const REOPEN_USAGE = `Usage:
  pnpm run bemoat:mission-control:reopen -- <issue-number> [flags]

Required positional argument:
  <issue-number>                         Managed Task Issue number.

Required flags:
  --repo <owner/repository>              Repository containing the Task Issue.
  --expected-pr <number>                 Exact active PR number.
  --expected-base <branch>               Approved PR base branch.
  --expected-state <state>               Must be ELIGIBLE_FOR_FOUNDER_REVIEW.
  --expected-old-head <full-sha>         Immutable Review 1 head.
  --expected-new-head <full-sha>         Founder-authorized live correction head.
  --expected-review-cycle <number>       Existing review cycle; no increment.
  --expected-full-review-count <number>  Existing full-review count; no reset.
  --authorization-comment <id>           Immutable Founder authorization comment.

Authorization record:
  One raw JSON Founder record with the complete repository/Task/PR/base,
  old-head/new-head, policy, trusted identity, immutable comment, reason,
  bounded scope, one-delivery, and Delta Review bindings.

Supported pre-state and mutation:
  ELIGIBLE_FOR_FOUNDER_REVIEW -> FOUNDER_AUTHORIZED_CORRECTION
  The old head remains last_reviewed_head; the new head becomes unreviewed
  current_head. Counters and original RESULT/REVIEW_VERDICT identities remain.

Classifications:
  REOPENED, NO_OP, STATE_CONFLICT, or BLOCKED_EXTERNAL.

Example:
  pnpm run bemoat:mission-control:reopen -- 284 --repo boat1994/bemoat-web-starter \\
    --expected-pr 285 --expected-base main \\
    --expected-state ELIGIBLE_FOR_FOUNDER_REVIEW \\
    --expected-old-head <review-1-sha> --expected-new-head <correction-sha> \\
    --expected-review-cycle 1 --expected-full-review-count 1 \\
    --authorization-comment <immutable-comment-id>

Safe recovery:
  Stop on any drift, ambiguous write, or failed readback; reconcile the live
  Issue/PR evidence and obtain a fresh Founder authorization before retrying.`

const POSITIVE_ID_RE = /^[1-9]\d*$/
const FULL_SHA_RE = /^[0-9a-f]{40}$/i
const REOPEN_STATE = 'ELIGIBLE_FOR_FOUNDER_REVIEW'
const CORRECTION_STATE = 'FOUNDER_AUTHORIZED_CORRECTION'
const REOPEN_COMMAND = 'bemoat:mission-control:reopen'

function stateConflict(message) {
  return new Error(`STATE_CONFLICT: ${message}`)
}

function blockedExternal(message) {
  return new Error(`BLOCKED_EXTERNAL: ${message}`)
}

function normalizeId(value) {
  const match = String(value ?? '').match(/^#?([1-9]\d*)$/)
  return match?.[1] ?? null
}

function normalizeSha(value) {
  return typeof value === 'string' && FULL_SHA_RE.test(value) ? value.toLowerCase() : null
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireValue(options, key) {
  if (options[key] === null || options[key] === undefined || options[key] === '') {
    throw new Error(`--${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)} is required`)
  }
}

function parseExpectedNumber(value, label) {
  if (!POSITIVE_ID_RE.test(String(value ?? ''))) {
    throw stateConflict(`${label} must be a positive integer`)
  }
  return Number(value)
}

export function parseReopenArgs(argv = []) {
  if (argv.some((argument) => argument === '--help' || argument === '-h')) {
    return { help: true }
  }

  const options = {
    issueNumber: null,
    repo: null,
    expectedPr: null,
    expectedBase: null,
    expectedState: null,
    expectedOldHead: null,
    expectedNewHead: null,
    expectedReviewCycle: null,
    expectedFullReviewCount: null,
    authorizationComment: null,
  }
  const flags = {
    '--repo': 'repo',
    '--expected-pr': 'expectedPr',
    '--expected-base': 'expectedBase',
    '--expected-state': 'expectedState',
    '--expected-old-head': 'expectedOldHead',
    '--expected-new-head': 'expectedNewHead',
    '--expected-review-cycle': 'expectedReviewCycle',
    '--expected-full-review-count': 'expectedFullReviewCount',
    '--authorization-comment': 'authorizationComment',
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--json') continue
    if (argument === '--') continue
    const key = flags[argument]
    if (key) {
      const value = argv[++index]
      if (!value || options[key] !== null) throw new Error(`${argument} requires one value`)
      options[key] = value
      continue
    }
    if (argument.startsWith('-') || options.issueNumber !== null) {
      throw new Error(`unexpected argument: ${argument}`)
    }
    options.issueNumber = argument
  }

  if (!POSITIVE_ID_RE.test(String(options.issueNumber ?? ''))) {
    throw new Error(REOPEN_USAGE)
  }
  for (const key of Object.keys(options).filter((key) => key !== 'issueNumber')) requireValue(options, key)

  if (options.expectedState !== REOPEN_STATE) {
    throw stateConflict(`--expected-state must be ${REOPEN_STATE}`)
  }
  if (!FULL_SHA_RE.test(options.expectedOldHead)) {
    throw stateConflict('--expected-old-head must be a full 40-character SHA')
  }
  if (!FULL_SHA_RE.test(options.expectedNewHead)) {
    throw stateConflict('--expected-new-head must be a full 40-character SHA')
  }
  if (options.expectedOldHead.toLowerCase() === options.expectedNewHead.toLowerCase()) {
    throw stateConflict('--expected-new-head must differ from --expected-old-head')
  }
  parseExpectedNumber(options.expectedPr, '--expected-pr')
  parseExpectedNumber(options.expectedReviewCycle, '--expected-review-cycle')
  parseExpectedNumber(options.expectedFullReviewCount, '--expected-full-review-count')
  if (!POSITIVE_ID_RE.test(options.authorizationComment)) {
    throw stateConflict('--authorization-comment must be a comment ID')
  }

  return options
}

async function readAuthorizationEvidence({ deps, options, state, pr }) {
  if (typeof deps.readComment !== 'function' ||
      typeof deps.readIssueComments !== 'function' ||
      typeof deps.readTrustedFounderLogins !== 'function') {
    throw blockedExternal('reopen transport dependencies cannot prove complete Founder authorization evidence')
  }
  const [comment, comments, trustedFounderLogins] = await Promise.all([
    deps.readComment(options.repo, options.authorizationComment),
    deps.readIssueComments(options.repo, options.issueNumber),
    deps.readTrustedFounderLogins(options.repo),
  ])
  if (!Array.isArray(comments)) {
    throw blockedExternal('live Issue comments are unavailable for authorization verification')
  }
  const parsed = parseFounderReopenAuthorization(comment?.body)
  const evidence = assertFounderAuthorization({
    authorization: parsed,
    comment,
    comments,
    trustedFounderLogins,
    state,
    pr,
    options,
  })
  if (!comments.some((entry) =>
    String(entry?.id) === String(comment.id) &&
    String(entry?.body ?? '') === String(comment.body ?? '')
  )) {
    throw stateConflict('immutable Founder authorization comment is not present in the live Issue comment set')
  }
  return evidence
}

function assertIssueIdentity(issue, options) {
  if (!issue || String(issue.number) !== String(options.issueNumber)) {
    throw stateConflict('live Issue number does not match the requested Task Issue')
  }
  if (String(issue.state).toUpperCase() !== 'OPEN') {
    throw stateConflict('managed Task Issue is not open')
  }
}

function assertReviewLineage(state) {
  for (const [key, label] of [
    ['latest_result_comment_id', 'original RESULT comment ID'],
    ['latest_review_verdict_comment_id', 'original REVIEW_VERDICT comment ID'],
  ]) {
    if (!POSITIVE_ID_RE.test(String(state?.[key] ?? ''))) {
      throw stateConflict(`${label} is missing from managed Review 1 lineage`)
    }
  }
  if (state.post_budget_reviews != null &&
      (!Array.isArray(state.post_budget_reviews) || state.post_budget_reviews.length > 0)) {
    throw stateConflict('reopen transport cannot replace post-budget review lineage')
  }
}

function assertPreState(issue, state, options) {
  assertIssueIdentity(issue, options)
  if (!isObject(state)) throw stateConflict('managed state is unavailable')
  if (state.state !== options.expectedState) {
    throw stateConflict(`issue state is ${state.state}, expected ${options.expectedState}`)
  }
  if (normalizeId(state.active_task_issue) !== String(options.issueNumber)) {
    throw stateConflict('managed state active Task Issue does not match the requested Issue')
  }
  if (normalizeId(state.active_pr) !== String(options.expectedPr)) {
    throw stateConflict('managed state active PR does not match the requested PR')
  }
  if (normalizeSha(state.current_head) !== normalizeSha(options.expectedOldHead)) {
    throw stateConflict(`current head is ${state.current_head}, expected ${options.expectedOldHead}`)
  }
  if (normalizeSha(state.last_reviewed_head) !== normalizeSha(options.expectedOldHead)) {
    throw stateConflict(`last reviewed head is ${state.last_reviewed_head}, expected ${options.expectedOldHead}`)
  }
  if (state.approved_base !== options.expectedBase) {
    throw stateConflict(`approved base is ${state.approved_base}, expected ${options.expectedBase}`)
  }
  if (String(state.review_cycle) !== String(options.expectedReviewCycle)) {
    throw stateConflict(`review cycle is ${state.review_cycle}, expected ${options.expectedReviewCycle}`)
  }
  if (String(state.full_review_count) !== String(options.expectedFullReviewCount)) {
    throw stateConflict(`full review count is ${state.full_review_count}, expected ${options.expectedFullReviewCount}`)
  }
  if (!normalizeSha(state.guide_source_sha) || typeof state.guide_version !== 'string' || !state.guide_version) {
    throw stateConflict('managed policy version/source evidence is incomplete')
  }
  if (state.guide_source_ref !== options.expectedBase) {
    throw stateConflict('managed policy source ref differs from the approved base')
  }
  if (!Array.isArray(state.open_blockers) || !Array.isArray(state.follow_up_issues)) {
    throw stateConflict('managed blocker and follow-up lineage is incomplete')
  }
  assertReviewLineage(state)
}

function assertPrPreflight(pr, options, expectedHead) {
  if (!pr || Number(pr.number) !== Number(options.expectedPr)) {
    throw stateConflict('live PR number does not match the requested PR')
  }
  if (String(pr.state).toUpperCase() !== 'OPEN') {
    throw stateConflict('live PR is not open')
  }
  if (pr.isDraft === true) throw stateConflict('live PR is still draft')
  if (pr.baseRefName !== options.expectedBase) {
    throw stateConflict('live PR base differs from the approved base')
  }
  if (!normalizeSha(pr.baseRefOid)) {
    throw stateConflict('live PR protected-base SHA is unavailable or malformed')
  }
  if (normalizeSha(pr.headRefOid) !== normalizeSha(expectedHead)) {
    throw stateConflict(`live PR head is ${pr.headRefOid}, expected ${expectedHead}`)
  }
}

function assertPostState(issue, state, pr, evidence, options) {
  assertIssueIdentity(issue, options)
  if (!isObject(state) || state.state !== CORRECTION_STATE) {
    throw stateConflict('post-write Issue state is not FOUNDER_AUTHORIZED_CORRECTION')
  }
  if (state.current_head !== normalizeSha(options.expectedNewHead) ||
      state.last_reviewed_head !== normalizeSha(options.expectedOldHead) ||
      String(state.review_cycle) !== String(options.expectedReviewCycle) ||
      String(state.full_review_count) !== String(options.expectedFullReviewCount) ||
      state.approved_base !== options.expectedBase ||
      normalizeId(state.active_task_issue) !== String(options.issueNumber) ||
      normalizeId(state.active_pr) !== String(options.expectedPr)) {
    throw stateConflict('post-write state does not preserve the complete Review 1 lineage and counters')
  }
  if (String(state.latest_result_comment_id) !== String(evidence.authorization.original_result_comment_id) ||
      String(state.latest_review_verdict_comment_id) !== String(evidence.authorization.review_verdict_comment_id)) {
    throw stateConflict('post-write state changed the original RESULT or REVIEW_VERDICT identity')
  }
  if (state.guide_version !== evidence.authorization.policy_version ||
      state.guide_source_sha !== evidence.authorization.policy_source_sha) {
    throw stateConflict('post-write state changed policy lineage')
  }
  if (state.next_permitted_action !== REOPEN_NEXT_ACTION) {
    throw stateConflict('post-write state does not require one bounded correction and one Delta Review')
  }

  const authorization = state.founder_correction_authorization
  if (!isObject(authorization) ||
      authorization.schema_version !== 2 ||
      authorization.status !== 'authorized' ||
      authorization.authority !== 'Founder' ||
      authorization.scope !== 'correction' ||
      authorization.action !== 'reopen' ||
      authorization.authorization_id !== evidence.authorization.authorization_id ||
      authorization.old_reviewed_head !== normalizeSha(options.expectedOldHead) ||
      authorization.reviewed_head !== normalizeSha(options.expectedNewHead) ||
      authorization.exact_head !== normalizeSha(options.expectedNewHead) ||
      authorization.merge_authorization_invalidated_head !== normalizeSha(options.expectedOldHead) ||
      authorization.maximum_correction_deliveries !== 1 ||
      authorization.correction_deliveries !== 0 ||
      authorization.delta_review_requirement !== true ||
      authorization.required_next_review !== 'Delta Review' ||
      authorization.delta_review_count !== 0 ||
      authorization.correction_result_comment_id !== null ||
      authorization.delta_review_comment_id !== null ||
      !isObject(authorization.authorization_record) ||
      !sameReopenValue(authorization.authorization_record, evidence.authorization)) {
    throw stateConflict('post-write Founder authorization record is incomplete or changed')
  }
  assertReviewLineage(state)
  assertPrPreflight(pr, options, options.expectedNewHead)
}

async function readIssueAndPr(deps, options) {
  if (typeof deps.readManagedIssue !== 'function' || typeof deps.readPullRequest !== 'function') {
    throw blockedExternal('reopen transport dependencies are incomplete')
  }
  const issue = await deps.readManagedIssue(options.issueNumber, options.repo)
  const state = issue?.managedState
  const pr = await deps.readPullRequest(options.expectedPr, options.repo)
  return { issue, state, pr }
}

function assertOptions(options) {
  if (!options || options.help) return
  for (const key of [
    'issueNumber',
    'repo',
    'expectedPr',
    'expectedBase',
    'expectedState',
    'expectedOldHead',
    'expectedNewHead',
    'expectedReviewCycle',
    'expectedFullReviewCount',
    'authorizationComment',
  ]) requireValue(options, key)
  if (options.expectedState !== REOPEN_STATE) throw stateConflict(`expected state must be ${REOPEN_STATE}`)
  if (!normalizeSha(options.expectedOldHead) || !normalizeSha(options.expectedNewHead)) {
    throw stateConflict('reopen heads must be full SHA values')
  }
}

async function runNoOp({ deps, options, issue, state, pr }) {
  assertIssueIdentity(issue, options)
  if (state.state !== CORRECTION_STATE) {
    throw stateConflict(`issue state is ${state.state}, expected ${CORRECTION_STATE}`)
  }
  if (normalizeId(state.active_task_issue) !== String(options.issueNumber) ||
      normalizeId(state.active_pr) !== String(options.expectedPr)) {
    throw stateConflict('post-state Task/PR ownership is incomplete')
  }
  if (state.last_reviewed_head !== normalizeSha(options.expectedOldHead)) {
    throw stateConflict('post-state last_reviewed_head does not preserve the old reviewed head')
  }
  if (state.current_head !== normalizeSha(options.expectedNewHead)) {
    throw stateConflict('post-state current_head does not match the requested new head')
  }
  if (String(state.review_cycle) !== String(options.expectedReviewCycle) ||
      String(state.full_review_count) !== String(options.expectedFullReviewCount)) {
    throw stateConflict('post-state counters changed')
  }
  assertPrPreflight(pr, options, options.expectedNewHead)
  const evidence = await readAuthorizationEvidence({ deps, options, state, pr })
  assertPostState(issue, state, pr, evidence, options)
  return { outcome: 'NO_OP', state }
}

export function createProductionDeps() {
  const runGh = defaultRunGh
  const readManagedIssue = async (issueNumber, repo) => {
    const issue = JSON.parse(runGh([
      'issue',
      'view',
      String(issueNumber),
      '--repo',
      repo,
      '--json',
      'number,id,title,body,state,stateReason',
    ]))
    const parsed = parseMissionControlState(issue.body)
    if (!parsed.present || !parsed.valid) {
      throw stateConflict(`Issue has invalid managed state: ${parsed.reason ?? 'missing state block'}`)
    }
    return { ...issue, managedState: parsed.state }
  }
  const readPullRequest = async (prNumber, repo) => JSON.parse(runGh([
    'pr',
    'view',
    String(prNumber),
    '--repo',
    repo,
    '--json',
    'number,state,isDraft,headRefOid,baseRefName,baseRefOid,statusCheckRollup',
  ]))
  const readComment = async (repo, commentId) => JSON.parse(runGh([
    'api',
    `repos/${repo}/issues/comments/${commentId}`,
  ]))
  const readIssueComments = async (repo, issueNumber) => {
    const pages = JSON.parse(runGh([
      'api',
      '--paginate',
      '--slurp',
      `repos/${repo}/issues/${issueNumber}/comments?per_page=100`,
    ]))
    if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
      throw blockedExternal('live Issue comment pagination is incomplete')
    }
    return pages.flat()
  }
  const readTrustedFounderLogins = async (repo) => {
    const variable = JSON.parse(runGh([
      'api',
      `repos/${repo}/actions/variables/BEMOAT_FOUNDER_LOGINS`,
    ]))
    const logins = String(variable.value ?? '')
      .split(',')
      .map((login) => login.trim())
      .filter(Boolean)
    if (
      logins.length === 0 ||
      logins.some((login) => !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(login))
    ) {
      throw stateConflict('repository Actions variable BEMOAT_FOUNDER_LOGINS is invalid')
    }
    return logins
  }
  const writeIssueBody = async ({ repo, issueNumber, expectedBody, nextBody, transitionIdentity }) =>
    writeIssueBodyWithLease({
      repo,
      issueNumber,
      expectedBody,
      nextBody,
      transitionIdentity,
      holder: 'mission-control-reopen',
      repoFlag: repo,
      deps: { runGh },
    })
  return {
    readManagedIssue,
    readPullRequest,
    readComment,
    readIssueComments,
    readTrustedFounderLogins,
    writeIssueBody,
  }
}

function defaultRunGh(args, options = {}) {
  const result = spawnSync('gh', args, {
    encoding: 'utf8',
    input: options.input,
    env: options.env ?? process.env,
  })
  if (result.error || result.status !== 0) {
    if (options.allowNotFound && /\b404\b|not found/i.test(`${result.stderr ?? ''}\n${result.stdout ?? ''}`)) {
      return null
    }
    throw blockedExternal(result.stderr || result.stdout || result.error?.message || 'GitHub CLI failed')
  }
  return result.stdout.trim()
}

export async function runReopen({ options, deps }) {
  assertOptions(options)
  if (options?.help) return { outcome: 'HELP', state: null }
  if (!deps) throw blockedExternal('reopen transport dependencies are unavailable')

  let initial
  try {
    initial = await readIssueAndPr(deps, options)
  } catch (error) {
    if (String(error?.message ?? '').startsWith('STATE_CONFLICT:') ||
        String(error?.message ?? '').startsWith('BLOCKED_EXTERNAL:')) throw error
    throw stateConflict(`live Issue/PR preflight failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  const { issue, state, pr } = initial

  if (state?.state === CORRECTION_STATE) {
    return runNoOp({ deps, options, issue, state, pr })
  }
  assertPreState(issue, state, options)
  assertPrPreflight(pr, options, options.expectedNewHead)
  const evidence = await readAuthorizationEvidence({ deps, options, state, pr })

  let latest
  try {
    latest = await readIssueAndPr(deps, options)
  } catch (error) {
    if (String(error?.message ?? '').startsWith('STATE_CONFLICT:') ||
        String(error?.message ?? '').startsWith('BLOCKED_EXTERNAL:')) throw error
    throw stateConflict(`live pre-mutation reread failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  assertPreState(latest.issue, latest.state, options)
  assertPrPreflight(latest.pr, options, options.expectedNewHead)
  if (!sameReopenValue(latest.state, state) || latest.issue.body !== issue.body) {
    throw stateConflict('managed Issue changed during authorization preflight')
  }
  const nextState = buildNextState(latest.state, evidence, options, {
    correctionState: CORRECTION_STATE,
    nextAction: REOPEN_NEXT_ACTION,
  })
  let nextBody
  try {
    nextBody = projectMissionControlStateBlock(latest.issue.body, nextState)
  } catch (error) {
    throw stateConflict(`managed state projection failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  try {
    await deps.writeIssueBody({
      repo: options.repo,
      issueNumber: options.issueNumber,
      expectedBody: latest.issue.body,
      nextBody,
      transitionIdentity: JSON.stringify({
        command: REOPEN_COMMAND,
        issue: String(options.issueNumber),
        pr: String(options.expectedPr),
        old_head: normalizeSha(options.expectedOldHead),
        new_head: normalizeSha(options.expectedNewHead),
        authorization_id: evidence.authorization.authorization_id,
      }),
    })
  } catch (error) {
    throw stateConflict(`Issue CAS/lease write outcome is ambiguous: ${error instanceof Error ? error.message : String(error)}`)
  }

  let verified
  try {
    verified = await readIssueAndPr(deps, options)
  } catch (error) {
    if (String(error?.message ?? '').startsWith('STATE_CONFLICT:') ||
        String(error?.message ?? '').startsWith('BLOCKED_EXTERNAL:')) throw error
    throw stateConflict(`post-write Issue/PR readback failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  const postEvidence = await readAuthorizationEvidence({
    deps,
    options,
    state: verified.state,
    pr: verified.pr,
  })
  if (!sameReopenValue(postEvidence.authorization, evidence.authorization)) {
    throw stateConflict('Founder authorization evidence changed during the state write')
  }
  if (verified.issue.body !== nextBody) {
    throw stateConflict('post-write Issue body readback does not match the projected body')
  }
  assertPostState(verified.issue, verified.state, verified.pr, postEvidence, options)
  if (!sameReopenValue(verified.state, nextState)) {
    throw stateConflict('post-write managed state readback does not match the canonical projection')
  }
  return { outcome: 'REOPENED', state: verified.state }
}

export async function main(argv = process.argv.slice(2), deps = createProductionDeps()) {
  const format = argv.includes('--json') ? 'json' : 'text'
  let options = null

  try {
    options = parseReopenArgs(argv)
    if (options.help) {
      process.stdout.write(`${REOPEN_USAGE}\n`)
      return { outcome: 'HELP', state: null }
    }
    const result = await runReopen({ options, deps })
    const rendering = createResultRendering({
      command: REOPEN_COMMAND,
      format,
      options,
      result,
      observedPreState: options.expectedState,
    })
    process.stdout.write(rendering.output)
    process.exitCode = rendering.exitCode
    return rendering.envelope ?? result
  } catch (error) {
    const rendering = createRuntimeErrorRendering({
      command: REOPEN_COMMAND,
      format,
      error,
      options,
    })
    process[rendering.stream].write(rendering.output)
    process.exitCode = rendering.exitCode
    return rendering.envelope ?? { classification: rendering.output.split(':', 1)[0] }
  }
}
