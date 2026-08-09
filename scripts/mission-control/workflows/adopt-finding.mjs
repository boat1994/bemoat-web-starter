#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

import {
  createHelpEnvelopeV1,
  formatTextHelp,
} from '../../cli/command-help.mjs'
import {
  CliInvocationError,
  parseCommandInvocation,
  resolveCommandIdentity,
} from '../../cli/command-invocation.mjs'
import {
  CLI_EXIT_CODES,
  classificationExitCode,
  createResultEnvelopeV1,
} from '../../cli/command-result.mjs'
import { parseCorrectionContract } from '../../correction-contract.mjs'
import { writeIssueBodyWithLease, isLeaseCasConflict } from '../../mission-control-issue-body-cas.mjs'
import {
  parseMissionControlState,
  projectMissionControlStateBlock,
} from '../../mission-control-state.mjs'
import {
  ACTIVE_CORRECTION_CONTRACT_IDENTITY_KEY,
  buildActiveCorrectionContractIdentity,
  buildReconciledCorrectionContract,
  reconstructDeltaReviewFindingUnion,
  resolveAuthoritativeCorrectionContract,
  sameValue,
} from '../domain/active-correction-contract.mjs'
import {
  assertFounderAdoptFindingAuthorization,
  parseFounderAdoptFindingAuthorization,
} from '../domain/adopt-finding-authorization.mjs'
import {
  fingerprintCorrectionContract,
  hashExactBody,
} from '../domain/correction-contract-fingerprint.mjs'
import {
  assertOnlyIdentityMutation,
  buildNextState,
  isIdenticalCompletedProjection,
} from '../domain/adopt-finding-projection.mjs'

export const ADOPT_FINDING_COMMAND = 'bemoat:mission-control:adopt-finding'
export const ADOPT_FINDING_ENTRYPOINT = 'scripts/mission-control-adopt-finding.mjs'
export const ACCEPTED_PRE_STATES = Object.freeze([
  'CORRECTION_REQUIRED_1',
  'CORRECTION_REQUIRED_2',
])

const FULL_SHA_RE = /^[0-9a-f]{40}$/i
const POSITIVE_ID_RE = /^[1-9]\d*$/

function classifiedError(classification, message, details = {}) {
  const error = new Error(`${classification}: ${message}`)
  error.classification = classification
  Object.assign(error, details)
  return error
}

function normalizeSha(value) {
  return typeof value === 'string' && FULL_SHA_RE.test(value) ? value.toLowerCase() : null
}

