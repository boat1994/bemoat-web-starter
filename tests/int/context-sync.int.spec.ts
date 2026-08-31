import { describe, expect, it } from 'vitest'

import type { ContextCommandResult, ContextCommandRunner } from '../../scripts/context/runtime.ts'
import type { NormalizedContextEvidence } from '../../scripts/context/model.ts'
import type { HandoffRecord } from '../../scripts/handoff/schema.ts'
import { authorizeContextSync, synchronizeContext } from '../../scripts/context/sync.ts'
import { ContextSyncWorktreeError, resolveContextSyncRoots } from '../../scripts/context/sync-worktree.ts'
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

function strictHandoff(overrides: Partial<HandoffRecord> = {}) {
  const record: HandoffRecord = {
    schema_version: 1,
    record_type: 'HANDOFF',
    repository: 'boat1994/bemoat-web-starter',
    issue_number: '427',
    objective: 'Continue the bounded stale-base objective.',
    permitted_scope: ['Synchronize protected main into the same active PR branch.'],
    prohibited_scope: ['Do not merge the PR or broaden the Issue objective.'],
    executing_agent: 'Execution / IDE Agent',
    provider: 'OpenAI Codex',
    branch: prHeadBranch,
    exact_head: head,
    protected_base: { branch: 'main', sha: oldBase },
    pr: {
      number: '428',
      url: 'https://github.com/boat1994/bemoat-web-starter/pull/428',
      base: 'main',
      head: prHeadBranch,
      head_sha: head,
    },
    verified_evidence: [{ kind: 'context', value: 'The bounded active PR evidence is durable.', url: null }],
    route: 'VERIFY',
    next_action: { route: 'VERIFY', description: 'Verify the exact durable implementation.' },
    stop_conditions: ['Stop on identity, scope, head, base, or durability drift.'],
    local_durability: { required: true, durable: true, reason: null },
    ...overrides,
  }
  return {
    id: 'IC_scope_binding',
    body: `## HANDOFF\n\n\`\`\`json\n${JSON.stringify(record, null, 2)}\n\`\`\`\n`,
    createdAt: '2026-08-27T16:47:04Z',
    url: 'https://github.com/boat1994/bemoat-web-starter/issues/427#issuecomment-scope-binding',
  }
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
    const help = JSON.parse(result.stdout)
    expect(help).toMatchObject({ command: 'bemoat:context:sync-base', mode: 'help', classification: 'HELP' })
    expect(help.optional_flags).toContainEqual(expect.objectContaining({
      name: 'target_worktree',
      syntax: '--target-worktree <absolute-path>',
      value_type: 'path',
      required: false,
    }))
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

  it('rejects a relative explicit target through the public CLI before invoking Git', () => {
    const result = runCliBoundaryCase({
      entrypoint: 'scripts/agent-context-sync-base.mjs',
      argv: ['427', '--target-worktree', 'relative-target', '--json'],
    })
    const output = JSON.parse(result.stdout)

    expect(output).toMatchObject({
      classification: 'INVALID_INVOCATION',
      mutation_performed: false,
      next_action: { type: 'STOP', command: null },
    })
    expect(output.details.reason).toContain('absolute path')
    expect(result.poison_invocations).toEqual([])
  })

  it('rejects duplicate explicit targets through the public CLI before invoking Git', () => {
    const result = runCliBoundaryCase({
      entrypoint: 'scripts/agent-context-sync-base.mjs',
      argv: ['427', '--target-worktree', '/first', '--target-worktree', '/second', '--json'],
    })

    expect(JSON.parse(result.stdout)).toMatchObject({
      classification: 'INVALID_INVOCATION',
      mutation_performed: false,
    })
    expect(result.poison_invocations).toEqual([])
  })

  it('canonicalizes an explicit absolute target while preserving the protected-main source', () => {
    const roots = resolveContextSyncRoots({
      sourceCwd: '/protected-main-link',
      targetWorktree: '/stale-pr-link',
      realpath: (path) => path === '/protected-main-link' ? '/protected-main' : '/stale-pr',
      stat: () => ({ isDirectory: () => true }),
    })

    expect(roots).toEqual({ sourceCwd: '/protected-main', targetCwd: '/stale-pr', bootstrap: true })
  })

  it('preserves unchanged same-worktree behavior when the target flag is omitted', () => {
    expect(resolveContextSyncRoots({
      sourceCwd: '/protected-main-link',
      targetWorktree: null,
      realpath: () => '/protected-main',
      stat: () => ({ isDirectory: () => true }),
    })).toEqual({ sourceCwd: '/protected-main', targetCwd: '/protected-main', bootstrap: false })
  })

  it.each([
    ['a relative target', 'relative-target', (path: string) => path, () => ({ isDirectory: () => true }), 'absolute path'],
    ['a missing target', '/missing', () => { throw new Error('ENOENT') }, () => ({ isDirectory: () => true }), 'canonicalized'],
    ['a non-directory target', '/file', (path: string) => path, () => ({ isDirectory: () => false }), 'directory'],
    ['a source alias', '/source-link', () => '/source', () => ({ isDirectory: () => true }), 'distinct'],
  ])('rejects %s before evidence collection', (_story, targetWorktree, realpath, stat, reason) => {
    expect(() => resolveContextSyncRoots({
      sourceCwd: '/source',
      targetWorktree,
      realpath,
      stat,
    })).toThrowError(ContextSyncWorktreeError)
    expect(() => resolveContextSyncRoots({
      sourceCwd: '/source',
      targetWorktree,
      realpath,
      stat,
    })).toThrow(reason)
  })

  it('authorizes one sync only for otherwise-valid same-scope stale active PR evidence', () => {
    expect(authorizeContextSync(baseEvidence())).toMatchObject({ allowed: true, route: 'VERIFY' })
  })

  it('authorizes a #441-shaped Issue through its exact current strict HANDOFF scope binding', () => {
    const evidence = baseEvidence({
      issue: {
        ...baseEvidence().issue,
        objective: 'Add paired provider-portable Context and Handoff skills.',
        scope: null,
        acceptanceCriteria: ['The skills remain thin stateless adapters.'],
      },
      durableContext: { latestHandoff: strictHandoff(), historicalResults: [] },
    })

    expect(authorizeContextSync(evidence)).toMatchObject({ allowed: true, route: 'VERIFY' })
  })

  it.each([
    ['missing HANDOFF', null],
    ['malformed HANDOFF', { ...strictHandoff(), body: '## HANDOFF\n\nnot-json' }],
    ['wrong repository', strictHandoff({ repository: 'other/repository' })],
    ['wrong Issue', strictHandoff({ issue_number: '441' })],
    ['wrong protected base', strictHandoff({ protected_base: { branch: 'main', sha: protectedBase } })],
    ['wrong exact head', strictHandoff({ exact_head: advancedAgain, pr: { number: '428', url: 'https://github.com/boat1994/bemoat-web-starter/pull/428', base: 'main', head: prHeadBranch, head_sha: advancedAgain } })],
    ['wrong PR', strictHandoff({ pr: { number: '442', url: 'https://github.com/boat1994/bemoat-web-starter/pull/442', base: 'main', head: prHeadBranch, head_sha: head } })],
    ['wrong branch', strictHandoff({ branch: 'feature/other', pr: { number: '428', url: 'https://github.com/boat1994/bemoat-web-starter/pull/428', base: 'main', head: 'feature/other', head_sha: head } })],
    ['non-durable HANDOFF state', strictHandoff({ local_durability: { required: false, durable: false, reason: null } })],
  ])('keeps Issue scope fail-closed for %s', (_story, latestHandoff) => {
    const evidence = baseEvidence({
      issue: { ...baseEvidence().issue, scope: null },
      durableContext: { latestHandoff, historicalResults: [] },
    })

    expect(authorizeContextSync(evidence)).toMatchObject({ allowed: false, route: 'STOP' })
  })

  it('keeps a missing Issue objective fail-closed even with an exact strict HANDOFF', () => {
    const evidence = baseEvidence({
      issue: { ...baseEvidence().issue, objective: null, scope: null },
      durableContext: { latestHandoff: strictHandoff(), historicalResults: [] },
    })

    expect(authorizeContextSync(evidence)).toMatchObject({ allowed: false, route: 'STOP' })
  })

  it('does not require a per-incident Founder HANDOFF once the bounded command contract is merged', () => {
    expect(authorizeContextSync(baseEvidence({
      durableContext: { latestHandoff: null, historicalResults: [] },
    }))).toMatchObject({ allowed: true, route: 'VERIFY' })
  })

  it('uses the exact protected-main command source to synchronize an explicit stale target worktree', () => {
    const sourceCwd = '/protected-main'
    const targetCwd = '/stale-pr'
    const calls: Array<{ command: string; args: string; cwd: string | undefined }> = []
    let merged = false
    let pushed = false
    const run: ContextCommandRunner = (command, args, options) => {
      const key = args.join(' ')
      const cwd = options?.cwd
      calls.push({ command, args: key, cwd })

      if (command !== 'git') return response('', 1)
      if (cwd === sourceCwd) {
        if (key === 'rev-parse --show-toplevel') return response(sourceCwd)
        if (key === 'rev-parse HEAD') return response(protectedBase)
        if (key === 'status --short') return response('')
        if (key === 'remote get-url origin') return response('https://github.com/boat1994/bemoat-web-starter.git')
        return response('', 1)
      }
      if (cwd !== targetCwd) return response('', 1)
      if (key === 'status --short') return response('')
      if (key === 'branch --show-current') return response(prHeadBranch)
      if (key === 'rev-parse HEAD') return response(merged ? nextHead : head)
      if (key === 'ls-remote --heads origin main') return response(`${protectedBase}\trefs/heads/main\n`)
      if (key === `ls-remote --heads origin ${prHeadBranch}`) {
        return response(`${pushed ? nextHead : head}\trefs/heads/${prHeadBranch}\n`)
      }
      if (key === 'fetch --no-tags origin main') return response()
      if (key === 'rev-parse FETCH_HEAD') return response(protectedBase)
      if (key === `merge-base --is-ancestor ${oldBase} FETCH_HEAD`) return response()
      if (key === `merge-base --is-ancestor ${oldBase} HEAD`) return response()
      if (key === 'merge-tree --write-tree HEAD FETCH_HEAD') return response(nextHead)
      if (key === 'merge --no-edit FETCH_HEAD') { merged = true; return response() }
      if (key === `push origin HEAD:${prHeadBranch}`) { pushed = true; return response() }
      return response('', 1)
    }

    const result = synchronizeContext({
      evidence: baseEvidence(),
      cwd: targetCwd,
      run,
      ...{ sourceCwd },
    })

    expect(result).toMatchObject({
      classification: 'SUCCESS',
      mutationPerformed: true,
      currentHead: nextHead,
    })
    expect(calls).toContainEqual({ command: 'git', args: 'rev-parse HEAD', cwd: sourceCwd })
    expect(calls).toContainEqual({ command: 'git', args: 'merge --no-edit FETCH_HEAD', cwd: targetCwd })
    expect(calls).toContainEqual({ command: 'git', args: `push origin HEAD:${prHeadBranch}`, cwd: targetCwd })
    expect(calls.filter((call) => call.cwd === sourceCwd).every((call) => [
      'rev-parse --show-toplevel',
      'rev-parse HEAD',
      'status --short',
      'remote get-url origin',
    ].includes(call.args))).toBe(true)
    expect(calls.some((call) => /^(worktree|cp|gh)\b/.test(call.args))).toBe(false)
  })

  it.each([
    ['wrong source root', { topLevel: '/other-main', sourceHead: protectedBase, status: '', origin: 'https://github.com/boat1994/bemoat-web-starter.git' }],
    ['wrong source SHA', { topLevel: '/protected-main', sourceHead: advancedAgain, status: '', origin: 'https://github.com/boat1994/bemoat-web-starter.git' }],
    ['dirty source', { topLevel: '/protected-main', sourceHead: protectedBase, status: ' M scripts/context/sync.ts', origin: 'https://github.com/boat1994/bemoat-web-starter.git' }],
    ['wrong source repository', { topLevel: '/protected-main', sourceHead: protectedBase, status: '', origin: 'https://github.com/other/repository.git' }],
  ])('stops before reading or mutating the target for %s', (_story, source) => {
    const calls: Array<{ args: string; cwd: string | undefined }> = []
    const run: ContextCommandRunner = (_command, args, options) => {
      const key = args.join(' ')
      calls.push({ args: key, cwd: options?.cwd })
      if (key === 'rev-parse --show-toplevel') return response(source.topLevel)
      if (key === 'rev-parse HEAD') return response(source.sourceHead)
      if (key === 'status --short') return response(source.status)
      if (key === 'remote get-url origin') return response(source.origin)
      return response('', 1)
    }

    expect(synchronizeContext({
      evidence: baseEvidence(),
      cwd: '/stale-pr',
      sourceCwd: '/protected-main',
      run,
    })).toMatchObject({ classification: 'EVIDENCE_CONFLICT', mutationPerformed: false, route: 'STOP' })
    expect(calls.every((call) => call.cwd === '/protected-main')).toBe(true)
    expect(calls.some((call) => /^(merge|push|fetch)\b/.test(call.args))).toBe(false)
  })

  it('stops without mutation when the protected-main source drifts immediately before merge', () => {
    const sourceCwd = '/protected-main'
    const targetCwd = '/stale-pr'
    const calls: Array<{ args: string; cwd: string | undefined }> = []
    let sourceHeadReads = 0
    const run: ContextCommandRunner = (_command, args, options) => {
      const key = args.join(' ')
      const cwd = options?.cwd
      calls.push({ args: key, cwd })
      if (cwd === sourceCwd) {
        if (key === 'rev-parse --show-toplevel') return response(sourceCwd)
        if (key === 'rev-parse HEAD') {
          sourceHeadReads += 1
          return response(sourceHeadReads === 1 ? protectedBase : advancedAgain)
        }
        if (key === 'status --short') return response('')
        if (key === 'remote get-url origin') return response('https://github.com/boat1994/bemoat-web-starter.git')
      }
      if (cwd === targetCwd) {
        if (key === 'status --short') return response('')
        if (key === 'branch --show-current') return response(prHeadBranch)
        if (key === 'rev-parse HEAD') return response(head)
        if (key === 'ls-remote --heads origin main') return response(`${protectedBase}\trefs/heads/main\n`)
        if (key === `ls-remote --heads origin ${prHeadBranch}`) return response(`${head}\trefs/heads/${prHeadBranch}\n`)
        if (key === 'fetch --no-tags origin main') return response()
        if (key === 'rev-parse FETCH_HEAD') return response(protectedBase)
        if (key === `merge-base --is-ancestor ${oldBase} FETCH_HEAD` || key === `merge-base --is-ancestor ${oldBase} HEAD`) return response()
        if (key === 'merge-tree --write-tree HEAD FETCH_HEAD') return response(nextHead)
      }
      return response('', 1)
    }

    expect(synchronizeContext({ evidence: baseEvidence(), cwd: targetCwd, sourceCwd, run })).toMatchObject({
      classification: 'HEAD_DRIFT',
      mutationPerformed: false,
      route: 'STOP',
    })
    expect(calls.some((call) => call.args === 'merge --no-edit FETCH_HEAD' || call.args.startsWith('push '))).toBe(false)
  })

  it.each([
    ['status', 'status --short', ' M target-file'],
    ['branch', 'branch --show-current', 'wrong-branch'],
    ['HEAD', 'rev-parse HEAD', advancedAgain],
  ])('stops without mutation when target %s drifts immediately before merge', (_story, driftCommand, driftValue) => {
    const calls: string[] = []
    const reads = new Map<string, number>()
    const run: ContextCommandRunner = (_command, args) => {
      const key = args.join(' ')
      calls.push(key)
      if (['status --short', 'branch --show-current', 'rev-parse HEAD'].includes(key)) {
        const count = (reads.get(key) ?? 0) + 1
        reads.set(key, count)
        if (key === driftCommand && count > 1) return response(driftValue)
        if (key === 'status --short') return response('')
        if (key === 'branch --show-current') return response(prHeadBranch)
        return response(head)
      }
      if (key === 'ls-remote --heads origin main') return response(`${protectedBase}\trefs/heads/main\n`)
      if (key === `ls-remote --heads origin ${prHeadBranch}`) return response(`${head}\trefs/heads/${prHeadBranch}\n`)
      if (key === 'fetch --no-tags origin main') return response()
      if (key === 'rev-parse FETCH_HEAD') return response(protectedBase)
      if (key === `merge-base --is-ancestor ${oldBase} FETCH_HEAD` || key === `merge-base --is-ancestor ${oldBase} HEAD`) return response()
      if (key === 'merge-tree --write-tree HEAD FETCH_HEAD') return response(nextHead)
      return response('', 1)
    }

    expect(synchronizeContext({ evidence: baseEvidence(), cwd: '/stale-pr', run })).toMatchObject({
      classification: 'HEAD_DRIFT',
      mutationPerformed: false,
      route: 'STOP',
    })
    expect(calls.some((call) => call === 'merge --no-edit FETCH_HEAD' || call.startsWith('push '))).toBe(false)
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
    let merged = false
    const run: ContextCommandRunner = (command, args) => {
      calls.push(`${command} ${args.join(' ')}`)
      const key = args.join(' ')
      if (key === 'status --short') return response('')
      if (key === 'branch --show-current') return response(baseEvidence().localGit.branch)
      if (key === 'rev-parse HEAD') return response(merged ? nextHead : head)
      if (key === 'ls-remote --heads origin main') return response(`${protectedBase}\trefs/heads/main\n`)
      if (key === `ls-remote --heads origin ${prHeadBranch}`) return response(`${calls.some((call) => call.startsWith('git push ')) ? nextHead : head}\trefs/heads/${prHeadBranch}\n`)
      if (key === 'fetch --no-tags origin main') return response()
      if (key === 'rev-parse FETCH_HEAD') return response(protectedBase)
      if (key === `merge-base --is-ancestor ${oldBase} FETCH_HEAD` || key === `merge-base --is-ancestor ${oldBase} HEAD`) return response()
      if (key === 'merge-tree --write-tree HEAD FETCH_HEAD') return response()
      if (key === 'merge --no-edit FETCH_HEAD') { merged = true; return response() }
      return response()
    }

    expect(synchronizeContext({ evidence: baseEvidence(), cwd: '/repo', run })).toMatchObject({ classification: 'SUCCESS', mutationPerformed: true, route: 'VERIFY', currentHead: nextHead })
    expect(calls.some((call) => call === `git push origin HEAD:${prHeadBranch}`)).toBe(true)
  })
})
