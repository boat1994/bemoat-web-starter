#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { dispatchManagedTask } from './mission-control-reconcile.mjs'
import { parseMissionControlState, renderMissionControlState } from './mission-control-state.mjs'

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.error || result.status !== 0) {
    throw new Error(result.stderr || result.stdout || result.error?.message || `${command} failed`)
  }
  return result.stdout.trim()
}

function parseArgs(argv) {
  const options = { issue: null, repo: null, bodyFile: null }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--') continue
    if (argument === '--repo' || argument === '--body-file') {
      const value = argv[++index]
      if (!value) throw new Error(`${argument} requires a value`)
      options[argument === '--repo' ? 'repo' : 'bodyFile'] = value
      continue
    }
    if (argument.startsWith('-') || options.issue) throw new Error(`unexpected argument: ${argument}`)
    options.issue = argument
  }
  if (!options.issue || !/^[1-9]\d*$/.test(options.issue)) {
    throw new Error('a positive Issue number is required')
  }
  return options
}

function issueArgs(options, fields) {
  const args = ['issue', 'view', options.issue, '--json', fields]
  if (options.repo) args.push('--repo', options.repo)
  return args
}

function replaceStateBlock(body, state) {
  const rendered = renderMissionControlState(state)
  const pattern = /<!--\s*bemoat-mission-control-state:start\s*-->[\s\S]*?<!--\s*bemoat-mission-control-state:end\s*-->/
  if (!pattern.test(body)) throw new Error('managed state block is missing')
  return body.replace(pattern, rendered)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const handoffBody = options.bodyFile
    ? readFileSync(options.bodyFile, 'utf8')
    : (!process.stdin.isTTY ? readFileSync(0, 'utf8') : '')
  if (!handoffBody) throw new Error('provide HANDOFF through --body-file or stdin')

  let expectedBody = null
  const readIssue = () => {
    const issue = JSON.parse(run('gh', issueArgs(options, 'body,state')))
    const parsed = parseMissionControlState(issue.body)
    if (!parsed.present || !parsed.valid) {
      throw new Error(`invalid managed state: ${parsed.reason ?? 'missing state block'}`)
    }
    expectedBody = issue.body
    return parsed.state
  }
  const writeState = async (state) => {
    const live = JSON.parse(run('gh', issueArgs(options, 'body')))
    if (expectedBody !== null && live.body !== expectedBody) {
      throw new Error('concurrent Issue write detected')
    }
    const nextBody = replaceStateBlock(live.body, state)
    const temp = mkdtempSync(join(tmpdir(), 'bemoat-dispatch-'))
    const bodyFile = join(temp, 'issue.md')
    try {
      writeFileSync(bodyFile, nextBody)
      const args = ['issue', 'edit', options.issue, '--body-file', bodyFile]
      if (options.repo) args.push('--repo', options.repo)
      run('gh', args)
      expectedBody = nextBody
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  }
  const postHandoff = async (body) => {
    const temp = mkdtempSync(join(tmpdir(), 'bemoat-dispatch-comment-'))
    const bodyFile = join(temp, 'handoff.md')
    try {
      writeFileSync(bodyFile, body)
      const args = ['scripts/post-role-comment.mjs', options.issue, '--body-file', bodyFile]
      if (options.repo) args.push('--repo', options.repo)
      run(process.execPath, args)
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  }

  const timestamp = new Date().toISOString()
  const result = await dispatchManagedTask({
    readState: async () => readIssue(),
    writeState,
    postHandoff,
    handoffBody,
    transitionState: (state) => ({
      ...structuredClone(state),
      state: 'IN_PROGRESS',
      updated_at: timestamp,
      updated_by: 'Mission Control',
    }),
  })
  process.stdout.write(`Mission Control dispatch ${result.outcome}: READY -> IN_PROGRESS + HANDOFF\n`)
}

main().catch((error) => {
  process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
