#!/usr/bin/env node
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export {
  createHelpEnvelopeV1,
  formatTextHelp,
} from './command-help.ts'

import { runCommandHelpMain } from './command-help.ts'

function isDirectExecution() {
  return Boolean(
    process.argv[1] &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url),
  )
}

if (isDirectExecution()) {
  process.exitCode = runCommandHelpMain()
}
