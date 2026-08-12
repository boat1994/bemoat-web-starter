import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('task bootstrap registry readback boundary', () => {
  it('keeps registry read and final admission in the dedicated domain module', () => {
    const workflow = readFileSync('scripts/mission-control/workflows/task-bootstrap.mjs', 'utf8')

    expect(workflow).toContain(
      "import { readRegistryRecords } from '../domain/task-bootstrap-registry-readback.mjs'",
    )
    expect(workflow).toContain(
      "import { verifyFinalTask } from '../domain/task-bootstrap-final-readback.mjs'",
    )
    expect(workflow).not.toMatch(/async function readRegistryRecords\(/)
    expect(workflow).not.toContain('const registryVerification = verifyTaskOwnershipRecord(')
    expect(workflow).toContain('const verifiedIssue = await verifyFinalTask({')
  })
})
