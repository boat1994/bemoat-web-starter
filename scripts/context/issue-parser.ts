import type { RoleEvidence } from './model.ts'
import { parseIssueDeclarations, deriveWorkflowProfile } from '../agent-issue/issue-declarations.ts'

interface ParsedIssueBody {
  objective: string | null
  scope: string | null
  acceptanceCriteria: string[]
  dependencies: string[]
  taskSize: string | null
  missionControlMode: string | null
  workflowProfile: string | null
}

interface RoleEvidenceResult {
  latestHandoff: RoleEvidence | null
  historicalResults: RoleEvidence[]
  invalid: RoleEvidence[]
}

function sections(body: string): Map<string, string[]> {
  const result = new Map<string, string[]>()
  let current: string | null = null

  for (const line of String(body ?? '').split(/\r?\n/)) {
    const heading = line.match(/^#{2,6}\s+(.+?)\s*#*\s*$/)
    if (heading) {
      current = heading[1].trim().toLowerCase()
      result.set(current, [])
    } else if (current) {
      result.get(current)?.push(line)
    }
  }

  return result
}

function firstParagraph(lines: string[] | undefined): string | null {
  const text = (lines ?? [])
    .join('\n')
    .trim()
    .split(/\n\s*\n/)[0]
    ?.replace(/^~~~[\s\S]*?~~~$/g, '')
    .trim()
  return text || null
}

function listItems(lines: string[] | undefined): string[] {
  return (lines ?? [])
    .map((line) => line.match(/^\s*[-*+]\s+(?:\[[ xX]\]\s*)?(.+?)\s*$/)?.[1])
    .filter((item): item is string => Boolean(item))
}

function matchingSection(map: Map<string, string[]>, pattern: RegExp): string[] | undefined {
  for (const [heading, lines] of map) {
    if (pattern.test(heading)) return lines
  }
  return undefined
}

export function parseIssueBody(body: string): ParsedIssueBody {
  const map = sections(body)
  const decls = parseIssueDeclarations(body)
  const profile = deriveWorkflowProfile(decls)
  return {
    objective: firstParagraph(matchingSection(map, /^(goal|objective)$/)),
    scope: firstParagraph(matchingSection(map, /^scope$|objective boundary/)),
    acceptanceCriteria: listItems(matchingSection(map, /acceptance criteria/)),
    dependencies: listItems(matchingSection(map, /dependenc/)),
    taskSize: decls.taskSize,
    missionControlMode: decls.missionControlMode,
    workflowProfile: profile?.name ?? null,
  }
}

export function parseRoleEvidence(comments: unknown[]): RoleEvidenceResult {
  const handoffs: RoleEvidence[] = []
  const results: RoleEvidence[] = []
  const invalid: RoleEvidence[] = []

  for (const value of comments) {
    if (!value || typeof value !== 'object') continue
    const comment = value as Partial<RoleEvidence>
    const body = typeof comment.body === 'string' ? comment.body : ''
    const marker = body.match(/^##\s+(HANDOFF|RESULT)\b/i)?.[1]?.toUpperCase()
    if (!marker) continue

    const normalized: RoleEvidence = {
      id: comment.id ?? '',
      body,
      createdAt: typeof comment.createdAt === 'string' ? comment.createdAt : '',
      url: typeof comment.url === 'string' ? comment.url : '',
    }

    if (!normalized.createdAt || Number.isNaN(Date.parse(normalized.createdAt))) {
      invalid.push(normalized)
      continue
    }

    if (marker === 'HANDOFF') handoffs.push(normalized)
    else results.push(normalized)
  }

  handoffs.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  results.sort((left, right) => right.createdAt.localeCompare(left.createdAt))

  return {
    latestHandoff: handoffs[0] ?? null,
    historicalResults: results,
    invalid,
  }
}
