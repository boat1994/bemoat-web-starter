#!/usr/bin/env node

export const CORRECTION_CONTRACT_SCHEMA_VERSION = 1
export const CORRECTION_EVIDENCE_SCHEMA_VERSION = 2
export const FINDING_STATUS = Object.freeze({
  CLAIMED_RESOLVED: 'CLAIMED_RESOLVED',
  UNPROVEN: 'UNPROVEN',
})

/**
 * @param {string} text
 * @returns {Array<Record<string, unknown>>}
 */
export function extractJsonObjects(text = '') {
  const objects = []
  const fenced = [...text.matchAll(/```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```/gi)]
  for (const match of fenced) {
    const candidate = match[1]?.trim()
    if (!candidate) continue
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        objects.push(parsed)
      }
    } catch {
      // Ignore non-JSON fences; callers decide which shapes are required.
    }
  }
  return objects
}

/**
 * @param {unknown} value
 * @returns {value is string[]}
 */
function isStringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.trim().length > 0)
}

/**
 * @param {unknown} finding
 * @param {number} index
 * @returns {string[]}
 */
function findingShapeErrors(finding, index) {
  const errors = []
  const label = `findings[${index}]`
  if (!finding || typeof finding !== 'object' || Array.isArray(finding)) {
    return [`${label} must be an object`]
  }
  if (typeof finding.id !== 'string' || !finding.id.trim()) {
    errors.push(`${label}.id must be a non-empty string`)
  }
  if (typeof finding.canonical_summary !== 'string' || !finding.canonical_summary.trim()) {
    errors.push(`${label}.canonical_summary must be a non-empty string`)
  }
  if (typeof finding.source_thread !== 'string' || !finding.source_thread.trim()) {
    errors.push(`${label}.source_thread must be a non-empty string`)
  }
  if (!isStringArray(finding.required_evidence)) {
    errors.push(`${label}.required_evidence must be a non-empty string array`)
  }
  if (finding.expected_areas !== undefined && !isStringArray(finding.expected_areas)) {
    errors.push(`${label}.expected_areas must be an array of non-empty strings when present`)
  }
  if (finding.prohibited_areas !== undefined && !isStringArray(finding.prohibited_areas)) {
    errors.push(`${label}.prohibited_areas must be an array of non-empty strings when present`)
  }
  return errors
}

/**
 * @param {Record<string, unknown>} candidate
 * @returns {{ ok: true, contract: object } | { ok: false, errors: string[] }}
 */
function validateContractShape(candidate) {
  const errors = []
  let mode = 'implementation_pr'
  if (candidate.mode !== undefined) {
    if (candidate.mode !== 'implementation_pr' && candidate.mode !== 'planning_no_pr') {
      errors.push('mode must be implementation_pr or planning_no_pr')
    } else {
      mode = candidate.mode
    }
  }

  if (mode === 'planning_no_pr') {
    if (candidate.schema_version !== 2) {
      errors.push('schema_version must be 2 for planning_no_pr')
    }
    if (typeof candidate.planning_base !== 'string' || !/^[a-f0-9]{40}$/i.test(candidate.planning_base.trim())) {
      errors.push('planning_base must be a 40-hex string for planning_no_pr')
    }
    if (typeof candidate.planning_base_repo !== 'string' || !candidate.planning_base_repo.trim()) {
      errors.push('planning_base_repo must be a non-empty string for planning_no_pr')
    }
    if (typeof candidate.planning_base_ref !== 'string' || !candidate.planning_base_ref.trim()) {
      errors.push('planning_base_ref must be a non-empty string for planning_no_pr')
    }
  } else {
    if (candidate.schema_version !== 1 && candidate.schema_version !== 2) {
      errors.push(`schema_version must be 1 or 2 for implementation_pr`)
    }
  }

  if (typeof candidate.reviewed_head !== 'string' || !candidate.reviewed_head.trim()) {
    errors.push('reviewed_head must be a non-empty string')
  }
  if (!Array.isArray(candidate.findings) || candidate.findings.length === 0) {
    errors.push('findings must be a non-empty array')
  } else {
    const normalizedIds = new Set()
    candidate.findings.forEach((finding, index) => {
      errors.push(...findingShapeErrors(finding, index))
      if (finding && typeof finding === 'object' && typeof finding.id === 'string') {
        const normalizedId = finding.id.trim()
        if (normalizedId && normalizedIds.has(normalizedId)) {
          errors.push(`duplicate finding id (whitespace-normalized): ${finding.id}`)
        }
        normalizedIds.add(normalizedId)
      }
    })
  }
  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    contract: {
      schema_version: Number(candidate.schema_version),
      mode,
      planning_base: mode === 'planning_no_pr' ? String(candidate.planning_base).trim() : undefined,
      planning_base_repo: mode === 'planning_no_pr' ? String(candidate.planning_base_repo).trim() : undefined,
      planning_base_ref: mode === 'planning_no_pr' ? String(candidate.planning_base_ref).trim() : undefined,
      reviewed_head: String(candidate.reviewed_head).trim(),
      findings: candidate.findings.map((finding) => ({
        id: String(finding.id).trim(),
        canonical_summary: String(finding.canonical_summary).trim(),
        source_thread: String(finding.source_thread).trim(),
        required_evidence: [...finding.required_evidence],
        expected_areas: Array.isArray(finding.expected_areas) ? [...finding.expected_areas] : [],
        prohibited_areas: Array.isArray(finding.prohibited_areas) ? [...finding.prohibited_areas] : [],
      })),
    },
  }
}

