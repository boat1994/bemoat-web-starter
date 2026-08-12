/**
 * Pure campaign marker parser.
 * No GitHub, filesystem, process, or command execution.
 */

import yaml from 'yaml'

import {
  CAMPAIGN_MARKER_END_RE,
  CAMPAIGN_MARKER_START_RE,
  TASK_MARKER_END_RE,
  TASK_MARKER_START_RE,
} from './campaign-enums.ts'
import { CAMPAIGN_DIAGNOSTIC_CODES } from './campaign-authority.mjs'
import { validateCampaign } from './campaign-validator.ts'
import type { CampaignInput } from './campaign-validator-schemas.ts'

export type CampaignParseResult = {
  present: boolean
  valid: boolean
  reason?: string
  code?: string
  classification?: string
  campaign: CampaignInput | null
}

export function parseCampaign(body: unknown = '', optionsInput: unknown = {}): CampaignParseResult {
  const text = String(body ?? '')

  const campaignStarts = [...text.matchAll(CAMPAIGN_MARKER_START_RE)]
  const campaignEnds = [...text.matchAll(CAMPAIGN_MARKER_END_RE)]
  const taskStarts = [...text.matchAll(TASK_MARKER_START_RE)]
  const taskEnds = [...text.matchAll(TASK_MARKER_END_RE)]

  if (campaignStarts.length === 0 && campaignEnds.length === 0) {
    return { present: false, valid: false, campaign: null }
  }

  if (campaignStarts.length !== 1 || campaignEnds.length !== 1) {
    return {
      present: true,
      valid: false,
      reason: 'exactly zero or one balanced campaign marker pair is required',
      classification: 'STATE_CONFLICT',
      campaign: null,
    }
  }

  const start = campaignStarts[0]
  const end = campaignEnds[0]
  if (start.index > end.index) {
    return {
      present: true,
      valid: false,
      reason: 'campaign markers are reversed or unbalanced',
      classification: 'STATE_CONFLICT',
      campaign: null,
    }
  }

  const campaignSpanStart = start.index
  const campaignSpanEnd = end.index + end[0].length
  const taskMarkerInside = [...taskStarts, ...taskEnds].some((match) => {
    return match.index > campaignSpanStart && match.index < campaignSpanEnd
  })
  if (taskMarkerInside) {
    return {
      present: true,
      valid: false,
      reason: 'mixed task/campaign markers are not allowed',
      classification: 'STATE_CONFLICT',
      campaign: null,
    }
  }

  const raw = text
    .slice(start.index + start[0].length, end.index)
    .replace(/```yaml\s*|```/g, '')

  let document
  try {
    document = yaml.parseDocument(raw, { uniqueKeys: false })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      present: true,
      valid: false,
      reason: `unreadable campaign document: ${message}`,
      classification: 'STATE_CONFLICT',
      campaign: null,
    }
  }

  const duplicate = findDuplicateYamlKey(document.contents)
  if (duplicate != null) {
    return {
      present: true,
      valid: false,
      reason: `duplicate campaign key: ${duplicate}`,
      code: CAMPAIGN_DIAGNOSTIC_CODES.DUPLICATE_KEY,
      classification: 'STATE_CONFLICT',
      campaign: null,
    }
  }
  if (document.errors.length > 0) {
    const message = document.errors[0]?.message ?? String(document.errors[0])
    return {
      present: true,
      valid: false,
      reason: `unreadable campaign document: ${message}`,
      classification: 'STATE_CONFLICT',
      campaign: null,
    }
  }

  let parsed: unknown
  try {
    parsed = document.toJS()
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      present: true,
      valid: false,
      reason: `unreadable campaign document: ${message}`,
      classification: 'STATE_CONFLICT',
      campaign: null,
    }
  }

  const validated = validateCampaign(parsed, optionsInput)
  if (!validated.valid) {
    return {
      present: true,
      valid: false,
      reason: validated.reason,
      code: validated.code,
      classification: validated.classification,
      campaign: null,
    }
  }

  return { present: true, valid: true, campaign: validated.campaign }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isMappingNode(node: unknown): node is { items: Record<string, unknown>[] } {
  return isRecord(node) && Array.isArray(node.items) && node.items.every(
    (item) => isRecord(item) && Object.hasOwn(item, 'key'),
  )
}

function hasItems(node: unknown): node is { items: unknown[] } {
  return isRecord(node) && Array.isArray(node.items)
}

function scalarKey(node: unknown): string | null {
  if (!isRecord(node) || !Object.hasOwn(node, 'value')) return null
  return String(node.value)
}

function findDuplicateYamlKey(node: unknown): string | null {
  if (isMappingNode(node)) {
    const seen = new Set<string>()
    for (const pair of node.items) {
      const key = scalarKey(pair.key)
      if (key != null) {
        if (seen.has(key)) return key
        seen.add(key)
      }
      const nested = findDuplicateYamlKey(pair.value)
      if (nested != null) return nested
    }
    return null
  }
  if (hasItems(node)) {
    for (const child of node.items) {
      const nested = findDuplicateYamlKey(child)
      if (nested != null) return nested
    }
  }
  return null
}
