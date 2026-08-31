import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const root = resolve(process.cwd())
const tempRoots: string[] = []
const oracle = [
  ['tests/int/stateless-public-contract.int.spec.ts', '85464f7dc4b16c3d7684cf822bcfc454735949f0da78aea3b9734caf6e179340'],
] as const
const productionExtensions = ['.mjs', '.ts'] as const
const grandfathered = [
  ['scripts/boilerplate/filesystem.ts', 635],
  ['scripts/boilerplate/workflow.ts', 465],
  ['scripts/cli/command-contract-registry.ts', 870], ['scripts/cli/command-contract.ts', 580],
] as const

afterEach(() => tempRoots.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })))

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    production_scripts: {
      root: 'scripts', extensions: [...productionExtensions], line_count_algorithm: 'physical-lines-v1', soft_ceiling: 400,
      grandfathered: grandfathered.map(([path, max_lines]) => ({ path, max_lines })),
    },
    protected_oracle: { algorithm: 'sha256', files: oracle.map(([path, sha256]) => ({ path, sha256 })) },
    ...overrides,
  }
}

function write(rootPath: string, path: string, content: string) {
  mkdirSync(join(rootPath, path, '..'), { recursive: true })
  writeFileSync(join(rootPath, path), content)
}

function scriptInventory(path: string) {
  return readdirSync(join(path, 'scripts'), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && productionExtensions.some((extension) => entry.name.endsWith(extension))).length
}

function fixture() {
  const path = mkdtempSync(join(tmpdir(), 'structural-protection-'))
  tempRoots.push(path)
  for (const [file] of oracle) {
    mkdirSync(join(path, file, '..'), { recursive: true })
    cpSync(join(root, file), join(path, file))
  }
  write(path, 'scripts/small.mjs', 'export {}\n')
  write(path, 'scripts/structural-protection-manifest.json', `${JSON.stringify(manifest(), null, 2)}\n`)
  return path
}

function saveManifest(path: string, value: unknown) {
  writeFileSync(join(path, 'scripts/structural-protection-manifest.json'), `${JSON.stringify(value, null, 2)}\n`)
}

async function guard(path = root) {
  const mod = await import('../../scripts/guards/structural-protection.ts')
  return mod.runStructuralProtectionGuard(path)
}

