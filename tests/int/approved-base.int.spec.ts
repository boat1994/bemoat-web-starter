import { describe, expect, it } from 'vitest'

import { collectContextEvidence } from '../../scripts/context/evidence.ts'
import { readHandoffBinding } from '../../scripts/handoff/github.ts'
import type { HandoffRecord } from '../../scripts/handoff/schema.ts'
import type { ContextCommandResult, ContextCommandRunner } from '../../scripts/context/runtime.ts'
import type { HandoffCommandResult, HandoffCommandRunner } from '../../scripts/handoff/runtime.ts'

const MAIN_SHA = 'a'.repeat(40)
const DEV_SHA = 'd'.repeat(40)
const HEAD_SHA = 'b'.repeat(40)
const POLICY_SHA = 'c'.repeat(40)
const REPO = 'boat1994/child-project'
const STARTER_REPO = 'boat1994/bemoat-web-starter'

function response(stdout: string): ContextCommandResult {
  return { status: 0, stdout, stderr: '', error: null }
}

function handoffOk(stdout: string): HandoffCommandResult {
  return { status: 0, stdout, stderr: '', error: null }
}

type LiveRefs = {
  dev?: string | null
  main?: string | null
  defaultBranch?: string
}

function liveRefHandler(refs: LiveRefs, repo: string) {
  return (key: string): ContextCommandResult | null => {
    if (key.includes(`repos/${repo}/git/ref/heads/dev`)) {
      if (refs.dev === null) return { status: 1, stdout: '', stderr: 'Not Found', error: null }
      if (refs.dev) return response(JSON.stringify({ object: { sha: refs.dev } }))
      return { status: 1, stdout: '', stderr: 'Not Found', error: null }
    }
    if (key.includes(`repos/${repo}/git/ref/heads/main`)) {
      if (refs.main === null) return { status: 1, stdout: '', stderr: 'Not Found', error: null }
      if (refs.main) return response(JSON.stringify({ object: { sha: refs.main } }))
      return { status: 1, stdout: '', stderr: 'Not Found', error: null }
    }
    return null
  }
}

function policyContentHandler(repo: string, baseSha: string) {
  return (key: string): ContextCommandResult | null => {
    if (key.includes(`contents/docs/mission-control/mission-control-guide.md?ref=${baseSha}`)) {
      return response(JSON.stringify({
        sha: POLICY_SHA,
        content: Buffer.from('---\npolicy_id: bemoat-mission-control\nversion: 1.3.0\n---\n').toString('base64'),
        encoding: 'base64',
      }))
    }
    return null
  }
}

function contextRunner(repo: string, refs: LiveRefs, issueNumber = '464'): ContextCommandRunner {
  const refHandler = liveRefHandler(refs, repo)
  const policyHandler = policyContentHandler(repo, refs.dev ?? refs.main ?? MAIN_SHA)
  return (_command, args) => {
    const key = args.join(' ')
    if (_command === 'git') {
      const local: Record<string, string> = {
        'branch --show-current': 'fix/464-approved-base-resolution\n',
        'rev-parse HEAD': `${HEAD_SHA}\n`,
        'status --short': '',
        'rev-parse --abbrev-ref --symbolic-full-name @{upstream}': 'origin/fix/464-approved-base-resolution\n',
        'remote get-url origin': `git@github.com:${repo}.git\n`,
        'rev-parse refs/remotes/origin/fix/464-approved-base-resolution': `${HEAD_SHA}\n`,
        'ls-remote --heads origin fix/464-approved-base-resolution': `${HEAD_SHA}\trefs/heads/fix/464-approved-base-resolution\n`,
      }
      return response(local[key] ?? '')
    }
    const ref = refHandler(key)
    if (ref) return ref
    const policy = policyHandler(key)
    if (policy) return policy
    if (key.startsWith(`issue view ${issueNumber}`)) {
      return response(JSON.stringify({
        number: Number(issueNumber),
        title: 'approved base resolution',
        state: 'OPEN',
        url: `https://github.com/${repo}/issues/${issueNumber}`,
        body: '## Goal\n\nResolve approved base.\n\nTask size: FAST\nMission Control mode: stateless\n',
        comments: [],
      }))
    }
    if (key.startsWith('pr list')) return response('[]')
    const baseBranch = refs.dev ? 'dev' : 'main'
    if (key.includes(`branches/${baseBranch}/protection`)) return response(JSON.stringify({}))
    return response('')
  }
}

