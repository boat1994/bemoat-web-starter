import { createRequire } from 'node:module'

type RuntimeObject = Record<string, unknown>
type FindingStatus = 'CLAIMED_RESOLVED' | 'UNPROVEN'
type CorrectionMode = 'implementation_pr' | 'planning_no_pr'
type Finding = {
  id: string
  canonical_summary: string
  source_thread: string
  required_evidence: string[]
  expected_areas: string[]
  prohibited_areas: string[]
}
type CorrectionContract = {
  schema_version: 1
  mode: CorrectionMode
  reviewed_head: string
  findings: Finding[]
}
type EvidenceEntry = { changed_files: string[]; tests: string[]; status: FindingStatus }
type CorrectionEvidence = {
  schema_version: 1 | 2
  mode: string | undefined
  correction_base: string
  finding_results: Record<string, EvidenceEntry>
}
type Failure = { ok: false; errors: string[] }
type ParseContractResult = { ok: true; contract: CorrectionContract } | Failure
type ParseEvidenceResult = { ok: true; evidence: CorrectionEvidence } | Failure
type ValidationResult = { ok: true; errors: [] } | Failure

export const CORRECTION_CONTRACT_SCHEMA_VERSION = 1
export const CORRECTION_EVIDENCE_SCHEMA_VERSION = 2
export const FINDING_STATUS = Object.freeze({
  CLAIMED_RESOLVED: 'CLAIMED_RESOLVED',
  UNPROVEN: 'UNPROVEN',
} satisfies Readonly<Record<string, FindingStatus>>)

export const CORRECTION_EVIDENCE_CONTRACT = Object.freeze({
  representation: 'fenced_json_object',
  schema_version: CORRECTION_EVIDENCE_SCHEMA_VERSION,
  required_keys: ['schema_version', 'correction_base', 'finding_results'],
  correction_base: { type: 'string', binding: 'must equal the immutable reviewed head' },
  finding_results: Object.freeze({
    representation: 'object keyed by immutable finding ID',
    entry_fields: ['changed_files', 'tests', 'status'],
    status_enum: Object.freeze(Object.values(FINDING_STATUS)),
  }),
  bindings: [
    'correction_base must equal the immutable reviewed head',
    'finding IDs must exactly match the immutable correction finding set; omitted, added, or substituted IDs are invalid',
    'referenced changed files must exist in the actual correction diff',
    'correction scope and prohibited-area validation remains authoritative',
  ],
  claimed_resolved_requirements: ['changed_files must be non-empty', 'tests must be non-empty'],
  multiplicity: 'Exactly one correction evidence-map block is permitted',
  canonical_example: `\`\`\`json
{
  "schema_version": 2,
  "correction_base": "1234567890abcdef1234567890abcdef12345678",
  "finding_results": {
    "MC-R1-001": {
      "changed_files": ["src/lib/month-boundary.ts"],
      "tests": ["pnpm exec vitest run tests/int/month-boundary.int.spec.ts"],
      "status": "CLAIMED_RESOLVED"
    },
    "MC-R1-002": {
      "changed_files": ["tests/int/month-boundary.int.spec.ts"],
      "tests": ["pnpm exec vitest run tests/int/month-boundary.int.spec.ts"],
      "status": "UNPROVEN"
    }
  }
}
\`\`\``,
})

type RawObjectSchemaResult =
  | { success: true; data: RuntimeObject }
  | { success: false; error: unknown }
type RawObjectSchema = { safeParse(value: unknown): RawObjectSchemaResult }
type ZodNamespace = { object(shape: Record<string, unknown>): unknown }

function isZodNamespace(value: unknown): value is ZodNamespace {
  return isRuntimeObject(value) && typeof value.object === 'function'
}

function isRawObjectSchema(value: unknown): value is RawObjectSchema {
  return isRuntimeObject(value) && typeof value.safeParse === 'function'
}

