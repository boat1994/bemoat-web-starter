import { assignDeclarationValue, parseIssueFormSection, stripFencedCodeBlocks } from './issue-declaration-helpers.ts'

export interface WorkflowProfile {
  name: string
  nextAction: string
}

export interface IssueDeclarationsResult {
  mainIssueRef: string | null
  implementationPlanPath: string | null
  relevantPlanSection: string | null
  activeTaskIssueRef: string | null
  activePrRef: string | null
  approvedBase: string | null
  taskSize: string | null
  missionControlMode: string | null
  nextPermittedAction: string | null
  currentStage: Record<string, string>
  declaresMainIssue: boolean
  declaresImplementationPlan: boolean
}

export function deriveWorkflowProfile({
  taskSize,
  missionControlMode,
  declaresMainIssue = false,
  declaresImplementationPlan = false,
}: {
  taskSize?: string | null
  missionControlMode?: string | null
  declaresMainIssue?: boolean
  declaresImplementationPlan?: boolean
} = {}): WorkflowProfile | null {
  if (
    missionControlMode === 'required' ||
    (taskSize === 'core' && declaresMainIssue && declaresImplementationPlan)
  ) {
    return {
      name: 'STANDARD',
      nextAction:
        'Use STANDARD safeguards; legacy managed declarations are read-only historical metadata.',
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
      nextAction:
        'Use STANDARD safeguards because the workflow profile is not explicitly eligible for FAST.',
    }
  }

  if (missionControlMode !== 'optional') return null

  if (taskSize === 'small') {
    return {
      name: 'FAST',
      nextAction:
        'Follow the FAST lifecycle: focused implementation and verification, one commit, PR, and HANDOFF when applicable, then Founder review.',
    }
  }

  if (taskSize === 'medium' || taskSize === 'core') {
    return {
      name: 'STANDARD',
      nextAction:
        'Use the STANDARD workflow with risk-adjusted verification and the existing Founder merge gate.',
    }
  }

  return null
}

export function parseIssueDeclarations(body: string = ''): IssueDeclarationsResult {
  const source = stripFencedCodeBlocks(body)
  const declarations: IssueDeclarationsResult = {
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

  assignDeclarationValue(declarations, 'mainIssueRef', parseIssueFormSection(source, 'Main Issue'))
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
  if (
    formMissionControlMode &&
    /^(required|optional|not required|unsure)$/i.test(formMissionControlMode)
  ) {
    const normalizedMode = formMissionControlMode.toLowerCase()
    declarations.missionControlMode =
      normalizedMode === 'required'
        ? 'required'
        : normalizedMode === 'unsure'
          ? 'unsure'
          : 'optional'
  }

  const taskSizeMatch = source.match(
    /(?:^|\n)\s*(?:[-*]\s*)?(?:Task\s+(?:size|tier)|Tier|This is a)\s*[:\s]*\**\s*(small|medium|core)\b/i,
  )
  if (taskSizeMatch) declarations.taskSize = taskSizeMatch[1].toLowerCase()

  const missionControlModeMatch = source.match(
    /(?:^|\n)\s*(?:[-*]\s*)?Mission\s+Control\s+mode\s*:\s*(required|optional|not required|unsure)\b/im,
  )
  if (missionControlModeMatch) {
    const normalizedMode = missionControlModeMatch[1].toLowerCase()
    declarations.missionControlMode =
      normalizedMode === 'required'
        ? 'required'
        : normalizedMode === 'unsure'
          ? 'unsure'
          : 'optional'
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
      if (value) declarations.currentStage[key] = value
    }
  }

  return declarations
}
