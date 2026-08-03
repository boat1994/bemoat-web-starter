import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'
import yaml from 'yaml'

import { parseMissionControlState, renderMissionControlState } from '../../scripts/mission-control-state.mjs'
import { sameCampaignValue } from '../../scripts/mission-control/domain/campaign-equality.mjs'
import {
  selectNextCampaignAction,
  validateCampaignTransition,
} from '../../scripts/mission-control/domain/campaign-authority.mjs'
import { parseCampaign } from '../../scripts/mission-control/domain/campaign-parser.mjs'
import { renderCampaign, replaceCampaignBlock } from '../../scripts/mission-control/domain/campaign-renderer.mjs'
import { validateCampaign } from '../../scripts/mission-control/domain/campaign-validator.mjs'
import { projectCampaign } from '../../scripts/mission-control/workflows/campaign-projection.mjs'

const fixtureRoot = 'tests/fixtures/mission-control/campaign'

function readFixture(name: string) {
  return readFileSync(join(fixtureRoot, name))
}

function readFixtureText(name: string) {
  return readFixture(name).toString('utf8')
}

function sha256(buffer: Buffer | string) {
  return createHash('sha256').update(buffer).digest('hex')
}

function listRootScripts() {
  return readdirSync('scripts')
    .filter((entry) => {
      const absolute = join('scripts', entry)
      return statSync(absolute).isFile() && /\.(mjs|sh)$/.test(entry)
    })
    .map((entry) => `scripts/${entry}`)
    .sort()
}

function loadExactCampaignFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const raw = readFixtureText('issue-215-campaign-fixture.exact.yaml')
  const parsed = yaml.parse(raw) as Record<string, unknown>
  return {
    ...parsed,
    updated_at: '2026-08-02T05:30:00.000Z',
    ...overrides,
  }
}

function loadExpandedCampaignFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const raw = readFixtureText('issue-215-campaign-expanded-fixture.exact.yaml')
  const parsed = yaml.parse(raw) as Record<string, unknown>
  return {
    ...parsed,
    updated_at: '2026-08-03T04:18:59.703Z',
    ...overrides,
  }
}

function campaignAuthorityEvidence(overrides: Record<string, unknown> = {}) {
  const issueUrl = 'https://api.github.com/repos/boat1994/bemoat-web-starter/issues/215'
  return {
    campaignExpansionAuthority: {
      comments: [
        {
          id: '5158200377',
          body: readFixtureText('issue-215-expansion-authority.exact.md').replace(/\n$/, ''),
          issue_url: issueUrl,
          user: { login: 'boat1994' },
        },
        {
          id: '5158205807',
          body: '## FOUNDER_DIRECTIVE — scripts root architecture invariant',
          issue_url: issueUrl,
          user: { login: 'boat1994' },
        },
        {
          id: '5158212142',
          body: '## FOUNDER_ARCHITECTURE_DIRECTIVE',
          issue_url: issueUrl,
          user: { login: 'boat1994' },
        },
      ],
      trustedFounderLogins: ['boat1994'],
      currentProtectedBaseSha: 'd6e99c350f8d92e536fe97f81bd6507f6cdaa686',
      ...overrides,
    },
  }
}

function wrapCampaignYaml(raw: string) {
  return [
    '<!-- bemoat-mission-control-campaign:start -->',
    '```yaml',
    raw.trim(),
    '```',
    '<!-- bemoat-mission-control-campaign:end -->',
  ].join('\n')
}

const issue254BlockerId = 'issue-254-planning-correction-1'

function withIssue254Blocker(campaign: Record<string, unknown>): Record<string, unknown> {
  const next = structuredClone(campaign) as Record<string, unknown>
  next.campaign_blockers = [{
    id: issue254BlockerId,
    summary: 'Issue #254 must complete before the blocked campaign action can proceed.',
    evidence: { issue: '#254', pr: '#258', comment_ids: [] },
    resolution_scope: 'Founder-authorized bounded completion recovery for Issue #254.',
  }]
  const slices = next.slices as Record<string, Record<string, unknown>>
  for (const slice of Object.values(slices)) slice.blocker_ids = []
  slices['5'].blocker_ids = [issue254BlockerId]
  return next
}

