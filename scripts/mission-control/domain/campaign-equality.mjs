/**
 * Pure campaign equality helpers.
 * No GitHub, filesystem, process, or command execution.
 */

/**
 * Canonical deep equality with object-key sorting; array order is significant.
 * @param {unknown} left
 * @param {unknown} right
 * @returns {boolean}
 */
export function sameCampaignValue(left, right) {
  if (Object.is(left, right)) return true
  if (left === null || right === null) return left === right
  if (typeof left !== typeof right) return false

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((entry, index) => sameCampaignValue(entry, right[index]))
  }

  if (typeof left === 'object') {
    const leftKeys = Object.keys(left).sort()
    const rightKeys = Object.keys(right).sort()
    if (leftKeys.length !== rightKeys.length) return false
    if (leftKeys.some((key, index) => key !== rightKeys[index])) return false
    return leftKeys.every((key) => sameCampaignValue(left[key], right[key]))
  }

  return false
}

/**
 * @param {Record<string, unknown>} expected
 * @param {Record<string, unknown>} actual
 * @param {string[] | null} [fields]
 */
export function verifyCampaignPostcondition(expected, actual, fields = null) {
  const checked = fields ?? Object.keys(expected)
  for (const field of checked) {
    if (!sameCampaignValue(expected?.[field], actual?.[field])) {
      throw new Error(`campaign postcondition mismatch on ${field}`)
    }
  }
}
