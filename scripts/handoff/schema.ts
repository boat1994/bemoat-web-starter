export const HANDOFF_ROUTES = [
  'IMPLEMENT',
  'VERIFY',
  'FIX',
  'REVIEW',
  'FOUNDER_GATE',
  'COMPLETE',
  'STOP',
] as const

export type HandoffRoute = (typeof HANDOFF_ROUTES)[number]

export type HandoffEvidence = {
  kind: string
  value: string
  url: string | null
}

export type HandoffRecord = {
  schema_version: 1
  record_type: 'HANDOFF'
  repository: string
  issue_number: string
  objective: string
  permitted_scope: string[]
  prohibited_scope: string[]
  executing_agent: string
  provider: string
  branch: string | null
  exact_head: string | null
  protected_base: { branch: string; sha: string }
  pr: {
    number: string
    url: string
    base: string
    head: string
    head_sha: string
  } | null
  verified_evidence: HandoffEvidence[]
  route: HandoffRoute
  next_action: { route: HandoffRoute; description: string }
  stop_conditions: string[]
  local_durability: { required: boolean; durable: boolean; reason: string | null }
}

export class HandoffValidationError extends Error {
  readonly classification = 'EVIDENCE_CONFLICT' as const
  readonly errors: string[]

  constructor(errors: string[]) {
    super(errors.join('; '))
    this.name = 'HandoffValidationError'
    this.errors = errors
  }
}

const TOP_LEVEL_KEYS = [
  'schema_version',
  'record_type',
  'repository',
  'issue_number',
  'objective',
  'permitted_scope',
  'prohibited_scope',
  'executing_agent',
  'provider',
  'branch',
  'exact_head',
  'protected_base',
  'pr',
  'verified_evidence',
  'route',
  'next_action',
  'stop_conditions',
  'local_durability',
] as const

const SHA_RE = /^[0-9a-f]{40}$/
const REPOSITORY_RE = /^[^/\s:]+\/[^/\s:]+$/
const ISSUE_RE = /^[1-9]\d*$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join('\u0000') === [...expected].sort().join('\u0000')
}

function unknownFields(value: Record<string, unknown>, expected: readonly string[]): string[] {
  const allowed = new Set(expected)
  return Object.keys(value)
    .filter((key) => !allowed.has(key))
    .map((key) => `unknown field: ${key}`)
}

function nonEmptyString(value: unknown, field: string, errors: string[]): value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${field} must be a non-empty string`)
    return false
  }
  return true
}

function stringArray(value: unknown, field: string, errors: string[]): value is string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((entry) => typeof entry !== 'string' || entry.trim() === '')) {
    errors.push(`${field} must be a non-empty string array`)
    return false
  }
  return true
}

function nullableString(value: unknown, field: string, errors: string[]): value is string | null {
  if (value !== null && (typeof value !== 'string' || value.trim() === '')) {
    errors.push(`${field} must be a non-empty string or null`)
    return false
  }
  return true
}

function fullSha(value: unknown, field: string, errors: string[]): value is string {
  if (typeof value !== 'string' || !SHA_RE.test(value)) {
    errors.push(`${field} must be a lowercase full SHA`)
    return false
  }
  return true
}

function positiveInteger(value: unknown, field: string, errors: string[]): value is string {
  if (typeof value !== 'string' || !ISSUE_RE.test(value)) {
    errors.push(`${field} must be a canonical positive integer string`)
    return false
  }
  return true
}

function route(value: unknown, field: string, errors: string[]): value is HandoffRoute {
  if (typeof value !== 'string' || !(HANDOFF_ROUTES as readonly string[]).includes(value)) {
    errors.push(`${field} must use the closed HANDOFF route enum`)
    return false
  }
  return true
}

function validateEvidence(value: unknown, errors: string[]): value is HandoffEvidence[] {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push('verified_evidence must be a non-empty array')
    return false
  }
  value.forEach((entry, index) => {
    const field = `verified_evidence[${index}]`
    if (!isRecord(entry) || !exactKeys(entry, ['kind', 'value', 'url'])) {
      errors.push(`${field} must contain exactly kind, value, and url`)
      return
    }
    nonEmptyString(entry.kind, `${field}.kind`, errors)
    nonEmptyString(entry.value, `${field}.value`, errors)
    nullableString(entry.url, `${field}.url`, errors)
  })
  return true
}

function validatePullRequest(value: unknown, repository: string, errors: string[]): value is NonNullable<HandoffRecord['pr']> {
  if (value === null) return false
  if (!isRecord(value) || !exactKeys(value, ['number', 'url', 'base', 'head', 'head_sha'])) {
    errors.push('pr must contain exactly number, url, base, head, and head_sha or be null')
    return false
  }
  positiveInteger(value.number, 'pr.number', errors)
  nonEmptyString(value.base, 'pr.base', errors)
  nonEmptyString(value.head, 'pr.head', errors)
  fullSha(value.head_sha, 'pr.head_sha', errors)
  if (
    typeof value.url !== 'string' ||
    value.url !== `https://github.com/${repository}/pull/${value.number}`
  ) {
    errors.push('pr.url must identify the bound repository and pull request')
  }
  return true
}

