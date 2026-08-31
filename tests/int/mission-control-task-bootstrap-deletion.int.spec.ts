import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { managedPackageScripts } from '../../scripts/boilerplate/inventory.mjs'
import { COMMAND_CONTRACT_REGISTRY } from '../../scripts/cli/command-contract-registry.mjs'
import { CANONICAL_TRANSPORTS } from '../../scripts/mission-control/transport-registry.mjs'

const TASK_BOOTSTRAP_COMMAND = 'bemoat:mission-control:task-bootstrap'

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

describe('retired Task Bootstrap public boundary', () => {
  it('removes the public command and exclusive implementation surfaces while retaining shared protocol commands', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }

    expect(packageJson.scripts[TASK_BOOTSTRAP_COMMAND]).toBeUndefined()
    expect(COMMAND_CONTRACT_REGISTRY.commands[TASK_BOOTSTRAP_COMMAND]).toBeUndefined()
    expect(CANONICAL_TRANSPORTS.map((transport) => transport.command)).not.toContain(TASK_BOOTSTRAP_COMMAND)
    expect(managedPackageScripts).not.toContain(TASK_BOOTSTRAP_COMMAND)

    for (const path of EXCLUSIVE_TASK_BOOTSTRAP_FILES) expect(existsSync(path), path).toBe(false)

    for (const command of ['bemoat:context', 'bemoat:handoff', 'bemoat:mission-control:authorize-founder']) {
      expect(packageJson.scripts[command], command).toEqual(expect.any(String))
      expect(COMMAND_CONTRACT_REGISTRY.commands[command], command).toBeDefined()
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
    }
  })
})
