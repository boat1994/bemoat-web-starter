import { describe, expect, it } from 'vitest'

import { runCliBoundaryCase } from '../helpers/cli-boundary-harness'
import { getCommandContract } from '../../scripts/cli/command-contract.mjs'

describe('bemoat:context public CLI contract', () => {
  it('registers a read-only Tier B command with deterministic help metadata', () => {
    const contract = getCommandContract('bemoat:context')

    expect(contract).not.toBeNull()
    expect(contract).toMatchObject({
      command: 'bemoat:context',
      tier: 'B',
      entrypoint: 'scripts/agent-context.mjs',
      writes: [],
      help_meaningful: true,
      safe_help_invocation: 'pnpm run bemoat:context -- --help --json',
    })
  })

  it('provides machine-readable mutation-free help', () => {
    const result = runCliBoundaryCase({
      entrypoint: 'scripts/agent-context.mjs',
      argv: ['--help', '--json'],
    })

    expect(result.error).toBeNull()
    expect(result.status).toBe(0)
    expect(result.filesystem_unchanged).toBe(true)
    expect(result.poison_invocations).toEqual([])
    expect(JSON.parse(result.stdout)).toMatchObject({
      schema_version: 1,
      command: 'bemoat:context',
      mode: 'help',
      classification: 'HELP',
      result_classifications: expect.arrayContaining(['SUCCESS', 'EVIDENCE_CONFLICT']),
    })
  })

  it('returns a deterministic STOP context without writing local protocol state when reads fail', () => {
    const result = runCliBoundaryCase({
      entrypoint: 'scripts/agent-context.mjs',
      argv: ['410', '--json'],
    })

    expect(result.error).toBeNull()
    expect(result.status).toBe(0)
    const before = Object.fromEntries(
      Object.entries(result.before).filter(([path]) => path !== 'poison-calls.log'),
    )
    const after = Object.fromEntries(
      Object.entries(result.after).filter(([path]) => path !== 'poison-calls.log'),
    )
    expect(after).toEqual(before)
    expect(result.poison_invocations.some((line) => line.includes('comment') || line.includes('commit') || line.includes('push') || line.includes('reset') || line.includes('switch'))).toBe(false)
    expect(JSON.parse(result.stdout)).toMatchObject({
      route: 'STOP',
      mutation_performed: false,
    })
  })
})
