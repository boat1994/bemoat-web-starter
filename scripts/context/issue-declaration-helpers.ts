export interface IssueDeclarationShape {
  mainIssueRef: string | null
  implementationPlanPath: string | null
  relevantPlanSection: string | null
  activeTaskIssueRef: string | null
  activePrRef: string | null
  approvedBase: string | null
  currentStage: Record<string, string>
  declaresMainIssue: boolean
  declaresImplementationPlan: boolean
}

type DeclarationKey =
  | 'mainIssueRef'
  | 'implementationPlanPath'
  | 'relevantPlanSection'
  | 'activeTaskIssueRef'
  | 'activePrRef'
  | 'approvedBase'

export function stripFencedCodeBlocks(body = ''): string {
  return body.replace(/```[\s\S]*?```/g, '')
}

export function parseIssueFormSection(source: string, headingPrefix: string): string | null {
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

function extractBacktickPath(text: string): string {
  const match = text.match(/`([^`]+)`/)
  return match ? match[1].trim() : text.trim()
}

function isMeaningfulIssueRef(value: string): boolean {
  if (!value) return false
  const trimmed = value.trim()
  if (/^none\b/i.test(trimmed)) return false
  return /(?:^|\s)(?:[\w.-]+\/[\w.-]+)?#?\d+\b/.test(trimmed)
}

export function assignDeclarationValue(
  declarations: IssueDeclarationShape,
  key: DeclarationKey,
  value: string | null | undefined,
): void {
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
  if (key === 'approvedBase') declarations.approvedBase = trimmed
}
