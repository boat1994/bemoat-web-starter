import { describe, expect, it } from 'vitest'

describe('repository safety guard', () => {
  it('exports guard helpers for reuse', async () => {
    const mod = await import('../../scripts/guard-repo-safety.mjs')

    expect(mod.APPROVAL_MARKER).toBe('bemoat:destructive-migration-approved')
    expect(mod.ALLOWED_ENV_FILES.has('.env.example')).toBe(true)
    expect(mod.shouldSkipPath('node_modules/foo/bar.js')).toBe(true)
    expect(mod.shouldSkipPath('src/app/page.tsx')).toBe(false)
  })

  it('flags tracked env files except .env.example', async () => {
    const mod = await import('../../scripts/guard-repo-safety.mjs')

    expect(mod.isForbiddenEnvFile('.env')).toBe(true)
    expect(mod.isForbiddenEnvFile('.env.local')).toBe(true)
    expect(mod.isForbiddenEnvFile('.env.example')).toBe(false)
  })

  it('detects obvious secret patterns', async () => {
    const mod = await import('../../scripts/guard-repo-safety.mjs')

    const violations = mod.scanSecrets('scripts/example.sh', 'export TOKEN=ghp_abcdefghijklmnopqrstuvwxyz1234567890')

    expect(violations.some((item) => item.rule === 'github-token')).toBe(true)
  })

  it('ignores placeholder secret assignments', async () => {
    const mod = await import('../../scripts/guard-repo-safety.mjs')

    const violations = mod.scanSecrets('scripts/example.sh', 'PAYLOAD_SECRET=ignore')

    expect(violations).toEqual([])
  })

  it('flags Cloudflare resource IDs outside wrangler.jsonc', async () => {
    const mod = await import('../../scripts/guard-repo-safety.mjs')

    const violations = mod.scanResourceIds(
      'scripts/example.json',
      '"database_id": "9ac7fb60-ab4b-4c78-a20e-ca9d8c8f59a7"',
    )

    expect(violations.some((item) => item.rule === 'd1-database-id')).toBe(true)
    expect(mod.scanResourceIds('wrangler.jsonc', '"database_id": "9ac7fb60-ab4b-4c78-a20e-ca9d8c8f59a7"')).toEqual([])
  })

  it('flags destructive migration keywords in up sections only', async () => {
    const mod = await import('../../scripts/guard-repo-safety.mjs')

    const migration = `
export async function up() {
  await db.run(sql\`DROP TABLE users;\`)
}

export async function down() {
  await db.run(sql\`DROP TABLE users;\`)
}
`

    const violations = mod.scanDestructiveMigration('src/migrations/example.ts', migration)

    expect(violations).toHaveLength(1)
    expect(violations[0]?.rule).toBe('drop-table')

    const approved = `${mod.APPROVAL_MARKER}\n${migration}`
    expect(mod.scanDestructiveMigration('src/migrations/example.ts', approved)).toEqual([])
  })

  it('passes on the current repository', async () => {
    const mod = await import('../../scripts/guard-repo-safety.mjs')

    const violations = mod.runRepoSafetyGuard()
    expect(mod.getGuardExitCode(violations)).toBe(0)
  })
})