describe('structural protection guard', () => {
  it('accepts the current repository with the exact inventory, baseline, and protected oracle', async () => {
    expect((await guard()).map((entry: { rule: string }) => entry.rule)).toEqual([])
    expect(grandfathered).toHaveLength(4)
    expect(JSON.parse(readFileSync(join(root, 'scripts/structural-protection-manifest.json'), 'utf8'))).toEqual(manifest())
    expect(scriptInventory(root)).toBe(72)
  })

  it('keeps the planning runtime within the default ceiling without a grandfathered exception', async () => {
    const structuralManifest = JSON.parse(
      readFileSync(join(root, 'scripts/structural-protection-manifest.json'), 'utf8'),
    ) as { production_scripts: { grandfathered: Array<{ path: string }> } }
    expect(structuralManifest.production_scripts.grandfathered).not.toContainEqual({
      path: 'scripts/guards/planning-contract-runtime.ts',
    })

    const mod = await import('../../scripts/guards/structural-protection.ts')
    expect(
      mod.countPhysicalLines(readFileSync(join(root, 'scripts/guards/planning-contract-runtime.ts'))),
    ).toBeLessThanOrEqual(400)
  })

  it('keeps Task 4 modules within their pre-existing ceilings without new exceptions', async () => {
    const structuralManifest = JSON.parse(
      readFileSync(join(root, 'scripts/structural-protection-manifest.json'), 'utf8'),
    ) as { production_scripts: { grandfathered: Array<{ path: string; max_lines: number }> } }
    expect(structuralManifest.production_scripts.grandfathered).toEqual(
      expect.arrayContaining([
        { path: 'scripts/boilerplate/filesystem.ts', max_lines: 635 },
        { path: 'scripts/boilerplate/workflow.ts', max_lines: 465 },
      ]),
    )
    expect(structuralManifest.production_scripts.grandfathered).not.toEqual(
      expect.arrayContaining([
        { path: 'scripts/boilerplate/workflows/check-boilerplate-drift.ts', max_lines: expect.any(Number) },
        { path: 'scripts/check-boilerplate-drift.ts', max_lines: expect.any(Number) },
      ]),
    )

    const mod = await import('../../scripts/guards/structural-protection.ts')
    for (const [path, maxLines] of grandfathered.slice(0, 2)) {
      expect(mod.countPhysicalLines(readFileSync(join(root, path)))).toBeLessThanOrEqual(maxLines)
    }
    expect(
      mod.countPhysicalLines(readFileSync(join(root, 'scripts/boilerplate/workflows/check-boilerplate-drift.ts'))),
    ).toBeLessThanOrEqual(400)
    expect(
      mod.countPhysicalLines(readFileSync(join(root, 'scripts/check-boilerplate-drift.ts'))),
    ).toBeLessThanOrEqual(400)
  })

  it('rejects malformed schema, types, unknown keys, ordering, duplicates, paths, and SHA values', async () => {
    const cases: Record<string, unknown>[] = [
      { schema_version: '1' }, { extra: true }, { production_scripts: [] },
      { production_scripts: { ...manifest().production_scripts, soft_ceiling: 401 } },
      { protected_oracle: { ...manifest().protected_oracle, files: [...manifest().protected_oracle.files, manifest().protected_oracle.files[0]] } },
      { protected_oracle: { ...manifest().protected_oracle, files: [{ path: '../bad', sha256: 'a'.repeat(64) }] } },
      { protected_oracle: { ...manifest().protected_oracle, files: [{ path: oracle[0][0], sha256: 'A'.repeat(64) }] } },
      { production_scripts: { ...manifest().production_scripts, grandfathered: [{ path: grandfathered[0][0], max_lines: 0 }] } },
    ]
    for (const change of cases) {
      const path = fixture()
      saveManifest(path, { ...manifest(), ...change })
      expect(await guard(path), JSON.stringify(change)).not.toEqual([])
    }
  })

  it('counts physical LF and CRLF lines including a final non-newline line', async () => {
    const mod = await import('../../scripts/guards/structural-protection.ts')
    expect(mod.countPhysicalLines(Buffer.from('a\nb\n'))).toBe(2)
    expect(mod.countPhysicalLines(Buffer.from('a\r\nb\r\n'))).toBe(2)
    expect(mod.countPhysicalLines(Buffer.from('a\nb'))).toBe(2)
    expect(mod.countPhysicalLines(Buffer.alloc(0))).toBe(0)
  })

  it('enforces new, existing, grandfathered, deleted, and renamed script line limits', async () => {
    const path = fixture()
    write(path, 'scripts/new.mjs', `${'x\n'.repeat(401)}`)
    expect(await guard(path)).not.toEqual([])
    write(path, 'scripts/new.mjs', `${'x\n'.repeat(400)}`)
    expect(await guard(path)).toEqual([])
    write(path, 'scripts/new.ts', `${'x\n'.repeat(401)}`)
    expect(await guard(path)).not.toEqual([])
    write(path, 'scripts/new.ts', `${'x\n'.repeat(400)}`)
    expect(await guard(path)).toEqual([])
    write(path, grandfathered[0][0], `${'x\n'.repeat(grandfathered[0][1] + 1)}`)
    expect(await guard(path)).not.toEqual([])
    unlinkSync(join(path, grandfathered[0][0]))
    expect(await guard(path)).toEqual([])
    write(path, 'scripts/moved.mjs', `${'x\n'.repeat(401)}`)
    expect(await guard(path)).not.toEqual([])
  })

  it('rejects changed, missing, symlinked, duplicate, reordered, or extra protected oracle entries', async () => {
    const changed = fixture()
    writeFileSync(join(changed, oracle[0][0]), `${readFileSync(join(changed, oracle[0][0]), 'utf8')}// changed\n`)
    expect(await guard(changed)).not.toEqual([])
    const missing = fixture()
    unlinkSync(join(missing, oracle[0][0]))
    expect(await guard(missing)).not.toEqual([])
    const linked = fixture()
    unlinkSync(join(linked, oracle[0][0]))
    symlinkSync(join(root, oracle[0][0]), join(linked, oracle[0][0]))
    expect(await guard(linked)).not.toEqual([])
    const entries = fixture()
    saveManifest(entries, manifest({ protected_oracle: { algorithm: 'sha256', files: [
      { path: oracle[0][0], sha256: oracle[0][1] }, { path: oracle[0][0], sha256: oracle[0][1] },
    ] } }))
    expect(await guard(entries)).not.toEqual([])
  })

  it('detects representative skip, only, todo, and assertion-byte oracle changes by fingerprint', async () => {
    for (const token of ['.skip(', '.only(', 'todo(', 'expect(true).toBe(true)']) {
      const path = fixture()
      writeFileSync(join(path, oracle[0][0]), `${readFileSync(join(path, oracle[0][0]), 'utf8')}\n${token}\n`)
      expect(await guard(path), token).not.toEqual([])
    }
  })
})
