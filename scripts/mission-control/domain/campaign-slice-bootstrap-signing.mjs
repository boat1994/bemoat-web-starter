/**
 * Atomic fail-closed signing-identity selection for campaign-slice bootstrap.
 * Never mix campaign key IDs with genesis private keys (or the reverse).
 */

const CAMPAIGN_PRIVATE_KEY = 'BEMOAT_CAMPAIGN_SLICE_BOOTSTRAP_SIGNING_PRIVATE_KEY'
const CAMPAIGN_KEY_ID = 'BEMOAT_CAMPAIGN_SLICE_BOOTSTRAP_SIGNING_KEY_ID'
const LEGACY_PRIVATE_KEY = 'BEMOAT_TASK_BOOTSTRAP_SIGNING_PRIVATE_KEY'
const LEGACY_KEY_ID = 'BEMOAT_TASK_BOOTSTRAP_SIGNING_KEY_ID'

function present(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function blocked(message) {
  const error = new Error(message)
  error.code = 'BLOCKED_EXTERNAL'
  return error
}

/**
 * Resolve one explicit, internally consistent signing identity.
 *
 * Rules:
 * - Campaign pair present as a complete unit → campaign identity
 * - Campaign pair fully absent and legacy pair fully present → explicit legacy fallback
 * - Any partial or mixed combination → fail closed
 */
/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined> | null | undefined} [env]
 */
export function resolveCampaignSliceBootstrapSigningIdentity(env = process.env) {
  const campaignPrivateKey = env?.[CAMPAIGN_PRIVATE_KEY]
  const campaignKeyId = env?.[CAMPAIGN_KEY_ID]
  const legacyPrivateKey = env?.[LEGACY_PRIVATE_KEY]
  const legacyKeyId = env?.[LEGACY_KEY_ID]

  const campaignPrivatePresent = present(campaignPrivateKey)
  const campaignKeyIdPresent = present(campaignKeyId)
  const legacyPrivatePresent = present(legacyPrivateKey)
  const legacyKeyIdPresent = present(legacyKeyId)

  const campaignComplete = campaignPrivatePresent && campaignKeyIdPresent
  const campaignAbsent = !campaignPrivatePresent && !campaignKeyIdPresent
  const legacyComplete = legacyPrivatePresent && legacyKeyIdPresent
  const legacyAbsent = !legacyPrivatePresent && !legacyKeyIdPresent

  if (campaignComplete) {
    if (!legacyAbsent && !legacyComplete) {
      throw blocked(
        'campaign-slice bootstrap signing identity is mixed: campaign pair is complete but legacy pair is partial',
      )
    }
    return {
      source: 'campaign-slice-bootstrap',
      signingPrivateKey: campaignPrivateKey,
      signingKeyId: campaignKeyId,
    }
  }

  if (!campaignAbsent) {
    throw blocked(
      'campaign-slice bootstrap signing identity is incomplete or mixed: campaign private key and key ID must both be set together',
    )
  }

  if (legacyComplete) {
    return {
      source: 'task-bootstrap-legacy',
      signingPrivateKey: legacyPrivateKey,
      signingKeyId: legacyKeyId,
    }
  }

  if (!legacyAbsent) {
    throw blocked(
      'campaign-slice bootstrap signing identity is incomplete: legacy private key and key ID must both be set together when campaign pair is absent',
    )
  }

  throw blocked(
    'campaign-slice bootstrap signing material is unavailable: provide a complete campaign pair or a complete legacy pair',
  )
}

export const CAMPAIGN_SLICE_BOOTSTRAP_SIGNING_ENV = Object.freeze({
  CAMPAIGN_PRIVATE_KEY,
  CAMPAIGN_KEY_ID,
  LEGACY_PRIVATE_KEY,
  LEGACY_KEY_ID,
})
