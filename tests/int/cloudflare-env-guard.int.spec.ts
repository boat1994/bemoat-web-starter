import { describe, expect, it } from 'vitest'

describe('Cloudflare deploy guard', () => {
  it('keeps the root facade export surface and destination policy exports compatible', async () => {
    const facade = await import('../../scripts/guard-cloudflare-env.ts')
    const destination = await import('../../scripts/guards/cloudflare-env.ts')

    expect(Object.keys(facade).sort()).toEqual([
      'PRODUCTION_ENV_ERROR',
      'assertCloudflareEnvNotProduction',
      'collectD1DatabaseIds',
      'collectR2BucketNames',
      'formatCloudflareDeployGuardViolations',
      'getCloudflareDeployGuardExitCode',
      'isDirectExecution',
      'isWranglerPlaceholderId',
      'parseWranglerJsonc',
      'runCloudflareDeployGuard',
      'scanWranglerEnvironmentIsolation',
      'stripJsoncComments',
    ])
    expect(destination.scanWranglerEnvironmentIsolation).toBe(facade.scanWranglerEnvironmentIsolation)
    expect(destination.runCloudflareDeployGuard).toBe(facade.runCloudflareDeployGuard)
    expect(destination.getCloudflareDeployGuardExitCode([{}])).toBe(1)
  })

  it('blocks CLOUDFLARE_ENV=production', async () => {
    const mod = await import('../../scripts/guard-cloudflare-env.ts')

    const violations = mod.assertCloudflareEnvNotProduction('production')

    expect(violations).toHaveLength(1)
    expect(violations[0]?.rule).toBe('no-production-env')
  })

  it('allows unset or dev CLOUDFLARE_ENV', async () => {
    const mod = await import('../../scripts/guard-cloudflare-env.ts')

    expect(mod.assertCloudflareEnvNotProduction(undefined)).toEqual([])
    expect(mod.assertCloudflareEnvNotProduction('dev')).toEqual([])
  })

  it('flags env.production in wrangler.jsonc', async () => {
    const mod = await import('../../scripts/guard-cloudflare-env.ts')

    const violations = mod.scanWranglerEnvironmentIsolation(`{
      "name": "my-app",
      "env": {
        "production": { "name": "my-app-prod" }
      }
    }`)

    expect(violations.some((item) => item.rule === 'no-env-production')).toBe(true)
  })

  it('flags dev D1 and R2 when they match production resources', async () => {
    const mod = await import('../../scripts/guard-cloudflare-env.ts')

    const violations = mod.scanWranglerEnvironmentIsolation(`{
      "name": "my-app",
      "d1_databases": [
        { "binding": "D1", "database_id": "9ac7fb60-ab4b-4c78-a20e-ca9d8c8f59a7", "database_name": "my-app" }
      ],
      "r2_buckets": [
        { "binding": "R2", "bucket_name": "my-app", "preview_bucket_name": "my-app" }
      ],
      "env": {
        "dev": {
          "name": "my-app-dev",
          "d1_databases": [
            { "binding": "D1", "database_id": "9ac7fb60-ab4b-4c78-a20e-ca9d8c8f59a7", "database_name": "my-app-dev" }
          ],
          "r2_buckets": [
            { "binding": "R2", "bucket_name": "my-app", "preview_bucket_name": "my-app-dev" }
          ]
        }
      }
    }`)

    expect(violations.some((item) => item.rule === 'dev-d1-isolated')).toBe(true)
    expect(violations.some((item) => item.rule === 'dev-r2-isolated')).toBe(true)
  })

  it('passes starter template with placeholder dev D1 and isolated dev R2', async () => {
    const mod = await import('../../scripts/guard-cloudflare-env.ts')

    const violations = mod.scanWranglerEnvironmentIsolation(`{
      "name": "bemoat-web-starter",
      "d1_databases": [
        { "binding": "D1", "database_id": "9ac7fb60-ab4b-4c78-a20e-ca9d8c8f59a7", "database_name": "bemoat-web-starter" }
      ],
      "r2_buckets": [
        { "binding": "R2", "bucket_name": "bemoat-web-starter", "preview_bucket_name": "bemoat-web-starter" }
      ],
      "env": {
        "dev": {
          "name": "bemoat-web-starter-dev",
          "d1_databases": [
            { "binding": "D1", "database_id": "DEV_DATABASE_ID", "database_name": "bemoat-web-starter-dev" }
          ],
          "r2_buckets": [
            { "binding": "R2", "bucket_name": "bemoat-web-starter-dev", "preview_bucket_name": "bemoat-web-starter-dev" }
          ]
        }
      }
    }`)

    expect(violations).toEqual([])
  })

  it('passes on the current repository wrangler.jsonc via guard:safety', async () => {
    const mod = await import('../../scripts/guards/repo-safety.ts')

    const violations = mod.runRepoSafetyGuard()
    expect(mod.getGuardExitCode(violations)).toBe(0)
  })
})
