import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

import yaml from 'yaml'

import { analyzeExactHeadCi } from '../../agent-issue/exact-head-ci.mjs'
import { parseCorrectionContract, parseCorrectionEvidenceMap, validateFindingIdentity } from '../domain/correction-contract.mjs'
import { scanGuideContent } from '../../guards/mission-control-contract/scan-guide.mjs'
import { parseMissionControlState, projectMissionControlStateBlock } from '../domain/task-state.mjs'
import {
  Coordinator,
  normalizeIssueComments,
  parseRoleCommentBody,
  projectReviewVerdictState,
} from '../../mission-control-reconcile.mjs'
import { writeIssueBodyWithLease } from './issue-body-cas.mjs'
import {
  RECOVERY_FINDING_IDS,
  RECOVERY_SOURCE_COMMENT_IDS,
  parseRecoveryReceipt,
  parseOrdinaryReviewEvidence,
  validateRecoveryRecord,
} from '../domain/review-recovery.mjs'

const FULL_SHA_RE = /^[0-9a-f]{40}$/i
const POSITIVE_ID_RE = /^[1-9]\d*$/
const STARTER_REPOSITORY = 'boat1994/bemoat-web-starter'
const CURRENT_MISSION_CONTROL_GUIDE_VERSION = '1.3.0'
const GUIDE_PATH = 'docs/mission-control/mission-control-guide.md'
const RECOVERY_FACADE_PATH = 'scripts/mission-control-recover-review.mjs'
const RECOVERY_WORKFLOW_PATH = 'scripts/mission-control/workflows/recover-review.mjs'
const TRANSPORT_REGISTRY_PATH = 'scripts/mission-control/transport-registry.mjs'
const CHILD_OVERRIDE_PATH = '.bemoat/mission-control-overrides.md'
const AUTHORIZED_HOTFIX_BRANCH = 'hotfix/incident-vs-execution-policy-base'
const REQUIRED_EXECUTION_PATHS = [
  RECOVERY_FACADE_PATH,
  RECOVERY_WORKFLOW_PATH,
  TRANSPORT_REGISTRY_PATH,
]
const ALLOWED_CHILD_OVERRIDE_KEYS = new Set([
  'approved_base',
  'implementation_plan_root',
  'required_checks',
  'manual_qa',
  'protected_paths',
  'founder_contact',
  'require_deploy_approval_after_merge',
])
const CHILD_OVERRIDE_STRING_KEYS = new Set([
  'approved_base',
  'implementation_plan_root',
  'founder_contact',
])
const CHILD_OVERRIDE_ARRAY_KEYS = new Set([
  'required_checks',
  'manual_qa',
  'protected_paths',
])
export const RECOVERY_USAGE =
  'Usage: pnpm run bemoat:mission-control:recover-review -- 274 --repo boat1994/bemoat-web-starter --expected-pr 275 --expected-base main --expected-state AWAITING_REVIEW_2 --expected-head <full-sha> --expected-review-cycle 1 --expected-full-review-count 1 --review-type delta --issue-source-comment 5187836238 --pr-source-comment 5187837555 --original-review-comment <id> --correction-result-comment <id> --body-file <file>'

function stateConflict(message) {
  return new Error(`STATE_CONFLICT: ${message}`)
}

function blockedExternal(message) {
  return new Error(`BLOCKED_EXTERNAL: ${message}`)
}

function flattenPages(value) {
  return Array.isArray(value)
    ? value.flat(Infinity).filter((entry) => entry && typeof entry === 'object')
    : []
}

function bodySha256(body) {
  return createHash('sha256').update(String(body ?? ''), 'utf8').digest('hex')
}

function textContent(entry) {
  if (typeof entry === 'string') return entry
  if (!entry || typeof entry !== 'object') return ''
  return typeof entry.content === 'string' ? entry.content : ''
}

function parseGuideFrontmatter(content) {
  if (!content.startsWith('---\n')) return null
  const end = content.indexOf('\n---\n', 4)
  if (end === -1) return null
  const frontmatter = {}
  for (const line of content.slice(4, end).split('\n')) {
    const match = line.match(/^([a-z_]+):\s*(.+)$/)
    if (match) frontmatter[match[1]] = match[2].trim()
  }
  return frontmatter
}

function assertExecutionSource(policy, key, expectedPath, requiredText, label) {
  const source = policy?.[key]
  if (!source || source.path !== expectedPath || !textContent(source).trim()) {
    throw stateConflict(`${label} is missing from the execution policy commit`)
  }
  if (!textContent(source).includes(requiredText)) {
    throw stateConflict(`${label} does not match the reviewed execution implementation`)
  }
}

