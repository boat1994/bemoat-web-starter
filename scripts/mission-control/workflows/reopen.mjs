import { spawnSync } from 'node:child_process'
import { parseMissionControlState, projectMissionControlStateBlock } from '../../mission-control-state.mjs'
import { writeIssueBodyWithLease } from '../../mission-control-issue-body-cas.mjs'

const POSITIVE_ID_RE = /^[1-9]\d*$/
const FULL_SHA_RE = /^[0-9a-f]{40}$/i
const REOPEN_USAGE = 'Usage: pnpm run bemoat:mission-control:reopen -- <issue-number> --repo boat1994/bemoat-web-starter --expected-pr <pr> --expected-base <base> --expected-state ELIGIBLE_FOR_FOUNDER_REVIEW --expected-old-head <sha> --expected-new-head <sha> --expected-review-cycle <num> --expected-full-review-count <num> --authorization-comment <id>'

function stateConflict(message) {
  return new Error(`STATE_CONFLICT: ${message}`)
}

function requireValue(options, key) {
  if (options[key] === null || options[key] === undefined) {
    throw new Error(`--${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)} is required`)
  }
}

export function parseReopenArgs(argv = []) {
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
    if (argument === '--help' || argument === '-h') {
      process.stdout.write(`${REOPEN_USAGE}\n`)
      process.exit(0)
    }
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

  if (options.expectedState !== 'ELIGIBLE_FOR_FOUNDER_REVIEW') throw new Error('STATE_CONFLICT: --expected-state must be ELIGIBLE_FOR_FOUNDER_REVIEW')
  if (!FULL_SHA_RE.test(options.expectedOldHead)) throw new Error('STATE_CONFLICT: --expected-old-head must be a full 40-character SHA')
  if (!FULL_SHA_RE.test(options.expectedNewHead)) throw new Error('STATE_CONFLICT: --expected-new-head must be a full 40-character SHA')
  if (!POSITIVE_ID_RE.test(options.authorizationComment)) throw new Error('STATE_CONFLICT: --authorization-comment must be a comment ID')
  
  return options
}

export function parseFounderReopenAuthorization(body = '') {
  const source = body.trim()
  if (!source) throw stateConflict('Founder authorization evidence must not be empty')

  let extracted = null
  const fenced = [...source.matchAll(/```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```/gi)]
  for (const match of fenced) {
    const candidate = match[1]?.trim()
    if (!candidate) continue
    try {
      extracted = JSON.parse(candidate)
      break
    } catch {
      // ignore
    }
  }
  if (!extracted) {
    if (source.startsWith('{')) {
      try {
        extracted = JSON.parse(source)
      } catch {
        // ignore
      }
    }
  }

  if (!extracted || typeof extracted !== 'object' || Array.isArray(extracted)) {
    throw stateConflict('Founder authorization evidence must decode to one JSON object')
  }

  return extracted
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
    throw new Error(result.stderr || result.stdout || result.error?.message || 'GitHub CLI failed')
  }
  return result.stdout.trim()
}

export function createProductionDeps() {
  const runGh = defaultRunGh
  const readManagedIssue = async (issueNumber, repo) => {
    const issue = JSON.parse(runGh(['issue', 'view', String(issueNumber), '--repo', repo, '--json', 'number,id,title,body,state,stateReason']))
    const parsed = parseMissionControlState(issue.body)
    if (!parsed.present || !parsed.valid) throw stateConflict(`Issue has invalid managed state: ${parsed.reason ?? 'missing state block'}`)
    return { ...issue, managedState: parsed.state }
  }
  const readPullRequest = async (prNumber, repo) => JSON.parse(runGh([
    'pr', 'view', String(prNumber), '--repo', repo,
    '--json', 'number,state,isDraft,headRefOid,baseRefName,baseRefOid,statusCheckRollup',
  ]))
  const readComment = async (repo, commentId) => JSON.parse(runGh(['api', `repos/${repo}/issues/comments/${commentId}`]))
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
    writeIssueBody,
  }
}