/**
 * Parse the immutable correction finding contract from REVIEW_VERDICT text.
 * @param {string} text
 */
export function parseCorrectionContract(text = '') {
  const objects = extractJsonObjects(text).filter(
    (object) => Object.hasOwn(object, 'findings') && Object.hasOwn(object, 'reviewed_head'),
  )
  if (objects.length === 0) {
    return { ok: false, errors: ['missing correction finding contract JSON block'] }
  }
  if (objects.length > 1) {
    return { ok: false, errors: ['multiple correction finding contract JSON blocks are not allowed'] }
  }
  const result = validateContractShape(objects[0])
  if (result.ok && result.contract.mode === 'implementation_pr') {
    if (/\*\*PR\s*\/\s*base\s*\/\s*head:\*\*\s*none\b/i.test(text)) {
      result.contract.mode = 'planning_no_pr'
    }
  }
  return result
}

/**
 * @param {Record<string, unknown>} candidate
 */
function validateEvidenceShape(candidate) {
  const errors = []
  if (candidate.mode === 'planning_no_pr') {
    if (candidate.schema_version !== CORRECTION_EVIDENCE_SCHEMA_VERSION) {
      errors.push(`schema_version must be ${CORRECTION_EVIDENCE_SCHEMA_VERSION} for planning_no_pr`)
    }
  } else if (![1, CORRECTION_EVIDENCE_SCHEMA_VERSION].includes(candidate.schema_version)) {
    errors.push(`schema_version must be 1 or ${CORRECTION_EVIDENCE_SCHEMA_VERSION}`)
  }
  if (typeof candidate.correction_base !== 'string' || !candidate.correction_base.trim()) {
    errors.push('correction_base must be a non-empty string')
  }
  if (
    !candidate.finding_results ||
    typeof candidate.finding_results !== 'object' ||
    Array.isArray(candidate.finding_results)
  ) {
    errors.push('finding_results must be an object keyed by finding id')
  } else {
    for (const [id, entry] of Object.entries(candidate.finding_results)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        errors.push(`finding_results.${id} must be an object`)
        continue
      }
      if (!Array.isArray(entry.changed_files) || !entry.changed_files.every((item) => typeof item === 'string')) {
        errors.push(`finding_results.${id}.changed_files must be a string array`)
      }
      if (!Array.isArray(entry.tests) || !entry.tests.every((item) => typeof item === 'string')) {
        errors.push(`finding_results.${id}.tests must be a string array`)
      }
      if (![FINDING_STATUS.CLAIMED_RESOLVED, FINDING_STATUS.UNPROVEN].includes(entry.status)) {
        errors.push(`finding_results.${id}.status must be CLAIMED_RESOLVED or UNPROVEN`)
      }
    }
  }
  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    evidence: {
      schema_version: Number(candidate.schema_version),
      mode: typeof candidate.mode === 'string' && candidate.mode.trim() ? candidate.mode.trim() : undefined,
      correction_base: String(candidate.correction_base).trim(),
      finding_results: Object.fromEntries(
        Object.entries(candidate.finding_results).map(([id, entry]) => [
          id,
          {
            changed_files: [...entry.changed_files],
            tests: [...entry.tests],
            status: entry.status,
          },
        ]),
      ),
    },
  }
}

