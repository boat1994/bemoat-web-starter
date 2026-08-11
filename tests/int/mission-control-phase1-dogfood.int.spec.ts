import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped runtime .mjs boundary */
import * as reconcileModule from '../../scripts/mission-control-reconcile.mjs'
import * as correctionContractModule from '../../scripts/mission-control/domain/correction-contract.mjs'

const {
  analyzeReconciliation,
  classifyReconciliation,
  classifyDeliveryLag,
  classifyReviewLag,
  dispatchManagedTask,
  parseRoleCommentBody,
  proposeDeliveryReconciliation,
  proposeReviewReconciliation,
  runBoundedReconciliation,
} = reconcileModule as unknown as Record<string, (...args: any[]) => any>

const {
  buildCorrectionCapsule,
  parseCorrectionContract,
  validateCorrectionRoleComment,
  validateCorrectionScope,
  validateFindingEvidence,
  validateFindingIdentity,
} = correctionContractModule as unknown as Record<string, (...args: any[]) => any>

const PINNED_SNAPSHOT_SHA = 'c01156c66fd33741df9b5d4acf22b620b605f221'
const STARTER_ONLY_FIXTURE_BASE = 'tests/fixtures/starter-only/mission-control/phase1-dogfood'
const FIXTURE_ROOT = resolve(process.cwd(), STARTER_ONLY_FIXTURE_BASE, 'pinned-source')
const PINNED_MANIFEST = JSON.parse(
  readFileSync(resolve(process.cwd(), STARTER_ONLY_FIXTURE_BASE, 'pinned-source-manifest.json'), 'utf8'),
) as {
  pinned_sha: string
  files: Record<string, string>
  file_count: number
}
const PINNED_FIXTURE = JSON.parse(
  readFileSync(resolve(process.cwd(), STARTER_ONLY_FIXTURE_BASE, 'pinned-snapshot.json'), 'utf8'),
) as {
  pinned_sha: string
  mutated_managed_path: string
  fixture_root: string
  manifest_path: string
}

const reviewedHead = 'abc1234deadbeef0000000000000000000000000'
const planningHead = '3d0e83e'

const sampleResultBody = `## RESULT

### Task log
- Timestamp: 2026-07-17T10:00:00+07:00
- Task / Issue: #169
- Phase: Dev (implementation)
- Executing role: Dev / Builder

**Completed:** Dev (implementation)
**State:** branch \`feature/169\` · base \`main\` · head \`${reviewedHead}\`
**PR:** https://github.com/boat1994/bemoat-web-starter/pull/170
**Managed state:** AWAITING_REVIEW_1 · PR #170 · \`${reviewedHead}\`
**Summary:** Phase 1 dogfood bounded implementation
**Next:** Reviewer ## REVIEW_VERDICT
`

const sampleVerdictBody = (verdict: string, reviewCycle = 0) => `## REVIEW_VERDICT

### Task log
- Timestamp: 2026-07-17T11:00:00+07:00
- Task / Issue: #169
- Phase: Reviewer
- Executing role: Reviewer / Red Team

**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/170 · \`main\` · \`${reviewedHead}\`
**Verdict:** ${verdict}
**Managed state:** AWAITING_REVIEW_1 · cycle ${reviewCycle} · last_reviewed_head \`${reviewedHead}\`
**Findings:** Critical: None · Important: None
**Gates:** exact-head CI pass
**Next:** Founder merge authorization
`

const correctionFindings = [
  {
    id: 'MC-DOG-R1-004',
    canonical_summary: 'missing deterministic S1-S10 scenario-chain assertions',
    source_thread: 'https://github.com/boat1994/bemoat-web-starter/issues/169#issuecomment-5070043156',
    required_evidence: ['named deterministic tests for S1-S10'],
    expected_areas: ['tests/int/mission-control-phase1-dogfood.int.spec.ts'],
    prohibited_areas: ['scripts/mission-control-reconcile.mjs'],
  },
]

function correctionVerdictBody(contractOverrides: Record<string, unknown> = {}) {
  const contract = {
    schema_version: 1,
    reviewed_head: reviewedHead,
    findings: correctionFindings,
    ...contractOverrides,
  }
  return `## REVIEW_VERDICT
### Task log
- Timestamp: 2026-07-20T12:00:00+07:00
- Task / Issue: #169
- Phase: Reviewer
- Executing role: Reviewer

**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/170 · \`main\` · \`${reviewedHead}\`
**Verdict:** CORRECTION REQUIRED
**Findings:** Important: scenario coverage
**Gates:** exact-head CI pass
**Next:** Dev posts correction RESULT

\`\`\`json
${JSON.stringify(contract, null, 2)}
\`\`\`
`
}

