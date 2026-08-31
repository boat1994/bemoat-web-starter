import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { managedPackageScripts } from '../../scripts/boilerplate/inventory.mjs'
import { COMMAND_CONTRACT_REGISTRY } from '../../scripts/cli/command-contract-registry.mjs'
import { CANONICAL_TRANSPORTS } from '../../scripts/mission-control/transport-registry.mjs'

const TASK_BOOTSTRAP_COMMAND = 'bemoat:mission-control:task-bootstrap'
const FOUNDER_AUTHORIZATION_COMMAND = 'bemoat:mission-control:authorize-founder'

const EXCLUSIVE_TASK_BOOTSTRAP_FILES = [
  '.github/workflows/mission-control-task-bootstrap.yml',
  '.bemoat/mission-control/task-bootstrap-public-key.pem',
  'scripts/mission-control-task-create.mjs',
  'scripts/mission-control/workflows/task-bootstrap.mjs',
  'scripts/mission-control/domain/task-bootstrap-allocation.ts',
  'scripts/mission-control/domain/task-bootstrap-final-readback.mjs',
  'scripts/mission-control/domain/task-bootstrap-final-readback.ts',
  'scripts/mission-control/domain/task-bootstrap-preflight.ts',
  'scripts/mission-control/domain/task-bootstrap-registry-readback.mjs',
  'scripts/mission-control/domain/task-bootstrap-registry-readback.ts',
  'scripts/mission-control/domain/task-bootstrap-request.ts',
  'scripts/mission-control/domain/task-bootstrap-state.ts',
  'scripts/mission-control/domain/task-attestation.mjs',
  'scripts/mission-control/domain/task-attestation.ts',
  'scripts/mission-control/domain/task-ownership-registry.mjs',
  'scripts/mission-control/domain/task-ownership-registry.ts',
] as const

const EXCLUSIVE_FOUNDER_AUTHORIZATION_FILES = [
  'scripts/mission-control-authorize-founder.mjs',
  'scripts/mission-control/workflows/authorize-founder.mjs',
  'scripts/mission-control/domain/founder-authorization-history.ts',
  'scripts/mission-control/domain/founder-authorization-recording.ts',
  'scripts/mission-control/domain/founder-authorization-receipt.ts',
  'scripts/mission-control/domain/founder-merge-authorization-recording.ts',
  'scripts/mission-control/domain/founder-merge-authorization-receipt.ts',
  'scripts/mission-control/domain/merge-founder-authority.ts',
  'scripts/mission-control/domain/task-bootstrap-authorization.ts',
] as const

const ORPHANED_STATEFUL_FILES = [
  'scripts/mission-control/adapters/task-bootstrap-github.mjs',
  'scripts/mission-control/domain/task-bootstrap-lease.ts',
  'scripts/mission-control/workflows/issue-body-cas.mjs',
  'scripts/mission-control/workflows/campaign-projection.mjs',
  'scripts/mission-control/domain/campaign-renderer.ts',
  'scripts/mission-control/domain/adopt-finding-projection.mjs',
  'scripts/mission-control/domain/adopt-finding-projection.ts',
  'scripts/mission-control/adapters/merge-github.mjs',
  'scripts/mission-control/domain/github-comment-identity.ts',
  'scripts/mission-control/domain/merge-issue-references.ts',
  'scripts/mission-control/domain/correction-handoff-binding.mjs',
] as const

const RETAINED_TASK_STATE_EXPORTS = [
  'MISSION_CONTROL_STATES',
  'MISSION_CONTROL_WORKFLOW_MODES',
  'normalizeWorkflowMode',
  'normalizePlanningAuthorizationBaseSha',
  'populateOrPreservePlanningAuthorizationBaseSha',
  'parseMissionControlState',
] as const

const REMOVED_TASK_STATE_WRITERS = [
  'renderMissionControlState',
  'projectMissionControlStateBlock',
  'appendMissingMissionControlStateBlock',
] as const