/**
 * Parse the correction RESULT evidence map from RESULT text.
 * @param {string} text
 */
export function parseCorrectionEvidenceMap(text = '') {
  const objects = extractJsonObjects(text).filter(
    (object) => Object.hasOwn(object, 'finding_results') && Object.hasOwn(object, 'correction_base'),
  )
  if (objects.length === 0) {
    return { ok: false, errors: ['missing correction RESULT evidence map JSON block'] }
  }
  if (objects.length > 1) {
    return { ok: false, errors: ['multiple correction RESULT evidence map JSON blocks are not allowed'] }
  }
  return validateEvidenceShape(objects[0])
}

/**
 * Exact identity comparison for immutable finding IDs and summaries.
 * @param {{ findings: Array<{ id: string, canonical_summary: string }> }} canonical
 * @param {{ findings: Array<{ id: string, canonical_summary: string }> }} candidate
 */
export function validateFindingIdentity(canonical, candidate) {
  const errors = []
  if (!canonical?.findings || !candidate?.findings) {
    return { ok: false, errors: ['canonical and candidate findings are required'] }
  }

  const canonicalIds = canonical.findings.map((finding) => finding.id)
  const candidateIds = candidate.findings.map((finding) => finding.id)
  const canonicalSet = new Set(canonicalIds)
  const candidateSet = new Set(candidateIds)

  for (const id of candidateIds) {
    if (!canonicalSet.has(id)) errors.push(`unknown or substituted finding id: ${id}`)
  }
  for (const id of canonicalIds) {
    if (!candidateSet.has(id)) errors.push(`omitted finding id: ${id}`)
  }
  if (canonicalIds.length !== candidateIds.length) {
    errors.push('finding set size changed by rename, addition, or omission')
  }

  const candidateById = new Map(candidate.findings.map((finding) => [finding.id, finding]))
  for (const finding of canonical.findings) {
    const match = candidateById.get(finding.id)
    if (!match) continue
    if (match.canonical_summary !== finding.canonical_summary) {
      errors.push(
        `changed summary / reinterpretation for ${finding.id}: canonical_summary must remain immutable`,
      )
    }
  }

  return { ok: errors.length === 0, errors }
}

/**
 * Build a compact correction capsule for a fresh IDE session.
 * @param {object} contract
 * @param {{ issueNumber?: string, prUrl?: string, mode?: string }} [meta]
 */
export function buildCorrectionCapsule(contract, meta = {}) {
  const findings = contract?.findings ?? []
  const mode = meta.mode ?? contract?.mode ?? 'implementation_pr'
  const lines = [
    'Correction capsule',
    meta.issueNumber ? `Issue: #${meta.issueNumber}` : 'Issue: (not provided)',
    meta.prUrl ? `PR: ${meta.prUrl}` : mode === 'planning_no_pr' ? 'PR: none' : 'PR: (not provided)',
  ]
  if (mode === 'planning_no_pr') {
    lines.push('Mode: planning_no_pr')
  }
  lines.push(`Reviewed head / correction base: ${contract?.reviewed_head ?? '(missing)'}`)
  lines.push('Canonical findings:')

  for (const finding of findings) {
    lines.push(`- ${finding.id}: ${finding.canonical_summary}`)
    lines.push(`  source_thread: ${finding.source_thread}`)
    lines.push(`  required_evidence: ${finding.required_evidence.join('; ')}`)
    if (finding.expected_areas?.length) {
      lines.push(`  expected_areas: ${finding.expected_areas.join('; ')}`)
    }
    if (mode === 'planning_no_pr') {
      const extra = finding.prohibited_areas?.length ? ` (${finding.prohibited_areas.join('; ')})` : ''
      const allowlist = derivePlanningArtifactAllowlist(contract)
      lines.push(
        `  prohibited_areas: planning canonical-artifact allowlist only (${allowlist.length ? allowlist.join('; ') : 'none declared'})${extra}`,
      )
    } else if (finding.prohibited_areas?.length) {
      lines.push(`  prohibited_areas: ${finding.prohibited_areas.join('; ')}`)
    }
  }

  if (mode === 'planning_no_pr') {
    const allowlist = derivePlanningArtifactAllowlist(contract)
    lines.push(
      `Authorized scope: only the immutable finding set above within canonical planning artifacts (${allowlist.length ? allowlist.join('; ') : 'expected_areas required'})`,
    )
  } else {
    lines.push('Authorized scope: only the immutable finding set above')
  }
  lines.push('Stop conditions: missing/malformed/conflicting findings; identity drift; incomplete evidence map')
  lines.push('Thread ownership: Delta Reviewer resolves original review threads after corrected exact-head CI')

  const playbackLine = `Playback verified: ${findings.length}/${findings.length} canonical findings`
  lines.push(playbackLine)

  return { lines, playbackLine, findingCount: findings.length }
}

