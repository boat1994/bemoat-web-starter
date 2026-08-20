#!/usr/bin/env node
import { main } from './mission-control/workflows/authorize-founder.mjs'

main().catch(() => {
  process.exitCode = 1
})
