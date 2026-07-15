#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const ROLE_HEADINGS = ['HANDOFF', 'RESULT', 'REVIEW_VERDICT']
const CORE_VERDICTS = [
  'CORRECTION REQUIRED',
  'ELIGIBLE FOR FOUNDER REVIEW',
  'BLOCKED FOR FOUNDER DECISION',
  'BLOCKED EXTERNAL',
  'STATE CONFLICT',
]
const TASK_LOG_FIELDS = ['### Task log', 'Timestamp:', 'Task / Issue:', 'Phase:', 'Executing role:']
const REQUIRED_FIELD_SHAPES = {
  HANDOFF: [[...TASK_LOG_FIELDS, '**Target:**', '**Objective:**', '**Links:**', '**Next:**']],
  RESULT: [
    [...TASK_LOG_FIELDS, '**Completed:**', '**Summary:**', '**Next:**'],
    [...TASK_LOG_FIELDS, '**Role / phase completed:**', '### Summary', '### Files or artifacts changed', '### Commands run', '### Next handoff'],
  ],
  REVIEW_VERDICT: [
    [...TASK_LOG_FIELDS, '**PR / base / head:**', '**Verdict:**', '**Findings:**', '**Gates:**', '**Next:**'],
    [...TASK_LOG_FIELDS, '**Reviewed PR:**', '**Approved base:**', '**Exact head reviewed:**', '**Verdict:**', '### Critical / Important findings summary', '### Gate status', '### Next handoff'],
  ],
}
const MAX_COMPACT_LENGTH = 6_000

function usage(message) {
  if (message) process.stderr.write(`ERROR: ${message}\n`)
  process.stderr.write('Usage: pnpm run bemoat:issue:comment -- <issue-number> [--repo owner/repo] [--body-file path] [--check] [--allow-warning]\n')
  process.exitCode = 1
}

function parseArgs(argv) {
  const options = { issue: null, repo: null, bodyFile: null, check: false, allowWarning: false }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--') continue
    if (argument === '--repo' || argument === '--body-file') {
      const value = argv[++index]
      if (!value) return { error: `${argument} requires a value` }
      if (argument === '--repo') {
        if (options.repo) return { error: '--repo may be provided only once' }
        options.repo = value
      } else {
        if (options.bodyFile) return { error: '--body-file may be provided only once' }
        options.bodyFile = value
      }
      continue
    }
    if (argument === '--check') { options.check = true; continue }
    if (argument === '--allow-warning') { options.allowWarning = true; continue }
    if (argument.startsWith('-') || options.issue) return { error: `unexpected argument: ${argument}` }
    options.issue = argument
  }
  if (!options.issue || !/^[1-9]\d*$/.test(options.issue)) return { error: 'a positive Issue number is required' }
  if (options.repo && !/^[\w.-]+\/[\w.-]+$/.test(options.repo)) return { error: '--repo must be owner/repo' }
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

function validationErrors(body) {
  const errors = []
  if (/\\n/.test(body)) errors.push('literal \\n sequences are not allowed')
  if (/\$\([^)]*\)/.test(body)) errors.push('unresolved $(...) shell substitutions are not allowed')
  if (/^\s*(?:\$ |(?:PASS|FAIL|RUN)\s)/m.test(body)) errors.push('command transcripts are not allowed')
  if (/^>\s*(?:[$#]\s*|(?:pnpm|npm|yarn|git|gh|node|npx)\b)/im.test(body)) errors.push('quoted command transcripts are not allowed')
  if (/^\s*Command:\s*\S+/im.test(body)) errors.push('command-labelled transcripts are not allowed')
  if (/^ {4,}(?:(?:PASS|FAIL|RUN)\b|(?:Error|Warning):)/m.test(body)) errors.push('indented command transcripts are not allowed')

  const headings = [...body.matchAll(/^##\s+([^\n#]+)\s*$/gm)].map((match) => match[1].trim())
  const recognized = headings.filter((heading) => ROLE_HEADINGS.includes(heading))
  if (headings.length !== 1 || recognized.length !== 1) {
    errors.push('body must contain exactly one recognized role heading and no other ## headings')
    return { errors, role: null }
  }

  const role = recognized[0]
  const matchedShape = REQUIRED_FIELD_SHAPES[role].find((shape) => shape.every((field) => hasNonEmptyField(body, field)))
  if (!matchedShape) {
    errors.push(`${role} is missing required operational fields or values`)
  }
  if (role === 'REVIEW_VERDICT') {
    const verdict = body.match(/^\*\*Verdict:\*\*\s*(.+?)\s*$/m)?.[1]?.trim()
    if (!CORE_VERDICTS.includes(verdict)) errors.push('Verdict must use the Core review verdict enum')
  }
  return { errors, role }
}

function hasNonEmptyField(body, field) {
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (field.startsWith('###')) {
    return new RegExp(`^${escapedField}[ \\t]*\\r?\\n(?![ \\t]*(?:#|<!--))[ \\t]*(?:[-*][ \\t]+)?\\S`, 'mi').test(body)
  }
  return new RegExp(`^[ \\t]*(?:[-*][ \\t]+)?${escapedField}[ \\t]*\\S`, 'mi').test(body)
}

function createBodyFile(body) {
  const directory = mkdtempSync(join(tmpdir(), 'bemoat-role-comment-'))
  const path = join(directory, 'comment.md')
  writeFileSync(path, body, 'utf8')
  return { directory, path }
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

  const { errors, role } = validationErrors(body)
  if (errors.length) {
    for (const error of errors) process.stderr.write(`ERROR: ${error}\n`)
    process.exitCode = 1
    return
  }

  if (body.length > MAX_COMPACT_LENGTH && !parsed.options.allowWarning) {
    process.stderr.write(`WARNING: ${role} is ${body.length} characters; rerun with --allow-warning to acknowledge.\n`)
    process.exitCode = 1
    return
  }
  if (body.length > MAX_COMPACT_LENGTH) process.stderr.write(`WARNING: posting acknowledged long ${role} comment.\n`)

  if (parsed.options.check) {
    process.stdout.write(`validated ${role} comment for Issue #${parsed.options.issue}\n`)
    return
  }

  const temporary = createBodyFile(body)
  const args = ['issue', 'comment', parsed.options.issue]
  if (parsed.options.repo) args.push('--repo', parsed.options.repo)
  args.push('--body-file', temporary.path)
  const result = spawnSync('gh', args, { encoding: 'utf8' })
  rmSync(temporary.directory, { recursive: true, force: true })
  if (result.error || result.status !== 0) {
    process.stderr.write(`ERROR: ${result.stderr || result.error?.message || 'gh issue comment failed'}\n`)
    process.exitCode = 1
    return
  }
  process.stdout.write(`posted ${role} comment to Issue #${parsed.options.issue}\n`)
}

main()
