import { generateKeyPairSync } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  createSignedEnvelope,
  verifySignedEnvelope,
} from '../../scripts/mission-control/domain/task-attestation.mjs'
import {
  CAMPAIGN_SLICE_BOOTSTRAP_SIGNING_ENV,
  resolveCampaignSliceBootstrapSigningIdentity,
} from '../../scripts/mission-control/domain/campaign-slice-bootstrap-signing.mjs'

function keyMaterial() {
  const pair = generateKeyPairSync('ed25519')
  return {
    privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  }
}

function envOf(env: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return env as NodeJS.ProcessEnv
}

function expectBlocked(env: Record<string, string | undefined>) {
  let thrown: unknown
  try {
    resolveCampaignSliceBootstrapSigningIdentity(envOf(env))
  } catch (error) {
    thrown = error
  }
  expect(thrown).toMatchObject({ code: 'BLOCKED_EXTERNAL' })
}

describe('campaign-slice bootstrap signing identity', () => {
  it('selects the complete campaign private-key and key-ID pair', () => {
    const campaign = keyMaterial()
    const result = resolveCampaignSliceBootstrapSigningIdentity(envOf({
      [CAMPAIGN_SLICE_BOOTSTRAP_SIGNING_ENV.CAMPAIGN_PRIVATE_KEY]: campaign.privateKey,
      [CAMPAIGN_SLICE_BOOTSTRAP_SIGNING_ENV.CAMPAIGN_KEY_ID]: 'campaign-key-v1',
    }))

    expect(result).toEqual({
      source: 'campaign-slice-bootstrap',
      signingPrivateKey: campaign.privateKey,
      signingKeyId: 'campaign-key-v1',
    })
  })

  it('selects the complete legacy pair only when the campaign pair is absent', () => {
    const legacy = keyMaterial()
    const result = resolveCampaignSliceBootstrapSigningIdentity(envOf({
      [CAMPAIGN_SLICE_BOOTSTRAP_SIGNING_ENV.LEGACY_PRIVATE_KEY]: legacy.privateKey,
      [CAMPAIGN_SLICE_BOOTSTRAP_SIGNING_ENV.LEGACY_KEY_ID]: 'genesis-key-v1',
    }))

    expect(result).toEqual({
      source: 'task-bootstrap-legacy',
      signingPrivateKey: legacy.privateKey,
      signingKeyId: 'genesis-key-v1',
    })
  })

  it('fails closed when campaign key ID is present without its private key', () => {
    const legacy = keyMaterial()

    expectBlocked({
      [CAMPAIGN_SLICE_BOOTSTRAP_SIGNING_ENV.CAMPAIGN_KEY_ID]: 'campaign-key-v1',
      [CAMPAIGN_SLICE_BOOTSTRAP_SIGNING_ENV.LEGACY_PRIVATE_KEY]: legacy.privateKey,
      [CAMPAIGN_SLICE_BOOTSTRAP_SIGNING_ENV.LEGACY_KEY_ID]: 'genesis-key-v1',
    })
  })

  it.each([
    [
      'campaign private key without campaign key ID',
      (campaign: ReturnType<typeof keyMaterial>, _legacy: ReturnType<typeof keyMaterial>) => ({
        [CAMPAIGN_SLICE_BOOTSTRAP_SIGNING_ENV.CAMPAIGN_PRIVATE_KEY]: campaign.privateKey,
      }),
    ],
    [
      'legacy private key without legacy key ID',
      (_campaign: ReturnType<typeof keyMaterial>, legacy: ReturnType<typeof keyMaterial>) => ({
        [CAMPAIGN_SLICE_BOOTSTRAP_SIGNING_ENV.LEGACY_PRIVATE_KEY]: legacy.privateKey,
      }),
    ],
    [
      'legacy key ID without legacy private key',
      (_campaign: ReturnType<typeof keyMaterial>, _legacy: ReturnType<typeof keyMaterial>) => ({
        [CAMPAIGN_SLICE_BOOTSTRAP_SIGNING_ENV.LEGACY_KEY_ID]: 'genesis-key-v1',
      }),
    ],
    [
      'complete campaign pair with partial legacy pair',
      (campaign: ReturnType<typeof keyMaterial>, legacy: ReturnType<typeof keyMaterial>) => ({
        [CAMPAIGN_SLICE_BOOTSTRAP_SIGNING_ENV.CAMPAIGN_PRIVATE_KEY]: campaign.privateKey,
        [CAMPAIGN_SLICE_BOOTSTRAP_SIGNING_ENV.CAMPAIGN_KEY_ID]: 'campaign-key-v1',
        [CAMPAIGN_SLICE_BOOTSTRAP_SIGNING_ENV.LEGACY_PRIVATE_KEY]: legacy.privateKey,
      }),
    ],
    [
      'empty environment',
      () => ({}),
    ],
  ] as Array<[string, (
    campaign: ReturnType<typeof keyMaterial>,
    legacy: ReturnType<typeof keyMaterial>,
  ) => Record<string, string | undefined>]>)(
    'fails closed for mixed or incomplete signing material (%s)',
    (_label, buildEnv) => {
      const campaign = keyMaterial()
      const legacy = keyMaterial()
      expectBlocked(buildEnv(campaign, legacy))
    },
  )

  it('accepts a complete campaign pair alongside a complete legacy pair without mixing keys', () => {
    const campaign = keyMaterial()
    const legacy = keyMaterial()
    const result = resolveCampaignSliceBootstrapSigningIdentity(envOf({
      [CAMPAIGN_SLICE_BOOTSTRAP_SIGNING_ENV.CAMPAIGN_PRIVATE_KEY]: campaign.privateKey,
      [CAMPAIGN_SLICE_BOOTSTRAP_SIGNING_ENV.CAMPAIGN_KEY_ID]: 'campaign-key-v1',
      [CAMPAIGN_SLICE_BOOTSTRAP_SIGNING_ENV.LEGACY_PRIVATE_KEY]: legacy.privateKey,
      [CAMPAIGN_SLICE_BOOTSTRAP_SIGNING_ENV.LEGACY_KEY_ID]: 'genesis-key-v1',
    }))

    expect(result.source).toBe('campaign-slice-bootstrap')
    expect(result.signingKeyId).toBe('campaign-key-v1')
    expect(result.signingPrivateKey).toBe(campaign.privateKey)
  })

  it('keeps genesis #262/#263 signing env names unchanged', () => {
    const cli = readFileSync('scripts/mission-control-task-create.mjs', 'utf8')
    const workflow = readFileSync('.github/workflows/mission-control-task-bootstrap.yml', 'utf8')
    expect(cli).toContain('BEMOAT_TASK_BOOTSTRAP_SIGNING_PRIVATE_KEY')
    expect(cli).toContain('BEMOAT_TASK_BOOTSTRAP_SIGNING_KEY_ID')
    expect(cli).not.toContain('BEMOAT_CAMPAIGN_SLICE_BOOTSTRAP_SIGNING_PRIVATE_KEY')
    expect(workflow).toContain('BEMOAT_TASK_BOOTSTRAP_SIGNING_PRIVATE_KEY')
    expect(workflow).not.toContain('BEMOAT_CAMPAIGN_SLICE_BOOTSTRAP_SIGNING_PRIVATE_KEY')
  })

  it('requires cryptographic correspondence between selected private key and verification public key', () => {
    const campaign = keyMaterial()
    const other = keyMaterial()
    const identity = resolveCampaignSliceBootstrapSigningIdentity(envOf({
      [CAMPAIGN_SLICE_BOOTSTRAP_SIGNING_ENV.CAMPAIGN_PRIVATE_KEY]: campaign.privateKey,
      [CAMPAIGN_SLICE_BOOTSTRAP_SIGNING_ENV.CAMPAIGN_KEY_ID]: 'campaign-key-v1',
    }))
    const envelope = createSignedEnvelope({
      keyId: identity.signingKeyId,
      privateKey: identity.signingPrivateKey,
      payload: { ping: true, repository: 'boat1994/bemoat-web-starter' },
    })
    expect(verifySignedEnvelope(envelope, {
      publicKey: campaign.publicKey,
      signingKeyId: identity.signingKeyId,
      repository: 'boat1994/bemoat-web-starter',
    }).ok).toBe(true)
    expect(verifySignedEnvelope(envelope, {
      publicKey: other.publicKey,
      signingKeyId: identity.signingKeyId,
      repository: 'boat1994/bemoat-web-starter',
    }).ok).toBe(false)
  })
})