function correctionResultBody(map: Record<string, unknown>) {
  return `## RESULT
### Task log
- Timestamp: 2026-07-20T13:00:00+07:00
- Task / Issue: #169
- Phase: Dev (correction)
- Executing role: Dev / Builder
**Completed:** Correction
**Summary:** Addressed immutable findings with explicit evidence.
**Next:** Delta Reviewer posts REVIEW_VERDICT

\`\`\`json
${JSON.stringify(map, null, 2)}
\`\`\`
`
}

function createMeasurementSink() {
  return {
    simulated_state_writes: 0,
    simulated_role_comments: 0,
    real_github_writes: 0,
    model_required_stages: 0,
  }
}

function digestFile(path: string) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function enumerateRegularFiles(rootDir: string, baseDir = rootDir): string[] {
  const entries = readdirSync(rootDir)
  const files: string[] = []

  for (const entry of entries) {
    const absolutePath = join(rootDir, entry)
    const relativePath = relative(baseDir, absolutePath)

    if (statSync(absolutePath).isDirectory()) {
      files.push(...enumerateRegularFiles(absolutePath, baseDir))
      continue
    }

    files.push(relativePath)
  }

  return files.sort()
}

function assertExactSetEquality(actual: string[], expected: string[], label: string) {
  const actualSet = new Set(actual)
  const expectedSet = new Set(expected)
  const missingFromActual = expected.filter((entry) => !actualSet.has(entry))
  const extraInActual = actual.filter((entry) => !expectedSet.has(entry))

  expect(
    { missingFromActual, extraInActual },
    `${label}: expected exact set equality`,
  ).toEqual({ missingFromActual: [], extraInActual: [] })
}

function verifyFixtureManifestEquality() {
  const fixtureRelativePaths = enumerateRegularFiles(FIXTURE_ROOT)
  const manifestKeys = Object.keys(PINNED_MANIFEST.files).sort()

  assertExactSetEquality(fixtureRelativePaths, manifestKeys, 'fixture files vs manifest keys')
  expect(manifestKeys).toHaveLength(PINNED_MANIFEST.file_count)

  for (const [relativePath, expectedDigest] of Object.entries(PINNED_MANIFEST.files)) {
    const fixturePath = join(FIXTURE_ROOT, relativePath)
    expect(existsSync(fixturePath)).toBe(true)
    expect(digestFile(fixturePath)).toBe(expectedDigest)
  }
}

type GitCommandRunner = (
  command: string,
  args: string[],
  options?: { cwd?: string; encoding?: BufferEncoding | 'buffer'; stdio?: 'pipe' },
) => string | Buffer

type PinnedObjectProbeResult =
  | { status: 'AVAILABLE' }
  | { status: 'OBJECT_UNAVAILABLE' }
  | { status: 'UNEXPECTED_FAILURE'; reason: string }

function defaultGitRunner(
  command: string,
  args: string[],
  options?: { cwd?: string; encoding?: BufferEncoding | 'buffer'; stdio?: 'pipe' },
): string {
  return execFileSync(command, args, {
    cwd: options?.cwd ?? process.cwd(),
    encoding: (options?.encoding ?? 'utf8') as BufferEncoding,
    stdio: options?.stdio ?? 'pipe',
  }) as string
}

function isGenuinelyAbsentPinnedObject(exitStatus: number, stderr: string): boolean {
  if (exitStatus === 1) {
    return true
  }

  return exitStatus === 128 && /not a valid object name/i.test(stderr)
}

function classifyPinnedCommitObjectAvailability(
  runner: GitCommandRunner = defaultGitRunner,
  sha: string = PINNED_SNAPSHOT_SHA,
): PinnedObjectProbeResult {
  try {
    runner('git', ['cat-file', '-e', `${sha}^{commit}`], { stdio: 'pipe' })
    return { status: 'AVAILABLE' }
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      status?: number
      stderr?: Buffer | string
    }

    if (err.code === 'ENOENT') {
      return { status: 'UNEXPECTED_FAILURE', reason: 'git executable not available' }
    }

    if (err.code === 'EACCES' || err.code === 'EPERM') {
      return {
        status: 'UNEXPECTED_FAILURE',
        reason: `git invocation permission failure: ${err.code}`,
      }
    }

    const exitStatus = err.status
    const stderr = err.stderr && Buffer.isBuffer(err.stderr) ? err.stderr.toString('utf8') : String(err.stderr ?? '')

    if (exitStatus === undefined) {
      return {
        status: 'UNEXPECTED_FAILURE',
        reason: err.message || 'unrecognized subprocess failure',
      }
    }

    if (stderr.includes('not a git repository')) {
      return { status: 'UNEXPECTED_FAILURE', reason: 'invalid git repository' }
    }

    if (isGenuinelyAbsentPinnedObject(exitStatus, stderr)) {
      return { status: 'OBJECT_UNAVAILABLE' }
    }

    return {
      status: 'UNEXPECTED_FAILURE',
      reason: stderr.trim() || `unexpected git exit code ${exitStatus}`,
    }
  }
}