export async function runReopen({ options, deps }) {
  const issue = await deps.readManagedIssue(options.issueNumber, options.repo)
  const state = issue.managedState

  if (state.state === 'FOUNDER_AUTHORIZED_CORRECTION') {
    if (state.current_head === options.expectedNewHead &&
        state.founder_correction_authorization?.authorization_id === `founder-${options.authorizationComment}`) {
      return { outcome: 'NO_OP', state }
    }
  }

  if (state.state !== 'ELIGIBLE_FOR_FOUNDER_REVIEW') throw stateConflict(`issue state is ${state.state}, expected ELIGIBLE_FOR_FOUNDER_REVIEW`)
  if (state.current_head !== options.expectedOldHead) throw stateConflict(`current head is ${state.current_head}, expected ${options.expectedOldHead}`)
  if (state.last_reviewed_head !== options.expectedOldHead) throw stateConflict(`last reviewed head is ${state.last_reviewed_head}, expected ${options.expectedOldHead}`)
  if (String(state.review_cycle) !== options.expectedReviewCycle) throw stateConflict(`review cycle is ${state.review_cycle}, expected ${options.expectedReviewCycle}`)
  if (String(state.full_review_count) !== options.expectedFullReviewCount) throw stateConflict(`full review count is ${state.full_review_count}, expected ${options.expectedFullReviewCount}`)
  if (String(state.active_pr) !== options.expectedPr) throw stateConflict(`active PR is ${state.active_pr}, expected ${options.expectedPr}`)

  const pr = await deps.readPullRequest(options.expectedPr, options.repo)
  if (pr.headRefOid !== options.expectedNewHead) throw stateConflict(`PR live head is ${pr.headRefOid}, expected ${options.expectedNewHead}`)

  const authComment = await deps.readComment(options.repo, options.authorizationComment)
  if (!authComment.user?.login || authComment.user.login !== 'boat1994' || authComment.author_association !== 'OWNER') {
    throw stateConflict('Founder authorization comment is not authored by authenticated owner boat1994')
  }

  const authorization = parseFounderReopenAuthorization(authComment.body)
  if (authorization.repository !== options.repo) throw stateConflict('authorization repository mismatch')
  if (String(authorization.task) !== options.issueNumber) throw stateConflict('authorization task mismatch')
  if (String(authorization.pr) !== options.expectedPr) throw stateConflict('authorization PR mismatch')
  if (authorization.approved_base !== options.expectedBase) throw stateConflict('authorization approved base mismatch')
  if (authorization.old_reviewed_head !== options.expectedOldHead) throw stateConflict('authorization old reviewed head mismatch')
  if (authorization.reviewed_head !== options.expectedNewHead) throw stateConflict('authorization new reviewed head mismatch')
  if (authorization.maximum_correction_deliveries !== 1) throw stateConflict('authorization maximum_correction_deliveries must be 1')
  if (authorization.delta_review_requirement !== true) throw stateConflict('authorization delta_review_requirement must be true')
  if (String(authorization.immutable_comment_id) !== options.authorizationComment) throw stateConflict('authorization immutable_comment_id mismatch')
  if (!Array.isArray(authorization.finding_ids) || authorization.finding_ids.length === 0) throw stateConflict('authorization finding_ids must be a non-empty array')

  const nextState = {
    ...state,
    state: 'FOUNDER_AUTHORIZED_CORRECTION',
    current_head: options.expectedNewHead,
    updated_at: new Date().toISOString(),
    updated_by: 'Mission Control',
    founder_correction_authorization: {
      schema_version: 2,
      authority: 'Founder',
      scope: 'correction',
      for_review_number: parseInt(options.expectedReviewCycle, 10),
      status: 'authorized',
      authorization_id: `founder-${options.authorizationComment}`,
      action: 'reopen',
      reviewed_head: options.expectedNewHead,
      finding_ids: authorization.finding_ids,
      authorized_at: authComment.created_at || authComment.createdAt,
    }
  }

  const nextBody = projectMissionControlStateBlock(issue.body, nextState)

  await deps.writeIssueBody({
    repo: options.repo,
    issueNumber: options.issueNumber,
    expectedBody: issue.body,
    nextBody,
    transitionIdentity: 'bemoat:mission-control:reopen',
  })

  return { outcome: 'REOPENED', state: nextState }
}

export async function main(argv = process.argv.slice(2), deps = createProductionDeps()) {
  const options = parseReopenArgs(argv)
  const result = await runReopen({ options, deps })
  process.stdout.write(`Mission Control reopen ${result.outcome}: Task #${options.issueNumber} -> ${result.state.state} ${result.state.review_cycle}/${result.state.full_review_count}\n`)
  return result
}
