import { violation } from './violation.mjs'

const REQUIRED_DISPATCH_ARGS = [
  'pnpm run bemoat:mission-control:dispatch',
  '-- <issue-number>',
  '[--repo <owner>/<repo>]',
  '[--body-file <handoff-file>]',
  '[--founder-correction]',
  '[--workflow-mode <mode>]',
  '[--planning-base-sha <commit-sha>]'
]

const REQUIRED_REVIEW_ARGS = [
  'pnpm run bemoat:mission-control:review',
  '-- <issue-number>',
  '--body-file <verdict-file>',
  '--expected-state <state>',
  '--review-type <full|delta>',
  '--expected-head <exact-pr-head-sha>',
  '[--repo <owner>/<repo>]'
]

const REQUIRED_RECONCILE_ARGS = [
  'pnpm run bemoat:mission-control:reconcile',
  '-- <issue-number>',
  '[--repo <owner>/<repo>]'
]

const REQUIRED_MERGE_ARGS = [
  'pnpm run bemoat:mission-control:merge',
  '-- <issue-number>',
  '--repo <owner>/<repo>',
  '--authorization-comment <role-comment-id>'
]

const REQUIRED_RECOVERY_ARGS = [
  'pnpm run bemoat:mission-control:recover-review',
  '-- 274',
  '--repo boat1994/bemoat-web-starter',
  '--expected-pr 275',
  '--expected-base main',
  '--expected-state AWAITING_REVIEW_2',
  '--expected-head <full-40-character-sha>',
  '--expected-review-cycle 1',
  '--expected-full-review-count 1',
  '--review-type delta',
  '--issue-source-comment 5187836238',
  '--pr-source-comment 5187837555',
  '--original-review-comment <immutable-comment-id>',
  '--correction-result-comment <immutable-comment-id>',
  '--body-file <canonical-recovery-verdict.md>',
]

const REQUIRED_ADOPT_FINDING_ARGS = [
  'pnpm run bemoat:mission-control:adopt-finding',
  '-- <issue-number>',
  '--repo <owner>/<repo>',
  '--expected-pr <number>',
  '--expected-base <branch>',
  '--expected-base-sha <full-sha>',
  '--expected-state <CORRECTION_REQUIRED_1|CORRECTION_REQUIRED_2>',
  '--expected-reviewed-head <full-sha>',
  '--expected-adoption-head <full-sha>',
  '--predecessor-comment <id>',
  '--authorization-comment <id>',
  '[--check]',
]

const REQUIRED_REBIND_REVIEW_LINEAGE_ARGS = [
  'pnpm run bemoat:mission-control:rebind-review-lineage',
  '-- 259',
  '--repo boat1994/bemoat-web-starter',
  '--expected-pr 260',
  '--expected-base main',
  '--expected-state ELIGIBLE_FOR_FOUNDER_REVIEW',
  '--expected-head <full-40-character-sha>',
  '--expected-review-cycle 1',
  '--expected-full-review-count 1',
  '--source-comment 5163387315',
  '--authorization-comment <immutable-comment-id>',
  '--body-file <canonical-review-verdict.md>',
]

const REQUIRED_RECOVER_STATE_ARGS = [
  'pnpm run bemoat:mission-control:recover-state',
  '-- <issue-number>',
  '--repo <owner>/<repo>',
  '--expected-pr <number>',
  '--expected-base <branch>',
  '--expected-base-sha <full-sha>',
  '--expected-head <full-sha>',
  '--expected-branch <branch>',
  '--predecessor-comment <id>',
  '--adoption-authorization-comment <id>',
  '--implementation-result-comment <id>',
  '--implementation-review-comment <id>',
  '--recovery-authorization-comment <id>',
  '--lineage-correction-authorization-comment <id>',
  '--correction-result-comment <id>',
  '--correction-review-comment <id>',
  '[--check]',
]

export function scanCommandReferenceContent(relativePath, content) {
  const violations = []

  if (content == null) {
    violations.push(violation('MC020', relativePath, 'Canonical Mission Control command reference is missing'))
    return violations
  }

  for (const arg of REQUIRED_DISPATCH_ARGS) {
    if (!content.includes(arg)) {
      violations.push(violation('MC021', relativePath, `Command reference missing dispatch arg: ${arg}`))
    }
  }

  for (const arg of REQUIRED_REVIEW_ARGS) {
    if (!content.includes(arg)) {
      violations.push(violation('MC022', relativePath, `Command reference missing review arg: ${arg}`))
    }
  }

  for (const arg of REQUIRED_RECONCILE_ARGS) {
    if (!content.includes(arg)) {
      violations.push(violation('MC023', relativePath, `Command reference missing reconcile arg: ${arg}`))
    }
  }

  for (const arg of REQUIRED_MERGE_ARGS) {
    if (!content.includes(arg)) {
      violations.push(violation('MC024', relativePath, `Command reference missing merge arg: ${arg}`))
    }
  }

  for (const arg of REQUIRED_RECOVERY_ARGS) {
    if (!content.includes(arg)) {
      violations.push(violation('MC029', relativePath, `Command reference missing review-recovery arg: ${arg}`))
    }
  }

  for (const arg of REQUIRED_ADOPT_FINDING_ARGS) {
    if (!content.includes(arg)) {
      violations.push(violation('MC030', relativePath, `Command reference missing adopt-finding arg: ${arg}`))
    }
  }

  for (const arg of REQUIRED_RECOVER_STATE_ARGS) {
    if (!content.includes(arg)) {
      violations.push(violation('MC031', relativePath, `Command reference missing missing-state recovery arg: ${arg}`))
    }
  }

  for (const arg of REQUIRED_REBIND_REVIEW_LINEAGE_ARGS) {
    if (!content.includes(arg)) {
      violations.push(violation('MC032', relativePath, `Command reference missing review-lineage-rebind arg: ${arg}`))
    }
  }

  const expectedTableHeaders = [
    '| Command |',
    '| `dispatch` |',
    '| `review` |',
    '| `reconcile` |',
    '| `adopt-finding` |',
    '| `recover-state` |',
    '| `merge` |',
    '| `recover-review` |',
    '| `rebind-review-lineage` |',
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
    'Dispatch does not own `AWAITING_REVIEW_1` transitions.',
    'Rerun the same canonical review command. Do not post another verdict manually.',
    'Do not edit the immutable authorization comment.',
    '### Dispatch checks',
    '### Review checks',
    '### Reconcile checks',
    '### Merge checks',
    '## Review recovery',
    '## Review lineage rebind',
    'scripts/mission-control/transport-registry.mjs',
    'NONCANONICAL_ROLE_EVIDENCE',
    'resulting counters `2/1`',
    'retires after required legacy lineage migrations complete',
  ]

  for (const invariant of semanticInvariants) {
    if (!content.includes(invariant)) {
      violations.push(violation('MC028', relativePath, `Command reference missing semantic invariant: ${invariant}`))
    }
  }

  return violations
}
