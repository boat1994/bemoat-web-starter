import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { getCommandContract } from '../../scripts/cli/command-contract.mjs'
import { managedPaths } from '../../scripts/boilerplate/inventory.mjs'
import {
  runCliBoundaryCase,
  type CliBoundaryResult,
} from '../helpers/cli-boundary-harness'

const ROOT = process.cwd()
const SKILL_PATH = '.agents/skills/context.md'

type ContextOutput = {
  classification?: string
  mutation_performed?: boolean
  next_action?: {
    type?: string
    command?: string | null
    reason?: string
  }
  route?: string
}

const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8')

function contextOutput(result: CliBoundaryResult): ContextOutput {
  const jsonLine = [...result.stdout.split(/\r?\n/)]
    .reverse()
    .find((line) => line.trim().startsWith('{'))

  if (!jsonLine) throw new Error(`Context command did not emit JSON: ${result.stdout}`)
  return JSON.parse(jsonLine) as ContextOutput
}

function contextContract() {
  const contract = getCommandContract('bemoat:context')
  if (!contract) throw new Error('bemoat:context is not registered')
  return contract
}

function discoveredArgs(issueNumber: number): string[] {
  const contract = contextContract()
  const issueInput = contract.required_inputs.find(
    (input) => input.name === 'issue_number' && input.kind === 'positional',
  )
  const jsonFlag = contract.optional_flags.find(
    (input) => input.name === 'json' && input.kind === 'flag',
  )

  if (!issueInput || !jsonFlag) {
    throw new Error('The discovered Context contract must expose issue_number and json inputs')
  }

  return [String(issueNumber), jsonFlag.syntax]
}

function exampleArgs(issueNumber: number): string[] {
  const example = contextContract().examples.find(({ argv }) => argv.some((arg) => /^\d+$/.test(arg)))
  if (!example) throw new Error('The discovered Context contract must expose a numeric example')

  let replacedIssue = false
  return example.argv.map((arg) => {
    if (!replacedIssue && /^\d+$/.test(arg)) {
      replacedIssue = true
      return String(issueNumber)
    }
    return arg
  })
}

function runPublicContext(argv: readonly string[]): ContextOutput {
  return contextOutput(runCliBoundaryCase({
    entrypoint: contextContract().entrypoint,
    argv,
  }))
}

function routeProjection(output: ContextOutput) {
  return {
    classification: output.classification,
    mutation_performed: output.mutation_performed,
    next_action: output.next_action,
    route: output.route,
  }
}

describe('portable stateless Context skill', () => {
  it('registers one portable fallback representation in the managed skill model', () => {
    const registry = read('.agents/README.md')
    expect(registry).toContain('[`context.md`](./skills/context.md)')
    expect(managedPaths.some((path) => SKILL_PATH === path || SKILL_PATH.startsWith(`${path}/`))).toBe(true)
    expect(read(SKILL_PATH)).toContain('# Context Skill')
  })

  it('delegates through discovered public metadata without embedding implementation layout or syntax', () => {
    const skill = read(SKILL_PATH)
    const semanticSkill = skill.replace(/\s+/g, ' ')
    const contract = contextContract()

    expect(skill).toContain(contract.command)
    expect(semanticSkill).toMatch(/CLI Discovery/i)
    for (const field of ['safe_help_invocation', 'required_inputs', 'optional_flags', 'writes']) {
      expect(skill).toContain(field)
    }
    expect(semanticSkill).toMatch(/read-only/i)
    expect(semanticSkill).toMatch(/authoritative.*evidence/i)
    expect(semanticSkill).toMatch(/route/i)
    expect(semanticSkill).toMatch(/next_action/i)
    expect(semanticSkill).toMatch(/STOP/i)
    expect(semanticSkill).toMatch(/protected[- ]base/i)
    expect(semanticSkill).toMatch(/merged main/i)
    expect(semanticSkill).toMatch(/policy/i)
    expect(semanticSkill).toMatch(/local durability/i)
    expect(semanticSkill).toMatch(/chat.*session.*local note/i)
    expect(semanticSkill).toMatch(/cache.*state.*database.*HANDOFF\.md/i)
    expect(semanticSkill).toMatch(/implementation internals/i)
    expect(semanticSkill).toMatch(/module extensions.*file layout/i)

    expect(skill).not.toContain('pnpm run bemoat:context')
    expect(skill).not.toContain('scripts/agent-context')
    expect(skill).not.toContain('--json')
    expect(skill).not.toMatch(/\.(?:mjs|ts)\b/)
  })

  it('keeps fresh-session direct and skill-mediated invocation routes equivalent', () => {
    const direct = runPublicContext(exampleArgs(441))
    const mediated = runPublicContext(discoveredArgs(441))

    expect(routeProjection(mediated)).toEqual(routeProjection(direct))
    expect(mediated.route).toBe('STOP')
    expect(mediated.next_action).toEqual(direct.next_action)
  })

  it('preserves the public read-only fail-closed boundary', () => {
    const result = runCliBoundaryCase({
      entrypoint: contextContract().entrypoint,
      argv: discoveredArgs(441),
    })
    const output = contextOutput(result)

    expect(result.error).toBeNull()
    expect(result.status).toBe(0)
    const before = Object.fromEntries(
      Object.entries(result.before).filter(([path]) => path !== 'poison-calls.log'),
    )
    const after = Object.fromEntries(
      Object.entries(result.after).filter(([path]) => path !== 'poison-calls.log'),
    )
    expect(after).toEqual(before)
    const writeInvocations = result.poison_invocations.filter((line) =>
      /\b(?:add|checkout|comment|commit|create|mv|push|reset|rm|stash|switch)\b/i.test(line),
    )
    expect(writeInvocations).toEqual([])
    expect(output.route).toBe('STOP')
    expect(output.mutation_performed).toBe(false)
  })

  it('requires no conversational or local-note authority', () => {
    const skill = read(SKILL_PATH)
    const semanticSkill = skill.replace(/\s+/g, ' ')

    expect(semanticSkill).toMatch(/fresh session/i)
    expect(semanticSkill).toMatch(/command output/i)
    expect(semanticSkill).toMatch(/do not use.*chat/i)
    expect(semanticSkill).toMatch(/do not use.*session/i)
    expect(semanticSkill).toMatch(/do not use.*local note/i)
  })
})
