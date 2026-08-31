import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { COMMAND_CONTRACT_REGISTRY } from '../../scripts/cli/command-contract-registry.mjs'

const ROOT = process.cwd()

function packageScripts(): Record<string, string> {
  return JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).scripts
}

describe('Phase 7 delivery facade deletion boundary', () => {
  it('removes the obsolete delivery coordinator from public command surfaces while retaining stateless protocol commands', () => {
    const scripts = packageScripts()

    expect(scripts['bemoat:agent:delivery']).toBeUndefined()
    expect(COMMAND_CONTRACT_REGISTRY.commands['bemoat:agent:delivery']).toBeUndefined()
    expect(existsSync(resolve(ROOT, 'scripts/agent-delivery.mjs'))).toBe(false)
    expect(existsSync(resolve(ROOT, 'scripts/mission-control/workflows/agent-delivery.mjs'))).toBe(false)

    expect(scripts['bemoat:context']).toBe('node scripts/agent-context.mjs')
    expect(scripts['bemoat:handoff']).toBe('node scripts/agent-handoff.mjs')
  })
})
