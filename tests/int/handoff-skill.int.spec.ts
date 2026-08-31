import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { getCommandContract } from '../../scripts/cli/command-contract.ts'
import { managedPaths } from '../../scripts/boilerplate/inventory.mjs'

const ROOT = process.cwd()
const SKILL_PATH = '.agents/skills/handoff.md'

const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8')

function handoffContract() {
  const contract = getCommandContract('bemoat:handoff')
  if (!contract) throw new Error('bemoat:handoff is not registered')
  return contract
}

function contextContract() {
  const contract = getCommandContract('bemoat:context')
  if (!contract) throw new Error('bemoat:context is not registered')
  return contract
}

describe('portable stateless Handoff skill', () => {
  it('registers one portable fallback representation for the discovered public command', () => {
    const registry = read('.agents/README.md')
    const skill = resolve(ROOT, SKILL_PATH)
    const contract = handoffContract()

    expect(registry).toContain('[`handoff.md`](./skills/handoff.md)')
    expect(managedPaths).toContain('.agents')
    expect(existsSync(skill)).toBe(true)
    expect(read(SKILL_PATH)).toContain('# Handoff Skill')
    expect(read(SKILL_PATH)).toContain(contract.command)
    expect(read(SKILL_PATH).replace(/\s+/g, ' ')).toMatch(/native.*Handoff.*first/i)
    expect(read(SKILL_PATH).replace(/\s+/g, ' ')).toMatch(/fallback/i)
  })

  it('requires invalid or ambiguous evidence to fail closed before publication', () => {
    const skill = read(SKILL_PATH)
    const semanticSkill = skill.replace(/\s+/g, ' ')
    const contract = handoffContract()

    expect(semanticSkill).toMatch(/invalid|malformed|conflicting|ambiguous/i)
    expect(semanticSkill).toMatch(/before (?:invoking|publication|posting)/i)
    expect(semanticSkill).toMatch(/fail[- ]closed/i)
    expect(semanticSkill).toMatch(/never.*(?:blindly|unproven).*(?:retry|post|publish)/i)
    expect(skill).toContain(contract.writes[0])
    for (const classification of contract.stop_classifications) {
      expect(skill).toContain(classification)
    }
  })

  it('uses strict temporary transport, exact readback, and fresh Context continuation', () => {
    const skill = read(SKILL_PATH)
    const semanticSkill = skill.replace(/\s+/g, ' ')
    const handoff = handoffContract()
    const context = contextContract()

    expect(semanticSkill).toMatch(/exactly one strict JSON HANDOFF/i)
    for (const field of ['help_meaningful', 'safe_help_invocation', 'required_inputs', 'optional_flags', 'writes', 'post_write_readback']) {
      expect(skill).toContain(field)
    }
    expect(semanticSkill).toMatch(/help_meaningful/i)
    expect(semanticSkill).toMatch(/safe_help_invocation/i)
    expect(semanticSkill).toMatch(/temporary.*body.*file.*only.*transport/i)
    expect(semanticSkill).toMatch(/invoke only.*discovered public.*bemoat:handoff/i)
    expect(semanticSkill).toMatch(/GitHub.*readback/i)
    expect(semanticSkill).toMatch(/remove.*(?:temporary|body).*file.*(?:after|readback)/i)
    expect(semanticSkill).toMatch(/fresh.*(?:run|reconstruct).*context/i)
    expect(semanticSkill).toMatch(/direct.*(?:command|invocation).*equiv|equiv.*direct.*(?:command|invocation)/i)
    expect(semanticSkill).toMatch(/no.*(?:HANDOFF\.md|cache|database|state)/i)
    expect(skill).toContain(handoff.command)
    expect(skill).toContain(context.command)
    expect(skill).toContain(handoff.required_inputs.find((input) => input.name === 'body_file')?.name ?? 'body_file')
    expect(skill).not.toContain(handoff.entrypoint)
    expect(skill).not.toContain('--body-file')
    expect(skill).not.toContain('pnpm run bemoat:')
    expect(skill).not.toMatch(/\.(?:mjs|ts)\b/)
  })

  it('requires exit hygiene and preserves ambiguous mutation handling', () => {
    const skill = read(SKILL_PATH)
    const semanticSkill = skill.replace(/\s+/g, ' ')
    const contract = handoffContract()

    expect(semanticSkill).toMatch(/inspect.*workspace.*(?:status|residue).*before.*(?:publication|handoff)/i)
    expect(semanticSkill).toMatch(/classif(?:y|ication).*agent-created.*(?:temporary|disposable)/i)
    expect(semanticSkill).toMatch(/intended.*durable.*(?:commit|push|GitHub-visible)/i)
    expect(semanticSkill).toMatch(/pre-existing.*unrelated.*never delete|never delete.*pre-existing.*unrelated/i)
    expect(semanticSkill).toMatch(/final.*workspace.*(?:status|check)/i)
    expect(semanticSkill).toMatch(/fresh.*(?:run|reconstruct).*public Context/i)
    expect(skill).toContain('AMBIGUOUS_RESULT')
    expect(skill).toContain('NO_OP_IDENTICAL_RETRY')
    expect(semanticSkill).toContain(contract.retry_contract.condition.split(';')[0])
  })
})
