import { describe, expect, it } from 'vitest'

import { parseIssueBody, parseRoleEvidence } from '../../scripts/context/issue-parser.ts'

describe('bemoat:context Issue parsing', () => {
  it('extracts objective, scope, acceptance criteria, and dependencies from stable headings', () => {
    const parsed = parseIssueBody(`
## Goal

Reconstruct a bounded task from native evidence.

## Scope

Only the read-only context command.

## Acceptance Criteria

- [ ] The command is deterministic.
- [x] The command performs no mutation.

## Explicit Dependencies

- Protected main policy.
- Exact-head CI evidence.
`)

    expect(parsed).toEqual({
      objective: 'Reconstruct a bounded task from native evidence.',
      scope: 'Only the read-only context command.',
      acceptanceCriteria: [
        'The command is deterministic.',
        'The command performs no mutation.',
      ],
      dependencies: [
        'Protected main policy.',
        'Exact-head CI evidence.',
      ],
    })
  })

  it('treats role comments as evidence and never projects historical RESULT into current state', () => {
    const comments = [
      {
        id: 12,
        body: '## RESULT\n\nHistorical implementation evidence.',
        createdAt: '2026-08-22T00:00:00Z',
        url: 'https://github.com/example/repo/issues/410#issuecomment-12',
      },
      {
        id: 13,
        body: '## HANDOFF\n\nNext: run exact-head verification.',
        createdAt: '2026-08-23T00:00:00Z',
        url: 'https://github.com/example/repo/issues/410#issuecomment-13',
      },
      {
        id: 14,
        body: '## HANDOFF\n\nMalformed comment.',
        createdAt: 'not-a-date',
        url: 'https://github.com/example/repo/issues/410#issuecomment-14',
      },
    ]

    expect(parseRoleEvidence(comments)).toEqual({
      latestHandoff: comments[1],
      historicalResults: [comments[0]],
      invalid: [comments[2]],
    })
  })
})
