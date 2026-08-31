import { violation } from './violation.mjs'

export function scanCommandReferenceContent(relativePath, content) {
  const violations = []

  if (content == null) {
    violations.push(violation('MC020', relativePath, 'Canonical Mission Control command reference is missing'))
    return violations
  }

  const expectedTableHeaders = [
    '| Command |',
    '| `review` |',
  ]

  for (const phrase of expectedTableHeaders) {
    if (!content.includes(phrase)) {
      violations.push(violation('MC025', relativePath, `Command reference missing selection table element: ${phrase}`))
    }
  }

  if (!content.includes('## Preflight checklist')) {
    violations.push(violation('MC026', relativePath, 'Command reference missing preflight checklist'))
  }

  if (!content.includes('## Partial failure and retry behavior')) {
    violations.push(violation('MC027', relativePath, 'Command reference missing partial failure table'))
  }

  const semanticInvariants = [
    'Do not edit the immutable authorization comment.',
    '### Review checks',
    'NONCANONICAL_ROLE_EVIDENCE',
    'resulting counters `2/1`',
  ]

  for (const invariant of semanticInvariants) {
    if (!content.includes(invariant)) {
      violations.push(violation('MC028', relativePath, `Command reference missing semantic invariant: ${invariant}`))
    }
  }

  return violations
}
