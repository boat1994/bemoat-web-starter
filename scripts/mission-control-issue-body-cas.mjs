#!/usr/bin/env node
/**
 * Issue-body single-winner lease/CAS protocol for Mission Control writers.
 *
 * GitHub Issue PATCH does not support If-Match (HTTP 400). GraphQL updateIssue
 * has no body version field. This module wins a Contents-API file `sha` CAS
 * (lease blob) bound to transition identity + observed body hash, then projects
 * the Issue body. Losers fail closed as STATE_CONFLICT.
 *
 * Residual risk: non-protocol writers (manual UI / raw `gh issue edit`) can still
 * race the final reread→edit gap; protocol writers must use this helper.
 */
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

export const ISSUE_BODY_LEASE_BRANCH = 'bemoat/mission-control-leases'
export const ISSUE_BODY_LEASE_SCHEMA_VERSION = 1

export function hashIssueBody(body = '') {
  return createHash('sha256').update(String(body), 'utf8').digest('hex')
}

export function leasePathForIssue(issueNumber) {
  return `.bemoat/mission-control/leases/issue-${issueNumber}.json`
}

export function normalizeLeaseTransitionIdentity(transitionIdentity) {
  if (transitionIdentity == null) return ''
  if (typeof transitionIdentity === 'string') return transitionIdentity
  return JSON.stringify(transitionIdentity)
}

export function buildLeasePayload({
  issueNumber,
  transitionIdentity,
  observedBodyHash,
  holder = 'mission-control',
  status = 'held',
  updatedAt = new Date().toISOString(),
} = {}) {
  return {
    schema_version: ISSUE_BODY_LEASE_SCHEMA_VERSION,
    issue: String(issueNumber),
    transition_identity: normalizeLeaseTransitionIdentity(transitionIdentity),
    observed_body_sha256: observedBodyHash,
    holder,
    status,
    updated_at: updatedAt,
  }
}

export function isLeaseCasConflict(error) {
  if (!error) return false
  if (error.code === 'CAS_CONFLICT') return true
  const message = error instanceof Error ? error.message : String(error)
  return /CAS_CONFLICT|409 Conflict|422 .*sha|but expected|lease CAS lost/i.test(message)
}

export function createMemoryLeaseStore(initial = new Map()) {
  const files = new Map(initial)

  return {
    async read({ path }) {
      const current = files.get(path)
      if (!current) return null
      return { sha: current.sha, content: structuredClone(current.content) }
    },
    async write({ path, content, sha }) {
      const current = files.get(path)
      if (!current) {
        if (sha) {
          const error = new Error('CAS_CONFLICT: lease blob missing for provided sha')
          error.code = 'CAS_CONFLICT'
          throw error
        }
      } else if (sha !== current.sha) {
        const error = new Error('CAS_CONFLICT: lease blob sha mismatch')
        error.code = 'CAS_CONFLICT'
        throw error
      }
      const nextSha = createHash('sha1').update(randomBytes(16)).digest('hex')
      files.set(path, { sha: nextSha, content: structuredClone(content) })
      return { sha: nextSha, content: structuredClone(content) }
    },
    _dump() {
      return files
    },
  }
}

function defaultRunGh(args, options = {}) {
  const result = spawnSync('gh', args, {
    encoding: 'utf8',
    input: options.input,
    env: options.env ?? process.env,
  })
  if (result.error || result.status !== 0) {
    const detail = result.stderr || result.stdout || result.error?.message || 'gh failed'
    const error = new Error(detail)
    error.status = result.status
    error.stderr = result.stderr
    error.stdout = result.stdout
    throw error
  }
  return result.stdout.trim()
}

function parseGhJson(stdout) {
  if (!stdout) return null
  return JSON.parse(stdout)
}

function isNotFoundError(error) {
  const message = error instanceof Error ? error.message : String(error)
  return /\b404\b|Not Found/i.test(message)
}

/**
 * Contents-API lease store. CAS is the blob `sha` on PUT.
 * Leases live on a dedicated branch so protocol commits do not land on main.
 */
