#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
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

export { parseMissionControlState }

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
    'title,url,headRefName,baseRefName,headRefOid,state,statusCheckRollup,commits,headRepository,mergeCommit',
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

function extractVerdictPrBaseAndHead(verdictBody) {
  let match = verdictBody.match(
    /\*\*PR\s*\/\s*base\s*\/\s*head:\*\*[^\n]*·\s*`([^`]+)`\s*·\s*`([0-9a-f]{7,40})`/i,
  )
  if (!match) {
    match = verdictBody.match(
      /\*\*PR\s*\/\s*base\s*\/\s*head:\*\*[^\n]*·\s*(?:base\s+)?`?([^`\s·]+)`?\s*·\s*(?:head\s+)?`?([0-9a-f]{7,40})`?/i,
    )
  }
  return { base: match?.[1]?.trim() ?? null, head: match?.[2] ?? null }
}

function asciiCaseFold(value) {
  return String(value).toLowerCase()
}

function foldedPrIdentityKey(owner, repo, number) {
  return `${asciiCaseFold(owner)}/${asciiCaseFold(repo)}#${number}`
}

/**
 * Parse one complete live/verdict GitHub pull URL value.
 * Rejects prefixes, suffixes, encoding, authority tricks, and WHATWG-normalized
 * forms that differ from the raw supported contract.
 */
export function parseCompleteGitHubPullUrl(raw) {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { ok: false, reason: 'live PR identity URL is missing or empty' }
  }

  // No silent trim/repair: raw value must already be the complete URL.
  if (raw !== raw.trim() || /[\s\u00a0\u2000-\u200b\u2028\u2029\u3000]/.test(raw)) {
    return { ok: false, reason: 'live PR identity URL contains whitespace' }
  }
  if (/[\u0000-\u001f\u007f\u0080-\u009f\\%]/.test(raw) || /\p{Cc}|\p{Cf}/u.test(raw)) {
    return { ok: false, reason: 'live PR identity URL contains forbidden raw characters' }
  }
  if (!raw.startsWith('https://')) {
    return { ok: false, reason: 'live PR identity URL must use literal lowercase https' }
  }

  const afterScheme = raw.slice('https://'.length)
  const slashIdx = afterScheme.indexOf('/')
  if (slashIdx <= 0) {
    return { ok: false, reason: 'live PR identity URL authority is malformed' }
  }
  const rawAuthority = afterScheme.slice(0, slashIdx)
  if (rawAuthority.includes('@') || rawAuthority.includes(':') || rawAuthority.includes('[')) {
    return { ok: false, reason: 'live PR identity URL must not include userinfo or port' }
  }
  if (asciiCaseFold(rawAuthority) !== 'github.com') {
    return { ok: false, reason: 'live PR identity URL host must be github.com' }
  }

  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    return { ok: false, reason: 'live PR identity URL is present but unparseable' }
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'live PR identity URL must use https' }
  }
  if (parsed.hostname !== 'github.com') {
    return { ok: false, reason: 'live PR identity URL host must be github.com' }
  }
  if (parsed.username || parsed.password || parsed.port) {
    return { ok: false, reason: 'live PR identity URL must not include credentials or port' }
  }
  if (parsed.search || parsed.hash) {
    return { ok: false, reason: 'live PR identity URL must not include query or fragment' }
  }

  const rawPath = afterScheme.slice(slashIdx)
  if (rawPath !== parsed.pathname) {
    return { ok: false, reason: 'live PR identity URL path is not a complete canonical value' }
  }

  const segments = parsed.pathname.split('/')
  if (segments.length !== 5 || segments[0] !== '') {
    return { ok: false, reason: 'live PR identity URL path structure is invalid' }
  }

  const [, owner, repo, pullLiteral, number] = segments
  if (pullLiteral !== 'pull') {
    return { ok: false, reason: 'live PR identity URL path must include /pull/' }
  }
  if (!owner || !repo || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) {
    return { ok: false, reason: 'live PR identity URL owner/repository must be ASCII path segments' }
  }
  if (!/^[1-9][0-9]*$/.test(number)) {
    return { ok: false, reason: 'live PR identity URL pull number must be a positive integer' }
  }
  if (rawPath !== `/${owner}/${repo}/pull/${number}`) {
    return { ok: false, reason: 'live PR identity URL path is not a complete canonical value' }
  }

  return {
    ok: true,
    identity: {
      owner,
      repo,
      number,
      key: foldedPrIdentityKey(owner, repo, number),
    },
  }
}

