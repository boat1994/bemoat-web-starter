/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest'
import { main } from '../../scripts/mission-control/workflows/authorize-founder.mjs'

vi.mock('../../scripts/mission-control/adapters/merge-github.mjs', () => ({
  defaultRunGh: vi.fn(),
  readProtectedRef: vi.fn(),
}))

vi.mock('../../scripts/mission-control/adapters/task-bootstrap-github.mjs', () => ({
  createTaskBootstrapGithubAdapter: vi.fn(),
}))

import { defaultRunGh, readProtectedRef } from '../../scripts/mission-control/adapters/merge-github.mjs'
import { createTaskBootstrapGithubAdapter } from '../../scripts/mission-control/adapters/task-bootstrap-github.mjs'

describe('bemoat:mission-control:authorize-founder regression', () => {
  it('completes canonical task-bootstrap recording with the repository lease scope', async () => {
    const runGhMock = defaultRunGh as any
    const readProtectedRefMock = readProtectedRef as any
    const createAdapterMock = createTaskBootstrapGithubAdapter as any
    const acquireLease = vi.fn().mockResolvedValue({ token: 'lease-token' })
    const releaseLease = vi.fn().mockResolvedValue(undefined)
    const comments: any[] = []

    createAdapterMock.mockReturnValue({ acquireIssueLease: acquireLease, releaseIssueLease: releaseLease })
    readProtectedRefMock.mockResolvedValue({ object: { sha: '114ec8dbe8aecc65276a2426e655ee544d72aad3' } })

    let postCount = 0
    runGhMock.mockImplementation((args: string[]) => {
      if (args[0] === 'api' && args[1].includes('/git/trees/')) {
        return JSON.stringify({ tree: [{ path: 'docs/mission-control/mission-control-guide.md', sha: '56443e2b8e07b8d8325d6b5fdef7b49f305b1e1f' }] })
      }
      if (args[0] === 'api' && args[1] === 'user') return JSON.stringify({ login: 'boat1994' })
      if (args[0] === 'api' && args[1].includes('BEMOAT_FOUNDER_LOGINS')) return JSON.stringify({ value: 'boat1994' })
      const endpoint = args[3] ?? args[1]
      if (args[0] === 'api' && endpoint.includes('/comments')) {
        if (args.includes('POST')) {
          const id = String(998 + ++postCount)
          const body = args[args.findIndex((arg) => arg.startsWith('body='))]?.slice(5) ?? ''
          const comment = { id, body, issue_number: 380, user: { login: 'boat1994' }, created_at: '2026-08-21T00:00:00Z', updated_at: '2026-08-21T00:00:00Z' }
          comments.push(comment)
          return JSON.stringify(comment)
        }
        if (endpoint.includes('/issues/comments/')) {
          const id = endpoint.split('/').pop()
          return JSON.stringify(comments.find((comment) => comment.id === id))
        }
        return JSON.stringify([comments])
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
      await main(['380', '--scope', 'task-bootstrap', '--json'])
    } finally {
      process.stdout.write = originalStdoutWrite
      process.exitCode = originalExitCode
    }

    const envelope = JSON.parse(output)
    expect(envelope.classification).toBe('SUCCESS')
    expect(envelope.mutation_performed).toBe(true)
    expect(envelope.details.comment_id).toBe('999')
    expect(envelope.details.receipt_comment_id).toBe('1000')
    expect(acquireLease).toHaveBeenCalledWith(expect.objectContaining({ issueNumber: 380, scope: 'founder-authorization-recording' }))
    expect(releaseLease).toHaveBeenCalledWith(expect.objectContaining({ issueNumber: 380, scope: 'founder-authorization-recording', lease: { token: 'lease-token' } }))
  })
})
