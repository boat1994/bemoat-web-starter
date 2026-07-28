import { parseAgentIssueArgs } from './cli-args.mjs'
import { docsToRead } from './constants.mjs'
import { runCorrectionPhasePreflight } from './correction-preflight.mjs'
import { fetchIssueMetadata } from './github-evidence.mjs'
import {
  buildIssueUrl,
  getCurrentBranch,
  getStatusShort,
  hasDevBranch,
  runBranchSafety,
} from './local-git-evidence.mjs'
import { analyzeProgressTracking } from './progress-tracking.mjs'
import { buildSuggestedBranchName } from './pure-helpers.mjs'
import { buildNextStep, formatProgressSection } from './presentation.mjs'

export function runAgentIssuePreflight({
  cwd = process.cwd(),
  argv = process.argv.slice(2),
  env = process.env,
} = {}) {
  const parsedArgs = parseAgentIssueArgs(argv)
  if (parsedArgs.error) {
    return {
      ok: false,
      exitCode: 1,
      usageError: true,
      output: [
        `Issue preflight failed: ${parsedArgs.error}.`,
        'Usage: pnpm run bemoat:agent:issue -- <issue-number> [--phase correction]',
      ],
    }
  }

  const { issueNumber, phase } = parsedArgs

  const branchName = getCurrentBranch(cwd)
  const statusShort = getStatusShort(cwd)
  const dirty = statusShort.trim().length > 0
  const issueMetadata = fetchIssueMetadata(cwd, issueNumber, env)
  const fallbackIssueUrl = buildIssueUrl(cwd, issueNumber)
  const suggestedBranchName =
    issueMetadata.available && issueMetadata.title
      ? buildSuggestedBranchName(issueNumber, issueMetadata.title)
      : null
  const branchSafety = runBranchSafety(cwd)
  const devBranchAvailable = hasDevBranch(cwd)

  if (phase === 'correction') {
    return runCorrectionPhasePreflight({
      cwd,
      env,
      issueNumber,
      branchName,
      statusShort,
      dirty,
      branchSafety,
      issueMetadata,
      fallbackIssueUrl,
    })
  }

  const progressAnalysis =
    issueMetadata.available && issueMetadata.body
      ? analyzeProgressTracking({
          cwd,
          activeIssueBody: issueMetadata.body,
          activeIssueNumber: issueNumber,
          activeIssueState: issueMetadata.state,
          env,
        })
      : {
          blockers: [],
          warnings: [],
          report: {
            declarations: {},
            durableProgress: { hasChecklist: false, milestones: [], firstIncomplete: null },
          },
        }

  const nextStep = buildNextStep({
    branchSafetyOk: branchSafety.ok,
    dirty,
    branchName,
    issueNumber,
    suggestedBranchName,
    devBranchAvailable,
    progressBlockers: progressAnalysis.blockers,
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
    output.push(`Suggested branch default: ${suggestedBranchName}`)
    output.push('Adjust the prefix if this is docs, fix, chore, test, or refactor work.')
  }

  if (!devBranchAvailable) {
    output.push(
      'Repo bootstrap note: `dev` is not available yet, so use the safest protected baseline and call out the exception in the PR.',
    )
  }

  output.push('')
  output.push(...formatProgressSection(progressAnalysis))
  output.push('')
  output.push('Docs to read before implementation:')
  for (const docPath of docsToRead) {
    output.push(`- ${docPath}`)
  }

  output.push('')
  output.push('Validation guidance:')
  output.push('- Follow the validation tier in AGENTS.md.')
  output.push('- Starter code/script changes usually require pnpm run check.')
  output.push('- Child repos must use the bemoat:* tier documented in AGENTS.md.')
  output.push('')
  output.push(`${nextStep.label}: ${nextStep.value}`)

  const hasProgressBlockers = progressAnalysis.blockers.length > 0
  const ok = branchSafety.ok && !dirty && !hasProgressBlockers

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
    progressAnalysis,
  }
}