function handoffRunner(repo: string, refs: LiveRefs, branch = 'fix/464-approved-base-resolution'): HandoffCommandRunner {
  const refHandler = liveRefHandler(refs, repo)
  const resolvedBranch = refs.dev ? 'dev' : 'main'
  const resolvedSha = (refs.dev ?? refs.main ?? MAIN_SHA).toLowerCase()
  return (command, args) => {
    const key = args.join(' ')
    if (command === 'git') {
      if (key === 'branch --show-current') return handoffOk(`${branch}\n`)
      if (key === 'rev-parse HEAD') return handoffOk(`${HEAD_SHA}\n`)
      if (key === 'status --short') return handoffOk('')
      if (key === 'remote get-url origin') return handoffOk(`https://github.com/${repo}.git\n`)
      if (key === 'rev-parse --abbrev-ref --symbolic-full-name @{upstream}') return handoffOk(`origin/${branch}\n`)
      if (key === `ls-remote --heads origin ${branch}`) return handoffOk(`${HEAD_SHA}\trefs/heads/${branch}\n`)
      return { status: 1, stdout: '', stderr: `unexpected git: ${key}`, error: null }
    }
    if (command !== 'gh') return { status: 1, stdout: '', stderr: `unexpected: ${command}`, error: null }
    if (args[0] === 'repo' && args[1] === 'view') {
      return handoffOk(JSON.stringify({
        nameWithOwner: repo,
        defaultBranchRef: { name: refs.defaultBranch ?? 'main' },
      }))
    }
    const ref = refHandler(key)
    if (ref) return ref
    if (args[0] === 'issue' && args[1] === 'view') {
      return handoffOk(JSON.stringify({ number: 464, url: `https://github.com/${repo}/issues/464`, state: 'OPEN' }))
    }
    if (args[0] === 'pr' && args[1] === 'list') return handoffOk('[]')
    if (args[0] === 'pr' && args[1] === 'view') {
      return handoffOk(JSON.stringify({
        number: 500,
        url: `https://github.com/${repo}/pull/500`,
        baseRefName: resolvedBranch,
        baseRefOid: resolvedSha,
        headRefName: branch,
        headRefOid: HEAD_SHA,
        state: 'OPEN',
        closingIssuesReferences: [{ number: 464, repository: { nameWithOwner: repo } }],
      }))
    }
    return { status: 1, stdout: '', stderr: `unexpected gh: ${key}`, error: null }
  }
}

function handoffRecord(protectedBranch: string, protectedSha: string, topicBranch = 'fix/464-approved-base-resolution', repository = REPO): HandoffRecord {
  return {
    schema_version: 1,
    record_type: 'HANDOFF',
    repository,
    issue_number: '464',
    objective: 'Resolve approved base.',
    permitted_scope: ['scripts/context/'],
    prohibited_scope: [],
    executing_agent: 'Composer',
    provider: 'Cursor',
    branch: topicBranch,
    exact_head: HEAD_SHA,
    protected_base: { branch: protectedBranch, sha: protectedSha },
    pr: {
      number: '500',
      url: `https://github.com/${repository}/pull/500`,
      base: protectedBranch,
      head: topicBranch,
      head_sha: HEAD_SHA,
    },
    verified_evidence: [{ kind: 'focused-tests', value: 'approved-base stories pass', url: 'https://github.com/actions' }],
    route: 'REVIEW',
    next_action: { route: 'REVIEW', description: 'Review approved-base resolution.' },
    stop_conditions: [],
    local_durability: { required: true, durable: true, reason: null },
  }
}

