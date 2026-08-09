import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildScriptImportGraph } from '../../scripts/guard-scripts-architecture.mjs'
import * as workflow from '../../scripts/mission-control/workflows/agent-delivery.mjs'

const root = resolve(process.cwd())
const rootFacadePath = resolve(root, 'scripts/agent-delivery.mjs')

describe('agent delivery workflow boundary', () => {
  it('keeps the public root as a delegating facade over the inward workflow owner', () => {
    expect(typeof workflow.runAgentDeliveryWorkflow).toBe('function')

    const rootSource = readFileSync(rootFacadePath, 'utf8')
    expect(rootSource).toMatch(/runAgentDeliveryWorkflow/)

    const graph = buildScriptImportGraph(root)
    const inwardImports = graph.get('scripts/mission-control/workflows/agent-delivery.mjs') ?? new Set()
    expect(inwardImports).not.toContain('scripts/agent-delivery.mjs')
    expect(inwardImports).not.toContain('scripts/mission-control-reconcile.mjs')
    expect(inwardImports).not.toContain('scripts/mission-control-issue-body-cas.mjs')
    expect(inwardImports).not.toContain('scripts/mission-control-state.mjs')
  })
})
