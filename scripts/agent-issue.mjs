#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

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

function parseIssueNumber(argv = process.argv.slice(2)) {
  const issueNumber = argv.find((arg) => arg !== '--')?.trim()

  if (!issueNumber || !/^[1-9]\d*$/.test(issueNumber)) {
    return null
  }

  return issueNumber
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

  const taskSizeMatch = source.match(
    /(?:^|\n)\s*(?:Task\s+size|This is a)\s*[:\s]*\**\s*(small|medium|core)\b/i,
  )
  if (taskSizeMatch) {
    declarations.taskSize = taskSizeMatch[1].toLowerCase()
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
  const founderGateOpen = milestones.some(
    (item) => /founder/i.test(item.label) && !item.complete,
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
  env = process.env,
} = {}) {
  const blockers = []
  const warnings = []
  const declarations = parseIssueDeclarations(activeIssueBody)
  const report = {
    declarations,
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
  }

  const durableProgress = report.durableProgress
  const taskSize = declarations.taskSize
  const isSmallTask = taskSize === 'small'
  const activeIssueSource = stripFencedCodeBlocks(activeIssueBody)

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

  const activePrRef =
    declarations.activePrRef || declarations.currentStage.active_pr || null
  if (activePrRef) {
    const prResult = fetchPrByReference(cwd, activePrRef, env)
    if (!prResult.ok) {
      blockers.push(`Declared Active PR could not be identified: ${activePrRef}`)
    } else {
      report.pr = prResult.pr
      report.exactHeadCi = analyzeExactHeadCi(prResult.pr)
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

  const blockingFindings = detectBlockingFindings(declarations.currentStage)
  if (blockingFindings.length > 0) {
    blockers.push(
      `Unresolved Critical or Important findings block dependent work: ${blockingFindings.join('; ')}`,
    )
  }

  const founderGate = detectFounderGate(declarations.currentStage, durableProgress.milestones)
  if (founderGate.open) {
    warnings.push('Founder gate remains open — do not infer approval from technical readiness or green CI.')
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

export function runAgentIssuePreflight({
  cwd = process.cwd(),
  argv = process.argv.slice(2),
  env = process.env,
} = {}) {
  const issueNumber = parseIssueNumber(argv)
  if (!issueNumber) {
    return {
      ok: false,
      exitCode: 1,
      usageError: true,
      output: [
        'Issue preflight failed: missing or invalid issue number.',
        'Usage: pnpm run bemoat:agent:issue -- <issue-number>',
      ],
    }
  }

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

  const progressAnalysis =
    issueMetadata.available && issueMetadata.body
      ? analyzeProgressTracking({
          cwd,
          activeIssueBody: issueMetadata.body,
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
