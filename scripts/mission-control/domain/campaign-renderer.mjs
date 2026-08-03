/**
 * Pure campaign renderer and body replacement helpers.
 * No GitHub, filesystem, process, or command execution.
 */

import yaml from 'yaml'

import { CAMPAIGN_MARKER_END, CAMPAIGN_MARKER_START } from './campaign-enums.mjs'
import { sortedSliceKeys } from './campaign-authority.mjs'
import { sameCampaignValue } from './campaign-equality.mjs'
import { parseCampaign } from './campaign-parser.mjs'

const CAMPAIGN_BLOCK_RE =
  /<!--\s*bemoat-mission-control-campaign:start\s*-->[\s\S]*?<!--\s*bemoat-mission-control-campaign:end\s*-->/

/**
 * Deterministically render a campaign block. Known keys first; slices in numeric order.
 * @param {Record<string, unknown>} campaign
 * @returns {string}
 */
export function renderCampaign(campaign) {
  const orderedKeys = [
    'schema_version',
    'campaign_issue',
    'campaign_lifecycle',
    'approved_base',
    'campaign_expansion_authority',
    'architecture_authority',
    'slices',
    'root_script_map',
    'campaign_blockers',
    'next_permitted_action',
    'updated_at',
    'updated_by',
  ]

  const ordered = {}
  for (const key of orderedKeys) {
    if (!Object.hasOwn(campaign, key)) continue
    if (key === 'slices' && campaign.slices && typeof campaign.slices === 'object') {
      const orderedSlices = {}
      for (const sliceKey of sortedSliceKeys(campaign.slices)) {
        if (Object.hasOwn(campaign.slices, sliceKey)) {
          orderedSlices[sliceKey] = campaign.slices[sliceKey]
        }
      }
      for (const extraKey of Object.keys(campaign.slices)) {
        if (!Object.hasOwn(orderedSlices, extraKey)) {
          orderedSlices[extraKey] = campaign.slices[extraKey]
        }
      }
      ordered.slices = orderedSlices
      continue
    }
    ordered[key] = campaign[key]
  }

  for (const key of Object.keys(campaign)) {
    if (!Object.hasOwn(ordered, key)) ordered[key] = campaign[key]
  }

  const yamlStr = yaml.stringify(ordered, { lineWidth: 0 })
  return [
    CAMPAIGN_MARKER_START,
    '```yaml',
    yamlStr.trim(),
    '```',
    CAMPAIGN_MARKER_END,
  ].join('\n')
}

/**
 * Replace an existing campaign block, or append one when absent.
 * Touches only campaign-marker bytes (or appends). Task/unrelated bytes stay intact.
 * @param {string} body
 * @param {Record<string, unknown>} campaign
 * @returns {{ body: string, replaced: boolean, appended: boolean, unchanged: boolean }}
 */
export function replaceCampaignBlock(body, campaign, options = {}) {
  const nextBlock = renderCampaign(campaign)
  const text = String(body ?? '')
  const existing = parseCampaign(text, options)

  if (existing.present && !existing.valid) {
    throw new Error(`cannot replace invalid campaign block: ${existing.reason ?? 'invalid'}`)
  }

  if (!CAMPAIGN_BLOCK_RE.test(text)) {
    const separator = text.length === 0 || text.endsWith('\n') ? '\n' : '\n\n'
    const appended = `${text}${separator}${nextBlock}\n`
    return { body: appended, replaced: false, appended: true, unchanged: false }
  }

  // Reset lastIndex because the regex is stateful with /g-like behavior via test().
  CAMPAIGN_BLOCK_RE.lastIndex = 0
  const currentBlock = text.match(CAMPAIGN_BLOCK_RE)?.[0] ?? null
  if (currentBlock === nextBlock) {
    return { body: text, replaced: false, appended: false, unchanged: true }
  }

  if (existing.valid && sameCampaignValue(existing.campaign, campaign)) {
    // Semantic no-op even if whitespace differs: keep prior bytes for idempotency.
    return { body: text, replaced: false, appended: false, unchanged: true }
  }

  const nextBody = text.replace(CAMPAIGN_BLOCK_RE, nextBlock)
  return { body: nextBody, replaced: true, appended: false, unchanged: false }
}