function parseChildOverride(content) {
  const yamlBlocks = [...content.matchAll(/```yaml\s*([\s\S]*?)```/gi)]
  if (yamlBlocks.length > 1) throw new Error('multiple YAML override blocks')
  const raw = yamlBlocks[0]?.[1] ?? content
  const parsed = yaml.parse(raw, { uniqueKeys: true })
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('override must be a YAML mapping')
  }
  return parsed
}

function assertChildOverride(content) {
  let override
  try {
    override = parseChildOverride(content)
  } catch {
    throw stateConflict('child Mission Control override relaxes shared invariants')
  }
  for (const [key, value] of Object.entries(override)) {
    if (!ALLOWED_CHILD_OVERRIDE_KEYS.has(key)) {
      throw stateConflict('child Mission Control override relaxes shared invariants')
    }
    if (
      CHILD_OVERRIDE_ARRAY_KEYS.has(key) &&
      (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string'))
    ) {
      throw stateConflict('child Mission Control override relaxes shared invariants')
    }
    if (value !== null && typeof value === 'object') {
      if (!CHILD_OVERRIDE_ARRAY_KEYS.has(key) ||
          !Array.isArray(value) ||
          value.some((entry) => typeof entry !== 'string')) {
        throw stateConflict('child Mission Control override relaxes shared invariants')
      }
    } else if (CHILD_OVERRIDE_STRING_KEYS.has(key) && typeof value !== 'string') {
      throw stateConflict('child Mission Control override relaxes shared invariants')
    } else if (key === 'require_deploy_approval_after_merge' && typeof value !== 'boolean') {
      throw stateConflict('child Mission Control override relaxes shared invariants')
    }
  }
}

function assertExecutingCheckout(checkout, executionPolicySha) {
  if (
    !checkout ||
    checkout.clean !== true ||
    !FULL_SHA_RE.test(String(checkout.head_sha ?? '')) ||
    !FULL_SHA_RE.test(String(checkout.base_sha ?? '')) ||
    !Array.isArray(checkout.implementation_paths) ||
    REQUIRED_EXECUTION_PATHS.some((path) => !checkout.implementation_paths.includes(path))
  ) {
    throw stateConflict('executing recovery checkout does not match trusted policy implementation')
  }
  const protectedCheckout =
    ['main', 'refs/heads/main'].includes(checkout.ref) &&
    checkout.head_sha === executionPolicySha &&
    checkout.base_sha === executionPolicySha &&
    checkout.ancestor_verified === true
  const authorizedHotfix =
    checkout.ref === AUTHORIZED_HOTFIX_BRANCH &&
    checkout.base_sha === executionPolicySha &&
    checkout.ancestor_verified === true
  if (!protectedCheckout && !authorizedHotfix) {
    throw stateConflict('executing recovery checkout does not match trusted policy implementation')
  }
}

function assertExecutionPolicyEvidence({ policy, record, state, executionPolicySha, executingCheckout }) {
  if (!policy || typeof policy !== 'object') {
    throw stateConflict('execution policy evidence is missing')
  }
  if (!FULL_SHA_RE.test(executionPolicySha) ||
      policy.source_commit !== executionPolicySha) {
    throw stateConflict('Mission Control policy was not loaded from the execution policy SHA')
  }
  assertExecutingCheckout(executingCheckout, executionPolicySha)
  if (policy.path !== GUIDE_PATH) {
    throw stateConflict('Mission Control policy guide path is not canonical')
  }
  if (policy.sha !== record.policy_source_sha || state.guide_source_sha !== record.policy_source_sha) {
    throw stateConflict('merged Mission Control policy source differs from the recovery record')
  }
  if (policy.version !== CURRENT_MISSION_CONTROL_GUIDE_VERSION || state.guide_version !== CURRENT_MISSION_CONTROL_GUIDE_VERSION) {
    throw stateConflict('current Mission Control guide version is not accepted')
  }
  const frontmatter = parseGuideFrontmatter(textContent(policy))
  if (textContent(policy).trim() && (!frontmatter || (
    frontmatter.policy_id !== 'bemoat-mission-control' ||
    frontmatter.version !== CURRENT_MISSION_CONTROL_GUIDE_VERSION ||
    frontmatter.canonical_repository !== STARTER_REPOSITORY
  ))) {
    throw stateConflict('current Mission Control guide frontmatter is not accepted')
  }
  if (textContent(policy).trim()) {
    const guideViolations = scanGuideContent(GUIDE_PATH, textContent(policy))
    if (guideViolations.length > 0) {
      throw stateConflict(`current Mission Control guide invariants are not accepted: ${guideViolations[0].message}`)
    }
  }
  assertExecutionSource(
    policy,
    'recovery_facade',
    RECOVERY_FACADE_PATH,
    "mission-control/workflows/recover-review.mjs",
    'recovery facade',
  )
  assertExecutionSource(
    policy,
    'recovery_workflow',
    RECOVERY_WORKFLOW_PATH,
    'export async function runReviewRecovery',
    'recovery workflow',
  )
  assertExecutionSource(
    policy,
    'transport_registry',
    TRANSPORT_REGISTRY_PATH,
    'bemoat:mission-control:recover-review',
    'recovery transport registry entry',
  )
  if (policy.child_override != null) {
    if (policy.child_override.path !== CHILD_OVERRIDE_PATH) {
      throw stateConflict('child Mission Control override path is not canonical')
    }
    if (!textContent(policy.child_override).trim()) {
      throw stateConflict('child Mission Control override could not be verified')
    }
    assertChildOverride(textContent(policy.child_override))
  }
}

function requireValue(options, key) {
  if (!options[key]) throw new Error(`--${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)} is required`)
}

export function parseRecoveryArgs(argv = []) {
  const options = {
    issueNumber: null,
    repo: null,
    expectedPr: null,
    expectedBase: null,
    expectedState: null,
    expectedHead: null,
    expectedReviewCycle: null,
    expectedFullReviewCount: null,
    reviewType: null,
    issueSourceComment: null,
    prSourceComment: null,
    originalReviewComment: null,
    correctionResultComment: null,
    bodyFile: null,
  }
  const flags = {
    '--repo': 'repo',
    '--expected-pr': 'expectedPr',
    '--expected-base': 'expectedBase',
    '--expected-state': 'expectedState',
    '--expected-head': 'expectedHead',
    '--expected-review-cycle': 'expectedReviewCycle',
    '--expected-full-review-count': 'expectedFullReviewCount',
    '--review-type': 'reviewType',
    '--issue-source-comment': 'issueSourceComment',
    '--pr-source-comment': 'prSourceComment',
    '--original-review-comment': 'originalReviewComment',
    '--correction-result-comment': 'correctionResultComment',
    '--body-file': 'bodyFile',
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
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
    throw new Error(RECOVERY_USAGE)
  }
  for (const key of Object.keys(options).filter((key) => key !== 'issueNumber')) requireValue(options, key)
  if (options.issueNumber !== '274') throw new Error('STATE_CONFLICT: recovery transport is restricted to Task Issue #274')
  if (options.repo !== STARTER_REPOSITORY) throw new Error(`STATE_CONFLICT: recovery transport is restricted to ${STARTER_REPOSITORY}`)
  if (options.expectedPr !== '275') throw new Error('STATE_CONFLICT: --expected-pr must be 275')
  if (options.expectedBase !== 'main') throw new Error('STATE_CONFLICT: --expected-base must be main')
  if (options.expectedState !== 'AWAITING_REVIEW_2') throw new Error('STATE_CONFLICT: --expected-state must be AWAITING_REVIEW_2')
  if (!FULL_SHA_RE.test(options.expectedHead)) throw new Error('STATE_CONFLICT: --expected-head must be a full 40-character SHA')
  if (options.expectedReviewCycle !== '1') throw new Error('STATE_CONFLICT: --expected-review-cycle must be 1')
  if (options.expectedFullReviewCount !== '1') throw new Error('STATE_CONFLICT: --expected-full-review-count must be 1')
  if (options.reviewType !== 'delta') throw new Error('STATE_CONFLICT: --review-type must be delta')
  if (options.issueSourceComment !== RECOVERY_SOURCE_COMMENT_IDS.taskIssue) {
    throw new Error(`STATE_CONFLICT: --issue-source-comment must be ${RECOVERY_SOURCE_COMMENT_IDS.taskIssue}`)
  }
  if (options.prSourceComment !== RECOVERY_SOURCE_COMMENT_IDS.prConversation) {
    throw new Error(`STATE_CONFLICT: --pr-source-comment must be ${RECOVERY_SOURCE_COMMENT_IDS.prConversation}`)
  }
  for (const key of ['originalReviewComment', 'correctionResultComment']) {
    if (!POSITIVE_ID_RE.test(options[key])) throw new Error(`STATE_CONFLICT: --${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)} must be a comment ID`)
  }
  return options
}

function parseRecoveryBody(body, options) {
  const parsed = parseRoleCommentBody(body)
  const headings = [...body.matchAll(/^##\s+([^\n#]+)\s*$/gm)].map((match) => match[1].trim())
  if (headings.length !== 1 || headings[0] !== 'REVIEW_VERDICT') {
    throw stateConflict('recovery body must contain exactly one REVIEW_VERDICT heading')
  }
  if (parsed.role !== 'REVIEW_VERDICT' || parsed.prNumber !== options.expectedPr || parsed.headSha !== options.expectedHead) {
    throw stateConflict('recovery body must be a canonical REVIEW_VERDICT bound to the expected PR and exact head')
  }
  if (parsed.verdict !== 'ELIGIBLE FOR FOUNDER REVIEW') {
    throw stateConflict('recovery body must preserve the proven ELIGIBLE FOR FOUNDER REVIEW verdict')
  }
  if (!new RegExp(`\\*\\*Task\\s*\\/\\s*Issue:\\*\\*\\s*#${options.issueNumber}\\b`, 'i').test(body)) {
    throw stateConflict('recovery body must bind Task Issue #274')
  }
  for (const field of ['### Task log', 'Timestamp:', 'Phase:', 'Executing role:', '**Findings:**', '**Gates:**', '**Next:**']) {
    if (!body.includes(field)) throw stateConflict(`recovery body is missing required field ${field}`)
  }
  if (!/\*\*Review type:\*\*\s*delta\b/i.test(body)) {
    throw stateConflict('recovery body must identify the bounded delta review')
  }
  if (!/\*\*Resulting counters:\*\*\s*2\s*\/\s*1\b/i.test(body)) {
    throw stateConflict('recovery body must identify resulting counters 2/1')
  }
  const receipt = parseRecoveryReceipt(body)
  if (!receipt.ok) throw stateConflict(receipt.errors.join('; '))
  const recordValidation = validateRecoveryRecord(receipt.record)
  if (!recordValidation.ok) throw stateConflict(recordValidation.errors.join('; '))
  if (receipt.record.exact_head !== options.expectedHead) {
    throw stateConflict('recovery record exact_head differs from --expected-head')
  }
  if (String(receipt.record.lineage?.original_review_comment_id) !== options.originalReviewComment) {
    throw stateConflict('recovery record original review lineage differs from --original-review-comment')
  }
  if (String(receipt.record.lineage?.correction_result_comment_id) !== options.correctionResultComment) {
    throw stateConflict('recovery record correction RESULT lineage differs from --correction-result-comment')
  }
  return { parsed, record: receipt.record }
}

function assertExactChecks(pr, checks, record) {
  if (!analyzeExactHeadCi(pr).exactHeadVerified) {
    throw stateConflict('exact-head CI is not verified')
  }
  const required = [
    { recordName: 'ci', liveNames: new Set(['CI', 'ci']) },
    { recordName: 'starter-ci', liveNames: new Set(['CI (starter strict)', 'starter-ci']) },
  ]
  for (const { recordName, liveNames } of required) {
    const expected = record.ci.find((check) => check.name === recordName)
    const actual = checks.find((check) => liveNames.has(check.name) || liveNames.has(check.context))
    if (!expected || !actual || String(actual.conclusion).toLowerCase() !== 'success' || String(actual.head_sha ?? pr.headRefOid) !== String(pr.headRefOid)) {
      throw stateConflict(`${recordName} is not successful for the exact PR head`)
    }
    if (String(actual.id ?? actual.database_id ?? actual.run_id) !== String(expected.check_run_id)) {
      throw stateConflict(`${recordName} check identity differs from the recovery record`)
    }
  }
}

function assertSourceComment(comment, { _issueNumber, expectedId, expectedIssueUrl }) {
  if (!comment || String(comment.id) !== String(expectedId)) {
    throw stateConflict(`source comment ${expectedId} is unavailable`)
  }
  if (comment.issue_url && comment.issue_url !== expectedIssueUrl) {
    throw stateConflict(`source comment ${expectedId} is not bound to ${expectedIssueUrl}`)
  }
  if (!comment.user?.login || comment.user.login !== 'boat1994' || comment.author_association !== 'OWNER') {
    throw stateConflict(`source comment ${expectedId} is not bound to authenticated owner reviewer boat1994`)
  }
  if (!String(comment.body ?? '').includes('## REVIEW_VERDICT')) {
    throw stateConflict(`source comment ${expectedId} is not verdict-shaped incident evidence`)
  }
  return comment
}

function assertFindingLineage(originalReview, correctionResult, expectedHead) {
  const originalContract = parseCorrectionContract(String(originalReview.body ?? ''))
  if (!originalContract.ok) throw stateConflict(`original Review 1 finding contract is invalid: ${originalContract.errors.join('; ')}`)
  const correctionEvidence = parseCorrectionEvidenceMap(String(correctionResult.body ?? ''))
  if (!correctionEvidence.ok) throw stateConflict(`correction RESULT evidence map is invalid: ${correctionEvidence.errors.join('; ')}`)
  if (originalContract.contract.reviewed_head !== '301ae166052af036ce4d727be59d8d20cc8c02d1') {
    throw stateConflict('original Review 1 contract does not bind the approved prior reviewed head')
  }
  if (correctionEvidence.evidence.correction_base !== originalContract.contract.reviewed_head) {
    throw stateConflict('correction RESULT does not bind the original reviewed head as its correction base')
  }
  if (originalContract.contract.findings.length !== RECOVERY_FINDING_IDS.length) {
    throw stateConflict('original Review 1 contract does not contain exactly seven findings')
  }
  const candidate = {
    findings: originalContract.contract.findings.map((finding) => ({
      id: finding.id,
      canonical_summary: finding.canonical_summary,
    })),
  }
  const identity = validateFindingIdentity(candidate, candidate)
  if (!identity.ok) throw stateConflict(identity.errors.join('; '))
  for (const id of RECOVERY_FINDING_IDS) {
    if (!originalContract.contract.findings.some((finding) => finding.id === id)) {
      throw stateConflict(`finding lineage omits ${id}`)
    }
    if (!Object.hasOwn(correctionEvidence.evidence.finding_results, id)) {
      throw stateConflict(`correction RESULT evidence omits ${id}`)
    }
  }
  if (expectedHead === originalContract.contract.reviewed_head) {
    throw stateConflict('corrected exact head must differ from original Review 1 head')
  }
}

async function verifyRecoveryEvidence({ options, body, deps }) {
  const { record } = parseRecoveryBody(body, options)
  const issue = await deps.readManagedIssue(options.issueNumber, options.repo)
  const pr = await deps.readPullRequest(options.expectedPr, options.repo)
  const state = issue.managedState
  const existingIssueComments = normalizeIssueComments(
    await deps.readIssueComments(options.repo, options.issueNumber),
  )
  const existingReceipt = existingIssueComments
    .map((comment) => ({ comment, parsed: parseRecoveryReceipt(comment.body) }))
    .find((entry) => entry.parsed.ok && entry.parsed.record.transition_identity_sha256 === record.transition_identity_sha256)
  const preStateMatches =
    state.state === options.expectedState &&
    state.review_cycle === 1 &&
    state.full_review_count === 1 &&
    state.approved_base === 'main' &&
    state.active_pr === '#275' &&
    state.current_head === options.expectedHead &&
    state.last_reviewed_head === record.prior_last_reviewed_head &&
    state.latest_result_comment_id === options.correctionResultComment &&
    state.latest_review_verdict_comment_id === options.originalReviewComment
  const postStateMatches =
    state.state === 'ELIGIBLE_FOR_FOUNDER_REVIEW' &&
    state.review_cycle === 2 &&
    state.full_review_count === 1 &&
    state.approved_base === 'main' &&
    state.active_pr === '#275' &&
    state.current_head === options.expectedHead &&
    state.last_reviewed_head === options.expectedHead &&
    state.latest_result_comment_id === options.correctionResultComment &&
    existingReceipt &&
    String(state.latest_review_verdict_comment_id) === String(existingReceipt.comment.id)
  if (String(issue.number) !== options.issueNumber || state.active_task_issue !== '#274') {
    throw stateConflict('live Task Issue is not the directly managed Issue #274')
  }
  if (!preStateMatches && !postStateMatches) {
    throw stateConflict('live managed state does not match the exact 1/1 recovery pre-state')
  }
  if (
    !Array.isArray(state.open_blockers) ||
    (preStateMatches && JSON.stringify(state.open_blockers) !== JSON.stringify([...RECOVERY_FINDING_IDS])) ||
    (postStateMatches && state.open_blockers.length !== 0)
  ) {
    throw stateConflict('live managed state does not preserve the seven immutable open findings')
  }
  if (
    pr.number !== 275 ||
    pr.baseRefName !== 'main' ||
    pr.headRefOid !== options.expectedHead ||
    String(pr.state).toUpperCase() !== 'OPEN' ||
    pr.isDraft
  ) {
    throw stateConflict('live PR #275 does not match the expected open main/exact-head binding')
  }

  const [issueComments, prComments, checks, protectedBase] = await Promise.all([
    deps.readIssueComments(options.repo, options.issueNumber),
    deps.readIssueComments(options.repo, options.expectedPr),
    deps.readExactHeadChecks(options.repo, options.expectedPr, options.expectedHead),
    deps.readProtectedBase(options.repo, 'main'),
  ])
  const normalizedIssueComments = normalizeIssueComments(issueComments)
  const normalizedPrComments = normalizeIssueComments(prComments)
  const sourceIssue = assertSourceComment(
    await deps.readComment(options.repo, options.issueSourceComment),
    {
      _issueNumber: 274,
      expectedId: options.issueSourceComment,
      expectedIssueUrl: `https://api.github.com/repos/${options.repo}/issues/274`,
    },
  )
  const sourcePr = assertSourceComment(
    await deps.readComment(options.repo, options.prSourceComment),
    {
      _issueNumber: 275,
      expectedId: options.prSourceComment,
      expectedIssueUrl: `https://api.github.com/repos/${options.repo}/issues/275`,
    },
  )
  if (sourceIssue.body !== sourcePr.body || sourceIssue.user.login !== sourcePr.user.login) {
    throw stateConflict('incident source comments are not byte-equivalent and same-author evidence')
  }
  const sourceHashes = {
    'issue:274': bodySha256(sourceIssue.body),
    'pull:275': bodySha256(sourcePr.body),
  }
  for (const [location, hash] of Object.entries(sourceHashes)) {
    const recordedHash = record.source_evidence.find((source) => source.location === location)?.body_sha256
    if (recordedHash !== hash) throw stateConflict(`${location} source comment hash differs from the recovery record`)
  }
  if (record.reviewer_identity?.login !== sourceIssue.user.login) {
    throw stateConflict('recovery reviewer identity differs from the authenticated source author')
  }
  if (parseOrdinaryReviewEvidence(sourceIssue.body).canonical) {
    throw stateConflict('incident source comments must remain noncanonical under the ordinary parser')
  }
  for (const findingId of RECOVERY_FINDING_IDS) {
    if (!sourceIssue.body.includes(findingId)) throw stateConflict(`incident source evidence omits ${findingId}`)
  }
  if (!sourceIssue.body.includes(options.expectedHead) || !sourceIssue.body.includes('ELIGIBLE FOR FOUNDER REVIEW')) {
    throw stateConflict('incident source evidence does not bind the proven verdict and exact head')
  }
  const originalReview = await deps.readComment(options.repo, options.originalReviewComment)
  const correctionResult = await deps.readComment(options.repo, options.correctionResultComment)
  assertFindingLineage(originalReview, correctionResult, options.expectedHead)
  const liveExecutionPolicySha = String(protectedBase.sha ?? protectedBase.object?.sha ?? '')
  if (pr.baseRefOid !== record.incident_base_sha) {
    throw stateConflict('incident base SHA differs from the recovery record')
  }
  if (liveExecutionPolicySha !== record.execution_policy_sha) {
    throw stateConflict('execution policy SHA differs from the recovery record')
  }
  if (typeof deps.readExecutingCheckout !== 'function') {
    throw stateConflict('executing recovery checkout identity is unavailable')
  }
  const executingCheckout = await deps.readExecutingCheckout(options.repo, liveExecutionPolicySha)
  const policy = await deps.readPolicySource(options.repo, liveExecutionPolicySha)
  assertExecutionPolicyEvidence({
    policy,
    record,
    state,
    executionPolicySha: liveExecutionPolicySha,
    executingCheckout,
  })
  assertExactChecks(pr, checks, record)

  const knownIncidentIds = new Set([
    options.issueSourceComment,
    options.prSourceComment,
    options.originalReviewComment,
    options.correctionResultComment,
  ])
  for (const comment of [...normalizedIssueComments, ...normalizedPrComments]) {
    const parsed = parseOrdinaryReviewEvidence(comment.body)
    if (parsed.canonical && !knownIncidentIds.has(String(comment.id)) &&
        !parseRecoveryReceipt(comment.body).ok) {
      throw stateConflict(`later canonical role evidence ${comment.id} blocks recovery`)
    }
  }

  return {
    issue,
    pr,
    state,
    issueComments: normalizedIssueComments,
    record,
    alreadyRecovered: Boolean(postStateMatches),
    sourceIssue,
    sourcePr,
  }
}

export async function runReviewRecovery({ options, body, deps }) {
  if (!deps || typeof deps.readManagedIssue !== 'function') {
    throw new Error('recover-review requires live GitHub evidence dependencies')
  }
  const evidence = await verifyRecoveryEvidence({ options, body, deps })
  if (evidence.alreadyRecovered) {
    const receiptComment = evidence.issueComments.find((comment) =>
      parseRecoveryReceipt(comment.body).ok &&
      parseRecoveryReceipt(comment.body).record.transition_identity_sha256 === evidence.record.transition_identity_sha256,
    )
    return {
      outcome: 'NO_OP',
      state: evidence.state,
      comment: receiptComment,
      recoveryComments: receiptComment ? [receiptComment] : [],
    }
  }
  const readIssue = async () => (await deps.readManagedIssue(options.issueNumber, options.repo)).managedState
  const writeState = async (next, expected) => {
    const live = await deps.readManagedIssue(options.issueNumber, options.repo)
    if (
      JSON.stringify(live.managedState) !== JSON.stringify(expected) ||
      live.body !== evidence.issue.body
    ) {
      throw stateConflict('concurrent Task Issue body change detected before recovery projection')
    }
    const nextBody = projectMissionControlStateBlock(live.body, next)
    await deps.writeIssueBody({
      repo: options.repo,
      issueNumber: options.issueNumber,
      expectedBody: live.body,
      nextBody,
      transitionIdentity: next.latest_transition_identity,
    })
    const verified = await deps.readManagedIssue(options.issueNumber, options.repo)
    if (
      verified.managedState.state !== 'ELIGIBLE_FOR_FOUNDER_REVIEW' ||
      verified.managedState.review_cycle !== 2 ||
      verified.managedState.full_review_count !== 1 ||
      verified.managedState.latest_review_verdict_comment_id == null
    ) {
      throw stateConflict('recovery projection failed postcondition verification')
    }
    evidence.issue = verified
    return verified.managedState
  }

  const recoveryComments = () =>
    evidence.issueComments.filter((comment) => parseRecoveryReceipt(comment.body).ok)
  const coordinator = new Coordinator({
    readState: readIssue,
    writeState,
    listComments: async () => normalizeIssueComments(await deps.readIssueComments(options.repo, options.issueNumber))
      .filter((comment) => parseRecoveryReceipt(comment.body).ok),
    postComment: (commentBody) => deps.postComment(options.repo, options.issueNumber, commentBody),
    trustedAuthors: ['boat1994'],
    requireTrustedAuthor: true,
    trustedAssociations: ['OWNER'],
  })
  const parsed = parseRoleCommentBody(body)
  const result = await coordinator.integrateReviewVerdict({
    verdictBody: body,
    verifyPreconditions: async () => {
      const current = await deps.readManagedIssue(options.issueNumber, options.repo)
      if (
        current.managedState.state !== 'AWAITING_REVIEW_2' &&
        current.managedState.state !== 'ELIGIBLE_FOR_FOUNDER_REVIEW'
      ) {
        throw stateConflict('recovery preflight state changed')
      }
    },
    projectState: (prior, comment, identity) => projectReviewVerdictState({
      prior,
      verdict: parsed.verdict,
      reviewType: 'delta',
      reviewedHead: options.expectedHead,
      commentId: comment.id,
      transitionIdentity: JSON.stringify(identity),
      findings: [],
      updatedBy: 'Mission Control Recovery Transport',
    }),
    updatedBy: 'Mission Control Recovery Transport',
  })
  if (result.replayed) {
    return { ...result, outcome: 'NO_OP', recoveryComments: recoveryComments() }
  }
  if (result.outcome === 'RECOVERABLE_ROUTING_DRIFT') {
    return { ...result, recoveryComments: recoveryComments() }
  }
  return { ...result, outcome: 'RECOVERED', recoveryComments: recoveryComments() }
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

function createProductionDeps() {
  const runGh = defaultRunGh
  const readGitOutput = (args) => {
    const result = spawnSync('git', args, {
      cwd: process.cwd(),
      encoding: 'utf8',
    })
    if (result.error || result.status !== 0) {
      throw blockedExternal(result.stderr || result.stdout || result.error?.message || 'Git checkout inspection failed')
    }
    return result.stdout.trim()
  }
  const readExecutingCheckout = async (_repo, trustedSha) => {
    const headSha = readGitOutput(['rev-parse', 'HEAD'])
    const ref = readGitOutput(['symbolic-ref', '--short', 'HEAD'])
    const status = readGitOutput(['status', '--porcelain', '--untracked-files=all'])
    const baseSha = readGitOutput(['merge-base', trustedSha, headSha])
    const implementationPaths = readGitOutput(['ls-tree', '-r', '--name-only', headSha])
      .split('\n')
      .filter(Boolean)
    return {
      ref,
      head_sha: headSha,
      base_sha: baseSha,
      ancestor_verified: baseSha === trustedSha,
      clean: status === '',
      implementation_paths: implementationPaths,
    }
  }
  const readFileAtRef = async (repo, path, ref, { optional = false } = {}) => {
    const raw = runGh([
      'api',
      `repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`,
    ], optional ? { allowNotFound: true } : {})
    if (!raw) return null
    const file = JSON.parse(raw)
    const content = file.encoding === 'base64'
      ? Buffer.from(String(file.content ?? '').replace(/\s/g, ''), 'base64').toString('utf8')
      : String(file.content ?? '')
    return {
      path: file.path ?? path,
      sha: file.sha,
      content,
    }
  }
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
  const readIssueComments = async (repo, issueNumber) => flattenPages(JSON.parse(runGh([
    'api', '--paginate', '--slurp', `repos/${repo}/issues/${issueNumber}/comments?per_page=100`,
  ])))
  const readComment = async (repo, commentId) => JSON.parse(runGh(['api', `repos/${repo}/issues/comments/${commentId}`]))
  const readExactHeadChecks = async (repo, _prNumber, head) => {
    const payload = JSON.parse(runGh([
      'api', `repos/${repo}/commits/${head}/check-runs?per_page=100`,
    ]))
    const checks = Array.isArray(payload) ? payload : payload.check_runs
    return (Array.isArray(checks) ? checks : []).map((check) => ({
    id: check.id,
    name: check.name,
    context: check.name,
    conclusion: check.conclusion,
    head_sha: check.head_sha,
    }))
  }
  const readProtectedBase = async (repo, base) => JSON.parse(runGh(['api', `repos/${repo}/git/ref/heads/${base}`]))
    .object ?? {}
  const readPolicySource = async (repo, ref) => {
    const guide = JSON.parse(runGh([
      'api', `repos/${repo}/contents/${GUIDE_PATH}?ref=${encodeURIComponent(ref)}`,
    ]))
    const guideContent = guide.encoding === 'base64'
      ? Buffer.from(String(guide.content ?? '').replace(/\s/g, ''), 'base64').toString('utf8')
      : String(guide.content ?? '')
    const [recoveryFacade, recoveryWorkflow, transportRegistry, childOverride] = await Promise.all([
      readFileAtRef(repo, RECOVERY_FACADE_PATH, ref),
      readFileAtRef(repo, RECOVERY_WORKFLOW_PATH, ref),
      readFileAtRef(repo, TRANSPORT_REGISTRY_PATH, ref),
      readFileAtRef(repo, CHILD_OVERRIDE_PATH, ref, { optional: true }),
    ])
    const frontmatter = parseGuideFrontmatter(guideContent)
    return {
      path: guide.path ?? GUIDE_PATH,
      sha: guide.sha,
      content: guideContent,
      source_commit: ref,
      version: frontmatter?.version,
      recovery_facade: recoveryFacade,
      recovery_workflow: recoveryWorkflow,
      transport_registry: transportRegistry,
      child_override: childOverride,
      executing_checkout: {
        ref: 'refs/heads/main',
        sha: ref,
        based_on_sha: ref,
      },
    }
  }
  const postComment = async (repo, issueNumber, body) => JSON.parse(runGh([
    'api', '--method', 'POST', `repos/${repo}/issues/${issueNumber}/comments`, '--input', '-',
  ], { input: JSON.stringify({ body }) }))
  const writeIssueBody = async ({ repo, issueNumber, expectedBody, nextBody, transitionIdentity }) =>
    writeIssueBodyWithLease({
      repo,
      issueNumber,
      expectedBody,
      nextBody,
      transitionIdentity,
      holder: 'mission-control-recover-review',
      repoFlag: repo,
      deps: { runGh },
    })
  return {
    readManagedIssue,
    readPullRequest,
    readIssueComments,
    readComment,
    readExactHeadChecks,
    readProtectedBase,
    readExecutingCheckout,
    readPolicySource,
    postComment,
    writeIssueBody,
  }
}

export async function main(argv = process.argv.slice(2), deps = createProductionDeps()) {
  const options = parseRecoveryArgs(argv)
  const body = readFileSync(options.bodyFile, 'utf8')
  const result = await runReviewRecovery({ options, body, deps })
  process.stdout.write(`Mission Control review recovery ${result.outcome}: Task #274 -> ${result.state.state} ${result.state.review_cycle}/${result.state.full_review_count}\n`)
  return result
}
