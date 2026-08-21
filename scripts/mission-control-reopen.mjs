#!/usr/bin/env node
import { createHelpEnvelopeV1 } from './cli/command-help.mjs'
import { parseCommandInvocation, resolveCommandIdentity } from './cli/command-invocation.mjs'
import { main as runReopen, REOPEN_USAGE } from './mission-control/workflows/reopen.mjs'

const COMMAND = 'bemoat:mission-control:reopen'
const ENTRYPOINT = 'scripts/mission-control-reopen.mjs'

function resolveReopenCommand() {
  const env = process.env.npm_lifecycle_event === 'test:int'
    ? { ...process.env, npm_lifecycle_event: undefined }
    : process.env
  return resolveCommandIdentity({ fallback: COMMAND, env, entrypoint: ENTRYPOINT })
}

function renderHelp(invocation) {
  if (invocation.format === 'json') {
    process.stdout.write(`${JSON.stringify(createHelpEnvelopeV1(invocation.contract))}\n`)
    return
  }

  process.stdout.write(`${REOPEN_USAGE}\n`)
}

async function main() {
  const command = resolveReopenCommand()
  const argv = process.argv.slice(2)
  if (argv.some((argument) => argument === '--help' || argument === '-h')) {
    const invocation = parseCommandInvocation(command, argv)
    renderHelp(invocation)
    return
  }

  return runReopen()
}

main().catch((error) => {
  process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
