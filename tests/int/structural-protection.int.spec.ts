import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const root = resolve(process.cwd())
const tempRoots: string[] = []
const oracle = [
  ['tests/int/mission-control-adopt-finding.int.spec.ts', 'ba3ac34c02e6e05c0b94dff857db9d57a2bcc181b74a4d29bd8029f84e79739d'],
  ['tests/int/mission-control-merge-verdict-binding-entrypoint.int.spec.ts', 'c780c36f4fcc3d386be6b3dcb5a86f16b1030a1446cfe59a9fefe83f1dc54b65'],
  ['tests/int/mission-control-merge.int.spec.ts', '2dfb92137dc35d5cd3ab718ff330bde87ae933891cbeaf077baf374a497f2d6e'],
] as const
const productionExtensions = ['.mjs', '.ts'] as const
const grandfathered = [
  ['scripts/agent-delivery.mjs', 686], ['scripts/agent-issue/current-post-budget-authority.mjs', 646],
  ['scripts/agent-issue/progress-tracking.mjs', 462], ['scripts/boilerplate/filesystem.mjs', 635],
  ['scripts/boilerplate/workflow.mjs', 465], ['scripts/check-boilerplate-drift.mjs', 552],
  ['scripts/cli/command-contract-registry.mjs', 837], ['scripts/cli/command-contract.mjs', 577],
  ['scripts/mission-control-dispatch.mjs', 545],
  ['scripts/mission-control-reconcile.mjs', 143],
  ['scripts/mission-control-review.mjs', 346],
  ['scripts/mission-control/domain/campaign-authority.ts', 630], ['scripts/mission-control/domain/campaign-validator.mjs', 482], ['scripts/mission-control/domain/correction-contract.mjs', 650],
  ['scripts/mission-control/domain/recover-state-projection.mjs', 37], ['scripts/mission-control/domain/review-recovery.mjs', 485],
  ['scripts/mission-control/domain/review-result-rendering.ts', 200],
  ['scripts/mission-control/workflows/adopt-finding.mjs', 564],
  ['scripts/mission-control/workflows/issue-body-cas.mjs', 438],
  ['scripts/mission-control/workflows/merge.mjs', 1124],
  ['scripts/mission-control/workflows/recover-review.mjs', 828], ['scripts/mission-control/workflows/recover-state.mjs', 1099],
  ['scripts/mission-control/workflows/reopen.mjs', 918], ['scripts/mission-control/workflows/task-bootstrap.mjs', 658],
  ['scripts/post-role-comment.mjs', 554],
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
  const mod = await import('../../scripts/guards/structural-protection.mjs')
  return mod.runStructuralProtectionGuard(path)
}

describe('structural protection guard', () => {
  it('accepts the current repository with the exact inventory, baseline, and protected oracle', async () => {
    expect((await guard()).map((entry: { rule: string }) => entry.rule)).toEqual([])
    expect(grandfathered).toHaveLength(25)
    expect(JSON.parse(readFileSync(join(root, 'scripts/structural-protection-manifest.json'), 'utf8'))).toEqual(manifest())
    expect(scriptInventory(root)).toBe(226)
  })

  it('rejects malformed schema, types, unknown keys, ordering, duplicates, paths, and SHA values', async () => {
    const cases: Record<string, unknown>[] = [
      { schema_version: '1' }, { extra: true }, { production_scripts: [] },
      { production_scripts: { ...manifest().production_scripts, soft_ceiling: 401 } },
      { protected_oracle: { ...manifest().protected_oracle, files: [...manifest().protected_oracle.files].reverse() } },
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
    const mod = await import('../../scripts/guards/structural-protection.mjs')
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

  it('rejects growth above an accepted ratcheted ceiling', async () => {
    const path = fixture()
    const target = 'scripts/mission-control-reconcile.mjs'
    write(path, target, `${'x\n'.repeat(144)}`)
    expect(await guard(path)).toEqual([{
      rule: 'STRUCT012',
      file: target,
      message: '144 physical lines exceeds the maximum of 143.',
    }])
    write(path, target, `${'x\n'.repeat(143)}`)
    expect(await guard(path)).toEqual([])
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
