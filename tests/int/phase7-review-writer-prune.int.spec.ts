import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { COMMAND_CONTRACT_REGISTRY } from '../../scripts/cli/command-contract-registry.mjs'
import {
  ALL_MUTATING_COMMANDS,
  missionControlPrimaryRoutes,
} from '../../scripts/cli/mission-control-routing-policy-primary.mjs'
import { missionControlRecoveryRoutes } from '../../scripts/cli/mission-control-routing-policy-recovery.mjs'
import { CANONICAL_TRANSPORTS } from '../../scripts/mission-control/transport-registry.mjs'

const ROOT = process.cwd()
const REVIEW = 'bemoat:mission-control:review'

function packageScripts(): Record<string, string> {
  return JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).scripts
}

describe('Phase 7 managed review writer deletion boundary', () => {
  it('removes the public review writer and exclusive runtime leaves without deleting retained migration readers', () => {
    const scripts = packageScripts()
    const routes = [...missionControlPrimaryRoutes(), ...missionControlRecoveryRoutes()]

    expect(scripts[REVIEW]).toBeUndefined()
    expect(COMMAND_CONTRACT_REGISTRY.commands[REVIEW]).toBeUndefined()
    expect(ALL_MUTATING_COMMANDS).not.toContain(REVIEW)
    expect(CANONICAL_TRANSPORTS.map((transport) => transport.command)).not.toContain(REVIEW)
    expect(routes.flatMap((route) => [route.canonical_command, ...route.prohibited_commands])).not.toContain(REVIEW)

    for (const path of [
      'scripts/mission-control-review.mjs',
      'scripts/mission-control/workflows/review.mjs',
      'scripts/mission-control/domain/review-result-rendering.ts',
    ]) expect(existsSync(resolve(ROOT, path)), path).toBe(false)

    for (const path of [
      'scripts/mission-control/review-verdict-binding.mjs',
      'scripts/mission-control/review-verdict-projection.ts',
      'scripts/mission-control/review-verdict-integration-transition.mjs',
      'scripts/mission-control/workflows/recover-review.mjs',
    ]) expect(existsSync(resolve(ROOT, path)), path).toBe(true)

    expect(scripts['bemoat:context']).toBe('node scripts/agent-context.mjs')
    expect(scripts['bemoat:handoff']).toBe('node scripts/agent-handoff.mjs')
  })
})
