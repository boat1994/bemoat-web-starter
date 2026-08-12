/**
 * Pure campaign equality helpers.
 * No GitHub, filesystem, process, or command execution.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** Canonical deep equality with object-key sorting; array order is significant. */
export function sameCampaignValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (left === null || right === null) return left === right
  if (typeof left !== typeof right) return false

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((entry, index) => sameCampaignValue(entry, right[index]))
  }

  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left).sort()
    const rightKeys = Object.keys(right).sort()
    if (leftKeys.length !== rightKeys.length) return false
    if (leftKeys.some((key, index) => key !== rightKeys[index])) return false
    return leftKeys.every((key) => sameCampaignValue(left[key], right[key]))
  }

  return false
}

export function verifyCampaignPostcondition(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
  fields: string[] | null = null,
): void {
  const checked = fields ?? Object.keys(expected)
  for (const field of checked) {
    if (!sameCampaignValue(expected?.[field], actual?.[field])) {
      throw new Error(`campaign postcondition mismatch on ${field}`)
    }
  }
}
