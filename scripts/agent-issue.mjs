#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { analyzeReconciliation, findLatestRoleComment } from './mission-control-reconcile.mjs'
import {
  buildCorrectionCapsule,
  parseCorrectionContract,
} from './correction-contract.mjs'

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

  if (missionControlMode === 'unsure') {
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

const missionControlStates = new Set([
  'READY',
  'IN_PROGRESS',
  'AWAITING_REVIEW_1',
  'CORRECTION_REQUIRED_1',
  'AWAITING_REVIEW_2',
  'CORRECTION_REQUIRED_2',
  'AWAITING_REVIEW_3',
  'BLOCKED_FOR_FOUNDER_DECISION',
  'ELIGIBLE_FOR_FOUNDER_REVIEW',
  'DONE',
  'BLOCKED_EXTERNAL',
  'STATE_CONFLICT',
  'STATE_MIGRATION_REQUIRED',
])

const missionControlRequiredKeys = [
  'schema_version', 'state', 'review_cycle', 'full_review_count', 'approved_base',
  'active_task_issue', 'active_pr', 'current_head', 'last_reviewed_head',
  'guide_version', 'guide_source_ref', 'guide_source_sha', 'open_blockers',
  'follow_up_issues', 'next_permitted_action', 'material_change_status', 'updated_at',
  'updated_by',
]

function parseMissionControlScalar(value) {
  const trimmed = value.trim()
  if (trimmed === 'null') return null
  if (trimmed === '[]') return []
  if (/^\d+$/.test(trimmed)) return Number(trimmed)
  const quoted = trimmed.match(/^(["'])(.*)\1$/)
  return quoted ? quoted[2] : trimmed
}

const missionControlArrayKeys = new Set(['open_blockers', 'follow_up_issues'])

/**
 * @typedef {{
 *   schema_version: number,
 *   state: string,
 *   review_cycle: number,
 *   full_review_count: number,
 *   approved_base: string,
 *   active_task_issue: string | null,
 *   active_pr: string | null,
 *   current_head: string | null,
 *   last_reviewed_head: string | null,
 *   guide_version: string,
 *   guide_source_ref: string,
 *   guide_source_sha: string | null,
 *   open_blockers: unknown[],
 *   follow_up_issues: unknown[],
 *   next_permitted_action: string,
 *   material_change_status: string,
 *   updated_at: string | null,
 *   updated_by: string | null,
 * }} MissionControlState
 */

/** @returns {{present: boolean, valid: boolean, reason?: string, state: MissionControlState | null}} */
export function parseMissionControlState(body = '') {
  const starts = [...body.matchAll(/<!--\s*bemoat-mission-control-state:start\s*-->/g)]
  const ends = [...body.matchAll(/<!--\s*bemoat-mission-control-state:end\s*-->/g)]
  if (starts.length === 0 && ends.length === 0) return { present: false, valid: false, state: null }
  if (starts.length !== 1 || ends.length !== 1 || starts[0].index > ends[0].index) {
    return { present: true, valid: false, reason: 'exactly one balanced marker pair is required' }
  }

  const raw = body.slice(starts[0].index + starts[0][0].length, ends[0].index)
    .replace(/```yaml\s*|```/g, '')
  /** @type {Record<string, unknown>} */
  const state = {}
  let listKey = null
  for (const line of raw.split('\n')) {
    if (!line.trim() || /^\s*#/.test(line)) continue
    const listItem = line.match(/^\s*-\s+(.+?)\s*$/)
    if (listItem) {
      if (!listKey) return { present: true, valid: false, reason: `unreadable state line: ${line.trim()}` }
      state[listKey].push(parseMissionControlScalar(listItem[1]))
      continue
    }
    const match = line.match(/^\s*([a-z_]+)\s*:\s*(.*?)\s*$/)
    if (!match) return { present: true, valid: false, reason: `unreadable state line: ${line.trim()}` }
    if (Object.hasOwn(state, match[1])) return { present: true, valid: false, reason: `duplicate state key: ${match[1]}` }
    if (match[2] === '' && missionControlArrayKeys.has(match[1])) {
      state[match[1]] = []
      listKey = match[1]
    } else {
      state[match[1]] = parseMissionControlScalar(match[2])
      listKey = null
    }
  }

  const missing = missionControlRequiredKeys.filter((key) => !Object.hasOwn(state, key))
  if (missing.length > 0) return { present: true, valid: false, reason: `missing required state key(s): ${missing.join(', ')}` }
  if (state.schema_version !== 1) return { present: true, valid: false, reason: 'unsupported schema_version' }
  if (typeof state.state !== 'string' || !missionControlStates.has(state.state)) {
    return { present: true, valid: false, reason: 'invalid state enum' }
  }
  const nullableStringKeys = ['active_task_issue', 'active_pr', 'current_head', 'last_reviewed_head', 'guide_source_sha', 'updated_at', 'updated_by']
  const requiredStringKeys = ['approved_base', 'guide_version', 'guide_source_ref', 'next_permitted_action', 'material_change_status']
  if (nullableStringKeys.some((key) => state[key] !== null && typeof state[key] !== 'string') ||
      requiredStringKeys.some((key) => typeof state[key] !== 'string' || state[key].length === 0)) {
    return { present: true, valid: false, reason: 'invalid required state field type' }
  }
  if (!Number.isInteger(state.review_cycle) || !Number.isInteger(state.full_review_count) || state.review_cycle < 0 || state.review_cycle > 3 || state.full_review_count < 0 || state.full_review_count > 1 || state.full_review_count > state.review_cycle) {
    return { present: true, valid: false, reason: 'impossible review counter values' }
  }
  if (!Array.isArray(state.open_blockers) || !Array.isArray(state.follow_up_issues)) {
    return { present: true, valid: false, reason: 'open_blockers and follow_up_issues must be arrays' }
  }
  if (state.review_cycle > 0 && typeof state.last_reviewed_head !== 'string') {
    return { present: true, valid: false, reason: 'reviewed cycles require last_reviewed_head' }
  }

  const expectedCycles = {
    READY: 0,
    IN_PROGRESS: 0,
    AWAITING_REVIEW_1: 0,
    CORRECTION_REQUIRED_1: 1,
    AWAITING_REVIEW_2: 1,
    CORRECTION_REQUIRED_2: 2,
    AWAITING_REVIEW_3: 2,
  }
  if (Object.hasOwn(expectedCycles, state.state) && state.review_cycle !== expectedCycles[state.state]) {
    return { present: true, valid: false, reason: 'state and review_cycle are inconsistent' }
  }
  const expectedFullReviewCounts = {
    READY: 0,
    IN_PROGRESS: 0,
    AWAITING_REVIEW_1: 0,
    CORRECTION_REQUIRED_1: 1,
    AWAITING_REVIEW_2: 1,
    CORRECTION_REQUIRED_2: 1,
    AWAITING_REVIEW_3: 1,
    BLOCKED_FOR_FOUNDER_DECISION: 1,
    ELIGIBLE_FOR_FOUNDER_REVIEW: 1,
    DONE: 1,
  }
  if (Object.hasOwn(expectedFullReviewCounts, state.state) && state.full_review_count !== expectedFullReviewCounts[state.state]) {
    return { present: true, valid: false, reason: 'state and full_review_count are inconsistent' }
  }

  return { present: true, valid: true, state: /** @type {MissionControlState} */ (state) }
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
      comments: Array.isArray(payload.comments) ? payload.comments : [],
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
    'title,url,headRefName,baseRefName,headRefOid,state,statusCheckRollup,commits',
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
  if (stateAnalysis.valid && ['STATE_CONFLICT', 'STATE_MIGRATION_REQUIRED', 'BLOCKED_EXTERNAL'].includes(state.state)) {
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
      if (!activePrRef && latestResult?.parsed?.prNumber) {
        activePrRef = `#${latestResult.parsed.prNumber}`
      }
    }
  }

  if (stateAnalysis.valid && (declaredActivePrRef || stateActivePrRef)) {
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
        if (state.current_head && state.current_head !== prResult.pr.headRefOid) {
          blockers.push('STATE_CONFLICT: state current_head does not match the live PR head.')
        }
        if (prResult.pr.state === 'MERGED' && state.state !== 'DONE') {
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
  const match = verdictBody.match(
    /\*\*PR\s*\/\s*base\s*\/\s*head:\*\*[^\n]*·\s*`([^`]+)`\s*·\s*`([0-9a-f]{7,40})`/i,
  )
  return { base: match?.[1]?.trim() ?? null, head: match?.[2] ?? null }
}

/**
 * Reconcile the immutable contract reviewed_head against the visible verdict
 * head, then against uniquely identified live PR evidence, before granting
 * correction edit authorization. Fails closed for missing or mismatched PR
 * identity, head, base, state, or unavailable required evidence.
 * GitHub orchestration stays here — the correction-contract module remains pure.
 */
function reconcileCorrectionPrEvidence({ cwd, env, verdictBody, contractReviewedHead }) {
  const prNumber =
    verdictBody.match(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/(\d+)/)?.[1] ??
    verdictBody.match(/\bPR\s*#(\d+)\b/i)?.[1] ??
    null
  if (!prNumber) {
    return { ok: false, errors: ['REVIEW_VERDICT does not uniquely identify a live PR by number or URL'] }
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

  const prResult = fetchPrByReference(cwd, `#${prNumber}`, env)
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
  if (livePr.headRefOid !== contractReviewedHead) {
    errors.push('live PR head does not match the immutable contract reviewed_head')
  }
  if (verdictBase && livePr.baseRefName !== verdictBase) {
    errors.push('live PR base does not match the REVIEW_VERDICT approved base')
  }
  if (livePr.state !== 'OPEN') {
    errors.push(`live PR state is ${livePr.state}, not OPEN`)
  }

  return { ok: errors.length === 0, errors, prNumber, livePr }
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

  const reconciliation = reconcileCorrectionPrEvidence({
    cwd,
    env,
    verdictBody: latestVerdict.comment.body,
    contractReviewedHead: parsedContract.contract.reviewed_head,
  })
  if (!reconciliation.ok) {
    output.push('Stop: live PR evidence does not reconcile with the immutable contract head before correction edit authorization.')
    for (const error of reconciliation.errors) output.push(`- ${error}`)
    return { ok: false, exitCode: 1, usageError: false, output, issueNumber, branchName, statusShort, issueMetadata }
  }

  const prUrl =
    latestVerdict.comment.body.match(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/)?.[0] ??
    (latestVerdict.parsed?.prNumber ? `PR #${latestVerdict.parsed.prNumber}` : null)
  const issueRef =
    issueMetadata.available && issueMetadata.url
      ? issueMetadata.url
      : fallbackIssueUrl || `#${issueNumber}`

  const capsule = buildCorrectionCapsule(parsedContract.contract, {
    issueNumber,
    prUrl: prUrl || '(not provided)',
  })

  return {
    ok: true,
    exitCode: 0,
    usageError: false,
    output: [
      'Bemoat correction-mode preflight',
      `Issue: ${issueRef}`,
      ...capsule.lines,
      'Edit authorization: granted for the immutable finding set only.',
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
