import { createHash } from 'node:crypto'

/**
 * Stable JSON serialization for contract fingerprinting.
 * Sorts object keys recursively; arrays keep order (finding sequence is authoritative).
 *
 * @param {unknown} value
 * @returns {string}
 */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`
  }
  const keys = Object.keys(value).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
}

/**
 * Canonical SHA-256 fingerprint of a validated correction contract.
 *
 * @param {object} contract
 * @returns {string}
 */
export function fingerprintCorrectionContract(contract) {
  return createHash('sha256').update(stableStringify(contract), 'utf8').digest('hex')
}

/**
 * SHA-256 of an exact comment/body string.
 *
 * @param {string} body
 * @returns {string}
 */
export function hashExactBody(body) {
  return createHash('sha256').update(String(body ?? ''), 'utf8').digest('hex')
}
