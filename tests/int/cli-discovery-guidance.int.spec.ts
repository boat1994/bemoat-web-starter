/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { getCommandContract } from '../../scripts/cli/command-contract.mjs'
import { COMMAND_CONTRACT_REGISTRY } from '../../scripts/cli/command-contract-registry.mjs'
import { managedPaths } from '../../scripts/boilerplate/inventory.mjs'
import { runCliBoundaryCase } from '../helpers/cli-boundary-harness'

const root = process.cwd()
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const normalized = (value: string) => value.replace(/\s+/g, ' ')

const canonicalPath = 'AGENTS.md'
const pointerPaths = [
  '.agents/README.md',
  'docs/agent-loop/README.md',
  'docs/mission-control/mission-control-guide.md',
] as const
const managedGuidancePaths = [canonicalPath, ...pointerPaths]
const representativeCommands = [
  'bemoat:agent:issue',
  'bemoat:mission-control:reconcile',
  'bemoat:mission-control:review',
  'bemoat:mission-control:recover-review',
] as const

describe('Bemoat CLI discovery guidance', () => {
  it('defines the canonical discovery-first and no-bypass contract at the root entrypoint', () => {
    const guidance = read(canonicalPath)
    const semanticGuidance = normalized(guidance)

    expect(guidance).toMatch(/## Bemoat CLI Discovery/)
    expect(guidance).toContain('pnpm run <bemoat-command> -- --help --json')
    for (const requirement of [
      'accepted pre-states',
      'required caller inputs',
      'trusted-derived values',
      'required evidence',
      'mutation behavior',
      'success and stop classifications',
      'retry behavior',
      'next-action routing',
      'CLI_DISCOVERY_DEFECT',
    ]) expect(semanticGuidance).toContain(requirement)

    expect(semanticGuidance).toMatch(/Do not infer.*memory.*prompt examples.*internal implementation source/i)
    expect(semanticGuidance).toMatch(/Raw GitHub reads remain permitted/i)
    expect(semanticGuidance).toMatch(/Raw GitHub mutation is permitted only when no registered Bemoat command owns the operation/i)
    expect(semanticGuidance).toMatch(/resolve the registered command contract first/i)
    expect(semanticGuidance).toMatch(/help_meaningful === true.*safe_help_invocation.*repository-owned.*--help --json/i)
    expect(semanticGuidance).toMatch(/help_meaningful === false.*explicit Tier C delegation boundary.*safe_help_invocation.*do not require.*wrapper.*JSON help/i)
    expect(semanticGuidance).toMatch(/help invocation.*no mutation.*no comment.*no state.*no branch.*issue.*PR/i)
    expect(semanticGuidance).toMatch(/mismatch between runtime behavior and the command's actual registered contract.*CLI_DISCOVERY_DEFECT/i)
    for (const forbiddenImport of [
      'Coordinator',
      'Productive-Only policy helpers',
      'workflow services',
      'adapters',
      'transition functions',
      'parsers',
      'projection helpers',
    ]) expect(semanticGuidance).toContain(forbiddenImport)
  })

  it('links every managed alternate entrypoint to the canonical discovery rule', () => {
    for (const path of pointerPaths) {
      const guidance = read(path)
      expect(guidance, path).toMatch(/Bemoat CLI Discovery/i)
      expect(guidance, path).toMatch(/AGENTS\.md#bemoat-cli-discovery/)
    }
  })

  it('keeps discovery before direct issue-command execution', () => {
    for (const path of [canonicalPath, 'docs/agent-loop/issue-driven-branch-workflow.md']) {
      const guidance = read(path)
      const discovery = guidance.indexOf('pnpm run bemoat:context -- --help --json')
      const execution = guidance.indexOf('pnpm run bemoat:context <issue-number>')
      expect(discovery, `${path} discovery example`).toBeGreaterThanOrEqual(0)
      expect(execution, `${path} execution example`).toBeGreaterThan(discovery)
    }
  })

  it('uses HANDOFF for gated issue delivery and preserves the FAST exception', () => {
    const workflow = normalized(read('docs/agent-loop/issue-driven-branch-workflow.md'))
    const readme = normalized(read('docs/agent-loop/README.md'))
    const agents = normalized(read(canonicalPath))

    expect(workflow).toMatch(/workflow profile or review gate.*HANDOFF.*AGENTS\.md#handoff-protocol/i)
    expect(workflow).not.toMatch(/Task Issue.*`?## RESULT|RESULT.*posted on the issue/i)
    expect(readme).toMatch(/workflow profile.*applicable review gate.*HANDOFF/i)
    expect(readme).toMatch(/FAST.*without an applicable review or handoff gate.*omit HANDOFF/i)
    expect(agents).toMatch(/FAST.*without an applicable review or handoff gate.*omit HANDOFF/i)
  })

  it('requires Mission Control discovery before selecting every public operation', () => {
    const guidance = read('docs/mission-control/mission-control-guide.md')
    const semanticGuidance = normalized(guidance)
    for (const operation of [
      'task bootstrap',
      'dispatch',
      'reconcile',
      'review',
      'recover-review',
      'reopen',
      'merge',
      'delivery',
      'role comment transport',
    ]) expect(semanticGuidance).toContain(operation)
    expect(semanticGuidance).toMatch(/authoritative live state/i)
    expect(semanticGuidance).toMatch(/must not choose a command.*state names.*remembered routing/i)
  })

  it('retains every changed guidance and this guard in the managed child harness', () => {
    for (const path of managedGuidancePaths) {
      expect(
        managedPaths.some((managedPath) => path === managedPath || path.startsWith(`${managedPath}/`)),
        path,
      ).toBe(true)
    }
    expect(managedPaths).toContain('tests/int/cli-discovery-guidance.int.spec.ts')
  })

  it('registers the canonical safe JSON-help invocation for every Tier A and Tier B command', () => {
    for (const command of Object.keys(
      COMMAND_CONTRACT_REGISTRY.commands,
    )) {
      const contract = getCommandContract(command)
      if (contract?.tier !== 'A' && contract?.tier !== 'B') continue
      expect((contract as any).safe_help_invocation, command).toBe(
        `pnpm run ${command} -- --help --json`,
      )
    }
  })

  it('preserves the registry-defined Tier C delegation and safe-help boundary', () => {
    const tierC = Object.values(COMMAND_CONTRACT_REGISTRY.commands)
      .filter((contract) => (contract as any).tier === 'C')

    expect(tierC.length).toBeGreaterThan(0)
    for (const contract of tierC) {
      expect((contract as any).help_meaningful, (contract as any).command).toBe(false)
      expect((contract as any).safe_help_invocation, (contract as any).command).toEqual(
        expect.any(String),
      )
      expect((contract as any).safe_help_invocation?.trim(), (contract as any).command).not.toBe('')
    }
  })

  it.each(representativeCommands)('executes %s JSON help without changing tracked state', (command) => {
    const contract = getCommandContract(command)
    if (!contract) throw new Error(`missing contract for ${command}`)
    const result = runCliBoundaryCase({
      entrypoint: contract.entrypoint,
      argv: ['--', '--help', '--json'],
      env: { npm_lifecycle_event: command, NO_COLOR: '1' },
    })

    const jsonLine = [...result.stdout.split('\n')]
      .reverse()
      .find((line) => line.trim().startsWith('{'))
    expect(JSON.parse(jsonLine ?? '')).toMatchObject({ command, mode: 'help', classification: 'HELP' })
    expect(result.status).toBe(0)
    expect(result.filesystem_unchanged).toBe(true)
    expect(result.poison_invocations).toEqual([])
  })
})