export function validateHandoffRecord(value: unknown): HandoffRecord {
  const errors: string[] = []
  if (!isRecord(value)) throw new HandoffValidationError(['HANDOFF body must be a JSON object'])
  errors.push(...unknownFields(value, TOP_LEVEL_KEYS))
  if (!exactKeys(value, TOP_LEVEL_KEYS)) errors.push('HANDOFF body must contain exactly the schema-v1 fields')
  if (value.schema_version !== 1) errors.push('schema_version must be 1')
  if (value.record_type !== 'HANDOFF') errors.push('record_type must be HANDOFF')
  if (typeof value.repository !== 'string' || !REPOSITORY_RE.test(value.repository) || value.repository !== value.repository.toLowerCase()) {
    errors.push('repository must be a lowercase owner/repository string')
  }
  positiveInteger(value.issue_number, 'issue_number', errors)
  nonEmptyString(value.objective, 'objective', errors)
  stringArray(value.permitted_scope, 'permitted_scope', errors)
  stringArray(value.prohibited_scope, 'prohibited_scope', errors)
  nonEmptyString(value.executing_agent, 'executing_agent', errors)
  nonEmptyString(value.provider, 'provider', errors)
  nullableString(value.branch, 'branch', errors)
  if (value.exact_head !== null) fullSha(value.exact_head, 'exact_head', errors)

  if (!isRecord(value.protected_base) || !exactKeys(value.protected_base, ['branch', 'sha'])) {
    errors.push('protected_base must contain exactly branch and sha')
  } else {
    nonEmptyString(value.protected_base.branch, 'protected_base.branch', errors)
    fullSha(value.protected_base.sha, 'protected_base.sha', errors)
  }

  const repository = typeof value.repository === 'string' ? value.repository : ''
  if (value.pr !== null) validatePullRequest(value.pr, repository, errors)
  validateEvidence(value.verified_evidence, errors)
  const routeValue = route(value.route, 'route', errors) ? value.route : null
  if (!isRecord(value.next_action) || !exactKeys(value.next_action, ['route', 'description'])) {
    errors.push('next_action must contain exactly route and description')
  } else {
    const nextRoute = route(value.next_action.route, 'next_action.route', errors) ? value.next_action.route : null
    nonEmptyString(value.next_action.description, 'next_action.description', errors)
    if (routeValue && nextRoute && routeValue !== nextRoute) {
      errors.push('next_action route must be compatible with route')
    }
  }
  stringArray(value.stop_conditions, 'stop_conditions', errors)

  if (!isRecord(value.local_durability) || !exactKeys(value.local_durability, ['required', 'durable', 'reason'])) {
    errors.push('local_durability must contain exactly required, durable, and reason')
  } else {
    if (typeof value.local_durability.required !== 'boolean') errors.push('local_durability.required must be boolean')
    if (typeof value.local_durability.durable !== 'boolean') errors.push('local_durability.durable must be boolean')
    if (!nullableString(value.local_durability.reason, 'local_durability.reason', errors)) return fail(errors)
    if (value.local_durability.required && !value.local_durability.durable && value.local_durability.reason === null) {
      errors.push('local_durability.reason is required when required work is not durable')
    }
    if (value.local_durability.required && value.local_durability.durable && value.local_durability.reason !== null) {
      errors.push('local_durability.reason must be null when required work is durable')
    }
  }

  const prValue = isRecord(value.pr) ? value.pr : null
  if (prValue && (value.exact_head === null || prValue.head_sha !== value.exact_head)) {
    errors.push('pr.head_sha must match exact_head')
  }
  const localDurability = isRecord(value.local_durability) ? value.local_durability : null
  if (localDurability?.required === true && (value.branch === null || value.exact_head === null)) {
    errors.push('required local durability needs branch and exact_head bindings')
  }

  if (errors.length > 0) throw new HandoffValidationError(errors)

  return {
    schema_version: 1,
    record_type: 'HANDOFF',
    repository: value.repository as string,
    issue_number: value.issue_number as string,
    objective: value.objective as string,
    permitted_scope: [...value.permitted_scope as string[]],
    prohibited_scope: [...value.prohibited_scope as string[]],
    executing_agent: value.executing_agent as string,
    provider: value.provider as string,
    branch: value.branch as string | null,
    exact_head: value.exact_head as string | null,
    protected_base: {
      branch: (value.protected_base as Record<string, unknown>).branch as string,
      sha: (value.protected_base as Record<string, unknown>).sha as string,
    },
    pr: value.pr === null ? null : {
      number: (value.pr as Record<string, unknown>).number as string,
      url: (value.pr as Record<string, unknown>).url as string,
      base: (value.pr as Record<string, unknown>).base as string,
      head: (value.pr as Record<string, unknown>).head as string,
      head_sha: (value.pr as Record<string, unknown>).head_sha as string,
    },
    verified_evidence: (value.verified_evidence as Record<string, unknown>[]).map((entry) => ({
      kind: entry.kind as string,
      value: entry.value as string,
      url: entry.url as string | null,
    })),
    route: value.route as HandoffRoute,
    next_action: {
      route: (value.next_action as Record<string, unknown>).route as HandoffRoute,
      description: (value.next_action as Record<string, unknown>).description as string,
    },
    stop_conditions: [...value.stop_conditions as string[]],
    local_durability: {
      required: (value.local_durability as Record<string, unknown>).required as boolean,
      durable: (value.local_durability as Record<string, unknown>).durable as boolean,
      reason: (value.local_durability as Record<string, unknown>).reason as string | null,
    },
  }
}

function fail(errors: string[]): never {
  throw new HandoffValidationError(errors)
}

export function parseHandoffBody(body: string): HandoffRecord {
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch (error) {
    throw new HandoffValidationError([
      `HANDOFF body must contain valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    ])
  }
  return validateHandoffRecord(value)
}

export function renderHandoffComment(record: HandoffRecord): string {
  return `## HANDOFF\n\n\`\`\`json\n${JSON.stringify(record, null, 2)}\n\`\`\`\n`
}
