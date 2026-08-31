import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it } from 'vitest'

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('env placeholder guard boundary', () => {
  it('exposes the cohesive destination guard contract', async () => {
    const destination = await import('../../scripts/guards/env-placeholder.ts')

    expect(Object.keys(destination).sort()).toEqual([
      'ENV_EXAMPLE_PATH',
      'formatEnvPlaceholderViolations',
      'getEnvPlaceholderGuardExitCode',
      'isDirectExecution',
      'main',
      'parseEnvAssignments',
      'runEnvPlaceholderGuard',
      'scanEnvExampleContent',
    ])
    expect(destination.getEnvPlaceholderGuardExitCode([{}])).toBe(1)
  })

  it('preserves direct invocation output and exit codes at the destination', () => {
    const root = mkdtempSync(join(tmpdir(), 'env-placeholder-boundary-'))
    tempRoots.push(root)
    const destinationPath = resolve(process.cwd(), 'scripts/guards/env-placeholder.ts')

    const destinationResult = spawnSync(process.execPath, [destinationPath], { cwd: root, encoding: 'utf8' })

    expect(existsSync(resolve(process.cwd(), 'scripts/guard-env-placeholder.mjs'))).toBe(false)
    expect(destinationResult.status).toBe(1)

    writeFileSync(join(root, '.env.example'), 'PAYLOAD_SECRET=\nDATABASE_URL=<DATABASE_URL>\n')
    const passingResult = spawnSync(process.execPath, [destinationPath], { cwd: root, encoding: 'utf8' })

    expect(passingResult.status).toBe(0)
    expect(passingResult.stdout).toBe('Env placeholder guard passed.\n')
    expect(passingResult.stderr).toBe('')
  })
})
