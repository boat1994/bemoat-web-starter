import {
  LEGACY_BARE_CORE_VERDICT_RE,
  REQUIRED_CORRECTION_HANDOFF_PHRASES,
  REQUIRED_DOUBLE_LOOP_TRANSPORT_FIELDS,
  REQUIRED_HANDOFF_FIELDS,
  REQUIRED_RESULT_FIELDS,
  REQUIRED_VERDICTS,
} from './inventory.mjs'
import { violation } from './violation.mjs'

export function scanHandoffTemplate(relativePath, content) {
  const violations = []
  if (content == null) {
    violations.push(violation('MC011', relativePath, 'Handoff template is missing'))
    return violations
  }
  for (const field of REQUIRED_HANDOFF_FIELDS) {
    if (!content.includes(field)) {
      violations.push(violation('MC011', relativePath, `Handoff template missing field: ${field}`))
    }
  }
  return violations
}

export function scanResultTemplate(relativePath, content) {
  const violations = []
  if (content == null) {
    violations.push(violation('MC011', relativePath, 'RESULT template is missing'))
    return violations
  }
  for (const field of REQUIRED_RESULT_FIELDS) {
    if (!content.includes(field)) {
      violations.push(violation('MC011', relativePath, `RESULT template missing field: ${field}`))
    }
  }
  if (!content.includes('AWAITING_REVIEW_1')) {
    violations.push(violation('MC011', relativePath, 'RESULT template must document AWAITING_REVIEW_1 delivery state'))
  }
  for (const verdict of REQUIRED_VERDICTS) {
    if (!content.includes(verdict)) {
      violations.push(violation('MC011', relativePath, `RESULT template missing verdict: ${verdict}`))
    }
  }
  return violations
}

/**
 * Core MC-gated review transport must list the canonical verdict enum and must
 * not offer bare legacy `PASS | BLOCKED` as allowed Core verdict options.
 */
export function scanRoleHandoffContract(relativePath, content) {
  const violations = []
  if (content == null) {
    violations.push(violation('MC011', relativePath, 'Role handoff contract is missing'))
    return violations
  }
  for (const verdict of REQUIRED_VERDICTS) {
    if (!content.includes(verdict)) {
      violations.push(violation('MC011', relativePath, `Role handoff contract missing Core verdict: ${verdict}`))
    }
  }
  if (LEGACY_BARE_CORE_VERDICT_RE.test(content)) {
    violations.push(
      violation(
        'MC011',
        relativePath,
        'Role handoff contract must not use bare legacy Core verdicts (PASS | BLOCKED)',
      ),
    )
  }
  for (const field of REQUIRED_DOUBLE_LOOP_TRANSPORT_FIELDS) {
    if (!content.includes(field)) {
      violations.push(violation('MC011', relativePath, `Role handoff contract missing Double-Loop field: ${field}`))
    }
  }
  for (const phrase of REQUIRED_CORRECTION_HANDOFF_PHRASES) {
    if (!content.includes(phrase)) {
      violations.push(
        violation('MC011', relativePath, `Role handoff contract missing immutable correction transport: ${phrase}`),
      )
    }
  }
  return violations
}
