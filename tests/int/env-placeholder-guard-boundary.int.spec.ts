import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it } from 'vitest'

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('env placeholder guard boundary', () => {
  it('preserves the root facade export surface while delegating policy exports inward', async () => {
    const facade = await import('../../scripts/guard-env-placeholder.mjs')
    const destination = await import('../../scripts/guards/env-placeholder.mjs')

    expect(Object.keys(facade).sort()).toEqual([
      'ENV_EXAMPLE_PATH',
      'formatEnvPlaceholderViolations',
      'getEnvPlaceholderGuardExitCode',
      'isDirectExecution',
      'parseEnvAssignments',
      'runEnvPlaceholderGuard',
      'scanEnvExampleContent',
    ])
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
    expect(facade.runEnvPlaceholderGuard).toBe(destination.runEnvPlaceholderGuard)
    expect(facade.formatEnvPlaceholderViolations).toBe(destination.formatEnvPlaceholderViolations)
    expect(facade.getEnvPlaceholderGuardExitCode([{}])).toBe(1)
  })

  it('preserves direct invocation output and exit codes through the root facade', () => {
    const root = mkdtempSync(join(tmpdir(), 'env-placeholder-boundary-'))
    tempRoots.push(root)
    const facadePath = resolve(process.cwd(), 'scripts/guard-env-placeholder.mjs')
    const destinationPath = resolve(process.cwd(), 'scripts/guards/env-placeholder.mjs')

    const facadeResult = spawnSync(process.execPath, [facadePath], { cwd: root, encoding: 'utf8' })
    const destinationResult = spawnSync(process.execPath, [destinationPath], { cwd: root, encoding: 'utf8' })

    expect(facadeResult.status).toBe(1)
    expect(destinationResult.status).toBe(1)
    expect(facadeResult.stdout).toBe(destinationResult.stdout)
    expect(facadeResult.stderr).toBe(destinationResult.stderr)

    writeFileSync(join(root, '.env.example'), 'PAYLOAD_SECRET=\nDATABASE_URL=<DATABASE_URL>\n')
    const passingResult = spawnSync(process.execPath, [facadePath], { cwd: root, encoding: 'utf8' })

    expect(passingResult.status).toBe(0)
    expect(passingResult.stdout).toBe('Env placeholder guard passed.\n')
    expect(passingResult.stderr).toBe('')
  })
})