export function createGhContentsLeaseStore({
  runGh = defaultRunGh,
  branch = ISSUE_BODY_LEASE_BRANCH,
  ensureBranch = true,
} = {}) {
  const read = async ({ repo, path }) => {
    try {
      const stdout = runGh(['api', `repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`])
      const data = parseGhJson(stdout)
      if (!data?.content || !data?.sha) return null
      const decoded = Buffer.from(String(data.content).replace(/\n/g, ''), 'base64').toString('utf8')
      return { sha: data.sha, content: JSON.parse(decoded) }
    } catch (error) {
      if (isNotFoundError(error)) return null
      throw error
    }
  }

  const ensureLeaseBranch = (repo) => {
    try {
      runGh(['api', `repos/${repo}/git/ref/heads/${branch}`])
      return
    } catch (error) {
      if (!isNotFoundError(error)) throw error
    }
    const repoMeta = parseGhJson(runGh(['api', `repos/${repo}`]))
    const defaultBranch = repoMeta?.default_branch || 'main'
    const ref = parseGhJson(runGh(['api', `repos/${repo}/git/ref/heads/${defaultBranch}`]))
    const sha = ref?.object?.sha
    if (!sha) throw new Error(`unable to resolve default branch tip for lease branch ${branch}`)
    runGh([
      'api',
      '-X',
      'POST',
      `repos/${repo}/git/refs`,
      '--input',
      '-',
    ], {
      input: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
    })
  }

  const write = async ({ repo, path, content, sha }) => {
    const payload = {
      message: `mc: issue-body lease ${path}`,
      content: Buffer.from(`${JSON.stringify(content, null, 2)}\n`, 'utf8').toString('base64'),
      branch,
    }
    if (sha) payload.sha = sha

    const putOnce = () => runGh([
      'api',
      '-X',
      'PUT',
      `repos/${repo}/contents/${path}`,
      '--input',
      '-',
    ], { input: JSON.stringify(payload) })

    try {
      return parseGhJson(putOnce())
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (ensureBranch && /No commit found for the ref|Branch .+ not found|404/i.test(message)) {
        ensureLeaseBranch(repo)
        try {
          return parseGhJson(putOnce())
        } catch (retryError) {
          if (isLeaseCasConflict(retryError) || /\b409\b|\b422\b/.test(retryError instanceof Error ? retryError.message : String(retryError))) {
            const conflict = new Error('CAS_CONFLICT: lease Contents CAS lost')
            conflict.code = 'CAS_CONFLICT'
            conflict.cause = retryError
            throw conflict
          }
          throw retryError
        }
      }
      if (isLeaseCasConflict(error) || /\b409\b|\b422\b/.test(message)) {
        const conflict = new Error('CAS_CONFLICT: lease Contents CAS lost')
        conflict.code = 'CAS_CONFLICT'
        conflict.cause = error
        throw conflict
      }
      throw error
    }
  }

  return { read, write }
}

/**
 * Single-winner Issue body write.
 *
 * 1. Win/adopt Contents lease bound to transition identity + observed body hash
 * 2. Optional `beforeIssueUpdate` seam (tests inject TOCTOU mutation here)
 * 3. Final live body must still equal `expectedBody`
 * 4. Write `nextBody`
 * 5. Advance/release lease to the written body hash
 *
 * @param {{
 *   repo: string,
 *   issueNumber: string | number,
 *   expectedBody: string,
 *   nextBody: string,
 *   transitionIdentity?: string | object | null,
 *   holder?: string,
 *   deps?: {
 *     leaseStore?: { read: Function, write: Function },
 *     readIssueBody: (input: { repo: string, issueNumber: string | number }) => Promise<string>,
 *     writeIssueBody: (input: { repo: string, issueNumber: string | number, body: string }) => Promise<void>,
 *     beforeIssueUpdate?: Function,
 *     runGh?: Function,
 *   },
 * }} input
 */
