import { describe, expect, it } from 'vitest'

import {
  CAMPAIGN_LIFECYCLES,
  FACADE_DISPOSITIONS,
  MIGRATION_STATUSES,
  ROOT_SCRIPT_MAP_VALIDATION_STATUSES,
  SLICE_STATUSES,
} from '../../scripts/mission-control/domain/campaign-enums.ts'
import * as normalize from '../../scripts/mission-control/domain/campaign-normalize.ts'

const validSha = 'ABCDEF0123456789ABCDEF0123456789ABCDEF01'

describe('campaign normalization characterization', () => {
  it('preserves the complete runtime export surface', () => {
    expect(Object.keys(normalize).sort()).toEqual([
      'normalizeCampaignLifecycle',
      'normalizeFacadeDisposition',
      'normalizeMigrationStatus',
      'normalizeNullableCommitSha',
      'normalizeNullableIssueRef',
      'normalizeNullablePrRef',
      'normalizeRootScriptMapValidationStatus',
      'normalizeSliceStatus',
      'normalizeStringIdList',
    ])
  })

  it.each([
    ['normalizeNullableIssueRef', normalize.normalizeNullableIssueRef],
    ['normalizeNullablePrRef', normalize.normalizeNullablePrRef],
    ['normalizeNullableCommitSha', normalize.normalizeNullableCommitSha],
  ])('maps nullish and empty values to null for %s', (_name, fn) => {
    expect(fn(null)).toEqual({ ok: true, value: null })
    expect(fn(undefined)).toEqual({ ok: true, value: null })
    expect(fn('')).toEqual({ ok: true, value: null })
  })

  it('preserves issue and PR trimming, numeric acceptance, and canonical # output', () => {
    expect(normalize.normalizeNullableIssueRef('  #12  ')).toEqual({ ok: true, value: '#12' })
    expect(normalize.normalizeNullableIssueRef(' 12 ')).toEqual({ ok: true, value: '#12' })
    expect(normalize.normalizeNullablePrRef('  #34  ')).toEqual({ ok: true, value: '#34' })
    expect(normalize.normalizeNullablePrRef(' 34 ')).toEqual({ ok: true, value: '#34' })
    expect(normalize.normalizeNullableIssueRef('#0')).toEqual({ ok: true, value: '#0' })
    expect(normalize.normalizeNullablePrRef('0')).toEqual({ ok: true, value: '#0' })
  })

  it('preserves invalid reference types, regex rejection, and reason strings', () => {
    expect(normalize.normalizeNullableIssueRef(12)).toEqual({ ok: false, reason: 'issue ref must be a string or null' })
    expect(normalize.normalizeNullablePrRef({})).toEqual({ ok: false, reason: 'pr ref must be a string or null' })
    expect(normalize.normalizeNullableIssueRef('issue-12')).toEqual({ ok: false, reason: 'issue ref must be "#N" or null' })
    expect(normalize.normalizeNullablePrRef('#')).toEqual({ ok: false, reason: 'pr ref must be "#N" or null' })
  })

  it('preserves full SHA trimming, lowercasing, and exact-length rejection', () => {
    expect(normalize.normalizeNullableCommitSha(`  ${validSha}  `)).toEqual({ ok: true, value: validSha.toLowerCase() })
    expect(normalize.normalizeNullableCommitSha('a'.repeat(39))).toEqual({
      ok: false,
      reason: 'commit sha must be null or an exact full commit SHA',
    })
    expect(normalize.normalizeNullableCommitSha('not-a-sha')).toEqual({
      ok: false,
      reason: 'commit sha must be null or an exact full commit SHA',
    })
  })

  it.each([
    ['normalizeCampaignLifecycle', CAMPAIGN_LIFECYCLES, normalize.normalizeCampaignLifecycle, 'campaign_lifecycle must be PLANNING, ACTIVE, BLOCKED, or COMPLETE'],
    ['normalizeSliceStatus', SLICE_STATUSES, normalize.normalizeSliceStatus, 'slice status is invalid'],
    ['normalizeFacadeDisposition', FACADE_DISPOSITIONS, normalize.normalizeFacadeDisposition, 'facade_disposition is invalid'],
    ['normalizeMigrationStatus', MIGRATION_STATUSES, normalize.normalizeMigrationStatus, 'migration_status is invalid'],
    ['normalizeRootScriptMapValidationStatus', ROOT_SCRIPT_MAP_VALIDATION_STATUSES, normalize.normalizeRootScriptMapValidationStatus, 'root_script_map.validation_status must be PENDING_IMPLEMENTATION, PENDING_EXPANDED_IMPLEMENTATION, VALID, or INVALID'],
  ])('uses exact Set membership and failure reason for %s', (_name, values, fn, reason) => {
    for (const value of values) expect(fn(value)).toEqual({ ok: true, value })
    expect(fn('not-a-member')).toEqual({ ok: false, reason })
    expect(fn(null)).toEqual({ ok: false, reason })
  })

  it('rejects non-arrays and empty entries while cloning valid arrays without mutation', () => {
    expect(normalize.normalizeStringIdList(null, 'ids')).toEqual({ ok: false, reason: 'ids must be an array' })
    expect(normalize.normalizeStringIdList([''], 'ids')).toEqual({
      ok: false,
      reason: 'ids entries must be non-empty strings',
    })
    expect(normalize.normalizeStringIdList(['ok', 2], 'ids')).toEqual({
      ok: false,
      reason: 'ids entries must be non-empty strings',
    })

    const input = Object.freeze(['first', 'second'])
    const result = normalize.normalizeStringIdList(input, 'ids')
    expect(result).toEqual({ ok: true, value: ['first', 'second'] })
    if (result.ok) {
      expect(result.value).not.toBe(input)
      result.value.push('third')
      expect(input).toEqual(['first', 'second'])
    }
  })
})
