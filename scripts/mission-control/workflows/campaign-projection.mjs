/**
 * Bounded campaign projection workflow helper.
 * Reuses generic Issue-body replacement semantics in render-only / dry-run mode.
 * Does not write to GitHub. Callers may later pass rendered bodies to CAS transport.
 */

import { sameCampaignValue } from '../domain/campaign-equality.ts'
import { validateCampaignTransition } from '../domain/campaign-authority.mjs'
import { parseCampaign } from '../domain/campaign-parser.ts'
import { renderCampaign, replaceCampaignBlock } from '../domain/campaign-renderer.mjs'
import { validateCampaign } from '../domain/campaign-validator.ts'

/**
 * @param {{
 *   body: string,
 *   campaign: Record<string, unknown>,
 *   mode?: 'render-only' | 'dry-run',
 *   evidence?: object,
 *   transition?: { mode: 'append' | 'lifecycle' | 'blocker-resolution', targetSlice?: string | number, blockerId?: string },
 * }} input
 */
export function projectCampaign(input) {
  const mode = input.mode ?? 'dry-run'
  if (mode !== 'render-only' && mode !== 'dry-run') {
    return {
      ok: false,
      classification: 'STATE_CONFLICT',
      reason: 'campaign projection mode must be render-only or dry-run',
    }
  }

  const validated = validateCampaign(input.campaign, { evidence: input.evidence })
  if (!validated.valid) {
    return {
      ok: false,
      code: validated.code,
      classification: validated.classification ?? 'STATE_CONFLICT',
      reason: validated.reason,
    }
  }

  if (input.transition) {
    const prior = parseCampaign(input.body, { evidence: input.evidence })
    if (!prior.present || !prior.valid) {
      return {
        ok: false,
        code: prior.code,
        classification: prior.classification ?? 'STATE_CONFLICT',
        reason: prior.reason ?? 'campaign transition requires a valid prior campaign',
      }
    }
    const transition = validateCampaignTransition(prior.campaign, validated.campaign, {
      ...input.transition,
      evidence: input.evidence,
    })
    if (!transition.valid) {
      return {
        ok: false,
        code: transition.code,
        classification: transition.classification ?? 'STATE_CONFLICT',
        reason: transition.reason,
      }
    }
  }

  const rendered = renderCampaign(validated.campaign)
  if (mode === 'render-only') {
    return {
      ok: true,
      mode,
      rendered,
      campaign: validated.campaign,
      wrote: false,
    }
  }

  const priorTask = extractTaskBlock(input.body)
  const replacement = replaceCampaignBlock(input.body, validated.campaign, { evidence: input.evidence })
  const afterTask = extractTaskBlock(replacement.body)
  if (priorTask !== afterTask) {
    return {
      ok: false,
      classification: 'STATE_CONFLICT',
      reason: 'campaign projection mutated task schema v1 bytes',
    }
  }

  const reparsed = parseCampaign(replacement.body, { evidence: input.evidence })
  if (!reparsed.present || !reparsed.valid) {
    return {
      ok: false,
      code: reparsed.code,
      classification: reparsed.classification ?? 'STATE_CONFLICT',
      reason: reparsed.reason ?? 'projected campaign failed reparse',
    }
  }

  if (!sameCampaignValue(validated.campaign, reparsed.campaign)) {
    return {
      ok: false,
      classification: 'STATE_CONFLICT',
      reason: 'projected campaign is not parse-render-parse stable',
    }
  }

  return {
    ok: true,
    mode,
    rendered,
    body: replacement.body,
    campaign: reparsed.campaign,
    replaced: replacement.replaced,
    appended: replacement.appended,
    unchanged: replacement.unchanged,
    wrote: false,
  }
}

function extractTaskBlock(body) {
  const match = String(body ?? '').match(
    /<!--\s*bemoat-mission-control-state:start\s*-->[\s\S]*?<!--\s*bemoat-mission-control-state:end\s*-->/,
  )
  return match ? match[0] : null
}
