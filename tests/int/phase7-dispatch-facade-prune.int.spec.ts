import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { COMMAND_CONTRACT_REGISTRY } from '../../scripts/cli/command-contract-registry.mjs'
import { ALL_MUTATING_COMMANDS, missionControlPrimaryRoutes } from '../../scripts/cli/mission-control-routing-policy-primary.mjs'
import { CANONICAL_TRANSPORTS } from '../../scripts/mission-control/transport-registry.mjs'

const ROOT = process.cwd()
const DISPATCH = 'bemoat:mission-control:dispatch'

function packageScripts(): Record<string, string> {
  return JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).scripts
}

describe('Phase 7 dispatch facade deletion boundary', () => {
  it('removes the legacy dispatch command and exclusive runtime leaves while retaining stateless protocol commands', () => {
    const scripts = packageScripts()
    const routes = missionControlPrimaryRoutes()

    expect(scripts[DISPATCH]).toBeUndefined()
    expect(COMMAND_CONTRACT_REGISTRY.commands[DISPATCH]).toBeUndefined()
    expect(ALL_MUTATING_COMMANDS).not.toContain(DISPATCH)
    expect(CANONICAL_TRANSPORTS.map((transport) => transport.command)).not.toContain(DISPATCH)
    expect(routes.flatMap((route) => [route.canonical_command, ...route.prohibited_commands])).not.toContain(DISPATCH)

    for (const path of [
      'scripts/mission-control-dispatch.mjs',
      'scripts/mission-control/workflows/dispatch.mjs',
      'scripts/mission-control/domain/dispatch-result-rendering.ts',
      'scripts/mission-control/managed-task-dispatch.mjs',
    ]) expect(existsSync(resolve(ROOT, path)), path).toBe(false)
    expect(existsSync(resolve(ROOT, 'scripts/mission-control/founder-correction-dispatch.mjs'))).toBe(true)

    expect(scripts['bemoat:context']).toBe('node scripts/agent-context.mjs')
    expect(scripts['bemoat:handoff']).toBe('node scripts/agent-handoff.mjs')
  })
})
