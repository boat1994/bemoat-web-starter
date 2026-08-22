import { describe, expect, it } from 'vitest'

import { resolveParentIssueIdentity } from '../../scripts/mission-control/domain/github-comment-identity.ts'

describe('resolveParentIssueIdentity', () => {
  const expectedRepo = 'boat1994/bemoat-web-starter'

  it('accepts synthetic comment with issue_number only', () => {
    expect(resolveParentIssueIdentity({ issue_number: 401 }, expectedRepo)).toBe('401')
  })

  it('accepts real REST-shaped comment with issue_url only for expected repository', () => {
    expect(resolveParentIssueIdentity({ issue_url: `https://api.github.com/repos/${expectedRepo}/issues/401` }, expectedRepo)).toBe('401')
  })

  it('accepts both sources when they are equal and repository matches', () => {
    expect(resolveParentIssueIdentity({
      issue_number: 401,
      issue_url: `https://api.github.com/repos/${expectedRepo}/issues/401`
    }, expectedRepo)).toBe('401')
  })

  it('fails closed when sources disagree on issue number', () => {
    expect(() => resolveParentIssueIdentity({
      issue_number: 402,
      issue_url: `https://api.github.com/repos/${expectedRepo}/issues/401`
    }, expectedRepo)).toThrow('issue_number and issue_url identify different issues')
  })

  it('fails closed when issue_url repository differs from expected repository', () => {
    expect(() => resolveParentIssueIdentity({
      issue_url: 'https://api.github.com/repos/wrongowner/bemoat-web-starter/issues/401'
    }, expectedRepo)).toThrow('issue_url repository mismatch')

    expect(() => resolveParentIssueIdentity({
      issue_url: 'https://api.github.com/repos/boat1994/wrongrepo/issues/401'
    }, expectedRepo)).toThrow('issue_url repository mismatch')
  })

  it('fails closed when issue_url is malformed', () => {
    expect(() => resolveParentIssueIdentity({
      issue_url: `https://api.github.com/repos/${expectedRepo}/pulls/401`
    }, expectedRepo)).toThrow('malformed issue_url')

    expect(() => resolveParentIssueIdentity({
      issue_url: 'not-a-url'
    }, expectedRepo)).toThrow('malformed issue_url')
  })

  it('fails closed when neither source is present', () => {
    expect(() => resolveParentIssueIdentity({}, expectedRepo)).toThrow('missing issue identity')
  })
})
