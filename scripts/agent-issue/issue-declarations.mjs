import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  assignDeclarationValue,
  parseIssueFormSection,
  stripFencedCodeBlocks,
} from './pure-helpers.mjs'

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

export function stateRequiresPrEvidence(state) {
  return /^(AWAITING_REVIEW_|CORRECTION_REQUIRED_)/.test(state) ||
    ['BLOCKED_FOR_FOUNDER_DECISION', 'ELIGIBLE_FOR_FOUNDER_REVIEW', 'DONE'].includes(state)
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
