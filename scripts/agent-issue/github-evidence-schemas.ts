import { z } from 'zod'

export const jsonValueSchema = z.json()

export function assertGhJsonValue(value: unknown): unknown {
  const parsed = jsonValueSchema.safeParse(value)
  if (!parsed.success) {
    throw new SyntaxError('Unexpected token')
  }
  return parsed.data
}

export function invalidJsonMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function parseGhPrListPayload(
  stdout: string,
): { ok: false; reason: string } | { ok: true; openPrs: unknown[] } {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return { ok: false, reason: 'malformed GitHub PR list JSON' }
  }
  const jsonParsed = jsonValueSchema.safeParse(parsed)
  if (!jsonParsed.success) {
    return { ok: false, reason: 'malformed GitHub PR list JSON' }
  }
  parsed = jsonParsed.data
  if (!Array.isArray(parsed)) {
    return { ok: false, reason: 'GitHub PR list evidence is not an array' }
  }
  return { ok: true, openPrs: parsed }
}