function loadDecodedRawJsonObjectSchema(): RawObjectSchema {
  const loaded: unknown = createRequire(import.meta.url)('zod')
  const zod = isRuntimeObject(loaded) ? loaded.z : undefined
  if (!isZodNamespace(zod)) throw new Error('zod object schema is unavailable')
  const objectSchema: unknown = zod.object({})
  const passthrough = isRuntimeObject(objectSchema) ? objectSchema.passthrough : undefined
  if (typeof passthrough !== 'function') throw new Error('zod passthrough schema is unavailable')
  const schema: unknown = passthrough.call(objectSchema)
  if (!isRawObjectSchema(schema)) throw new Error('zod raw object schema is invalid')
  return schema
}

function isRuntimeObject(value: unknown): value is RuntimeObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readProperty(value: unknown, key: string): unknown {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return undefined
  return Reflect.get(value, key)
}

function directProperty(value: unknown, key: string): unknown {
  if (value === null || value === undefined) throw new TypeError(`Cannot read properties of ${value}`)
  return Reflect.get(Object(value), key)
}

function requireText(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('text.matchAll is not a function')
  return value
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.trim().length > 0)
}

function isStringArrayAllowEmpty(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function isFindingStatus(value: unknown): value is FindingStatus {
  return value === FINDING_STATUS.CLAIMED_RESOLVED || value === FINDING_STATUS.UNPROVEN
}

function isEvidenceSchema(value: unknown): value is 1 | 2 {
  return value === 1 || value === CORRECTION_EVIDENCE_SCHEMA_VERSION
}

function validationResult(errors: string[]): ValidationResult {
  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors }
}

function findingShapeErrors(finding: unknown, index: number): string[] {
  const errors: string[] = []
  const label = `findings[${index}]`
  if (!isRuntimeObject(finding)) return [`${label} must be an object`]
  if (typeof finding.id !== 'string' || !finding.id.trim()) errors.push(`${label}.id must be a non-empty string`)
  if (typeof finding.canonical_summary !== 'string' || !finding.canonical_summary.trim()) {
    errors.push(`${label}.canonical_summary must be a non-empty string`)
  }
  if (typeof finding.source_thread !== 'string' || !finding.source_thread.trim()) {
    errors.push(`${label}.source_thread must be a non-empty string`)
  }
  if (!isStringArray(finding.required_evidence)) errors.push(`${label}.required_evidence must be a non-empty string array`)
  if (finding.expected_areas !== undefined && !isStringArray(finding.expected_areas)) {
    errors.push(`${label}.expected_areas must be an array of non-empty strings when present`)
  }
  if (finding.prohibited_areas !== undefined && !isStringArray(finding.prohibited_areas)) {
    errors.push(`${label}.prohibited_areas must be an array of non-empty strings when present`)
  }
  return errors
}

function validateContractShape(candidate: RuntimeObject): ParseContractResult {
  const errors: string[] = []
  if (candidate.schema_version !== CORRECTION_CONTRACT_SCHEMA_VERSION) errors.push(`schema_version must be ${CORRECTION_CONTRACT_SCHEMA_VERSION}`)
  let mode: CorrectionMode = 'implementation_pr'
  if (candidate.mode !== undefined) {
    if (candidate.mode !== 'implementation_pr' && candidate.mode !== 'planning_no_pr') errors.push('mode must be implementation_pr or planning_no_pr')
    else mode = candidate.mode
  }
  if (typeof candidate.reviewed_head !== 'string' || !candidate.reviewed_head.trim()) errors.push('reviewed_head must be a non-empty string')
  const candidateFindings = candidate.findings
  if (!Array.isArray(candidateFindings) || candidateFindings.length === 0) errors.push('findings must be a non-empty array')
  else {
    const normalizedIds = new Set<string>()
    candidateFindings.forEach((finding, index) => {
      errors.push(...findingShapeErrors(finding, index))
      if (isRuntimeObject(finding) && typeof finding.id === 'string') {
        const normalizedId = finding.id.trim()
        if (normalizedId && normalizedIds.has(normalizedId)) errors.push(`duplicate finding id (whitespace-normalized): ${finding.id}`)
        normalizedIds.add(normalizedId)
      }
    })
  }
  if (errors.length) return { ok: false, errors }
  if (!Array.isArray(candidateFindings)) return { ok: false, errors: ['findings must be a non-empty array'] }
  const normalizedFindings: Finding[] = []
  for (const rawFinding of candidateFindings) {
    if (!isRuntimeObject(rawFinding)) continue
    const id = rawFinding.id
    const summary = rawFinding.canonical_summary
    const sourceThread = rawFinding.source_thread
    const requiredEvidence = rawFinding.required_evidence
    if (typeof id !== 'string' || typeof summary !== 'string' || typeof sourceThread !== 'string' || !isStringArray(requiredEvidence)) continue
    normalizedFindings.push({
      id: id.trim(),
      canonical_summary: summary.trim(),
      source_thread: sourceThread.trim(),
      required_evidence: [...requiredEvidence],
      expected_areas: isStringArray(rawFinding.expected_areas) ? [...rawFinding.expected_areas] : [],
      prohibited_areas: isStringArray(rawFinding.prohibited_areas) ? [...rawFinding.prohibited_areas] : [],
    })
  }
  const reviewedHead = candidate.reviewed_head
  if (typeof reviewedHead !== 'string') return { ok: false, errors: ['reviewed_head must be a non-empty string'] }
  return { ok: true, contract: { schema_version: 1, mode, reviewed_head: reviewedHead.trim(), findings: normalizedFindings } }
}

