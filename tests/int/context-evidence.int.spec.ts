import { describe, expect, it } from 'vitest'

import {
  collectContextEvidence,
  readGithubEvidence,
  readLocalGitEvidence,
  readProtectedPolicy,
  type ContextCommandResult,
  type ContextCommandRunner,
} from '../../scripts/context/evidence.ts'

function response(stdout: string): ContextCommandResult {
  return { status: 0, stdout, stderr: '', error: null }
}

describe('bemoat:context neutral evidence adapters', () => {
  it.each([
    ['dirty', { 'status --short': ' M file\n' }],
    ['detached', { 'branch --show-current': '' }],
    ['unpushed', { 'rev-parse refs/remotes/origin/feature/410-context': `${'c'.repeat(40)}\n` }],
    ['wrong upstream', { 'rev-parse --abbrev-ref --symbolic-full-name @{upstream}': 'origin/main\n' }],
  ])('fails local durability closed for %s work', (_label, overrides) => {
    const run: ContextCommandRunner = (_command, args) => {
      const key = args.join(' ')
      const values: Record<string, string> = {
        'branch --show-current': 'feature/410-context\n',
        'rev-parse HEAD': `${'b'.repeat(40)}\n`,
        'status --short': '',
        'rev-parse --abbrev-ref --symbolic-full-name @{upstream}': 'origin/feature/410-context\n',
        'remote get-url origin': 'git@github.com:boat1994/bemoat-web-starter.git\n',
        'rev-parse refs/remotes/origin/feature/410-context': `${'b'.repeat(40)}\n`,
        ...overrides,
      }
      return response(values[key] ?? '')
    }

    const evidence = readLocalGitEvidence({ cwd: '/repo', run })
    expect(evidence.durable).toBe(false)
    expect(evidence.reasons.join(' ')).toMatch(/LOCAL_STATE_NOT_DURABLE/)
  })

  it('assembles normalized context evidence from read-only adapters', () => {
    const run: ContextCommandRunner = (_command, args) => {
      const key = args.join(' ')
      const local: Record<string, string> = {
        'branch --show-current': 'feature/410-context\n',
        'rev-parse HEAD': `${'b'.repeat(40)}\n`,
        'status --short': '',
        'rev-parse --abbrev-ref --symbolic-full-name @{upstream}': 'origin/feature/410-context\n',
        'remote get-url origin': 'git@github.com:boat1994/bemoat-web-starter.git\n',
        'rev-parse refs/remotes/origin/feature/410-context': `${'b'.repeat(40)}\n`,
        'ls-remote --heads origin feature/410-context': `${'b'.repeat(40)}\trefs/heads/feature/410-context\n`,
      }
      if (_command === 'git') return response(local[key] ?? '')
      if (key.includes('git/ref/heads/main')) return response(JSON.stringify({ object: { sha: 'a'.repeat(40) } }))
      if (key.includes('contents/docs/mission-control/mission-control-guide.md')) {
        return response(JSON.stringify({
          sha: 'c'.repeat(40),
          content: Buffer.from('---\npolicy_id: bemoat-mission-control\nversion: 1.3.0\n---\n').toString('base64'),
          encoding: 'base64',
        }))
      }
      if (key.startsWith('issue view 410')) {
        return response(JSON.stringify({ number: 410, title: 'context', state: 'OPEN', url: 'https://github.com/boat1994/bemoat-web-starter/issues/410', body: '## Goal\n\nImplement context.\n', comments: [] }))
      }
      if (key.startsWith('pr list')) return response('[]')
      if (key.includes('branches/main/protection')) return response(JSON.stringify({}))
      return response('')
    }

    expect(collectContextEvidence({ cwd: '/repo', issueNumber: '410', run })).toMatchObject({
      repository: { nameWithOwner: 'boat1994/bemoat-web-starter' },
      protectedBase: { branch: 'main', sha: 'a'.repeat(40) },
      policy: { sourceSha: 'c'.repeat(40), version: '1.3.0' },
      issue: { number: '410', objective: 'Implement context.' },
      activePr: null,
      evidenceErrors: [],
    })
  })

  it('normalizes local branch, HEAD, upstream, origin, cleanliness, and push durability', () => {
    const run: ContextCommandRunner = (_command, args) => {
      const key = args.join(' ')
      const values: Record<string, string> = {
        'branch --show-current': 'feature/410-context\n',
        'rev-parse HEAD': `${'b'.repeat(40)}\n`,
        'status --short': '',
        'rev-parse --abbrev-ref --symbolic-full-name @{upstream}': 'origin/feature/410-context\n',
        'remote get-url origin': 'git@github.com:boat1994/bemoat-web-starter.git\n',
        'rev-parse refs/remotes/origin/feature/410-context': `${'b'.repeat(40)}\n`,
        'ls-remote --heads origin feature/410-context': `${'b'.repeat(40)}\trefs/heads/feature/410-context\n`,
      }
      return response(values[key] ?? '')
    }

    expect(readLocalGitEvidence({ cwd: '/repo', run })).toEqual({
      branch: 'feature/410-context',
      head: 'b'.repeat(40),
      upstream: 'origin/feature/410-context',
      originRepository: 'boat1994/bemoat-web-starter',
      clean: true,
      detached: false,
      pushed: true,
      durable: true,
      reasons: [],
    })
  })

  it('reads protected-base SHA and policy identity from live GitHub content', () => {
    const policy = '---\npolicy_id: bemoat-mission-control\nversion: 1.3.0\n---\n\n# Guide\n'
    const run: ContextCommandRunner = (_command, args) => {
      const key = args.join(' ')
      if (key.includes('git/ref/heads/main')) {
        return response(JSON.stringify({ object: { sha: 'a'.repeat(40) } }))
      }
      if (key.includes('contents/docs/mission-control/mission-control-guide.md')) {
        return response(JSON.stringify({
          sha: 'c'.repeat(40),
          content: Buffer.from(policy).toString('base64'),
          encoding: 'base64',
        }))
      }
      return response('')
    }

    expect(readProtectedPolicy({
      repo: 'boat1994/bemoat-web-starter',
      baseBranch: 'main',
      run,
    })).toEqual({
      branch: 'main',
      sha: 'a'.repeat(40),
      policy: {
        path: 'docs/mission-control/mission-control-guide.md',
        policyId: 'bemoat-mission-control',
        version: '1.3.0',
        sourceSha: 'c'.repeat(40),
        url: 'https://github.com/boat1994/bemoat-web-starter/blob/' + 'a'.repeat(40) + '/docs/mission-control/mission-control-guide.md',
      },
      errors: [],
    })
  })

  it('binds the Issue, one active PR, and exact-head verification', () => {
    const head = 'b'.repeat(40)
    const run: ContextCommandRunner = (_command, args) => {
      const key = args.join(' ')
      if (key.startsWith('issue view 410')) {
        return response(JSON.stringify({
          number: 410,
          title: 'context protocol',
          state: 'OPEN',
          url: 'https://github.com/boat1994/bemoat-web-starter/issues/410',
          body: '# body',
          comments: [],
        }))
      }
      if (key.startsWith('pr list')) {
        return response(JSON.stringify([{
          number: 411,
          url: 'https://github.com/boat1994/bemoat-web-starter/pull/411',
          headRefName: 'feature/410-context',
          closingIssuesReferences: [{ number: 410 }],
        }]))
      }
      if (key.startsWith('pr view 411')) {
        return response(JSON.stringify({
          number: 411,
          state: 'OPEN',
          isDraft: false,
          url: 'https://github.com/boat1994/bemoat-web-starter/pull/411',
          baseRefName: 'main',
          baseRefOid: 'a'.repeat(40),
          headRefName: 'feature/410-context',
          headRefOid: head,
          mergeCommit: null,
          reviews: [{
            id: 5020446813,
            state: 'COMMENTED',
            commitId: head,
            body: `## REVIEW_VERDICT\n**Repository:** \`boat1994/bemoat-web-starter\`\n**Task / Issue:** #410\n**PR / base / head:** PR #411 · \`main\` · \`${head}\`\n**Verdict:** ELIGIBLE FOR FOUNDER REVIEW`,
          }],
          statusCheckRollup: [{ name: 'CI', state: 'SUCCESS', conclusion: 'SUCCESS' }],
        }))
      }
      if (key.includes('branches/main/protection')) {
        return response(JSON.stringify({
          required_status_checks: { contexts: ['CI'] },
          required_pull_request_reviews: { required_approving_review_count: 1 },
        }))
      }
      return response('')
    }

    expect(readGithubEvidence({
      cwd: '/repo',
      repo: 'boat1994/bemoat-web-starter',
      issueNumber: '410',
      branch: 'feature/410-context',
      run,
    })).toMatchObject({
      issue: { number: '410', state: 'OPEN' },
      activePrs: [{ number: '411', headSha: head }],
      exactHead: {
        exactHead: head,
        checks: { complete: true, failed: false },
        reviews: {
          approved: false,
          exactHead: false,
          nativeReviews: [{
            id: 5020446813,
            state: 'COMMENTED',
            commitId: head,
            body: expect.stringContaining('ELIGIBLE FOR FOUNDER REVIEW'),
          }],
        },
      },
      errors: [],
    })
  })

  it('retains merged PR commit evidence without comparing historical base to current protected main', () => {
    const head = 'b'.repeat(40)
    const mergeCommit = 'd'.repeat(40)
    const run: ContextCommandRunner = (_command, args) => {
      const key = args.join(' ')
      if (key.startsWith('issue view 421')) {
        return response(JSON.stringify({
          number: 421,
          title: 'semantic review routing',
          state: 'CLOSED',
          url: 'https://github.com/boat1994/bemoat-web-starter/issues/421',
          body: '# body',
          comments: [],
        }))
      }
      if (key.startsWith('pr list')) {
        return response(JSON.stringify([{
          number: 422,
          url: 'https://github.com/boat1994/bemoat-web-starter/pull/422',
          headRefName: 'fix/421-standard-semantic-review',
          closingIssuesReferences: [{ number: 421 }],
        }]))
      }
      if (key.startsWith('pr view 422')) {
        return response(JSON.stringify({
          number: 422,
          state: 'MERGED',
          isDraft: false,
          url: 'https://github.com/boat1994/bemoat-web-starter/pull/422',
          baseRefName: 'main',
          baseRefOid: 'a'.repeat(40),
          headRefName: 'fix/421-standard-semantic-review',
          headRefOid: head,
          mergeCommit: { oid: mergeCommit },
          reviews: [],
          statusCheckRollup: [],
        }))
      }
      if (key.includes('branches/main/protection')) return response(JSON.stringify({}))
      return response('')
    }

    expect(readGithubEvidence({
      cwd: '/repo',
      repo: 'boat1994/bemoat-web-starter',
      issueNumber: '421',
      branch: 'fix/421-standard-semantic-review',
      protectedBaseSha: 'c'.repeat(40),
      run,
    })).toMatchObject({
      activePrs: [{
        number: '422',
        baseSha: 'a'.repeat(40),
        mergeCommitSha: mergeCommit,
        merged: true,
      }],
      errors: [],
    })
  })

  it('fails closed when an OPEN PR carries a valid merge commit', () => {
    const head = 'b'.repeat(40)
    const mergeCommit = 'd'.repeat(40)
    const run: ContextCommandRunner = (_command, args) => {
      const key = args.join(' ')
      if (key.startsWith('issue view 421')) {
        return response(JSON.stringify({
          number: 421,
          title: 'semantic review routing',
          state: 'OPEN',
          url: 'https://github.com/boat1994/bemoat-web-starter/issues/421',
          body: '# body',
          comments: [],
        }))
      }
      if (key.startsWith('pr list')) {
        return response(JSON.stringify([{
          number: 422,
          url: 'https://github.com/boat1994/bemoat-web-starter/pull/422',
          headRefName: 'fix/421-standard-semantic-review',
          closingIssuesReferences: [{ number: 421 }],
        }]))
      }
      if (key.startsWith('pr view 422')) {
        return response(JSON.stringify({
          number: 422,
          state: 'OPEN',
          isDraft: false,
          url: 'https://github.com/boat1994/bemoat-web-starter/pull/422',
          baseRefName: 'main',
          baseRefOid: 'a'.repeat(40),
          headRefName: 'fix/421-standard-semantic-review',
          headRefOid: head,
          mergeCommit: { oid: mergeCommit },
          reviews: [],
          statusCheckRollup: [],
        }))
      }
      if (key.includes('branches/main/protection')) return response(JSON.stringify({}))
      return response('')
    }

    const evidence = readGithubEvidence({
      cwd: '/repo',
      repo: 'boat1994/bemoat-web-starter',
      issueNumber: '421',
      branch: 'fix/421-standard-semantic-review',
      run,
    })

    expect(evidence.activePrs).toEqual([])
    expect(evidence.errors).toContain('EVIDENCE_CONFLICT: PR #422 state and merge commit evidence disagree')
  })

  it('excludes closed-unmerged PRs from candidates (MC-R1-002)', () => {
    const head = 'b'.repeat(40)
    const run: ContextCommandRunner = (_command, args) => {
      const key = args.join(' ')
      if (key.startsWith('issue view 410')) {
        return response(JSON.stringify({
          number: 410, title: 'context protocol', state: 'OPEN', url: 'https://github.com/boat1994/bemoat-web-starter/issues/410', body: '# body', comments: [],
        }))
      }
      if (key.startsWith('pr list')) {
        return response(JSON.stringify([
          { number: 411, url: 'https://github.com/boat1994/bemoat-web-starter/pull/411', headRefName: 'feature/410-context-merged', closingIssuesReferences: [{ number: 410 }] }, // Historical merged
          { number: 412, url: 'https://github.com/boat1994/bemoat-web-starter/pull/412', headRefName: 'feature/410-context-closed', closingIssuesReferences: [{ number: 410 }] }, // Closed unmerged
          { number: 413, url: 'https://github.com/boat1994/bemoat-web-starter/pull/413', headRefName: 'feature/410-context', closingIssuesReferences: [{ number: 410 }] }, // Active open
        ]))
      }
      if (key.startsWith('pr view 411')) {
        return response(JSON.stringify({
          number: 411, state: 'MERGED', isDraft: false, url: 'https://github.com/boat1994/bemoat-web-starter/pull/411',
          baseRefName: 'main', baseRefOid: 'a'.repeat(40), headRefName: 'feature/410-context-merged', headRefOid: 'oldsha',
          mergeCommit: { oid: 'd'.repeat(40) }, reviews: [], statusCheckRollup: []
        }))
      }
      if (key.startsWith('pr view 412')) {
        return response(JSON.stringify({
          number: 412, state: 'CLOSED', isDraft: false, url: 'https://github.com/boat1994/bemoat-web-starter/pull/412',
          baseRefName: 'main', baseRefOid: 'a'.repeat(40), headRefName: 'feature/410-context-closed', headRefOid: 'closedsha',
          mergeCommit: null, reviews: [], statusCheckRollup: []
        }))
      }
      if (key.startsWith('pr view 413')) {
        return response(JSON.stringify({
          number: 413, state: 'OPEN', isDraft: false, url: 'https://github.com/boat1994/bemoat-web-starter/pull/413',
          baseRefName: 'main', baseRefOid: 'a'.repeat(40), headRefName: 'feature/410-context', headRefOid: head,
          mergeCommit: null, reviews: [], statusCheckRollup: []
        }))
      }
      if (key.includes('branches/main/protection')) {
        return response(JSON.stringify({}))
      }
      return response('')
    }

    const evidence = readGithubEvidence({
      cwd: '/repo', repo: 'boat1994/bemoat-web-starter', issueNumber: '410', branch: 'feature/410-context', run,
    })
    
    // It should exclude the closed PR 412, but include merged PR 411 and open PR 413 in activePrs list from API
    // Since 411 is merged, unmergedPrs will just be 413.
    // The activePrs property from evidence should only contain unmerged if there's any, which is [413].
    expect(evidence.activePrs.length).toBe(1)
    expect(evidence.activePrs[0].number).toBe('413')
  })
})
