import { describe, it, expect } from 'vitest'
import {
  projectComments,
  benchmarkProjection,
  selectAuthoritativeRoleComments,
} from '../../scripts/mission-control/diagnostics/github-comment-projection.mjs'
import { findLatestRoleComment } from '../../scripts/mission-control-reconcile.mjs'

type ProjectedComment = { id: string, body: string, path?: string, line?: number, inReplyTo?: string, startLine?: number, side?: string, startSide?: string, pullRequestReviewId?: string, updatedAt?: string, author?: string, createdAt?: string, url?: string }

describe('GitHub Comment Projection', () => {
  it('strips body_html when body is present', () => {
    const raw = [{
      id: '1',
      body: 'Hello *world*',
      body_html: '<p>Hello <em>world</em></p>',
      author: { login: 'user1' },
      createdAt: '2023-01-01T00:00:00Z',
      url: 'https://github.com/a/b/issue/1#comment-1'
    }]
    const projected = projectComments(raw) as ProjectedComment[]
    expect(projected[0].body).toBe('Hello *world*')
    expect(projected[0]).not.toHaveProperty('body_html')
    expect(projected[0].id).toBe('1')
  })

  it('falls back to body_html when body is missing', () => {
    const raw = [{
      id: '2',
      body_html: '<p>Fallback html</p>',
      url: 'http://a'
    }]
    const projected = projectComments(raw) as ProjectedComment[]
    expect(projected[0].body).toBe('<p>Fallback html</p>')
  })

  it('derives the numeric issue comment id from the canonical URL when GraphQL id is nonnumeric', () => {
    const projected = projectComments([{
      id: 'IC_kwDOS4T8888AAAABQO4KUw',
      databaseId: null,
      body: '## RESULT\n\nlive result',
      url: 'https://github.com/boat1994/bemoat-web-starter/issues/333#issuecomment-5384309331',
    }]) as ProjectedComment[]

    expect(projected[0].id).toBe('5384309331')
  })

  it('prefers a positive databaseId over a nonnumeric GraphQL id without a URL', () => {
    const projected = projectComments([{
      id: 'IC_kwDOS4T8888AAAABQO4KUw',
      databaseId: 5384309331,
      body: '## RESULT\n\nlive result',
    }]) as ProjectedComment[]

    expect(projected[0].id).toBe(5384309331)
  })

  it('keeps later historical canonical RESULT tuples available to tuple-bound selection', () => {
    const currentHead = '2'.repeat(40)
    const historicalHead = '3'.repeat(40)
    const resultBody = (pr: string, head: string, summary: string) => [
      '## RESULT', '', '**Task / Issue:** #333',
      `**State:** base \`main\` · head \`${head}\``,
      `**PR:** https://github.com/boat1994/bemoat-web-starter/pull/${pr}`,
      `**Summary:** ${summary}`,
    ].join('\n')
    const raw = [
      { id: 'current', body: resultBody('366', currentHead, 'current'), createdAt: '2026-08-23T12:00:00Z' },
      { id: 'historical', body: resultBody('365', historicalHead, 'historical'), createdAt: '2026-08-23T13:00:00Z' },
    ]

    const projected = projectComments(raw) as ProjectedComment[]
    const selected = findLatestRoleComment(projected, 'RESULT', {
      taskId: '333', prNumber: '366', base: 'main', headSha: currentHead,
    })

    expect(projected.map((comment) => comment.body)).toEqual(raw.map((comment) => comment.body))
    expect(selected?.comment.id).toBe('current')
  })

  it('keeps duplicate current canonical RESULTs visible so tuple selection fails closed', () => {
    const currentHead = '2'.repeat(40)
    const resultBody = (summary: string) => [
      '## RESULT', '', '**Task / Issue:** #333',
      `**State:** base \`main\` · head \`${currentHead}\``,
      '**PR:** https://github.com/boat1994/bemoat-web-starter/pull/366',
      `**Summary:** ${summary}`,
    ].join('\n')
    const raw = [
      { id: 'current-one', body: resultBody('one'), createdAt: '2026-08-23T12:00:00Z' },
      { id: 'current-two', body: resultBody('two'), createdAt: '2026-08-23T13:00:00Z' },
    ]

    const projected = projectComments(raw) as ProjectedComment[]

    expect(projected.map((comment) => comment.body)).toEqual(raw.map((comment) => comment.body))
    expect(findLatestRoleComment(projected, 'RESULT', {
      taskId: '333', prNumber: '366', base: 'main', headSha: currentHead,
    })).toBeNull()
  })

  it('rejects contradictory positive numeric comment identities', () => {
    const projected = projectComments([{
      id: 'IC_kwDOS4T8888AAAABQO4KUw',
      databaseId: 5384309331,
      body: '## RESULT\n\ncontradictory identity',
      url: 'https://github.com/boat1994/bemoat-web-starter/issues/333#issuecomment-5384309332',
    }]) as ProjectedComment[]

    expect(projected[0].id).toBeNull()
  })

  it('preserves a synthetic nonnumeric id when no numeric comment URL exists', () => {
    const projected = projectComments([{
      id: 'synthetic-result',
      databaseId: null,
      body: '## RESULT\n\nsynthetic result',
      url: 'https://example.test/synthetic-result',
    }]) as ProjectedComment[]

    expect(projected[0].id).toBe('synthetic-result')
  })

  it('preserves inline finding lineage metadata', () => {
    const raw = [{
      id: '3',
      body: 'Fix this',
      path: 'src/main.ts',
      line: 42,
      inReplyTo: '0',
      url: 'http://a'
    }]
    const projected = projectComments(raw) as ProjectedComment[]
    expect(projected[0].path).toBe('src/main.ts')
    expect(projected[0].line).toBe(42)
    expect(projected[0].inReplyTo).toBe('0')
  })

  it('preserves all viable role candidates until canonical phase evaluation completes (MC-R1-002)', () => {
    const raw = [
      {
        id: 'old-handoff',
        body: '## HANDOFF\n\nOld handoff body that is very long. '.repeat(20),
        createdAt: '2023-01-01T00:00:00Z',
        url: 'http://old'
      },
      {
        id: 'new-handoff',
        body: '## HANDOFF\n\nNew handoff body that is very long. '.repeat(20),
        // Missing timestamps intentionally to prove missing timestamps don't break preservation
        url: 'http://new'
      },
      {
        id: 'older-handoff',
        body: '## HANDOFF\n\nOlder handoff body that is very long. '.repeat(20),
        createdAt: '2022-01-01T00:00:00Z',
        url: 'http://older'
      }
    ]
    const projected = projectComments(raw) as ProjectedComment[]
    
    // new-handoff has a missing timestamp so it must be preserved
    expect(projected[1].body).toBe(raw[1].body)
    
    // old-handoff is the latest one with a valid timestamp, so it is preserved
    expect(projected[0].body).toBe(raw[0].body)

    // older-handoff is superseded by old-handoff, so it should be compacted
    expect(projected[2].body).toContain('[Superseded HANDOFF comment')
  })

  it('preserves required review/thread metadata for every comment class (MC-R1-003)', () => {
    const raw = [
      // Issue comment / PR conversation comment
      { id: '1', body: 'Issue comment', author: { login: 'u1' }, createdAt: '2023-01-01T00:00:00Z', url: 'http://1' },
      // Top-level inline review comment
      { id: '2', body: 'Top inline', path: 'src/main.ts', line: 42, side: 'RIGHT', pull_request_review_id: 'pr-rev-1', url: 'http://2' },
      // Inline reply
      { id: '3', body: 'Reply', in_reply_to_id: '2', url: 'http://3' },
      // Multiline review range
      { id: '4', body: 'Multiline', path: 'src/main.ts', start_line: 40, start_side: 'RIGHT', line: 42, side: 'RIGHT', url: 'http://4' },
      // Missing-Markdown fallback
      { id: '5', body_html: '<p>HTML only</p>', url: 'http://5' }
    ]
    const projected = projectComments(raw) as ProjectedComment[]
    
    expect(projected[0].id).toBe('1')
    expect(projected[0].author).toBe('u1')
    
    expect(projected[1].path).toBe('src/main.ts')
    expect(projected[1].line).toBe(42)
    expect(projected[1].side).toBe('RIGHT')
    expect(projected[1].pullRequestReviewId).toBe('pr-rev-1')
    
    expect(projected[2].inReplyTo).toBe('2')
    
    expect(projected[3].startLine).toBe(40)
    expect(projected[3].startSide).toBe('RIGHT')
    expect(projected[3].line).toBe(42)
    
    expect(projected[4].body).toBe('<p>HTML only</p>')
  })

  it('truncates long non-authoritative comments', () => {
    const raw = [{
      id: '4',
      body: 'A'.repeat(1000),
      url: 'http://a'
    }]
    const projected = projectComments(raw) as ProjectedComment[]
    expect(projected[0].body.length).toBeLessThan(1000)
    expect(projected[0].body).toContain('[Comment truncated for context size')
  })

  it('preserves Founder decision evidence completely', () => {
    const raw = [{
      id: '5',
      body: 'Some long body. '.repeat(50) + '\nfounder_decision: approved\n',
      url: 'http://a'
    }]
    const projected = projectComments(raw)
    expect(projected[0].body).toBe(raw[0].body)
  })

  it('produces benchmarks showing truncation behavior and selection accuracy on representative large Issue fixtures (MC-R1-004)', () => {
    const raw = [
      {
        id: 'old-role',
        body: '## RESULT\n\n' + 'A'.repeat(5000), // Superseded, will be compacted
        body_html: '<h2>RESULT</h2>' + '<p>A</p>'.repeat(5000),
        url: 'http://old',
        createdAt: '2023-01-01T00:00:00Z'
      },
      {
        id: 'large-non-role',
        body: 'B'.repeat(10000), // Will be truncated
        body_html: '<p>B</p>'.repeat(10000),
        url: 'http://large'
      },
      {
        id: 'new-role',
        body: '## RESULT\n\n' + 'C'.repeat(5000), // Authoritative, will be preserved
        body_html: '<h2>RESULT</h2>' + '<p>C</p>'.repeat(5000),
        url: 'http://new',
        createdAt: '2023-02-01T00:00:00Z'
      }
    ]
    const projected = projectComments(raw) as ProjectedComment[]
    const benchmark = benchmarkProjection(raw, projected)
    
    // Log deterministic benchmark output
    console.log('Benchmark output:', benchmark)
    
    expect(benchmark.projectedBytes).toBeLessThan(benchmark.rawBytes)
    expect(benchmark.projectedTokens).toBeLessThan(benchmark.rawTokens)
    
    // Assert truncation behavior
    expect(projected[1].body.length).toBeLessThan(1000)
    expect(projected[1].body).toContain('[Comment truncated for context size')
    
    // Assert that canonical authoritative selected IDs remain identical before and after projection
    expect(projected[2].id).toBe(raw[2].id)

    // Selection accuracy (preserves authoritative role comments completely)
    expect(projected[2].body).toBe(raw[2].body)

    // Supersession behavior (compacts superseded role comments)
    expect(projected[0].body).toContain('[Superseded RESULT comment')
  })

  it('canonical role-comment selection remains correct before compaction (MC-R1-002)', () => {
    const raw = [
      {
        id: 'older-result',
        body: '## RESULT\n\n' + 'A'.repeat(200),
        createdAt: '2023-01-01T00:00:00Z',
        url: 'http://older',
      },
      {
        id: 'newer-result',
        body: '## RESULT\n\n' + 'B'.repeat(200),
        createdAt: '2023-02-01T00:00:00Z',
        url: 'http://newer',
      },
    ]

    const canonicalLatest = findLatestRoleComment(raw, 'RESULT')
    const selected = selectAuthoritativeRoleComments(raw, 'RESULT')
    expect((canonicalLatest?.comment as { id: string }).id).toBe('newer-result')
    expect([...selected].map((comment) => comment.id)).toEqual(['newer-result'])

    const projected = projectComments(raw) as ProjectedComment[]
    expect(projected.find((comment) => comment.id === 'newer-result')?.body).toBe(raw[1].body)
    expect(projected.find((comment) => comment.id === 'older-result')?.body).toContain('[Superseded RESULT comment')
  })

  it('preserves approved delivery evidence over newer untagged diagnostic reconciliation RESULT (MC-R1-002)', () => {
    const raw = [
      {
        id: 'older-approved-delivery',
        body: [
          '## RESULT',
          '',
          '### Task log',
          '- Phase: Dev Correction',
          '',
          '**PR:** #157',
          '**Branch / Head:** `feature/155-github-comment-projection` / `abc1234`',
          '',
          '### Commands reported',
          '- `pnpm run check` → pass',
        ].join('\n'),
        createdAt: '2023-01-01T00:00:00Z',
        url: 'http://older-approved',
      },
      {
        id: 'newer-untagged-diagnostic',
        body: [
          '## RESULT',
          '',
          '### Mission Control state-conflict reconciliation',
          '',
          '- Verified live protected base `main` at `deadbeef`.',
          '- No repository code, PR head, merge, deployment, postmortem, or dependent work was changed.',
          '',
          '### Local-only evidence',
          '',
          'Scratch artifacts remain local. Mission Control did not rely on them.',
        ].join('\n'),
        createdAt: '2023-03-01T00:00:00Z',
        url: 'http://newer-diagnostic',
      },
    ]

    const selected = selectAuthoritativeRoleComments(raw, 'RESULT')
    expect([...selected].map((comment) => comment.id)).toEqual(['older-approved-delivery'])

    const projected = projectComments(raw) as ProjectedComment[]
    expect(projected.find((comment) => comment.id === 'older-approved-delivery')?.body).toBe(raw[0].body)
    expect(projected.find((comment) => comment.id === 'newer-untagged-diagnostic')?.body).toContain('[Superseded RESULT comment')
    expect(projected.find((comment) => comment.id === 'newer-untagged-diagnostic')?.url).toBe('http://newer-diagnostic')
    expect(projected.find((comment) => comment.id === 'newer-untagged-diagnostic')?.createdAt).toBe('2023-03-01T00:00:00Z')
  })

  it('preserves the approved comment as authoritative despite bracket-tagged diagnostic or superseded role comments (MC-R1-002)', () => {
    const raw = [
      {
        id: 'older-approved',
        body: '## REVIEW_VERDICT\n\n**Verdict:** ELIGIBLE FOR FOUNDER REVIEW\n\nfounder_decision: approved',
        createdAt: '2023-01-01T00:00:00Z',
        url: 'http://older'
      },
      {
        id: 'newer-diagnostic',
        body: '## REVIEW_VERDICT\n\n[Diagnostic] Just testing things out.',
        createdAt: '2023-02-01T00:00:00Z',
        url: 'http://newer-diag'
      },
      {
        id: 'newer-superseded',
        body: '## REVIEW_VERDICT\n\n[Superseded] explicitly marked as such.',
        createdAt: '2023-03-01T00:00:00Z',
        url: 'http://newer-super'
      }
    ]
    const projected = projectComments(raw) as ProjectedComment[]

    expect(projected.find((comment) => comment.id === 'older-approved')?.body).toBe(raw[0].body)
    expect(projected.find((comment) => comment.id === 'newer-diagnostic')?.body).toContain('[Superseded REVIEW_VERDICT comment')
    expect(projected.find((comment) => comment.id === 'newer-superseded')?.body).toContain('[Superseded REVIEW_VERDICT comment')
  })
})
