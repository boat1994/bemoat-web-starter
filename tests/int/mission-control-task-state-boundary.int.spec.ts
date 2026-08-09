import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildScriptImportGraph } from '../../scripts/guard-scripts-architecture.mjs'
import * as rootTaskState from '../../scripts/mission-control-state.mjs'

const rootPath = resolve(process.cwd(), 'scripts/mission-control-state.mjs')
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
  it('keeps the root as a stable facade over a pure domain owner', async () => {
    expect(existsSync(domainPath)).toBe(true)
    if (!existsSync(domainPath)) return

    const domainTaskState = await import(/* @vite-ignore */ pathToFileURL(domainPath).href)
    const rootExports = rootTaskState as unknown as Record<string, unknown>
    const domainExports = domainTaskState as unknown as Record<string, unknown>

    for (const name of publicExports) {
      expect(rootExports[name], `${name} must remain facade-compatible`).toBe(domainExports[name])
    }

    expect(readFileSync(rootPath, 'utf8')).toMatch(
      /export \* from ['"]\.\/mission-control\/domain\/task-state\.mjs['"]/
    )
    expect(readFileSync(domainPath, 'utf8')).not.toMatch(/mission-control-state\.mjs/)

    const graph = buildScriptImportGraph(process.cwd())
    const domainImports = graph.get('scripts/mission-control/domain/task-state.mjs') ?? new Set()
    expect(domainImports).not.toContain('scripts/mission-control-state.mjs')
    expect(domainImports).toContain('scripts/mission-control/domain/task-state-authorization.mjs')
  })
})
