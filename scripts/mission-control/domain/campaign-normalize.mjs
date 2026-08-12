/**
 * Pure campaign normalization helpers.
 * No GitHub, filesystem, process, or command execution.
 */

import {
  CAMPAIGN_LIFECYCLES,
  FACADE_DISPOSITIONS,
  FULL_COMMIT_SHA,
  MIGRATION_STATUSES,
  ROOT_SCRIPT_MAP_VALIDATION_STATUSES,
  SLICE_STATUSES,
} from './campaign-enums.ts'

/**
 * @param {unknown} value
 * @returns {{ ok: true, value: string | null } | { ok: false, reason: string }}
 */
export function normalizeNullableIssueRef(value) {
  if (value === null || value === undefined || value === '') return { ok: true, value: null }
  if (typeof value !== 'string') return { ok: false, reason: 'issue ref must be a string or null' }
  const trimmed = value.trim()
  if (!/^#\d+$/.test(trimmed) && !/^\d+$/.test(trimmed)) {
    return { ok: false, reason: 'issue ref must be "#N" or null' }
  }
  return { ok: true, value: trimmed.startsWith('#') ? trimmed : `#${trimmed}` }
}

/**
 * @param {unknown} value
 * @returns {{ ok: true, value: string | null } | { ok: false, reason: string }}
 */
export function normalizeNullablePrRef(value) {
  if (value === null || value === undefined || value === '') return { ok: true, value: null }
  if (typeof value !== 'string') return { ok: false, reason: 'pr ref must be a string or null' }
  const trimmed = value.trim()
  if (!/^#\d+$/.test(trimmed) && !/^\d+$/.test(trimmed)) {
    return { ok: false, reason: 'pr ref must be "#N" or null' }
  }
  return { ok: true, value: trimmed.startsWith('#') ? trimmed : `#${trimmed}` }
}

/**
 * @param {unknown} value
 * @returns {{ ok: true, value: string | null } | { ok: false, reason: string }}
 */
export function normalizeNullableCommitSha(value) {
  if (value === null || value === undefined || value === '') return { ok: true, value: null }
  if (typeof value !== 'string' || !FULL_COMMIT_SHA.test(value.trim())) {
    return { ok: false, reason: 'commit sha must be null or an exact full commit SHA' }
  }
  return { ok: true, value: value.trim().toLowerCase() }
}

/**
 * @param {unknown} value
 * @returns {{ ok: true, value: string } | { ok: false, reason: string }}
 */
export function normalizeCampaignLifecycle(value) {
  if (typeof value !== 'string' || !CAMPAIGN_LIFECYCLES.has(value)) {
    return { ok: false, reason: 'campaign_lifecycle must be PLANNING, ACTIVE, BLOCKED, or COMPLETE' }
  }
  return { ok: true, value }
}

/**
 * @param {unknown} value
 * @returns {{ ok: true, value: string } | { ok: false, reason: string }}
 */
export function normalizeSliceStatus(value) {
  if (typeof value !== 'string' || !SLICE_STATUSES.has(value)) {
    return { ok: false, reason: 'slice status is invalid' }
  }
  return { ok: true, value }
}

/**
 * @param {unknown} value
 * @returns {{ ok: true, value: string } | { ok: false, reason: string }}
 */
export function normalizeFacadeDisposition(value) {
  if (typeof value !== 'string' || !FACADE_DISPOSITIONS.has(value)) {
    return { ok: false, reason: 'facade_disposition is invalid' }
  }
  return { ok: true, value }
}

/**
 * @param {unknown} value
 * @returns {{ ok: true, value: string } | { ok: false, reason: string }}
 */
export function normalizeMigrationStatus(value) {
  if (typeof value !== 'string' || !MIGRATION_STATUSES.has(value)) {
    return { ok: false, reason: 'migration_status is invalid' }
  }
  return { ok: true, value }
}

/**
 * @param {unknown} value
 * @returns {{ ok: true, value: string } | { ok: false, reason: string }}
 */
export function normalizeRootScriptMapValidationStatus(value) {
  if (typeof value !== 'string' || !ROOT_SCRIPT_MAP_VALIDATION_STATUSES.has(value)) {
    return {
      ok: false,
      reason: 'root_script_map.validation_status must be PENDING_IMPLEMENTATION, PENDING_EXPANDED_IMPLEMENTATION, VALID, or INVALID',
    }
  }
  return { ok: true, value }
}

/**
 * @param {unknown} value
 * @returns {{ ok: true, value: string[] } | { ok: false, reason: string }}
 */
export function normalizeStringIdList(value, fieldName) {
  if (!Array.isArray(value)) return { ok: false, reason: `${fieldName} must be an array` }
  if (value.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
    return { ok: false, reason: `${fieldName} entries must be non-empty strings` }
  }
  return { ok: true, value: [...value] }
}
