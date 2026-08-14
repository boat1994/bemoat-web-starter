import { readFileSync } from 'node:fs'

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

async function loadModules(): Promise<{ facade: SupersessionModule; typed: SupersessionModule }> {
  const facade = await import('../../scripts/mission-control/domain/merge-comment-supersession.mjs')
  const typed = await import('../../scripts/mission-control/domain/merge-comment-supersession.ts')
  return { facade, typed }
}

function invoke(module: SupersessionModule, body: unknown, targetCommentId: unknown): unknown {
  return Reflect.apply(module.commentSupersedesId, undefined, [body, targetCommentId])
}

function expectBoth(modules: { facade: SupersessionModule; typed: SupersessionModule }, body: unknown, targetCommentId: unknown, expected: boolean) {
  expect(invoke(modules.facade, body, targetCommentId)).toBe(expected)
  expect(invoke(modules.typed, body, targetCommentId)).toBe(expected)
}

describe('commentSupersedesId', () => {
  it('keeps the exact facade and one named export identity', async () => {
    const modules = await loadModules()

    expect(readFileSync('scripts/mission-control/domain/merge-comment-supersession.mjs', 'utf8'))
      .toBe("export * from './merge-comment-supersession.ts'\n")
    expect(Object.keys(modules.facade)).toEqual(['commentSupersedesId'])
    expect(Object.keys(modules.typed)).toEqual(['commentSupersedesId'])
    expect(modules.facade.commentSupersedesId).toBe(modules.typed.commentSupersedesId)
  })

  it('preserves body-first and uncaught body/target coercion exceptions', async () => {
    const modules = await loadModules()
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

    expect(() => invoke(modules.typed, body, target)).toThrow(bodyError)
    expect(targetTouched).toBe(false)

    const targetError = new Error('target coercion failed')
    const throwingTarget = {
      [Symbol.toPrimitive](): never {
        throw targetError
      },
    }
    expect(() => invoke(modules.facade, '', throwingTarget)).toThrow(targetError)
  })

  it('uses case-sensitive literal markers as substring checks with exact whitespace', async () => {
    const modules = await loadModules()

    expectBoth(modules, 'supersedes: 42', 42, true)
    expectBoth(modules, 'prefix superseded_comment_id: 42 suffix', '42', true)
    expectBoth(modules, 'SUPERSEDES: 42', 42, false)
    expectBoth(modules, 'supersedes:    42', 42, false)
    expectBoth(modules, 'supersedes:\n42', 42, false)
    expectBoth(modules, 'supersedes: 42 more evidence', 42, true)
  })

  it('runs case-insensitive regex fallback before structured parsing', async () => {
    const modules = await loadModules()

    expectBoth(modules, 'Comment 42 is SUPERSEDED', 42, true)
    expectBoth(modules, 'Comment 42 is NOT AUTHORITATIVE', 42, true)
    expectBoth(modules, 'Comment 420 is not authoritative', 42, true)
    expectBoth(modules, 'Comment 42 is authoritative', 42, false)
    expectBoth(modules, '{ malformed evidence: comment 42 is superseded', 42, true)
    expectBoth(modules, '{ malformed evidence }', 42, false)
  })

  it('fails closed for structured parser errors while delegating JSON and Markdown', async () => {
    const modules = await loadModules()

    expectBoth(modules, JSON.stringify({ supersedes_comment_id: 42 }), 42, true)
    expectBoth(modules, JSON.stringify({ supersedes_comment_ids: ['42'] }), 42, true)
    expectBoth(modules, CANONICAL_MARKDOWN, 42, false)
    expectBoth(modules, `${CANONICAL_MARKDOWN}\nextra`, 42, false)
    expectBoth(modules, '{not-json}', 42, false)
    expectBoth(modules, '[42]', 42, false)
    expectBoth(modules, '"42"', 42, false)
  })

  it('combines scalar and array IDs with String equality, nulls, and duplicates', async () => {
    const modules = await loadModules()

    expectBoth(modules, JSON.stringify({ supersedes_comment_ids: [41, 42, '42', 42], supersedes_comment_id: '42' }), 42, true)
    expectBoth(modules, JSON.stringify({ supersedes_comment_ids: [null] }), null, true)
    expectBoth(modules, JSON.stringify({ supersedes_comment_id: null }), null, false)
    expectBoth(modules, JSON.stringify({ supersedes_comment_ids: [null, 41], supersedes_comment_id: 42 }), 42, true)
    expectBoth(modules, JSON.stringify({ supersedes_comment_ids: [41, '042'], supersedes_comment_id: 43 }), 42, false)
  })

  it('does not mutate frozen evidence or target inputs and remains stateless across calls', async () => {
    const modules = await loadModules()
    const body = Object.freeze({
      toString: () => JSON.stringify({ supersedes_comment_ids: [42] }),
    })
    const target = Object.freeze({ toString: () => '42' })

    expect(invoke(modules.typed, body, target)).toBe(true)
    expect(invoke(modules.typed, body, target)).toBe(true)
    expect(Object.keys(body)).toEqual(['toString'])
    expect(Object.keys(target)).toEqual(['toString'])
    expect(Object.isFrozen(body)).toBe(true)
    expect(Object.isFrozen(target)).toBe(true)
  })
})
