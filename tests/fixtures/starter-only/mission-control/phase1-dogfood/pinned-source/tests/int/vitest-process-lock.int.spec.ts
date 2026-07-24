// @vitest-environment node

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  acquireVitestProcessLock,
  type VitestProcessLockDependencies,
} from '../helpers/vitestProcessLock'

describe('Vitest process lock', () => {
  it('rejects an overlapping runner and permits the next runner after release', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'bemoat-vitest-process-lock-'))
    const lockPath = join(tempRoot, 'integration.lock')

    try {
      const releaseFirst = acquireVitestProcessLock(lockPath)

      expect(() => acquireVitestProcessLock(lockPath)).toThrow(
        /integration test runner is already active/i,
      )

      releaseFirst()

      const releaseNext = acquireVitestProcessLock(lockPath)
      releaseNext()
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('reclaims a proven-dead owner deterministically', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'bemoat-vitest-process-lock-'))
    const lockPath = join(tempRoot, 'integration.lock')
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: 999_999_999, token: '00000000-0000-4000-8000-000000000000' }),
    )

    try {
      const release = acquireVitestProcessLock(lockPath)
      expect(JSON.parse(readFileSync(lockPath, 'utf8')).pid).toBe(process.pid)
      release()
      expect(existsSync(lockPath)).toBe(false)
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('fails closed for malformed ownership', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'bemoat-vitest-process-lock-'))
    const lockPath = join(tempRoot, 'integration.lock')
    writeFileSync(lockPath, '{"pid":"unknown"}')

    try {
      expect(() => acquireVitestProcessLock(lockPath)).toThrow(
        /integration test runner is already active/i,
      )
      expect(existsSync(lockPath)).toBe(true)
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('protects a live owner indefinitely without elapsed-time reclamation', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'bemoat-vitest-process-lock-'))
    const lockPath = join(tempRoot, 'integration.lock')
    const owner = {
      pid: process.pid,
      token: '22222222-2222-4222-8222-222222222222',
      startedAt: '1970-01-01T00:00:00.000Z',
    }
    writeFileSync(lockPath, JSON.stringify(owner))

    try {
      expect(() => acquireVitestProcessLock(lockPath)).toThrow(
        /integration test runner is already active/i,
      )
      expect(JSON.parse(readFileSync(lockPath, 'utf8'))).toEqual(owner)
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('does not remove a successor lock during token-safe teardown', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'bemoat-vitest-process-lock-'))
    const lockPath = join(tempRoot, 'integration.lock')

    try {
      const release = acquireVitestProcessLock(lockPath)
      rmSync(lockPath)
      writeFileSync(
        lockPath,
        JSON.stringify({ pid: process.pid, token: '11111111-1111-4111-8111-111111111111' }),
      )

      release()

      expect(JSON.parse(readFileSync(lockPath, 'utf8')).token).toBe(
        '11111111-1111-4111-8111-111111111111',
      )
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('allows only one contender when both observe the same dead owner', () => {
    type Entry = { content: string; identity: number }
    const deadOwner = { pid: 999_999_999, token: '00000000-0000-4000-8000-000000000000' }
    const files = new Map<string, Entry>([
      ['/integration.lock', { content: JSON.stringify(deadOwner), identity: 1 }],
    ])
    let nextIdentity = 2
    let outerClaimStarted = false
    let innerRelease: (() => void) | undefined
    let deadOwnerReads = 0

    const dependencies: VitestProcessLockDependencies = {
      createOwner: () => ({
        pid: process.pid,
        token: `${String(nextIdentity).padStart(8, '0')}-0000-4000-8000-000000000000`,
      }),
      isProcessAlive: (pid) => pid !== deadOwner.pid,
      link: (source, destination) => {
        if (!outerClaimStarted) {
          outerClaimStarted = true
          innerRelease = acquireVitestProcessLock('/integration.lock', dependencies)
        }
        const sourceEntry = files.get(source)
        if (!sourceEntry) throw fileError('ENOENT')
        if (files.has(destination)) throw fileError('EEXIST')
        files.set(destination, sourceEntry)
      },
      read: (path) => {
        const entry = files.get(path)
        if (!entry) throw fileError('ENOENT')
        if (entry.content === JSON.stringify(deadOwner)) deadOwnerReads += 1
        return entry.content
      },
      remove: (path) => {
        files.delete(path)
      },
      stat: (path) => {
        const entry = files.get(path)
        if (!entry) throw fileError('ENOENT')
        return { dev: 1, ino: entry.identity }
      },
      writeExclusive: (path, content) => {
        if (files.has(path)) throw fileError('EEXIST')
        files.set(path, { content, identity: nextIdentity++ })
      },
    }

    expect(() => acquireVitestProcessLock('/integration.lock', dependencies)).toThrow(
      /integration test runner is already active/i,
    )
    expect(deadOwnerReads).toBeGreaterThanOrEqual(2)
    expect(innerRelease).toBeTypeOf('function')

    innerRelease?.()
  })
})

function fileError(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException
  error.code = code
  return error
}
