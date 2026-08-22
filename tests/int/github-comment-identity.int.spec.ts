import { describe, expect, it } from 'vitest'

import { resolveParentIssueIdentity } from '../../scripts/mission-control/domain/github-comment-identity.ts'

describe('resolveParentIssueIdentity', () => {
  it('accepts synthetic comment with issue_number only', () => {
    expect(resolveParentIssueIdentity({ issue_number: 401 })).toBe('401')
  })

  it('accepts real REST-shaped comment with issue_url only', () => {
    expect(resolveParentIssueIdentity({ issue_url: 'https://api.github.com/repos/boat1994/bemoat-web-starter/issues/401' })).toBe('401')
  })

  it('accepts both sources when they are equal', () => {
    expect(resolveParentIssueIdentity({
      issue_number: 401,
      issue_url: 'https://api.github.com/repos/boat1994/bemoat-web-starter/issues/401'
    })).toBe('401')
  })

  it('fails closed when sources disagree', () => {
    expect(() => resolveParentIssueIdentity({
      issue_number: 402,
      issue_url: 'https://api.github.com/repos/boat1994/bemoat-web-starter/issues/401'
    })).toThrow('issue_number and issue_url identify different issues')
  })

  it('fails closed when issue_url is malformed', () => {
    expect(() => resolveParentIssueIdentity({
      issue_url: 'https://api.github.com/repos/boat1994/bemoat-web-starter/pulls/401'
    })).toThrow('malformed issue_url')

    expect(() => resolveParentIssueIdentity({
      issue_url: 'not-a-url'
    })).toThrow('malformed issue_url')
  })

  it('fails closed when neither source is present', () => {
    expect(() => resolveParentIssueIdentity({})).toThrow('missing issue identity')
  })
})
