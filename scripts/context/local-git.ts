import type { LocalGitEvidence } from './model.ts'
import { normalizeOriginRepository, output, type ContextCommandRunner } from './runtime.ts'

export function readLocalGitEvidence({ cwd, run }: { cwd: string; run: ContextCommandRunner }): LocalGitEvidence {
  const branch = output(run('git', ['branch', '--show-current'], { cwd })) ?? ''
  const head = output(run('git', ['rev-parse', 'HEAD'], { cwd }))
  const status = output(run('git', ['status', '--short'], { cwd })) ?? ''
  const upstream = output(run('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], { cwd }))
  const origin = output(run('git', ['remote', 'get-url', 'origin'], { cwd }))
  const upstreamRemote = upstream?.split('/', 1)[0] ?? null
  const liveRemoteResult = branch && upstreamRemote
    ? run('git', ['ls-remote', '--heads', upstreamRemote, branch], { cwd })
    : null
  const liveRemoteLine = liveRemoteResult && liveRemoteResult.status === 0 && !liveRemoteResult.error
    ? liveRemoteResult.stdout.trim().split(/\r?\n/)[0] ?? ''
    : ''
  const liveRemoteHead = /^[0-9a-f]{40}(?:\s|$)/i.test(liveRemoteLine)
    ? liveRemoteLine.split(/\s+/, 1)[0]
    : null
  const clean = status === ''
  const detached = branch === ''
  const upstreamBranch = upstream?.replace(/^[^/]+\//, '') ?? null
  const upstreamMatchesBranch = Boolean(branch && upstreamBranch === branch)
  const pushed = Boolean(head && upstream && upstreamMatchesBranch && liveRemoteHead && head === liveRemoteHead)
  const reasons: string[] = []
  if (detached) reasons.push('LOCAL_STATE_NOT_DURABLE: repository is detached')
  if (!clean) reasons.push('LOCAL_STATE_NOT_DURABLE: working tree is dirty or has untracked files')
  if (!upstream) reasons.push('LOCAL_STATE_NOT_DURABLE: current branch has no upstream')
  if (upstream && !upstreamMatchesBranch) reasons.push('LOCAL_STATE_NOT_DURABLE: upstream branch does not match the current branch')
  if (!liveRemoteHead) reasons.push('LOCAL_STATE_NOT_DURABLE: live remote branch identity is unavailable')
  else if (!pushed) reasons.push('LOCAL_STATE_NOT_DURABLE: current HEAD is not proven pushed to its live upstream')
  if (!head) reasons.push('EVIDENCE_CONFLICT: local HEAD is unavailable')
  if (!normalizeOriginRepository(origin)) reasons.push('EVIDENCE_CONFLICT: origin is not the canonical GitHub repository')
  return {
    branch: branch || '<detached>',
    head,
    upstream,
    originRepository: normalizeOriginRepository(origin),
    clean,
    detached,
    pushed,
    durable: reasons.length === 0,
    reasons,
  }
}
