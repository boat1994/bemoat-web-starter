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

  const expectedTableHeaders = [
    '| Command |',
    '| dispatch |',
    '| review |',
    '| reconcile |',
    '| merge |'
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

  return violations
}
