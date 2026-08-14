import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  projectMissionControlStateBlock,
  renderMissionControlState,
} from '../../scripts/mission-control/domain/task-state.mjs'

type StateBlockReplacement = (body: unknown, state?: unknown) => string

const START_MARKER = '<!-- bemoat-mission-control-state:start -->'
const END_MARKER = '<!-- bemoat-mission-control-state:end -->'

async function loadModules(): Promise<{
  facade: { stateBlockReplacement: StateBlockReplacement }
  typed: { stateBlockReplacement: StateBlockReplacement }
}> {
  const facade = await import('../../scripts/mission-control/domain/merge-state-block-replacement.mjs')
  const typed = await import('../../scripts/mission-control/domain/merge-state-block-replacement.ts')
  return { facade, typed }
}

function invoke(module: { stateBlockReplacement: StateBlockReplacement }, body: unknown, state?: unknown): string {
  return Reflect.apply(module.stateBlockReplacement, undefined, [body, state])
}

describe('stateBlockReplacement', () => {
  const prior: Record<string, unknown> = {
    schema_version: 1,
    state: 'READY',
    review_cycle: 0,
    full_review_count: 0,
    approved_base: 'main',
    active_task_issue: '#328',
    active_pr: '#332',
    current_head: null,
    last_reviewed_head: null,
    guide_version: '1.3.0',
    guide_source_ref: 'main',
    guide_source_sha: null,
    open_blockers: [],
    follow_up_issues: [],
    next_permitted_action: 'Mission Control posts HANDOFF',
    material_change_status: 'none',
    updated_at: null,
    updated_by: null,
  }

  it('keeps the exact facade and one distinct named wrapper export', async () => {
    const modules = await loadModules()

    expect(readFileSync('scripts/mission-control/domain/merge-state-block-replacement.mjs', 'utf8'))
      .toBe("export * from './merge-state-block-replacement.ts'\n")
    expect(Object.keys(modules.facade)).toEqual(['stateBlockReplacement'])
    expect(Object.keys(modules.typed)).toEqual(['stateBlockReplacement'])
    expect(modules.facade.stateBlockReplacement).toBe(modules.typed.stateBlockReplacement)
    expect(modules.typed.stateBlockReplacement).not.toBe(projectMissionControlStateBlock)
  })

  it('delegates the exact projection output and preserves outside-body bytes', async () => {
    const modules = await loadModules()
    const next = { ...prior, state: 'DONE', updated_by: 'Mission Control' }
    const body = `before\r\n${START_MARKER}\nlegacy\n${END_MARKER}after\r\n`
    const expected = `before\r\n${renderMissionControlState(next)}after\r\n`

    expect(invoke(modules.typed, body, next)).toBe(expected)
    expect(invoke(modules.facade, body, next)).toBe(expected)
    expect(invoke(modules.typed, body, next)).toBe(projectMissionControlStateBlock(body, next))
  })

  it.each([
    ['missing', 'prose without a managed block', /managed state block is missing/],
    ['duplicate start', `${START_MARKER}\n${START_MARKER}\n${END_MARKER}`, /exactly one balanced marker pair is required/],
    ['duplicate end', `${START_MARKER}\n${END_MARKER}\n${END_MARKER}`, /exactly one balanced marker pair is required/],
    ['unbalanced start', `${START_MARKER}\nlegacy`, /exactly one balanced marker pair is required/],
    ['unbalanced end', `legacy\n${END_MARKER}`, /exactly one balanced marker pair is required/],
    ['reversed', `${END_MARKER}\nlegacy\n${START_MARKER}`, /exactly one balanced marker pair is required/],
  ])('preserves the exact %s marker failure', async (_label, body, message) => {
    const modules = await loadModules()

    expect(() => invoke(modules.typed, body, prior)).toThrow(message)
    expect(() => invoke(modules.facade, body, prior)).toThrow(message)
  })

  it('preserves undefined defaults, native null failure, and malformed state rendering', async () => {
    const modules = await loadModules()
    const body = `${START_MARKER}\nlegacy\n${END_MARKER}`

    expect(invoke(modules.typed, body, undefined)).toBe(`${renderMissionControlState({})}`)
    expect(invoke(modules.typed, body, 42)).toBe(renderMissionControlState({}))
    expect(invoke(modules.typed, body, true)).toBe(renderMissionControlState({}))
    expect(invoke(modules.typed, body, { malformed: 'record' })).toBe(
      renderMissionControlState({ malformed: 'record' }),
    )
    expect(() => invoke(modules.facade, body, null)).toThrow(TypeError)
  })

  it('coerces body twice for marker discovery and twice for successful slicing', async () => {
    const modules = await loadModules()
    const events: string[] = []
    const bodyText = `${START_MARKER}\nlegacy\n${END_MARKER}`
    const body = {
      [Symbol.toPrimitive](hint: string) {
        events.push(`body:${hint}`)
        return bodyText
      },
    }

    expect(invoke(modules.typed, body, prior)).toBe(
      renderMissionControlState(prior),
    )
    expect(events).toEqual(['body:string', 'body:string', 'body:string', 'body:string'])

    events.length = 0
    expect(() => invoke(modules.facade, { [Symbol.toPrimitive](): string {
      events.push('body:missing')
      return 'missing'
    } }, prior)).toThrow(/managed state block is missing/)
    expect(events).toEqual(['body:missing', 'body:missing'])
  })

  it('propagates body coercion errors unchanged before touching state', async () => {
    const modules = await loadModules()
    const bodyError = new Error('body coercion failed')
    let stateTouched = false
    const body = {
      [Symbol.toPrimitive](): never {
        throw bodyError
      },
    }
    const state = new Proxy(prior, {
      get(target, property, receiver) {
        stateTouched = true
        return Reflect.get(target, property, receiver)
      },
    })

    expect(() => invoke(modules.typed, body, state)).toThrow(bodyError)
    expect(stateTouched).toBe(false)
  })

  it('does not mutate or retain state across calls', async () => {
    const modules = await loadModules()
    const state = Object.freeze({ ...prior, state: 'DONE' })
    const body = Object.freeze({
      toString: () => `${START_MARKER}\nlegacy\n${END_MARKER}`,
    })

    expect(invoke(modules.typed, body, state)).toBe(renderMissionControlState(state))
    expect(invoke(modules.typed, body, prior)).toBe(renderMissionControlState(prior))
    expect(Object.isFrozen(body)).toBe(true)
    expect(Object.isFrozen(state)).toBe(true)
    expect(Object.keys(state)).toEqual(Object.keys({ ...prior, state: 'DONE' }))
  })

  it('keeps projection evaluation before the production CAS writer', () => {
    const source = readFileSync('scripts/mission-control/workflows/merge.mjs', 'utf8')
    const writeTaskDoneStart = source.indexOf('writeTaskDone: async')
    const writeTaskDoneEnd = source.indexOf('\n    },', writeTaskDoneStart)
    const writeTaskDoneSource = source.slice(writeTaskDoneStart, writeTaskDoneEnd)

    expect(writeTaskDoneStart).toBeGreaterThanOrEqual(0)
    expect(writeTaskDoneSource).toMatch(
      /await writeIssueBodyWithLease\(\{[\s\S]*nextBody: stateBlockReplacement\(live\.body, nextState\),[\s\S]*\}\)/,
    )
  })
})
