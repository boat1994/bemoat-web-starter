#!/usr/bin/env node
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { analyzeExactHeadCi } from './agent-issue.mjs'
import { parseMissionControlState, renderMissionControlState as renderStateBlock } from './mission-control-state.mjs'
import { proposeDeliveryReconciliation, parseRoleCommentBody, Coordinator } from './mission-control-reconcile.mjs'

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options })
  if (result.error || result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}\n${result.stderr || result.stdout || result.error?.message}`)
  }
  return result.stdout.trim()
}

function tryRun(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', ...options })
}

function usage(message) {
  if (message) process.stderr.write(`ERROR: ${message}\n`)
  process.stderr.write('Usage: pnpm run bemoat:agent:delivery -- <issue-number> [--repo owner/repo] [--body-file path]\n')
  process.exitCode = 1
}

function parseArgs(argv) {
  const options = { issue: null, repo: null, bodyFile: null }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--') continue
    if (argument === '--repo' || argument === '--body-file') {
      const value = argv[++index]
      if (!value) return { error: `${argument} requires a value` }
      if (argument === '--repo') options.repo = value
      else options.bodyFile = value
      continue
    }
    if (argument.startsWith('-') || options.issue) return { error: `unexpected argument: ${argument}` }
    options.issue = argument
  }
  if (!options.issue || !/^[1-9]\d*$/.test(options.issue)) return { error: 'a positive Issue number is required' }
  return { options }
}

function readBody(bodyFile) {
  const stdinIsPipe = !process.stdin.isTTY
  const stdin = stdinIsPipe ? readFileSync(0, 'utf8') : ''
  if (bodyFile && stdin.length > 0) throw new Error('--body-file and stdin are mutually exclusive')
  if (bodyFile) return readFileSync(bodyFile, 'utf8')
  if (!stdin) throw new Error('provide a comment body through --body-file or stdin')
  return stdin
}

function main() {
  mainAsync().catch((error) => {
    process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}

async function mainAsync() {
  const parsed = parseArgs(process.argv.slice(2))
  if (parsed.error) return usage(parsed.error)

  let body
  try {
    body = readBody(parsed.options.bodyFile)
  } catch (error) {
    return usage(error instanceof Error ? error.message : String(error))
  }

  const parsedBody = parseRoleCommentBody(body)
  if (parsedBody.role !== 'RESULT') {
    return usage('Delivery requires a RESULT comment body')
  }

  const resultPr = parsedBody.prNumber
  if (!resultPr) {
    process.stderr.write('ERROR: STATE_CONFLICT: RESULT PR identifier missing\n')
    process.exitCode = 1
    return
  }

  // 1. resolve expected delivered commit
  let localCommit
  try {
    localCommit = run('git', ['rev-parse', 'HEAD'])
  } catch (ignore) {
    process.stderr.write(`ERROR: STATE_CONFLICT: Could not resolve local commit\n`)
    process.exitCode = 1
    return
  }

  // 2. verifies the remote branch ref equals that commit
  const currentBranch = run('git', ['branch', '--show-current'])
  const lsRemote = tryRun('git', ['ls-remote', 'origin', currentBranch])
  if (lsRemote.status !== 0 || !lsRemote.stdout.includes(localCommit)) {
    process.stderr.write(`ERROR: STATE_CONFLICT: Remote branch ref does not equal local commit ${localCommit}\n`)
    process.exitCode = 1
    return
  }

  // 3. & 4. verifies the live Pulls API head equals the same commit, and expected transport target
  const ghArgs = ['pr', 'view', resultPr, '--json', 'headRefOid,statusCheckRollup,headRepository,headRefName,baseRefName']
  if (parsed.options.repo) ghArgs.push('--repo', parsed.options.repo)
  const prResult = tryRun('gh', ghArgs)
  if (prResult.status !== 0) {
    process.stderr.write(`ERROR: BLOCKED_EXTERNAL: GitHub PR lookup failed\n`)
    process.exitCode = 1
    return
  }

  let prData
  try {
    prData = JSON.parse(prResult.stdout)
  } catch (ignore) {
    process.stderr.write('ERROR: BLOCKED_EXTERNAL: Invalid PR JSON\n')
    process.exitCode = 1
    return
  }

  if (prData.headRefOid !== localCommit) {
    process.stderr.write(`ERROR: STATE_CONFLICT: PR head ${prData.headRefOid} does not match local commit ${localCommit}\n`)
    process.exitCode = 1
    return
  }

  if (prData.headRefName !== currentBranch) {
    process.stderr.write(`ERROR: STATE_CONFLICT: PR headRefName ${prData.headRefName} does not match local branch ${currentBranch}\n`)
    process.exitCode = 1
    return
  }

  let expectedRepo = parsed.options.repo
  if (!expectedRepo) {
    const repoResult = tryRun('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'])
    if (repoResult.status === 0) expectedRepo = repoResult.stdout.trim()
  }
  if (!expectedRepo) {
    process.stderr.write('ERROR: BLOCKED_EXTERNAL: Canonical PR repository is unavailable\n')
    process.exitCode = 1
    return
  }
  if (prData.headRepository?.nameWithOwner && expectedRepo && prData.headRepository.nameWithOwner !== expectedRepo) {
    process.stderr.write(`ERROR: STATE_CONFLICT: PR head repository ${prData.headRepository.nameWithOwner} does not match expected repository ${expectedRepo}\n`)
    process.exitCode = 1
    return
  }

  // 5. requires all configured exact-head workflows on that commit
  const ciAnalysis = analyzeExactHeadCi(prData)
  if (!ciAnalysis.exactHeadVerified) {
    process.stderr.write(`ERROR: STATE_CONFLICT: Exact-head CI not verified: ${ciAnalysis.summary}\n`)
    process.exitCode = 1
    return
  }

  // 6. updates the canonical Issue state only after all evidence agrees
  const issueArgs = ['issue', 'view', parsed.options.issue, '--json', 'body']
  if (parsed.options.repo) issueArgs.push('--repo', parsed.options.repo)
  const issueResult = tryRun('gh', issueArgs)
  if (issueResult.status !== 0) {
    process.stderr.write(`ERROR: BLOCKED_EXTERNAL: GitHub issue lookup failed\n`)
    process.exitCode = 1
    return
  }
  const issueData = JSON.parse(issueResult.stdout)
  const currentState = parseMissionControlState(issueData.body)
  
  if (currentState.present && !currentState.valid) {
    process.stderr.write(`ERROR: STATE_CONFLICT: Issue has invalid Mission Control state: ${currentState.reason}\n`)
    process.exitCode = 1
    return
  }

  const deliveryTimestamp = new Date().toISOString()
  const newStateProposal = proposeDeliveryReconciliation({
    managedState: currentState.state,
    livePr: { number: resultPr, headRefOid: localCommit, baseRefName: prData.baseRefName || 'main' },
    activeTaskIssue: parsed.options.issue,
    approvedBase: currentState.state?.approved_base ?? prData.baseRefName ?? 'main',
    latestResult: { parsed: parsedBody },
    updatedAt: deliveryTimestamp,
    updatedBy: 'Mission Control',
  })

  let stateObj = currentState.state || {}
  stateObj = { ...stateObj, ...newStateProposal }
  if (!stateObj.schema_version) stateObj.schema_version = 1
  if (!stateObj.guide_version) stateObj.guide_version = '1.0.0'
  if (!stateObj.guide_source_ref) stateObj.guide_source_ref = 'main'
  if (!stateObj.material_change_status) stateObj.material_change_status = 'none'

  const comments = []
  let expectedBody = issueData.body
  const coordinator = new Coordinator({
    readState: async () => {
      const issueResult = tryRun('gh', issueArgs)
      if (issueResult.status !== 0) throw new Error('BLOCKED_EXTERNAL: GitHub issue lookup failed')
      const live = JSON.parse(issueResult.stdout)
      const parsedState = parseMissionControlState(live.body)
      if (parsedState.present && !parsedState.valid) {
        throw new Error(`STATE_CONFLICT: Issue has invalid Mission Control state: ${parsedState.reason}`)
      }
      return parsedState.state ?? {}
    },
    writeState: async (nextState) => {
      const newStateBlock = renderStateBlock(nextState)
      let newBody = expectedBody
      if (currentState.present) {
        newBody = newBody.replace(/<!--\s*bemoat-mission-control-state:start\s*-->[\s\S]*?<!--\s*bemoat-mission-control-state:end\s*-->/, newStateBlock)
      } else {
        newBody = `${newBody}\n\n${newStateBlock}\n`
      }
      const tmpDir = mkdtempSync(join(tmpdir(), 'bemoat-delivery-'))
      const tmpBody = join(tmpDir, 'body.md')
      writeFileSync(tmpBody, newBody)
      const editArgs = ['issue', 'edit', parsed.options.issue, '--body-file', tmpBody]
      if (parsed.options.repo) editArgs.push('--repo', parsed.options.repo)
      const editResult = tryRun('gh', editArgs)
      rmSync(tmpDir, { recursive: true, force: true })
      if (editResult.status !== 0) {
        throw new Error('STATE_CONFLICT: Failed to write durable state to Issue')
      }
      expectedBody = newBody
      return nextState
    },
    listComments: async () => comments,
    postComment: async (commentBody) => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'bemoat-delivery-'))
      const tmpComment = join(tmpDir, 'comment.md')
      writeFileSync(tmpComment, commentBody)
      const postCommentArgs = ['scripts/post-role-comment.mjs', parsed.options.issue, '--body-file', tmpComment]
      if (parsed.options.repo) postCommentArgs.push('--repo', parsed.options.repo)
      const postCommentResult = tryRun('node', postCommentArgs)
      rmSync(tmpDir, { recursive: true, force: true })
      if (postCommentResult.status !== 0) {
        throw new Error(`STATE_CONFLICT: Failed to post RESULT comment\n${postCommentResult.stderr || postCommentResult.stdout || ''}`)
      }
      const posted = { id: `local-${comments.length + 1}`, body: commentBody }
      comments.push(posted)
      return posted
    },
  })

  const result = await coordinator.integrateResult({
    resultBody: body,
    projectState: () => stateObj,
    verifyPreconditions: async () => undefined,
    updatedAt: deliveryTimestamp,
    updatedBy: 'Mission Control',
  })

  if (result.outcome === 'RECOVERABLE_ROUTING_DRIFT') {
    process.stderr.write(`ERROR: RECOVERABLE_ROUTING_DRIFT: comment posted but state update failed: ${result.error}\n`)
    process.exitCode = 1
    return
  }

  process.stdout.write('Delivery reconciliation successful. RESULT posted and state updated.\n')
}

main()