describe('campaign schema characterization (Issue #243)', () => {
  it('captures exact Issue #215 body and task schema v1 block as byte fixtures', () => {
    const body = readFixture('issue-215-body.exact.txt')
    const taskBlock = readFixture('issue-215-task-schema-v1.exact.txt')

    expect(sha256(body)).toBe('51f61e15b7b0d3cd69fde5dcc3cf4e95bd6c61ae8572449e9cae752807e0d493')
    expect(sha256(taskBlock)).toBe('ceb4969293d9b46995cdcec8ce67762da1452706e6c90708c28ce771c4f7cfa8')
    expect(body.includes(taskBlock)).toBe(true)
    expect(body.toString('utf8')).not.toContain('bemoat-mission-control-campaign')
  })

  it('proves existing task parsing, rendering, and replacement remain unchanged on Issue #215 bytes', () => {
    const body = readFixtureText('issue-215-body.exact.txt')
    const taskBlock = readFixtureText('issue-215-task-schema-v1.exact.txt')

    const parsed = parseMissionControlState(body)
    expect(parsed.present).toBe(true)
    expect(parsed.valid).toBe(true)
    expect(parsed.state?.state).toBe('DONE')
    expect(parsed.state?.merged_commit_sha).toBe('5d04124cb135ffc66642dc4a168c58062af384ed')

    const rendered = renderMissionControlState(parsed.state as Record<string, unknown>)
    const reparsed = parseMissionControlState(rendered)
    expect(reparsed.valid).toBe(true)
    expect(reparsed.state).toEqual(parsed.state)

    // Replacement of an identical semantic state must preserve surrounding Issue body bytes
    // outside the task marker span; the live fixture block itself remains extractable.
    const pattern =
      /<!--\s*bemoat-mission-control-state:start\s*-->[\s\S]*?<!--\s*bemoat-mission-control-state:end\s*-->/
    const replaced = body.replace(pattern, rendered)
    const after = parseMissionControlState(replaced)
    expect(after.valid).toBe(true)
    expect(after.state).toEqual(parsed.state)
    expect(replaced.includes('bemoat-mission-control-campaign')).toBe(false)

    // Exact fixture task block still matches the live Issue capture bytes.
    expect(sha256(taskBlock)).toBe('ceb4969293d9b46995cdcec8ce67762da1452706e6c90708c28ce771c4f7cfa8')
  })

  it('inventories every root scripts/*.mjs and scripts/*.sh file exactly once', () => {
    const inventory = JSON.parse(readFixtureText('root-scripts-inventory.exact.json')) as string[]
    const actual = listRootScripts()
    expect(actual).toEqual(inventory)
    expect(new Set(actual).size).toBe(actual.length)
    expect(actual).toHaveLength(36)
  })

  it.each([
    'malformed-duplicate-campaign.txt',
    'malformed-nested-campaign.txt',
    'malformed-reversed-campaign.txt',
    'malformed-partial-start.txt',
    'malformed-partial-end.txt',
    'malformed-mixed-markers.txt',
    'malformed-crossed-markers.txt',
  ])('fails closed on malformed campaign marker fixture %s', (name) => {
    const body = readFixtureText(name)
    const parsed = parseCampaign(body)
    expect(parsed.present).toBe(true)
    expect(parsed.valid).toBe(false)
    expect(parsed.campaign).toBeNull()
  })
})

