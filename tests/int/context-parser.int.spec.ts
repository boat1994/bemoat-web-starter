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
      taskSize: null,
      missionControlMode: null,
      workflowProfile: null,
    })
  })

  it('recognizes "Scope boundaries" as scope evidence', () => {
    const parsed = parseIssueBody(`
## Goal

Some goal.

## Scope boundaries

Expected implementation is narrow.
`)

    expect(parsed.scope).toBe('Expected implementation is narrow.')
  })

  it.each([
    'Objective boundary',
    'Current objective boundary',
    'Historical objective boundary',
  ])('does not treat "%s" prose as durable Issue scope authority', (heading) => {
    const parsed = parseIssueBody(`
## Goal

Some goal.

## ${heading}

This text may describe an earlier workflow checkpoint.
`)

    expect(parsed.scope).toBeNull()
  })

  it('rejects unrelated headings for scope', () => {
    const parsed = parseIssueBody(`
## Goal

Some goal.

## Scoped things
Not scope.

## My Scope
Not scope.

## Boundaries of Scope
Not scope.
`)

    expect(parsed.scope).toBeNull()
  })

  it('reconstructs both objective and scope for an Issue body shaped like live Issue #434', () => {
    const parsed = parseIssueBody(`
## Goal

Fix the retained current-context Issue parser so the public bemoat:context:sync-base command recognizes the repository's existing "## Scope boundaries" heading as valid scope evidence.

## Scope boundaries

- scripts/context/issue-parser.ts
- directly owned parser/context-sync tests
`)

    expect(parsed.objective).toBe('Fix the retained current-context Issue parser so the public bemoat:context:sync-base command recognizes the repository\'s existing "## Scope boundaries" heading as valid scope evidence.')
    expect(parsed.scope).toBe('- scripts/context/issue-parser.ts\n- directly owned parser/context-sync tests')
  })

  it('treats legacy required Mission Control declarations as STANDARD metadata', () => {
    const parsed = parseIssueBody(`
## Goal

Retire a legacy workflow surface.

**Task size**: core
Mission Control mode: required
Main Issue: #410
Implementation Plan: docs/superpowers/plans/example/implementation-plan.md
`)

    expect(parsed.missionControlMode).toBe('required')
    expect(parsed.workflowProfile).toBe('STANDARD')
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
