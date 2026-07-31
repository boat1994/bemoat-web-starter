#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { analyzeExactHeadCi } from './agent-issue/exact-head-ci.mjs'
import { parseCorrectionContract } from './correction-contract.mjs'
import { parseMissionControlState, renderMissionControlState } from './mission-control-state.mjs'
import {
  Coordinator,
  normalizeIssueComments,
  parsePaginatedGhApiJson,
  parseRoleCommentBody,
  projectReviewVerdictState,
  resolveProductionCommentTrust,
} from './mission-control-reconcile.mjs'
import { writeIssueBodyWithLease } from './mission-control-issue-body-cas.mjs'

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options })
  if (result.error || result.status !== 0) throw new Error(result.stderr || result.stdout || result.error?.message || `${command} failed`)
  return result.stdout.trim()
}

function parseArgs(argv) {
  const options = { issue: null, repo: null, bodyFile: null, expectedState: null, reviewType: null, expectedHead: null }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--') continue
    const key = { '--repo': 'repo', '--body-file': 'bodyFile', '--expected-state': 'expectedState', '--review-type': 'reviewType', '--expected-head': 'expectedHead' }[argument]
    if (key) {
      const value = argv[++index]
      if (!value || options[key]) throw new Error(`${argument} requires one value`)
      options[key] = value
      continue
    }
    if (argument.startsWith('-') || options.issue) throw new Error(`unexpected argument: ${argument}`)
    options.issue = argument
  }
  if (!options.issue || !/^[1-9]\d*$/.test(options.issue)) throw new Error('a positive Issue number is required')
  if (!options.bodyFile) throw new Error('--body-file is required')
  if (!options.expectedState) throw new Error('--expected-state is required')
  if (!['full', 'delta'].includes(options.reviewType)) throw new Error('--review-type must be full or delta')
  if (!/^[0-9a-f]{7,40}$/i.test(options.expectedHead ?? '')) throw new Error('--expected-head must be a commit SHA')
  return options
}

function replaceStateBlock(body, state) {
  const pattern = /<!--\s*bemoat-mission-control-state:start\s*-->[\s\S]*?<!--\s*bemoat-mission-control-state:end\s*-->/
  if (!pattern.test(body)) throw new Error('managed state block is missing')
  return body.replace(pattern, renderMissionControlState(state))
}

