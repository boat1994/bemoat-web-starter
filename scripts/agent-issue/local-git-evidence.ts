import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { run } from './process-runner.ts'
import { isPreReviewPlanningNoPrState } from './issue-declarations.ts'

const moduleDir = dirname(fileURLToPath(import.meta.url))
const branchSafetyScriptPath = resolve(moduleDir, '../check-branch-safety.sh')
const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/i
const ghRepoSchema = z.string().regex(/^[^/\s]+\/[^/\s]+$/)

export function getCurrentBranch(cwd: string = process.cwd()): string {
  return run('git', ['branch', '--show-current'], { cwd }).stdout.trim() || '<detached>'
}

export function getStatusShort(cwd: string = process.cwd()): string {
  return run('git', ['status', '--short'], { cwd }).stdout.trimEnd()
}

export function hasDevBranch(cwd: string = process.cwd()): boolean {
  const local = run('git', ['rev-parse', '--verify', '--quiet', 'dev'], { cwd })
  if (local.status === 0) return true

  const remote = run('git', ['rev-parse', '--verify', '--quiet', 'origin/dev'], { cwd })
  return remote.status === 0
}

export function getOriginUrl(cwd: string = process.cwd()): string | null {
  const result = run('git', ['remote', 'get-url', 'origin'], { cwd })
  if (result.status !== 0) return null

  const origin = result.stdout.trim()
  return origin || null
}

export function normalizeGithubRepoUrl(originUrl: string | null | undefined): string | null {
  if (!originUrl) return null

  if (originUrl.startsWith('git@github.com:')) {
    return `https://github.com/${originUrl.slice('git@github.com:'.length).replace(/\.git$/, '')}`
  }

  if (originUrl.startsWith('https://github.com/')) {
    return originUrl.replace(/\.git$/, '')
  }

  return null
}

export function buildIssueUrl(cwd: string, issueNumber: string | number): string | null {
  const repoUrl = normalizeGithubRepoUrl(getOriginUrl(cwd))
  if (!repoUrl) return null

  return `${repoUrl}/issues/${issueNumber}`
}

export function getDefaultRepo(cwd: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (ghRepoSchema.safeParse(env.GH_REPO ?? '').success) return env.GH_REPO as string
  const origin = getOriginUrl(cwd)
  if (!origin) return null

  if (origin.startsWith('git@github.com:')) {
    return origin.slice('git@github.com:'.length).replace(/\.git$/, '')
  }

  if (origin.startsWith('https://github.com/')) {
    return origin.replace('https://github.com/', '').replace(/\.git$/, '')
  }

  return null
}

export function runBranchSafety(cwd: string = process.cwd()): { ok: boolean; lines: string[] } {
  const result = run('bash', [branchSafetyScriptPath], { cwd })
  const combinedOutput = `${result.stdout}${result.stderr}`
    .trim()
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.startsWith('Current branch: '))

  return {
    ok: result.status === 0,
    lines: combinedOutput,
  }
}

interface ReadOnlyPlanningState {
  approved_base?: string
  guide_source_ref?: string
  planning_authorization_base_sha?: string
  guide_source_sha?: string
  workflow_mode?: string
  state?: string
  review_cycle?: number
  full_review_count?: number
  active_pr?: string | null
  current_head?: string | null
  last_reviewed_head?: string | null
}

export function isReadOnlyPlanningBaseline({
  cwd = process.cwd(),
  branchName,
  state,
  env = process.env,
}: {
  cwd?: string
  branchName?: string
  state?: ReadOnlyPlanningState
  env?: NodeJS.ProcessEnv
} = {}): boolean {
  if (
    branchName !== 'main' ||
    state?.approved_base !== 'main' ||
    state?.guide_source_ref !== 'main' ||
    !isPreReviewPlanningNoPrState(state as Record<string, unknown>)
  ) {
    return false
  }

  const planningSha = state?.planning_authorization_base_sha
  if (
    typeof planningSha !== 'string' ||
    !FULL_COMMIT_SHA.test(planningSha) ||
    typeof state?.guide_source_sha !== 'string' ||
    state.guide_source_sha.toLowerCase() !== planningSha.toLowerCase()
  ) {
    return false
  }

  const localHead = run('git', ['rev-parse', 'HEAD'], { cwd, env }).stdout.trim().toLowerCase()
  const protectedBase = run('git', ['rev-parse', '--verify', 'main^{commit}'], { cwd, env })
    .stdout.trim()
    .toLowerCase()
  const expected = planningSha.toLowerCase()
  return localHead === expected && protectedBase === expected
}

export function getCorrectionDiffFiles(
  cwd: string,
  reviewedHead: string,
  env: NodeJS.ProcessEnv = process.env,
): { ok: true; files: string[] } | { ok: false; errors: string[] } {
  const result = run('git', ['diff', '--name-only', reviewedHead, 'HEAD'], { cwd, env })
  if (result.status !== 0) {
    return { ok: false, errors: [result.stderr.trim() || result.stdout.trim() || 'git diff failed'] }
  }
  const files = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  return { ok: true, files }
}