const RETIRED_MERGE_AUTHORIZATION_TEST = 'tests/int/mission-control-merge-authorization-recording.int.spec.ts'
const OBSOLETE_ACTIVE_DOCUMENTATION = [
  'Terminal state projection only',
  'Exceptional missing-state recovery (validation or one leased/CAS projection)',
] as const

describe('retired Task Bootstrap and Founder authorization public boundaries', () => {
  it('removes the public command and exclusive implementation surfaces while retaining shared protocol commands', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }

    expect(packageJson.scripts[TASK_BOOTSTRAP_COMMAND]).toBeUndefined()
    expect(COMMAND_CONTRACT_REGISTRY.commands[TASK_BOOTSTRAP_COMMAND]).toBeUndefined()
    expect(CANONICAL_TRANSPORTS.map((transport) => transport.command)).not.toContain(TASK_BOOTSTRAP_COMMAND)
    expect(managedPackageScripts).not.toContain(TASK_BOOTSTRAP_COMMAND)

    for (const path of EXCLUSIVE_TASK_BOOTSTRAP_FILES) expect(existsSync(path), path).toBe(false)

    expect(packageJson.scripts[FOUNDER_AUTHORIZATION_COMMAND]).toBeUndefined()
    expect(COMMAND_CONTRACT_REGISTRY.commands[FOUNDER_AUTHORIZATION_COMMAND]).toBeUndefined()
    expect(CANONICAL_TRANSPORTS.map((transport) => transport.command)).not.toContain(FOUNDER_AUTHORIZATION_COMMAND)
    expect(managedPackageScripts).not.toContain(FOUNDER_AUTHORIZATION_COMMAND)

    for (const path of EXCLUSIVE_FOUNDER_AUTHORIZATION_FILES) expect(existsSync(path), path).toBe(false)
    for (const path of ORPHANED_STATEFUL_FILES) expect(existsSync(path), path).toBe(false)

    for (const command of ['bemoat:context', 'bemoat:handoff']) {
      expect(packageJson.scripts[command], command).toEqual(expect.any(String))
      expect(COMMAND_CONTRACT_REGISTRY.commands[command], command).toBeDefined()
    }

    expect(existsSync('scripts/mission-control/adapters/github-transport.mjs')).toBe(true)
    expect(existsSync('scripts/mission-control/domain/task-state.ts')).toBe(true)
  })

  it('retains only the read-only task-state seam needed by live consumers', async () => {
    const taskState = await import('../../scripts/mission-control/domain/task-state.ts') as Record<string, unknown>

    for (const name of RETAINED_TASK_STATE_EXPORTS) {
      expect(taskState[name], `${name} must remain available`).toBeDefined()
    }
    for (const name of REMOVED_TASK_STATE_WRITERS) {
      expect(taskState[name], `${name} must be retired`).toBeUndefined()
    }
  })

  it('does not advertise the retired public command from active metadata or architecture inventory', () => {
    const activeSources = [
      'scripts/architecture-contract.json',
      'scripts/boilerplate/inventory.mjs',
      'scripts/cli/mission-control-command-metadata-review.ts',
      'scripts/cli/mission-control-routing-policy-primary.ts',
      'scripts/structural-protection-manifest.json',
    ]

    for (const path of activeSources) {
      expect(readFileSync(path, 'utf8'), path).not.toContain(TASK_BOOTSTRAP_COMMAND)
      expect(readFileSync(path, 'utf8'), path).not.toContain(FOUNDER_AUTHORIZATION_COMMAND)
    }
  })

  it('does not retain stale retired tests or obsolete active documentation', () => {
    for (const path of ['scripts/boilerplate/inventory.mjs', '.bemoat/boilerplate-sync-manifest.json']) {
      expect(readFileSync(path, 'utf8'), path).not.toContain(RETIRED_MERGE_AUTHORIZATION_TEST)
    }

    const readme = readFileSync('docs/mission-control/README.md', 'utf8')
    for (const phrase of OBSOLETE_ACTIVE_DOCUMENTATION) {
      expect(readme, phrase).not.toContain(phrase)
    }
  })
})