/**
 * Derive the narrow planning-artifact allowlist from immutable finding expected_areas.
 * @param {object} contract
 * @returns {string[]}
 */
export function derivePlanningArtifactAllowlist(contract) {
  const allowlist = new Set()
  for (const finding of contract?.findings ?? []) {
    for (const area of finding.expected_areas ?? []) {
      const trimmed = typeof area === 'string' ? area.trim() : ''
      if (trimmed) allowlist.add(trimmed)
    }
  }
  return [...allowlist]
}

/**
 * @param {string} allowedPath
 * @param {string} filePath
 */
function pathMatchesPlanningAllowlistEntry(allowedPath, filePath) {
  if (!allowedPath || !filePath) return false
  if (allowedPath === filePath) return true
  if (allowedPath.endsWith('/') && filePath.startsWith(allowedPath)) return true
  if (filePath === allowedPath || filePath.startsWith(`${allowedPath}/`)) return true
  return false
}

/**
 * @param {string} area
 * @param {string} filePath
 */
function pathMatchesProhibitedArea(area, filePath) {
  if (!area || !filePath) return false
  if (area === filePath) return true
  if (area.endsWith('/') && filePath.startsWith(area)) return true
  if (area.includes('/') || /\.[A-Za-z0-9]+$/.test(area)) {
    return filePath === area || filePath.startsWith(`${area}/`) || filePath.includes(area)
  }
  return false
}

/**
 * Deterministic finding-to-diff / finding-to-test traceability checks.
 * Does not infer semantic correctness from file names, tests, or CI.
 *
 * @param {object} contract
 * @param {object} result evidence map object (not raw text)
 * @param {string[]} diffFiles
 * @param {{ body?: string }} [options]
 */
export function validateFindingEvidence(contract, result, diffFiles = [], options = {}) {
  const errors = []
  if (!contract?.findings?.length) {
    return { ok: false, errors: ['correction contract findings are required'] }
  }
  if (!result?.finding_results || typeof result.finding_results !== 'object') {
    return { ok: false, errors: ['finding_results are required'] }
  }

  if (
    typeof result.correction_base === 'string' &&
    result.correction_base.trim() &&
    result.correction_base.trim() !== contract.reviewed_head
  ) {
    errors.push('correction_base must match reviewed_head')
  }

  const resultIds = Object.keys(result.finding_results)
  const identity = validateFindingIdentity(
    { findings: contract.findings },
    {
      findings: resultIds.map((id) => {
        const canonical = contract.findings.find((finding) => finding.id === id)
        return {
          id,
          canonical_summary: canonical?.canonical_summary ?? `__missing__:${id}`,
        }
      }),
    },
  )
  if (!identity.ok) errors.push(...identity.errors)

  const diffSet = new Set(diffFiles)
  const scopeCheck = validateCorrectionScope(contract, diffFiles, options)
  if (!scopeCheck.ok) errors.push(...scopeCheck.errors)

  for (const finding of contract.findings) {
    const entry = result.finding_results[finding.id]
    if (!entry) continue

    if (entry.status === FINDING_STATUS.CLAIMED_RESOLVED) {
      const changedFiles = Array.isArray(entry.changed_files)
        ? entry.changed_files.filter((item) => typeof item === 'string' && item.trim())
        : []
      const tests = Array.isArray(entry.tests)
        ? entry.tests.filter((item) => typeof item === 'string' && item.trim())
        : []
      if (changedFiles.length === 0 || tests.length === 0) {
        errors.push(
          `CLAIMED_RESOLVED requires non-empty changed_files and tests evidence for ${finding.id}`,
        )
      }
      for (const filePath of changedFiles) {
        if (!diffSet.has(filePath)) {
          errors.push(`referenced changed file absent from correction diff: ${filePath}`)
        }
      }
    }
  }

  const body = typeof options.body === 'string' ? options.body : ''
  const hasUnproven = Object.values(result.finding_results).some(
    (entry) => entry?.status === FINDING_STATUS.UNPROVEN,
  )
  if (hasUnproven && /^\*\*AC audit:\*\*\s*Done\s*$/im.test(body)) {
    errors.push('unsupported free-form Done claim conflicts with UNPROVEN finding evidence')
  }

  return { ok: errors.length === 0, errors }
}

