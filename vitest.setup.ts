// Any setup scripts you might need go here

process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs'

// Load .env files
import 'dotenv/config'

// Harness int tests use local wrangler bindings only — never remote D1 or interactive schema push.
Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? 'test' })
process.env.PAYLOAD_MIGRATE_REMOTE = 'false'

// Isolated wrangler persist root for integration tests — keeps dev `.wrangler/state` untouched.
process.env.BEMOAT_TEST_WRANGLER_PERSIST ??= '.wrangler-test/state/v3'
