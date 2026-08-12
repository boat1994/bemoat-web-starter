import { describe, expect, it } from 'vitest'

import { createProductionDeps } from '../../scripts/mission-control/adapters/recover-review-github.mjs'

describe('recover-review GitHub adapter', () => {
  const repo = 'boat1994/bemoat-web-starter'

  it('maps GitHub transport failures to BLOCKED_EXTERNAL', async () => {
    const originalPath = process.env.PATH
    process.env.PATH = ''
    try {
      const deps = createProductionDeps()
      await expect(deps.readComment(repo, '123')).rejects.toMatchObject({ classification: 'BLOCKED_EXTERNAL' })
    } finally {
      process.env.PATH = originalPath
    }
  })

  it('preserves exact-head check, policy, checkout, and comment reads', async () => {
    const calls: string[][] = []
    const sha = 'a'.repeat(40)
    const runGh = (args: string[], options: { allowNotFound?: boolean } = {}) => {
      calls.push(args)
      if (args.some((arg) => arg.includes('check-runs?per_page=100')))
        return JSON.stringify({
          check_runs: [{ id: 1, name: 'strict', conclusion: 'success', head_sha: sha }],
        })
      if (args.some((arg) => arg.includes('issues/comments/7')))
        return JSON.stringify({ id: 7, body: 'comment' })
      if (
        args.some((arg) => arg.includes('contents/docs/mission-control/mission-control-guide.md'))
      ) {
        return JSON.stringify({
          path: 'docs/mission-control/mission-control-guide.md',
          sha,
          content: Buffer.from('---\nversion: 1.3.0\n---\n').toString('base64'),
          encoding: 'base64',
        })
      }
      if (args.some((arg) => arg.includes('contents/scripts/')))
        return JSON.stringify({ path: 'source', sha, content: 'source' })
      if (args.some((arg) => arg.includes('contents/.bemoat/mission-control-overrides.md')))
        return options.allowNotFound
          ? null
          : (() => {
              throw new Error('404 Not Found')
            })()
      throw new Error(`unexpected gh call: ${args.join(' ')}`)
    }
    const deps = createProductionDeps({ runGh })
    await expect(deps.readExactHeadChecks(repo, 275, sha)).resolves.toEqual([
      { id: 1, name: 'strict', conclusion: 'success', head_sha: sha },
    ])
    await expect(deps.readComment(repo, '7')).resolves.toEqual({ id: 7, body: 'comment' })
    await expect(deps.readFileAtRef(repo, 'docs/mission-control/mission-control-guide.md', sha)).resolves.toMatchObject({
      sha,
      content: '---\nversion: 1.3.0\n---\n',
    })
    expect(
      calls.some((args) =>
        args.some((arg) => arg.includes(`commits/${sha}/check-runs?per_page=100`)),
      ),
    ).toBe(true)
  })
})
