export interface NextStep {
  label: 'Next manual step'
  value: string
}

export interface BuildNextStepInput {
  branchSafetyOk: boolean
  dirty: boolean
  branchName: string
  issueNumber: string
  suggestedBranchName?: string | null
  devBranchAvailable: boolean
  progressBlockers: string[]
}

export interface ProgressDeclarations {
  declaresMainIssue: boolean
  declaresImplementationPlan: boolean
  mainIssueRef?: string
  implementationPlanPath?: string
}

export interface ProgressReport {
  workflowProfile?: {
    name: string
    nextAction: string
  }
  declarations: ProgressDeclarations
  mainIssue?: {
    title: string
    url: string
  }
  plan?: {
    ok: boolean
    planPath: string
  }
  relevantPlanSection?: string
  firstIncompleteMilestone?: {
    slice?: string
    label: string
  }
  durableProgress: {
    hasChecklist: boolean
  }
  currentStageSummary?: {
    slice?: string
    taskOrGate?: string
    activeTaskIssue?: string
    activePr?: string
    relevantPlanSection?: string
    approvedBase?: string
    founderGate?: string
  }
  pr?: {
    headRefName?: string
    baseRefName?: string
    headRefOid?: string
  }
  exactHeadCi?: {
    summary: string
  }
  nextPermittedAction?: string
}

export interface ProgressAnalysis {
  blockers: string[]
  warnings: string[]
  report: ProgressReport
}

export function buildNextStep({
  branchSafetyOk,
  dirty,
  branchName,
  issueNumber,
  suggestedBranchName,
  devBranchAvailable,
  progressBlockers,
}: BuildNextStepInput): NextStep {
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

export function formatProgressSection(progressAnalysis: ProgressAnalysis): string[] {
  const lines: string[] = []
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
