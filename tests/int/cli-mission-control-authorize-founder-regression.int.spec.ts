/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest'
import { main } from '../../scripts/mission-control/workflows/authorize-founder.mjs'

vi.mock('../../scripts/mission-control/adapters/merge-github.mjs', () => ({
  defaultRunGh: vi.fn(),
  readProtectedRef: vi.fn(),
}))

import { defaultRunGh, readProtectedRef } from '../../scripts/mission-control/adapters/merge-github.mjs'
import { BOOTSTRAP_CONTRACT } from '../../scripts/mission-control/domain/task-bootstrap-authorization.ts'

describe('bemoat:mission-control:authorize-founder regression', () => {
  it('uses canonical camelCase BOOTSTRAP_CONTRACT properties for policy resolution', async () => {
    const runGhMock = defaultRunGh as any
    const readProtectedRefMock = readProtectedRef as any

    readProtectedRefMock.mockResolvedValue({ object: { sha: 'abcd123' } })

    runGhMock.mockImplementation((args: string[]) => {
      if (args[0] === 'api' && args[1].includes('/git/trees/')) {
        return JSON.stringify({
          tree: [
            { path: BOOTSTRAP_CONTRACT.policySource, sha: 'blob-123' }
          ]
        })
      }
      if (args[0] === 'api' && args[1] === 'user') {
        return JSON.stringify({ login: 'boat1994' })
      }
      if (args[0] === 'api' && args[1].includes('BEMOAT_FOUNDER_LOGINS')) {
        return JSON.stringify({ value: 'boat1994' })
      }
      if (args[0] === 'api' && args[1].includes('/comments')) {
        if (args.includes('POST')) {
          return JSON.stringify({ id: 999 })
        }
        return JSON.stringify([])
      }
      return JSON.stringify({})
    })

    const originalExitCode = process.exitCode
    const originalStdoutWrite = process.stdout.write
    let output = ''
    process.stdout.write = ((chunk: string) => {
      output += chunk
      return true
    }) as any

    try {
      await main(['123', '--scope', 'task-bootstrap', '--json'])
    } finally {
      process.stdout.write = originalStdoutWrite
      process.exitCode = originalExitCode
    }

    const envelope = JSON.parse(output)
    
    // If it used the old snake_case `policy_source`, it would be undefined.
    // `tree.find((t) => t.path === undefined)` would fail, throwing 'policy not found in tree',
    // which catches and returns classification EVIDENCE_CONFLICT.
    // Since we provided the correct `BOOTSTRAP_CONTRACT.policySource` path in our mock tree,
    // getting past the trusted context builder to the lease error proves the script correctly used the camelCase property.
    // If it used snake_case (undefined), it would have thrown EVIDENCE_CONFLICT: failed to resolve Mission Control policy blob SHA.
    expect(envelope.classification).toBe('STATE_CONFLICT')
    expect(envelope.details.reason).toBe('authorization recording requires repository coordination')
  })
})