describe('campaign schema v1 domain', () => {
  it('parses, validates, and deterministically renders the exact Issue #215 campaign fixture', () => {
    const campaign = loadExactCampaignFixture()
    const validated = validateCampaign(campaign, {
      evidence: {
        approvedBaseMergedCommits: {
          '5d04124cb135ffc66642dc4a168c58062af384ed': true,
        },
      },
    })
    expect(validated.valid).toBe(true)
    expect(validated.campaign?.campaign_lifecycle).toBe('BLOCKED')
    const slices = validated.campaign?.slices as Record<string, { status?: string; blocker_ids?: string[] }>
    expect(slices['1']?.status).toBe('DONE')
    expect(slices['2']?.blocker_ids).toEqual(['pr-241-merge-transport-contradiction'])

    const rendered = renderCampaign(validated.campaign as Record<string, unknown>)
    const wrapped = `${rendered}\n`
    const reparsed = parseCampaign(wrapped, {
      evidence: {
        approvedBaseMergedCommits: {
          '5d04124cb135ffc66642dc4a168c58062af384ed': true,
        },
      },
    })
    expect(reparsed.valid).toBe(true)
    expect(sameCampaignValue(reparsed.campaign, validated.campaign)).toBe(true)

    const again = renderCampaign(reparsed.campaign as Record<string, unknown>)
    expect(again).toBe(rendered)
  })

  it('classifies unknown schema versions as STATE_MIGRATION_REQUIRED', () => {
    const campaign = loadExactCampaignFixture({ schema_version: 99 })
    const validated = validateCampaign(campaign)
    expect(validated.valid).toBe(false)
    expect(validated.classification).toBe('STATE_MIGRATION_REQUIRED')
  })

  it('rejects a legacy campaign that shrinks below the exact seven-slice contract', () => {
    const campaign = loadExactCampaignFixture()
    delete (campaign.slices as Record<string, unknown>)['7']

    expect(validateCampaign(campaign)).toMatchObject({
      valid: false,
      code: 'CAMPAIGN_SLICE_RANGE_SHRINK',
      classification: 'STATE_CONFLICT',
    })
  })

  it('fails closed on stale or contradictory evidence', () => {
    const campaign = loadExactCampaignFixture()
    expect(validateCampaign(campaign, { evidence: { stale: true } }).classification).toBe('STATE_CONFLICT')
    expect(validateCampaign(campaign, { evidence: { contradictory: true } }).classification).toBe(
      'STATE_CONFLICT',
    )
    expect(validateCampaign(campaign, { evidence: { unavailable: true } }).classification).toBe(
      'BLOCKED_EXTERNAL',
    )
    expect(
      validateCampaign(campaign, {
        evidence: { approvedBaseMergedCommits: {} },
      }).classification,
    ).toBe('STATE_CONFLICT')
  })

  it('never falls back to task markers for campaign parsing', () => {
    const body = readFixtureText('issue-215-body.exact.txt')
    const parsed = parseCampaign(body)
    expect(parsed.present).toBe(false)
    expect(parsed.valid).toBe(false)
    expect(parsed.campaign).toBeNull()
  })
})

