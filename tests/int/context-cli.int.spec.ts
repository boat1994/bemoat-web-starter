import { describe, expect, it } from 'vitest'

import { runCliBoundaryCase } from '../helpers/cli-boundary-harness'
import { getCommandContract } from '../../scripts/cli/command-contract.ts'

describe('bemoat:context public CLI contract', () => {
  it('characterizes the future TypeScript help boundary as machine-readable and mutation-free', () => {
    const result = runCliBoundaryCase({
      entrypoint: 'scripts/agent-context.ts',
      argv: ['--help', '--json'],
      env: { BEMOAT_FACADE_COMMAND: 'bemoat:context', BEMOAT_FACADE_ENTRYPOINT: 'scripts/agent-context.ts', npm_lifecycle_event: 'bemoat:context' },
    })

    expect(result.error).toBeNull()
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toMatchObject({ command: 'bemoat:context', mode: 'help', classification: 'HELP' })
    expect(result.filesystem_unchanged).toBe(true)
  })

  it('characterizes the future TypeScript invalid invocation exit and stream boundary', () => {
    const result = runCliBoundaryCase({
      entrypoint: 'scripts/agent-context.ts',
      argv: ['--definitely-invalid'],
      env: { BEMOAT_FACADE_COMMAND: 'bemoat:context', BEMOAT_FACADE_ENTRYPOINT: 'scripts/agent-context.ts', npm_lifecycle_event: 'bemoat:context' },
    })

    expect(result.error).toBeNull()
    expect(result.status).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toMatch(/INVALID_INVOCATION:/)
    expect(result.filesystem_unchanged).toBe(true)
    expect(result.poison_invocations).toEqual([])
  })

  it.each([
    ['npm_lifecycle_event', { npm_lifecycle_event: 'bemoat:other' }],
  ])('rejects %s identity mismatch at the executable root', (_identity, mismatch) => {
    const result = runCliBoundaryCase({ entrypoint: 'scripts/agent-handoff.ts', argv: ['--help'], env: {
      BEMOAT_FACADE_COMMAND: 'bemoat:handoff', BEMOAT_FACADE_ENTRYPOINT: 'scripts/agent-handoff.ts', ...mismatch,
    } })
    expect(result.status).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toMatch(/INVALID_INVOCATION:/)
  })

  it('registers a read-only Tier B command with deterministic help metadata', () => {
    const contract = getCommandContract('bemoat:context')

    expect(contract).not.toBeNull()
    expect(contract).toMatchObject({
      command: 'bemoat:context',
      tier: 'B',
      entrypoint: 'scripts/agent-context.ts',
      writes: [],
      help_meaningful: true,
      safe_help_invocation: 'pnpm run bemoat:context -- --help --json',
    })
  })

  it('provides machine-readable mutation-free help', () => {
    const result = runCliBoundaryCase({
      entrypoint: 'scripts/agent-context.ts',
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
      entrypoint: 'scripts/agent-context.ts',
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
