import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run } from './process-runner.mjs'
import { isPreReviewPlanningNoPrState } from './issue-declarations.mjs'

const moduleDir = dirname(fileURLToPath(import.meta.url))
const branchSafetyScriptPath = resolve(moduleDir, '../check-branch-safety.sh')
const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/i

export function getCurrentBranch(cwd = process.cwd()) {
  return run('git', ['branch', '--show-current'], { cwd }).stdout.trim() || '<detached>'
}

export function getStatusShort(cwd = process.cwd()) {
  return run('git', ['status', '--short'], { cwd }).stdout.trimEnd()
}

export function hasDevBranch(cwd = process.cwd()) {
  const local = run('git', ['rev-parse', '--verify', '--quiet', 'dev'], { cwd })
  if (local.status === 0) return true

  const remote = run('git', ['rev-parse', '--verify', '--quiet', 'origin/dev'], { cwd })
  return remote.status === 0
}

export function getOriginUrl(cwd = process.cwd()) {
  const result = run('git', ['remote', 'get-url', 'origin'], { cwd })
  if (result.status !== 0) return null

  const origin = result.stdout.trim()
  return origin || null
}

export function normalizeGithubRepoUrl(originUrl) {
  if (!originUrl) return null

  if (originUrl.startsWith('git@github.com:')) {
    return `https://github.com/${originUrl.slice('git@github.com:'.length).replace(/\.git$/, '')}`
  }

  if (originUrl.startsWith('https://github.com/')) {
    return originUrl.replace(/\.git$/, '')
  }

  return null
}

export function buildIssueUrl(cwd, issueNumber) {
  const repoUrl = normalizeGithubRepoUrl(getOriginUrl(cwd))
  if (!repoUrl) return null

  return `${repoUrl}/issues/${issueNumber}`
}

export function getDefaultRepo(cwd, env = process.env) {
  if (/^[^/\s]+\/[^/\s]+$/.test(env.GH_REPO ?? '')) return env.GH_REPO
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

export function runBranchSafety(cwd = process.cwd()) {
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

export function isReadOnlyPlanningBaseline({
  cwd = process.cwd(),
  branchName,
  state,
  env = process.env,
} = {}) {
  if (
    branchName !== 'main' ||
    state?.approved_base !== 'main' ||
    state?.guide_source_ref !== 'main' ||
    !isPreReviewPlanningNoPrState(state)
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
  const protectedBase = run('git', ['rev-parse', '--verify', 'main^{commit}'], { cwd, env }).stdout.trim().toLowerCase()
  const expected = planningSha.toLowerCase()
  return localHead === expected && protectedBase === expected
}

export function getCorrectionDiffFiles(cwd, reviewedHead, env = process.env) {
  const result = run('git', ['diff', '--name-only', reviewedHead, 'HEAD'], { cwd, env })
  if (result.status !== 0) {
    return { ok: false, errors: [result.stderr.trim() || result.stdout.trim() || 'git diff failed'] }
  }
  const files = result.stdout.split('\n').map((line) => line.trim()).filter(Boolean)
  return { ok: true, files }
}