describe('campaign projection workflow boundary', () => {
  it('supports render-only and dry-run evidence without writing live Issue #215', () => {
    const body = readFixtureText('issue-215-body.exact.txt')
    const taskBefore = readFixtureText('issue-215-task-schema-v1.exact.txt')
    const campaign = loadExactCampaignFixture()
    const evidence = {
      approvedBaseMergedCommits: {
        '5d04124cb135ffc66642dc4a168c58062af384ed': true,
      },
    }

    const renderOnly = projectCampaign({ body, campaign, mode: 'render-only', evidence })
    expect(renderOnly.ok).toBe(true)
    expect(renderOnly.wrote).toBe(false)
    expect(renderOnly.rendered).toContain('bemoat-mission-control-campaign:start')

    const dryRun = projectCampaign({ body, campaign, mode: 'dry-run', evidence })
    expect(dryRun.ok).toBe(true)
    expect(dryRun.wrote).toBe(false)
    expect(dryRun.appended).toBe(true)

    const projectedBody = String(dryRun.body)
    const taskAfter = projectedBody.match(
      /<!--\s*bemoat-mission-control-state:start\s*-->[\s\S]*?<!--\s*bemoat-mission-control-state:end\s*-->/,
    )?.[0]
    expect(taskAfter).toBe(taskBefore)
    expect(sha256(taskAfter ?? '')).toBe('ceb4969293d9b46995cdcec8ce67762da1452706e6c90708c28ce771c4f7cfa8')

    // Unrelated Issue-body prefix bytes remain byte-for-byte unchanged.
    const prefix = body.slice(0, body.indexOf('<!-- bemoat-mission-control-state:start -->'))
    expect(projectedBody.startsWith(prefix)).toBe(true)

    const noop = replaceCampaignBlock(projectedBody, dryRun.campaign as Record<string, unknown>)
    expect(noop.unchanged).toBe(true)
    expect(noop.body).toBe(projectedBody)
  })

  it('keeps task schema v1 bytes identical across campaign append and idempotent no-op', () => {
    const body = readFixtureText('issue-215-body.exact.txt')
    const campaign = loadExactCampaignFixture()
    const evidence = {
      approvedBaseMergedCommits: {
        '5d04124cb135ffc66642dc4a168c58062af384ed': true,
      },
    }

    const first = projectCampaign({ body, campaign, mode: 'dry-run', evidence })
    expect(first.ok).toBe(true)
    const second = projectCampaign({
      body: String(first.body),
      campaign: first.campaign as Record<string, unknown>,
      mode: 'dry-run',
      evidence,
    })
    expect(second.ok).toBe(true)
    expect(second.unchanged).toBe(true)
    expect(second.body).toBe(first.body)

    const task = String(second.body).match(
      /<!--\s*bemoat-mission-control-state:start\s*-->[\s\S]*?<!--\s*bemoat-mission-control-state:end\s*-->/,
    )?.[0]
    expect(sha256(task ?? '')).toBe('ceb4969293d9b46995cdcec8ce67762da1452706e6c90708c28ce771c4f7cfa8')
  })
})