export function extractJsonObjects(text: unknown = ''): RuntimeObject[] {
  const source = requireText(text)
  const objects: RuntimeObject[] = []
  const fenced = [...source.matchAll(/```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```/gi)]
  for (const match of fenced) {
    const candidate = match[1]?.trim()
    if (!candidate) continue
    try {
      const decoded: unknown = JSON.parse(candidate)
      const result = loadDecodedRawJsonObjectSchema().safeParse(decoded)
      if (result.success) objects.push(result.data)
    } catch {
      // Ignore non-JSON fences; callers decide which shapes are required.
    }
  }
  return objects
}

export function parseCorrectionContract(text: unknown = ''): ParseContractResult {
  const objects = extractJsonObjects(text).filter((object) => Object.hasOwn(object, 'findings') && Object.hasOwn(object, 'reviewed_head'))
  if (objects.length === 0) return { ok: false, errors: ['missing correction finding contract JSON block'] }
  if (objects.length > 1) return { ok: false, errors: ['multiple correction finding contract JSON blocks are not allowed'] }
  const result = validateContractShape(objects[0])
  if (result.ok && result.contract.mode === 'implementation_pr' && /\*\*PR\s*\/\s*base\s*\/\s*head:\*\*\s*none\b/i.test(requireText(text))) {
    result.contract.mode = 'planning_no_pr'
  }
  return result
}

function validateEvidenceShape(candidate: RuntimeObject): ParseEvidenceResult {
  const errors: string[] = []
  const schemaVersion = candidate.schema_version
  if (!isEvidenceSchema(schemaVersion)) errors.push(`schema_version must be 1 or ${CORRECTION_EVIDENCE_SCHEMA_VERSION}`)
  if (typeof candidate.correction_base !== 'string' || !candidate.correction_base.trim()) errors.push('correction_base must be a non-empty string')
  const rawFindingResults = candidate.finding_results
  if (!isRuntimeObject(rawFindingResults)) {
    errors.push('finding_results must be an object keyed by finding id')
  } else {
    for (const [id, rawEntry] of Object.entries(rawFindingResults)) {
      if (!isRuntimeObject(rawEntry)) { errors.push(`finding_results.${id} must be an object`); continue }
      if (!isStringArrayAllowEmpty(rawEntry.changed_files)) errors.push(`finding_results.${id}.changed_files must be a string array`)
      if (!isStringArrayAllowEmpty(rawEntry.tests)) errors.push(`finding_results.${id}.tests must be a string array`)
      if (!isFindingStatus(rawEntry.status)) errors.push(`finding_results.${id}.status must be CLAIMED_RESOLVED or UNPROVEN`)
    }
  }
  if (errors.length) return { ok: false, errors }
  const findingResults: Record<string, EvidenceEntry> = {}
  if (!isEvidenceSchema(schemaVersion) || typeof candidate.correction_base !== 'string' || !isRuntimeObject(rawFindingResults)) return { ok: false, errors: ['correction evidence map is invalid'] }
  for (const [id, rawEntry] of Object.entries(rawFindingResults)) {
    if (!isRuntimeObject(rawEntry) || !isStringArrayAllowEmpty(rawEntry.changed_files) || !isStringArrayAllowEmpty(rawEntry.tests) || !isFindingStatus(rawEntry.status)) continue
    findingResults[id] = { changed_files: [...rawEntry.changed_files], tests: [...rawEntry.tests], status: rawEntry.status }
  }
  return {
    ok: true,
    evidence: {
      schema_version: schemaVersion,
      mode: typeof candidate.mode === 'string' && candidate.mode.trim() ? candidate.mode.trim() : undefined,
      correction_base: candidate.correction_base.trim(),
      finding_results: findingResults,
    },
  }
}

