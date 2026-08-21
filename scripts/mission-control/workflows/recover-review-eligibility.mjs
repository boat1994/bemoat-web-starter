#!/usr/bin/env node
import { createHelpEnvelopeV1, formatTextHelp } from '../../cli/command-help.mjs'
import { CliInvocationError, parseCommandInvocation, resolveCommandIdentity } from '../../cli/command-invocation.mjs'
import { CLI_EXIT_CODES, classificationExitCode, createResultEnvelopeV1 } from '../../cli/command-result.mjs'
import { isLeaseCasConflict, writeIssueBodyWithLease } from './issue-body-cas.mjs'
import { defaultRunGh } from '../adapters/recover-state-github.mjs'
import { appendMissingMissionControlStateBlock, parseMissionControlState } from '../domain/task-state.ts'
import { reconstructReviewEligibilityState } from '../domain/review-eligibility-recovery.mjs'
import { stableStringify } from '../domain/correction-contract-fingerprint.mjs'

export const RECOVER_REVIEW_ELIGIBILITY_COMMAND = 'bemoat:mission-control:recover-review-eligibility'
export const RECOVER_REVIEW_ELIGIBILITY_ENTRYPOINT = 'scripts/mission-control-recover-review-eligibility.mjs'

function classifiedError(classification, message) {
  const error = new Error(`${classification}: ${message}`)
  error.classification = classification
  return error
}

function sameValue(left, right) {
  return stableStringify(left) === stableStringify(right)
}

async function readEvidence({ options, deps, allowExistingState = false }) {
  const [issue, pr, comments, policy, checks] = await Promise.all([
    deps.readManagedIssue(options.issueNumber, options.repo),
    deps.readPullRequest(options.expectedPr, options.repo),
    deps.readIssueComments(options.repo, options.issueNumber),
    deps.readProtectedPolicy(options.repo, options.expectedBase),
    deps.readExactHeadChecks(options.repo, options.expectedHead),
  ])
  const resultComment = comments.find((comment) => String(comment.id) === String(options.resultComment))
  const resultHeadMatch = String(resultComment?.body ?? '').match(/(?:^|\n)\s*(?:Head|Exact head):\s*`?([0-9a-f]{40})`?/i)
  const mechanicalCorrection = resultHeadMatch && resultHeadMatch[1].toLowerCase() !== String(options.expectedHead).toLowerCase()
    ? await deps.readCommitDelta(options.repo, resultHeadMatch[1], options.expectedHead)
    : null
  const state = reconstructReviewEligibilityState({
    ...options,
    issueBody: allowExistingState ? '' : issue.body,
    comments,
    resultComment,
    pullRequest: pr,
    policy,
    ci: checks,
    mechanicalCorrection,
  })
  return { issue, pr, comments, policy, checks, state, issueBody: String(issue.body ?? '') }
}