describe('authority-backed campaign schema expansion (Issue #254)', () => {
  it('parses and renders the exact eleven-slice fixture only with verified authority evidence', () => {
    const campaign = loadExpandedCampaignFixture()
    const evidence = campaignAuthorityEvidence()

    const unavailable = parseCampaign(`${renderCampaign(campaign)}\n`)
    expect(unavailable).toMatchObject({
      present: true,
      valid: false,
      classification: 'BLOCKED_EXTERNAL',
      code: 'CAMPAIGN_AUTHORITY_UNAVAILABLE',
      campaign: null,
    })

    const validated = validateCampaign(campaign, { evidence })
    expect(validated).toMatchObject({ valid: true })
    expect(Object.keys(validated.campaign?.slices ?? {})).toEqual(
      Array.from({ length: 11 }, (_, index) => String(index + 1)),
    )
    expect(validated.campaign?.root_script_map).toMatchObject({
      validation_status: 'PENDING_EXPANDED_IMPLEMENTATION',
    })

    const rendered = renderCampaign(validated.campaign as Record<string, unknown>)
    const reparsed = parseCampaign(`${rendered}\n`, { evidence })
    expect(reparsed.valid).toBe(true)
    expect(sameCampaignValue(reparsed.campaign, validated.campaign)).toBe(true)
    expect(renderCampaign(reparsed.campaign as Record<string, unknown>)).toBe(rendered)
  })

  it.each([
    ['unauthorized extra slice', () => {
      const legacy = loadExactCampaignFixture()
      const expanded = loadExpandedCampaignFixture()
      return {
        ...legacy,
        slices: {
          ...(legacy.slices as Record<string, unknown>),
          '8': structuredClone((expanded.slices as Record<string, unknown>)['8']),
        },
      }
    }, undefined, 'CAMPAIGN_SLICE_RANGE_UNAUTHORIZED'],
    ['gap in expanded range', () => {
      const campaign = loadExpandedCampaignFixture()
      const slices = structuredClone(campaign.slices) as Record<string, unknown>
      delete slices['8']
      return { ...campaign, slices }
    }, campaignAuthorityEvidence(), 'CAMPAIGN_SLICE_KEYS_NOT_CONTIGUOUS'],
    ['malformed authority lineage', () => {
      const campaign = loadExpandedCampaignFixture()
      return {
        ...campaign,
        campaign_expansion_authority: {
          ...(campaign.campaign_expansion_authority as Record<string, unknown>),
          source: {
            ...((campaign.campaign_expansion_authority as Record<string, unknown>).source as Record<string, unknown>),
            comment_id: 'not-a-comment-id',
          },
        },
      }
    }, campaignAuthorityEvidence(), 'CAMPAIGN_AUTHORITY_INVALID'],
    ['unknown root status', () => {
      const campaign = loadExpandedCampaignFixture()
      return {
        ...campaign,
        root_script_map: { ...(campaign.root_script_map as Record<string, unknown>), validation_status: 'UNKNOWN' },
      }
    }, campaignAuthorityEvidence(), 'CAMPAIGN_ROOT_SCRIPT_MAP_STATUS_INVALID'],
    ['range beyond the authority maximum', () => {
      const campaign = loadExpandedCampaignFixture()
      const slices = structuredClone(campaign.slices) as Record<string, unknown>
      slices['12'] = structuredClone(slices['11'])
      return { ...campaign, slices }
    }, campaignAuthorityEvidence(), 'CAMPAIGN_SLICE_RANGE_UNAUTHORIZED'],
  ])('fails closed on %s', (_label, buildCampaign, evidence, code) => {
    const result = validateCampaign(buildCampaign(), evidence ? { evidence } : undefined)
    expect(result).toMatchObject({ valid: false, code, classification: 'STATE_CONFLICT' })
  })

  it('detects duplicate slice keys before YAML object normalization', () => {
    const campaign = loadExpandedCampaignFixture()
    const raw = yaml.stringify(campaign)
    const duplicate = raw.replace(
      '  "9":',
      '  8:\n    status: NOT_STARTED\n    issue: null\n    pr: null\n    reviewed_head: null\n    merged_commit: null\n    authority_comment_ids: []\n    blocker_ids: []\n  "9":',
    )

    const result = parseCampaign(wrapCampaignYaml(duplicate), { evidence: campaignAuthorityEvidence() })
    expect(result).toMatchObject({
      valid: false,
      code: 'CAMPAIGN_YAML_DUPLICATE_KEY',
      classification: 'STATE_CONFLICT',
      campaign: null,
    })
  })

  it('accepts only authority-backed append transitions and rejects shrinkage, renumbering, and completed mutation', () => {
    const expanded = loadExpandedCampaignFixture()
    const prior = structuredClone(expanded) as Record<string, unknown>
    delete prior.campaign_expansion_authority
    for (const key of ['8', '9', '10', '11']) delete (prior.slices as Record<string, unknown>)[key]
    const priorRootScriptMap = prior.root_script_map as Record<string, unknown>
    priorRootScriptMap.validation_status = 'PENDING_IMPLEMENTATION'
    const evidence = campaignAuthorityEvidence()

    expect(validateCampaignTransition(prior, expanded, { mode: 'append', evidence })).toMatchObject({ valid: true })

    expect(validateCampaignTransition(expanded, prior, { mode: 'lifecycle', targetSlice: '7', evidence })).toMatchObject({
      valid: false,
      code: 'CAMPAIGN_SLICE_RANGE_SHRINK',
      classification: 'STATE_CONFLICT',
    })

    const renumbered = structuredClone(expanded) as Record<string, unknown>
    const renumberedSlices = renumbered.slices as Record<string, unknown>
    delete renumberedSlices['7']
    renumberedSlices['12'] = structuredClone(renumberedSlices['11'])
    expect(validateCampaignTransition(expanded, renumbered, { mode: 'lifecycle', targetSlice: '7', evidence })).toMatchObject({
      valid: false,
      code: 'CAMPAIGN_SLICE_RANGE_RENUMBERED',
      classification: 'STATE_CONFLICT',
    })

    const completedMutation = structuredClone(expanded) as Record<string, unknown>
    const completedSlice = (completedMutation.slices as Record<string, Record<string, unknown>>)['1']
    completedSlice.authority_comment_ids = []
    expect(validateCampaignTransition(expanded, completedMutation, { mode: 'lifecycle', targetSlice: '1', evidence })).toMatchObject({
      valid: false,
      code: 'CAMPAIGN_COMPLETED_SLICE_MUTATION',
      classification: 'STATE_CONFLICT',
    })

    const invalidNewRow = structuredClone(expanded) as Record<string, unknown>
    const invalidNewRowSlices = invalidNewRow.slices as Record<string, Record<string, unknown>>
    invalidNewRowSlices['8'].issue = '#999'
    expect(validateCampaignTransition(prior, invalidNewRow, { mode: 'append', evidence })).toMatchObject({
      valid: false,
      code: 'CAMPAIGN_EXPANSION_ROW_INVALID',
      classification: 'STATE_CONFLICT',
    })
  })

  it('rejects stale authority evidence and selects the first future slice without starting it', () => {
    const campaign = loadExpandedCampaignFixture()
    const staleEvidence = campaignAuthorityEvidence({
      comments: [
        {
          id: '5158200377',
          body: 'edited authority',
          issue_url: 'https://api.github.com/repos/boat1994/bemoat-web-starter/issues/215',
          user: { login: 'boat1994' },
        },
      ],
    })
    expect(validateCampaign(campaign, { evidence: staleEvidence })).toMatchObject({
      valid: false,
      code: 'CAMPAIGN_AUTHORITY_STALE',
      classification: 'STATE_CONFLICT',
    })

    expect(validateCampaign(campaign, {
      evidence: campaignAuthorityEvidence({ contradictory: true }),
    })).toMatchObject({
      valid: false,
      code: 'CAMPAIGN_AUTHORITY_INVALID',
      classification: 'STATE_CONFLICT',
    })

    expect(selectNextCampaignAction(campaign)).toMatchObject({ slice: '5', started: false })
  })

  it('validates append and lifecycle transitions before campaign projection rendering', () => {
    const expanded = loadExpandedCampaignFixture()
    const prior = structuredClone(expanded) as Record<string, unknown>
    delete prior.campaign_expansion_authority
    for (const key of ['8', '9', '10', '11']) delete (prior.slices as Record<string, unknown>)[key]
    const priorRootScriptMap = prior.root_script_map as Record<string, unknown>
    priorRootScriptMap.validation_status = 'PENDING_IMPLEMENTATION'
    const evidence = campaignAuthorityEvidence()

    const appended = projectCampaign({
      body: `${renderCampaign(prior)}\n`,
      campaign: expanded,
      mode: 'dry-run',
      evidence,
      transition: { mode: 'append' },
    })
    expect(appended).toMatchObject({ ok: true, replaced: true })

    const shrunk = projectCampaign({
      body: `${renderCampaign(expanded)}\n`,
      campaign: prior,
      mode: 'dry-run',
      evidence,
      transition: { mode: 'lifecycle', targetSlice: '7' },
    })
    expect(shrunk).toMatchObject({
      ok: false,
      code: 'CAMPAIGN_SLICE_RANGE_SHRINK',
      classification: 'STATE_CONFLICT',
    })
  })

  it('removes exactly the bound blocker while appending only authorized NOT_STARTED rows', () => {
    const expanded = withIssue254Blocker(loadExpandedCampaignFixture())
    const prior = structuredClone(expanded) as Record<string, unknown>
    delete prior.campaign_expansion_authority
    for (const key of ['8', '9', '10', '11']) delete (prior.slices as Record<string, unknown>)[key]
    const priorRootScriptMap = prior.root_script_map as Record<string, unknown>
    priorRootScriptMap.validation_status = 'PENDING_IMPLEMENTATION'
    const resolved = structuredClone(expanded) as Record<string, unknown>
    resolved.campaign_blockers = []
    ;(resolved.slices as Record<string, Record<string, unknown>>)['5'].blocker_ids = []
    const evidence = campaignAuthorityEvidence()

    const transition = validateCampaignTransition(prior, resolved, {
      mode: 'blocker-resolution',
      blockerId: issue254BlockerId,
      evidence,
    })

    expect(transition).toMatchObject({ valid: true })
    expect(Object.keys(resolved.slices as Record<string, unknown>)).toEqual(
      Array.from({ length: 11 }, (_, index) => String(index + 1)),
    )
    expect((resolved.slices as Record<string, Record<string, unknown>>)['5']).toMatchObject({
      status: 'NOT_STARTED',
      issue: null,
      pr: null,
      reviewed_head: null,
      merged_commit: null,
      authority_comment_ids: [],
      blocker_ids: [],
    })
    expect(validateCampaign(resolved, { evidence })).toMatchObject({ valid: true })
  })

  it('rejects blocker-resolution slice status mutation even when the bound blocker is removed', () => {
    const expanded = withIssue254Blocker(loadExpandedCampaignFixture())
    const prior = structuredClone(expanded) as Record<string, unknown>
    delete prior.campaign_expansion_authority
    for (const key of ['8', '9', '10', '11']) delete (prior.slices as Record<string, unknown>)[key]
    const priorRootScriptMap = prior.root_script_map as Record<string, unknown>
    priorRootScriptMap.validation_status = 'PENDING_IMPLEMENTATION'
    const resolved = structuredClone(expanded) as Record<string, unknown>
    resolved.campaign_blockers = []
    const resolvedSlices = resolved.slices as Record<string, Record<string, unknown>>
    resolvedSlices['5'].blocker_ids = []
    resolvedSlices['5'].status = 'PLANNING'

    expect(validateCampaignTransition(prior, resolved, {
      mode: 'blocker-resolution',
      blockerId: issue254BlockerId,
      evidence: campaignAuthorityEvidence(),
    })).toMatchObject({
      valid: false,
      code: 'CAMPAIGN_BLOCKER_RESOLUTION_SLICE_STATUS_MUTATION',
      classification: 'STATE_CONFLICT',
    })
  })

  it('keeps blocker-resolution campaign projection render-only and selects Slice 5 without starting it', () => {
    const expanded = withIssue254Blocker(loadExpandedCampaignFixture())
    const prior = structuredClone(expanded) as Record<string, unknown>
    delete prior.campaign_expansion_authority
    for (const key of ['8', '9', '10', '11']) delete (prior.slices as Record<string, unknown>)[key]
    ;(prior.root_script_map as Record<string, unknown>).validation_status = 'PENDING_IMPLEMENTATION'
    const projected = structuredClone(expanded) as Record<string, unknown>
    projected.campaign_blockers = []
    ;(projected.slices as Record<string, Record<string, unknown>>)['5'].blocker_ids = []
    const body = `${renderCampaign(prior)}\n`

    const result = projectCampaign({
      body,
      campaign: projected,
      mode: 'dry-run',
      evidence: campaignAuthorityEvidence(),
      transition: { mode: 'blocker-resolution', blockerId: issue254BlockerId },
    })

    expect(result).toMatchObject({ ok: true, replaced: true, wrote: false })
    expect(selectNextCampaignAction(result.campaign)).toMatchObject({ slice: '5', started: false })
    expect(String(result.body)).toContain('"11"')
  })
})
