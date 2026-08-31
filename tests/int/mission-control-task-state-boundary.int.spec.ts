import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const domainPath = resolve(process.cwd(), 'scripts/mission-control/domain/task-state.ts')
const canonicalDomainPath = resolve(process.cwd(), 'scripts/mission-control/domain/task-state.ts')
const retiredManagedStatePaths = [
  'scripts/mission-control/domain/task-state-authorization.ts',
  'scripts/mission-control/domain/active-correction-contract.ts',
  'scripts/mission-control/domain/correction-contract.ts',
  'scripts/mission-control/domain/correction-contract-fingerprint.ts',
  'scripts/mission-control/domain/correction-contract-fingerprint.mjs',
  'scripts/mission-control/domain/standard-non-managed-eligibility.ts',
  'scripts/mission-control/review-verdict-binding.mjs',
  'scripts/mission-control/transition-identity.mjs',
  'scripts/mission-control/transition-match-options.mjs',
  'scripts/mission-control/transition-authorization.mjs',
  'scripts/mission-control/transition-guards.mjs',
  'scripts/mission-control/comment-resolution.mjs',
  'scripts/mission-control/comment-evidence.ts',
  'scripts/mission-control/coordinator.mjs',
  'scripts/mission-control/coordinator-projection.mjs',
  'scripts/mission-control/coordinator-transitions.mjs',
  'scripts/mission-control/reconciliation-analysis.mjs',
  'scripts/mission-control/reconciliation-proposals.mjs',
  'scripts/mission-control/state-verification.mjs',
  'scripts/mission-control/transport-registry.ts',
  'scripts/mission-control/transport-registry.mjs',
  'scripts/cli/command-contract-transport.ts',
  'scripts/cli/command-contract-transport.mjs',
  'scripts/cli/mission-control-routing-policy-primary.ts',
  'scripts/cli/mission-control-routing-policy-primary.mjs',
  'scripts/mission-control/domain/productive-policy.ts',
  'scripts/mission-control/domain/productive-policy.mjs',
]

function listProductionScriptFiles(directory: string, files: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name)
    if (entry.isDirectory()) {
      listProductionScriptFiles(absolutePath, files)
    } else if (/\.(?:mjs|ts)$/.test(entry.name)) {
      files.push(absolutePath)
    }
  }
  return files
}

describe('Mission Control task-state boundary', () => {
  it('retains only the read-only parser seam after managed-state compatibility cleanup', async () => {
    const domainTaskState = await import(/* @vite-ignore */ `file://${domainPath}`)
    const domainExports = domainTaskState as unknown as Record<string, unknown>

    expect(domainPath).toContain('scripts/mission-control/domain/task-state.ts')
    expect(domainExports.parseMissionControlState).toBeTypeOf('function')
    expect(Object.keys(domainExports)).toEqual(['parseMissionControlState'])
    expect(readFileSync(canonicalDomainPath, 'utf8')).not.toMatch(
      /(?:from|import|export)\s+[^\n]*(?:task-state-authorization|review-verdict-binding|transition-|comment-|coordinator|reconciliation|projection|authorization|counter|budget)/,
    )
    for (const relativePath of retiredManagedStatePaths) {
      expect(existsSync(resolve(process.cwd(), relativePath)), `${relativePath} must be deleted`).toBe(false)
    }

    const canonicalTaskState = await import(/* @vite-ignore */ `file://${canonicalDomainPath}`)
    expect(canonicalTaskState.parseMissionControlState)
      .toBe(domainExports.parseMissionControlState)

    const parserConsumers = listProductionScriptFiles(resolve(process.cwd(), 'scripts'))
      .filter((path) => path !== canonicalDomainPath)
      .filter((path) => readFileSync(path, 'utf8').includes('parseMissionControlState'))
      .map((path) => relative(process.cwd(), path).split('\\').join('/'))
      .sort()
    expect(parserConsumers).toEqual(['scripts/guards/planning-contract-runtime.mjs'])

    const planningRuntime = readFileSync(
      resolve(process.cwd(), 'scripts/guards/planning-contract-runtime.mjs'),
      'utf8',
    )
    expect(planningRuntime).toMatch(
      /import\s+\{\s*parseMissionControlState\s*\}\s+from\s+['"]\.\.\/mission-control\/domain\/task-state\.ts['"]/
    )
    expect(planningRuntime).toContain('parseMissionControlState(issue.body ?? \'\')')
  })

  it('fails closed for malformed marker/YAML input used by planning safety', async () => {
    const { parseMissionControlState } = await import(/* @vite-ignore */ `file://${domainPath}`)

    expect(parseMissionControlState('## MISSION_CONTROL_STATE\nstate: DONE')).toMatchObject({
      present: true,
      valid: false,
    })
    expect(parseMissionControlState([
      '<!-- bemoat-mission-control-state:start -->',
      'schema_version: 1',
      'state: IN_PROGRESS',
      'state: DONE',
      '<!-- bemoat-mission-control-state:end -->',
    ].join('\n'))).toMatchObject({
      present: true,
      valid: false,
    })
    expect(parseMissionControlState([
      '<!-- bemoat-mission-control-state:start -->',
      'schema_version: 1',
      'state: IN_PROGRESS',
      'active_task_issue: garbage',
      '<!-- bemoat-mission-control-state:end -->',
    ].join('\n'))).toMatchObject({
      present: true,
      valid: false,
    })
  })
})
