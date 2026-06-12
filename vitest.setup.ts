// Any setup scripts you might need go here

process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs'

// Load .env files
import 'dotenv/config'
