import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

describe('bemoat:mission-control:task-bootstrap public contract', () => {
  it('exposes machine-readable eligibility requirements', async () => {
    const { stdout } = await exec('pnpm', ['run', 'bemoat:mission-control:task-bootstrap', '--', '--help', '--json'])
    const help = JSON.parse(stdout.substring(stdout.indexOf("{")))
    expect(help.schema_version).toBe(1)
    expect(help.accepted_pre_states).toEqual(['NOT_STATEFUL', 'EXISTING_REGISTERED_TASK'])
    expect(help.required_evidence).toContain('Founder-authorized signed authorization.')
    expect(help.trusted_derived_values).toContain('Actions-derived workflow identity')
    expect(help.role_contracts.FOUNDER_AUTHORIZATION).toBeDefined()
    expect(help.role_contracts.FOUNDER_AUTHORIZATION.canonical_example).toContain('"schema_version":1')
  })
})