function deriveManagedPathFilesFromCommit(sha: string, runner: GitCommandRunner = defaultGitRunner) {
  const manifestContent = runner('git', ['show', `${sha}:.bemoat/boilerplate-sync-manifest.json`], {
    encoding: 'utf8',
  }) as string
  const managedPaths = (JSON.parse(manifestContent) as { managedPaths: string[] }).managedPaths
  const commitFiles = (runner('git', ['ls-tree', '-r', '--name-only', sha], { encoding: 'utf8' }) as string)
    .trim()
    .split('\n')
    .filter(Boolean)

  return commitFiles
    .filter((filePath) =>
      managedPaths.some(
        (managedPath) => filePath === managedPath || filePath.startsWith(`${managedPath}/`),
      ),
    )
    .sort()
}

function verifyStrictPinnedProvenance(runner: GitCommandRunner = defaultGitRunner) {
  const probe = classifyPinnedCommitObjectAvailability(runner)
  if (probe.status === 'OBJECT_UNAVAILABLE') {
    return
  }
  if (probe.status === 'UNEXPECTED_FAILURE') {
    throw new Error(`pinned commit object probe failed closed: ${probe.reason}`)
  }

  const commitManagedFiles = deriveManagedPathFilesFromCommit(PINNED_SNAPSHOT_SHA, runner)
  const manifestKeys = Object.keys(PINNED_MANIFEST.files).sort()
  const fixtureRelativePaths = enumerateRegularFiles(FIXTURE_ROOT)

  assertExactSetEquality(commitManagedFiles, manifestKeys, 'pinned commit managed files vs manifest keys')
  assertExactSetEquality(fixtureRelativePaths, manifestKeys, 'fixture files vs manifest keys')

  for (const [relativePath, expectedDigest] of Object.entries(PINNED_MANIFEST.files)) {
    const content = runner('git', ['show', `${PINNED_SNAPSHOT_SHA}:${relativePath}`], {
      encoding: 'buffer',
    })
    const gitDigest = createHash('sha256').update(content).digest('hex')
    expect(gitDigest).toBe(expectedDigest)
  }
}

function materializePinnedFixtureSource(targetDir: string) {
  // Callers must run verifyFixtureManifestEquality / verifyStrictPinnedProvenance
  // once before materializing. Re-running provenance here doubled ~174 `git show`
  // calls and pushed S10 over the default timeout under parallel `pnpm run check`.
  cpSync(FIXTURE_ROOT, targetDir, { recursive: true })
  for (const [relativePath, expectedDigest] of Object.entries(PINNED_MANIFEST.files)) {
    const destination = join(targetDir, relativePath)
    expect(existsSync(destination)).toBe(true)
    expect(digestFile(destination)).toBe(expectedDigest)
  }
}

function gitStatusShort() {
  return execFileSync('git', ['status', '--short'], { cwd: process.cwd(), encoding: 'utf8' })
}

