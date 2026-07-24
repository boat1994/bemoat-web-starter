import { randomUUID } from 'node:crypto'
import { linkSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'

type LockOwner = {
  pid: number
  token: string
}

type FileIdentity = {
  dev: number | bigint
  ino: number | bigint
}

export type VitestProcessLockDependencies = {
  createOwner: () => LockOwner
  isProcessAlive: (pid: number) => boolean
  link: (source: string, destination: string) => void
  read: (path: string) => string
  remove: (path: string) => void
  stat: (path: string) => FileIdentity
  writeExclusive: (path: string, content: string) => void
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const defaultDependencies: VitestProcessLockDependencies = {
  createOwner: () => ({ pid: process.pid, token: randomUUID() }),
  isProcessAlive: (pid) => {
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      return (error as NodeJS.ErrnoException).code !== 'ESRCH'
    }
  },
  link: linkSync,
  read: (path) => readFileSync(path, 'utf8'),
  remove: (path) => rmSync(path, { force: true }),
  stat: (path) => statSync(path),
  writeExclusive: (path, content) =>
    writeFileSync(path, content, { encoding: 'utf8', flag: 'wx' }),
}

const readLockOwner = (
  lockPath: string,
  dependencies: VitestProcessLockDependencies,
): LockOwner | null => {
  try {
    const owner = JSON.parse(dependencies.read(lockPath)) as Partial<LockOwner>

    return Number.isSafeInteger(owner.pid) &&
      (owner.pid ?? 0) > 0 &&
      typeof owner.token === 'string' &&
      UUID_PATTERN.test(owner.token)
      ? { pid: owner.pid as number, token: owner.token }
      : null
  } catch {
    return null
  }
}

const sameOwner = (left: LockOwner | null, right: LockOwner): boolean =>
  left?.pid === right.pid && left.token === right.token

const sameFile = (left: FileIdentity, right: FileIdentity): boolean =>
  left.dev === right.dev && left.ino === right.ino

const activeRunnerError = (owner: LockOwner | null): Error =>
  new Error(
    `An integration test runner is already active for this checkout${
      owner ? ` (PID ${owner.pid})` : ''
    }. Wait for it to finish before starting another run.`,
  )

const isExpectedContention = (error: unknown): boolean => {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'EEXIST' || code === 'ENOENT'
}

export const acquireVitestProcessLock = (
  lockPath: string,
  dependencies: VitestProcessLockDependencies = defaultDependencies,
): (() => void) => {
  const owner = dependencies.createOwner()
  const createLock = () => dependencies.writeExclusive(lockPath, JSON.stringify(owner))

  try {
    createLock()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error

    const observedOwner = readLockOwner(lockPath, dependencies)
    if (!observedOwner || dependencies.isProcessAlive(observedOwner.pid)) {
      throw activeRunnerError(observedOwner)
    }

    const claimPath = `${lockPath}.reclaim-${observedOwner.token}`

    try {
      dependencies.link(lockPath, claimPath)
    } catch (claimError) {
      if (isExpectedContention(claimError)) {
        throw activeRunnerError(readLockOwner(lockPath, dependencies))
      }
      throw claimError
    }

    try {
      const claimedOwner = readLockOwner(claimPath, dependencies)
      if (
        !sameOwner(claimedOwner, observedOwner) ||
        dependencies.isProcessAlive(observedOwner.pid) ||
        !sameFile(dependencies.stat(lockPath), dependencies.stat(claimPath))
      ) {
        throw activeRunnerError(readLockOwner(lockPath, dependencies))
      }

      dependencies.remove(lockPath)

      try {
        createLock()
      } catch (retryError) {
        if ((retryError as NodeJS.ErrnoException).code === 'EEXIST') {
          throw activeRunnerError(readLockOwner(lockPath, dependencies))
        }
        throw retryError
      }
    } finally {
      dependencies.remove(claimPath)
    }
  }

  return () => {
    if (sameOwner(readLockOwner(lockPath, dependencies), owner)) {
      dependencies.remove(lockPath)
    }
  }
}