export async function compareAndSwapIssueBody({
  repo,
  issueNumber,
  expectedBody,
  nextBody,
  transitionIdentity,
  holder = 'mission-control',
  deps = {},
} = /** @type {any} */ ({})) {
  if (!repo) throw new Error('compareAndSwapIssueBody requires repo')
  if (!issueNumber) throw new Error('compareAndSwapIssueBody requires issueNumber')
  if (typeof expectedBody !== 'string') throw new Error('compareAndSwapIssueBody requires expectedBody string')
  if (typeof nextBody !== 'string') throw new Error('compareAndSwapIssueBody requires nextBody string')
  if (typeof deps.readIssueBody !== 'function') throw new Error('compareAndSwapIssueBody requires deps.readIssueBody')
  if (typeof deps.writeIssueBody !== 'function') throw new Error('compareAndSwapIssueBody requires deps.writeIssueBody')

  const leaseStore = deps.leaseStore ?? createGhContentsLeaseStore({ runGh: deps.runGh })
  const path = leasePathForIssue(issueNumber)
  const observedBodyHash = hashIssueBody(expectedBody)
  const normalizedIdentity = normalizeLeaseTransitionIdentity(transitionIdentity)
  // MC-R1-002: never share a blank transition key — empty/null gets a unique claim
  // so two empty writers cannot dual-adopt. Same-identity transport recovery still
  // requires a real non-empty transition identity from the caller.
  const identityKey = normalizedIdentity || `empty-claim:${randomBytes(16).toString('hex')}`

  const existing = await leaseStore.read({ repo, path })
  const sameIdentity = Boolean(
    existing?.content &&
    existing.content.transition_identity === identityKey,
  )
  const sameHash = Boolean(
    existing?.content &&
    existing.content.observed_body_sha256 === observedBodyHash,
  )
  const heldByOther = Boolean(
    existing?.content &&
    existing.content.status === 'held' &&
    !(sameIdentity && sameHash),
  )

  if (heldByOther) {
    throw new Error('STATE_CONFLICT: issue-body lease CAS lost; concurrent writer holds the lease')
  }

  const adoptable = Boolean(
    existing?.content &&
    existing.content.status === 'held' &&
    sameIdentity &&
    sameHash,
  )

  if (!adoptable) {
    const payload = buildLeasePayload({
      issueNumber,
      transitionIdentity: identityKey,
      observedBodyHash,
      holder,
      status: 'held',
    })
    try {
      await leaseStore.write({
        repo,
        path,
        content: payload,
        sha: existing?.sha,
      })
    } catch (error) {
      if (isLeaseCasConflict(error)) {
        throw new Error('STATE_CONFLICT: issue-body lease CAS lost; concurrent writer holds the lease')
      }
      throw error
    }
  }

  const bestEffortReleaseHeldLease = async (releaseObservedBodyHash) => {
    try {
      const current = await leaseStore.read({ repo, path })
      if (!current?.content || current.content.status !== 'held') return
      if (current.content.transition_identity !== identityKey) return
      await leaseStore.write({
        repo,
        path,
        content: buildLeasePayload({
          issueNumber,
          transitionIdentity: identityKey,
          observedBodyHash: releaseObservedBodyHash,
          holder,
          status: 'released',
        }),
        sha: current.sha,
      })
    } catch {
      // Best-effort only: never mask the primary STATE_CONFLICT / caller error.
    }
  }

  if (typeof deps.beforeIssueUpdate === 'function') {
    await deps.beforeIssueUpdate({
      repo,
      issueNumber,
      expectedBody,
      nextBody,
      observedBodyHash,
      transitionIdentity: identityKey,
    })
  }

  const liveBody = await deps.readIssueBody({ repo, issueNumber })
  if (liveBody !== expectedBody) {
    // MC-R1-001: pre-write final-reread conflict must not leave a poisoning held lease.
    // Transport-failure recovery (writeIssueBody throws after lease win) intentionally keeps held.
    await bestEffortReleaseHeldLease(observedBodyHash)
    throw new Error('STATE_CONFLICT: concurrent Issue body change detected before state write')
  }

  await deps.writeIssueBody({ repo, issueNumber, body: nextBody })

  const advanced = buildLeasePayload({
    issueNumber,
    transitionIdentity: identityKey,
    observedBodyHash: hashIssueBody(nextBody),
    holder,
    status: 'released',
  })
  try {
    const afterHold = await leaseStore.read({ repo, path })
    await leaseStore.write({
      repo,
      path,
      content: advanced,
      sha: afterHold?.sha,
    })
  } catch {
    // Body write already succeeded; lease release is best-effort. Postcondition
    // still verifies the projected managed state on the Issue body.
  }

  return {
    path,
    observedBodyHash,
    nextBodyHash: hashIssueBody(nextBody),
    adopted: adoptable,
  }
}

/**
 * Production helper: write Issue body through lease CAS using `gh`.
 */
export async function writeIssueBodyWithLease({
  repo,
  issueNumber,
  expectedBody,
  nextBody,
  transitionIdentity,
  holder = 'mission-control',
  repoFlag = null,
  deps = {},
} = {}) {
  const runGh = deps.runGh ?? defaultRunGh
  const leaseStore = deps.leaseStore ?? createGhContentsLeaseStore({ runGh })

  const readIssueBody = deps.readIssueBody ?? (async () => {
    const args = ['issue', 'view', String(issueNumber), '--json', 'body']
    if (repoFlag) args.push('--repo', repoFlag)
    else if (repo) args.push('--repo', repo)
    const issue = JSON.parse(runGh(args))
    return issue.body
  })

  const writeIssueBody = deps.writeIssueBody ?? (async ({ body }) => {
    const temp = mkdtempSync(join(tmpdir(), 'bemoat-mc-body-'))
    const bodyFile = join(temp, 'issue.md')
    try {
      writeFileSync(bodyFile, body)
      const args = ['issue', 'edit', String(issueNumber), '--body-file', bodyFile]
      if (repoFlag) args.push('--repo', repoFlag)
      else if (repo) args.push('--repo', repo)
      runGh(args)
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  })

  return compareAndSwapIssueBody({
    repo,
    issueNumber,
    expectedBody,
    nextBody,
    transitionIdentity,
    holder,
    deps: {
      ...deps,
      leaseStore,
      readIssueBody,
      writeIssueBody,
      runGh,
    },
  })
}
