import { describe, expect, it } from 'vitest'

import { createProductionDeps } from '../../scripts/mission-control/adapters/recover-review-github.mjs'

describe('recover-review GitHub adapter', () => {
  const repo = 'boat1994/bemoat-web-starter'

  it('maps GitHub transport failures to BLOCKED_EXTERNAL', async () => {
    const originalPath = process.env.PATH
    process.env.PATH = ''
    try {
      const deps = createProductionDeps()
      await expect(deps.readComment(repo, '123')).rejects.toThrow(/^BLOCKED_EXTERNAL:/)
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
      { id: 1, name: 'strict', context: 'strict', conclusion: 'success', head_sha: sha },
    ])
    await expect(deps.readComment(repo, '7')).resolves.toEqual({ id: 7, body: 'comment' })
    await expect(deps.readPolicySource(repo, sha)).resolves.toMatchObject({
      source_commit: sha,
      sha,
    })
    expect(
      calls.some((args) =>
        args.some((arg) => arg.includes(`commits/${sha}/check-runs?per_page=100`)),
      ),
    ).toBe(true)
  })

  it('keeps CAS writes on the injected transport seam', async () => {
    const calls: Array<{ args: string[]; input?: string }> = []
    const runGh = (args: string[], options: { input?: string } = {}) => {
      calls.push({ args, input: options.input })
      if (
        args[0] === 'api' &&
        args.some((arg) => arg.includes('contents/.bemoat/mission-control/leases/issue-1.json'))
      ) {
        if (args.includes('-X')) return JSON.stringify({ sha: 'lease-1' })
        return JSON.stringify({ sha: 'lease-0', content: Buffer.from('{}').toString('base64') })
      }
      if (args[0] === 'api' && args.includes('git/ref/heads/main'))
        return JSON.stringify({ object: { sha: 'b'.repeat(40) } })
      if (args[0] === 'api' && args.includes('repos/boat1994/bemoat-web-starter'))
        return JSON.stringify({ default_branch: 'main' })
      if (args[0] === 'api' && args.includes('git/refs')) return ''
      throw new Error(`unexpected gh call: ${args.join(' ')}`)
    }
    const deps = createProductionDeps({ runGh })
    await expect(
      deps.writeIssueBody({
        repo,
        issueNumber: 1,
        expectedBody: 'before',
        nextBody: 'after',
        transitionIdentity: 'transition-1',
      }),
    ).rejects.toThrow()
    expect(calls.some(({ args }) => args.includes('-X'))).toBe(true)
  })
})