export function parseCorrectionEvidenceMap(text: unknown = ''): ParseEvidenceResult {
  const objects = extractJsonObjects(text).filter((object) => Object.hasOwn(object, 'finding_results') && Object.hasOwn(object, 'correction_base'))
  if (objects.length === 0) return { ok: false, errors: ['missing correction RESULT evidence map JSON block'] }
  if (objects.length > 1) return { ok: false, errors: ['multiple correction finding evidence map JSON blocks are not allowed'] }
  return validateEvidenceShape(objects[0])
}

export function validateFindingIdentity(canonical: unknown, candidate: unknown): ValidationResult {
  const canonicalFindings = readProperty(canonical, 'findings')
  const candidateFindings = readProperty(candidate, 'findings')
  if (!canonicalFindings || !candidateFindings) return { ok: false, errors: ['canonical and candidate findings are required'] }
  if (!Array.isArray(canonicalFindings) || !Array.isArray(candidateFindings)) throw new TypeError('findings.map is not a function')
  const canonicalIds = canonicalFindings.map((finding) => directProperty(finding, 'id'))
  const candidateIds = candidateFindings.map((finding) => directProperty(finding, 'id'))
  const canonicalSet = new Set(canonicalIds)
  const candidateSet = new Set(candidateIds)
  const errors: string[] = []
  for (const id of candidateIds) if (!canonicalSet.has(id)) errors.push(`unknown or substituted finding id: ${id}`)
  for (const id of canonicalIds) if (!candidateSet.has(id)) errors.push(`omitted finding id: ${id}`)
  if (canonicalIds.length !== candidateIds.length) errors.push('finding set size changed by rename, addition, or omission')
  const candidateById = new Map(candidateFindings.map((finding) => [directProperty(finding, 'id'), finding]))
  for (const finding of canonicalFindings) {
    const match = candidateById.get(directProperty(finding, 'id'))
    if (!match) continue
    if (directProperty(match, 'canonical_summary') !== directProperty(finding, 'canonical_summary')) {
      errors.push(`changed summary / reinterpretation for ${directProperty(finding, 'id')}: canonical_summary must remain immutable`)
    }
  }
  return validationResult(errors)
}

