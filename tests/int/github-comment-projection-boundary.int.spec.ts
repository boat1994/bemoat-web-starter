import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildScriptImportGraph } from '../../scripts/guards/scripts-architecture.mjs'
import { managedPaths } from '../../scripts/boilerplate/inventory.mjs'

const rootPath = resolve(process.cwd(), 'scripts/github-comment-projection.mjs')
const destinationPath = resolve(
  process.cwd(),
  'scripts/mission-control/diagnostics/github-comment-projection.mjs',
)

const publicExports = [
  'benchmarkProjection',
  'isExplicitlyNonAuthoritativeRoleBody',
  'projectComments',
  'selectActiveRoleComments',
  'selectAuthoritativeRoleComments',
]

describe('GitHub comment projection boundary', () => {
  it('keeps the diagnostics destination authoritative after root removal', async () => {
    const destinationProjection = await import(
      '../../scripts/mission-control/diagnostics/github-comment-projection.mjs'
    )

    expect(existsSync(rootPath)).toBe(false)
    expect(Object.keys(destinationProjection).sort()).toEqual(publicExports.sort())
    expect(readFileSync(destinationPath, 'utf8')).not.toMatch(
      /github-comment-projection\.mjs/,
    )
  })

  it('keeps the destination independent of the root facade and in managed delivery', () => {
    const graph = buildScriptImportGraph(process.cwd())
    const imports = graph.get('scripts/mission-control/diagnostics/github-comment-projection.mjs') ?? new Set()

    expect(imports).not.toContain('scripts/github-comment-projection.mjs')
    expect(imports).toContain('scripts/mission-control/review-verdict-binding.mjs')
    expect(managedPaths).not.toContain('scripts/github-comment-projection.mjs')
    expect(managedPaths).toContain('scripts/mission-control')
  })

  it('preserves supersession and Founder negative controls in fixture-local inputs', async () => {
    const destinationProjection = await import(
      '../../scripts/mission-control/diagnostics/github-comment-projection.mjs'
    )
    const fixture = [
      {
        id: 'authoritative',
        body: '## RESULT\n\n**PR:** #335\n**Branch / Head:** `refactor/328` / `abc123`',
        createdAt: '2023-02-01T00:00:00Z',
        url: 'http://authoritative',
      },
      {
        id: 'superseded',
        body: '## RESULT\n\nOld result',
        createdAt: '2023-01-01T00:00:00Z',
        url: 'http://superseded',
      },
      {
        id: 'founder-like',
        body: 'Founder decision: pending\n' + 'F'.repeat(700),
        url: 'http://founder-like',
      },
      {
        id: 'non-authoritative-founder-like',
        body: 'Founder-like note\n' + 'N'.repeat(700),
        url: 'http://founder-like-2',
      },
    ]

    const projected = destinationProjection.projectComments(fixture)
    expect(projected[0].body).toBe(fixture[0].body)
    expect(projected[1].body).toContain('[Superseded RESULT comment')
    expect(projected[2].body).toBe(fixture[2].body)
    expect(projected[3].body).toContain('[Comment truncated for context size')
  })

  it('preserves malformed timestamps and duplicate active role diagnostics', async () => {
    const destinationProjection = await import(
      '../../scripts/mission-control/diagnostics/github-comment-projection.mjs'
    )
    const fixture = [
      { id: 'malformed', body: '## HANDOFF\n\nMalformed timestamp', createdAt: 'not-a-date', url: 'http://malformed' },
      { id: 'missing', body: '## HANDOFF\n\nMissing timestamp', url: 'http://missing' },
      { id: 'duplicate-a', body: '## REVIEW_VERDICT\n\n[Diagnostic] A', createdAt: '2023-01-01T00:00:00Z', url: 'http://a' },
      { id: 'duplicate-b', body: '## REVIEW_VERDICT\n\n[Diagnostic] B', createdAt: '2023-01-01T00:00:00Z', url: 'http://b' },
    ]

    const projected = destinationProjection.projectComments(fixture)
    expect(projected[0].body).toBe(fixture[0].body)
    expect(projected[1].body).toBe(fixture[1].body)
    expect(projected.filter((comment) => comment.body.includes('[Superseded REVIEW_VERDICT comment')).length).toBe(2)
  })

  it('keeps truncation boundary and invalid comment-body behavior exact', async () => {
    const destinationProjection = await import(
      '../../scripts/mission-control/diagnostics/github-comment-projection.mjs'
    )
    const fixture = [
      { id: 'boundary', body: 'B'.repeat(500), url: 'http://boundary' },
      { id: 'over-boundary', body: 'O'.repeat(501), url: 'http://over-boundary' },
      { id: 'invalid', body: null as string | null, body_html: null as string | null, url: 'http://invalid' },
    ]

    const projected = destinationProjection.projectComments(fixture)
    expect(projected[0].body).toBe(fixture[0].body)
    expect(projected[1].body).toContain('[Comment truncated for context size')
    expect(projected[2].body).toBe('')
  })
})
