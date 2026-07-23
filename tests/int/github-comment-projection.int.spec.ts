import { describe, it, expect } from 'vitest'
import { projectComments, benchmarkProjection } from '../../scripts/github-comment-projection.mjs'

type ProjectedComment = { id: string, body: string, path?: string, line?: number, inReplyTo?: string, startLine?: number, side?: string, startSide?: string, pullRequestReviewId?: string, updatedAt?: string }

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
      }
    ]
    const projected = projectComments(raw) as ProjectedComment[]
    
    // Both should be intact because projection defers authoritative selection to Mission Control
    expect(projected[1].body).toBe(raw[1].body)
    expect(projected[0].body).toBe(raw[0].body)
  })

  it('preserves required review/thread metadata for every comment class (MC-R1-003)', () => {
    const raw = [{
      id: '3',
      body: 'Fix this',
      path: 'src/main.ts',
      line: 42,
      start_line: 40,
      side: 'RIGHT',
      start_side: 'RIGHT',
      pull_request_review_id: 'pr-rev-123',
      updated_at: '2023-01-02T00:00:00Z',
      inReplyTo: '0',
      url: 'http://a'
    }]
    const projected = projectComments(raw) as ProjectedComment[]
    expect(projected[0].path).toBe('src/main.ts')
    expect(projected[0].line).toBe(42)
    expect(projected[0].startLine).toBe(40)
    expect(projected[0].side).toBe('RIGHT')
    expect(projected[0].startSide).toBe('RIGHT')
    expect(projected[0].pullRequestReviewId).toBe('pr-rev-123')
    expect(projected[0].updatedAt).toBe('2023-01-02T00:00:00Z')
    expect(projected[0].inReplyTo).toBe('0')
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
        body: '## RESULT\n\n' + 'A'.repeat(5000), // Should be kept completely because of MC-R1-002
        body_html: '<h2>RESULT</h2>' + '<p>A</p>'.repeat(5000),
        url: 'http://old'
      },
      {
        id: 'large-non-role',
        body: 'B'.repeat(10000), // Should be truncated
        body_html: '<p>B</p>'.repeat(10000),
        url: 'http://large'
      },
      {
        id: 'new-role',
        body: '## REVIEW_VERDICT\n\n' + 'C'.repeat(5000),
        body_html: '<h2>REVIEW_VERDICT</h2>' + '<p>C</p>'.repeat(5000),
        url: 'http://new'
      }
    ]
    const projected = projectComments(raw) as ProjectedComment[]
    const benchmark = benchmarkProjection(raw, projected)
    
    expect(benchmark.projectedBytes).toBeLessThan(benchmark.rawBytes)
    expect(benchmark.projectedTokens).toBeLessThan(benchmark.rawTokens)
    
    // Truncation behavior
    expect(projected[1].body.length).toBeLessThan(1000)
    expect(projected[1].body).toContain('[Comment truncated for context size')
    
    // Selection accuracy (preserves role comments completely)
    expect(projected[0].body).toBe(raw[0].body)
    expect(projected[2].body).toBe(raw[2].body)
  })
})
