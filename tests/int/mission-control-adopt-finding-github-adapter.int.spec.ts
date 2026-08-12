import { describe, expect, it } from 'vitest'

import {
  createProductionDeps,
  defaultRunGh,
} from '../../scripts/mission-control/adapters/adopt-finding-github.mjs'
import { createProductionDeps as createWorkflowDeps } from '../../scripts/mission-control/workflows/adopt-finding.mjs'

describe('adopt-finding GitHub adapter', () => {
  const repo = 'boat1994/bemoat-web-starter'

  it('maps non-zero GitHub CLI exits to BLOCKED_EXTERNAL', async () => {
    const deps = createProductionDeps({
      runGh: (args) => defaultRunGh(args, {}, () => ({
        status: 1,
        stdout: '',
        stderr: 'gh failed',
      }) as never)
    })

    const error = await deps.readComment(repo, '123').catch((caught) => caught)
    expect(error).toMatchObject({ classification: 'BLOCKED_EXTERNAL' })
    expect(error).toHaveProperty('message', 'BLOCKED_EXTERNAL: gh failed')
  })

  it('maps GitHub process execution failures to BLOCKED_EXTERNAL', async () => {
    const deps = createProductionDeps({
      runGh: (args) => defaultRunGh(args, {}, () => ({
        status: null,
        stdout: '',
        stderr: '',
        error: new Error('spawn gh failed'),
      }) as never)
    })

    const error = await deps.readComment(repo, '123').catch((caught) => caught)
    expect(error).toMatchObject({ classification: 'BLOCKED_EXTERNAL' })
    expect(error).toHaveProperty('message', 'BLOCKED_EXTERNAL: spawn gh failed')
  })

  it('fails closed when paginated comments are structurally incomplete', async () => {
    const deps = createProductionDeps({ runGh: () => JSON.stringify([{ id: 1 }, null]) })

    const error = await deps.readIssueComments(repo, 328).catch((caught) => caught)
    expect(error).toMatchObject({ classification: 'BLOCKED_EXTERNAL' })
    expect(error).toHaveProperty(
      'message',
      'BLOCKED_EXTERNAL: live Issue comment pagination is incomplete',
    )
  })

  it('preserves malformed transport JSON as a raw SyntaxError', async () => {
    const deps = createProductionDeps({ runGh: () => '{malformed' })

    await expect(deps.readComment(repo, '123')).rejects.toBeInstanceOf(SyntaxError)
  })

  it('keeps empty Founder login classification in the workflow boundary', async () => {
    const deps = createWorkflowDeps({ runGh: () => JSON.stringify({ value: '' }) })

    await expect(deps.readTrustedFounderLogins(repo)).rejects.toThrow(
      'STATE_CONFLICT: repository Actions variable BEMOAT_FOUNDER_LOGINS is invalid',
    )
  })
})
