import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { buildScriptImportGraph } from '../../scripts/guards/scripts-architecture.ts'
import {
  collectContextEvidence,
  readGithubEvidence,
  readLocalGitEvidence,
  type ContextCommandResult,
  type ContextCommandRunner,
} from '../../scripts/context/evidence.ts'
import {
  AUTHORIZED_TEXTUAL_PR_ISSUE_RELATIONS,
  prOwnsIssue,
} from '../../scripts/context/pr-issue-ownership.ts'
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
    if (key.startsWith('issue view ')) return response(issue)
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

  it('ignores PRs with negative or out of scope issue bindings', () => {
    const currentHead = 'c'.repeat(40)
    const prList: Record<string, unknown>[] = [
      { number: 411, body: 'no Issue #410 work is included', url: 'https://github.com/boat1994/bemoat-web-starter/pull/411', headRefName: 'feature/410-context-no', closingIssuesReferences: [] },
      { number: 412, body: 'does not include issue #410', url: 'https://github.com/boat1994/bemoat-web-starter/pull/412', headRefName: 'feature/410-context-no2', closingIssuesReferences: [] },
      { number: 417, body: 'out of scope: issue #410', url: 'https://github.com/boat1994/bemoat-web-starter/pull/417', headRefName: 'feature/410-context-no3', closingIssuesReferences: [] },
      { number: 420, body: 'excluding issue #410', url: 'https://github.com/boat1994/bemoat-web-starter/pull/420', headRefName: 'feature/410-context-no4', closingIssuesReferences: [] },
    ]
    const runner = githubRunner({
      prList,
      prByNumber: {
        '411': prPayload({ state: 'OPEN', headRefOid: currentHead }),
        '412': prPayload({ state: 'OPEN', headRefOid: currentHead }),
        '417': prPayload({ state: 'OPEN', headRefOid: currentHead }),
        '420': prPayload({ state: 'OPEN', headRefOid: currentHead }),
      },
    })
    const evidence = readGithubEvidence({
      repo: 'boat1994/bemoat-web-starter',
      issueNumber: '410',
      branch: 'feature/unrelated-branch',
      run: runner,
    })

    expect(evidence.activePrs).toHaveLength(0)
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
  it('recovers deterministic numeric database ID supersession from malformed GraphQL node ID predecessor evidence', () => {
    const predecessorGraphqlId = 'IC_kwDOXYZ'
    const predecessorDbId = '5493541942'
    const predecessorUrl = `https://github.com/boat1994/bemoat-web-starter/issues/469#issuecomment-${predecessorDbId}`
    const headSha = '3dab2dbbd981f9d72d123ad1c2cf8398103f9348'
    const baseSha = '832782c585eb4c122ea05404fc1a615b865d68bb'

    const malformedPredecessorBody = `## REVIEW_VERDICT\n**Task:** Issue #469\n**Repository:** \`boat1994/bemoat-web-starter\`\n**PR / base / head:** PR #470 · \`main\` · \`${headSha}\`\n**Verdict:** CORRECTION REQUIRED\n\n\`\`\`json\n{ "schema_version": 1, "mode": "implementation_pr", "reviewed_head": "${headSha}", "findings": [] }\n\`\`\``

    const correctiveReviewBody = `## REVIEW_VERDICT\n**Supersedes:** ${predecessorDbId}\n**Task:** Issue #469\n**Repository:** \`boat1994/bemoat-web-starter\`\n**PR / base / head:** PR #470 · \`main\` · \`${headSha}\`\n**Verdict:** CORRECTION REQUIRED\n\n### Immutable finding disposition\n\`\`\`json\n{ "schema_version": 1, "mode": "implementation_pr", "reviewed_head": "${headSha}", "findings": [{ "id": "CTX-469-001", "canonical_summary": "Test", "source_thread": "link", "required_evidence": ["Ev"] }] }\n\`\`\``

    const run = githubRunner({
      issue: JSON.stringify({
        number: 469,
        title: 'Issue 469',
        state: 'OPEN',
        url: 'https://github.com/boat1994/bemoat-web-starter/issues/469',
        comments: [
          {
            id: predecessorGraphqlId,
            body: malformedPredecessorBody,
            createdAt: '2026-09-01T00:00:00Z',
            url: predecessorUrl,
          },
          {
            id: 'IC_kwDOABC',
            body: correctiveReviewBody,
            createdAt: '2026-09-01T01:00:00Z',
            url: 'https://github.com/boat1994/bemoat-web-starter/issues/469#issuecomment-5493689634',
          }
        ]
      }),
      prList: [JSON.parse(prPayload({ number: 470, url: 'https://github.com/boat1994/bemoat-web-starter/pull/470', headRefName: 'fix/469-recovery', baseRefName: 'main', baseRefOid: baseSha, headRefOid: headSha, body: 'Part of #469' }))],
      pr: prPayload({ number: 470, url: 'https://github.com/boat1994/bemoat-web-starter/pull/470', headRefName: 'fix/469-recovery', baseRefName: 'main', baseRefOid: baseSha, headRefOid: headSha, latestReviews: [], body: 'Part of #469' }),
      legacyProtection: response(JSON.stringify({})), rulesets: nativeRuleset(),
    })

    const evidence = readGithubEvidence({
      repo: 'boat1994/bemoat-web-starter', issueNumber: '469', branch: 'fix/469-recovery',
      run
    })

    expect(evidence.comments.length).toBe(2)
    const [predecessor, corrective] = evidence.comments

    expect(String(predecessor?.id)).toBe(predecessorDbId)
    expect(String(corrective?.id)).toBe('5493689634')

    const baseEvidenceOverrides: NormalizedContextEvidence = {
      repository: { owner: 'boat1994', name: 'bemoat-web-starter', nameWithOwner: 'boat1994/bemoat-web-starter', url: 'https://github.com/boat1994/bemoat-web-starter' },
      protectedBase: { branch: 'main', sha: baseSha, source: 'live', url: '' },
      policy: { path: '', policyId: 'bemoat-mission-control', version: '1.3.0', sourceSha: baseSha, url: '' },
      issue: { ...evidence.issue!, workflowProfile: 'STANDARD' },
      localGit: { branch: 'fix/469-recovery', head: headSha, upstream: 'origin/fix/469-recovery', originRepository: 'boat1994/bemoat-web-starter', clean: true, detached: false, pushed: true, durable: true, reasons: [] },
      activePr: evidence.activePrs[0] ?? null,
      currentHeadVerification: { exactHead: headSha, checks: { status: 'SUCCESS', complete: true, failed: false, pending: false, required: false }, reviews: { required: false, approved: true, exactHead: true, approvedCount: 0, exactHeadApprovedCount: 0, nativeReviews: [] }, protection: { available: true, requiredChecks: [], requiredApprovals: 0 } },
      durableContext: { latestHandoff: null, historicalResults: evidence.comments },
      evidenceErrors: evidence.errors,
    }

    const decision = routeContext(baseEvidenceOverrides)
    console.log('decision:', decision)
    expect(decision.route).toBe('FIX')
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

  it('characterizes protected-main PR #472 false-binding of Issue #464 and keeps the corrected GitHub-shaped path off COMPLETE', () => {
    const repo = 'boat1994/bemoat-web-starter'
    const pr472Title = 'fix(context): reject false PR bindings from negative issue mentions'
    const pr472Body = `Fixes #471

## Acceptance Criteria Audit
- **Done** - exact #464 reproduction: PR #466 with negative/out-of-scope Issue #464 text is not selected for Issue #464. (Regex logic now rejects negative lookbehind contexts).
- **Done** - PR #466 remains correctly bound to Issue #465. (Unchanged logic for true positives).
- **Done** - explicit native closingIssuesReferences binds the correct Issue. (Unchanged, bypasses regex).
- **Done** - unambiguous positive textual relation syntax still binds when canonical behavior requires it. (Regex \`relation\` remains intact).
- **Done** - negative forms such as no Issue #N work, does not include Issue #N, and out-of-scope lists do not bind. (Added regex negative test and regression test).
- **Done** - ambiguous/malformed/cross-repository evidence fails closed. (Canonical behavior intact).
- **Done** - focused production-shaped Context evidence-selection test proves the public path no longer routes #464 COMPLETE from PR #466. (Added tests to \`context-corrections.int.spec.ts\`).
- **Done** - existing terminal-precedence and review-lineage regression suites remain green. (Verified via \`pnpm run check\`).
- **Waiting for CI** - strict TypeScript, canonical repository checks, guards, and git diff --check pass. (Passed locally, waiting for CI).
`
    const pr472ClosingRefs = [{
      id: 'I_kwDOS4T8888AAAABPLtM7w',
      number: 471,
      repository: {
        id: 'R_kgDOS4T88w',
        name: 'bemoat-web-starter',
        owner: { id: 'MDQ6VXNlcjM2NTI4OTg4', login: 'boat1994' },
      },
      url: 'https://github.com/boat1994/bemoat-web-starter/issues/471',
    }]
    const pr472Record = {
      number: 472,
      title: pr472Title,
      body: pr472Body,
      closingIssuesReferences: pr472ClosingRefs,
    }

    expect(protectedMainOwnsIssue(pr472Record, repo, '464')).toBe(true)
    expect(prOwnsIssue(pr472Record, repo, '464')).toBe(false)
    expect(prOwnsIssue(pr472Record, repo, '471')).toBe(true)

    const topicHead = 'e'.repeat(40)
    const protectedSha = 'f'.repeat(40)
    const mergeSha = '3413c3cf239854a468b18514fd5b8c2b8a874a23'
    const run: ContextCommandRunner = (command, args) => {
      const key = args.join(' ')
      if (command === 'git') {
        const local: Record<string, string> = {
          'branch --show-current': 'feature/464-portability\n',
          'rev-parse HEAD': `${topicHead}\n`,
          'status --short': '',
          'rev-parse --abbrev-ref --symbolic-full-name @{upstream}': 'origin/feature/464-portability\n',
          'remote get-url origin': 'git@github.com:boat1994/bemoat-web-starter.git\n',
          'rev-parse refs/remotes/origin/feature/464-portability': `${topicHead}\n`,
          'ls-remote --heads origin feature/464-portability': `${topicHead}\trefs/heads/feature/464-portability\n`,
        }
        return response(local[key] ?? '')
      }
      if (key.includes('git/ref/heads/main')) return response(JSON.stringify({ object: { sha: protectedSha } }))
      if (key.includes('contents/docs/mission-control/mission-control-guide.md')) {
        return response(JSON.stringify({
          sha: 'c'.repeat(40),
          content: Buffer.from('---\npolicy_id: bemoat-mission-control\nversion: 1.3.0\n---\n').toString('base64'),
          encoding: 'base64',
        }))
      }
      if (key.startsWith('issue view 464')) {
        return response(JSON.stringify({
          number: 464,
          title: 'fix(context): preserve approved-base portability',
          state: 'OPEN',
          url: 'https://github.com/boat1994/bemoat-web-starter/issues/464',
          body: 'Task size: core\nMission Control mode: not required\n\n## Goal\n\nPreserve approved-base portability.\n',
          comments: [],
        }))
      }
      if (key.startsWith('pr list')) {
        return response(JSON.stringify([{
          number: 472,
          title: pr472Title,
          body: pr472Body,
          url: 'https://github.com/boat1994/bemoat-web-starter/pull/472',
          headRefName: 'fix/471-context-negative-binding',
          closingIssuesReferences: pr472ClosingRefs,
        }]))
      }
      if (key.startsWith('pr view 472')) {
        return response(prPayload({
          number: 472,
          state: 'MERGED',
          url: 'https://github.com/boat1994/bemoat-web-starter/pull/472',
          baseRefName: 'main',
          baseRefOid: '0c6fe388ccc91bb17060e5c15eee75dedca63539',
          headRefName: 'fix/471-context-negative-binding',
          headRefOid: 'a60e2b7ebd3788e3bcc063d7a0cb3daa37a41832',
          mergeCommit: { oid: mergeSha },
          title: pr472Title,
          body: pr472Body,
        }))
      }
      if (key.includes('branches/main/protection')) return response('', 1, 'HTTP 404 Not Found')
      if (key.includes('/rulesets?')) return response(nativeRuleset())
      return response('')
    }

    const evidence = collectContextEvidence({ cwd: '/repo', issueNumber: '464', run })
    expect(evidence.localGit.durable).toBe(true)
    expect(evidence.localGit.clean).toBe(true)
    expect(evidence.activePr).toBeNull()
    const decision = routeContext(evidence)
    expect(decision.route).not.toBe('COMPLETE')
    expect(decision.route).toBe('IMPLEMENT')
  })

  it('keeps genuine #472/#471 and #466/#465 bindings while rejecting incidental #464 mentions and unauthorized relation tokens', () => {
    const repo = 'boat1994/bemoat-web-starter'
    expect([...AUTHORIZED_TEXTUAL_PR_ISSUE_RELATIONS]).toEqual([
      'part of',
      'refs',
      'close',
      'closes',
      'closed',
      'fix',
      'fixes',
      'fixed',
      'resolve',
      'resolves',
      'resolved',
    ])
    expect(AUTHORIZED_TEXTUAL_PR_ISSUE_RELATIONS).not.toEqual(expect.arrayContaining([
      'related to',
      'references',
      'ref',
      'issue',
      'task issue',
    ]))

    expect(prOwnsIssue({
      title: 'fix(context): reject false PR bindings from negative issue mentions',
      body: 'Fixes #471\n\nAcceptance: Issue #464 must not bind.',
      closingIssuesReferences: [{ number: 471, repository: { nameWithOwner: repo } }],
    }, repo, '471')).toBe(true)

    expect(prOwnsIssue({
      title: 'fix(context): make clean issue-branch bootstrap durable',
      body: 'Part of #465\n\nNo Issue #464, bogus-jewelry PR #212, Finance acceptance, deploy, migration,\n  production, or stateful Mission Control work is included.',
      closingIssuesReferences: [],
    }, repo, '465')).toBe(true)
    expect(prOwnsIssue({
      title: 'fix(context): make clean issue-branch bootstrap durable',
      body: 'Part of #465\n\nNo Issue #464, bogus-jewelry PR #212, Finance acceptance, deploy, migration,\n  production, or stateful Mission Control work is included.',
      closingIssuesReferences: [],
    }, repo, '464')).toBe(false)

    const incidental = {
      title: 'docs: history',
      body: [
        'Regression notes: Issue #410 leaked into selection.',
        'Acceptance audit: querying Issue #410 must not COMPLETE.',
        'History / dependencies / scope: related to #410 and references #410.',
      ].join('\n'),
      closingIssuesReferences: [] as unknown[],
    }
    expect(prOwnsIssue(incidental, repo, '410')).toBe(false)
    expect(protectedMainOwnsIssue(incidental, repo, '410')).toBe(true)

    expect(prOwnsIssue({ body: 'related to #410', closingIssuesReferences: [] }, repo, '410')).toBe(false)
    expect(prOwnsIssue({ body: 'references #410', closingIssuesReferences: [] }, repo, '410')).toBe(false)
    expect(prOwnsIssue({ body: 'Ref #410', closingIssuesReferences: [] }, repo, '410')).toBe(false)
    expect(prOwnsIssue({ body: 'Issue #410', closingIssuesReferences: [] }, repo, '410')).toBe(false)
    expect(prOwnsIssue({ body: 'Part of #410', closingIssuesReferences: [] }, repo, '410')).toBe(true)
    expect(prOwnsIssue({ body: 'Refs #410', closingIssuesReferences: [] }, repo, '410')).toBe(true)
    expect(prOwnsIssue({ body: 'Closes #410', closingIssuesReferences: [] }, repo, '410')).toBe(true)
    expect(prOwnsIssue({ body: 'closed #410', closingIssuesReferences: [] }, repo, '410')).toBe(true)
    expect(prOwnsIssue({ body: 'fixed #410', closingIssuesReferences: [] }, repo, '410')).toBe(true)
    expect(prOwnsIssue({ body: 'resolved #410', closingIssuesReferences: [] }, repo, '410')).toBe(true)
    expect(prOwnsIssue({
      closingIssuesReferences: [{ number: 410, repository: { nameWithOwner: 'other/repo' } }],
    }, repo, '410')).toBe(false)

    const genuineMerged = readGithubEvidence({
      repo,
      issueNumber: '471',
      branch: 'unrelated-checkout',
      run: githubRunner({
        issue: JSON.stringify({
          number: 471,
          title: 'negative binding',
          state: 'CLOSED',
          url: 'https://github.com/boat1994/bemoat-web-starter/issues/471',
          body: 'Task size: core\nMission Control mode: not required\n\n## Goal\n\nReject negatives.\n',
          comments: [],
        }),
        prList: [{
          number: 472,
          title: 'fix(context): reject false PR bindings from negative issue mentions',
          body: 'Fixes #471\nIssue #464 is regression context only.',
          url: 'https://github.com/boat1994/bemoat-web-starter/pull/472',
          headRefName: 'fix/471-context-negative-binding',
          closingIssuesReferences: [{ number: 471, repository: { nameWithOwner: repo } }],
        }],
        pr: prPayload({
          number: 472,
          state: 'MERGED',
          url: 'https://github.com/boat1994/bemoat-web-starter/pull/472',
          headRefName: 'fix/471-context-negative-binding',
          headRefOid: 'a60e2b7ebd3788e3bcc063d7a0cb3daa37a41832',
          mergeCommit: { oid: '3413c3cf239854a468b18514fd5b8c2b8a874a23' },
        }),
      }),
    })
    expect(genuineMerged.activePrs).toEqual([expect.objectContaining({ number: '472', state: 'MERGED' })])
    const genuineRoute: NormalizedContextEvidence = {
      repository: { owner: 'boat1994', name: 'bemoat-web-starter', nameWithOwner: repo, url: `https://github.com/${repo}` },
      protectedBase: { branch: 'main', sha: baseSha, source: 'live GitHub ref', url: `https://github.com/${repo}/tree/main` },
      policy: { path: 'docs/mission-control/mission-control-guide.md', policyId: 'bemoat-mission-control', version: '1.3.0', sourceSha: baseSha, url: `https://github.com/${repo}/blob/main/docs/mission-control/mission-control-guide.md` },
      issue: { number: '471', title: 'negative binding', state: 'CLOSED', url: `https://github.com/${repo}/issues/471`, objective: null, scope: null, acceptanceCriteria: [], dependencies: [], taskSize: 'core', missionControlMode: 'optional', workflowProfile: 'STANDARD' },
      localGit: { branch: 'unrelated-checkout', head: headSha, upstream: 'origin/unrelated-checkout', originRepository: repo, clean: false, detached: false, pushed: true, durable: false, reasons: ['LOCAL_STATE_NOT_DURABLE: dirty'] },
      activePr: genuineMerged.activePrs[0],
      currentHeadVerification: genuineMerged.exactHead,
      durableContext: { latestHandoff: null, historicalResults: [] },
      evidenceErrors: genuineMerged.errors,
    }
    expect(routeContext(genuineRoute).route).toBe('COMPLETE')
  })
})

function protectedMainOwnsIssue(
  record: { title?: unknown; body?: unknown; closingIssuesReferences?: unknown },
  repo: string,
  issueNumber: string,
): boolean {
  const refs = record.closingIssuesReferences
  if (Array.isArray(refs) && refs.some((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const entry = value as { number?: unknown; repository?: { nameWithOwner?: unknown } }
    return String(entry.number ?? '') === issueNumber
      && (!entry.repository?.nameWithOwner || entry.repository.nameWithOwner === repo)
  })) return true
  const body = `${String(record.title ?? '')}\n${String(record.body ?? '')}`
  const escapedRepo = repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const relation = new RegExp(`(?:part of|refs?|references|related to|closes|fix(?:es)?|resolves|task\\s*[/:-]?\\s*issue|issue)\\s*(?:${escapedRepo})?\\s*#${issueNumber}\\b`, 'gi')
  let match
  while ((match = relation.exec(body)) !== null) {
    if (!/(?:no|not|without|except|excluding|does not include|out of scope)[\s:,-]*$/i.test(body.substring(Math.max(0, match.index - 30), match.index))) {
      return true
    }
  }
  return false
}