function normalizeId(value) {
  const match = String(value ?? '').match(/^#?([1-9]\d*)$/)
  return match?.[1] ?? null
}

function exactNextAction(issueNumber) {
  return `pnpm run bemoat:agent:issue -- ${issueNumber} --phase correction`
}

function resolveAdoptCommand() {
  const env = process.env.npm_lifecycle_event === 'test:int'
    ? { ...process.env, npm_lifecycle_event: undefined }
    : process.env
  return resolveCommandIdentity({
    fallback: ADOPT_FINDING_COMMAND,
    env,
    entrypoint: ADOPT_FINDING_ENTRYPOINT,
  })
}

function renderHelp(invocation) {
  if (invocation.format === 'json') {
    process.stdout.write(`${JSON.stringify(createHelpEnvelopeV1(invocation.contract))}\n`)
    return
  }
  process.stdout.write(formatTextHelp(invocation.contract))
}

function runtimeClassification(error) {
  if (
    error &&
    typeof error === 'object' &&
    typeof error.classification === 'string' &&
    Object.hasOwn(CLI_EXIT_CODES, error.classification)
  ) {
    return error.classification
  }
  const reason = error instanceof Error ? error.message : String(error)
  const prefix = reason.match(/^(?:ERROR:\s*)?([A-Z_]+):/)
  if (prefix && Object.hasOwn(CLI_EXIT_CODES, prefix[1])) return prefix[1]
  if (isLeaseCasConflict(error) || /\blease\b/i.test(reason)) return 'STATE_CONFLICT'
  if (/\b(?:gh|GitHub|network|remote)\b/i.test(reason)) return 'BLOCKED_EXTERNAL'
  return 'INTERNAL_ERROR'
}

function renderResult({
  command,
  format,
  options,
  classification,
  outcome,
  mutationPerformed,
  observedPreState,
  resultingState,
  repository,
  exactHead,
  evidenceIds,
  details,
}) {
  const envelope = createResultEnvelopeV1({
    command,
    outcome,
    classification,
    mutation_performed: mutationPerformed,
    observed_pre_state: observedPreState,
    resulting_state: resultingState,
    repository,
    issue_number: String(options.issueNumber),
    pr_number: String(options.expectedPr),
    exact_head: exactHead,
    evidence_ids: evidenceIds,
    next_action: classification === 'SUCCESS' || classification === 'NO_OP_IDENTICAL_RETRY'
      ? {
        type: 'COMMAND',
        command: 'bemoat:agent:issue',
        reason: `Exact next permitted action: ${exactNextAction(options.issueNumber)}`,
      }
      : {
        type: 'STOP',
        command: null,
        reason: `Stop on ${classification}; do not retry unless the classification is identically completed.`,
      },
    details: {
      ...details,
      exact_next_permitted_action: exactNextAction(options.issueNumber),
    },
  })

  if (format === 'json') {
    process.stdout.write(`${JSON.stringify(envelope)}\n`)
  } else {
    process.stdout.write(`${envelope.classification}: adopt-finding Task #${options.issueNumber}\n`)
  }
  process.exitCode = classificationExitCode(envelope.classification)
  return envelope
}

function assertPredecessorBindings({
  predecessorComment,
  predecessorAuthorization,
  options,
  authorization,
}) {
  if (!predecessorComment || String(predecessorComment.id) !== String(options.predecessorComment)) {
    throw classifiedError('EVIDENCE_CONFLICT', 'predecessor correction-contract comment ID does not match')
  }
  const bodyHash = hashExactBody(predecessorComment.body)
  const parsed = parseCorrectionContract(predecessorComment.body)
  if (!parsed.ok) {
    throw classifiedError('EVIDENCE_CONFLICT', `predecessor contract is invalid: ${parsed.errors.join('; ')}`)
  }
  if (normalizeSha(parsed.contract.reviewed_head) !== normalizeSha(options.expectedReviewedHead)) {
    throw classifiedError('HEAD_DRIFT', 'predecessor contract reviewed_head does not match expected reviewed head')
  }
  if (normalizeSha(parsed.contract.reviewed_head) !== normalizeSha(authorization.predecessor_reviewed_head)) {
    throw classifiedError('HEAD_DRIFT', 'predecessor contract reviewed_head does not match Founder authorization')
  }
  const fingerprint = fingerprintCorrectionContract(parsed.contract)
  const predecessorIds = parsed.contract.findings.map((finding) => finding.id)
  if (!sameValue(predecessorIds, authorization.existing_finding_ids)) {
    throw classifiedError(
      'EVIDENCE_CONFLICT',
      'predecessor finding IDs do not match Founder authorization existing immutable findings',
    )
  }
  if (
    options.expectedPredecessorBodySha &&
    options.expectedPredecessorBodySha !== bodyHash
  ) {
    throw classifiedError('EVIDENCE_CONFLICT', 'predecessor exact body hash does not match')
  }
  if (
    options.expectedPredecessorFingerprint &&
    options.expectedPredecessorFingerprint !== fingerprint
  ) {
    throw classifiedError('EVIDENCE_CONFLICT', 'predecessor contract fingerprint does not match')
  }
  return {
    comment: predecessorComment,
    bodyHash,
    fingerprint,
    contract: parsed.contract,
    authorizationBinding: predecessorAuthorization ?? null,
  }
}

export async function runAdoptFinding({ options, deps, checkOnly = false }) {
  if (!deps) throw classifiedError('BLOCKED_EXTERNAL', 'adopt-finding transport dependencies are unavailable')

  const issue = await deps.readManagedIssue(options.issueNumber, options.repo)
  const state = issue?.managedState
  if (!state) throw classifiedError('STATE_CONFLICT', 'managed state is unavailable')
  if (!ACCEPTED_PRE_STATES.includes(state.state)) {
    throw classifiedError('UNSUPPORTED_PRE_STATE', `state ${state.state} is not CORRECTION_REQUIRED_1|2`)
  }
  if (options.expectedState && state.state !== options.expectedState) {
    throw classifiedError('UNSUPPORTED_PRE_STATE', `issue state is ${state.state}, expected ${options.expectedState}`)
  }
  if (normalizeId(state.active_task_issue) !== String(options.issueNumber)) {
    throw classifiedError('EVIDENCE_CONFLICT', 'managed state active Task Issue does not match')
  }
  if (normalizeId(state.active_pr) !== String(options.expectedPr)) {
    throw classifiedError('EVIDENCE_CONFLICT', 'managed state active PR does not match')
  }
  if (state.approved_base !== options.expectedBase) {
    throw classifiedError('HEAD_DRIFT', 'managed approved base does not match')
  }
  if (normalizeSha(state.last_reviewed_head) !== normalizeSha(options.expectedReviewedHead)) {
    throw classifiedError('HEAD_DRIFT', 'managed last_reviewed_head does not match predecessor reviewed head')
  }
  if (normalizeSha(state.current_head) !== normalizeSha(options.expectedAdoptionHead)) {
    throw classifiedError('HEAD_DRIFT', 'managed current_head does not match live adoption head')
  }

  const pr = await deps.readPullRequest(options.expectedPr, options.repo)
  if (!pr || Number(pr.number) !== Number(options.expectedPr)) {
    throw classifiedError('EVIDENCE_CONFLICT', 'live PR number does not match')
  }
  if (pr.baseRefName !== options.expectedBase) {
    throw classifiedError('HEAD_DRIFT', 'live PR base name does not match')
  }
  if (normalizeSha(pr.baseRefOid) !== normalizeSha(options.expectedBaseSha)) {
    throw classifiedError('HEAD_DRIFT', 'live PR base SHA does not match')
  }
  if (normalizeSha(pr.headRefOid) !== normalizeSha(options.expectedAdoptionHead)) {
    throw classifiedError('HEAD_DRIFT', 'live PR head does not match adoption head')
  }

  const [authorizationComment, comments, trustedFounderLogins, predecessorComment] = await Promise.all([
    deps.readComment(options.repo, options.authorizationComment),
    deps.readIssueComments(options.repo, options.issueNumber),
    deps.readTrustedFounderLogins(options.repo),
    deps.readComment(options.repo, options.predecessorComment),
  ])

  let parsedAuthorization
  try {
    parsedAuthorization = parseFounderAdoptFindingAuthorization(authorizationComment?.body ?? '')
  } catch (error) {
    if (error?.classification) throw error
    throw classifiedError('AUTHORITY_CONFLICT', error instanceof Error ? error.message : String(error))
  }

  const authorization = assertFounderAdoptFindingAuthorization({
    authorization: parsedAuthorization,
    comment: authorizationComment,
    comments,
    trustedFounderLogins,
    options,
  })

  const predecessor = assertPredecessorBindings({
    predecessorComment,
    options,
    authorization,
  })

  // Historical REVIEW_VERDICT immutability: never edit comments; only verify predecessor body remains.
  if (!comments.some((entry) =>
    String(entry?.id) === String(predecessorComment.id) &&
    String(entry?.body ?? '') === String(predecessorComment.body ?? '')
  )) {
    throw classifiedError('EVIDENCE_CONFLICT', 'predecessor REVIEW_VERDICT/contract comment is missing from live comments')
  }

  const reconciled = buildReconciledCorrectionContract({
    predecessorContract: predecessor.contract,
    adoptedFinding: authorization.adopted_finding,
  })
  if (!reconciled.ok) {
    throw classifiedError('EVIDENCE_CONFLICT', reconciled.errors.join('; '))
  }

  const identity = buildActiveCorrectionContractIdentity({
    predecessorCommentId: options.predecessorComment,
    predecessorBody: predecessorComment.body,
    predecessorContract: predecessor.contract,
    founderAuthorizationCommentId: options.authorizationComment,
    founderAuthorizationBody: authorizationComment.body,
    founderAuthorLogin: authorization.founder_author_login,
    adoptionHead: options.expectedAdoptionHead,
    repository: options.repo,
    taskIssue: options.issueNumber,
    pr: options.expectedPr,
    base: options.expectedBase,
    baseSha: options.expectedBaseSha,
    adoptedFinding: authorization.adopted_finding,
    authorizationId: authorization.authorization_id,
    contract: reconciled.contract,
  })

  if (isIdenticalCompletedProjection({ state, identity, options, authorization })) {
    return {
      classification: 'NO_OP_IDENTICAL_RETRY',
      outcome: 'NO_OP',
      mutationPerformed: false,
      state,
      identity: state[ACTIVE_CORRECTION_CONTRACT_IDENTITY_KEY],
      authorization,
      predecessor,
      contract: state[ACTIVE_CORRECTION_CONTRACT_IDENTITY_KEY].contract,
    }
  }

  // Changed authorization / predecessor / head / finding / competing contract is never identical retry.
  if (state[ACTIVE_CORRECTION_CONTRACT_IDENTITY_KEY]) {
    const existing = state[ACTIVE_CORRECTION_CONTRACT_IDENTITY_KEY]
    if (
      String(existing.founder_authorization_comment_id) !== String(options.authorizationComment) ||
      String(existing.predecessor_comment_id) !== String(options.predecessorComment) ||
      existing.contract_fingerprint !== identity.contract_fingerprint ||
      existing.adoption_head !== identity.adoption_head
    ) {
      throw classifiedError(
        'STATE_CONFLICT',
        'an active correction-contract identity already exists with different authorization/predecessor/head/finding evidence',
      )
    }
  }

  const nextState = buildNextState(state, identity)
  assertOnlyIdentityMutation(state, nextState)

  let nextBody
  try {
    nextBody = projectMissionControlStateBlock(issue.body, nextState)
  } catch (error) {
    throw classifiedError('STATE_CONFLICT', `managed state projection failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  const evidenceIds = {
    predecessor_comment_id: String(options.predecessorComment),
    predecessor_body_sha256: predecessor.bodyHash,
    predecessor_contract_fingerprint: predecessor.fingerprint,
    founder_authorization_comment_id: String(options.authorizationComment),
    founder_authorization_body_sha256: authorization.body_sha256,
    founder_author_login: authorization.founder_author_login,
    active_contract_fingerprint: identity.contract_fingerprint,
  }

  if (checkOnly) {
    return {
      classification: 'SUCCESS',
      outcome: 'SUCCESS',
      mutationPerformed: false,
      state,
      nextState,
      identity,
      authorization,
      predecessor,
      contract: reconciled.contract,
      evidenceIds,
      checkOnly: true,
    }
  }

  // Pre-mutation reread for head/base drift.
  const latestIssue = await deps.readManagedIssue(options.issueNumber, options.repo)
  const latestPr = await deps.readPullRequest(options.expectedPr, options.repo)
  if (latestIssue.body !== issue.body || !sameValue(latestIssue.managedState, state)) {
    throw classifiedError('STATE_CONFLICT', 'managed Issue changed during adopt-finding preflight')
  }
  if (normalizeSha(latestPr.headRefOid) !== normalizeSha(options.expectedAdoptionHead) ||
      normalizeSha(latestPr.baseRefOid) !== normalizeSha(options.expectedBaseSha)) {
    throw classifiedError('HEAD_DRIFT', 'live PR head/base drifted before adopt-finding mutation')
  }

  try {
    await deps.writeIssueBody({
      repo: options.repo,
      issueNumber: options.issueNumber,
      expectedBody: latestIssue.body,
      nextBody,
      transitionIdentity: JSON.stringify({
        command: ADOPT_FINDING_COMMAND,
        issue: String(options.issueNumber),
        pr: String(options.expectedPr),
        authorization_comment: String(options.authorizationComment),
        predecessor_comment: String(options.predecessorComment),
        contract_fingerprint: identity.contract_fingerprint,
        adoption_head: identity.adoption_head,
      }),
    })
  } catch (error) {
    if (isLeaseCasConflict(error) || /lease CAS lost|concurrent/i.test(String(error?.message ?? ''))) {
      throw classifiedError('STATE_CONFLICT', error instanceof Error ? error.message : String(error))
    }
    throw classifiedError('AMBIGUOUS_RESULT', `Issue CAS/lease write outcome is ambiguous: ${error instanceof Error ? error.message : String(error)}`)
  }

  let verified
  try {
    verified = await deps.readManagedIssue(options.issueNumber, options.repo)
  } catch (error) {
    throw classifiedError('AMBIGUOUS_RESULT', `post-write Issue readback failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (verified.body !== nextBody) {
    throw classifiedError('AMBIGUOUS_RESULT', 'post-write Issue body readback does not match the projected body')
  }
  assertOnlyIdentityMutation(state, verified.managedState)
  if (!sameValue(verified.managedState[ACTIVE_CORRECTION_CONTRACT_IDENTITY_KEY], identity)) {
    throw classifiedError('AMBIGUOUS_RESULT', 'post-write active correction-contract identity does not match')
  }

  return {
    classification: 'SUCCESS',
    outcome: 'SUCCESS',
    mutationPerformed: true,
    state: verified.managedState,
    identity,
    authorization,
    predecessor,
    contract: reconciled.contract,
    evidenceIds,
  }
}

export function createProductionDeps() {
  const runGh = (args, options = {}) => {
    const result = spawnSync('gh', args, {
      encoding: 'utf8',
      input: options.input,
      env: options.env ?? process.env,
    })
    if (result.error || result.status !== 0) {
      throw classifiedError(
        'BLOCKED_EXTERNAL',
        result.stderr || result.stdout || result.error?.message || 'GitHub CLI failed',
      )
    }
    return result.stdout.trim()
  }

  return {
    readManagedIssue: async (issueNumber, repo) => {
      const issue = JSON.parse(runGh([
        'issue', 'view', String(issueNumber), '--repo', repo, '--json', 'number,id,title,body,state',
      ]))
      const parsed = parseMissionControlState(issue.body)
      if (!parsed.present || !parsed.valid) {
        throw classifiedError('STATE_CONFLICT', `Issue has invalid managed state: ${parsed.reason ?? 'missing state block'}`)
      }
      return { ...issue, managedState: parsed.state }
    },
    readPullRequest: async (prNumber, repo) => JSON.parse(runGh([
      'pr', 'view', String(prNumber), '--repo', repo,
      '--json', 'number,state,isDraft,headRefOid,baseRefName,baseRefOid',
    ])),
    readComment: async (repo, commentId) => JSON.parse(runGh([
      'api', `repos/${repo}/issues/comments/${commentId}`,
    ])),
    readIssueComments: async (repo, issueNumber) => {
      const pages = JSON.parse(runGh([
        'api', '--paginate', '--slurp',
        `repos/${repo}/issues/${issueNumber}/comments?per_page=100`,
      ]))
      if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
        throw classifiedError('BLOCKED_EXTERNAL', 'live Issue comment pagination is incomplete')
      }
      return pages.flat()
    },
    readTrustedFounderLogins: async (repo) => {
      const variable = JSON.parse(runGh([
        'api', `repos/${repo}/actions/variables/BEMOAT_FOUNDER_LOGINS`,
      ]))
      const logins = String(variable.value ?? '')
        .split(',')
        .map((login) => login.trim())
        .filter(Boolean)
      if (logins.length === 0) {
        throw classifiedError('STATE_CONFLICT', 'repository Actions variable BEMOAT_FOUNDER_LOGINS is invalid')
      }
      return logins
    },
    writeIssueBody: async ({ repo, issueNumber, expectedBody, nextBody, transitionIdentity }) =>
      writeIssueBodyWithLease({
        repo,
        issueNumber,
        expectedBody,
        nextBody,
        transitionIdentity,
        holder: 'mission-control-adopt-finding',
        repoFlag: repo,
        deps: { runGh },
      }),
  }
}

function invocationToOptions(invocation) {
  const values = invocation.values
  const options = {
    issueNumber: values.issue_number,
    repo: values.repository,
    expectedPr: values.expected_pr,
    expectedBase: values.expected_base,
    expectedBaseSha: values.expected_base_sha,
    expectedState: values.expected_state,
    expectedReviewedHead: values.expected_reviewed_head,
    expectedAdoptionHead: values.expected_adoption_head,
    predecessorComment: values.predecessor_comment,
    authorizationComment: values.authorization_comment,
    expectedPredecessorBodySha: values.expected_predecessor_body_sha ?? null,
    expectedPredecessorFingerprint: values.expected_predecessor_fingerprint ?? null,
    check: values.check === true,
  }
  for (const [key, label] of [
    ['repo', '--repo'],
    ['expectedPr', '--expected-pr'],
    ['expectedBase', '--expected-base'],
    ['expectedBaseSha', '--expected-base-sha'],
    ['expectedState', '--expected-state'],
    ['expectedReviewedHead', '--expected-reviewed-head'],
    ['expectedAdoptionHead', '--expected-adoption-head'],
    ['predecessorComment', '--predecessor-comment'],
    ['authorizationComment', '--authorization-comment'],
  ]) {
    if (options[key] == null || options[key] === '') {
      throw new CliInvocationError(label, `${label} is required`)
    }
  }
  if (!ACCEPTED_PRE_STATES.includes(options.expectedState)) {
    throw classifiedError('UNSUPPORTED_PRE_STATE', '--expected-state must be CORRECTION_REQUIRED_1 or CORRECTION_REQUIRED_2')
  }
  if (!normalizeSha(options.expectedBaseSha) ||
      !normalizeSha(options.expectedReviewedHead) ||
      !normalizeSha(options.expectedAdoptionHead)) {
    throw classifiedError('INVALID_INVOCATION', 'head/base SHA flags must be full 40-character SHAs')
  }
  if (!POSITIVE_ID_RE.test(String(options.predecessorComment)) ||
      !POSITIVE_ID_RE.test(String(options.authorizationComment))) {
    throw classifiedError('INVALID_INVOCATION', 'comment IDs must be positive integers')
  }
  return options
}

export async function main(argv = process.argv.slice(2), deps = createProductionDeps()) {
  let command = null
  let invocation = null
  let options = null

  try {
    command = resolveAdoptCommand()
    invocation = parseCommandInvocation(command, argv)
    if (invocation.mode === 'help') {
      renderHelp(invocation)
      process.exitCode = 0
      return { classification: 'HELP' }
    }

    options = invocationToOptions(invocation)
    const result = await runAdoptFinding({
      options,
      deps,
      checkOnly: options.check === true,
    })

    return renderResult({
      command,
      format: invocation.format,
      options,
      classification: result.classification,
      outcome: result.outcome,
      mutationPerformed: result.mutationPerformed,
      observedPreState: options.expectedState,
      resultingState: result.state?.state ?? options.expectedState,
      repository: options.repo.toLowerCase(),
      exactHead: normalizeSha(options.expectedAdoptionHead),
      evidenceIds: result.evidenceIds ?? {
        founder_authorization_comment_id: String(options.authorizationComment),
        predecessor_comment_id: String(options.predecessorComment),
      },
      details: {
        check_only: result.checkOnly === true,
        adopted_finding_id: result.identity?.adopted_finding_id ?? result.authorization?.adopted_finding?.id ?? null,
        active_contract_fingerprint: result.identity?.contract_fingerprint ?? null,
        mutation_boundary: 'active_correction_contract_identity_only',
      },
    })
  } catch (error) {
    if (error instanceof CliInvocationError) {
      const envelope = createResultEnvelopeV1({
        command: command ?? ADOPT_FINDING_COMMAND,
        outcome: 'STOP',
        classification: 'INVALID_INVOCATION',
        mutation_performed: false,
        observed_pre_state: null,
        resulting_state: null,
        repository: options?.repo?.toLowerCase?.() ?? null,
        issue_number: options?.issueNumber ? String(options.issueNumber) : null,
        pr_number: options?.expectedPr ? String(options.expectedPr) : null,
        exact_head: null,
        evidence_ids: {},
        next_action: {
          type: 'STOP',
          command: null,
          reason: error.message,
        },
        details: {
          argument: error.details?.argument ?? null,
          reason: error.message,
        },
      })
      if (invocation?.format === 'json' || argv.includes('--json')) {
        process.stdout.write(`${JSON.stringify(envelope)}\n`)
      } else {
        process.stderr.write(`INVALID_INVOCATION: ${error.message}\n`)
      }
      process.exitCode = classificationExitCode('INVALID_INVOCATION')
      return envelope
    }

    const classification = runtimeClassification(error)
    const message = error instanceof Error ? error.message : String(error)
    if (options) {
      const envelope = createResultEnvelopeV1({
        command: command ?? ADOPT_FINDING_COMMAND,
        outcome: classification === 'INTERNAL_ERROR' ? 'ERROR' : 'STOP',
        classification,
        mutation_performed: false,
        observed_pre_state: options.expectedState ?? null,
        resulting_state: null,
        repository: options.repo.toLowerCase(),
        issue_number: String(options.issueNumber),
        pr_number: String(options.expectedPr),
        exact_head: normalizeSha(options.expectedAdoptionHead),
        evidence_ids: {
          founder_authorization_comment_id: String(options.authorizationComment),
          predecessor_comment_id: String(options.predecessorComment),
        },
        next_action: {
          type: 'STOP',
          command: null,
          reason: message,
        },
        details: {
          reason: message,
        },
      })
      if (invocation?.format === 'json' || argv.includes('--json')) {
        process.stdout.write(`${JSON.stringify(envelope)}\n`)
      } else {
        process.stderr.write(`${classification}: ${message}\n`)
      }
      process.exitCode = classificationExitCode(classification)
      return envelope
    }

    process.stderr.write(`${classification}: ${message}\n`)
    process.exitCode = classificationExitCode(classification)
    return { classification }
  }
}

export {
  reconstructDeltaReviewFindingUnion,
  resolveAuthoritativeCorrectionContract,
  exactNextAction,
}
