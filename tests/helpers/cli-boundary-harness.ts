import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { delimiter, dirname, join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const REPOSITORY_ROOT = process.cwd()
const POISON_EXECUTABLES = ['gh', 'git', 'pnpm'] as const

type SnapshotEntry = {
  kind: 'directory' | 'file' | 'symlink'
  mode: number
  content?: string
  target?: string
}

export type FileSystemSnapshot = Record<string, SnapshotEntry>

export type CliBoundaryCase = {
  entrypoint: string
  argv?: readonly string[]
  env?: Partial<NodeJS.ProcessEnv>
  stdin?: string | Buffer
  files?: Record<string, string | Buffer>
}

export type CliBoundaryResult = {
  cwd: string
  entrypoint: string
  argv: string[]
  status: number | null
  signal: NodeJS.Signals | null
  error: string | null
  stdout: string
  stderr: string
  before: FileSystemSnapshot
  after: FileSystemSnapshot
  filesystem_unchanged: boolean
  poison_invocations: string[]
}

function snapshotTree(root: string): FileSystemSnapshot {
  const snapshot: FileSystemSnapshot = {}

  function visit(relativePath: string) {
    const absolutePath = relativePath === '' ? root : join(root, relativePath)
    const stat = lstatSync(absolutePath)
    const key = relativePath === '' ? '.' : relativePath
    const mode = stat.mode & 0o7777

    if (stat.isSymbolicLink()) {
      snapshot[key] = {
        kind: 'symlink',
        mode,
        target: readlinkSync(absolutePath),
      }
      return
    }

    if (stat.isDirectory()) {
      snapshot[key] = { kind: 'directory', mode }
      for (const entry of readdirSync(absolutePath).sort()) {
        visit(relativePath === '' ? entry : join(relativePath, entry))
      }
      return
    }

    snapshot[key] = {
      kind: 'file',
      mode,
      content: readFileSync(absolutePath).toString('base64'),
    }
  }

  visit('')
  return Object.fromEntries(
    Object.entries(snapshot).sort(([left], [right]) => left.localeCompare(right)),
  )
}

function installPoisonExecutables(binDirectory: string, logPath: string) {
  mkdirSync(binDirectory, { recursive: true })

  for (const executable of POISON_EXECUTABLES) {
    const path = join(binDirectory, executable)
    writeFileSync(
      path,
      [
        '#!/bin/sh',
        'printf \'%s\\n\' "$0 $*" >> "$BEMOAT_CLI_POISON_LOG"',
        'exit 97',
        '',
      ].join('\n'),
      'utf8',
    )
    chmodSync(path, 0o755)
  }

  if (existsSync(logPath)) rmSync(logPath, { force: true })
}

function writeFixtureFiles(root: string, files: Record<string, string | Buffer> = {}) {
  for (const [relativePath, content] of Object.entries(files)) {
    const path = join(root, relativePath)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
  }
}

function readPoisonInvocations(logPath: string): string[] {
  if (!existsSync(logPath)) return []
  return readFileSync(logPath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

export function runCliBoundaryCase(options: CliBoundaryCase): CliBoundaryResult {
  const root = mkdtempSync(join(tmpdir(), 'bemoat-cli-boundary-'))
  const binDirectory = join(root, 'poison-bin')
  const poisonLog = join(root, 'poison-calls.log')
  const entrypoint = resolve(REPOSITORY_ROOT, options.entrypoint)
  const argv = [...(options.argv ?? [])]

  try {
    installPoisonExecutables(binDirectory, poisonLog)
    writeFixtureFiles(root, options.files)

    const before = snapshotTree(root)
    const result = spawnSync(process.execPath, [entrypoint, ...argv], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        ...options.env,
        PATH: [binDirectory, process.env.PATH].filter(Boolean).join(delimiter),
        BEMOAT_CLI_POISON_LOG: poisonLog,
      },
      input: options.stdin,
      maxBuffer: 4 * 1024 * 1024,
    })
    const after = snapshotTree(root)
    const poisonInvocations = readPoisonInvocations(poisonLog)

    return {
      cwd: root,
      entrypoint: options.entrypoint,
      argv,
      status: result.status,
      signal: result.signal,
      error: result.error ? result.error.message : null,
      stdout: result.stdout,
      stderr: result.stderr,
      before,
      after,
      filesystem_unchanged: JSON.stringify(before) === JSON.stringify(after),
      poison_invocations: poisonInvocations,
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

export function snapshotDirectory(root: string): FileSystemSnapshot {
  return snapshotTree(resolve(root))
}

export function compareFileSystemSnapshots(
  before: FileSystemSnapshot,
  after: FileSystemSnapshot,
): boolean {
  return JSON.stringify(before) === JSON.stringify(after)
}

export function relativeSnapshotPath(root: string, path: string): string {
  return relative(resolve(root), resolve(path))
}
