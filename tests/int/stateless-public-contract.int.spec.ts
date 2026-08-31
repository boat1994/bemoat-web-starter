import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { COMMAND_CONTRACT_REGISTRY } from '../../scripts/cli/command-contract-registry.mjs'
import { CANONICAL_TRANSPORTS } from '../../scripts/mission-control/transport-registry.mjs'

const ROOT = process.cwd()
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8')

const CURRENT_AGENT_LOOP_WORKFLOW_DOCS = [
  'docs/agent-loop/checklist.md',
  'docs/agent-loop/project-progress-tracking.md',
] as const

const CURRENT_EXECUTABLE_HANDOFF_DOCS = [
  'AGENTS.md',
  'docs/agent-loop/role-handoff-contract.md',
  'docs/mission-control/README.md',
  'docs/mission-control/architecture-blueprint.md',
  'docs/mission-control/command-reference.md',
  'docs/mission-control/handoff-template.md',
  'docs/mission-control/mission-control-guide.md',
] as const

function withoutHistoricalMarkdownSections(content: string): string {
  const currentLines: string[] = []
  let historicalLevel: number | null = null

  for (const line of content.split('\n')) {
    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      const level = heading[1].length
      if (historicalLevel !== null && level <= historicalLevel) historicalLevel = null
      if (/historical|migration-only/i.test(heading[2])) historicalLevel = level
    }
    if (historicalLevel === null) currentLines.push(line)
  }

  return currentLines.join('\n')
}

function executableHandoffInvocations(content: string): string[] {
  return content
    .split('\n')
    .map((line) => line.match(/pnpm run bemoat:handoff [^`]*/)?.[0]?.trim() ?? '')
    .filter((line) => line !== '' && !line.includes('--help'))
}

const SUPPORTED_PROTOCOL_COMMANDS = [
  'bemoat:context',
  'bemoat:handoff',
] as const

const MIGRATION_ONLY_COMMANDS = [
  'bemoat:agent:issue',
  'bemoat:issue:comment',
  'bemoat:mission-control:authorize-founder',
  'bemoat:mission-control:task-bootstrap',
] as const

const MIGRATION_ONLY_TRANSPORT_COMMANDS = [
  'bemoat:mission-control:authorize-founder',
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

  it('labels the architecture and command reference as current protocol plus retired compatibility', () => {
    expect(read('docs/mission-control/architecture-blueprint.md')).toMatch(
      /Current supported protocol[\s\S]*bemoat:context[\s\S]*bemoat:handoff[\s\S]*Phase 7/i,
    )
    expect(read('docs/mission-control/command-reference.md')).toContain('Retired stateful command families')
    expect(read('docs/mission-control/command-reference.md')).not.toContain('bemoat:agent:delivery')
  })

  it('rejects active managed-state workflow requirements outside an explicit historical boundary', () => {
    const activeManagedStateRequirement = [
      /Mission Control mode:\s*required/i,
      /Mission Control-managed tasks?/i,
      /managed (?:Mission Control )?state is (?:opt-in|required)/i,
      /valid state block/i,
    ]

    for (const path of CURRENT_AGENT_LOOP_WORKFLOW_DOCS) {
      const currentContent = withoutHistoricalMarkdownSections(read(path))
      for (const pattern of activeManagedStateRequirement) {
        expect(currentContent, `${path} contains active managed-state guidance: ${pattern}`).not.toMatch(pattern)
      }
    }
  })

  it('keeps current executable handoff examples consistent with required registry inputs', () => {
    const handoffContract = COMMAND_CONTRACT_REGISTRY.commands['bemoat:handoff'] as {
      required_inputs: Array<{ syntax: string }>
    }
    const requiredSyntax = handoffContract.required_inputs.map((input) => input.syntax.split(' ')[0])

    expect(requiredSyntax).toEqual(['<issue-number>', '--body-file'])
    let executableExampleCount = 0
    for (const path of CURRENT_EXECUTABLE_HANDOFF_DOCS) {
      const invocations = executableHandoffInvocations(withoutHistoricalMarkdownSections(read(path)))
      executableExampleCount += invocations.length
      for (const invocation of invocations) {
        for (const syntax of requiredSyntax) {
          expect(invocation, `${path} contradicts the bemoat:handoff public contract`).toContain(syntax)
        }
      }
    }
    expect(executableExampleCount).toBeGreaterThan(0)
    expect(read('docs/mission-control/handoff-template.md')).toMatch(
      /body file[^\n]*must contain exactly one strict JSON\s+HANDOFF record/i,
    )
  })
})
