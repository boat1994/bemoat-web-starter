import { spawnSync } from 'node:child_process'

import { makeViolation, parseIssueNumber } from './planning-contract.ts'
import type { PlanningContract, PlanningViolation } from './planning-contract.ts'

export interface GitHubResult {
  status: number
  stdout: string
  stderr: string
}

export interface GitHubCommandOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
}

export type RunGitHub = (args: string[], options: GitHubCommandOptions) => GitHubResult

interface GitHubIssue {
  title?: string
  state?: string
  body?: string
  url?: string
}

export interface TaskVerificationResult {
  ok: boolean
  degradedOffline: boolean
  violations: PlanningViolation[]
  issueMetadata?: {
    number: string
    state?: string
    title?: string
    body?: string
  }
}

export interface VerifyLiveTaskIdentityOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  runGh?: RunGitHub
  filePath: string
  contract: PlanningContract
  offline?: boolean
  validateLegacyManagedState?: (
    issue: { body?: string },
    contract: PlanningContract,
    issueNumber: string,
    filePath: string,
  ) => PlanningViolation[]
}

function getOriginUrl(cwd: string): string | null {
  const result = runGitHub(['remote', 'get-url', 'origin'], cwd)
  if (result.status !== 0) return null
  const origin = result.stdout.trim()
  return origin || null
}

function getDefaultRepo(cwd: string): string | null {
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

function parseRepoFromIssueUrl(url: unknown): string | null {
  if (!url || typeof url !== 'string') return null
  const match = url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/\d+/)
  return match ? match[1] : null
}

export function defaultRunGh(args: string[], options: GitHubCommandOptions = {}): GitHubResult {
  const result = spawnSync('gh', args, {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    encoding: 'utf8',
  })
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function runGitHub(args: string[], cwd: string): GitHubResult {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function isGhAvailable(runGh: RunGitHub, cwd: string, env: NodeJS.ProcessEnv): boolean {
  const version = runGh(['--version'], { cwd, env })
  if (version.status !== 0) return false
  const auth = runGh(['auth', 'status'], { cwd, env })
  return auth.status === 0
}

function issueIdentifiesTaskKey(issue: GitHubIssue, taskKey: unknown): boolean {
  const haystack = `${issue.title ?? ''}\n${issue.body ?? ''}`.toLowerCase()
  return haystack.includes(String(taskKey).toLowerCase())
}

export function verifyLiveTaskIdentity(options: VerifyLiveTaskIdentityOptions): TaskVerificationResult {
  const cwd = options.cwd ?? process.cwd()
  const env = options.env ?? process.env
  const runGh = options.runGh ?? defaultRunGh
  const filePath = options.filePath
  const contract = options.contract
  if (options.offline || !isGhAvailable(runGh, cwd, env)) {
    return {
      ok: true,
      degradedOffline: true,
      violations: [],
    }
  }
  if (contract.task_issue_strategy === 'create_before_execution') {
    return {
      ok: true,
      degradedOffline: false,
      violations: [],
    }
  }
  if (contract.task_issue_strategy !== 'existing_dedicated_issue') {
    return {
      ok: true,
      degradedOffline: false,
      violations: [],
    }
  }
  const issueNumber = parseIssueNumber(contract.active_task_issue)
  if (!issueNumber) {
    return {
      ok: true,
      degradedOffline: false,
      violations: [],
    }
  }
  const defaultRepo = getDefaultRepo(cwd)
  const args = ['issue', 'view', issueNumber, '--json', 'title,state,body,url']
  if (defaultRepo) {
    args.push('--repo', defaultRepo)
  }
  const ghResult = runGh(args, { cwd, env })
  if (ghResult.status !== 0) {
    return {
      ok: false,
      degradedOffline: false,
      violations: [makeViolation({
        rule: 'PLAN008',
        file: filePath,
        message: 'Active task issue could not be verified in the target repository',
        found: ghResult.stderr.trim() || ghResult.stdout.trim() || 'GitHub issue lookup failed',
        reason: `Active task issue #${issueNumber} could not be verified in the target repository`,
        correctiveAction: `Verify issue #${issueNumber} exists in the current repository`,
      })],
    }
  }
  let issue: GitHubIssue
  try {
    issue = JSON.parse(ghResult.stdout) as GitHubIssue
  } catch (error) {
    return {
      ok: false,
      degradedOffline: false,
      violations: [makeViolation({
        rule: 'PLAN008',
        file: filePath,
        message: 'Active task issue metadata could not be parsed',
        found: error instanceof Error ? error.message : String(error),
        reason: `Active task issue #${issueNumber} returned invalid GitHub metadata`,
        correctiveAction: `Re-fetch issue #${issueNumber} with gh issue view`,
      })],
    }
  }
  const issueRepo = parseRepoFromIssueUrl(issue.url)
  if (defaultRepo && issueRepo && issueRepo !== defaultRepo) {
    return {
      ok: false,
      degradedOffline: false,
      violations: [makeViolation({
        rule: 'PLAN008',
        file: filePath,
        message: 'Active task issue belongs to a different repository',
        found: issue.url ?? 'missing issue URL',
        reason: `Active task issue #${issueNumber} is not in repository ${defaultRepo}`,
        correctiveAction: `Point active_task_issue to an issue in ${defaultRepo}`,
      })],
    }
  }
  if (issue.state !== 'OPEN') {
    return {
      ok: false,
      degradedOffline: false,
      violations: [makeViolation({
        rule: 'PLAN008',
        file: filePath,
        message: 'Active task issue is closed or terminal',
        found: `state '${issue.state}'`,
        reason: `Active task issue #${issueNumber} is closed/terminal`,
        correctiveAction: `Reopen issue #${issueNumber} or create a new dedicated open task issue`,
      })],
    }
  }
  if (!issueIdentifiesTaskKey(issue, contract.task_key)) {
    return {
      ok: false,
      degradedOffline: false,
      violations: [makeViolation({
        rule: 'PLAN009',
        file: filePath,
        message: 'Active task issue does not identify the declared task_key',
        found: 'task key mismatch',
        reason: `Issue #${issueNumber} title/body does not identify ${contract.task_key}`,
        correctiveAction: `Update active_task_issue to point to the issue for ${contract.task_key}`,
      })],
    }
  }
  const legacyManagedStateViolations = options.validateLegacyManagedState?.(issue, contract, issueNumber, filePath) ?? []
  if (legacyManagedStateViolations.length > 0) {
    return {
      ok: false,
      degradedOffline: false,
      violations: legacyManagedStateViolations,
    }
  }
  return {
    ok: true,
    degradedOffline: false,
    violations: [],
    issueMetadata: {
      number: issueNumber,
      state: issue.state,
      title: issue.title,
      body: issue.body,
    },
  }
}