export async function runRecoverReviewEligibility({ options, deps, checkOnly = false }) {
  const reconstruction = await readEvidence({ options, deps, allowExistingState: true })
  const parsed = parseMissionControlState(reconstruction.issueBody)
  if (parsed.present) {
    if (parsed.valid && sameValue(parsed.state, reconstruction.state)) {
      return { classification: 'NO_OP_IDENTICAL_RETRY', outcome: 'NO_OP', mutationPerformed: false, state: parsed.state, nextAction: { type: 'COMMAND', command: 'bemoat:mission-control:review', reason: `The identical Review 1 eligibility projection is already durable; ordinary review remains the next owner.` }, evidenceIds: reconstruction.state.recovery_base_binding, observedPreState: 'MANAGED_STATE_BLOCK_PRESENT' }
    }
    throw classifiedError('STATE_CONFLICT', parsed.valid ? 'a valid managed state already exists with different content' : `managed state is malformed or partial: ${parsed.reason}`)
  }
  let nextBody
  try {
    nextBody = appendMissingMissionControlStateBlock(reconstruction.issueBody, reconstruction.state)
  } catch (error) {
    throw classifiedError('STATE_CONFLICT', error instanceof Error ? error.message : String(error))
  }
  const nextAction = { type: 'COMMAND', command: 'bemoat:mission-control:review', reason: `Publish the ordinary exact-head review for Issue #${options.issueNumber}; recovery does not publish a verdict.` }
  if (checkOnly) return { classification: 'SUCCESS', outcome: 'SUCCESS', mutationPerformed: false, state: reconstruction.state, nextAction, evidenceIds: reconstruction.state.recovery_base_binding, observedPreState: parsed.present ? 'MANAGED_STATE_BLOCK_PRESENT' : 'MANAGED_STATE_BLOCK_ABSENT', checkOnly: true }

  const latest = await readEvidence({ options, deps })
  if (latest.issueBody !== reconstruction.issueBody || parseMissionControlState(latest.issueBody).present) throw classifiedError('STATE_CONFLICT', 'managed Issue changed before missing-state review recovery mutation')
  if (!sameValue(latest.state, reconstruction.state)) throw classifiedError('EVIDENCE_CONFLICT', 'immutable review recovery evidence changed before mutation')
  try {
    await deps.writeIssueBody({
      repo: options.repo,
      issueNumber: options.issueNumber,
      expectedBody: reconstruction.issueBody,
      nextBody,
      transitionIdentity: JSON.stringify({ command: RECOVER_REVIEW_ELIGIBILITY_COMMAND, issue: String(options.issueNumber), pr: String(options.expectedPr), current_head: options.expectedHead, result_comment: String(options.resultComment), evidence_fingerprint: reconstruction.state.recovery_evidence_fingerprint }),
    })
  } catch (error) {
    if (isLeaseCasConflict(error) || /lease CAS lost|concurrent|stale Issue body/i.test(String(error?.message ?? ''))) throw classifiedError('STATE_CONFLICT', error instanceof Error ? error.message : String(error))
    throw classifiedError('AMBIGUOUS_RESULT', `Issue CAS/lease write outcome is ambiguous: ${error instanceof Error ? error.message : String(error)}`)
  }
  const verified = await deps.readManagedIssue(options.issueNumber, options.repo)
  const verifiedState = parseMissionControlState(String(verified.body ?? ''))
  if (String(verified.body ?? '') !== nextBody || !verifiedState.present || !verifiedState.valid || !sameValue(verifiedState.state, reconstruction.state)) throw classifiedError('AMBIGUOUS_RESULT', 'post-write Issue readback does not match the reconstructed review-eligibility state')
  return { classification: 'SUCCESS', outcome: 'SUCCESS', mutationPerformed: true, state: verifiedState.state, nextAction, evidenceIds: reconstruction.state.recovery_base_binding, observedPreState: 'MANAGED_STATE_BLOCK_ABSENT' }
}

function runtimeClassification(error) {
  if (error?.classification && Object.hasOwn(CLI_EXIT_CODES, error.classification)) return error.classification
  if (isLeaseCasConflict(error) || /\blease\b/i.test(String(error?.message ?? ''))) return 'STATE_CONFLICT'
  if (/\b(?:gh|GitHub|network|remote)\b/i.test(String(error?.message ?? ''))) return 'BLOCKED_EXTERNAL'
  return 'INTERNAL_ERROR'
}

function resolveCommand() {
  return resolveCommandIdentity({ fallback: RECOVER_REVIEW_ELIGIBILITY_COMMAND, env: process.env, entrypoint: RECOVER_REVIEW_ELIGIBILITY_ENTRYPOINT })
}

function optionsFromInvocation(invocation) {
  const values = invocation.values
  return {
    issueNumber: values.issue_number,
    repo: values.repository,
    expectedPr: values.expected_pr,
    expectedBase: values.expected_base,
    expectedBaseSha: values.expected_base_sha,
    expectedHead: values.expected_head,
    expectedBranch: values.expected_branch,
    resultComment: values.result_comment,
    check: values.check === true,
  }
}

