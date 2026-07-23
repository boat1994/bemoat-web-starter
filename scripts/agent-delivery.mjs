#!/usr/bin/env node
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { analyzeExactHeadCi } from './agent-issue.mjs'
import { parseMissionControlState } from './mission-control-state.mjs'
import { proposeDeliveryReconciliation, parseRoleCommentBody } from './mission-control-reconcile.mjs'

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

function renderStateBlock(stateObj) {
  const lines = [
    '<!-- bemoat-mission-control-state:start -->',
    '```yaml'
  ]
  
  const orderedKeys = [
    'schema_version', 'state', 'review_cycle', 'full_review_count', 'approved_base',
    'active_task_issue', 'active_pr', 'current_head', 'last_reviewed_head',
    'guide_version', 'guide_source_ref', 'guide_source_sha', 'open_blockers',
    'follow_up_issues', 'next_permitted_action', 'material_change_status', 'updated_at',
    'updated_by'
  ]
  const keys = new Set([...orderedKeys, ...Object.keys(stateObj)])
  
  for (const key of keys) {
    if (!Object.hasOwn(stateObj, key)) continue
    const value = stateObj[key]
    
    if (value === null) {
      lines.push(`${key}: null`)
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`)
      } else {
        lines.push(`${key}:`)
        for (const item of value) {
          lines.push(`  - ${typeof item === 'string' && (item === '' || item.includes(' ') || item.includes('"') || item.includes("'") || item === 'null' || !Number.isNaN(Number(item))) ? JSON.stringify(item) : item}`)
        }
      }
    } else if (typeof value === 'string') {
      const needsQuotes = value === '' || value === 'null' || value === '[]' || !Number.isNaN(Number(value)) || /[\s"']/.test(value)
      lines.push(`${key}: ${needsQuotes ? JSON.stringify(value) : value}`)
    } else {
      lines.push(`${key}: ${value}`)
    }
  }
  
  lines.push('```')
  lines.push('<!-- bemoat-mission-control-state:end -->')
  return lines.join('\n')
}

function main() {
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
  const ghArgs = ['pr', 'view', resultPr, '--json', 'headRefOid,statusCheckRollup,headRepository,baseRepository,headRefName,baseRefName']
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

  const expectedRepo = parsed.options.repo || prData.baseRepository?.nameWithOwner
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

  // We write the new state
  const newStateProposal = proposeDeliveryReconciliation({
    livePr: { number: resultPr, headRefOid: localCommit, baseRefName: prData.baseRefName || 'main' },
    activeTaskIssue: parsed.options.issue,
    approvedBase: currentState.state?.approved_base ?? prData.baseRefName ?? 'main',
    latestResult: { parsed: parsedBody }
  })

  let stateObj = currentState.state || {}
  stateObj = { ...stateObj, ...newStateProposal }
  if (!stateObj.schema_version) stateObj.schema_version = 1
  if (!stateObj.guide_version) stateObj.guide_version = '1.0.0'
  if (!stateObj.guide_source_ref) stateObj.guide_source_ref = 'main'
  if (!stateObj.material_change_status) stateObj.material_change_status = 'none'

  const newStateBlock = renderStateBlock(stateObj)

  let newBody = issueData.body
  if (currentState.present) {
    newBody = newBody.replace(/<!--\s*bemoat-mission-control-state:start\s*-->[\s\S]*?<!--\s*bemoat-mission-control-state:end\s*-->/, newStateBlock)
  } else {
    newBody = newBody + '\n\n' + newStateBlock + '\n'
  }

  const tmpDir = mkdtempSync(join(tmpdir(), 'bemoat-delivery-'))
  const tmpBody = join(tmpDir, 'body.md')
  writeFileSync(tmpBody, newBody)

  const editArgs = ['issue', 'edit', parsed.options.issue, '--body-file', tmpBody]
  if (parsed.options.repo) editArgs.push('--repo', parsed.options.repo)
  const editResult = tryRun('gh', editArgs)
  if (editResult.status !== 0) {
    rmSync(tmpDir, { recursive: true, force: true })
    process.stderr.write(`ERROR: STATE_CONFLICT: Failed to write durable state to Issue\n`)
    process.exitCode = 1
    return
  }

  // 7. posts ## RESULT only after the durable state write succeeds
  const tmpComment = join(tmpDir, 'comment.md')
  writeFileSync(tmpComment, body)
  
  const postCommentArgs = ['scripts/post-role-comment.mjs', parsed.options.issue, '--body-file', tmpComment]
  if (parsed.options.repo) postCommentArgs.push('--repo', parsed.options.repo)
  const postCommentResult = tryRun('node', postCommentArgs)

  if (postCommentResult.status !== 0) {
    const errorMsg = postCommentResult.stderr || postCommentResult.stdout || ''
    
    // Re-fetch the live Issue body to check for concurrent edits
    const refetchArgs = ['issue', 'view', parsed.options.issue, '--json', 'body']
    if (parsed.options.repo) refetchArgs.push('--repo', parsed.options.repo)
    const refetchResult = tryRun('gh', refetchArgs)
    
    if (refetchResult.status !== 0) {
      rmSync(tmpDir, { recursive: true, force: true })
      process.stderr.write(`ERROR: STATE_CONFLICT: Failed to post RESULT comment and failed to re-fetch issue for rollback\n${errorMsg}`)
      process.exitCode = 1
      return
    }
    
    const liveBody = JSON.parse(refetchResult.stdout).body
    if (liveBody !== newBody) {
      rmSync(tmpDir, { recursive: true, force: true })
      process.stderr.write(`ERROR: STATE_CONFLICT: concurrent-change evidence found, rollback aborted\n`)
      process.exitCode = 1
      return
    }

    writeFileSync(tmpBody, issueData.body)
    const rollbackArgs = ['issue', 'edit', parsed.options.issue, '--body-file', tmpBody]
    if (parsed.options.repo) rollbackArgs.push('--repo', parsed.options.repo)
    const rollbackResult = tryRun('gh', rollbackArgs)
    
    rmSync(tmpDir, { recursive: true, force: true })
    if (rollbackResult.status !== 0) {
      process.stderr.write(`ERROR: STATE_CONFLICT: Rollback write failure: ${rollbackResult.stderr || rollbackResult.stdout}\n`)
    } else {
      process.stderr.write(`ERROR: STATE_CONFLICT: Failed to post RESULT comment, rollback successful with no concurrent edit\n${errorMsg}`)
    }
    process.exitCode = 1
    return
  }
  rmSync(tmpDir, { recursive: true, force: true })

  process.stdout.write(`Delivery reconciliation successful. State updated and RESULT posted.\n`)
}

main()
