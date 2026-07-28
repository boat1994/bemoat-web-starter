#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { analyzeReconciliation, findLatestRoleComment } from './mission-control-reconcile.mjs'
import {
  buildCorrectionCapsule,
  derivePlanningArtifactAllowlist,
  parseCorrectionContract,
  validateCorrectionScope,
} from './correction-contract.mjs'
import {
  formatPlanningContractViolations,
  parseTaskIdentityBlock,
  runPlanningContractGuard,
  verifyLiveTaskIdentity,
} from './guard-planning-contract.mjs'
import { parseMissionControlState } from './mission-control-state.mjs'
import { projectComments } from './github-comment-projection.mjs'
import {
  collectKnownSourceThreads,
  extractVerdictPrBaseAndHead,
  parseCompleteGitHubPullUrl,
  resolveCanonicalVerdictPrIdentity,
} from './pr-identity.mjs'

export { parseMissionControlState, parseCompleteGitHubPullUrl }

const moduleDir = dirname(fileURLToPath(import.meta.url))
const branchSafetyScriptPath = resolve(moduleDir, 'check-branch-safety.sh')
const docsToRead = [
  'AGENTS.md',
  'docs/agent-loop/README.md',
  'docs/agent-loop/issue-driven-branch-workflow.md',
  'docs/agent-loop/project-progress-tracking.md',
]

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    encoding: 'utf8',
  })

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error ?? null,
  }
}

function parseAgentIssueArgs(argv = process.argv.slice(2)) {
  const tokens = argv.filter((arg) => arg !== '--')
  let phase = null
  const positional = []

  for (let index = 0; index < tokens.length; index += 1) {
    const argument = tokens[index]
    if (argument === '--phase') {
      const value = tokens[index + 1]
      if (!value || value.startsWith('-')) {
        return { error: '--phase requires a value' }
      }
      if (phase) return { error: '--phase may be provided only once' }
      phase = value
      index += 1
      continue
    }
    if (argument.startsWith('-')) {
      return { error: `unexpected argument: ${argument}` }
    }
    positional.push(argument)
  }

  if (positional.length !== 1 || !/^[1-9]\d*$/.test(positional[0])) {
    return { error: 'missing or invalid issue number' }
  }
  if (phase !== null && phase !== 'correction') {
    return { error: '--phase supports only correction' }
  }

  return { issueNumber: positional[0], phase }
}

function getCurrentBranch(cwd = process.cwd()) {
  return run('git', ['branch', '--show-current'], { cwd }).stdout.trim() || '<detached>'
}

function getStatusShort(cwd = process.cwd()) {
  return run('git', ['status', '--short'], { cwd }).stdout.trimEnd()
}

function hasDevBranch(cwd = process.cwd()) {
  const local = run('git', ['rev-parse', '--verify', '--quiet', 'dev'], { cwd })
  if (local.status === 0) return true

  const remote = run('git', ['rev-parse', '--verify', '--quiet', 'origin/dev'], { cwd })
  return remote.status === 0
}

function getOriginUrl(cwd = process.cwd()) {
  const result = run('git', ['remote', 'get-url', 'origin'], { cwd })
  if (result.status !== 0) return null

  const origin = result.stdout.trim()
  return origin || null
}

function normalizeGithubRepoUrl(originUrl) {
  if (!originUrl) return null

  if (originUrl.startsWith('git@github.com:')) {
    return `https://github.com/${originUrl.slice('git@github.com:'.length).replace(/\.git$/, '')}`
  }

  if (originUrl.startsWith('https://github.com/')) {
    return originUrl.replace(/\.git$/, '')
  }

  return null
}

function buildIssueUrl(cwd, issueNumber) {
  const repoUrl = normalizeGithubRepoUrl(getOriginUrl(cwd))
  if (!repoUrl) return null

  return `${repoUrl}/issues/${issueNumber}`
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
}

function buildSuggestedBranchName(issueNumber, issueTitle) {
  const slug = slugify(issueTitle).slice(0, 48).replace(/-+$/g, '')
  if (!slug) return null

  return `feature/${issueNumber}-${slug}`
}

