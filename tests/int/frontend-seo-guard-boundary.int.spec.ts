import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it } from 'vitest'

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('frontend SEO guard boundary', () => {
  it('preserves the root facade export surface while delegating policy exports inward', async () => {
    const facade = await import('../../scripts/guard-frontend-seo.mjs')
    const destination = await import('../../scripts/guards/frontend-seo.mjs')

    expect(Object.keys(facade).sort()).toEqual([
      'FRONTEND_LAYOUT_PATH',
      'OPTIONAL_SEO_PATHS',
      'formatFrontendSeoViolations',
      'getFrontendSeoGuardExitCode',
      'isDirectExecution',
      'runFrontendSeoGuard',
      'scanFrontendLayoutMetadata',
      'scanOptionalSeoFile',
    ])
    expect(Object.keys(destination).sort()).toEqual([
      'FRONTEND_LAYOUT_PATH',
      'OPTIONAL_SEO_PATHS',
      'formatFrontendSeoViolations',
      'getFrontendSeoGuardExitCode',
      'isDirectExecution',
      'main',
      'runFrontendSeoGuard',
      'scanFrontendLayoutMetadata',
      'scanOptionalSeoFile',
    ])
    expect(facade.runFrontendSeoGuard).toBe(destination.runFrontendSeoGuard)
    expect(facade.scanFrontendLayoutMetadata).toBe(destination.scanFrontendLayoutMetadata)
    expect(facade.scanOptionalSeoFile).toBe(destination.scanOptionalSeoFile)
    expect(facade.formatFrontendSeoViolations).toBe(destination.formatFrontendSeoViolations)
    expect(facade.getFrontendSeoGuardExitCode([{}])).toBe(1)
  })

  it('preserves direct invocation output and exit codes through the root facade', () => {
    const root = mkdtempSync(join(tmpdir(), 'frontend-seo-boundary-'))
    tempRoots.push(root)
    const facadePath = resolve(process.cwd(), 'scripts/guard-frontend-seo.mjs')
    const destinationPath = resolve(process.cwd(), 'scripts/guards/frontend-seo.mjs')

    const facadeResult = spawnSync(process.execPath, [facadePath], { cwd: root, encoding: 'utf8' })
    const destinationResult = spawnSync(process.execPath, [destinationPath], { cwd: root, encoding: 'utf8' })

    expect(facadeResult.status).toBe(0)
    expect(destinationResult.status).toBe(0)
    expect(facadeResult.stdout).toBe(destinationResult.stdout)
    expect(facadeResult.stderr).toBe(destinationResult.stderr)

    mkdirSync(join(root, 'src/app/(frontend)'), { recursive: true })
    writeFileSync(join(root, 'src/app/(frontend)/layout.tsx'), 'export default function Layout() { return null }\n')
    const failingResult = spawnSync(process.execPath, [facadePath], { cwd: root, encoding: 'utf8' })

    expect(failingResult.status).toBe(1)
    expect(failingResult.stdout).toContain('Frontend SEO guard failed:')
    expect(failingResult.stderr).toBe('')
  })
})
