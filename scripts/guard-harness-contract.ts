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

export {
  CHILD_FACING_HARNESS_PATHS,
  FORBIDDEN_RAW_SCRIPTS,
  extractPnpmRunScripts,
  findForbiddenRawScriptCalls,
  scanChildFacingHarnessFile,
  runHarnessContractGuard,
  getHarnessContractExitCode,
  formatHarnessContractViolations,
} from './harness-contract/child-script-policy.ts'

export { parseRuntimeImportSpecifiers } from './harness-contract/runtime-import-parser.ts'

export {
  MANAGED_RUNTIME_ROOT_PREFIX,
  ManagedRuntimeDeliveryClosureError,
  isManagedPath,
  isBuiltinOrPackageSpecifier,
  resolveRelativeRuntimeCallee,
  collectManagedRuntimeScriptRoots,
  collectExplicitManagedRuntimeScriptPaths,
  scanManagedRuntimeDeliveryClosure,
  formatManagedRuntimeDeliveryViolations,
  assertManagedRuntimeDeliveryClosure,
} from './harness-contract/managed-runtime-closure.ts'

export { loadManagedPathsFromManifest } from './harness-contract/manifest.ts'

import {
  runHarnessContractGuard,
  getHarnessContractExitCode,
  formatHarnessContractViolations,
} from './harness-contract/child-script-policy.ts'
import {
  scanManagedRuntimeDeliveryClosure,
  formatManagedRuntimeDeliveryViolations,
} from './harness-contract/managed-runtime-closure.ts'
import { loadManagedPathsFromManifest } from './harness-contract/manifest.ts'

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

function getFacadeEnvironment(): NodeJS.ProcessEnv {
  const lifecycleEvent = process.env.npm_lifecycle_event
  if (!lifecycleEvent || lifecycleEvent.startsWith('bemoat:')) return process.env

  return { ...process.env, npm_lifecycle_event: undefined }
}

function main(): void {
  let invocation: ParsedInvocation

  try {
    const command = resolveCommandIdentity({
      fallback: 'bemoat:guard:harness-contract',
      env: getFacadeEnvironment(),
      entrypoint: 'scripts/guard-harness-contract.ts',
    })
    invocation = parseCommandInvocation(command, process.argv.slice(2))
  } catch (error) {
    if (handleInvocationError(error)) return
    throw error
  }

  if (invocation.mode === 'help') {
    renderHelp(invocation)
    return
  }

  const root = process.cwd()
  const childFacingViolations = runHarnessContractGuard({ root })
  const managedPaths = loadManagedPathsFromManifest(root)
  const runtimeViolations = managedPaths
    ? scanManagedRuntimeDeliveryClosure({ root, managedPaths })
    : []

  const lines =
    runtimeViolations.length > 0
      ? formatManagedRuntimeDeliveryViolations(runtimeViolations)
      : formatHarnessContractViolations(childFacingViolations)

  for (const line of lines) console.log(line)

  const exitCode =
    runtimeViolations.length > 0
      ? 1
      : getHarnessContractExitCode(childFacingViolations)

  process.exitCode = exitCode
}

if (isDirectExecution()) main()