function parseFindings(body, verdict) {
  if (verdict !== 'CORRECTION REQUIRED') return []
  const parsed = parseCorrectionContract(body)
  if (!parsed.ok) throw new Error(`STATE_CONFLICT: ${parsed.errors.join('; ')}`)
  return parsed.contract.findings.map((finding) => ({ finding_id: finding.id, severity: 'Important', disposition: 'open' }))
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const body = readFileSync(options.bodyFile, 'utf8')
  run(process.execPath, ['scripts/post-role-comment.mjs', options.issue, '--body-file', options.bodyFile, '--check', ...(options.repo ? ['--repo', options.repo] : [])])
  const parsedVerdict = parseRoleCommentBody(body)
  if (parsedVerdict.role !== 'REVIEW_VERDICT' || !parsedVerdict.verdict || !parsedVerdict.prNumber || !parsedVerdict.headSha) {
    throw new Error('STATE_CONFLICT: canonical REVIEW_VERDICT PR/head/verdict evidence is required')
  }
  if (parsedVerdict.headSha !== options.expectedHead) throw new Error('STATE_CONFLICT: verdict head differs from --expected-head')

  const repo = options.repo || run('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'])
  const issueArgs = ['issue', 'view', options.issue, '--json', 'body']
  if (options.repo) issueArgs.push('--repo', options.repo)
  let expectedBody = null
  const readIssue = () => {
    const issue = JSON.parse(run('gh', issueArgs))
    const parsed = parseMissionControlState(issue.body)
    if (!parsed.present || !parsed.valid) throw new Error(`STATE_CONFLICT: invalid managed state: ${parsed.reason ?? 'missing state block'}`)
    expectedBody = issue.body
    return parsed.state
  }
  const pr = JSON.parse(run('gh', ['pr', 'view', parsedVerdict.prNumber, '--json', 'number,headRefOid,baseRefName,statusCheckRollup', ...(options.repo ? ['--repo', options.repo] : [])]))
  if (pr.headRefOid !== options.expectedHead || pr.headRefOid !== parsedVerdict.headSha) throw new Error('STATE_CONFLICT: live PR head differs from reviewed head')
  if (!analyzeExactHeadCi(pr).exactHeadVerified) throw new Error('STATE_CONFLICT: exact-head CI is not verified')

  const listComments = () => normalizeIssueComments(parsePaginatedGhApiJson(run('gh', ['api', '--paginate', `repos/${repo}/issues/${options.issue}/comments`])))
  const postComment = (commentBody) => {
    const temp = mkdtempSync(join(tmpdir(), 'bemoat-review-comment-'))
    const payload = join(temp, 'payload.json')
    try {
      writeFileSync(payload, JSON.stringify({ body: commentBody }))
      const posted = JSON.parse(run('gh', ['api', '--method', 'POST', `repos/${repo}/issues/${options.issue}/comments`, '--input', payload]))
      return { ...posted, id: posted.id, body: posted.body ?? commentBody, author: posted.user?.login ?? null, author_association: posted.author_association ?? null }
    } finally { rmSync(temp, { recursive: true, force: true }) }
  }
  const writeState = async (next, expected) => {
    const live = JSON.parse(run('gh', issueArgs))
    const parsed = parseMissionControlState(live.body)
    if (!parsed.present || !parsed.valid || JSON.stringify(parsed.state) !== JSON.stringify(expected) || live.body !== expectedBody) throw new Error('STATE_CONFLICT: concurrent Issue body change detected before state write')
    const nextBody = replaceStateBlock(live.body, next)
    await writeIssueBodyWithLease({ repo, issueNumber: options.issue, expectedBody: live.body, nextBody, transitionIdentity: next.latest_transition_identity, holder: 'mission-control-review', repoFlag: options.repo, deps: { runGh: (args, ghOptions) => run('gh', args, ghOptions) } })
    const verified = JSON.parse(run('gh', issueArgs))
    const verifiedState = parseMissionControlState(verified.body)
    if (!verifiedState.valid || verifiedState.state.latest_review_verdict_comment_id !== next.latest_review_verdict_comment_id) throw new Error('postcondition: verdict projection could not be verified')
    expectedBody = verified.body
    return verifiedState.state
  }
  const original = readIssue()
  if (original.state !== options.expectedState) throw new Error(`STATE_CONFLICT: expected ${options.expectedState}, received ${original.state}`)
  if (original.approved_base !== pr.baseRefName) throw new Error('STATE_CONFLICT: live PR base differs from approved base')
  if (original.current_head !== options.expectedHead) throw new Error('STATE_CONFLICT: managed current head differs from reviewed head')
  const coordinator = new Coordinator({ readState: async () => readIssue(), writeState, listComments: async () => listComments(), postComment: async (comment) => postComment(comment), ...resolveProductionCommentTrust() })
  const result = await coordinator.integrateReviewVerdict({
    verdictBody: body,
    verifyPreconditions: async () => undefined,
    projectState: (prior, comment, identity) => projectReviewVerdictState({ prior, verdict: parsedVerdict.verdict, reviewType: options.reviewType, reviewedHead: options.expectedHead, commentId: comment.id, transitionIdentity: JSON.stringify(identity), findings: parseFindings(body, parsedVerdict.verdict) }),
  })
  if (result.outcome === 'RECOVERABLE_ROUTING_DRIFT') throw new Error(`RECOVERABLE_ROUTING_DRIFT: verdict comment ${result.comment.id} posted but projection failed; rerun this command`)
  process.stdout.write(`Mission Control review ${result.outcome}: ${result.state.state} + REVIEW_VERDICT comment ${result.comment.id}\n`)
}

main().catch((error) => { process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1 })
