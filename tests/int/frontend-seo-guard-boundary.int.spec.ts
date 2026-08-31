import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it } from 'vitest'

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('frontend SEO guard boundary', () => {
  it('keeps the owned destination authoritative after root facade removal', async () => {
    const destination = await import('../../scripts/guards/frontend-seo.ts')

    expect(existsSync(resolve(process.cwd(), 'scripts/guard-frontend-seo.mjs'))).toBe(false)
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
    expect(destination.getFrontendSeoGuardExitCode([{}])).toBe(1)
  })

  it('preserves direct invocation output and exit codes at the owned destination', () => {
    const root = mkdtempSync(join(tmpdir(), 'frontend-seo-boundary-'))
    tempRoots.push(root)
    const destinationPath = resolve(process.cwd(), 'scripts/guards/frontend-seo.ts')

    const destinationResult = spawnSync(process.execPath, [destinationPath], { cwd: root, encoding: 'utf8' })

    expect(destinationResult.status).toBe(0)

    mkdirSync(join(root, 'src/app/(frontend)'), { recursive: true })
    writeFileSync(join(root, 'src/app/(frontend)/layout.tsx'), 'export default function Layout() { return null }\n')
    const failingResult = spawnSync(process.execPath, [destinationPath], { cwd: root, encoding: 'utf8' })

    expect(failingResult.status).toBe(1)
    expect(failingResult.stdout).toContain('Frontend SEO guard failed:')
    expect(failingResult.stderr).toBe('')
  })
})
