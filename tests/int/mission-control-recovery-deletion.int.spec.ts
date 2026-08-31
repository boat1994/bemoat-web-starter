import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'
import { COMMAND_CONTRACT_REGISTRY } from '../../scripts/cli/command-contract-registry.mjs'
import { managedPackageScripts } from '../../scripts/boilerplate/inventory.mjs'
import { CANONICAL_TRANSPORTS } from '../../scripts/mission-control/transport-registry.mjs'

const RECOVERY_COMMANDS = [
  'bemoat:mission-control:reconcile',
  'bemoat:mission-control:recover-state',
  'bemoat:mission-control:recover-review-eligibility',
  'bemoat:mission-control:reopen',
  'bemoat:mission-control:adopt-finding',
] as const

const RETIRED_ROLE_COMMENT_COMMAND = 'bemoat:issue:comment'
const RETIRED_ROLE_COMMENT_FILES = [
  'scripts/post-role-comment.mjs',
  'scripts/mission-control/workflows/post-role-comment.mjs',
  'scripts/mission-control/domain/role-comment-rendering.ts',
  'scripts/mission-control/diagnostics/github-comment-projection.mjs',
  'scripts/mission-control/role-comment-selection.mjs',
  'scripts/mission-control/adapters/git-transport.mjs',
  'scripts/mission-control/adapters/github-transport.mjs',
] as const

describe('retired recovery command boundary', () => {
  it('removes retired commands from executable package, registry, transport, and inventory surfaces', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }
    const transportCommands = CANONICAL_TRANSPORTS.map((route) => route.command)

    for (const command of RECOVERY_COMMANDS) {
      expect(packageJson.scripts[command]).toBeUndefined()
      expect(COMMAND_CONTRACT_REGISTRY.commands[command]).toBeUndefined()
      expect(transportCommands).not.toContain(command)
      expect(managedPackageScripts).not.toContain(command)
    }
  })

  it('keeps retained public commands registered and executable', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }
    for (const command of [
      'bemoat:context',
      'bemoat:handoff',
    ]) {
      expect(packageJson.scripts[command]).toEqual(expect.any(String))
      expect(COMMAND_CONTRACT_REGISTRY.commands[command]).toBeDefined()
    }
  })

  it('retires the legacy Role-Comment writer while retaining the Handoff boundary', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }
    const transportCommands = CANONICAL_TRANSPORTS.map((route) => route.command)

    expect(packageJson.scripts[RETIRED_ROLE_COMMENT_COMMAND]).toBeUndefined()
    expect(COMMAND_CONTRACT_REGISTRY.commands[RETIRED_ROLE_COMMENT_COMMAND]).toBeUndefined()
    expect(transportCommands).not.toContain(RETIRED_ROLE_COMMENT_COMMAND)
    expect(managedPackageScripts).not.toContain(RETIRED_ROLE_COMMENT_COMMAND)
    for (const path of RETIRED_ROLE_COMMENT_FILES) expect(existsSync(path), path).toBe(false)

    expect(packageJson.scripts['bemoat:handoff']).toEqual(expect.any(String))
    expect(COMMAND_CONTRACT_REGISTRY.commands['bemoat:handoff']).toBeDefined()
    expect(existsSync('scripts/agent-handoff.mjs')).toBe(true)
    expect(existsSync('scripts/handoff/schema.ts')).toBe(true)
    expect(existsSync('scripts/handoff/workflow.ts')).toBe(true)
  })
})