function fetchIssueMetadata(cwd, issueNumber, env = process.env) {
  const result = run(
    'gh',
    ['issue', 'view', issueNumber, '--json', 'title,url,body,labels'],
    { cwd, env },
  )
  if (result.error) {
    return {
      available: false,
      reason: `GitHub CLI is unavailable: ${result.error.message}`,
    }
  }

  if (result.status !== 0) {
    const failure = result.stderr.trim() || result.stdout.trim() || 'GitHub CLI request failed.'
    return {
      available: false,
      reason: failure,
    }
  }

  try {
    const parsed = JSON.parse(result.stdout)
    return {
      available: Boolean(parsed?.title && parsed?.url),
      title: parsed?.title ?? null,
      url: parsed?.url ?? null,
      body: parsed?.body ?? '',
      labels: Array.isArray(parsed?.labels) ? parsed.labels.map((label) => label.name) : [],
      reason: parsed?.title && parsed?.url ? null : 'GitHub CLI response was missing issue metadata.',
    }
  } catch (error) {
    return {
      available: false,
      reason: `GitHub CLI returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

function stripFencedCodeBlocks(body = '') {
  return body.replace(/```[\s\S]*?```/g, '')
}

function extractBacktickPath(text) {
  const match = text.match(/`([^`]+)`/)
  return match ? match[1].trim() : text.trim()
}

function isMeaningfulIssueRef(value) {
  if (!value) return false
  const trimmed = value.trim()
  if (/^none\b/i.test(trimmed)) return false
  return /(?:^|\s)(?:[\w.-]+\/[\w.-]+)?#?\d+\b/.test(trimmed)
}

function parseIssueFormSection(source, headingPrefix) {
  const pattern = new RegExp(
    `^###\\s+${headingPrefix}[^\\n]*\\n+([^#][\\s\\S]*?)(?=\\n###\\s|\\n##\\s|\\n*$)`,
    'im',
  )
  const match = source.match(pattern)
  if (!match) return null

  const value = match[1]
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !/^[-*_]+$/.test(line))

  return value ?? null
}

function assignDeclarationValue(declarations, key, value, options = {}) {
  if (!value) return
  const trimmed = value.trim()
  if (!trimmed || /^none\b/i.test(trimmed)) return

  if (key === 'mainIssueRef') {
    if (!isMeaningfulIssueRef(trimmed)) return
    declarations.declaresMainIssue = true
    declarations.mainIssueRef = trimmed
    return
  }

  if (key === 'implementationPlanPath') {
    declarations.declaresImplementationPlan = true
    declarations.implementationPlanPath = extractBacktickPath(trimmed)
    return
  }

  if (key === 'relevantPlanSection') {
    declarations.relevantPlanSection = trimmed
    return
  }

  if (key === 'activeTaskIssueRef') {
    declarations.activeTaskIssueRef = trimmed
    return
  }

  if (key === 'activePrRef') {
    declarations.activePrRef = trimmed
    return
  }

  if (key === 'approvedBase') {
    declarations.approvedBase = trimmed
    return
  }

  if (options.currentStageKey) {
    declarations.currentStage[options.currentStageKey] = trimmed
  }
}

/**
 * @param {{
 *   taskSize?: string | null
 *   missionControlMode?: string | null
 *   declaresMainIssue?: boolean
 *   declaresImplementationPlan?: boolean
 * }} declarations
 */
export function deriveWorkflowProfile({
  taskSize,
  missionControlMode,
  declaresMainIssue = false,
  declaresImplementationPlan = false,
} = {}) {
  if (
    missionControlMode === 'required' ||
    (taskSize === 'core' && declaresMainIssue && declaresImplementationPlan)
  ) {
    return {
      name: 'MANAGED',
      nextAction: 'Use the managed-state workflow and its required bounded role transition.',
    }
  }

  if (
    missionControlMode === 'unsure' ||
    ((taskSize === 'small' || taskSize === 'medium' || taskSize === 'core') &&
      missionControlMode !== 'optional' &&
      missionControlMode !== 'required')
  ) {
    return {
      name: 'STANDARD',
      nextAction: 'Use STANDARD safeguards and resolve the Mission Control mode before treating work as FAST.',
    }
  }

  if (missionControlMode !== 'optional') {
    return null
  }

  if (taskSize === 'small') {
    return {
      name: 'FAST',
      nextAction: 'Follow the FAST lifecycle: focused implementation and verification, one commit, PR, compact RESULT, then Founder review.',
    }
  }

  if (taskSize === 'medium' || taskSize === 'core') {
    return {
      name: 'STANDARD',
      nextAction: 'Use the STANDARD workflow with risk-adjusted verification and the existing Founder merge gate.',
    }
  }

  return null
}

export function parseIssueDeclarations(body = '') {
  const source = stripFencedCodeBlocks(body)
  const declarations = {
    mainIssueRef: null,
    implementationPlanPath: null,
    relevantPlanSection: null,
    activeTaskIssueRef: null,
    activePrRef: null,
    approvedBase: null,
    taskSize: null,
    missionControlMode: null,
    nextPermittedAction: null,
    currentStage: {},
    declaresMainIssue: false,
    declaresImplementationPlan: false,
  }

  const mainIssueMatch = source.match(
    /(?:^|\n)\s*(?:Main(?:\s+GitHub)?\s+Issue|Parent\s+Issue)\s*:\s*(.+)/im,
  )
  assignDeclarationValue(declarations, 'mainIssueRef', mainIssueMatch?.[1] ?? null)

  const planMatch = source.match(
    /(?:^|\n)\s*(?:Canonical\s+)?Implementation\s+Plan(?:\s+path)?\s*:\s*(.+)/im,
  )
  assignDeclarationValue(declarations, 'implementationPlanPath', planMatch?.[1] ?? null)

  const relevantSectionMatch = source.match(
    /(?:^|\n)\s*Relevant\s+plan\s+section\s*:\s*(.+)/im,
  )
  assignDeclarationValue(
    declarations,
    'relevantPlanSection',
    relevantSectionMatch?.[1] ?? null,
  )

  const activeTaskMatch = source.match(/(?:^|\n)\s*Active\s+Task\s+Issue\s*:\s*(.+)/im)
  assignDeclarationValue(declarations, 'activeTaskIssueRef', activeTaskMatch?.[1] ?? null)

  const activePrMatch = source.match(/(?:^|\n)\s*Active\s+PR\s*:\s*(.+)/im)
  assignDeclarationValue(declarations, 'activePrRef', activePrMatch?.[1] ?? null)

  const approvedBaseMatch = source.match(/(?:^|\n)\s*Approved\s+base(?:\s+branch)?\s*:\s*(.+)/im)
  assignDeclarationValue(declarations, 'approvedBase', approvedBaseMatch?.[1] ?? null)

  assignDeclarationValue(
    declarations,
    'mainIssueRef',
    parseIssueFormSection(source, 'Main Issue'),
  )
  assignDeclarationValue(
    declarations,
    'implementationPlanPath',
    parseIssueFormSection(source, 'Implementation Plan path'),
  )
  assignDeclarationValue(
    declarations,
    'relevantPlanSection',
    parseIssueFormSection(source, 'Relevant plan section'),
  )
  assignDeclarationValue(
    declarations,
    'activeTaskIssueRef',
    parseIssueFormSection(source, 'Active Task Issue'),
  )
  assignDeclarationValue(declarations, 'activePrRef', parseIssueFormSection(source, 'Active PR'))
  assignDeclarationValue(
    declarations,
    'approvedBase',
    parseIssueFormSection(source, 'Approved base branch'),
  )

  const formTaskSize = parseIssueFormSection(source, 'Task size')
  if (formTaskSize && /^(small|medium|core)$/i.test(formTaskSize)) {
    declarations.taskSize = formTaskSize.toLowerCase()
  }
  const formMissionControlMode = parseIssueFormSection(source, 'Mission Control mode')
  if (formMissionControlMode && /^(required|optional|not required|unsure)$/i.test(formMissionControlMode)) {
    const normalizedMode = formMissionControlMode.toLowerCase()
    declarations.missionControlMode =
      normalizedMode === 'required' ? 'required' : normalizedMode === 'unsure' ? 'unsure' : 'optional'
  }

  const taskSizeMatch = source.match(
    /(?:^|\n)\s*(?:[-*]\s*)?(?:Task\s+size|Tier|This is a)\s*[:\s]*\**\s*(small|medium|core)\b/i,
  )
  if (taskSizeMatch) {
    declarations.taskSize = taskSizeMatch[1].toLowerCase()
  }

  const missionControlModeMatch = source.match(
    /(?:^|\n)\s*(?:[-*]\s*)?Mission\s+Control\s+mode\s*:\s*(required|optional|not required|unsure)\b/im,
  )
  if (missionControlModeMatch) {
    const normalizedMode = missionControlModeMatch[1].toLowerCase()
    declarations.missionControlMode =
      normalizedMode === 'required' ? 'required' : normalizedMode === 'unsure' ? 'unsure' : 'optional'
  }

  const nextActionSection = source.match(
    /##\s*Next\s+Permitted\s+Action\s*\n+([\s\S]*?)(?=\n##\s|\n*$)/i,
  )
  if (nextActionSection) {
    declarations.nextPermittedAction = nextActionSection[1].trim().split('\n')[0]?.trim() || null
  }

  const currentStageSection = source.match(
    /##\s*Current\s+Stage\s*\n+([\s\S]*?)(?=\n##\s|\n*$)/i,
  )
  if (currentStageSection) {
    for (const line of currentStageSection[1].split('\n')) {
      const match = line.match(/^\s*-\s*([^:]+):\s*(.*)$/)
      if (!match) continue
      const key = match[1].trim().toLowerCase().replace(/\s+/g, '_')
      const value = match[2].trim()
      if (value) {
        declarations.currentStage[key] = value
      }
    }
  }

  return declarations
}

export function parseDurableProgress(body = '') {
  const source = stripFencedCodeBlocks(body)
  const durableSection = source.match(
    /##\s*Durable\s+Progress\s*\n+([\s\S]*?)(?=\n##\s|\n*$)/i,
  )
  if (!durableSection) {
    return {
      hasChecklist: false,
      milestones: [],
      firstIncomplete: null,
      malformed: false,
    }
  }

  const milestones = []
  let currentHeading = null

  for (const line of durableSection[1].split('\n')) {
    const headingMatch = line.match(/^###\s+(.+)$/)
    if (headingMatch) {
      currentHeading = headingMatch[1].trim()
      continue
    }

    const checkboxMatch = line.match(/^\s*-\s*\[( |x|X)\]\s+(.+)$/)
    if (!checkboxMatch) continue

    milestones.push({
      slice: currentHeading,
      complete: checkboxMatch[1].toLowerCase() === 'x',
      label: checkboxMatch[2].trim(),
      raw: line.trim(),
    })
  }

  const firstIncomplete = milestones.find((item) => !item.complete) ?? null

  return {
    hasChecklist: milestones.length > 0,
    milestones,
    firstIncomplete,
    malformed: durableSection[1].trim().length > 0 && milestones.length === 0,
  }
}

function stateRequiresPrEvidence(state) {
  return /^(AWAITING_REVIEW_|CORRECTION_REQUIRED_)/.test(state) ||
    ['BLOCKED_FOR_FOUNDER_DECISION', 'ELIGIBLE_FOR_FOUNDER_REVIEW', 'DONE'].includes(state)
}

export function parseIssueReference(reference, defaultRepo = null) {
  if (!reference) return null

  const trimmed = reference.trim()
  const repoMatch = trimmed.match(/^([\w.-]+\/[\w.-]+)#(\d+)$/)
  if (repoMatch) {
    return { repo: repoMatch[1], number: repoMatch[2] }
  }

  const hashMatch = trimmed.match(/#(\d+)/)
  if (hashMatch) {
    return { repo: defaultRepo, number: hashMatch[1] }
  }

  const bareNumber = trimmed.match(/^(\d+)$/)
  if (bareNumber) {
    return { repo: defaultRepo, number: bareNumber[1] }
  }

  return null
}

export function parsePrReference(reference) {
  if (!reference) return null

  const trimmed = reference.trim()
  const repoMatch = trimmed.match(/^([\w.-]+\/[\w.-]+)#(\d+)$/)
  if (repoMatch) {
    return { repo: repoMatch[1], number: repoMatch[2] }
  }

  const hashMatch = trimmed.match(/#(\d+)/)
  if (hashMatch) {
    return { number: hashMatch[1] }
  }

  const bareNumber = trimmed.match(/^(\d+)$/)
  if (bareNumber) {
    return { number: bareNumber[1] }
  }

  return null
}

function getDefaultRepo(cwd) {
  const origin = getOriginUrl(cwd)
  if (!origin) return null

  if (origin.startsWith('git@github.com:')) {
    return origin.slice('git@github.com:'.length).replace(/\.git$/, '')
  }

  if (origin.startsWith('https://github.com/')) {
    return origin.replace('https://github.com/', '').replace(/\.git$/, '')
  }

  return null
}

function fetchIssueByReference(cwd, reference, env = process.env) {
  const defaultRepo = getDefaultRepo(cwd)
  const parsed = parseIssueReference(reference, defaultRepo)
  if (!parsed?.number) {
    return { ok: false, reason: `Could not parse issue reference: ${reference}` }
  }

  const args = ['issue', 'view', parsed.number, '--json', 'title,url,body,state']
  if (parsed.repo) {
    args.push('--repo', parsed.repo)
  }

  const result = run('gh', args, { cwd, env })
  if (result.status !== 0) {
    return {
      ok: false,
      reason: result.stderr.trim() || result.stdout.trim() || 'GitHub issue lookup failed.',
      reference: parsed,
    }
  }

  try {
    const issue = JSON.parse(result.stdout)
    return {
      ok: true,
      reference: parsed,
      issue,
    }
  } catch (error) {
    return {
      ok: false,
      reason: `Invalid issue JSON: ${error instanceof Error ? error.message : String(error)}`,
      reference: parsed,
    }
  }
}

function fetchIssueComments(cwd, issueNumber, env = process.env) {
  if (!issueNumber) {
    return { ok: false, reason: 'Issue number is required for comment lookup.' }
  }

  const args = ['issue', 'view', issueNumber, '--json', 'comments']
  const defaultRepo = getDefaultRepo(cwd)
  if (defaultRepo) {
    args.push('--repo', defaultRepo)
  }

  const result = run('gh', args, { cwd, env })
  if (result.status !== 0) {
    return {
      ok: false,
      reason: result.stderr.trim() || result.stdout.trim() || 'GitHub issue comment lookup failed.',
    }
  }

  try {
    const payload = JSON.parse(result.stdout)
    return {
      ok: true,
      comments: Array.isArray(payload.comments) ? projectComments(payload.comments) : [],
    }
  } catch (error) {
    return {
      ok: false,
      reason: `Invalid issue comments JSON: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

function fetchIssueCommentById(cwd, commentId, env = process.env) {
  const defaultRepo = getDefaultRepo(cwd)
  if (!defaultRepo || !/^[1-9]\d*$/.test(String(commentId))) {
    return { ok: false, reason: 'repository identity or pinned comment ID is unavailable' }
  }
  const result = run('gh', ['api', `repos/${defaultRepo}/issues/comments/${commentId}`], { cwd, env })
  if (result.status !== 0) {
    return { ok: false, reason: result.stderr.trim() || result.stdout.trim() || 'GitHub comment lookup failed' }
  }
  try {
    const comment = JSON.parse(result.stdout)
    return { ok: true, comment }
  } catch (error) {
    return { ok: false, reason: `Invalid issue comment JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
}

function fetchPrByReference(cwd, reference, env = process.env) {
  const parsed = parsePrReference(reference)
  if (!parsed?.number) {
    return { ok: false, reason: `Could not parse PR reference: ${reference}` }
  }

  const args = [
    'pr',
    'view',
    parsed.number,
    '--json',
    'title,url,headRefName,baseRefName,headRefOid,state,isDraft,statusCheckRollup,commits,headRepository,mergeCommit',
  ]
  if (parsed.repo) {
    args.push('--repo', parsed.repo)
  }

  const result = run('gh', args, { cwd, env })
  if (result.status !== 0) {
    return {
      ok: false,
      reason: result.stderr.trim() || result.stdout.trim() || 'GitHub PR lookup failed.',
      reference: parsed,
    }
  }

  try {
    const pr = JSON.parse(result.stdout)
    return {
      ok: true,
      reference: parsed,
      pr,
    }
  } catch (error) {
    return {
      ok: false,
      reason: `Invalid PR JSON: ${error instanceof Error ? error.message : String(error)}`,
      reference: parsed,
    }
  }
}

export function validatePlanPath(cwd, planPath, relevantSection = null) {
  if (!planPath) {
    return { ok: false, reason: 'No Implementation Plan path declared.' }
  }

  const absolutePath = resolve(cwd, planPath)
  if (!existsSync(absolutePath)) {
    return {
      ok: false,
      reason: `Implementation Plan path does not exist: ${planPath}`,
      planPath,
    }
  }

  if (!relevantSection) {
    return { ok: true, planPath, absolutePath }
  }

  const content = readFileSync(absolutePath, 'utf8')
  const escaped = relevantSection.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const sectionRegex = new RegExp(`^#{1,6}\\s+.*${escaped}`, 'im')
  if (!sectionRegex.test(content)) {
    return {
      ok: false,
      reason: `Relevant plan section could not be resolved in ${planPath}: ${relevantSection}`,
      planPath,
      relevantSection,
    }
  }

  return { ok: true, planPath, absolutePath, relevantSection }
}

export function normalizeStatusChecks(statusCheckRollup) {
  if (!statusCheckRollup) return []
  if (Array.isArray(statusCheckRollup)) return statusCheckRollup
  if (Array.isArray(statusCheckRollup.contexts)) return statusCheckRollup.contexts
  return []
}

export function isCheckSuccessful(check) {
  if (!check) return false
  if (check.conclusion === 'SUCCESS') return true
  if (check.state === 'SUCCESS') return true
  return false
}

export function isCheckFailed(check) {
  if (!check) return false
  if (check.conclusion === 'FAILURE' || check.conclusion === 'CANCELLED') return true
  if (check.state === 'FAILURE') return true
  return false
}

function checkReferencesHeadSha(check, headSha) {
  if (!check || !headSha) return false
  const headShort = headSha.slice(0, 7)
  const haystack = [
    check.targetUrl,
    check.detailsUrl,
    check.description,
    check.name,
    check.context,
  ]
    .filter(Boolean)
    .join(' ')

  return haystack.includes(headSha) || haystack.includes(headShort)
}

export function analyzeExactHeadCi(pr) {
  if (!pr) {
    return {
      available: false,
      exactHeadVerified: false,
      headSha: null,
      ciSha: null,
      summary: 'PR evidence unavailable.',
    }
  }

  const headSha = pr.headRefOid ?? null
  const checks = normalizeStatusChecks(pr.statusCheckRollup)
  const successfulChecks = checks.filter(isCheckSuccessful)
  const failedChecks = checks.filter(isCheckFailed)
  const latestSuccessful = successfulChecks[0] ?? null
  const usesProductionRollup = Array.isArray(pr.statusCheckRollup)

  if (!headSha) {
    return {
      available: false,
      exactHeadVerified: false,
      headSha: null,
      ciSha: null,
      summary: 'Current PR head SHA could not be determined.',
    }
  }

  if (checks.length === 0) {
    return {
      available: true,
      exactHeadVerified: false,
      headSha,
      ciSha: null,
      summary: 'No CI checks reported for the active PR.',
      olderShaSuccess: false,
    }
  }

  const headShort = headSha.slice(0, 7)
  const explicitHeadMatch = successfulChecks.some((check) => checkReferencesHeadSha(check, headSha))
  const explicitOlderShaSuccess = successfulChecks.some(
    (check) => !checkReferencesHeadSha(check, headSha),
  )
  const anySuccess = successfulChecks.length > 0

  // gh pr view returns statusCheckRollup as an array scoped to the current PR head.
  const exactHeadSuccess =
    failedChecks.length === 0 &&
    anySuccess &&
    (usesProductionRollup || explicitHeadMatch)

  const ciSha =
    latestSuccessful?.description?.match(/\b[a-f0-9]{7,40}\b/i)?.[0] ?? headSha

  return {
    available: true,
    exactHeadVerified: exactHeadSuccess,
    headSha,
    ciSha,
    summary: exactHeadSuccess
      ? `Exact-head CI verified for ${headShort} (${successfulChecks.length} successful check(s)).`
      : failedChecks.length > 0
        ? 'CI checks failed for the current PR head.'
        : anySuccess
          ? 'Successful CI exists, but exact-head verification is not confirmed for the current PR head SHA.'
          : 'CI has not succeeded for the current PR head.',
    olderShaSuccess: anySuccess && !exactHeadSuccess && explicitOlderShaSuccess,
  }
}

function normalizeSliceName(slice) {
  if (!slice) return ''
  return slice.split('—')[0].trim().toLowerCase()
}

function checkPrerequisiteMilestone(mainProgress, declarations) {
  const incomplete = mainProgress.firstIncomplete
  if (!incomplete?.slice) return null

  const taskSlice = declarations.currentStage.current_slice
  if (!taskSlice) return null

  if (normalizeSliceName(taskSlice) !== normalizeSliceName(incomplete.slice)) {
    return `Main Issue prerequisite milestone remains incomplete in ${incomplete.slice}: ${incomplete.label}`
  }

  return null
}

function detectBlockingFindings(currentStage = {}) {
  const findings = []
  const value = currentStage.blocking_findings?.trim() ?? ''
  if (value && !/^(none|n\/a|-)$/i.test(value)) {
    findings.push(value)
  }

  return findings
}

function detectFounderGate(currentStage = {}, milestones = []) {
  const firstIncomplete = milestones.find((item) => !item.complete)
  const currentTask = currentStage.current_task_or_gate?.trim() ?? ''
  const founderGateOpen = Boolean(
    /founder/i.test(currentTask) || (firstIncomplete && /founder/i.test(firstIncomplete.label)),
  )
  const founderValue = currentStage.founder_gate?.trim() ?? ''
  const explicitOpen =
    founderValue.length > 0 && !/^(none|passed|approved|n\/a|-)$/i.test(founderValue)

  return {
    open: founderGateOpen || explicitOpen,
    value: founderValue || null,
  }
}

export function analyzeProgressTracking({
  cwd = process.cwd(),
  activeIssueBody = '',
  activeIssueNumber = null,
  activeIssueState = null,
  env = process.env,
} = {}) {
  const blockers = []
  const warnings = []
  const declarations = parseIssueDeclarations(activeIssueBody)
  const report = {
    declarations,
    workflowProfile: deriveWorkflowProfile(declarations),
    durableProgress: declarations.declaresMainIssue
      ? { hasChecklist: false, milestones: [], firstIncomplete: null, malformed: false }
      : parseDurableProgress(activeIssueBody),
    mainIssue: null,
    plan: null,
    pr: null,
    exactHeadCi: null,
    firstIncompleteMilestone: null,
    nextPermittedAction: null,
    currentStageSummary: null,
    relevantPlanSection: null,
    reconciliation: null,
  }

  const durableProgress = report.durableProgress
  const taskSize = declarations.taskSize
  const isSmallTask = taskSize === 'small'
  const activeIssueSource = stripFencedCodeBlocks(activeIssueBody)
  const stateAnalysis = parseMissionControlState(activeIssueBody)
  const stateRequired =
    declarations.missionControlMode === 'required' ||
    (taskSize === 'core' && declarations.declaresMainIssue && declarations.declaresImplementationPlan)
  const state = stateAnalysis.state
  let resolvedActiveIssueState = activeIssueState
  const stateNeedsPrEvidence = stateAnalysis.valid && stateRequiresPrEvidence(state.state)

  report.missionControlState = stateAnalysis
  if (!stateAnalysis.present) {
    if (stateRequired) {
      blockers.push('STATE_MIGRATION_REQUIRED: managed Mission Control state is required but absent.')
    } else {
      warnings.push('Mission Control state is absent — normal for standalone tasks not opted into managed state.')
    }
  } else if (!stateAnalysis.valid) {
    blockers.push(`STATE_MIGRATION_REQUIRED: ${stateAnalysis.reason}.`)
  } else if (activeIssueNumber) {
    const defaultRepo = getDefaultRepo(cwd)
    const stateTaskIssue = parseIssueReference(String(state.active_task_issue ?? ''), defaultRepo)
    if (
      !stateTaskIssue ||
      stateTaskIssue.number !== String(activeIssueNumber) ||
      (stateTaskIssue.repo && defaultRepo && stateTaskIssue.repo !== defaultRepo)
    ) {
      blockers.push('STATE_CONFLICT: state active_task_issue does not match the live task Issue.')
    }
  }
  const repairableRecordedLegacyState =
    stateAnalysis.valid &&
    state.state === 'STATE_CONFLICT' &&
    ['post_budget_review_history', 'founder_authorization', 'founder_correction_authorization']
      .some((key) => Object.hasOwn(state, key))
  if (stateAnalysis.valid && ['STATE_CONFLICT', 'STATE_MIGRATION_REQUIRED', 'BLOCKED_EXTERNAL'].includes(state.state) && !repairableRecordedLegacyState) {
    blockers.push(`${state.state}: recorded Mission Control state requires reconciliation before continuing.`)
  }

  if (declarations.declaresMainIssue) {
    const mainIssueResult = fetchIssueByReference(cwd, declarations.mainIssueRef, env)
    if (!mainIssueResult.ok) {
      blockers.push(`Declared Main Issue could not be found: ${declarations.mainIssueRef}`)
    } else {
      report.mainIssue = mainIssueResult.issue
      const mainProgress = parseDurableProgress(mainIssueResult.issue.body ?? '')
      const mainDeclarations = parseIssueDeclarations(mainIssueResult.issue.body ?? '')
      report.durableProgress = mainProgress
      report.firstIncompleteMilestone = mainProgress.firstIncomplete
      if (mainProgress.malformed) {
        blockers.push('Declared Main Issue progress checklist is malformed or unreadable.')
      }
      if (!mainProgress.hasChecklist) {
        warnings.push('Declared Main Issue has no supported Durable Progress checklist yet.')
      }

      const prerequisiteBlocker = checkPrerequisiteMilestone(mainProgress, declarations)
      if (prerequisiteBlocker) {
        blockers.push(prerequisiteBlocker)
      }

      const mainBlockingFindings = detectBlockingFindings(mainDeclarations.currentStage)
      if (mainBlockingFindings.length > 0) {
        blockers.push(
          `Unresolved Critical or Important findings on Main Issue block dependent work: ${mainBlockingFindings.join('; ')}`,
        )
      }
    }
  } else if (
    !isSmallTask &&
    taskSize === 'core' &&
    /##\s*Current\s+Stage/i.test(activeIssueSource)
  ) {
    warnings.push('Core task has a Current Stage section but no Main Issue is declared.')
  } else if (!declarations.declaresMainIssue) {
    warnings.push('No Main Issue declared — expected for valid Small or standalone tasks.')
  }

  if (declarations.declaresImplementationPlan) {
    const relevantSection =
      declarations.relevantPlanSection ||
      declarations.currentStage.relevant_plan_section ||
      null
    const planValidation = validatePlanPath(cwd, declarations.implementationPlanPath, relevantSection)
    report.plan = planValidation
    report.relevantPlanSection = relevantSection
    if (!planValidation.ok) {
      blockers.push(planValidation.reason)
    } else {
      const planContent = readFileSync(planValidation.absolutePath, 'utf8')
      const parseResult = parseTaskIdentityBlock(planContent, declarations.implementationPlanPath)
      const guardViolations = runPlanningContractGuard({
        root: cwd,
        files: [declarations.implementationPlanPath],
      })

      for (const line of formatPlanningContractViolations(guardViolations)) {
        if (line !== 'Planning contract guard passed.') {
          blockers.push(line)
        }
      }

      if (parseResult.contract) {
        if (
          parseResult.contract.task_issue_strategy === 'create_before_execution' &&
          !parseResult.contract.active_task_issue
        ) {
          blockers.push(
            'PLAN005: Create dedicated task issue before launching implementation. Create the GitHub issue, set active_task_issue to its reference, and switch task_issue_strategy to existing_dedicated_issue before continuing.',
          )
        }

        if (
          parseResult.contract.task_issue_strategy === 'existing_dedicated_issue' &&
          parseResult.contract.active_task_issue
        ) {
          const liveResult = verifyLiveTaskIdentity({
            cwd,
            filePath: declarations.implementationPlanPath,
            contract: parseResult.contract,
            env,
            offline: false,
          })

          if (liveResult.degradedOffline) {
            blockers.push(
              'Live task identity verification unavailable — authenticate GitHub CLI before launching implementation on an existing dedicated task issue. Run `gh auth login` and retry preflight.',
            )
          } else {
            for (const line of formatPlanningContractViolations(liveResult.violations)) {
              if (line !== 'Planning contract guard passed.') {
                blockers.push(line)
              }
            }
          }
        }
      }
    }
  } else if (!isSmallTask && taskSize === 'core') {
    warnings.push('Core task has no declared Implementation Plan path.')
  } else if (!declarations.declaresImplementationPlan) {
    warnings.push('No Implementation Plan declared — expected for valid Small or Medium tasks.')
  }

  const declaredActivePrRef = declarations.activePrRef || declarations.currentStage.active_pr || null
  const stateActivePrRef =
    state?.active_pr === null || state?.active_pr === undefined ? null : String(state.active_pr)
  let activePrRef = declaredActivePrRef || stateActivePrRef

  const preDeliveryLag =
    stateAnalysis.valid &&
    state &&
    ['READY', 'IN_PROGRESS'].includes(state.state) &&
    (!state.active_pr || !state.current_head || state.state !== 'AWAITING_REVIEW_1')
  const postReviewLag =
    stateAnalysis.valid && state && /^(AWAITING_REVIEW_|CORRECTION_REQUIRED_)/.test(state.state)

  let latestResult = null
  let latestVerdict = null
  if (stateRequired && activeIssueNumber && (preDeliveryLag || postReviewLag)) {
    const commentResult = fetchIssueComments(cwd, activeIssueNumber, env)
    if (commentResult.ok) {
      latestResult = findLatestRoleComment(commentResult.comments, 'RESULT')
      latestVerdict = findLatestRoleComment(commentResult.comments, 'REVIEW_VERDICT')
      if (latestResult && state?.updated_at) {
        const commentTime = Date.parse(latestResult.comment.createdAt ?? '')
        const stateTime = Date.parse(state.updated_at ?? '')
        if (!Number.isNaN(commentTime) && !Number.isNaN(stateTime) && commentTime < stateTime) {
          latestResult = null
        }
      }
      if (latestVerdict && state?.updated_at) {
        const commentTime = Date.parse(latestVerdict.comment.createdAt ?? '')
        const stateTime = Date.parse(state.updated_at ?? '')
        if (!Number.isNaN(commentTime) && !Number.isNaN(stateTime) && commentTime < stateTime) {
          latestVerdict = null
        }
      }
      if (!activePrRef && latestResult?.parsed?.prNumber) {
        activePrRef = `#${latestResult.parsed.prNumber}`
      }
    }
  }

  if (stateAnalysis.valid && declaredActivePrRef && stateActivePrRef) {
    const declaredPr = parsePrReference(declaredActivePrRef)
    const recordedPr = parsePrReference(stateActivePrRef)
    if (
      !declaredPr ||
      !recordedPr ||
      declaredPr.number !== recordedPr.number ||
      (declaredPr.repo && recordedPr.repo && declaredPr.repo !== recordedPr.repo)
    ) {
      blockers.push('STATE_CONFLICT: state active_pr does not match the declared Active PR.')
    }
  }
  if (stateNeedsPrEvidence && (!state.active_pr || !state.current_head)) {
    blockers.push('STATE_MIGRATION_REQUIRED: review or eligibility state requires active_pr and current_head.')
  }
  if (activePrRef) {
    const prResult = fetchPrByReference(cwd, activePrRef, env)
    if (!prResult.ok) {
      if (stateRequired || stateNeedsPrEvidence) {
        blockers.push(`BLOCKED_EXTERNAL: required Active PR evidence is unavailable: ${activePrRef}`)
      } else {
        blockers.push(`Declared Active PR could not be identified: ${activePrRef}`)
      }
    } else {
      report.pr = prResult.pr
      report.exactHeadCi = analyzeExactHeadCi(prResult.pr)
      if (stateAnalysis.valid) {
        const expectedPr = parsePrReference(String(state.active_pr ?? ''))
        if (expectedPr?.number && expectedPr.number !== String(prResult.reference.number)) {
          blockers.push('STATE_CONFLICT: state active_pr does not match the live PR reference.')
        }
        if (state.approved_base !== prResult.pr.baseRefName) {
          blockers.push('STATE_CONFLICT: state approved_base does not match the live PR base.')
        }
        const terminalHeadIsPreserved =
          prResult.pr.state === 'MERGED' &&
          state.state === 'DONE' &&
          state.last_reviewed_head === prResult.pr.headRefOid
        if (state.current_head && state.current_head !== prResult.pr.headRefOid && !terminalHeadIsPreserved) {
          blockers.push('STATE_CONFLICT: state current_head does not match the live PR head.')
        }
        if (prResult.pr.state === 'MERGED' && !resolvedActiveIssueState && activeIssueNumber) {
          const liveIssue = fetchIssueByReference(cwd, `#${activeIssueNumber}`, env)
          if (liveIssue.ok) resolvedActiveIssueState = liveIssue.issue.state
        }
        const terminalRepairCandidate =
          prResult.pr.state === 'MERGED' &&
          String(resolvedActiveIssueState ?? '').toLowerCase() === 'closed' &&
          state.last_reviewed_head === prResult.pr.headRefOid
        if (prResult.pr.state === 'MERGED' && state.state !== 'DONE' && !terminalRepairCandidate) {
          blockers.push('STATE_CONFLICT: merged PR completion must reconcile to DONE.')
        }
        if (prResult.pr.state === 'CLOSED' && state.state !== 'DONE') {
          blockers.push('STATE_CONFLICT: closed PR conflicts with the recorded non-terminal state.')
        }
        if (state.state === 'DONE' && prResult.pr.state !== 'MERGED') {
          blockers.push('STATE_CONFLICT: DONE requires a merged active PR.')
        }
      }
      if (report.exactHeadCi.olderShaSuccess) {
        warnings.push(
          'Successful CI exists for an older SHA — exact-head CI is required for current evidence.',
        )
      }
      if (
        durableProgress.milestones.some((item) => /exact-head ci passed/i.test(item.label)) &&
        !durableProgress.milestones.find((item) => /exact-head ci passed/i.test(item.label))?.complete &&
        !report.exactHeadCi.exactHeadVerified
      ) {
        warnings.push('Exact-head CI gate is incomplete for the current PR head.')
      }
    }
  }
  if (stateNeedsPrEvidence && !activePrRef) {
    blockers.push('BLOCKED_EXTERNAL: required Active PR evidence is unavailable.')
  }

  const blockingFindings = detectBlockingFindings(declarations.currentStage)
  if (blockingFindings.length > 0) {
    blockers.push(
      `Unresolved Critical or Important findings block dependent work: ${blockingFindings.join('; ')}`,
    )
  }

  const founderGate = detectFounderGate(declarations.currentStage, durableProgress.milestones)
  if (founderGate.open) {
    blockers.push('Founder gate remains open — do not infer approval from technical readiness or green CI.')
  }

  report.nextPermittedAction =
    (stateAnalysis.valid && state?.next_permitted_action ? String(state.next_permitted_action) : null) ||
    declarations.nextPermittedAction ||
    (report.firstIncompleteMilestone
      ? `Complete durable milestone: ${report.firstIncompleteMilestone.label}`
      : null)

  report.currentStageSummary = {
    slice: declarations.currentStage.current_slice ?? null,
    taskOrGate: declarations.currentStage.current_task_or_gate ?? null,
    activeTaskIssue:
      declarations.activeTaskIssueRef || declarations.currentStage.active_task_issue || null,
    activePr: activePrRef,
    relevantPlanSection:
      declarations.relevantPlanSection || declarations.currentStage.relevant_plan_section || null,
    approvedBase: declarations.approvedBase || declarations.currentStage.approved_base || null,
    founderGate: founderGate.value,
  }

  report.reconciliation = null
  if (stateRequired && stateAnalysis.valid && state) {
    const livePr =
      report.pr && report.pr.headRefOid
        ? {
            number: report.pr.reference?.number ?? parsePrReference(activePrRef)?.number,
            headRefOid: report.pr.headRefOid,
            baseRefName: report.pr.baseRefName,
          }
        : null

    const reconciliation = analyzeReconciliation({
      managedState: state,
      livePr,
      exactHeadCi: report.exactHeadCi,
      latestResult,
      latestVerdict,
      activeTaskIssue: activeIssueNumber,
      stateConflictBlockers: blockers.filter((blocker) => blocker.includes('STATE_CONFLICT')),
      requiredEvidenceUnavailable: blockers.some((blocker) => blocker.includes('BLOCKED_EXTERNAL')),
      terminal: report.pr?.state === 'MERGED'
        ? {
            issueClosed: String(resolvedActiveIssueState ?? '').toLowerCase() === 'closed',
            prMerged: true,
            reviewedHeadMatches: state.last_reviewed_head === report.pr.headRefOid,
            mergeCommit: report.pr.mergeCommit?.oid ?? report.pr.mergeCommitOid ?? null,
            exactHeadCi: report.exactHeadCi?.exactHeadVerified === true,
            currentHeadMatches:
              state.current_head === report.pr.headRefOid ||
              (state.state === 'DONE' && state.current_head === (report.pr.mergeCommit?.oid ?? report.pr.mergeCommitOid ?? null)),
          }
        : null,
    })
    report.reconciliation = reconciliation

    if (reconciliation.delivery?.kind === 'STATE_CONFLICT') {
      blockers.push(`STATE_CONFLICT: ${reconciliation.delivery.reason}.`)
    } else if (reconciliation.review?.kind === 'STATE_CONFLICT') {
      blockers.push(`STATE_CONFLICT: ${reconciliation.review.reason}.`)
    } else if (reconciliation.proposal?.type === 'delivery' && preDeliveryLag) {
      warnings.push(
        `Deterministic delivery reconciliation available: set state to ${reconciliation.proposal.fields.state} with PR ${reconciliation.proposal.fields.active_pr}.`,
      )
    } else if (reconciliation.proposal?.type === 'review' && postReviewLag) {
      warnings.push(
        `Deterministic review reconciliation available: set state to ${reconciliation.proposal.fields.state}.`,
      )
    } else if (reconciliation.delivery?.kind === 'INCOMPLETE_DELIVERY' && preDeliveryLag) {
      warnings.push(`Incomplete delivery: ${reconciliation.delivery.reason}.`)
    }
  }

  return { blockers, warnings, report }
}

function runBranchSafety(cwd = process.cwd()) {
  const result = run('bash', [branchSafetyScriptPath], { cwd })
  const combinedOutput = `${result.stdout}${result.stderr}`
    .trim()
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.startsWith('Current branch: '))

  return {
    ok: result.status === 0,
    lines: combinedOutput,
  }
}

function buildNextStep({
  branchSafetyOk,
  dirty,
  branchName,
  issueNumber,
  suggestedBranchName,
  devBranchAvailable,
  progressBlockers,
}) {
  if (dirty) {
    return {
      label: 'Next manual step',
      value: 'Report the dirty working tree blocker and do not edit files.',
    }
  }

  if (progressBlockers.length > 0) {
    return {
      label: 'Next manual step',
      value:
        'Resolve the progress-tracking blockers above before continuing implementation.',
    }
  }

  if (!branchSafetyOk) {
    const branchNameToUse = suggestedBranchName ?? `feature/${issueNumber}-issue`
    const manualStep = "Create a topic branch from the repo's current integration baseline."

    if (branchName === 'main' && !devBranchAvailable) {
      return {
        label: 'Next manual step',
        value: `${manualStep}\nExample when dev is unavailable: git switch -c ${branchNameToUse}`,
      }
    }

    if (branchName === 'main') {
      return {
        label: 'Next manual step',
        value: `${manualStep}\nExample when dev exists: git switch dev && git pull origin dev && git switch -c ${branchNameToUse}`,
      }
    }

    if (branchName === 'dev') {
      return {
        label: 'Next manual step',
        value: `${manualStep}\nExample from the current dev branch: git switch -c ${branchNameToUse}`,
      }
    }

    return {
      label: 'Next manual step',
      value: `${manualStep}\nExample: git switch -c ${branchNameToUse}`,
    }
  }

  return {
    label: 'Next manual step',
    value:
      'Read the listed docs, implement only the scoped issue change on this branch, then run the required validation tier from AGENTS.md.',
  }
}

function formatProgressSection(progressAnalysis) {
  const lines = []
  const { blockers, warnings, report } = progressAnalysis

  lines.push('Progress tracking:')

  if (report.workflowProfile) {
    lines.push(`Workflow profile: ${report.workflowProfile.name}`)
    lines.push(`Profile next action: ${report.workflowProfile.nextAction}`)
  }

  if (report.declarations.declaresMainIssue) {
    lines.push(`Declared Main Issue: ${report.declarations.mainIssueRef}`)
  }
  if (report.mainIssue) {
    lines.push(`Main Issue title: ${report.mainIssue.title}`)
    lines.push(`Main Issue URL: ${report.mainIssue.url}`)
  }
  if (report.declarations.declaresImplementationPlan) {
    lines.push(`Declared Implementation Plan: ${report.declarations.implementationPlanPath}`)
  }
  if (report.plan?.ok) {
    lines.push(`Implementation Plan: found at ${report.plan.planPath}`)
    if (report.relevantPlanSection) {
      lines.push(`Relevant plan section: ${report.relevantPlanSection}`)
    }
  }

  if (report.firstIncompleteMilestone) {
    const slicePrefix = report.firstIncompleteMilestone.slice
      ? `${report.firstIncompleteMilestone.slice} — `
      : ''
    lines.push(
      `First incomplete milestone: ${slicePrefix}${report.firstIncompleteMilestone.label}`,
    )
  } else if (report.durableProgress.hasChecklist) {
    lines.push('First incomplete milestone: none — durable checklist appears complete.')
  }

  if (report.currentStageSummary) {
    const stage = report.currentStageSummary
    if (stage.slice) lines.push(`Current Slice: ${stage.slice}`)
    if (stage.taskOrGate) lines.push(`Current Task or gate: ${stage.taskOrGate}`)
    if (stage.activeTaskIssue) lines.push(`Active Task Issue: ${stage.activeTaskIssue}`)
    if (stage.activePr) lines.push(`Active PR: ${stage.activePr}`)
    if (stage.relevantPlanSection) lines.push(`Relevant plan section: ${stage.relevantPlanSection}`)
    if (stage.approvedBase) lines.push(`Approved base: ${stage.approvedBase}`)
    if (stage.founderGate) lines.push(`Founder gate: ${stage.founderGate}`)
  }

  if (report.pr) {
    lines.push(`PR branch: ${report.pr.headRefName} -> ${report.pr.baseRefName}`)
    lines.push(`Current head SHA: ${report.pr.headRefOid}`)
    if (report.exactHeadCi) {
      lines.push(`Exact-head CI: ${report.exactHeadCi.summary}`)
    }
  }

  if (report.nextPermittedAction) {
    lines.push(`Next permitted action: ${report.nextPermittedAction}`)
  }

  if (blockers.length > 0) {
    lines.push('')
    lines.push('Hard blockers:')
    for (const blocker of blockers) {
      lines.push(`- ${blocker}`)
    }
  }

  if (warnings.length > 0) {
    lines.push('')
    lines.push('Warnings:')
    for (const warning of warnings) {
      lines.push(`- ${warning}`)
    }
  }

  if (
    !report.declarations.declaresMainIssue &&
    !report.declarations.declaresImplementationPlan &&
    blockers.length === 0 &&
    warnings.length === 0
  ) {
    lines.push('No Main Issue or Implementation Plan declared — normal standalone workflow.')
  }

  return lines
}

function parseGhPrListPayload(stdout) {
  let parsed
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return { ok: false, reason: 'malformed GitHub PR list JSON' }
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, reason: 'GitHub PR list evidence is not an array' }
  }
  return { ok: true, openPrs: parsed }
}

function fetchOpenPrsByGhArgs(cwd, env, args) {
  const result = run('gh', args, { cwd, env })
  if (result.status !== 0) {
    return {
      ok: false,
      reason: result.stderr.trim() || result.stdout.trim() || 'gh pr list check failed',
    }
  }
  const parsed = parseGhPrListPayload(result.stdout)
  if (!parsed.ok) return parsed
  return parsed
}

function prClosesIssue(pr, issueNumber) {
  const refs = pr?.closingIssuesReferences
  if (!Array.isArray(refs)) return false
  const target = String(issueNumber)
  return refs.some((ref) => {
    if (!ref || typeof ref !== 'object') return false
    const number = ref.number != null ? String(ref.number) : null
    return number === target
  })
}

function checkOpenPrsForIssueOrBranch(cwd, env, branchName, issueNumber) {
  const ghJsonFields = ['number', 'title', 'headRefName', 'url', 'closingIssuesReferences']
  const seen = new Map()
  const queries = []

  if (branchName) {
    queries.push([
      'pr',
      'list',
      '--state',
      'open',
      '--head',
      branchName,
      '--json',
      ghJsonFields.join(','),
      '--limit',
      '100',
    ])
  }

  if (issueNumber) {
    queries.push([
      'pr',
      'list',
      '--state',
      'open',
      '--search',
      `closes #${issueNumber} repo:${getDefaultRepo(cwd) ?? ''}`.trim(),
      '--json',
      ghJsonFields.join(','),
      '--limit',
      '100',
    ])
  }

  if (queries.length === 0) {
    return { ok: false, reason: 'branch or issue number is required for conflicting-PR evidence' }
  }

  for (const args of queries) {
    const result = fetchOpenPrsByGhArgs(cwd, env, args)
    if (!result.ok) return result
    for (const pr of result.openPrs) {
      if (!pr || pr.number == null) continue
      seen.set(String(pr.number), pr)
    }
  }

  const conflicting = []
  for (const pr of seen.values()) {
    const matchesBranch = branchName && pr.headRefName === branchName
    const matchesIssue = issueNumber && (String(pr.number) === String(issueNumber) || prClosesIssue(pr, issueNumber))
    if (matchesBranch || matchesIssue) conflicting.push(pr)
  }

  return { ok: true, openPrs: conflicting }
}

function verifyPlanningNoPrDurableProofs({
  cwd,
  env,
  issueBody,
  issueNumber,
  contractReviewedHead,
  branchName,
  verdictBase,
}) {
  const errors = []
  const stateAnalysis = parseMissionControlState(issueBody ?? '')
  if (!stateAnalysis.present || !stateAnalysis.valid || !stateAnalysis.state) {
    errors.push('STATE CONFLICT: managed Mission Control state block is missing or invalid for planning_no_pr authorization')
    return { ok: false, errors }
  }

  const state = stateAnalysis.state
  if (state.active_pr !== null) {
    errors.push(
      `STATE CONFLICT: state block active_pr is ${JSON.stringify(state.active_pr)}, but planning_no_pr requires active_pr: null`,
    )
  }

  if (state.last_reviewed_head && state.last_reviewed_head !== contractReviewedHead) {
    errors.push('STATE CONFLICT: state last_reviewed_head does not match the immutable contract reviewed_head')
  }

  if (
    state.active_task_issue &&
    state.active_task_issue !== `#${issueNumber}` &&
    state.active_task_issue !== String(issueNumber)
  ) {
    errors.push('STATE CONFLICT: state active_task_issue does not match the correction issue number')
  }

  const localHead = run('git', ['rev-parse', 'HEAD'], { cwd, env }).stdout.trim()
  if (!localHead) {
    errors.push('STATE CONFLICT: local HEAD is unavailable for planning_no_pr authorization')
  } else if (localHead !== contractReviewedHead) {
    const ancestorCheck = run('git', ['merge-base', '--is-ancestor', contractReviewedHead, 'HEAD'], { cwd, env })
    if (ancestorCheck.status !== 0) {
      errors.push('STATE CONFLICT: local HEAD does not match reviewed_head and reviewed_head is not an ancestor of HEAD')
    }
  }

  const approvedBase = state.approved_base || verdictBase
  if (!approvedBase) {
    errors.push('STATE CONFLICT: approved_base is required for planning_no_pr ancestry proof')
  } else {
    const baseRef = run('git', ['rev-parse', '--verify', approvedBase], { cwd, env })
    if (baseRef.status !== 0) {
      errors.push(`STATE CONFLICT: approved_base ${approvedBase} is not a valid git ref`)
    } else {
      const baseSha = baseRef.stdout.trim()
      const onBaseCheck = run('git', ['merge-base', '--is-ancestor', baseSha, contractReviewedHead], { cwd, env })
      if (onBaseCheck.status !== 0) {
        errors.push('STATE CONFLICT: reviewed_head is not safely descended from approved_base')
      }
    }
  }

  if (branchName && !branchName.includes(String(issueNumber))) {
    errors.push('STATE CONFLICT: current branch does not match the active planning task identity')
  }

  return { ok: errors.length === 0, errors }
}

function getCorrectionDiffFiles(cwd, reviewedHead, env = process.env) {
  const result = run('git', ['diff', '--name-only', reviewedHead, 'HEAD'], { cwd, env })
  if (result.status !== 0) {
    return { ok: false, errors: [result.stderr.trim() || result.stdout.trim() || 'git diff failed'] }
  }
  const files = result.stdout.split('\n').map((line) => line.trim()).filter(Boolean)
  return { ok: true, files }
}

function verifyReviewThreeCorrectionAuthorization({ issueBody, contract, comments }) {
  const parsed = parseMissionControlState(issueBody ?? '')
  const managedRequired = /Mission\s+Control\s+mode:\s*required/i.test(issueBody ?? '')
  if (!parsed.present || !parsed.valid || !parsed.state) {
    if (managedRequired || parsed.present) {
      return { ok: false, errors: ['STATE CONFLICT: managed Mission Control state is missing or invalid for correction authorization'] }
    }
    // Unmanaged correction contracts retain their existing path.
    return { ok: true, errors: [], reviewThree: false }
  }
  const state = parsed.state
  const authorization = state.founder_correction_authorization
  const requiresReviewThreeAuthority = Boolean(authorization) || state.review_cycle === 3 ||
    (state.full_review_count === 1 && state.state === 'IN_PROGRESS')
  if (!requiresReviewThreeAuthority) return { ok: true, errors: [], reviewThree: false }
  if (state.review_cycle !== 3 || state.full_review_count !== 1) {
    return { ok: false, errors: ['STATE CONFLICT: Review 3 correction must preserve counters 3/1'] }
  }
  if (state.state !== 'IN_PROGRESS' || !authorization || authorization.status !== 'consumed') {
    return { ok: false, errors: ['STATE CONFLICT: Review 3 correction requires a consumed Founder correction authorization'] }
  }
  if (authorization.for_review_number !== 3 || authorization.reviewed_head !== contract.reviewed_head ||
      authorization.reviewed_head !== state.last_reviewed_head || authorization.reviewed_head !== state.current_head) {
    return { ok: false, errors: ['STATE CONFLICT: Founder correction authorization does not bind the Review 3 exact head'] }
  }
  const authorizedIds = [...authorization.finding_ids ?? []].sort()
  const contractIds = contract.findings.map((finding) => finding.id).sort()
  if (JSON.stringify(authorizedIds) !== JSON.stringify(contractIds)) {
    return { ok: false, errors: ['STATE CONFLICT: Founder correction authorization finding IDs do not match the immutable contract'] }
  }
  const latestHandoff = findLatestRoleComment(comments, 'HANDOFF')
  const handoff = comments.find((comment) => String(comment.id) === String(authorization.handoff_comment_id))
  if (!handoff || String(latestHandoff?.comment?.id) !== String(authorization.handoff_comment_id) ||
      !/##\s+HANDOFF\s*$/m.test(handoff.body ?? '') || !(handoff.body ?? '').includes(authorization.authorization_id)) {
    return { ok: false, errors: ['STATE CONFLICT: Founder correction authorization is not bound to its exact active HANDOFF'] }
  }
  const binding = authorization.handoff_binding
  if (authorization.schema_version === 2) {
    const contentSha256 = createHash('sha256').update(handoff.body ?? '').digest('hex')
    const expectedFields = {
      authorization_snapshot: {
        authorization_id: authorization.authorization_id,
        authority: authorization.authority,
        status: 'authorized',
        action: authorization.action,
        authorized_at: authorization.authorized_at,
        scope: authorization.scope,
        for_review_number: authorization.for_review_number,
        reviewed_head: authorization.reviewed_head,
        finding_ids: authorization.finding_ids,
      },
      authorization_id: authorization.authorization_id,
      active_pr: state.active_pr,
      exact_head: state.current_head,
      correction_base: authorization.reviewed_head,
      review_number: authorization.for_review_number,
      scope: authorization.scope,
      finding_ids: authorization.finding_ids,
      handoff_comment_id: String(authorization.handoff_comment_id),
    }
    const liveTarget = (handoff.body ?? '').match(/^\*\*Target:\*\*\s*(.+?)\s*$/m)?.[1]?.trim() ?? null
    if (!binding || binding.content_sha256 !== contentSha256 ||
        binding.target !== liveTarget ||
        Object.entries(expectedFields).some(([key, value]) => JSON.stringify(binding[key]) !== JSON.stringify(value))) {
      return { ok: false, errors: ['STATE CONFLICT: immutable Founder correction HANDOFF binding does not match live content'] }
    }
    const { binding_sha256: recordedFingerprint, ...payload } = binding
    const actualFingerprint = createHash('sha256').update(JSON.stringify(payload)).digest('hex')
    if (recordedFingerprint !== actualFingerprint) {
      return { ok: false, errors: ['STATE CONFLICT: immutable Founder correction HANDOFF fingerprint is invalid'] }
    }
    const liveUpdatedAt = handoff.updatedAt ?? handoff.updated_at ?? null
    if (binding.handoff_updated_at !== liveUpdatedAt) {
      return { ok: false, errors: ['STATE CONFLICT: bound Founder correction HANDOFF was edited after dispatch'] }
    }
  }
  return { ok: true, errors: [], reviewThree: true }
}

/**
 * Reconcile the immutable contract reviewed_head against the visible verdict
 * head, then against uniquely identified live PR evidence, before granting
 * correction edit authorization. Fails closed for missing or mismatched PR
 * identity, head, base, state, or unavailable required evidence.
 * GitHub orchestration stays here — the correction-contract module remains pure.
 */
function reconcileCorrectionPrEvidence({
  cwd,
  env,
  verdictBody,
  contractReviewedHead,
  mode = 'implementation_pr',
  branchName = null,
  issueNumber = null,
  contract = null,
  issueBody = null,
}) {
  const defaultRepo = getDefaultRepo(cwd)
  const knownSourceThreads = mode === 'planning_no_pr' ? collectKnownSourceThreads(contract) : null
  const identityResult = resolveCanonicalVerdictPrIdentity(
    verdictBody,
    defaultRepo,
    mode,
    knownSourceThreads,
    contract,
  )
  if (!identityResult.ok) {
    return { ok: false, errors: identityResult.errors }
  }

  const { base: verdictBase, head: verdictHead } = extractVerdictPrBaseAndHead(verdictBody)
  if (!verdictHead) {
    return {
      ok: false,
      errors: ['REVIEW_VERDICT is missing a `PR / base / head` line with an exact head SHA'],
    }
  }
  if (verdictHead !== contractReviewedHead) {
    return {
      ok: false,
      errors: ['REVIEW_VERDICT head contradicts the immutable contract reviewed_head'],
    }
  }

  if (mode === 'planning_no_pr') {
    const checkResult = checkOpenPrsForIssueOrBranch(cwd, env, branchName, issueNumber)
    if (!checkResult.ok) {
      return { ok: false, errors: [`live PR evidence is unavailable: ${checkResult.reason}`] }
    }
    if (checkResult.openPrs?.length > 0) {
      const pr = checkResult.openPrs[0]
      return {
        ok: false,
        errors: [
          `STATE CONFLICT: open PR #${pr.number} exists on GitHub for this planning issue under no-PR contract`,
        ],
      }
    }
    return { ok: true, errors: [], prNumber: null, prIdentity: null, livePr: null }
  }

  const { number: prNumber, key: prIdentity } = identityResult.identity

  const parsedManagedState = issueBody ? parseMissionControlState(issueBody) : null
  const managedState = parsedManagedState?.valid ? parsedManagedState.state : null
  if (managedState?.active_pr != null && prNumber != null) {
    const statePr = parsePrReference(String(managedState.active_pr))
    if (statePr?.number && String(statePr.number) !== String(prNumber)) {
      return {
        ok: false,
        errors: ['STATE CONFLICT: canonical REVIEW_VERDICT PR does not match managed-state active_pr'],
      }
    }
  }
  if (
    managedState?.last_reviewed_head &&
    contractReviewedHead &&
    String(managedState.last_reviewed_head) !== String(contractReviewedHead)
  ) {
    return {
      ok: false,
      errors: ['STATE CONFLICT: canonical REVIEW_VERDICT reviewed_head does not match managed-state last_reviewed_head'],
    }
  }

  const prResult = fetchPrByReference(cwd, `${defaultRepo}#${prNumber}`, env)
  if (!prResult.ok) {
    return { ok: false, errors: [`live PR evidence is unavailable: ${prResult.reason}`] }
  }

  const livePr = prResult.pr
  if (!livePr?.headRefOid || !livePr?.baseRefName || !livePr?.state) {
    return {
      ok: false,
      errors: ['live PR evidence is missing required identity, head, base, or state fields'],
    }
  }

  const errors = []
  // Require authoritative, parseable repository-qualified live identity from the
  // fetched PR response. Do not infer identity solely from the requested PR number,
  // and do not skip reconciliation when url is absent or unparseable.
  if (livePr.url == null || String(livePr.url).length === 0) {
    errors.push('live PR evidence is missing required repository-qualified identity URL')
  } else {
    const liveUrlRaw = String(livePr.url)
    const parsedLive = parseCompleteGitHubPullUrl(liveUrlRaw)
    if (!parsedLive.ok) {
      errors.push(parsedLive.reason || 'live PR identity URL is present but unparseable')
    } else {
      const liveKey = parsedLive.identity.key
      if (liveKey !== prIdentity) {
        errors.push(`live PR identity ${liveKey} does not match REVIEW_VERDICT PR identity ${prIdentity}`)
      }

      // Alternate identity-like fields are never fallbacks; a conflict is ambiguous.
      if (Object.prototype.hasOwnProperty.call(livePr, 'number') && livePr.number != null) {
        const alternateNumber = String(livePr.number)
        if (alternateNumber !== parsedLive.identity.number) {
          errors.push(
            `live PR identity is ambiguous: url pull ${parsedLive.identity.number} conflicts with number field ${alternateNumber}`,
          )
        }
      }
      if (Object.prototype.hasOwnProperty.call(livePr, 'html_url') && livePr.html_url != null) {
        const alternateHtml = String(livePr.html_url)
        const parsedHtml = parseCompleteGitHubPullUrl(alternateHtml)
        if (!parsedHtml.ok || parsedHtml.identity.key !== liveKey) {
          errors.push('live PR identity is ambiguous: html_url conflicts with url')
        }
      }
    }
  }
  if (livePr.headRefOid !== contractReviewedHead) {
    errors.push('live PR head does not match the immutable contract reviewed_head')
  }
  if (verdictBase && livePr.baseRefName !== verdictBase) {
    errors.push('live PR base does not match the REVIEW_VERDICT approved base')
  }
  if (livePr.state !== 'OPEN') {
    errors.push(`live PR state is ${livePr.state}, not OPEN`)
  }

  return { ok: errors.length === 0, errors, prNumber, prIdentity, livePr }
}

function pinnedCommentId(comment) {
  const match = String(comment?.url ?? comment?.html_url ?? '').match(/#issuecomment-(\d+)$/)
  return match?.[1] ?? null
}

function findExactlyOnePinnedComment(comments, commentId) {
  const matches = comments.filter((comment) => pinnedCommentId(comment) === String(commentId))
  return matches.length === 1 ? matches[0] : null
}

function sourceField(body, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = String(body ?? '').match(new RegExp('^-\\s+\\*\\*' + escaped + ':\\*\\*\\s*`?(.+?)`?\\s*$', 'm'))
  return match?.[1]?.trim().replace(/^`|`$/g, '') ?? null
}

function matchesPinnedList(value, expected) {
  const ids = String(value ?? '').match(/[A-Za-z0-9][A-Za-z0-9_-]*/g) ?? []
  return JSON.stringify(ids) === JSON.stringify(expected)
}

function validateCurrentAuthorityState(state, issueNumber, defaultRepo) {
  const authority = state?.founder_migration_authority
  if (!authority || typeof authority !== 'object' || Array.isArray(authority)) return null
  const errors = []
  const latestReview = state.post_budget_reviews?.at(-1)
  if (authority.schema_version !== 3 || authority.status !== 'approved' || authority.authority !== 'Founder' || authority.scope !== 'correction') {
    errors.push('current authority record must be an approved Founder schema-version 3 correction authority')
  }
  if (authority.canonical_repository !== defaultRepo || authority.issue !== `#${issueNumber}` ||
      !/^#[1-9]\d*$/.test(String(authority.pr ?? ''))) {
    errors.push('current authority record does not bind the current repository, issue, and PR')
  }
  if (!/^[0-9a-f]{64}$/.test(String(authority.content_sha256 ?? '')) ||
      !/^[1-9]\d*$/.test(String(authority.comment_id ?? '')) ||
      !/^[1-9]\d*$/.test(String(authority.review_7_verdict_comment_id ?? '')) ||
      !/^[1-9]\d*$/.test(String(authority.historical_review_3_source_comment_id ?? '')) ||
      !/^[1-9]\d*$/.test(String(authority.historical_handoff_comment_id ?? ''))) {
    errors.push('current authority record is missing a pinned source ID or content hash')
  }
  if (!latestReview || latestReview.review_number !== 7 || latestReview.verdict_comment_id !== authority.review_7_verdict_comment_id ||
      latestReview.reviewed_head !== authority.correction_base || state.current_head !== authority.correction_base ||
      state.last_reviewed_head !== authority.correction_base) {
    errors.push('current authority record does not bind the latest post-budget Review 7 head')
  }
  if (!Array.isArray(authority.finding_ids) || authority.finding_ids.length === 0 ||
      JSON.stringify(authority.finding_ids) !== JSON.stringify(authority.historical_finding_ids)) {
    errors.push('current authority record does not preserve the historical immutable finding set')
  }
  return { authority, ok: errors.length === 0, errors }
}

function validatePinnedFounderDecision({ authority, source, issueNumber, defaultRepo }) {
  const errors = []
  const comment = source.comment
  const expectedUrl = `https://github.com/${defaultRepo}/issues/${issueNumber}#issuecomment-${authority.comment_id}`
  if (String(comment.id) !== String(authority.comment_id) || comment.html_url !== expectedUrl ||
      comment.user?.login !== authority.author_login || comment.author_association !== authority.author_association ||
      comment.created_at !== authority.created_at || comment.updated_at !== authority.updated_at) {
    errors.push('pinned Founder decision source metadata does not match state')
  }
  if (createHash('sha256').update(comment.body ?? '').digest('hex') !== authority.content_sha256) {
    errors.push('pinned Founder decision content hash does not match state')
  }
  const fields = [
    ['Canonical repository', authority.canonical_repository], ['Repository ID', authority.repository_id],
    ['Issue', authority.issue], ['PR', authority.pr], ['Specification RESULT comment', authority.specification_result_comment_id],
    ['Review 7 verdict comment', authority.review_7_verdict_comment_id], ['Correction base', authority.correction_base],
    ['Historical Review 3 authority source comment', authority.historical_review_3_source_comment_id],
    ['Historical HANDOFF comment', authority.historical_handoff_comment_id], ['Historical authorization ID', authority.historical_authorization_id],
    ['Historical reviewed head', authority.historical_reviewed_head], ['Historical action', authority.historical_action],
    ['Historical authorization timestamp', authority.historical_authorized_at], ['Approved action', authority.approved_action],
  ]
  for (const [label, expected] of fields) {
    const sourceValue = sourceField(comment.body, label)
    if (label === 'Approved action') {
      if (!sourceValue?.includes(authority.finding_ids[0]) || !sourceValue.includes(authority.correction_base)) {
        errors.push('pinned Founder decision Approved action does not bind the finding and correction base')
      }
    } else if (sourceValue !== String(expected)) {
      errors.push(`pinned Founder decision ${label} does not match state`)
    }
  }
  if (!matchesPinnedList(sourceField(comment.body, 'Finding IDs'), authority.finding_ids) ||
      !matchesPinnedList(sourceField(comment.body, 'Historical finding IDs'), authority.historical_finding_ids)) {
    errors.push('pinned Founder decision finding IDs do not match state')
  }
  return { ok: errors.length === 0, errors }
}

function validateHistoricalAuthority({ state, authority, comments, historicalHandoff, issueNumber, defaultRepo }) {
  const errors = []
  const historical = state.founder_correction_authorization
  const reviewThree = findExactlyOnePinnedComment(comments, authority.historical_review_3_source_comment_id)
  const expectedHandoffUrl = `https://github.com/${defaultRepo}/issues/${issueNumber}#issuecomment-${authority.historical_handoff_comment_id}`
  if (!historical || historical.authorization_id !== authority.historical_authorization_id ||
      historical.reviewed_head !== authority.historical_reviewed_head || historical.action !== authority.historical_action ||
      historical.authorized_at !== authority.historical_authorized_at || historical.handoff_comment_id !== authority.historical_handoff_comment_id ||
      JSON.stringify(historical.finding_ids) !== JSON.stringify(authority.historical_finding_ids)) {
    errors.push('historical Review 3 authorization does not match the current pinned authority record')
  }
  if (!reviewThree || !String(reviewThree.url ?? '').endsWith(`#issuecomment-${authority.historical_review_3_source_comment_id}`)) {
    errors.push('pinned historical Review 3 source is missing or inconsistent')
  }
  const handoff = historicalHandoff.comment
  if (String(handoff.id) !== String(authority.historical_handoff_comment_id) || handoff.html_url !== expectedHandoffUrl ||
      handoff.user?.login !== 'boat1994' || handoff.author_association !== 'OWNER' ||
      !String(handoff.body ?? '').match(/^##\s+HANDOFF\s*$/m) || !String(handoff.body ?? '').includes(authority.historical_authorization_id) ||
      !String(handoff.body ?? '').includes(authority.historical_reviewed_head) || !String(handoff.body ?? '').includes(String(authority.pr))) {
    errors.push('pinned historical HANDOFF source is missing or inconsistent')
  }
  return { ok: errors.length === 0, errors }
}

function reconcilePinnedCurrentPr({ cwd, env, authority, state, defaultRepo }) {
  const prNumber = String(authority.pr).slice(1)
  const result = fetchPrByReference(cwd, `${defaultRepo}#${prNumber}`, env)
  if (!result.ok) return { ok: false, errors: [`live PR evidence is unavailable: ${result.reason}`] }
  const pr = result.pr
  const parsedUrl = parseCompleteGitHubPullUrl(String(pr?.url ?? ''))
  const errors = []
  if (!parsedUrl.ok || parsedUrl.identity.key !== `${defaultRepo.toLowerCase()}#${prNumber}`) errors.push('live PR identity does not match current pinned authority')
  if (pr?.headRefOid !== authority.correction_base || pr?.baseRefName !== state.approved_base || pr?.state !== 'OPEN' || pr?.isDraft !== true) {
    errors.push('live PR head, base, open state, or draft state does not match current pinned authority')
  }
  const ci = analyzeExactHeadCi(pr)
  if (!ci.exactHeadVerified) errors.push(`current authority requires successful exact-head CI (${ci.summary})`)
  return { ok: errors.length === 0, errors, pr }
}

function recoverCurrentAuthority({ cwd, env, issueNumber, issueBody, comments }) {
  const parsed = parseMissionControlState(issueBody ?? '')
  const defaultRepo = getDefaultRepo(cwd)
  if (!parsed.valid || !parsed.state || !defaultRepo) return null
  const stateCheck = validateCurrentAuthorityState(parsed.state, issueNumber, defaultRepo)
  if (!stateCheck) return null
  if (!stateCheck.ok) return { ok: false, errors: stateCheck.errors }
  const { authority } = stateCheck
  const founderSource = fetchIssueCommentById(cwd, authority.comment_id, env)
  const handoffSource = fetchIssueCommentById(cwd, authority.historical_handoff_comment_id, env)
  if (!founderSource.ok || !handoffSource.ok) {
    return { ok: false, errors: ['pinned authority source metadata is unavailable'] }
  }
  const founderCheck = validatePinnedFounderDecision({ authority, source: founderSource, issueNumber, defaultRepo })
  const historicalCheck = validateHistoricalAuthority({ state: parsed.state, authority, comments, historicalHandoff: handoffSource, issueNumber, defaultRepo })
  const prCheck = reconcilePinnedCurrentPr({ cwd, env, authority, state: parsed.state, defaultRepo })
  const errors = [...founderCheck.errors, ...historicalCheck.errors, ...prCheck.errors]
  if (errors.length > 0) return { ok: false, errors }
  const findingId = authority.finding_ids[0]
  return {
    ok: true,
    contract: {
      mode: 'implementation_pr', reviewed_head: authority.correction_base,
      findings: [{ id: findingId, canonical_summary: `Pinned current authority finding ${findingId}`,
        source_thread: `https://github.com/${defaultRepo}/issues/${issueNumber}#issuecomment-${authority.review_7_verdict_comment_id}`,
        required_evidence: ['Pinned S8 Founder decision and historical Review 3/HANDOFF proofs'], expected_areas: [], prohibited_areas: [] }],
    },
    livePr: prCheck.pr,
  }
}

function runCorrectionPhasePreflight({
  cwd,
  env,
  issueNumber,
  branchName,
  statusShort,
  dirty,
  branchSafety,
  issueMetadata,
  fallbackIssueUrl,
}) {
  const output = [
    'Bemoat correction-mode preflight',
    `Issue number: ${issueNumber}`,
    `Current branch: ${branchName}`,
    `Working tree: ${dirty ? 'not clean' : 'clean'}`,
  ]

  if (!branchSafety.ok) {
    output.push('Stop: branch safety failed before correction edit authorization.')
    output.push(...(branchSafety.lines.length > 0 ? branchSafety.lines : ['<no branch safety output>']))
    return { ok: false, exitCode: 1, usageError: false, output, issueNumber, branchName, statusShort, issueMetadata }
  }

  if (dirty) {
    output.push('Stop: dirty working tree blocks correction edit authorization.')
    return { ok: false, exitCode: 1, usageError: false, output, issueNumber, branchName, statusShort, issueMetadata }
  }

  const commentResult = fetchIssueComments(cwd, issueNumber, env)
  if (!commentResult.ok) {
    output.push(`Stop: cannot reconstruct canonical findings (${commentResult.reason}).`)
    return { ok: false, exitCode: 1, usageError: false, output, issueNumber, branchName, statusShort, issueMetadata }
  }

  const currentAuthority = recoverCurrentAuthority({
    cwd,
    env,
    issueNumber,
    issueBody: issueMetadata.body ?? '',
    comments: commentResult.comments,
  })
  if (currentAuthority) {
    if (!currentAuthority.ok) {
      output.push('Stop: pinned current authority sources failed before correction edit authorization.')
      for (const error of currentAuthority.errors) output.push(`- ${error}`)
      return { ok: false, exitCode: 1, usageError: false, output, issueNumber, branchName, statusShort, issueMetadata }
    }
    const capsule = buildCorrectionCapsule(currentAuthority.contract, {
      issueNumber,
      prUrl: currentAuthority.livePr.url,
      mode: 'implementation_pr',
    })
    return {
      ok: true,
      exitCode: 0,
      usageError: false,
      output: [
        'Bemoat correction-mode preflight',
        `Issue: ${issueMetadata.url ?? fallbackIssueUrl ?? `#${issueNumber}`}`,
        ...capsule.lines,
        'Edit authorization: granted for the immutable finding set only.',
      ],
      issueNumber,
      branchName,
      statusShort,
      issueMetadata,
      correctionContract: currentAuthority.contract,
    }
  }

  const latestVerdict = findLatestRoleComment(commentResult.comments, 'REVIEW_VERDICT')
  if (!latestVerdict?.comment?.body) {
    output.push('Stop: missing correction-eligible REVIEW_VERDICT with immutable findings.')
    return { ok: false, exitCode: 1, usageError: false, output, issueNumber, branchName, statusShort, issueMetadata }
  }

  if (latestVerdict.parsed?.verdict !== 'CORRECTION REQUIRED') {
    output.push(
      `Stop: latest REVIEW_VERDICT is ${latestVerdict.parsed?.verdict ?? 'unknown'}, not CORRECTION REQUIRED.`,
    )
    return { ok: false, exitCode: 1, usageError: false, output, issueNumber, branchName, statusShort, issueMetadata }
  }

  const parsedContract = parseCorrectionContract(latestVerdict.comment.body)
  if (!parsedContract.ok) {
    output.push('Stop: canonical finding evidence is missing, malformed, or inconsistent.')
    for (const error of parsedContract.errors) output.push(`- ${error}`)
    return { ok: false, exitCode: 1, usageError: false, output, issueNumber, branchName, statusShort, issueMetadata }
  }

  const reviewThreeAuthorization = verifyReviewThreeCorrectionAuthorization({
    issueBody: issueMetadata.body ?? '', contract: parsedContract.contract, comments: commentResult.comments,
  })
  if (!reviewThreeAuthorization.ok) {
    output.push('Stop: Review 3 Founder correction authorization failed before correction edit authorization.')
    for (const error of reviewThreeAuthorization.errors) output.push(`- ${error}`)
    return { ok: false, exitCode: 1, usageError: false, output, issueNumber, branchName, statusShort, issueMetadata }
  }

  if (parsedContract.contract.mode === 'planning_no_pr') {
    const { base: verdictBase } = extractVerdictPrBaseAndHead(latestVerdict.comment.body)
    const durableProofs = verifyPlanningNoPrDurableProofs({
      cwd,
      env,
      issueBody: issueMetadata.body ?? '',
      issueNumber,
      contractReviewedHead: parsedContract.contract.reviewed_head,
      branchName,
      verdictBase,
    })
    if (!durableProofs.ok) {
      output.push('Stop: planning_no_pr durable authorization proofs failed before correction edit authorization.')
      for (const error of durableProofs.errors) output.push(`- ${error}`)
      return { ok: false, exitCode: 1, usageError: false, output, issueNumber, branchName, statusShort, issueMetadata }
    }
  }

  const reconciliation = reconcileCorrectionPrEvidence({
    cwd,
    env,
    verdictBody: latestVerdict.comment.body,
    contractReviewedHead: parsedContract.contract.reviewed_head,
    mode: parsedContract.contract.mode,
    branchName,
    issueNumber,
    contract: parsedContract.contract,
    issueBody: issueMetadata.body ?? '',
  })
  if (!reconciliation.ok) {
    output.push('Stop: live PR evidence does not reconcile with the immutable contract head before correction edit authorization.')
    for (const error of reconciliation.errors) output.push(`- ${error}`)
    return { ok: false, exitCode: 1, usageError: false, output, issueNumber, branchName, statusShort, issueMetadata }
  }
  if (reviewThreeAuthorization.reviewThree) {
    const ci = analyzeExactHeadCi(reconciliation.livePr)
    if (!ci.exactHeadVerified) {
      output.push(`Stop: Review 3 correction requires successful exact-head CI (${ci.summary}).`)
      return { ok: false, exitCode: 1, usageError: false, output, issueNumber, branchName, statusShort, issueMetadata }
    }
  }

  const diffResult = getCorrectionDiffFiles(cwd, parsedContract.contract.reviewed_head, env)
  if (diffResult.ok && diffResult.files.length > 0) {
    const scopeCheck = validateCorrectionScope(parsedContract.contract, diffResult.files, { mode: parsedContract.contract.mode })
    if (!scopeCheck.ok) {
      output.push('Stop: correction diff touches prohibited scope.')
      for (const error of scopeCheck.errors) output.push(`- ${error}`)
      return { ok: false, exitCode: 1, usageError: false, output, issueNumber, branchName, statusShort, issueMetadata }
    }
  }

  const prUrl =
    reconciliation.livePr?.url ||
    (reconciliation.prIdentity
      ? `https://github.com/${reconciliation.prIdentity.replace('#', '/pull/')}`
      : reconciliation.prNumber
        ? `PR #${reconciliation.prNumber}`
        : null)
  const issueRef =
    issueMetadata.available && issueMetadata.url
      ? issueMetadata.url
      : fallbackIssueUrl || `#${issueNumber}`

  const capsule = buildCorrectionCapsule(parsedContract.contract, {
    issueNumber,
    prUrl: prUrl || (parsedContract.contract.mode === 'planning_no_pr' ? 'none' : '(not provided)'),
    mode: parsedContract.contract.mode,
  })

  return {
    ok: true,
    exitCode: 0,
    usageError: false,
    output: [
      'Bemoat correction-mode preflight',
      `Issue: ${issueRef}`,
      ...capsule.lines,
      parsedContract.contract.mode === 'planning_no_pr'
        ? `Edit authorization: granted for the immutable finding set only across canonical planning artifacts (${derivePlanningArtifactAllowlist(parsedContract.contract).join('; ') || 'expected_areas required'}).`
        : 'Edit authorization: granted for the immutable finding set only.',
    ],
    issueNumber,
    branchName,
    statusShort,
    issueMetadata,
    correctionContract: parsedContract.contract,
  }
}

export function runAgentIssuePreflight({
  cwd = process.cwd(),
  argv = process.argv.slice(2),
  env = process.env,
} = {}) {
  const parsedArgs = parseAgentIssueArgs(argv)
  if (parsedArgs.error) {
    return {
      ok: false,
      exitCode: 1,
      usageError: true,
      output: [
        `Issue preflight failed: ${parsedArgs.error}.`,
        'Usage: pnpm run bemoat:agent:issue -- <issue-number> [--phase correction]',
      ],
    }
  }

  const { issueNumber, phase } = parsedArgs

  const branchName = getCurrentBranch(cwd)
  const statusShort = getStatusShort(cwd)
  const dirty = statusShort.trim().length > 0
  const issueMetadata = fetchIssueMetadata(cwd, issueNumber, env)
  const fallbackIssueUrl = buildIssueUrl(cwd, issueNumber)
  const suggestedBranchName =
    issueMetadata.available && issueMetadata.title
      ? buildSuggestedBranchName(issueNumber, issueMetadata.title)
      : null
  const branchSafety = runBranchSafety(cwd)
  const devBranchAvailable = hasDevBranch(cwd)

  if (phase === 'correction') {
    return runCorrectionPhasePreflight({
      cwd,
      env,
      issueNumber,
      branchName,
      statusShort,
      dirty,
      branchSafety,
      issueMetadata,
      fallbackIssueUrl,
    })
  }

  const progressAnalysis =
    issueMetadata.available && issueMetadata.body
      ? analyzeProgressTracking({
          cwd,
          activeIssueBody: issueMetadata.body,
          activeIssueNumber: issueNumber,
          activeIssueState: issueMetadata.state,
          env,
        })
      : {
          blockers: [],
          warnings: [],
          report: {
            declarations: {},
            durableProgress: { hasChecklist: false, milestones: [], firstIncomplete: null },
          },
        }

  const nextStep = buildNextStep({
    branchSafetyOk: branchSafety.ok,
    dirty,
    branchName,
    issueNumber,
    suggestedBranchName,
    devBranchAvailable,
    progressBlockers: progressAnalysis.blockers,
  })

  const output = [
    'Bemoat agent issue preflight',
    `Issue number: ${issueNumber}`,
    '',
    `Current branch: ${branchName}`,
    'Git status --short:',
    statusShort || '<clean>',
    '',
    'Branch safety:',
    ...(branchSafety.lines.length > 0 ? branchSafety.lines : ['<no branch safety output>']),
    '',
  ]

  if (dirty) {
    output.push('Working tree: not clean.')
    output.push('This command cannot continue safely until the existing changes are resolved.')
    output.push('')
  } else {
    output.push('Working tree: clean.')
    output.push('')
  }

  output.push('GitHub issue:')
  if (issueMetadata.available) {
    output.push(`Title: ${issueMetadata.title}`)
    output.push(`URL: ${issueMetadata.url}`)
  } else {
    output.push(`Metadata unavailable: ${issueMetadata.reason}`)
    if (fallbackIssueUrl) {
      output.push(`Best-effort issue URL: ${fallbackIssueUrl}`)
    }
  }

  if (suggestedBranchName) {
    output.push(`Suggested branch default: ${suggestedBranchName}`)
    output.push('Adjust the prefix if this is docs, fix, chore, test, or refactor work.')
  }

  if (!devBranchAvailable) {
    output.push(
      'Repo bootstrap note: `dev` is not available yet, so use the safest protected baseline and call out the exception in the PR.',
    )
  }

  output.push('')
  output.push(...formatProgressSection(progressAnalysis))
  output.push('')
  output.push('Docs to read before implementation:')
  for (const docPath of docsToRead) {
    output.push(`- ${docPath}`)
  }

  output.push('')
  output.push('Validation guidance:')
  output.push('- Follow the validation tier in AGENTS.md.')
  output.push('- Starter code/script changes usually require pnpm run check.')
  output.push('- Child repos must use the bemoat:* tier documented in AGENTS.md.')
  output.push('')
  output.push(`${nextStep.label}: ${nextStep.value}`)

  const hasProgressBlockers = progressAnalysis.blockers.length > 0
  const ok = branchSafety.ok && !dirty && !hasProgressBlockers

  return {
    ok,
    exitCode: ok ? 0 : 1,
    usageError: false,
    output,
    issueNumber,
    branchName,
    statusShort,
    issueMetadata,
    suggestedBranchName,
    progressAnalysis,
  }
}

function main() {
  const report = runAgentIssuePreflight()
  const stream = report.usageError ? process.stderr : process.stdout

  stream.write(`${report.output.join('\n')}\n`)
  process.exit(report.exitCode)
}

if (process.argv[1] && (resolve(process.argv[1]) === fileURLToPath(import.meta.url) || process.argv[1].endsWith('/agent-issue.mjs'))) {
  main()
}