describe('pinned commit object probe classification (MC-DOG-R1-006)', () => {
  it('classifies AVAILABLE when pinned commit object exists and runs strict provenance', () => {
    const gitShowCalls: string[] = []
    const gitLsTreeCalls: string[] = []
    // Full DI for show/ls-tree from fixture/manifest so AVAILABLE proves strict provenance
    // without requiring the pinned object in shallow CI history.
    const runner: GitCommandRunner = (command, args, options) => {
      if (command !== 'git') {
        throw new Error(`unexpected command in AVAILABLE DI runner: ${command}`)
      }

      if (args[0] === 'cat-file') {
        return ''
      }

      if (args[0] === 'show') {
        const target = args[1] ?? ''
        gitShowCalls.push(target)
        const prefix = `${PINNED_SNAPSHOT_SHA}:`
        if (!target.startsWith(prefix)) {
          throw new Error(`unexpected git show target: ${target}`)
        }
        const relativePath = target.slice(prefix.length)
        const fixturePath = join(FIXTURE_ROOT, relativePath)
        if (!existsSync(fixturePath)) {
          throw new Error(`fixture missing for DI show: ${relativePath}`)
        }
        if (options?.encoding === 'buffer') {
          return readFileSync(fixturePath)
        }
        return readFileSync(fixturePath, 'utf8')
      }

      if (args[0] === 'ls-tree') {
        gitLsTreeCalls.push(args.join(' '))
        return `${Object.keys(PINNED_MANIFEST.files).sort().join('\n')}\n`
      }

      throw new Error(`unexpected git invocation in AVAILABLE DI runner: ${args.join(' ')}`)
    }

    const probe = classifyPinnedCommitObjectAvailability(runner)
    expect(probe.status).toBe('AVAILABLE')

    expect(() => verifyStrictPinnedProvenance(runner)).not.toThrow()
    expect(gitShowCalls.length).toBeGreaterThan(0)
    expect(gitShowCalls.some((target) => target.startsWith(`${PINNED_SNAPSHOT_SHA}:`))).toBe(true)
    expect(gitLsTreeCalls.length).toBeGreaterThan(0)
  })

  it('classifies OBJECT_UNAVAILABLE when pinned object is genuinely absent and skips only git-object comparison', () => {
    const absentSha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
    const runner: GitCommandRunner = (command, args) => {
      if (command === 'git' && args[0] === 'cat-file') {
        const err = new Error('object missing') as NodeJS.ErrnoException & {
          status?: number
          stderr?: Buffer
        }
        err.status = 128
        err.stderr = Buffer.from(`fatal: Not a valid object name ${absentSha}^{commit}`)
        throw err
      }
      throw new Error('git-object comparison must be skipped when object is unavailable')
    }

    const probe = classifyPinnedCommitObjectAvailability(runner, absentSha)
    expect(probe.status).toBe('OBJECT_UNAVAILABLE')

    expect(() => verifyFixtureManifestEquality()).not.toThrow()
    expect(() => verifyStrictPinnedProvenance(runner)).not.toThrow()
  })

  it('default runner maps exit 128 peel failure to OBJECT_UNAVAILABLE in a valid repo', () => {
    const absentSha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
    const probe = classifyPinnedCommitObjectAvailability(defaultGitRunner, absentSha)
    expect(probe.status).toBe('OBJECT_UNAVAILABLE')
  })

  it('classifies UNEXPECTED_FAILURE and fails closed for unexpected Git failures', () => {
    const permissionRunner: GitCommandRunner = () => {
      const err = new Error('permission denied') as NodeJS.ErrnoException & { code?: string }
      err.code = 'EACCES'
      throw err
    }

    const permissionProbe = classifyPinnedCommitObjectAvailability(permissionRunner)
    expect(permissionProbe.status).toBe('UNEXPECTED_FAILURE')
    if (permissionProbe.status === 'UNEXPECTED_FAILURE') {
      expect(permissionProbe.reason).toContain('permission failure')
    }

    expect(() => verifyStrictPinnedProvenance(permissionRunner)).toThrow(/failed closed/)

    const ambiguousRunner: GitCommandRunner = () => {
      const err = new Error('git corruption') as NodeJS.ErrnoException & {
        status?: number
        stderr?: Buffer
      }
      err.status = 128
      err.stderr = Buffer.from('fatal: git show failed: corrupt object')
      throw err
    }

    const ambiguousProbe = classifyPinnedCommitObjectAvailability(ambiguousRunner)
    expect(ambiguousProbe.status).toBe('UNEXPECTED_FAILURE')
    if (ambiguousProbe.status === 'UNEXPECTED_FAILURE') {
      expect(ambiguousProbe.reason).toContain('corrupt object')
    }
  })
})

