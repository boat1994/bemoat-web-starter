#!/usr/bin/env node
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { createHelpEnvelopeV1, formatTextHelp } from './cli/command-help.ts'
import {
  CliInvocationError,
  parseCommandInvocation,
  resolveCommandIdentity,
  type ParsedInvocation,
} from './cli/command-invocation.ts'
import {
  formatHarnessContractViolations,
  runHarnessContractGuard,
} from './guard-harness-contract.ts'
import {
  GUARD_PACK,
  flattenGuardPackViolations,
  formatGuardPackResults,
  getGuardPackExitCode,
  runGuardPack,
} from './guards/pack.ts'

function assertHarnessContractGuardIdentity(): void {
  const harnessContractGuard = GUARD_PACK.find((guard) => guard.id === 'harness-contract')

  if (
    !harnessContractGuard ||
    harnessContractGuard.run !== runHarnessContractGuard ||
    harnessContractGuard.format !== formatHarnessContractViolations
  ) {
    throw new Error('GUARD_PACK harness-contract entry must use the stable facade functions')
  }
}

assertHarnessContractGuardIdentity()

export {
  GUARD_PACK,
  flattenGuardPackViolations,
  formatGuardPackResults,
  getGuardPackExitCode,
  runGuardPack,
}

export function isDirectExecution(): boolean {
  const entrypoint = process.argv[1]
  if (!entrypoint) return false
  return import.meta.url === pathToFileURL(resolve(entrypoint)).href
}

function renderHelp(invocation: ParsedInvocation): void {
  if (invocation.format === 'json') {
    process.stdout.write(`${JSON.stringify(createHelpEnvelopeV1(invocation.contract))}\n`)
    return
  }

  process.stdout.write(formatTextHelp(invocation.contract))
}

function handleInvocationError(error: unknown): boolean {
  if (!(error instanceof CliInvocationError)) return false

  process.stderr.write(`INVALID_INVOCATION: ${error.details.reason}\n`)
  process.exitCode = error.exit_code
  return true
}

function resolveGuardPackCommand(): string {
  const lifecycleAliases: Record<string, string> = {
    'guard:pack': 'bemoat:guard:pack',
    'guard:safety': 'bemoat:guard:safety',
  }
  const lifecycleEvent = process.env.npm_lifecycle_event
  const lifecycleAlias = lifecycleEvent ? lifecycleAliases[lifecycleEvent] : undefined
  const fallback = lifecycleAlias ?? 'bemoat:guard:pack'
  const isUnrelatedLifecycle =
    lifecycleEvent &&
    !lifecycleEvent.startsWith('bemoat:') &&
    !lifecycleAlias
  const env = lifecycleAlias || isUnrelatedLifecycle
    ? { ...process.env, npm_lifecycle_event: undefined }
    : process.env

  return resolveCommandIdentity({
    fallback,
    env,
    entrypoint: 'scripts/guard-pack.ts',
  })
}

function main(): void {
  let invocation: ParsedInvocation

  try {
    const command = resolveGuardPackCommand()
    invocation = parseCommandInvocation(command, process.argv.slice(2))
  } catch (error) {
    if (handleInvocationError(error)) return
    throw error
  }

  if (invocation.mode === 'help') {
    renderHelp(invocation)
    return
  }

  const results = runGuardPack()
  const lines = formatGuardPackResults(results)

  for (const line of lines) console.log(line)

  const exitCode = getGuardPackExitCode(results)
  process.exitCode = exitCode
}

if (isDirectExecution()) main()
