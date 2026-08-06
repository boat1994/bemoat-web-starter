#!/usr/bin/env node
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { createHelpEnvelopeV1, formatTextHelp } from './cli/command-help.mjs'
import {
  CliInvocationError,
  parseCommandInvocation,
  resolveCommandIdentity,
} from './cli/command-invocation.mjs'

export {
  CHILD_FACING_HARNESS_PATHS,
  FORBIDDEN_RAW_SCRIPTS,
  extractPnpmRunScripts,
  findForbiddenRawScriptCalls,
  scanChildFacingHarnessFile,
  runHarnessContractGuard,
  getHarnessContractExitCode,
  formatHarnessContractViolations,
} from './harness-contract/child-script-policy.mjs'

export { parseRuntimeImportSpecifiers } from './harness-contract/runtime-import-parser.mjs'

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
} from './harness-contract/managed-runtime-closure.mjs'

export { loadManagedPathsFromManifest } from './harness-contract/manifest.mjs'

import {
  runHarnessContractGuard,
  getHarnessContractExitCode,
  formatHarnessContractViolations,
} from './harness-contract/child-script-policy.mjs'
import {
  scanManagedRuntimeDeliveryClosure,
  formatManagedRuntimeDeliveryViolations,
} from './harness-contract/managed-runtime-closure.mjs'
import { loadManagedPathsFromManifest } from './harness-contract/manifest.mjs'

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

function getFacadeEnvironment() {
  const lifecycleEvent = process.env.npm_lifecycle_event
  if (!lifecycleEvent || lifecycleEvent.startsWith('bemoat:')) return process.env

  return { ...process.env, npm_lifecycle_event: undefined }
}

function main() {
  let invocation

  try {
    const command = resolveCommandIdentity({
      fallback: 'bemoat:guard:harness-contract',
      env: getFacadeEnvironment(),
      entrypoint: 'scripts/guard-harness-contract.mjs',
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
