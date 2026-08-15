import { existsSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

type SupersessionModule = {
  commentSupersedesId: (body: unknown, targetCommentId: string | number) => boolean
}

const CANONICAL_MARKDOWN = [
  '## FOUNDER_DECISION',
  '',
  '**Decision:** APPROVE MERGE COMPLETION',
  '**Authority:** Founder',
  '**Author:** @boat1994',
  '**Repository:** `boat1994/bemoat-web-starter`',
  '**Task / Issue:** #333',
  '**PR:** PR #339',
  '**Approved base:** `main`',
  `**Exact reviewed head:** \`${'a'.repeat(40)}\``,
  '**REVIEW_VERDICT comment ID:** 123',
  '**Action:** merge',
  '**Scope:** merge',
  `**Policy source SHA:** \`${'b'.repeat(40)}\``,
  `**Protected base SHA:** \`${'c'.repeat(40)}\``,
  '**Non-superseded:** true',
].join('\n')

async function loadModule(): Promise<SupersessionModule> {
  return import('../../scripts/mission-control/domain/merge-comment-supersession.ts')
}

function invoke(module: SupersessionModule, body: unknown, targetCommentId: unknown): unknown {
  return Reflect.apply(module.commentSupersedesId, undefined, [body, targetCommentId])
}

describe('commentSupersedesId', () => {
  it('keeps the TypeScript implementation and one named export after facade removal', async () => {
    const typed = await loadModule()

    expect(existsSync('scripts/mission-control/domain/merge-comment-supersession.mjs')).toBe(false)
    expect(Object.keys(typed)).toEqual(['commentSupersedesId'])
  })

  it('preserves body-first and uncaught body/target coercion exceptions', async () => {
    const typed = await loadModule()
    const bodyError = new Error('body coercion failed')
    let targetTouched = false
    const body = {
      [Symbol.toPrimitive](): never {
        throw bodyError
      },
    }
    const target = {
      [Symbol.toPrimitive](): string {
        targetTouched = true
        return '42'
      },
    }

    expect(() => invoke(typed, body, target)).toThrow(bodyError)
    expect(targetTouched).toBe(false)

    const targetError = new Error('target coercion failed')
    const throwingTarget = {
      [Symbol.toPrimitive](): never {
        throw targetError
      },
    }
    expect(() => invoke(typed, '', throwingTarget)).toThrow(targetError)
  })

  it('uses case-sensitive literal markers as substring checks with exact whitespace', async () => {
    const typed = await loadModule()

    expect(invoke(typed, 'supersedes: 42', 42)).toBe(true)
    expect(invoke(typed, 'prefix superseded_comment_id: 42 suffix', '42')).toBe(true)
    expect(invoke(typed, 'SUPERSEDES: 42', 42)).toBe(false)
    expect(invoke(typed, 'supersedes:    42', 42)).toBe(false)
    expect(invoke(typed, 'supersedes:\n42', 42)).toBe(false)
    expect(invoke(typed, 'supersedes: 42 more evidence', 42)).toBe(true)
  })

  it('runs case-insensitive regex fallback before structured parsing', async () => {
    const typed = await loadModule()

    expect(invoke(typed, 'Comment 42 is SUPERSEDED', 42)).toBe(true)
    expect(invoke(typed, 'Comment 42 is NOT AUTHORITATIVE', 42)).toBe(true)
    expect(invoke(typed, 'Comment 420 is not authoritative', 42)).toBe(true)
    expect(invoke(typed, 'Comment 42 is authoritative', 42)).toBe(false)
    expect(invoke(typed, '{ malformed evidence: comment 42 is superseded', 42)).toBe(true)
    expect(invoke(typed, '{ malformed evidence }', 42)).toBe(false)
  })

  it('fails closed for structured parser errors while delegating JSON and Markdown', async () => {
    const typed = await loadModule()

    expect(invoke(typed, JSON.stringify({ supersedes_comment_id: 42 }), 42)).toBe(true)
    expect(invoke(typed, JSON.stringify({ supersedes_comment_ids: ['42'] }), 42)).toBe(true)
    expect(invoke(typed, CANONICAL_MARKDOWN, 42)).toBe(false)
    expect(invoke(typed, `${CANONICAL_MARKDOWN}\nextra`, 42)).toBe(false)
    expect(invoke(typed, '{not-json}', 42)).toBe(false)
    expect(invoke(typed, '[42]', 42)).toBe(false)
    expect(invoke(typed, '"42"', 42)).toBe(false)
  })

  it('combines scalar and array IDs with String equality, nulls, and duplicates', async () => {
    const typed = await loadModule()

    expect(invoke(typed, JSON.stringify({ supersedes_comment_ids: [41, 42, '42', 42], supersedes_comment_id: '42' }), 42)).toBe(true)
    expect(invoke(typed, JSON.stringify({ supersedes_comment_ids: [null] }), null)).toBe(true)
    expect(invoke(typed, JSON.stringify({ supersedes_comment_id: null }), null)).toBe(false)
    expect(invoke(typed, JSON.stringify({ supersedes_comment_ids: [null, 41], supersedes_comment_id: 42 }), 42)).toBe(true)
    expect(invoke(typed, JSON.stringify({ supersedes_comment_ids: [41, '042'], supersedes_comment_id: 43 }), 42)).toBe(false)
  })

  it('does not mutate frozen evidence or target inputs and remains stateless across calls', async () => {
    const typed = await loadModule()
    const body = Object.freeze({
      toString: () => JSON.stringify({ supersedes_comment_ids: [42] }),
    })
    const target = Object.freeze({ toString: () => '42' })

    expect(invoke(typed, body, target)).toBe(true)
    expect(invoke(typed, body, target)).toBe(true)
    expect(Object.keys(body)).toEqual(['toString'])
    expect(Object.keys(target)).toEqual(['toString'])
    expect(Object.isFrozen(body)).toBe(true)
    expect(Object.isFrozen(target)).toBe(true)
  })
})
