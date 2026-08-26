import { describe, expect, it } from 'vitest'

import type { ContextCommandResult, ContextCommandRunner } from '../../scripts/context/runtime.ts'
import type { NormalizedContextEvidence } from '../../scripts/context/model.ts'
import { authorizeContextSync, synchronizeContext } from '../../scripts/context/sync.ts'
import { runCliBoundaryCase } from '../helpers/cli-boundary-harness'

const oldBase = 'a'.repeat(40)
const protectedBase = 'c'.repeat(40)
const head = 'b'.repeat(40)
const nextHead = 'd'.repeat(40)
const advancedAgain = 'f'.repeat(40)
const prHeadBranch = 'test/427-story-first-context-coverage'
function baseEvidence(overrides: Partial<NormalizedContextEvidence> = {}): NormalizedContextEvidence {
  return {
    repository: { owner: 'boat1994', name: 'bemoat-web-starter', nameWithOwner: 'boat1994/bemoat-web-starter', url: 'https://github.com/boat1994/bemoat-web-starter' },
    protectedBase: { branch: 'main', sha: protectedBase, source: 'live GitHub ref', url: 'https://github.com/boat1994/bemoat-web-starter/tree/main' },
    policy: { path: 'docs/mission-control/mission-control-guide.md', policyId: 'bemoat-mission-control', version: '1.3.0', sourceSha: protectedBase, url: 'https://github.com/boat1994/bemoat-web-starter/blob/main/docs/mission-control/mission-control-guide.md' },
    issue: { number: '427', title: 'stale-base correction', state: 'OPEN', url: 'https://github.com/boat1994/bemoat-web-starter/issues/427', objective: 'Synchronize the stale active PR base.', scope: 'Issue #427 PR #428 only.', acceptanceCriteria: ['Bounded sync.'], dependencies: [], taskSize: 'core', missionControlMode: 'optional', workflowProfile: 'STANDARD' },
    localGit: { branch: 'test/427-story-first-context-coverage', head, upstream: 'origin/test/427-story-first-context-coverage', originRepository: 'boat1994/bemoat-web-starter', clean: true, detached: false, pushed: true, durable: true, reasons: [] },
    activePr: { number: '428', state: 'OPEN', draft: false, url: 'https://github.com/boat1994/bemoat-web-starter/pull/428', baseBranch: 'main', baseSha: oldBase, headBranch: 'test/427-story-first-context-coverage', headSha: head, merged: false, mergeCommitSha: null },
    currentHeadVerification: { exactHead: head, checks: { status: 'PENDING', complete: false, failed: false, pending: true, required: true }, reviews: { required: false, approved: true, exactHead: true, approvedCount: 0, exactHeadApprovedCount: 0 }, protection: { available: true, requiredChecks: ['CI'], requiredApprovals: 0 } },
    durableContext: { latestHandoff: null, historicalResults: [] },
    evidenceErrors: [`EVIDENCE_CONFLICT: PR #428 base does not match live protected main@${protectedBase}`],
    ...overrides,
  }
}

function response(stdout = '', status = 0): ContextCommandResult {
  return { status, stdout, stderr: status === 0 ? '' : 'failed', error: null }
}

