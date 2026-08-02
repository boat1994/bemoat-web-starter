import {
  DOUBLE_LOOP_ALLOWED_DECISIONS,
  DOUBLE_LOOP_FAILURE_CLASSES,
  MODULE_MIGRATION_PATH,
  MODULE_PROCEDURES_PATH,
  MODULE_SECTION_MAP,
  MODULE_TEMPLATES_PATH,
  REQUIRED_PLANNING_MIGRATION_PHRASES,
  REQUIRED_SAFE_BUNDLE_PROCEDURE_PHRASES,
  REQUIRED_SAFE_BUNDLE_TEMPLATE_PHRASES,
} from './inventory.mjs'
import { violation } from './violation.mjs'

export function scanModuleContent(relativePath, content) {
  const violations = []
  if (content == null) {
    violations.push(violation('MC013', relativePath, 'Required module is missing'))
    return violations
  }

  const sectionMap = MODULE_SECTION_MAP[relativePath]
  if (sectionMap) {
    for (const heading of sectionMap) {
      if (!content.includes(heading)) {
        violations.push(violation('MC005', relativePath, `Required module section missing: ${heading}`))
      }
    }
  }

  if (relativePath === MODULE_PROCEDURES_PATH) {
    if (!content.includes('AWAITING_REVIEW_1 state block')) {
      violations.push(
        violation('MC012', relativePath, 'Module must require atomic delivery to AWAITING_REVIEW_1'),
      )
    }
    if (!content.includes('must never increment `review_cycle` or `full_review_count`')) {
      violations.push(
        violation('MC012', relativePath, 'Module must forbid Dev from incrementing review counters'),
      )
    }
    for (const failureClass of DOUBLE_LOOP_FAILURE_CLASSES) {
      if (!content.includes(failureClass)) {
        violations.push(
          violation('MC012', relativePath, `Module missing Double-Loop failure class: ${failureClass}`),
        )
      }
    }
    for (const decision of DOUBLE_LOOP_ALLOWED_DECISIONS) {
      if (!content.includes(decision)) {
        violations.push(
          violation('MC012', relativePath, `Module missing Double-Loop decision: ${decision}`),
        )
      }
    }
    if (!content.includes('`UNKNOWN` must not authorize another materially similar edit.')) {
      violations.push(
        violation('MC012', relativePath, 'Module must prohibit UNKNOWN from authorizing a similar edit'),
      )
    }
    if (!content.includes('no-code diagnostic checkpoint')) {
      violations.push(
        violation('MC012', relativePath, 'Module must define the Double-Loop gate as a no-code checkpoint'),
      )
    }
    for (const phrase of REQUIRED_SAFE_BUNDLE_PROCEDURE_PHRASES) {
      if (!content.includes(phrase)) {
        violations.push(
          violation('MC012', relativePath, `Module missing safe merge-completion invariant: ${phrase}`),
        )
      }
    }
  }

  if (relativePath === MODULE_TEMPLATES_PATH) {
    for (const phrase of REQUIRED_SAFE_BUNDLE_TEMPLATE_PHRASES) {
      if (!content.includes(phrase)) {
        violations.push(
          violation('MC012', relativePath, `Module missing complete merge template field: ${phrase}`),
        )
      }
    }
  }

  if (relativePath === MODULE_MIGRATION_PATH) {
    for (const phrase of REQUIRED_PLANNING_MIGRATION_PHRASES) {
      if (!content.includes(phrase)) {
        violations.push(
          violation('MC012', relativePath, `Module missing Issue #248 migration invariant: ${phrase}`),
        )
      }
    }
  }

  return violations
}
