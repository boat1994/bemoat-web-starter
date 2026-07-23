import { describe, it, expect } from 'vitest'
import { projectComments, benchmarkProjection } from '../../scripts/github-comment-projection.mjs'

type ProjectedComment = { id: string, body: string, path?: string, line?: number, inReplyTo?: string }

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

  it('preserves the latest authoritative role comments completely', () => {
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
        createdAt: '2023-01-02T00:00:00Z',
        url: 'http://new'
      }
    ]
    const projected = projectComments(raw) as ProjectedComment[]
    
    // The new one should be intact
    expect(projected[1].body).toBe(raw[1].body)
    
    // The old one should be truncated because it's superseded
    expect(projected[0].body).toContain('[Superseded HANDOFF comment. View original at http://old]')
    expect(projected[0].body.length).toBeLessThan(raw[0].body.length)
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

  it('produces benchmarks showing size reduction', () => {
    const raw = [{
      id: '6',
      body: 'A'.repeat(600),
      body_html: '<p>' + 'A'.repeat(600) + '</p>',
      url: 'http://a'
    }]
    const projected = projectComments(raw)
    const benchmark = benchmarkProjection(raw, projected)
    
    expect(benchmark.projectedBytes).toBeLessThan(benchmark.rawBytes)
    expect(benchmark.projectedTokens).toBeLessThan(benchmark.rawTokens)
  })
})
