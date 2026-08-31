import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { buildScriptImportGraph } from '../../scripts/guards/scripts-architecture.ts'
import {
  readGithubEvidence,
  readLocalGitEvidence,
  type ContextCommandResult,
  type ContextCommandRunner,
} from '../../scripts/context/evidence.ts'
import { routeContext } from '../../scripts/context/router.ts'
import type { NormalizedContextEvidence } from '../../scripts/context/model.ts'

const baseSha = 'a'.repeat(40)
const headSha = 'b'.repeat(40)

function response(stdout: string, status = 0, stderr = ''): ContextCommandResult {
  return { status, stdout, stderr, error: status === 0 ? null : new Error(stderr || 'command failed') }
}

function issuePayload(state = 'OPEN') {
  return JSON.stringify({
    number: 410,
    title: 'context protocol',
    state,
    url: 'https://github.com/boat1994/bemoat-web-starter/issues/410',
    body: '## Goal\n\nReconstruct context.\n',
    comments: [],
  })
}

function prPayload(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    number: 411,
    state: 'OPEN',
    isDraft: false,
    url: 'https://github.com/boat1994/bemoat-web-starter/pull/411',
    baseRefName: 'main',
    baseRefOid: baseSha,
    headRefName: 'feature/410-context',
    headRefOid: headSha,
    mergeCommit: null,
    reviews: [],
    statusCheckRollup: [{ name: 'CI', conclusion: 'SUCCESS' }],
    ...overrides,
  })
}

function nativeRuleset() {
  return JSON.stringify([{
    id: 19134691,
    name: 'protect main',
    target: 'branch',
    enforcement: 'active',
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'] } },
    rules: [
      { type: 'pull_request', parameters: { required_approving_review_count: 2 } },
      { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'CI' }] } },
    ],
  }])
}

function githubRunner({
  issue = issuePayload(),
  pr = prPayload(),
  prByNumber = {},
  prList = [{
    number: 411,
    body: 'Part of #410',
    url: 'https://github.com/boat1994/bemoat-web-starter/pull/411',
    headRefName: 'feature/410-context',
    closingIssuesReferences: [],
  }],
  legacyProtection = response('', 1, 'HTTP 404 Not Found'),
  rulesets = nativeRuleset(),
}: {
  issue?: string
  pr?: string
  prByNumber?: Record<string, string>
  prList?: unknown[]
  legacyProtection?: ContextCommandResult
  rulesets?: string
} = {}): ContextCommandRunner {
  return (_command, args) => {
    const key = args.join(' ')
    if (key.startsWith('issue view 410')) return response(issue)
    if (key.startsWith('pr list')) return response(JSON.stringify(prList))
    if (key.startsWith('pr view ')) return response(prByNumber[args[2] ?? ''] ?? pr)
    if (key.includes('branches/main/protection')) return legacyProtection
    if (key.includes('/rulesets?')) return response(rulesets)
    return response('')
  }
}

