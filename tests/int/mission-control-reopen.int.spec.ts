import { describe, expect, it } from 'vitest'
import { parseReopenArgs, runReopen } from '../../scripts/mission-control/workflows/reopen.mjs'

describe('parseReopenArgs', () => {
  it('parses valid args', () => {
    const options = parseReopenArgs([
      '284',
      '--repo', 'boat1994/bemoat-web-starter',
      '--expected-pr', '285',
      '--expected-base', 'main',
      '--expected-state', 'ELIGIBLE_FOR_FOUNDER_REVIEW',
      '--expected-old-head', 'c44bf1bc379fe4160946dce96e5a4d7abae7b5b0',
      '--expected-new-head', '88b306c7e055751f78b9ced5922607eee2d1037f',
      '--expected-review-cycle', '1',
      '--expected-full-review-count', '1',
      '--authorization-comment', '5193626365'
    ])
    expect(options.issueNumber).toBe('284')
    expect(options.expectedState).toBe('ELIGIBLE_FOR_FOUNDER_REVIEW')
  })
})

describe('runReopen', () => {
  it('returns NO_OP for identical retry', async () => {
    const deps = {
      readManagedIssue: async () => ({
        body: '<!-- bemoat-mission-control-state -->\n{}',
        managedState: {
          state: 'FOUNDER_AUTHORIZED_CORRECTION',
          current_head: '88b306c7e055751f78b9ced5922607eee2d1037f',
          founder_correction_authorization: {
            authorization_id: 'founder-5193626365'
          }
        }
      })
    }
    const options = {
      issueNumber: '284',
      repo: 'boat1994/bemoat-web-starter',
      expectedNewHead: '88b306c7e055751f78b9ced5922607eee2d1037f',
      authorizationComment: '5193626365'
    }
    const result = await runReopen({ options, deps })
    expect(result.outcome).toBe('NO_OP')
  })

  it('fails if state is not ELIGIBLE_FOR_FOUNDER_REVIEW', async () => {
    const deps = {
      readManagedIssue: async () => ({
        body: '',
        managedState: { state: 'DONE' }
      })
    }
    await expect(runReopen({ options: {}, deps })).rejects.toThrow('STATE_CONFLICT')
  })
})