describe('bounded stale-base synchronization', () => {
  it('exposes registered mutation-free JSON help without invoking Git', () => {
    const result = runCliBoundaryCase({
      entrypoint: 'scripts/agent-context-sync-base.mjs',
      argv: ['--help', '--json'],
    })
    expect(result.status).toBe(0)
    expect(result.filesystem_unchanged).toBe(true)
    expect(result.poison_invocations).toEqual([])
    expect(result.stdout, JSON.stringify(result)).not.toBe('')
    expect(JSON.parse(result.stdout)).toMatchObject({ command: 'bemoat:context:sync-base', mode: 'help', classification: 'HELP' })
  })

  it('fails closed through the public CLI without mutation when synchronization evidence is unavailable', () => {
    const result = runCliBoundaryCase({
      entrypoint: 'scripts/agent-context-sync-base.mjs',
      argv: ['427', '--json'],
    })
    const output = JSON.parse(result.stdout)
    const before = Object.fromEntries(
      Object.entries(result.before).filter(([path]) => path !== 'poison-calls.log'),
    )
    const after = Object.fromEntries(
      Object.entries(result.after).filter(([path]) => path !== 'poison-calls.log'),
    )

    expect(result.error).toBeNull()
    expect(after).toEqual(before)
    expect(output).toMatchObject({
      command: 'bemoat:context:sync-base',
      classification: 'EVIDENCE_CONFLICT',
      mutation_performed: false,
      next_action: { type: 'STOP', command: null },
    })
    expect(result.poison_invocations.some((call) => /\bgit\s+(?:merge|push)\b/.test(call))).toBe(false)
  })

  it('authorizes one sync only for otherwise-valid same-scope stale active PR evidence', () => {
    expect(authorizeContextSync(baseEvidence())).toMatchObject({ allowed: true, route: 'VERIFY' })
  })

  it('does not require a per-incident Founder HANDOFF once the bounded command contract is merged', () => {
    expect(authorizeContextSync(baseEvidence({
      durableContext: { latestHandoff: null, historicalResults: [] },
    }))).toMatchObject({ allowed: true, route: 'VERIFY' })
  })

  it.each([
    ['wrong base branch', { activePr: { ...baseEvidence().activePr!, baseBranch: 'release' } }],
    ['changed PR head', { localGit: { ...baseEvidence().localGit, head: 'e'.repeat(40) } }],
    ['non-origin upstream', { localGit: { ...baseEvidence().localGit, upstream: `fork/${prHeadBranch}` } }],
    ['dirty local state', { localGit: { ...baseEvidence().localGit, clean: false, durable: false } }],
    ['detached local state', { localGit: { ...baseEvidence().localGit, detached: true } }],
    ['unpushed local state', { localGit: { ...baseEvidence().localGit, pushed: false } }],
    ['non-durable local state', { localGit: { ...baseEvidence().localGit, durable: false } }],
    ['ambiguous evidence', { evidenceErrors: [...baseEvidence().evidenceErrors, 'EVIDENCE_CONFLICT: competing review evidence'] }],
    ['not stale', { evidenceErrors: [], protectedBase: { ...baseEvidence().protectedBase, sha: oldBase } }],
  ])('keeps %s fail-closed', (_label, overrides) => {
    expect(authorizeContextSync(baseEvidence(overrides as Partial<NormalizedContextEvidence>))).toMatchObject({ allowed: false, route: 'STOP' })
  })

  it('stops before merge or push when native merge-tree detects a conflict', () => {
    const calls: string[] = []
    const run: ContextCommandRunner = (command, args) => {
      calls.push(`${command} ${args.join(' ')}`)
      const key = args.join(' ')
      if (key === 'status --short') return response('')
      if (key === 'branch --show-current') return response(baseEvidence().localGit.branch)
      if (key === 'rev-parse HEAD') return response(head)
      if (key === 'ls-remote --heads origin main') return response(`${protectedBase}\trefs/heads/main\n`)
      if (key === `ls-remote --heads origin ${prHeadBranch}`) return response(`${head}\trefs/heads/${prHeadBranch}\n`)
      if (key === 'fetch --no-tags origin main') return response()
      if (key === 'rev-parse FETCH_HEAD') return response(protectedBase)
      if (key === `merge-base --is-ancestor ${oldBase} FETCH_HEAD` || key === `merge-base --is-ancestor ${oldBase} HEAD`) return response()
      if (key === 'merge-tree --write-tree HEAD FETCH_HEAD') return response('', 1)
      return response()
    }

    expect(synchronizeContext({ evidence: baseEvidence(), cwd: '/repo', run })).toMatchObject({ classification: 'EVIDENCE_CONFLICT', route: 'STOP', mutationPerformed: false })
    expect(calls.some((call) => call.includes('merge --no-edit') || call.includes('push '))).toBe(false)
  })

  it.each([
    ['protected main did not advance from the recorded base', `merge-base --is-ancestor ${oldBase} FETCH_HEAD`],
    ['the PR head does not contain its recorded base', `merge-base --is-ancestor ${oldBase} HEAD`],
  ])('stops before merge or push when %s', (_story, failedAncestry) => {
    const calls: string[] = []
    const run: ContextCommandRunner = (command, args) => {
      calls.push(`${command} ${args.join(' ')}`)
      const key = args.join(' ')
      if (key === 'status --short') return response('')
      if (key === 'branch --show-current') return response(baseEvidence().localGit.branch)
      if (key === 'rev-parse HEAD') return response(head)
      if (key === 'ls-remote --heads origin main') return response(`${protectedBase}\trefs/heads/main\n`)
      if (key === `ls-remote --heads origin ${prHeadBranch}`) return response(`${head}\trefs/heads/${prHeadBranch}\n`)
      if (key === 'fetch --no-tags origin main') return response()
      if (key === 'rev-parse FETCH_HEAD') return response(protectedBase)
      if (key === failedAncestry) return response('', 1)
      return response()
    }

    expect(synchronizeContext({ evidence: baseEvidence(), cwd: '/repo', run })).toMatchObject({
      classification: 'EVIDENCE_CONFLICT',
      route: 'STOP',
      mutationPerformed: false,
    })
    expect(calls.some((call) => call.includes('merge --no-edit') || call.includes('push '))).toBe(false)
  })

  it('revalidates protected base and PR head immediately before merge', () => {
    const calls: string[] = []
    let protectedReads = 0
    const run: ContextCommandRunner = (command, args) => {
      calls.push(`${command} ${args.join(' ')}`)
      const key = args.join(' ')
      if (key === 'status --short') return response('')
      if (key === 'branch --show-current') return response(baseEvidence().localGit.branch)
      if (key === 'rev-parse HEAD') return response(head)
      if (key === 'ls-remote --heads origin main') {
        protectedReads += 1
        const sha = protectedReads === 1 ? protectedBase : advancedAgain
        return response(`${sha}\trefs/heads/main\n`)
      }
      if (key === `ls-remote --heads origin ${prHeadBranch}`) return response(`${head}\trefs/heads/${prHeadBranch}\n`)
      if (key === 'fetch --no-tags origin main') return response()
      if (key === 'rev-parse FETCH_HEAD') return response(protectedBase)
      if (key === `merge-base --is-ancestor ${oldBase} FETCH_HEAD` || key === `merge-base --is-ancestor ${oldBase} HEAD`) return response()
      if (key === 'merge-tree --write-tree HEAD FETCH_HEAD') return response()
      return response()
    }

    expect(synchronizeContext({ evidence: baseEvidence(), cwd: '/repo', run })).toMatchObject({
      classification: 'HEAD_DRIFT',
      route: 'STOP',
      mutationPerformed: false,
    })
    expect(calls.some((call) => call.includes('merge --no-edit') || call.includes('push '))).toBe(false)
  })

  it('merges and pushes only after exact protected-base and active-branch readback', () => {
    const calls: string[] = []
    const run: ContextCommandRunner = (command, args) => {
      calls.push(`${command} ${args.join(' ')}`)
      const key = args.join(' ')
      if (key === 'status --short') return response('')
      if (key === 'branch --show-current') return response(baseEvidence().localGit.branch)
      if (key === 'rev-parse HEAD') return response(calls.filter((call) => call === 'git rev-parse HEAD').length > 1 ? nextHead : head)
      if (key === 'ls-remote --heads origin main') return response(`${protectedBase}\trefs/heads/main\n`)
      if (key === `ls-remote --heads origin ${prHeadBranch}`) return response(`${calls.some((call) => call.startsWith('git push ')) ? nextHead : head}\trefs/heads/${prHeadBranch}\n`)
      if (key === 'fetch --no-tags origin main') return response()
      if (key === 'rev-parse FETCH_HEAD') return response(protectedBase)
      if (key === `merge-base --is-ancestor ${oldBase} FETCH_HEAD` || key === `merge-base --is-ancestor ${oldBase} HEAD`) return response()
      if (key === 'merge-tree --write-tree HEAD FETCH_HEAD' || key === 'merge --no-edit FETCH_HEAD') return response()
      return response()
    }

    expect(synchronizeContext({ evidence: baseEvidence(), cwd: '/repo', run })).toMatchObject({ classification: 'SUCCESS', mutationPerformed: true, route: 'VERIFY', currentHead: nextHead })
    expect(calls.some((call) => call === `git push origin HEAD:${prHeadBranch}`)).toBe(true)
  })
})