/**
 * Structurally valid GitHub pull-review discussion fragment (`#discussion_rN`).
 * Broader `#discussion` substrings are intentionally not accepted.
 */
function isGitHubReviewDiscussionFragment(fragment) {
  return typeof fragment === 'string' && /^#discussion_r[0-9]+$/i.test(fragment)
}

/**
 * Benign same-PR review-thread pointer — not PR identity evidence.
 * Requires a valid review-discussion fragment, a fragment-stripped complete
 * canonical pull URL, and an exact match to the established canonical identity
 * or a declared finding source_thread when operating under planning_no_pr.
 */
function isSourceThreadDiscussionPointer(candidate, canonicalIdentity, knownSourceThreads = null) {
  if (typeof candidate !== 'string' || candidate.length === 0 || !canonicalIdentity) {
    return false
  }

  const hashIdx = candidate.indexOf('#')
  if (hashIdx < 0) return false

  const fragment = candidate.slice(hashIdx)
  if (!isGitHubReviewDiscussionFragment(fragment)) return false

  const stripped = candidate.slice(0, hashIdx)
  const parsed = parseCompleteGitHubPullUrl(stripped)
  if (!parsed.ok) return false

  if (canonicalIdentity.none === true) {
    if (!knownSourceThreads || knownSourceThreads.size === 0) return false
    return knownSourceThreads.has(candidate)
  }

  return (
    foldedPrIdentityKey(
      parsed.identity.owner,
      parsed.identity.repo,
      parsed.identity.number,
    ) ===
    foldedPrIdentityKey(
      canonicalIdentity.owner,
      canonicalIdentity.repo,
      canonicalIdentity.number,
    )
  )
}

/**
 * True when a token is plausibly PR identity evidence (absolute pull URL or
 * `/pull/...` path), independent of whether the complete-URL parser accepts it.
 */
function isPlausiblePullIdentityCandidate(candidate) {
  if (typeof candidate !== 'string' || candidate.length === 0) return false
  if (/^https:\/\//i.test(candidate)) {
    return /\/pull\//i.test(candidate)
  }
  return /^\/(?:[\w.-]+\/[\w.-]+\/)?pull\//i.test(candidate)
}

/**
 * Collect repository-qualified PR identities from a verdict body.
 * Only complete canonical pull URLs count as valid identities. Malformed
 * identity-like pull URL/path candidates are preserved as conflicting
 * evidence instead of being silently discarded. `PR #N` shorthand is
 * qualified against the current repository when available.
 * Same-PR `#discussion_rN` source-thread pointers matching `canonicalIdentity`
 * are excluded; other `#discussion*` candidates remain identity evidence.
 */