export async function main(argv = process.argv.slice(2), deps = createProductionDeps()) {
  let command = RECOVER_REVIEW_ELIGIBILITY_COMMAND
  let invocation
  let options
  try {
    command = resolveCommand()
    invocation = parseCommandInvocation(command, argv)
    if (invocation.mode === 'help') {
      if (invocation.format === 'json') process.stdout.write(`${JSON.stringify(createHelpEnvelopeV1(invocation.contract))}\n`)
      else process.stdout.write(formatTextHelp(invocation.contract))
      return { classification: 'HELP' }
    }
    options = optionsFromInvocation(invocation)
    const result = await runRecoverReviewEligibility({ options, deps, checkOnly: options.check })
    const envelope = createResultEnvelopeV1({
      command,
      outcome: result.outcome,
      classification: result.classification,
      mutation_performed: result.mutationPerformed,
      observed_pre_state: result.observedPreState,
      resulting_state: result.state?.state ?? null,
      repository: options.repo,
      issue_number: String(options.issueNumber),
      pr_number: String(options.expectedPr),
      exact_head: options.expectedHead,
      evidence_ids: result.evidenceIds,
      next_action: result.nextAction,
      details: { check_only: result.checkOnly === true, no_comment_mutation: true, no_review_verdict_mutation: true, review_counters_incremented: false },
    })
    if (invocation.format === 'json') process.stdout.write(`${JSON.stringify(envelope)}\n`)
    else process.stdout.write(`${envelope.classification}: review-eligibility recovery Task #${options.issueNumber}\n`)
    process.exitCode = classificationExitCode(envelope.classification)
    return envelope
  } catch (error) {
    const classification = error instanceof CliInvocationError ? 'INVALID_INVOCATION' : runtimeClassification(error)
    const envelope = createResultEnvelopeV1({ command, outcome: classification === 'INTERNAL_ERROR' ? 'ERROR' : 'STOP', classification, mutation_performed: false, observed_pre_state: null, resulting_state: null, repository: options?.repo ?? null, issue_number: options?.issueNumber ? String(options.issueNumber) : null, pr_number: options?.expectedPr ? String(options.expectedPr) : null, exact_head: options?.expectedHead ?? null, evidence_ids: {}, next_action: { type: 'STOP', command: null, reason: error instanceof Error ? error.message : String(error) }, details: { reason: error instanceof Error ? error.message : String(error) } })
    if (invocation?.format === 'json' || argv.includes('--json')) process.stdout.write(`${JSON.stringify(envelope)}\n`)
    else process.stderr.write(`${classification}: ${envelope.next_action.reason}\n`)
    process.exitCode = classificationExitCode(classification)
    return envelope
  }
}

export function createProductionDeps() {
  const runGh = defaultRunGh
  return {
    readManagedIssue: async (issueNumber, repo) => JSON.parse(runGh(['issue', 'view', String(issueNumber), '--repo', repo, '--json', 'number,id,title,body,state'])),
    readPullRequest: async (prNumber, repo) => JSON.parse(runGh(['pr', 'view', String(prNumber), '--repo', repo, '--json', 'number,state,isDraft,headRefName,headRefOid,baseRefName,baseRefOid'])),
    readIssueComments: async (repo, issueNumber) => {
      const pages = JSON.parse(runGh(['api', '--paginate', '--slurp', `repos/${repo}/issues/${issueNumber}/comments?per_page=100`]))
      if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) throw classifiedError('BLOCKED_EXTERNAL', 'Issue comment pagination is incomplete')
      return pages.flat()
    },
    readCommitDelta: async (repo, from, to) => JSON.parse(runGh(['api', `repos/${repo}/compare/${from}...${to}`])),
    readProtectedPolicy: async (repo, ref) => {
      const mainRef = JSON.parse(runGh(['api', `repos/${repo}/git/ref/heads/${ref}`]))
      const commitSha = mainRef.object.sha
      const file = JSON.parse(runGh(['api', `repos/${repo}/contents/docs/mission-control/mission-control-guide.md?ref=${commitSha}`]))
      const body = Buffer.from(String(file.content ?? '').replace(/\s+/g, ''), 'base64').toString('utf8')
      const version = body.match(/(?:version|Guide version)\s*[`:]\s*([0-9]+\.[0-9]+\.[0-9]+)/i)?.[1] ?? null
      return { ref, commitSha, sha: file.sha, guideVersion: version }
    },
    readExactHeadChecks: async (repo, head) => {
      const response = JSON.parse(runGh(['api', `repos/${repo}/commits/${head}/check-runs`]))
      const checks = Object.fromEntries(
        response.check_runs
          .filter((check) => check.conclusion === 'success' && check.head_sha === head)
          .map((check) => [check.name === 'CI (starter strict)' ? 'starter-ci' : check.name === 'CI' ? 'ci' : check.name, { conclusion: check.conclusion, head_sha: check.head_sha }])
      )
      return checks
    },
    writeIssueBody: async (input) => writeIssueBodyWithLease({ ...input, holder: RECOVER_REVIEW_ELIGIBILITY_COMMAND, repoFlag: input.repo, deps: { runGh } }),
  }
}
