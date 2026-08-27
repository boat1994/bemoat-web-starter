import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { COMMAND_CONTRACT_REGISTRY } from '../../scripts/cli/command-contract-registry.mjs'
import { CANONICAL_TRANSPORTS } from '../../scripts/mission-control/transport-registry.mjs'

const ROOT = process.cwd()
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8')

const SUPPORTED_PROTOCOL_COMMANDS = [
  'bemoat:context',
  'bemoat:handoff',
] as const

const MIGRATION_ONLY_COMMANDS = [
  'bemoat:agent:delivery',
  'bemoat:agent:issue',
  'bemoat:issue:comment',
  'bemoat:mission-control:adopt-finding',
  'bemoat:mission-control:authorize-founder',
  'bemoat:mission-control:dispatch',
  'bemoat:mission-control:merge',
  'bemoat:mission-control:merge-standard',
  'bemoat:mission-control:reconcile',
  'bemoat:mission-control:recover-review',
  'bemoat:mission-control:recover-review-eligibility',
  'bemoat:mission-control:recover-state',
  'bemoat:mission-control:reopen',
  'bemoat:mission-control:review',
  'bemoat:mission-control:task-bootstrap',
] as const

const MIGRATION_ONLY_TRANSPORT_COMMANDS = [
  'bemoat:agent:delivery',
  'bemoat:mission-control:adopt-finding',
  'bemoat:mission-control:authorize-founder',
  'bemoat:mission-control:dispatch',
  'bemoat:mission-control:merge',
  'bemoat:mission-control:merge-standard',
  'bemoat:mission-control:reconcile',
  'bemoat:mission-control:recover-review',
  'bemoat:mission-control:recover-review-eligibility',
  'bemoat:mission-control:recover-state',
  'bemoat:mission-control:reopen',
  'bemoat:mission-control:review',
] as const

const isCrossAgentProtocolCandidate = (command: string) => (
  command === 'bemoat:context' ||
  command === 'bemoat:handoff' ||
  command.startsWith('bemoat:agent:') ||
  command === 'bemoat:issue:comment' ||
  command.startsWith('bemoat:mission-control:')
)

describe('stateless public Mission Control contract', () => {
  it('declares exactly context and handoff as the supported cross-agent protocol', () => {
    const commands = Object.values(COMMAND_CONTRACT_REGISTRY.commands) as Array<{
      command: string
      purpose: string
      operation: string
    }>
    const protocolCandidates = commands.filter((contract) => isCrossAgentProtocolCandidate(contract.command))
    const supportedProtocol = protocolCandidates
      .filter((contract) => !String(contract.purpose).startsWith('MIGRATION-ONLY HISTORICAL:'))
      .map((contract) => contract.command)

    expect(supportedProtocol).toEqual([...SUPPORTED_PROTOCOL_COMMANDS])
    expect(protocolCandidates.map((contract) => contract.command).sort()).toEqual(
      [...SUPPORTED_PROTOCOL_COMMANDS, ...MIGRATION_ONLY_COMMANDS].sort(),
    )
    for (const contract of protocolCandidates) {
      if ((SUPPORTED_PROTOCOL_COMMANDS as readonly string[]).includes(contract.command)) {
        expect(contract.purpose, contract.command).not.toMatch(/^MIGRATION-ONLY HISTORICAL:/)
        continue
      }
      expect(contract.purpose, contract.command).toMatch(/^MIGRATION-ONLY HISTORICAL:/)
      expect(contract.operation, contract.command).toMatch(/^MIGRATION-ONLY HISTORICAL:/)
    }
  })

  it('marks every retained stateful transport as migration-only without removing its registry record', () => {
    const transports = CANONICAL_TRANSPORTS as ReadonlyArray<{
      command: string
      purpose: string
    }>
    expect(transports.map((transport) => transport.command)).toEqual(
      expect.arrayContaining([...MIGRATION_ONLY_TRANSPORT_COMMANDS]),
    )
    expect(transports).toHaveLength(MIGRATION_ONLY_TRANSPORT_COMMANDS.length)
    for (const transport of transports) {
      expect(MIGRATION_ONLY_TRANSPORT_COMMANDS).toContain(transport.command)
      expect(transport.purpose, transport.command).toMatch(/^MIGRATION-ONLY HISTORICAL:/)
    }
  })

  it('keeps the canonical guide boundary explicit and excludes legacy commands from it', () => {
    const guide = read('docs/mission-control/mission-control-guide.md')
    const currentSection = guide.match(
      /## Current supported stateless protocol([\s\S]*?)(?=\n## )/,
    )?.[1] ?? ''

    expect(currentSection).toContain('bemoat:context')
    expect(currentSection).toContain('bemoat:handoff')
    expect(currentSection).toContain('exactly two public protocol commands')
    for (const command of MIGRATION_ONLY_COMMANDS) {
      expect(currentSection, command).not.toContain(command)
    }
  })

  it('labels the architecture and command reference as current protocol plus historical compatibility', () => {
    expect(read('docs/mission-control/architecture-blueprint.md')).toMatch(
      /Current supported protocol[\s\S]*bemoat:context[\s\S]*bemoat:handoff[\s\S]*Phase 7/i,
    )
    expect(read('docs/mission-control/command-reference.md')).toMatch(
      /historical migration-only[\s\S]*bemoat:agent:delivery/i,
    )
  })
})
