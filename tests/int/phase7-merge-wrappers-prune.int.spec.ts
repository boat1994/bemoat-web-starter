import { spawnSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

import { COMMAND_CONTRACT_REGISTRY } from '../../scripts/cli/command-contract-registry.mjs'
import { missionControlRecoveryRoutes } from '../../scripts/cli/mission-control-routing-policy-recovery.mjs'
import { classifyMergeReviewVerdict } from '../../scripts/context/merge-review-verdict.ts'

const DELETED_MERGE_COMMANDS = [
  'bemoat:mission-control:merge',
  'bemoat:mission-control:merge-standard',
] as const

describe('Phase 7 merge-wrapper deletion boundary', () => {
  it.each(DELETED_MERGE_COMMANDS)('does not expose %s as a pnpm script', (command) => {
    const result = spawnSync('pnpm', ['run', command, '--', '--help', '--json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}\n${result.stderr}`).toContain('ERR_PNPM_NO_SCRIPT')
  })

  it('does not register or route either deleted merge wrapper', () => {
    const routes = [...missionControlRecoveryRoutes()]
    const routedCommands = routes.flatMap((route) => [
      route.canonical_command,
      ...route.prohibited_commands,
    ])

    for (const command of DELETED_MERGE_COMMANDS) {
      expect(COMMAND_CONTRACT_REGISTRY.commands[command]).toBeUndefined()
      expect(routedCommands).not.toContain(command)
    }
  })

  it('retains migration readers still consumed by Context and Handoff', () => {
    expect(classifyMergeReviewVerdict).toBeTypeOf('function')
    expect(COMMAND_CONTRACT_REGISTRY.commands['bemoat:context']).toBeDefined()
    expect(COMMAND_CONTRACT_REGISTRY.commands['bemoat:handoff']).toBeDefined()
  })
})
