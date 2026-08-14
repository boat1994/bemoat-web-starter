import { blockedExternal, stateConflict } from './merge-errors.ts'

type ParsedCampaignFailure = {
  reason?: unknown
  classification?: unknown
}

function readParsedField(parsed: ParsedCampaignFailure | null | undefined, key: keyof ParsedCampaignFailure): unknown {
  if (parsed == null) throw new TypeError(`Cannot read properties of ${parsed}, reading '${key}'`)
  return Reflect.get(Object(parsed), key)
}

export function campaignParseFailure(
  parsed: ParsedCampaignFailure | null | undefined,
  context: string,
): never {
  const reason = readParsedField(parsed, 'reason')
  const classification = readParsedField(parsed, 'classification')
  const message = `${context}: ${reason ?? 'invalid campaign projection'}`
  if (classification === 'BLOCKED_EXTERNAL') throw blockedExternal(message)
  throw stateConflict(message)
}