export function buildCorrectionCapsule(contract: unknown, meta: unknown = {}): { lines: string[]; playbackLine: string; findingCount: number } {
  const findingsValue = readProperty(contract, 'findings')
  const findings = Array.isArray(findingsValue) ? findingsValue : []
  const mode = readProperty(meta, 'mode') ?? readProperty(contract, 'mode') ?? 'implementation_pr'
  const issueNumber = readProperty(meta, 'issueNumber')
  const prUrl = readProperty(meta, 'prUrl')
  const lines = ['Correction capsule', issueNumber ? `Issue: #${issueNumber}` : 'Issue: (not provided)', prUrl ? `PR: ${prUrl}` : mode === 'planning_no_pr' ? 'PR: none' : 'PR: (not provided)']
  if (mode === 'planning_no_pr') lines.push('Mode: planning_no_pr')
  lines.push(`Reviewed head / correction base: ${readProperty(contract, 'reviewed_head') ?? '(missing)'}`, 'Canonical findings:')
  for (const finding of findings) {
    const id = readProperty(finding, 'id')
    const summary = readProperty(finding, 'canonical_summary')
    const sourceThread = readProperty(finding, 'source_thread')
    const evidence = readProperty(finding, 'required_evidence')
    const expected = readProperty(finding, 'expected_areas')
    const prohibited = readProperty(finding, 'prohibited_areas')
    lines.push(`- ${id}: ${summary}`, `  source_thread: ${sourceThread}`, `  required_evidence: ${(Array.isArray(evidence) ? evidence : []).join('; ')}`)
    if (Array.isArray(expected) && expected.length) lines.push(`  expected_areas: ${expected.join('; ')}`)
    if (mode === 'planning_no_pr') {
      const extra = Array.isArray(prohibited) && prohibited.length ? ` (${prohibited.join('; ')})` : ''
      const allowlist = derivePlanningArtifactAllowlist(contract)
      lines.push(`  prohibited_areas: planning canonical-artifact allowlist only (${allowlist.length ? allowlist.join('; ') : 'none declared'})${extra}`)
    } else if (Array.isArray(prohibited) && prohibited.length) lines.push(`  prohibited_areas: ${prohibited.join('; ')}`)
  }
  if (mode === 'planning_no_pr') {
    const allowlist = derivePlanningArtifactAllowlist(contract)
    lines.push(`Authorized scope: only the immutable finding set above within canonical planning artifacts (${allowlist.length ? allowlist.join('; ') : 'expected_areas required'})`)
  } else lines.push('Authorized scope: only the immutable finding set above')
  lines.push('Stop conditions: missing/malformed/conflicting findings; identity drift; incomplete evidence map', 'Thread ownership: Delta Reviewer resolves original review threads after corrected exact-head CI')
  const playbackLine = `Playback verified: ${findings.length}/${findings.length} canonical findings`
  lines.push(playbackLine)
  return { lines, playbackLine, findingCount: findings.length }
}

export function derivePlanningArtifactAllowlist(contract: unknown): string[] {
  const allowlist = new Set<string>()
  const findings = readProperty(contract, 'findings')
  if (!Array.isArray(findings)) return [...allowlist]
  for (const finding of findings) {
    const areas = readProperty(finding, 'expected_areas')
    if (!Array.isArray(areas)) continue
    for (const area of areas) { const trimmed = typeof area === 'string' ? area.trim() : ''; if (trimmed) allowlist.add(trimmed) }
  }
  return [...allowlist]
}

function pathMatchesPlanningAllowlistEntry(allowedPath: string, filePath: string): boolean {
  if (!allowedPath || !filePath) return false
  if (allowedPath === filePath) return true
  if (allowedPath.endsWith('/') && filePath.startsWith(allowedPath)) return true
  return filePath === allowedPath || filePath.startsWith(`${allowedPath}/`)
}

function pathMatchesProhibitedArea(area: string, filePath: string): boolean {
  if (!area || !filePath) return false
  if (area === filePath) return true
  if (area.endsWith('/') && filePath.startsWith(area)) return true
  return area.includes('/') || /\.[A-Za-z0-9]+$/.test(area) ? filePath === area || filePath.startsWith(`${area}/`) || filePath.includes(area) : false
}

