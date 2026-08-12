import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildScriptImportGraph } from '../../scripts/guards/scripts-architecture.mjs'
const domainPath = resolve(process.cwd(), 'scripts/mission-control/domain/task-state.mjs')
const publicExports = [
  'MISSION_CONTROL_STATES',
  'MISSION_CONTROL_WORKFLOW_MODES',
  'normalizeWorkflowMode',
  'normalizePlanningAuthorizationBaseSha',
  'populateOrPreservePlanningAuthorizationBaseSha',
  'parseMissionControlState',
  'renderMissionControlState',
  'projectMissionControlStateBlock',
  'appendMissingMissionControlStateBlock',
]

describe('Mission Control task-state boundary', () => {
  it('keeps task-state behavior owned by the inward domain module', async () => {
    const domainTaskState = await import(/* @vite-ignore */ `file://${domainPath}`)
    const domainExports = domainTaskState as unknown as Record<string, unknown>

    for (const name of publicExports) {
      expect(domainExports[name], `${name} must remain domain-owned`).toBeDefined()
    }

    expect(domainPath).toContain('scripts/mission-control/domain/task-state.mjs')
    expect((await import('../../scripts/mission-control/domain/task-state.mjs')).parseMissionControlState)
      .toBe(domainExports.parseMissionControlState)

    const graph = buildScriptImportGraph(process.cwd())
    const domainImports = graph.get('scripts/mission-control/domain/task-state.mjs') ?? new Set()
    expect(domainImports).toContain('scripts/mission-control/domain/task-state-authorization.mjs')
  })
})
