#!/usr/bin/env node
import { main } from './mission-control/workflows/reopen.mjs'

main().catch((error) => {
  process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