describe('Issue #464 approved-base resolution stories', () => {
  it('A: starter with only live refs/heads/main resolves protected_base=main and policy from main', () => {
    const refs: LiveRefs = { main: MAIN_SHA, dev: null }
    const evidence = collectContextEvidence({ cwd: '/repo', issueNumber: '464', run: contextRunner(STARTER_REPO, refs) })
    expect(evidence.protectedBase).toMatchObject({ branch: 'main', sha: MAIN_SHA })
    expect(evidence.policy.url).toContain(`/blob/${MAIN_SHA}/`)
    expect(evidence.evidenceErrors).not.toContain(expect.stringMatching(/approved-base-unresolved/))
  })

  it('B: child with default main and live dev resolves protected_base=dev and policy from dev', () => {
    const refs: LiveRefs = { main: MAIN_SHA, dev: DEV_SHA, defaultBranch: 'main' }
    const evidence = collectContextEvidence({ cwd: '/repo', issueNumber: '464', run: contextRunner(REPO, refs) })
    expect(evidence.protectedBase).toMatchObject({ branch: 'dev', sha: DEV_SHA })
    expect(evidence.policy.url).toContain(`/blob/${DEV_SHA}/`)
    expect(evidence.evidenceErrors.filter((e) => e.includes('protected base') || e.includes('protected dev'))).toEqual([])
  })

  it('C: child OPEN PR targeting dev@dev-sha is not EVIDENCE_CONFLICT vs main', () => {
    const refs: LiveRefs = { main: MAIN_SHA, dev: DEV_SHA, defaultBranch: 'main' }
    const run: ContextCommandRunner = (_command, args) => {
      const base = contextRunner(REPO, refs)(_command, args)
      const key = args.join(' ')
      if (key.startsWith('pr list')) {
        return response(JSON.stringify([{
          number: 500,
          url: `https://github.com/${REPO}/pull/500`,
          headRefName: 'fix/464-approved-base-resolution',
          closingIssuesReferences: [{ number: 464 }],
        }]))
      }
      if (key.startsWith('pr view 500')) {
        return response(JSON.stringify({
          number: 500,
          state: 'OPEN',
          isDraft: false,
          url: `https://github.com/${REPO}/pull/500`,
          baseRefName: 'dev',
          baseRefOid: DEV_SHA,
          headRefName: 'fix/464-approved-base-resolution',
          headRefOid: HEAD_SHA,
          mergeCommit: null,
          reviews: [],
          statusCheckRollup: [],
        }))
      }
      if (key.includes('branches/dev/protection')) return response(JSON.stringify({}))
      return base
    }

    const evidence = collectContextEvidence({ cwd: '/repo', issueNumber: '464', run })
    expect(evidence.protectedBase).toMatchObject({ branch: 'dev', sha: DEV_SHA })
    expect(evidence.evidenceErrors).not.toContain(expect.stringMatching(/PR #500 base does not match/))
    expect(evidence.evidenceErrors.filter((e) => e.startsWith('EVIDENCE_CONFLICT: PR #500'))).toEqual([])
  })

  it('D: Context and Handoff bind the same branch+SHA for starter-main and child-dev fixtures', () => {
    const starterRefs: LiveRefs = { main: MAIN_SHA, dev: null }
    const childRefs: LiveRefs = { main: MAIN_SHA, dev: DEV_SHA, defaultBranch: 'main' }

    const starterContext = collectContextEvidence({
      cwd: '/repo',
      issueNumber: '464',
      run: contextRunner(STARTER_REPO, starterRefs),
    })
    const starterHandoff = readHandoffBinding({
      cwd: '/repo',
      env: process.env,
      issueNumber: '464',
      record: handoffRecord('main', MAIN_SHA, 'fix/464-approved-base-resolution', STARTER_REPO),
      run: handoffRunner(STARTER_REPO, starterRefs),
    })
    expect(starterContext.protectedBase).toMatchObject({ branch: 'main', sha: MAIN_SHA })
    expect(starterHandoff.protectedBaseSha).toBe(MAIN_SHA)

    const childContext = collectContextEvidence({
      cwd: '/repo',
      issueNumber: '464',
      run: contextRunner(REPO, childRefs),
    })
    const childHandoff = readHandoffBinding({
      cwd: '/repo',
      env: process.env,
      issueNumber: '464',
      record: handoffRecord('dev', DEV_SHA),
      run: handoffRunner(REPO, childRefs),
    })
    expect(childContext.protectedBase).toMatchObject({ branch: 'dev', sha: DEV_SHA })
    expect(childHandoff.protectedBaseSha).toBe(DEV_SHA)
  })

  it('E: neither dev nor main exists fails closed with approved-base-unresolved; query failure stays BLOCKED_EXTERNAL', () => {
    const refs: LiveRefs = { main: null, dev: null }
    const evidence = collectContextEvidence({ cwd: '/repo', issueNumber: '464', run: contextRunner(REPO, refs) })
    expect(evidence.evidenceErrors.some((e) => e.includes('approved-base-unresolved'))).toBe(true)
    expect(evidence.protectedBase.branch).not.toBe('main')
    expect(evidence.protectedBase.branch).not.toBe('dev')

    const networkRun: ContextCommandRunner = (_command, args) => {
      const key = args.join(' ')
      if (key.includes('git/ref/heads/')) {
        return { status: 1, stdout: '', stderr: 'network timeout', error: new Error('network timeout') }
      }
      return contextRunner(REPO, { main: MAIN_SHA, dev: null })(_command, args)
    }
    const networkEvidence = collectContextEvidence({ cwd: '/repo', issueNumber: '464', run: networkRun })
    expect(networkEvidence.evidenceErrors.some((e) => e.startsWith('BLOCKED_EXTERNAL:'))).toBe(true)
    expect(networkEvidence.evidenceErrors.some((e) => e.includes('approved-base-unresolved'))).toBe(false)
  })
})
