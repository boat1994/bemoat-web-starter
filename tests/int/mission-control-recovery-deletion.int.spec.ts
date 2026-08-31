import { readFileSync } from 'node:fs'

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
      'bemoat:agent:issue',
      'bemoat:issue:comment',
      'bemoat:mission-control:authorize-founder',
    ]) {
      expect(packageJson.scripts[command]).toEqual(expect.any(String))
      expect(COMMAND_CONTRACT_REGISTRY.commands[command]).toBeDefined()
    }
  })
})