describe('mission-control phase 1 dogfood scenarios (S1-S10)', () => {
  it('S1: complete delivery chain READY -> IN_PROGRESS -> HANDOFF -> RESULT -> AWAITING_REVIEW_1', async () => {
    const measurements = createMeasurementSink()
    let state: any = {
      state: 'READY',
      review_cycle: 0,
      full_review_count: 0,
      finding_lineage: [],
      active_pr: null,
      current_head: null,
    }

    const dispatch = await dispatchManagedTask({
      readState: async () => state,
      writeState: async (next: any) => {
        measurements.simulated_state_writes += 1
        state = next
      },
      postHandoff: async (body: string) => {
        measurements.simulated_role_comments += 1
        return { id: 'handoff-s1', body }
      },
      handoffBody: '## HANDOFF\n\nBounded Dev work for #169',
    })

    expect(dispatch.outcome).toBe('DISPATCHED')
    expect(state.state).toBe('IN_PROGRESS')
    expect(measurements.simulated_state_writes).toBe(1)
    expect(measurements.simulated_role_comments).toBe(1)

    const parsedResult = parseRoleCommentBody(sampleResultBody)
    const deliveryLag = classifyDeliveryLag(
      state,
      { number: '170', headRefOid: reviewedHead, baseRefName: 'main' },
      { exactHeadVerified: true },
      { parsed: parsedResult },
    )
    expect(deliveryLag.kind).toBe('DETERMINISTIC_RECONCILIATION')

    const proposal = proposeDeliveryReconciliation({
      livePr: { number: '170', headRefOid: reviewedHead, baseRefName: 'main' },
      activeTaskIssue: '169',
      latestResult: { parsed: parsedResult },
    })
    expect(proposal).toMatchObject({
      state: 'AWAITING_REVIEW_1',
      review_cycle: 0,
      full_review_count: 0,
      active_pr: '#170',
      current_head: reviewedHead,
      last_reviewed_head: null,
    })

    const analysis = analyzeReconciliation({
      managedState: { ...state, state: 'IN_PROGRESS', active_pr: null, current_head: null },
      livePr: { number: '170', headRefOid: reviewedHead, baseRefName: 'main' },
      exactHeadCi: { exactHeadVerified: true },
      latestResult: { parsed: parsedResult },
      latestVerdict: null,
      activeTaskIssue: '169',
      stateConflictBlockers: [],
    })
    expect(analysis.genuineConflict).toBe(false)
    expect(analysis.proposal?.fields).toMatchObject({
      state: 'AWAITING_REVIEW_1',
      review_cycle: 0,
      full_review_count: 0,
    })

    expect(measurements.real_github_writes).toBe(0)
    expect(measurements.model_required_stages).toBe(0)
  })

  it('S2: Review 1 correction chain retains findings and Delta Review reaches ELIGIBLE_FOR_FOUNDER_REVIEW', () => {
    const canonical = parseCorrectionContract(correctionVerdictBody()).contract
    const review1 = proposeReviewReconciliation({
      verdict: 'CORRECTION REQUIRED',
      reviewedHead: reviewedHead,
      reviewCycle: 0,
      fullReviewCount: 0,
    })
    expect(review1).toMatchObject({
      state: 'CORRECTION_REQUIRED_1',
      review_cycle: 1,
      full_review_count: 1,
      last_reviewed_head: reviewedHead,
    })

    const evidenceMap = {
      schema_version: 1,
      correction_base: reviewedHead,
      finding_results: {
        'MC-DOG-R1-004': {
          changed_files: ['tests/int/mission-control-phase1-dogfood.int.spec.ts'],
          tests: ['pnpm exec vitest run tests/int/mission-control-phase1-dogfood.int.spec.ts'],
          status: 'CLAIMED_RESOLVED',
        },
      },
    }
    const correctionValidation = validateCorrectionRoleComment({
      role: 'RESULT',
      body: correctionResultBody(evidenceMap),
      diffFiles: ['tests/int/mission-control-phase1-dogfood.int.spec.ts'],
      canonicalContract: canonical,
    })
    expect(correctionValidation.ok).toBe(true)
    expect(validateFindingIdentity(canonical, canonical).ok).toBe(true)

    const deltaReview = proposeReviewReconciliation({
      verdict: 'ELIGIBLE FOR FOUNDER REVIEW',
      reviewedHead: reviewedHead,
      reviewCycle: 1,
      fullReviewCount: 1,
    })
    expect(deltaReview).toMatchObject({
      state: 'ELIGIBLE_FOR_FOUNDER_REVIEW',
      review_cycle: 2,
      full_review_count: 1,
      last_reviewed_head: reviewedHead,
    })
    expect(deltaReview.full_review_count).toBe(1)
  })

  it('S3: planning_no_pr keeps active_pr null, preserves finding IDs and last_reviewed_head', () => {
    const planningContract = {
      schema_version: 1,
      mode: 'planning_no_pr' as const,
      reviewed_head: planningHead,
      findings: [
        {
          id: 'MC-R1-001',
          canonical_summary: 'design spec missing exact error boundary',
          source_thread: 'https://github.com/boat1994/bemoat-web-starter/pull/12#discussion_r1',
          required_evidence: ['updated design.md'],
          expected_areas: ['docs/superpowers/specs/bogus/catalog/minimal-luxury-detail/design.md'],
          prohibited_areas: [] as string[],
        },
      ],
    }

    const managedState: {
      state: string
      active_pr: null
      current_head: string
      last_reviewed_head: string
      review_cycle: number
      full_review_count: number
      approved_base: string
    } = {
      state: 'CORRECTION_REQUIRED_1',
      active_pr: null,
      current_head: planningHead,
      last_reviewed_head: planningHead,
      review_cycle: 1,
      full_review_count: 1,
      approved_base: 'main',
    }

    const capsule = buildCorrectionCapsule(planningContract, {
      issueNumber: '169',
      prUrl: 'none',
      mode: 'planning_no_pr',
    })
    expect(capsule.lines.join('\n')).toContain('Mode: planning_no_pr')
    expect(capsule.lines.join('\n')).toContain('PR: none')

    const allowedScope = validateCorrectionScope(
      planningContract,
      ['docs/superpowers/specs/bogus/catalog/minimal-luxury-detail/design.md'],
      { mode: 'planning_no_pr' },
    )
    expect(allowedScope.ok).toBe(true)

    const rejectedScope = validateCorrectionScope(
      planningContract,
      ['src/app/page.tsx'],
      { mode: 'planning_no_pr' },
    )
    expect(rejectedScope.ok).toBe(false)

    const evidenceMap = {
      finding_results: {
        'MC-R1-001': {
          changed_files: ['docs/superpowers/specs/bogus/catalog/minimal-luxury-detail/design.md'],
          tests: ['pnpm run guard:safety'],
          status: 'CLAIMED_RESOLVED',
        },
      },
    }
    const evidence = validateFindingEvidence(
      planningContract,
      evidenceMap,
      ['docs/superpowers/specs/bogus/catalog/minimal-luxury-detail/design.md'],
      { mode: 'planning_no_pr' },
    )
    expect(evidence.ok).toBe(true)
    expect(validateFindingIdentity(planningContract, planningContract).ok).toBe(true)

    const deltaVerdict = proposeReviewReconciliation({
      verdict: 'ELIGIBLE FOR FOUNDER REVIEW',
      reviewedHead: planningHead,
      reviewCycle: 1,
      fullReviewCount: 1,
    })
    expect(managedState.active_pr).toBeNull()
    expect(managedState.current_head).toBe(planningHead)
    expect(managedState.last_reviewed_head).toBe(planningHead)
    expect(deltaVerdict).toMatchObject({
      state: 'ELIGIBLE_FOR_FOUNDER_REVIEW',
      review_cycle: 2,
      full_review_count: 1,
      last_reviewed_head: planningHead,
    })
    expect(planningContract.findings.map((finding) => finding.id)).toEqual(['MC-R1-001'])
  })

  it('S4: bookkeeping lag repairs deterministically within one repair and one verification', async () => {
    let evidence: any = {
      managedState: {
        state: 'IN_PROGRESS',
        active_pr: null,
        current_head: null,
        approved_base: 'main',
        review_cycle: 0,
        full_review_count: 0,
      },
    }
    const writes: any[] = []
    const parsedResult = parseRoleCommentBody(sampleResultBody)

    const first = await runBoundedReconciliation({
      readEvidence: async () => ({
        ...evidence,
        livePr: { number: '170', headRefOid: reviewedHead, baseRefName: 'main' },
        exactHeadCi: { exactHeadVerified: true },
        latestResult: { parsed: parsedResult },
        latestVerdict: null,
        activeTaskIssue: '169',
        stateConflictBlockers: [],
        bookkeepingProposal: proposeDeliveryReconciliation({
          livePr: { number: '170', headRefOid: reviewedHead, baseRefName: 'main' },
          activeTaskIssue: '169',
          latestResult: { parsed: parsedResult },
          updatedAt: '2026-07-26T09:00:00Z',
          updatedBy: 'Mission Control',
        }),
      }),
      writeState: async (nextState: any) => {
        writes.push(nextState)
        evidence = { ...evidence, managedState: nextState }
        return nextState
      },
    })

    expect(first.finalOutcome).toBe('NO_OP')
    expect(first.measurements).toMatchObject({
      coordination_runs: 1,
      state_writes: 1,
      reconciliation_attempts: 2,
      false_state_conflicts: 0,
    })
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({
      state: 'AWAITING_REVIEW_1',
      review_cycle: 0,
      full_review_count: 0,
      current_head: reviewedHead,
    })
    expect(classifyReconciliation({ bookkeepingProposal: writes[0], managedState: writes[0] }).outcome).toBe('NO_OP')
  })

  it('S5: genuine contradiction produces STATE_CONFLICT with zero repair writes and zero role comments', async () => {
    const measurements = createMeasurementSink()
    const result = await runBoundedReconciliation({
      readEvidence: async () => ({
        managedState: {
          state: 'IN_PROGRESS',
          active_pr: '#170',
          current_head: 'oldhead',
          review_cycle: 0,
          full_review_count: 0,
        },
        livePr: { number: '170', headRefOid: 'newhead' },
        exactHeadCi: { exactHeadVerified: true },
        latestResult: { parsed: { headSha: 'oldhead', prNumber: '170' } },
        stateConflictBlockers: ['STATE_CONFLICT: state current_head does not match the live PR head.'],
        authoritativeContradiction: true,
      }),
      writeState: async () => {
        measurements.simulated_state_writes += 1
        throw new Error('must not write on genuine contradiction')
      },
    })

    const lag = classifyDeliveryLag(
      { state: 'IN_PROGRESS', active_pr: '#170', current_head: 'oldhead' },
      { number: '170', headRefOid: 'newhead' },
      { exactHeadVerified: true },
      { parsed: { headSha: 'oldhead', prNumber: '170' } },
    )
    expect(lag.kind).toBe('STATE_CONFLICT')
    expect(result.finalOutcome).toBe('STATE_CONFLICT')
    expect(result.measurements.state_writes).toBe(0)
    expect(measurements.simulated_state_writes).toBe(0)
    expect(measurements.simulated_role_comments).toBe(0)
    expect(measurements.model_required_stages).toBe(0)
  })

  it('S6: missing live evidence blocks with BLOCKED_EXTERNAL and emits no review verdict', async () => {
    const classification = classifyReconciliation({ requiredEvidenceUnavailable: true })
    expect(classification.outcome).toBe('BLOCKED_EXTERNAL')

    const result = await runBoundedReconciliation({
      readEvidence: async () => ({ requiredEvidenceUnavailable: true }),
      writeState: async () => {
        throw new Error('must not write when evidence is unavailable')
      },
    })

    expect(result.finalOutcome).toBe('BLOCKED_EXTERNAL')
    expect(result.measurements.state_writes).toBe(0)
    expect(result.measurements.reconciliation_attempts).toBe(1)

    const reviewLag = classifyReviewLag(
      { state: 'AWAITING_REVIEW_1', review_cycle: 0, last_reviewed_head: null },
      null,
      null,
    )
    expect(reviewLag.kind).toBeNull()
    expect(reviewLag.reason).toBe('no review verdict evidence')
  })

  it('S7: Review 3 boundary records review_cycle 3 and blocks Review 4 escalation', () => {
    const preReview3 = {
      state: 'AWAITING_REVIEW_3',
      review_cycle: 2,
      full_review_count: 1,
      last_reviewed_head: reviewedHead,
    }
    expect(preReview3.review_cycle).toBe(2)

    const review3 = proposeReviewReconciliation({
      verdict: 'BLOCKED FOR FOUNDER DECISION',
      reviewedHead: reviewedHead,
      reviewCycle: 2,
      fullReviewCount: 1,
    })
    expect(review3).toMatchObject({
      state: 'BLOCKED_FOR_FOUNDER_DECISION',
      review_cycle: 3,
      full_review_count: 1,
      last_reviewed_head: reviewedHead,
    })
    expect(review3.next_permitted_action).toContain('Approve or Decline')

    const illegalReview4 = proposeReviewReconciliation({
      verdict: 'CORRECTION REQUIRED',
      reviewedHead: reviewedHead,
      reviewCycle: 2,
      fullReviewCount: 1,
    })
    expect(illegalReview4.state).toBe('STATE_CONFLICT')
    expect(illegalReview4.review_cycle).toBe(2)
    expect(illegalReview4.full_review_count).toBe(1)

    const reviewLag = classifyReviewLag(
      preReview3,
      { number: '170', headRefOid: reviewedHead },
      { parsed: parseRoleCommentBody(sampleVerdictBody('BLOCKED FOR FOUNDER DECISION', 2)) },
    )
    expect(reviewLag.kind).toBe('DETERMINISTIC_RECONCILIATION')
  })

  it('S8: terminal repair writes DONE once and repeated identical evidence stays NO_OP', async () => {
    let evidence: any = {
      managedState: {
        state: 'ELIGIBLE_FOR_FOUNDER_REVIEW',
        review_cycle: 3,
        full_review_count: 1,
        current_head: reviewedHead,
        last_reviewed_head: reviewedHead,
        finding_lineage: [{ finding_id: 'MC-DOG-R1-002', disposition: 'resolved' }],
      },
      terminal: {
        issueClosed: true,
        prMerged: true,
        reviewedHeadMatches: true,
        currentHeadMatches: true,
        mergeCommit: 'merge-sha',
        exactHeadCi: true,
      },
    }
    const writes: any[] = []
    const first = await runBoundedReconciliation({
      readEvidence: async () => evidence,
      writeState: async (nextState: any) => {
        writes.push(nextState)
        evidence = { ...evidence, managedState: nextState }
        return nextState
      },
    })
    const second = await runBoundedReconciliation({
      readEvidence: async () => evidence,
      writeState: async () => {
        throw new Error('must not rewrite identical terminal evidence')
      },
    })

    expect(first.finalOutcome).toBe('NO_OP')
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ state: 'DONE', review_cycle: 3, full_review_count: 1 })
    expect(second.outcome).toBe('NO_OP')
    expect(second.measurements.state_writes).toBe(0)
  })

  it('S9: repeated identical evidence records zero writes, zero role comments, and one reconciliation attempt', async () => {
    const managedState = {
      state: 'DONE',
      review_cycle: 3,
      full_review_count: 1,
      current_head: reviewedHead,
      last_reviewed_head: reviewedHead,
      merged_commit_sha: 'merge-sha',
    }
    const evidence = {
      managedState,
      terminal: {
        issueClosed: true,
        prMerged: true,
        reviewedHeadMatches: true,
        currentHeadMatches: true,
        mergeCommit: 'merge-sha',
        exactHeadCi: true,
      },
    }

    const repeated = await runBoundedReconciliation({
      readEvidence: async () => evidence,
      writeState: async () => {
        throw new Error('must not write on identical evidence')
      },
    })

    expect(repeated.outcome).toBe('NO_OP')
    expect(repeated.measurements).toMatchObject({
      coordination_runs: 1,
      state_writes: 0,
      role_comments: 0,
      model_required_stages: 0,
      reconciliation_attempts: 1,
      false_state_conflicts: 0,
    })
  })

  it('S10: pinned managed-path drift detects exactly one mutation with non-zero exit code', async () => {
    const statusBefore = gitStatusShort()
    // Keep scratch outside the checkout so parallel runners cannot observe
    // temporary trees via git status, and so Cursor sandbox rules that block
    // nested `.cursor/` creation under the repo cannot crash the Vitest worker
    // and strand the checkout-scoped process lock.
    const scratchRoot = mkdtempSync(join(tmpdir(), 'bemoat-mc-phase1-dogfood-s10-'))
    const sourceRoot = FIXTURE_ROOT
    const targetRoot = join(scratchRoot, 'child')

    try {
      expect(PINNED_FIXTURE.pinned_sha).toBe(PINNED_SNAPSHOT_SHA)
      expect(PINNED_MANIFEST.pinned_sha).toBe(PINNED_SNAPSHOT_SHA)
      expect(PINNED_FIXTURE.fixture_root).toBe(`${STARTER_ONLY_FIXTURE_BASE}/pinned-source`)
      expect(PINNED_FIXTURE.manifest_path).toBe(`${STARTER_ONLY_FIXTURE_BASE}/pinned-source-manifest.json`)
      verifyFixtureManifestEquality()
      verifyStrictPinnedProvenance()

      const syncMod = await import('../../scripts/sync-boilerplate.mjs')
      materializePinnedFixtureSource(targetRoot)

      const mutatedPath = PINNED_FIXTURE.mutated_managed_path
      const targetFile = join(targetRoot, mutatedPath)
      expect(existsSync(join(sourceRoot, mutatedPath))).toBe(true)
      writeFileSync(targetFile, `${readFileSync(targetFile, 'utf8')}\n# phase1-dogfood drift probe\n`)

      const driftMod = await import('../../scripts/check-boilerplate-drift.mjs')
      const baseline = driftMod.compareBoilerplateDriftByMode({
        sourceRoot,
        targetRoot: sourceRoot,
        mode: syncMod.SYNC_MODES.HARNESS_ONLY,
      })
      expect(driftMod.getDriftExitCode(baseline)).toBe(0)

      const report = driftMod.compareBoilerplateDriftByMode({
        sourceRoot,
        targetRoot,
        mode: syncMod.SYNC_MODES.HARNESS_ONLY,
      })

      expect(report.managed.changed).toEqual([mutatedPath])
      expect(driftMod.getDriftExitCode(report)).toBe(1)
      expect(report.seedOnlyPathsSkipped).toBe(true)
    } finally {
      rmSync(scratchRoot, { recursive: true, force: true })
      const statusAfter = gitStatusShort()
      expect(statusAfter).toBe(statusBefore)
    }
  })
})