export function validateFindingEvidence(contract: unknown, result: unknown, diffFiles: unknown = [], options: unknown = {}): ValidationResult {
  const findings = readProperty(contract, 'findings')
  if (!Array.isArray(findings) || findings.length === 0) return { ok: false, errors: ['correction contract findings are required'] }
  const findingResults = readProperty(result, 'finding_results')
  if (!findingResults || typeof findingResults !== 'object') return { ok: false, errors: ['finding_results are required'] }
  const errors: string[] = []
  const correctionBase = readProperty(result, 'correction_base')
  const reviewedHead = readProperty(contract, 'reviewed_head')
  if (typeof correctionBase === 'string' && correctionBase.trim() && correctionBase.trim() !== reviewedHead) errors.push('correction_base must match reviewed_head')
  const resultIds = Object.keys(findingResults)
  const identity = validateFindingIdentity({ findings }, {
    findings: resultIds.map((id) => ({
      id,
      canonical_summary: readProperty(findings.find((finding) => readProperty(finding, 'id') === id), 'canonical_summary') ?? `__missing__:${id}`,
    })),
  })
  if (!identity.ok) errors.push(...identity.errors)
  const diffList = Array.isArray(diffFiles) ? diffFiles : []
  const scopeCheck = validateCorrectionScope(contract, diffList, { mode: readProperty(options, 'mode') ?? readProperty(contract, 'mode') })
  if (!scopeCheck.ok) errors.push(...scopeCheck.errors)
  const diffSet = new Set(diffList)
  for (const finding of findings) {
    const id = readProperty(finding, 'id')
    const entry = readProperty(findingResults, String(id))
    if (!entry) continue
    if (readProperty(entry, 'status') === FINDING_STATUS.CLAIMED_RESOLVED) {
      const changedFilesValue = readProperty(entry, 'changed_files')
      const testsValue = readProperty(entry, 'tests')
      const changedFiles = isStringArrayAllowEmpty(changedFilesValue) ? changedFilesValue : []
      const tests = isStringArrayAllowEmpty(testsValue) ? testsValue : []
      const validChangedFiles = changedFiles.filter((item) => item.trim().length > 0)
      const validTests = tests.filter((item) => item.trim().length > 0)
      if (validChangedFiles.length === 0 || validTests.length === 0) errors.push(`CLAIMED_RESOLVED requires non-empty changed_files and tests evidence for ${id}`)
      for (const filePath of validChangedFiles) if (!diffSet.has(filePath)) errors.push(`referenced changed file absent from correction diff: ${filePath}`)
    }
  }
  const body = readProperty(options, 'body')
  const hasUnproven = Object.values(findingResults).some((entry) => readProperty(entry, 'status') === FINDING_STATUS.UNPROVEN)
  if (hasUnproven && typeof body === 'string' && /^\*\*AC audit:\*\*\s*Done\s*$/im.test(body)) errors.push('unsupported free-form Done claim conflicts with UNPROVEN finding evidence')
  return validationResult(errors)
}

export function isCorrectionPhaseResult(body: unknown = ''): boolean {
  const source = requireText(body)
  if (/^\s*[-*]\s*Phase:\s*Dev\s*\(correction\)\s*$/im.test(source)) return true
  return extractJsonObjects(source).some((object) => Object.hasOwn(object, 'finding_results') && Object.hasOwn(object, 'correction_base'))
}

export function isCorrectionEligibleVerdict(body: unknown = ''): boolean {
  const verdict = requireText(body).match(/^\*\*Verdict:\*\*\s*(.+?)\s*$/m)?.[1]?.trim()
  return verdict === 'CORRECTION REQUIRED'
}

export function findingsFieldDeclaresUnresolvedImplementationFindings(body: unknown = ''): boolean {
  const findings = requireText(body).match(/^\*\*Findings:\*\*\s*(.+?)\s*$/m)?.[1]?.trim()
  if (!findings) return false
  const critical = findings.match(/Critical:\s*(.+?)(?:\s*·\s*Important:|$)/i)?.[1]?.trim() ?? ''
  const important = findings.match(/Important:\s*(.+?)$/i)?.[1]?.trim() ?? ''
  const isNone = (value: string) => !value || /^none\b/i.test(value)
  return !isNone(critical) || !isNone(important)
}

export function requiresCorrectionFindingContract(body: unknown = ''): boolean {
  const source = requireText(body)
  const verdict = source.match(/^\*\*Verdict:\*\*\s*(.+?)\s*$/m)?.[1]?.trim()
  if (verdict === 'CORRECTION REQUIRED') return true
  if (verdict === 'BLOCKED FOR FOUNDER DECISION') {
    if (findingsFieldDeclaresUnresolvedImplementationFindings(source)) return true
    return extractJsonObjects(source).some((object) => Object.hasOwn(object, 'findings') && Object.hasOwn(object, 'reviewed_head'))
  }
  return false
}

