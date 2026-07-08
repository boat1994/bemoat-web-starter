#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleDir = dirname(fileURLToPath(import.meta.url))
const branchSafetyScriptPath = resolve(moduleDir, 'check-branch-safety.sh')
const docsToRead = ['AGENTS.md', 'docs/agent-loop/README.md', 'docs/agent-loop/issue-driven-branch-workflow.md']

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    encoding: 'utf8',
  })

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error ?? null,
  }
}

function parseIssueNumber(argv = process.argv.slice(2)) {
  const issueNumber = argv[0]?.trim()

  if (!issueNumber || !/^[1-9]\d*$/.test(issueNumber)) {
    return null
  }

  return issueNumber
}

function getCurrentBranch(cwd = process.cwd()) {
  return run('git', ['branch', '--show-current'], { cwd }).stdout.trim() || '<detached>'
}

function getStatusShort(cwd = process.cwd()) {
  return run('git', ['status', '--short'], { cwd }).stdout.trimEnd()
}

function hasDevBranch(cwd = process.cwd()) {
  const local = run('git', ['rev-parse', '--verify', '--quiet', 'dev'], { cwd })
  if (local.status === 0) return true

  const remote = run('git', ['rev-parse', '--verify', '--quiet', 'origin/dev'], { cwd })
  return remote.status === 0
}

function getOriginUrl(cwd = process.cwd()) {
  const result = run('git', ['remote', 'get-url', 'origin'], { cwd })
  if (result.status !== 0) return null

  const origin = result.stdout.trim()
  return origin || null
}

function normalizeGithubRepoUrl(originUrl) {
  if (!originUrl) return null

  if (originUrl.startsWith('git@github.com:')) {
    return `https://github.com/${originUrl.slice('git@github.com:'.length).replace(/\.git$/, '')}`
  }

  if (originUrl.startsWith('https://github.com/')) {
    return originUrl.replace(/\.git$/, '')
  }

  return null
}

function buildIssueUrl(cwd, issueNumber) {
  const repoUrl = normalizeGithubRepoUrl(getOriginUrl(cwd))
  if (!repoUrl) return null

  return `${repoUrl}/issues/${issueNumber}`
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
}

function buildSuggestedBranchName(issueNumber, issueTitle) {
  const slug = slugify(issueTitle).slice(0, 48).replace(/-+$/g, '')
  if (!slug) return null

  return `feature/${issueNumber}-${slug}`
}

