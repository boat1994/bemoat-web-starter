#!/usr/bin/env tsx

const USAGE = `Usage: BEMOAT_SMOKE_BASE_URL=https://your-domain.example pnpm run smoke:deploy

Read-only HTTP smoke test for a deployed Bemoat site.
Checks GET / and GET /admin (no credentials, no data mutation).
Exits 1 if BEMOAT_SMOKE_BASE_URL is missing or a required endpoint fails.`

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error('BEMOAT_SMOKE_BASE_URL must start with http:// or https://')
  }
  return trimmed
}

interface EndpointCheckResult {
  url: string
  status: number
  ok: boolean
}

async function checkEndpoint(baseUrl: string, path: string): Promise<EndpointCheckResult> {
  const url = `${baseUrl}${path}`
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
  })

  return { url, status: response.status, ok: response.ok }
}

async function main(): Promise<void> {
  const rawBaseUrl = process.env.BEMOAT_SMOKE_BASE_URL

  if (!rawBaseUrl) {
    console.error('Error: BEMOAT_SMOKE_BASE_URL is not set.\n')
    console.error(USAGE)
    process.exit(1)
  }

  let baseUrl: string
  try {
    baseUrl = normalizeBaseUrl(rawBaseUrl)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Error: ${message}\n`)
    console.error(USAGE)
    process.exit(1)
  }

  const endpoints = ['/', '/admin']
  let failed = false

  console.log(`Smoke testing ${baseUrl}`)

  for (const path of endpoints) {
    try {
      const result = await checkEndpoint(baseUrl, path)
      const label = result.ok ? 'OK' : 'FAIL'
      console.log(`[${label}] ${result.status} ${result.url}`)

      if (!result.ok) {
        failed = true
      }
    } catch (error) {
      failed = true
      const message = error instanceof Error ? error.message : String(error)
      console.log(`[FAIL] ${baseUrl}${path} — ${message}`)
    }
  }

  if (failed) {
    console.error('\nDeploy smoke test failed. See docs/deploy-smoke-test.md for manual checks and triage.')
    process.exit(1)
  }

  console.log('\nDeploy smoke test passed (/ and /admin). Run the manual checklist in docs/deploy-smoke-test.md for full coverage.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
