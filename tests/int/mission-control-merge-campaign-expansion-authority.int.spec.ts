import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { deriveCampaignExpansionAuthority } from '../../scripts/mission-control/domain/merge-campaign-expansion-authority.ts'

describe('campaign expansion authority derivation', () => {
  it('builds a deterministic append-only authority record from live evidence', () => {
    const comments = [
      {
        id: 7001,
        user: { login: 'boat1994' },
        body: '## CAMPAIGN EXPANSION\nAPPEND SLICES 8–11\nFOUNDER_DIRECTIVE',
      },
      {
        id: 7002,
        user: { login: 'boat1994' },
        body: 'FOUNDER_ARCHITECTURE_DIRECTIVE',
      },
    ]
    const evidence = {
      campaignExpansionAuthority: {
        comments,
        currentProtectedBaseSha: 'A'.repeat(40),
      },
    }

    const authority = deriveCampaignExpansionAuthority(
      'boat1994/bemoat-web-starter',
      328,
      evidence,
    )

    expect(authority).toEqual({
      schema_version: 1,
      decision: 'APPROVED',
      scope: 'campaign_slice_range',
      action: 'append_only_expand',
      source: {
        kind: 'github_issue_comment',
        repository: 'boat1994/bemoat-web-starter',
        issue: '#328',
        comment_id: '7001',
        author_login: 'boat1994',
        body_sha256: createHash('sha256').update(comments[0].body, 'utf8').digest('hex'),
      },
      approved_base: 'main',
      protected_base_sha: 'a'.repeat(40),
      policy_version: '1.3.0',
      legacy_max_slice: 7,
      authorized_max_slice: 11,
      authorized_append_keys: ['8', '9', '10', '11'],
      append_only: true,
      related_authority_comment_ids: ['7001', '7002'],
    })
    expect(evidence).toEqual({
      campaignExpansionAuthority: {
        comments,
        currentProtectedBaseSha: 'A'.repeat(40),
      },
    })
  })

  it('rejects an authority range that is not the approved contiguous expansion', () => {
    expect(() => deriveCampaignExpansionAuthority(
      'boat1994/bemoat-web-starter',
      328,
      {
        campaignExpansionAuthority: {
          comments: [{
            id: 7001,
            user: { login: 'boat1994' },
            body: 'CAMPAIGN EXPANSION APPEND SLICES 9-11 FOUNDER_DIRECTIVE',
          }],
          currentProtectedBaseSha: 'a'.repeat(40),
        },
      },
    )).toThrow('STATE_CONFLICT: Founder campaign expansion authority does not bind the contiguous approved range')
  })
})