describe('bounded context corrections', () => {
  it('accepts effective native ruleset evidence when legacy branch protection returns 404', () => {
    const evidence = readGithubEvidence({
      repo: 'boat1994/bemoat-web-starter',
      issueNumber: '410',
      branch: 'feature/410-context',
      run: githubRunner({ prList: [] }),
    })

    expect(evidence.errors).not.toContain(expect.stringContaining('legacy'))
    expect(evidence.errors).not.toContain(expect.stringContaining('required native protection evidence is unavailable'))
    expect(evidence.protection).toMatchObject({ available: true, requiredApprovals: 2, requiredChecks: ['CI'] })
  })

  it('stops when legacy protection is absent and required native evidence is unavailable', () => {
    const evidence = readGithubEvidence({
      repo: 'boat1994/bemoat-web-starter',
      issueNumber: '410',
      branch: 'feature/410-context',
      run: githubRunner({ prList: [], rulesets: '' }),
    })

    expect(evidence.protection.available).toBe(false)
    expect(evidence.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('BLOCKED_EXTERNAL: required native protection evidence is unavailable'),
    ]))
  })

  it('discovers a cross-agent Part-of PR without closure linkage and does not bind an unrelated same-branch PR', () => {
    const crossAgent = readGithubEvidence({
      repo: 'boat1994/bemoat-web-starter',
      issueNumber: '410',
      branch: 'feature/410-other-agent',
      run: githubRunner(),
    })
    expect(crossAgent.activePrs).toHaveLength(1)
    expect(crossAgent.activePrs[0]?.number).toBe('411')

    const unrelated = readGithubEvidence({
      repo: 'boat1994/bemoat-web-starter',
      issueNumber: '410',
      branch: 'feature/410-context',
      run: githubRunner({
        prList: [{
          number: 999,
          body: 'Unrelated work',
          url: 'https://github.com/boat1994/bemoat-web-starter/pull/999',
          headRefName: 'feature/410-context',
          closingIssuesReferences: [],
        }],
      }),
    })
    expect(unrelated.activePrs).toEqual([])
  })

  it('reconstructs merged cross-agent PRs as COMPLETE', () => {
    const evidence = readGithubEvidence({
      repo: 'boat1994/bemoat-web-starter',
      issueNumber: '410',
      branch: 'feature/410-other-agent',
      run: githubRunner({
        issue: issuePayload('CLOSED'),
        pr: prPayload({ state: 'MERGED', mergeCommit: { oid: 'c'.repeat(40) } }),
      }),
    })
    const minimal: NormalizedContextEvidence = {
      repository: { owner: 'boat1994', name: 'bemoat-web-starter', nameWithOwner: 'boat1994/bemoat-web-starter', url: 'https://github.com/boat1994/bemoat-web-starter' },
      protectedBase: { branch: 'main', sha: baseSha, source: 'live GitHub ref', url: 'https://github.com/boat1994/bemoat-web-starter/tree/main' },
      policy: { path: 'docs/mission-control/mission-control-guide.md', policyId: 'bemoat-mission-control', version: '1.3.0', sourceSha: baseSha, url: 'https://github.com/boat1994/bemoat-web-starter/blob/main/docs/mission-control/mission-control-guide.md' },
      issue: { number: '410', title: 'context', state: 'CLOSED', url: 'https://github.com/boat1994/bemoat-web-starter/issues/410', objective: null, scope: null, acceptanceCriteria: [], dependencies: [], taskSize: 'core', missionControlMode: 'optional', workflowProfile: 'STANDARD' },
      localGit: { branch: 'feature/410-other-agent', head: headSha, upstream: 'origin/feature/410-other-agent', originRepository: 'boat1994/bemoat-web-starter', clean: true, detached: false, pushed: true, durable: true, reasons: [] },
      activePr: evidence.activePrs[0],
      currentHeadVerification: evidence.exactHead,
      durableContext: { latestHandoff: null, historicalResults: [] },
      evidenceErrors: evidence.errors,
    }
    expect(routeContext(minimal).route).toBe('COMPLETE')
  })

  it('ignores a historical merged PR when a newer open PR is the current candidate', () => {
    const currentHead = 'c'.repeat(40)
    const currentPr = JSON.stringify({
      number: 417,
      state: 'OPEN',
      isDraft: false,
      url: 'https://github.com/boat1994/bemoat-web-starter/pull/417',
      baseRefName: 'main',
      baseRefOid: baseSha,
      headRefName: 'feature/410-handoff-protocol',
      headRefOid: currentHead,
      mergeCommit: null,
      reviews: [],
      statusCheckRollup: [{ name: 'CI', conclusion: 'SUCCESS' }],
    })
    const prList: Record<string, unknown>[] = [
      { number: 411, body: 'Part of #410', url: 'https://github.com/boat1994/bemoat-web-starter/pull/411', headRefName: 'feature/410-context', closingIssuesReferences: [] },
      { number: 417, body: 'Part of #410', url: 'https://github.com/boat1994/bemoat-web-starter/pull/417', headRefName: 'feature/410-handoff-protocol', closingIssuesReferences: [] },
    ]
    const runner = githubRunner({
      prList,
      prByNumber: {
        '411': prPayload({ state: 'MERGED', mergeCommit: { oid: 'd'.repeat(40) } }),
        '417': currentPr,
      },
    })
    const evidence = readGithubEvidence({
      repo: 'boat1994/bemoat-web-starter',
      issueNumber: '410',
      branch: 'feature/410-handoff-protocol',
      run: runner,
    })

    expect(evidence.activePrs).toHaveLength(1)
    expect(evidence.activePrs[0]).toMatchObject({ number: '417', state: 'OPEN', headSha: currentHead })
    expect(evidence.exactHead?.exactHead).toBe(currentHead)
    expect(evidence.errors).not.toContain(expect.stringContaining('PR #411 base does not match'))
  })

  it('rejects a PR whose base differs from the live protected base and enforces all native approvals', () => {
    const mismatch = readGithubEvidence({
      repo: 'boat1994/bemoat-web-starter',
      issueNumber: '410',
      branch: 'feature/410-context',
      protectedBaseSha: baseSha,
      run: githubRunner({ pr: prPayload({ baseRefOid: 'd'.repeat(40) }) }),
    })
    expect(mismatch.errors.join(' ')).toMatch(/base/i)

    const oneApproval = readGithubEvidence({
      repo: 'boat1994/bemoat-web-starter', issueNumber: '410', branch: 'feature/410-context',
      run: githubRunner({ pr: prPayload({ reviews: [{ state: 'APPROVED', user: { login: 'reviewer-1' }, commitId: headSha }] }) }),
    })
    expect(oneApproval.exactHead?.reviews.approved).toBe(false)
    expect(oneApproval.exactHead?.reviews.approvedCount).toBe(1)

    const twoApprovals = readGithubEvidence({
      repo: 'boat1994/bemoat-web-starter', issueNumber: '410', branch: 'feature/410-context',
      run: githubRunner({ pr: prPayload({ reviews: [
        { state: 'APPROVED', user: { login: 'reviewer-1' }, commitId: headSha },
        { state: 'APPROVED', user: { login: 'reviewer-2' }, commitId: headSha },
      ] }) }),
    })
    expect(twoApprovals.exactHead?.reviews.approved).toBe(true)
    expect(twoApprovals.exactHead?.reviews.approvedCount).toBe(2)
  })

  it('uses live remote identity and fails closed on protected or integration branches', () => {
    const run: ContextCommandRunner = (_command, args) => {
      const key = args.join(' ')
      const values: Record<string, string> = {
        'branch --show-current': 'feature/410-context\n',
        'rev-parse HEAD': `${headSha}\n`,
        'status --short': '',
        'rev-parse --abbrev-ref --symbolic-full-name @{upstream}': 'origin/feature/410-context\n',
        'remote get-url origin': 'git@github.com:boat1994/bemoat-web-starter.git\n',
        'rev-parse refs/remotes/origin/feature/410-context': `${headSha}\n`,
        'ls-remote --heads origin feature/410-context': `${headSha}\trefs/heads/feature/410-context\n`,
      }
      return response(values[key] ?? '')
    }
    expect(readLocalGitEvidence({ cwd: '/repo', run }).durable).toBe(true)
    const liveMismatch = (_command: string, args: readonly string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv }) => {
      if (args[0] === 'ls-remote') return response(`${'c'.repeat(40)}\trefs/heads/feature/410-context\n`)
      return run(_command, args, options)
    }
    expect(readLocalGitEvidence({ cwd: '/repo', run: liveMismatch }).durable).toBe(false)

    const base: NormalizedContextEvidence = {
      repository: { owner: 'boat1994', name: 'bemoat-web-starter', nameWithOwner: 'boat1994/bemoat-web-starter', url: 'https://github.com/boat1994/bemoat-web-starter' },
      protectedBase: { branch: 'main', sha: baseSha, source: 'live GitHub ref', url: 'https://github.com/boat1994/bemoat-web-starter/tree/main' },
      policy: { path: 'docs/mission-control/mission-control-guide.md', policyId: 'bemoat-mission-control', version: '1.3.0', sourceSha: baseSha, url: 'https://github.com/boat1994/bemoat-web-starter/blob/main/docs/mission-control/mission-control-guide.md' },
      issue: { number: '410', title: 'context', state: 'OPEN', url: 'https://github.com/boat1994/bemoat-web-starter/issues/410', objective: null, scope: null, acceptanceCriteria: [], dependencies: [], taskSize: 'core', missionControlMode: 'optional', workflowProfile: 'STANDARD' },
      localGit: { branch: 'main', head: headSha, upstream: 'origin/main', originRepository: 'boat1994/bemoat-web-starter', clean: true, detached: false, pushed: true, durable: true, reasons: [] },
      activePr: null, currentHeadVerification: null, durableContext: { latestHandoff: null, historicalResults: [] }, evidenceErrors: [],
    }
    expect(routeContext(base).route).toBe('STOP')
  })

  it('fails closed for absent or malformed Issue and PR identity and keeps the public command independent', () => {
    const malformedIssue = readGithubEvidence({
      repo: 'boat1994/bemoat-web-starter', issueNumber: '410', branch: null,
      run: githubRunner({
        issue: JSON.stringify({ number: 410, title: '', state: '', url: '' }),
        prList: [], legacyProtection: response(JSON.stringify({})), rulesets: nativeRuleset(),
      }),
    })
    expect(malformedIssue.errors.join(' ')).toMatch(/Issue/i)

    const malformedPr = readGithubEvidence({
      repo: 'boat1994/bemoat-web-starter', issueNumber: '410', branch: 'feature/410-context',
      run: githubRunner({ pr: prPayload({ url: '', headRefOid: '' }) }),
    })
    expect(malformedPr.errors.join(' ')).toMatch(/PR|identity/i)

    const graph = buildScriptImportGraph(process.cwd())
    const directImports = [...(graph.get('scripts/agent-context.ts') ?? [])]
    expect(directImports.some((path) => path.startsWith('scripts/mission-control/') || path.startsWith('scripts/cli/'))).toBe(false)
    expect(readFileSync('scripts/agent-context.ts', 'utf8')).not.toMatch(/command-contract|mission-control-command|routing-policy|transport-registry/)
  })
})
