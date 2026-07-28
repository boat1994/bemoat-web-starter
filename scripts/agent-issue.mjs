#!/usr/bin/env node
/**
 * Thin CLI/orchestration entrypoint for agent-issue preflight.
 * Implementation lives in scripts/agent-issue/* by security and evidence boundary.
 */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseCompleteGitHubPullUrl } from './pr-identity.mjs'
import { parseMissionControlState } from './mission-control-state.mjs'
import {
  analyzeExactHeadCi,
  isCheckFailed,
  isCheckSuccessful,
  normalizeStatusChecks,
} from './agent-issue/exact-head-ci.mjs'
import {
  deriveWorkflowProfile,
  parseDurableProgress,
  parseIssueDeclarations,
  validatePlanPath,
} from './agent-issue/issue-declarations.mjs'
import { runAgentIssuePreflight } from './agent-issue/issue-preflight.mjs'
import { parseIssueReference, parsePrReference } from './agent-issue/issue-references.mjs'
import { analyzeProgressTracking } from './agent-issue/progress-tracking.mjs'

export {
  parseMissionControlState,
  parseCompleteGitHubPullUrl,
  deriveWorkflowProfile,
  parseIssueDeclarations,
  parseDurableProgress,
  parseIssueReference,
  parsePrReference,
  validatePlanPath,
  normalizeStatusChecks,
  isCheckSuccessful,
  isCheckFailed,
  analyzeExactHeadCi,
  analyzeProgressTracking,
  runAgentIssuePreflight,
}

function main() {
  const report = runAgentIssuePreflight()
  const stream = report.usageError ? process.stderr : process.stdout

  stream.write(`${report.output.join('\n')}\n`)
  process.exit(report.exitCode)
}

if (
  process.argv[1] &&
  (resolve(process.argv[1]) === fileURLToPath(import.meta.url) ||
    process.argv[1].endsWith('/agent-issue.mjs'))
) {
  main()
}