export function parseReviewVerdictContractFindings(body: unknown = '', verdict: unknown = null): { ok: true; findings: Array<{ finding_id: string; severity: string; disposition: string }> } | Failure {
  const source = requireText(body)
  const resolvedVerdict = verdict ?? source.match(/^\*\*Verdict:\*\*\s*(.+?)\s*$/m)?.[1]?.trim()
  if (resolvedVerdict === 'CORRECTION REQUIRED') {
    const parsed = parseCorrectionContract(source)
    if (parsed.ok === false) return { ok: false, errors: parsed.errors }
    return { ok: true, findings: parsed.contract.findings.map((finding) => ({ finding_id: finding.id, severity: 'Important', disposition: 'open' })) }
  }
  if (resolvedVerdict === 'BLOCKED FOR FOUNDER DECISION') {
    const hasContractShape = extractJsonObjects(source).some((object) => Object.hasOwn(object, 'findings') && Object.hasOwn(object, 'reviewed_head'))
    if (!hasContractShape) {
      if (findingsFieldDeclaresUnresolvedImplementationFindings(source)) return { ok: false, errors: ['missing correction finding contract JSON block'] }
      return { ok: true, findings: [] }
    }
    const parsed = parseCorrectionContract(source)
    if (parsed.ok === false) return { ok: false, errors: parsed.errors }
    return { ok: true, findings: parsed.contract.findings.map((finding) => ({ finding_id: finding.id, severity: 'Important', disposition: 'open' })) }
  }
  return { ok: true, findings: [] }
}

export function validateCorrectionRoleComment(input: unknown = {}): ValidationResult {
  if (input === null) throw new TypeError('Cannot destructure null input')
  const role = readProperty(input, 'role')
  const body = readProperty(input, 'body') ?? ''
  const diffFiles = readProperty(input, 'diffFiles') ?? []
  const canonicalContract = readProperty(input, 'canonicalContract') ?? null
  const errors: string[] = []
  if (role === 'REVIEW_VERDICT' && requiresCorrectionFindingContract(body)) {
    const parsed = parseCorrectionContract(body)
    if (parsed.ok === false) errors.push(...parsed.errors)
  }
  if (role === 'RESULT' && isCorrectionPhaseResult(body)) {
    const evidence = parseCorrectionEvidenceMap(body)
    if (evidence.ok === false) { errors.push(...evidence.errors); return { ok: false, errors } }
    if (!canonicalContract) {
      errors.push('a reconstructed canonical correction contract is required to validate a correction RESULT; omitting it does not bypass identity, base, diff, or prohibited-scope validation')
      return { ok: false, errors }
    }
    const validation = validateFindingEvidence(canonicalContract, evidence.evidence, diffFiles, { body, mode: readProperty(canonicalContract, 'mode') })
    if (!validation.ok) errors.push(...validation.errors)
  }
  return validationResult(errors)
}

export function validateCorrectionScope(contract: unknown, diffFiles: unknown = [], options: unknown = {}): ValidationResult {
  const errors: string[] = []
  const mode = readProperty(options, 'mode') ?? readProperty(contract, 'mode') ?? 'implementation_pr'
  const findings = readProperty(contract, 'findings')
  const prohibited: string[] = []
  if (Array.isArray(findings)) for (const finding of findings) {
    const areas = readProperty(finding, 'prohibited_areas')
    if (Array.isArray(areas)) prohibited.push(...areas.filter((area): area is string => typeof area === 'string'))
  }
  const planningAllowlist = mode === 'planning_no_pr' ? derivePlanningArtifactAllowlist(contract) : []
  const files = Array.isArray(diffFiles) ? diffFiles : []
  for (const filePath of files) {
    if (typeof filePath !== 'string') continue
    if (mode === 'planning_no_pr') {
      if (planningAllowlist.length === 0) { errors.push('planning_no_pr correction requires at least one expected_areas entry in the immutable finding contract'); continue }
      if (!planningAllowlist.some((entry) => pathMatchesPlanningAllowlistEntry(entry, filePath))) {
        errors.push(`prohibited scope present in correction diff: ${filePath} (outside canonical planning-artifact allowlist)`); continue
      }
    }
    for (const area of prohibited) if (pathMatchesProhibitedArea(area, filePath)) errors.push(`prohibited scope present in correction diff: ${filePath} (matched ${area})`)
  }
  return validationResult(errors)
}