function collectVerdictPrIdentities(verdictBody, defaultRepo, canonicalIdentity = null, knownSourceThreads = null) {
  const identities = []
  const malformedCandidates = []
  const seenMalformed = new Set()

  const recordMalformed = (candidate, reason) => {
    if (seenMalformed.has(candidate)) return
    seenMalformed.add(candidate)
    malformedCandidates.push({ candidate, reason, source: 'url' })
  }

  const considerUrlOrPathCandidate = (rawCandidate) => {
    let candidate = rawCandidate.replace(/[),.;:]+$/g, '')

    const hashIdx = candidate.indexOf('#')
    if (hashIdx >= 0) {
      const fragment = candidate.slice(hashIdx)
      if (isGitHubReviewDiscussionFragment(fragment)) {
        if (isSourceThreadDiscussionPointer(candidate, canonicalIdentity, knownSourceThreads)) {
          return
        }
        // Valid discussion fragment that is not a matching same-PR pointer:
        // strip the fragment and route the remainder through normal identity /
        // malformed rejection so disguised conflicts cannot bypass checks.
        candidate = candidate.slice(0, hashIdx)
      }
    }

    if (!isPlausiblePullIdentityCandidate(candidate)) return
    const parsed = parseCompleteGitHubPullUrl(candidate)
    if (!parsed.ok) {
      recordMalformed(candidate, parsed.reason || 'malformed PR identity candidate')
      return
    }
    identities.push({
      ...parsed.identity,
      source: 'url',
    })
  }

  const httpsCandidateRe = /https:\/\/[^\s"'<>\]]+/gi
  for (const match of verdictBody.matchAll(httpsCandidateRe)) {
    considerUrlOrPathCandidate(match[0])
  }

  // Relative or root-relative pull paths are identity-like even without a host.
  const pathCandidateRe = /(?:^|[\s"'<>(\[])(\/(?:[\w.-]+\/[\w.-]+\/)?pull\/[^\s"'<>\]]*)/gi
  for (const match of verdictBody.matchAll(pathCandidateRe)) {
    considerUrlOrPathCandidate(match[1])
  }

  const shorthandRe = /\bPR\s*#([0-9]+)\b/gi
  for (const match of verdictBody.matchAll(shorthandRe)) {
    const number = match[1]
    if (!/^[1-9][0-9]*$/.test(number)) continue
    if (!defaultRepo || !defaultRepo.includes('/')) {
      identities.push({
        owner: null,
        repo: null,
        number,
        key: `#${number}`,
        source: 'shorthand',
      })
      continue
    }
    const [owner, repo] = defaultRepo.split('/')
    identities.push({
      owner,
      repo,
      number,
      key: foldedPrIdentityKey(owner, repo, number),
      source: 'shorthand',
    })
  }

  return { identities, malformedCandidates }
}

/**
 * Resolve one canonical repository-qualified PR identity from the visible
 * `PR / base / head` evidence, rejecting foreign repositories and multiple
 * distinct or repeated PR references anywhere in the verdict.
 */
function resolveCanonicalVerdictPrIdentity(verdictBody, defaultRepo, mode = 'implementation_pr', knownSourceThreads = null) {
  if (!defaultRepo || !defaultRepo.includes('/')) {
    return {
      ok: false,
      errors: ['current repository identity is unavailable for PR reconciliation'],
    }
  }

  const lineMatch = verdictBody.match(/\*\*PR\s*\/\s*base\s*\/\s*head:\*\*([^\n]*)/i)
  if (!lineMatch) {
    return {
      ok: false,
      errors: ['REVIEW_VERDICT is missing a `PR / base / head` line with an exact head SHA'],
    }
  }

  const line = lineMatch[1]
  const firstToken = line.trim().split(/\s+/)[0] ?? ''
  const parsedLineUrl = parseCompleteGitHubPullUrl(firstToken)
  const lineShorthand = line.match(/\bPR\s*#([1-9][0-9]*)\b/i)

  if (mode === 'planning_no_pr') {
    const { identities: allIdentities, malformedCandidates } = collectVerdictPrIdentities(
      verdictBody,
      defaultRepo,
      { none: true },
      knownSourceThreads,
    )
    if (allIdentities.length > 0 || malformedCandidates.length > 0) {
      return {
        ok: false,
        errors: ['STATE CONFLICT: PR identity references found inside verdict under no-PR planning mode'],
      }
    }
    if (!line.trim().startsWith('none')) {
      return {
        ok: false,
        errors: ['REVIEW_VERDICT does not uniquely identify a live PR by number or URL'],
      }
    }
    return {
      ok: true,
      identity: {
        none: true,
      },
    }
  }

  if (!parsedLineUrl.ok && !lineShorthand) {
    return {
      ok: false,
      errors: ['REVIEW_VERDICT does not uniquely identify a live PR by number or URL'],
    }
  }

  const [defaultOwner, defaultRepoName] = defaultRepo.split('/')
  let canonical
  if (parsedLineUrl.ok) {
    canonical = parsedLineUrl.identity
  } else {
    canonical = {
      owner: defaultOwner,
      repo: defaultRepoName,
      number: lineShorthand[1],
      key: foldedPrIdentityKey(defaultOwner, defaultRepoName, lineShorthand[1]),
    }
  }

  const canonicalKey = foldedPrIdentityKey(canonical.owner, canonical.repo, canonical.number)
  const defaultKey = foldedPrIdentityKey(defaultOwner, defaultRepoName, canonical.number)
  if (
    asciiCaseFold(canonical.owner) !== asciiCaseFold(defaultOwner) ||
    asciiCaseFold(canonical.repo) !== asciiCaseFold(defaultRepoName)
  ) {
    return {
      ok: false,
      errors: [
        `REVIEW_VERDICT PR identity ${canonicalKey} does not match the current repository ${defaultRepo}`,
      ],
    }
  }

  const { identities: allIdentities, malformedCandidates } = collectVerdictPrIdentities(
    verdictBody,
    defaultRepo,
    canonical,
    knownSourceThreads,
  )
  if (malformedCandidates.length > 0) {
    const samples = malformedCandidates
      .slice(0, 3)
      .map((entry) => entry.candidate)
      .join(', ')
    return {
      ok: false,
      errors: [
        `REVIEW_VERDICT contains malformed PR identity evidence (${samples})`,
      ],
    }
  }

  const distinctKeys = [...new Set(allIdentities.map((identity) => identity.key))]
  if (allIdentities.length !== 1) {
    if (distinctKeys.length > 1) {
      return {
        ok: false,
        errors: [
          `REVIEW_VERDICT contains multiple distinct PR identities (${distinctKeys.join(', ')})`,
        ],
      }
    }
    if (allIdentities.length > 1) {
      return {
        ok: false,
        errors: [
          `REVIEW_VERDICT repeats the same PR identity more than once (${distinctKeys[0] ?? canonicalKey})`,
        ],
      }
    }
    return {
      ok: false,
      errors: ['REVIEW_VERDICT does not uniquely identify a live PR by number or URL'],
    }
  }

  if (allIdentities[0].key !== defaultKey && allIdentities[0].key !== canonicalKey) {
    return {
      ok: false,
      errors: [
        `REVIEW_VERDICT PR identity ${allIdentities[0].key} does not match the current repository ${defaultRepo}`,
      ],
    }
  }

  return {
    ok: true,
    identity: {
      owner: defaultOwner,
      repo: defaultRepoName,
      number: canonical.number,
      key: defaultKey,
    },
  }
}

function collectKnownSourceThreads(contract) {
  const threads = new Set()
  for (const finding of contract?.findings ?? []) {
    if (typeof finding.source_thread === 'string' && finding.source_thread.trim()) {
      threads.add(finding.source_thread.trim())
    }
  }
  return threads
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
        if (onBaseCheck.status === 1) {
          errors.push('STATE CONFLICT: reviewed_head is not safely descended from approved_base')
        } else {
          errors.push('BLOCKED_EXTERNAL: git repository is too shallow or missing objects to verify ancestry')
        }
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
}) {
  const defaultRepo = getDefaultRepo(cwd)
  const knownSourceThreads = mode === 'planning_no_pr' ? collectKnownSourceThreads(contract) : null
  const identityResult = resolveCanonicalVerdictPrIdentity(
    verdictBody,
    defaultRepo,
    mode,
    knownSourceThreads,
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
  })
  if (!reconciliation.ok) {
    output.push('Stop: live PR evidence does not reconcile with the immutable contract head before correction edit authorization.')
    for (const error of reconciliation.errors) output.push(`- ${error}`)
    return { ok: false, exitCode: 1, usageError: false, output, issueNumber, branchName, statusShort, issueMetadata }
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
