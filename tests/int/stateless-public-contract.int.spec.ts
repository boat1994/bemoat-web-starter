import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { COMMAND_CONTRACT_REGISTRY } from '../../scripts/cli/command-contract-registry.ts'

const ROOT = process.cwd()
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8')

const CURRENT_DOCS = [
  'docs/mission-control/README.md',
  'docs/mission-control/command-reference.md',
  'docs/mission-control/handoff-template.md',
  'docs/mission-control/mission-control-guide.md',
  'prompts/mission-control/chatgpt-project-loader.md',
] as const

describe('stateless public coordination contract', () => {
  it('exposes exactly Context and Handoff as the cross-agent protocol', () => {
    const commands = Object.values(COMMAND_CONTRACT_REGISTRY.commands) as Array<{ command: string }>
    expect(commands.filter(({ command }) => (
      command === 'bemoat:context' ||
      command === 'bemoat:handoff' ||
      command.startsWith('bemoat:mission-control:')
    )).map(({ command }) => command).sort()).toEqual([
      'bemoat:context',
      'bemoat:handoff',
    ])
  })

  it('keeps the policy source and retained documents available', () => {
    for (const path of CURRENT_DOCS) {
      expect(existsSync(resolve(ROOT, path)), path).toBe(true)
      const content = read(path)
      expect(content, path).toContain('bemoat:context')
      expect(content, path).toContain('bemoat:handoff')
    }

    const guide = read('docs/mission-control/mission-control-guide.md')
    expect(guide).toMatch(/^policy_id: bemoat-mission-control$/m)
    expect(guide).toMatch(/^version: 1\.3\.0$/m)
    expect(guide).toContain('STANDARD')
    expect(guide).toContain('Delta Review')
    expect(guide).toContain('FOUNDER_GATE')
    expect(guide).toContain('BLOCKED_EXTERNAL')
    expect(guide.toLowerCase()).toContain('historical')
  })

  it('keeps handoff publication bound to one strict JSON record', () => {
    const docs = CURRENT_DOCS.map(read).join('\\n')
    expect(docs).toContain('--body-file <strict-handoff.json>')
    expect(read('docs/mission-control/handoff-template.md')).toMatch(
      /exactly one strict JSON HANDOFF object/i,
    )
  })

  it('does not assign current gate authority to the retired controller', () => {
    const contract = read('docs/agent-loop/role-handoff-contract.md')
    expect(contract).not.toMatch(
      /Mission Control[^.\n]*(?:audit|compare|reconcile|verify)/i,
    )
    expect(contract).toMatch(/independent reviewer verifies\s+the exact candidate head/)
    expect(contract).toMatch(/agent preparing the gate compares every\s+source-Issue acceptance criterion/)
    expect(contract).toContain('The Founder makes the final decision.')
  })

})