function fetchIssueMetadata(cwd, issueNumber) {
  const result = run('gh', ['issue', 'view', issueNumber, '--json', 'title,url'], { cwd })
  if (result.error) {
    return {
      available: false,
      reason: `GitHub CLI is unavailable: ${result.error.message}`,
    }
  }

  if (result.status !== 0) {
    const failure = result.stderr.trim() || result.stdout.trim() || 'GitHub CLI request failed.'
    return {
      available: false,
      reason: failure,
    }
  }

  try {
    const parsed = JSON.parse(result.stdout)
    return {
      available: Boolean(parsed?.title && parsed?.url),
      title: parsed?.title ?? null,
      url: parsed?.url ?? null,
      reason: parsed?.title && parsed?.url ? null : 'GitHub CLI response was missing issue metadata.',
    }
  } catch (error) {
    return {
      available: false,
      reason: `GitHub CLI returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

function runBranchSafety(cwd = process.cwd()) {
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

function buildNextStep({
  branchSafetyOk,
  dirty,
  branchName,
  issueNumber,
  suggestedBranchName,
  devBranchAvailable,
}) {
  if (dirty) {
    return {
      label: 'Next manual step',
      value: 'Report the dirty working tree blocker and do not edit files.',
    }
  }

  if (!branchSafetyOk) {
    const branchNameToUse = suggestedBranchName ?? `feature/${issueNumber}-issue`

    if (branchName === 'main' && !devBranchAvailable) {
      return {
        label: 'Next recommended command',
        value: `git switch -c ${branchNameToUse}`,
      }
    }

    if (branchName === 'main') {
      return {
        label: 'Next recommended command',
        value: `git switch dev && git pull origin dev && git switch -c ${branchNameToUse}`,
      }
    }

    if (branchName === 'dev') {
      return {
        label: 'Next recommended command',
        value: `git switch -c ${branchNameToUse}`,
      }
    }

    return {
      label: 'Next recommended command',
      value: `git switch -c ${branchNameToUse}`,
    }
  }

  return {
    label: 'Next manual step',
    value:
      'Read the listed docs, implement only the scoped issue change on this branch, then run the required validation tier from AGENTS.md.',
  }
}

export function runAgentIssuePreflight({
  cwd = process.cwd(),
  argv = process.argv.slice(2),
} = {}) {
  const issueNumber = parseIssueNumber(argv)
  if (!issueNumber) {
    return {
      ok: false,
      exitCode: 1,
      usageError: true,
      output: [
        'Issue preflight failed: missing or invalid issue number.',
        'Usage: pnpm run bemoat:agent:issue -- <issue-number>',
      ],
    }
  }

  const branchName = getCurrentBranch(cwd)
  const statusShort = getStatusShort(cwd)
  const dirty = statusShort.trim().length > 0
  const issueMetadata = fetchIssueMetadata(cwd, issueNumber)
  const fallbackIssueUrl = buildIssueUrl(cwd, issueNumber)
  const suggestedBranchName =
    issueMetadata.available && issueMetadata.title
      ? buildSuggestedBranchName(issueNumber, issueMetadata.title)
      : null
  const branchSafety = runBranchSafety(cwd)
  const devBranchAvailable = hasDevBranch(cwd)
  const nextStep = buildNextStep({
    branchSafetyOk: branchSafety.ok,
    dirty,
    branchName,
    issueNumber,
    suggestedBranchName,
    devBranchAvailable,
  })

  const output = [
    'Bemoat agent issue preflight',
    `Issue number: ${issueNumber}`,
    '',
    `Current branch: ${branchName}`,
    'Git status --short:',
    statusShort || '<clean>',
    '',
    'Branch safety:',
    ...(branchSafety.lines.length > 0 ? branchSafety.lines : ['<no branch safety output>']),
    '',
  ]

  if (dirty) {
    output.push('Working tree: not clean.')
    output.push('This command cannot continue safely until the existing changes are resolved.')
    output.push('')
  } else {
    output.push('Working tree: clean.')
    output.push('')
  }

  output.push('GitHub issue:')
  if (issueMetadata.available) {
    output.push(`Title: ${issueMetadata.title}`)
    output.push(`URL: ${issueMetadata.url}`)
  } else {
    output.push(`Metadata unavailable: ${issueMetadata.reason}`)
    if (fallbackIssueUrl) {
      output.push(`Best-effort issue URL: ${fallbackIssueUrl}`)
    }
  }

  if (suggestedBranchName) {
    output.push(`Suggested branch: ${suggestedBranchName}`)
  }

  if (!devBranchAvailable) {
    output.push('Repo bootstrap note: `dev` is not available yet, so use the safest protected baseline and call out the exception in the PR.')
  }

  output.push('')
  output.push('Docs to read before implementation:')
  for (const docPath of docsToRead) {
    output.push(`- ${docPath}`)
  }

  output.push('')
  output.push('Validation guidance:')
  output.push('- Starter docs-only changes: pnpm run guard:safety')
  output.push('- Starter code or script changes: pnpm run check')
  output.push('- Child repos follow the bemoat:* validation tier in AGENTS.md')
  output.push('')
  output.push(`${nextStep.label}: ${nextStep.value}`)

  const ok = branchSafety.ok && !dirty

  return {
    ok,
    exitCode: ok ? 0 : 1,
    usageError: false,
    output,
    issueNumber,
    branchName,
    statusShort,
    issueMetadata,
    suggestedBranchName,
  }
}

function main() {
  const report = runAgentIssuePreflight()
  const stream = report.usageError ? process.stderr : process.stdout

  stream.write(`${report.output.join('\n')}\n`)
  process.exit(report.exitCode)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
