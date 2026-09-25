import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (path: string) => readFileSync(resolve(root, path), 'utf8').replace(/\s+/g, ' ')

describe('Mission Control delegation and execution model policy', () => {
  it('keeps delegated work within one accountable objective and preserves independent gates', () => {
    const guide = read('docs/mission-control/mission-control-guide.md')
    expect(guide).toMatch(/one accountable controller per bounded objective/i)
    expect(guide).toMatch(/delegat(?:e|es).*bounded internal.*read-only.*non-overlapping.*deterministic/i)
    expect(guide).toMatch(/retains? responsibility for.*objective.*authority.*routing.*evidence.*acceptance criteria.*durable delivery.*fresh Context/i)
    expect(guide).toMatch(/workers?.*no new authority.*cannot.*future objectives.*cross.*gates/i)
    expect(guide).toMatch(/multiple read-only.*non-overlapping workers?.*do not.*bundle/i)
    expect(guide).toMatch(/mutation ownership.*unambiguous.*overlapping.*prohibited/i)
    expect(guide).toMatch(/independent review.*remains? independent/i)
    expect(guide).toMatch(/agnostic to provider and model identity/i)
    expect(guide).not.toMatch(/keep one capable worker through deterministic internal steps/i)
    expect(guide).toMatch(/when useful.*same capable worker through a coherent inspect\/implement\/focused-check\/correction chain.*authorized delivery steps/i)
  })

  it('keeps model names in the loader as role-based execution preferences only', () => {
    const loader = read('prompts/mission-control/chatgpt-project-loader.md')
    expect(loader).toMatch(/GPT-5\.6 Sol Medium.*controller.*core.*multi-stage.*release.*cross-domain.*ambiguity.*evidence synthesis/i)
    expect(loader).toMatch(/Luna Medium.*read-only.*evidence.*inventory.*deterministic.*mechanical verification.*focused validation/i)
    expect(loader).toMatch(/Luna High.*implementation.*repository analysis/i)
    expect(loader).toMatch(/small deterministic objectives?.*Luna directly/i)
    expect(loader).toMatch(/named-model fallback.*equivalent role.*lowest-cost model sufficient/i)
    expect(loader).toMatch(/model.*does not.*workflow authority/i)
    expect(loader).not.toMatch(/choose the lowest-cost sufficient worker and keep it on the objective through deterministic internal steps and policy-allowed delivery actions/i)
    expect(loader).toMatch(/one accountable controller owns the bounded objective.*may delegate suitable bounded, non-overlapping internal subwork/i)
    expect(loader).toMatch(/same capable mutation worker.*optional efficiency preference when useful.*not.*objective-wide authority/i)
  })
})
