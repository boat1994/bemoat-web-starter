import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(import.meta.dirname, '../..')

describe('Agent-Issue retirement structural contract', () => {
  it('removes the legacy public command and ownership tree', () => {
    const packageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>
    }
    const registrySource = readFileSync(
      resolve(repoRoot, 'scripts/cli/command-contract-registry.ts'),
      'utf8',
    )

    expect(packageJson.scripts?.['bemoat:agent:issue']).toBeUndefined()
    expect(registrySource).not.toContain("'bemoat:agent:issue'")
    expect(existsSync(resolve(repoRoot, 'scripts/agent-issue.mjs'))).toBe(false)
    expect(existsSync(resolve(repoRoot, 'scripts/agent-issue'))).toBe(false)
    expect(existsSync(resolve(repoRoot, 'tests/int/agent-issue.int.spec.ts'))).toBe(false)
    expect(existsSync(resolve(repoRoot, 'tests/fixtures/agent-issue'))).toBe(false)
  })

  it('keeps shared parsing and PR identity helpers outside legacy ownership', async () => {
    const contextDeclarationsPath = resolve(repoRoot, 'scripts/context/issue-declarations.ts')
    const prIdentityPath = resolve(repoRoot, 'scripts/mission-control/domain/pr-identity.ts')

    expect(existsSync(contextDeclarationsPath)).toBe(true)
    expect(readFileSync(contextDeclarationsPath, 'utf8')).toContain(
      'export function parseIssueDeclarations',
    )
    expect(readFileSync(contextDeclarationsPath, 'utf8')).toContain(
      'export function deriveWorkflowProfile',
    )
    expect(readFileSync(prIdentityPath, 'utf8')).toContain('export function resolvePrNumber')
  })
})
