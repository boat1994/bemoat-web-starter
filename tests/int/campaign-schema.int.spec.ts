import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'
import yaml from 'yaml'

import { parseMissionControlState, renderMissionControlState } from '../../scripts/mission-control-state.mjs'
import { sameCampaignValue } from '../../scripts/mission-control/domain/campaign-equality.mjs'
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

function loadExactCampaignFixture(overrides: Record<string, unknown> = {}) {
  const raw = readFixtureText('issue-215-campaign-fixture.exact.yaml')
  const parsed = yaml.parse(raw) as Record<string, unknown>
  return {
    ...parsed,
    updated_at: '2026-08-02T05:30:00.000Z',
    ...overrides,
  }
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
    expect(actual).toHaveLength(35)
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