/**
 * @param {string} body
 */
export function isCorrectionPhaseResult(body = '') {
  if (/^\s*[-*]\s*Phase:\s*Dev\s*\(correction\)\s*$/im.test(body)) return true
  return extractJsonObjects(body).some(
    (object) => Object.hasOwn(object, 'finding_results') && Object.hasOwn(object, 'correction_base'),
  )
}

/**
 * @param {string} body
 */
export function isCorrectionEligibleVerdict(body = '') {
  const verdict = body.match(/^\*\*Verdict:\*\*\s*(.+?)\s*$/m)?.[1]?.trim()
  return verdict === 'CORRECTION REQUIRED'
}

/**
 * Validate correction-specific role-comment constraints.
 * @param {{ role: string | null, body: string, diffFiles?: string[], canonicalContract?: object | null }} input
 */
export function validateCorrectionRoleComment({
  role,
  body = '',
  diffFiles = [],
  canonicalContract = null,
} = {}) {
  const errors = []

  if (role === 'REVIEW_VERDICT' && isCorrectionEligibleVerdict(body)) {
    const parsed = parseCorrectionContract(body)
    if (!parsed.ok) errors.push(...parsed.errors)
  }

  if (role === 'RESULT' && isCorrectionPhaseResult(body)) {
    const evidence = parseCorrectionEvidenceMap(body)
    if (!evidence.ok) {
      errors.push(...evidence.errors)
      return { ok: false, errors }
    }

    if (!canonicalContract) {
      errors.push(
        'a reconstructed canonical correction contract is required to validate a correction RESULT; ' +
          'omitting it does not bypass identity, base, diff, or prohibited-scope validation',
      )
      return { ok: false, errors }
    }

    const validation = validateFindingEvidence(canonicalContract, evidence.evidence, diffFiles, { body, mode: canonicalContract.mode })
    if (!validation.ok) errors.push(...validation.errors)
  }

  return { ok: errors.length === 0, errors }
}

/**
 * @param {object} contract
 * @param {string[]} diffFiles
 * @param {{ mode?: string }} [options]
 */
export function validateCorrectionScope(contract, diffFiles = [], options = {}) {
  const errors = []
  const mode = options.mode ?? contract?.mode ?? 'implementation_pr'
  const prohibited = contract?.findings?.flatMap((finding) => finding.prohibited_areas ?? []) ?? []
  const planningAllowlist = mode === 'planning_no_pr' ? derivePlanningArtifactAllowlist(contract) : []

  for (const filePath of diffFiles) {
    if (mode === 'planning_no_pr') {
      if (planningAllowlist.length === 0) {
        errors.push('planning_no_pr correction requires at least one expected_areas entry in the immutable finding contract')
        continue
      }
      const allowed = planningAllowlist.some((entry) => pathMatchesPlanningAllowlistEntry(entry, filePath))
      if (!allowed) {
        errors.push(
          `prohibited scope present in correction diff: ${filePath} (outside canonical planning-artifact allowlist)`,
        )
        continue
      }
    }
    for (const area of prohibited) {
      if (pathMatchesProhibitedArea(area, filePath)) {
        errors.push(`prohibited scope present in correction diff: ${filePath} (matched ${area})`)
      }
    }
  }
  return { ok: errors.length === 0, errors }
}
