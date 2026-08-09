import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { createHelpEnvelopeV1, formatTextHelp } from '../../cli/command-help.mjs'
import {
  CliInvocationError,
  parseCommandInvocation,
  resolveCommandIdentity,
} from '../../cli/command-invocation.mjs'
import {
  formatMissionControlContractViolations,
  getMissionControlContractExitCode,
} from './diagnostics.mjs'
import { runMissionControlContractGuard } from './runner.mjs'

export function isDirectExecution() {
  const entrypoint = process.argv[1]
  if (!entrypoint) return false
  return import.meta.url === pathToFileURL(resolve(entrypoint)).href
}

function renderHelp(invocation) {
  if (invocation.format === 'json') {
    process.stdout.write(`${JSON.stringify(createHelpEnvelopeV1(invocation.contract))}\n`)
    return
  }

  process.stdout.write(formatTextHelp(invocation.contract))
}

function handleInvocationError(error) {
  if (!(error instanceof CliInvocationError)) return false

  process.stderr.write(`INVALID_INVOCATION: ${error.details.reason}\n`)
  process.exitCode = error.exit_code
  return true
}

function resolveMissionControlGuardCommand() {
  const lifecycleEvent = process.env.npm_lifecycle_event
  const isRawAlias = lifecycleEvent === 'guard:mission-control-contract'
  const isUnrelatedLifecycle = lifecycleEvent && !lifecycleEvent.startsWith('bemoat:')
  const env = isRawAlias || isUnrelatedLifecycle
    ? { ...process.env, npm_lifecycle_event: undefined }
    : process.env

  return resolveCommandIdentity({
    fallback: 'bemoat:guard:mission-control-contract',
    env,
    entrypoint: 'scripts/guard-mission-control-contract.mjs',
  })
}

export function main() {
  let invocation

  try {
    const command = resolveMissionControlGuardCommand()
    invocation = parseCommandInvocation(command, process.argv.slice(2))
  } catch (error) {
    if (handleInvocationError(error)) return
    throw error
  }

  if (invocation.mode === 'help') {
    renderHelp(invocation)
    return
  }

  const violations = runMissionControlContractGuard()
  const lines = formatMissionControlContractViolations(violations)

  for (const line of lines) console.log(line)

  process.exitCode = getMissionControlContractExitCode(violations)
}
