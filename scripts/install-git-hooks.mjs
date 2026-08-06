#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { createHelpEnvelopeV1, formatTextHelp } from './cli/command-help.mjs'
import {
  CliInvocationError,
  parseCommandInvocation,
  resolveCommandIdentity,
} from './cli/command-invocation.mjs'
import {
  CLI_EXIT_CODES,
  classificationExitCode,
  createResultEnvelopeV1,
} from './cli/command-result.mjs'

const HOOKS_DIR = '.githooks'
const HOOKS = [`${HOOKS_DIR}/pre-commit`, `${HOOKS_DIR}/pre-push`]

function createAmbiguousInstallError(error) {
  const reason = error instanceof Error ? error.message : String(error)
  const partialError = new Error(
    `Hook modes changed, but core.hooksPath could not be configured: ${reason}`,
  )
  partialError.classification = 'AMBIGUOUS_RESULT'
  partialError.mutationPerformed = true
  return partialError
}

export function isDirectExecution() {
  const entrypoint = process.argv[1]

  if (!entrypoint) return false

  return import.meta.url === pathToFileURL(resolve(entrypoint)).href
}

export function installGitHooks({ root = process.cwd() } = {}) {
  const hookPaths = HOOKS.map((hook) => ({ hook, path: resolve(root, hook) }))

  for (const { hook, path } of hookPaths) {
    if (!existsSync(path)) {
      throw new Error(`Missing ${hook}. Cannot install git hooks.`)
    }
  }

  let hookModesChanged = false
  for (const { path } of hookPaths) {
    try {
      chmodSync(path, 0o755)
      hookModesChanged = true
    } catch {
      // Non-fatal on platforms that ignore chmod
    }
  }

  try {
    execFileSync('git', ['config', 'core.hooksPath', HOOKS_DIR], {
      cwd: root,
      stdio: 'inherit',
    })
  } catch (error) {
    if (hookModesChanged) throw createAmbiguousInstallError(error)
    throw error
  }

  return {
    hooks: HOOKS,
    hookModes: HOOKS.map((hook) => ({ path: hook, mode: '755' })),
    hooksPath: HOOKS_DIR,
    mutationPerformed: true,
    legacyClassification: 'INSTALLED',
    legacyOutput: [
      `Installed git hooks from ${HOOKS_DIR}/`,
      'pre-commit runs: bash scripts/check-branch-safety.sh',
      'pre-push runs: branch safety, pnpm run bemoat:guard:safety, bemoat:test:int',
      'pre-push does not run typecheck, lint, or build — add those scripts locally when ready',
      'CI remains the final source of truth for pull requests.',
    ],
  }
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

function resolveHooksCommand() {
  const lifecycleEvent = process.env.npm_lifecycle_event
  const isRawAlias = lifecycleEvent === 'hooks:install'
  const isUnrelatedLifecycle =
    lifecycleEvent &&
    !lifecycleEvent.startsWith('bemoat:') &&
    !isRawAlias
  const env = isRawAlias || isUnrelatedLifecycle
    ? { ...process.env, npm_lifecycle_event: undefined }
    : process.env

  return resolveCommandIdentity({
    fallback: 'bemoat:hooks:install',
    env,
    entrypoint: 'scripts/install-git-hooks.mjs',
  })
}

function runtimeClassification(error) {
  if (
    error &&
    typeof error === 'object' &&
    typeof error.classification === 'string' &&
    Object.hasOwn(CLI_EXIT_CODES, error.classification)
  ) {
    return error.classification
  }

  const reason = error instanceof Error ? error.message : String(error)
  const prefix = reason.match(/^([A-Z_]+):/)
  if (prefix && Object.hasOwn(CLI_EXIT_CODES, prefix[1])) return prefix[1]

  return 'INTERNAL_ERROR'
}

function runtimeDetails(error) {
  if (error instanceof CliInvocationError) {
    return {
      argument: error.details.argument,
      reason: error.details.reason,
    }
  }

  return {
    argument: null,
    reason: error instanceof Error ? error.message : String(error),
  }
}

function renderRuntimeError({ command, format, error }) {
  const classification = runtimeClassification(error)
  const details = runtimeDetails(error)
  const mutationPerformed = Boolean(
    error &&
    typeof error === 'object' &&
    error.mutationPerformed === true,
  )

  if (format === 'json' && command) {
    process.stdout.write(`${JSON.stringify(createResultEnvelopeV1({
      command,
      outcome: 'ERROR',
      classification,
      mutation_performed: mutationPerformed,
      next_action: {
        type: 'STOP',
        command: null,
        reason: details.reason,
      },
      details,
    }))}\n`)
  } else {
    process.stderr.write(`${classification}: ${details.reason}\n`)
  }

  process.exitCode = classificationExitCode(classification)
}

function renderHooksResult({ command, format, result }) {
  const envelope = createResultEnvelopeV1({
    command,
    outcome: 'SUCCESS',
    classification: 'SUCCESS',
    mutation_performed: result.mutationPerformed,
    resulting_state: 'INSTALLED',
    next_action: {
      type: 'COMPLETE',
      command: null,
      reason: 'The approved local hooks are installed.',
    },
    details: {
      hooks: result.hooks,
      hook_modes: result.hookModes,
      hooks_path: result.hooksPath,
      legacy_classification: result.legacyClassification,
      legacy_output: result.legacyOutput,
    },
  })

  if (format === 'json') {
    process.stdout.write(`${JSON.stringify(envelope)}\n`)
    return
  }

  const [firstLine = 'Git hooks installed.', ...remainingLines] = result.legacyOutput
  process.stdout.write(`SUCCESS: ${firstLine}\n`)
  for (const line of remainingLines) process.stdout.write(`${line}\n`)
}

function main() {
  let command
  let invocation

  try {
    command = resolveHooksCommand()
    invocation = parseCommandInvocation(command, process.argv.slice(2))

    if (invocation.mode === 'help') {
      renderHelp(invocation)
      return
    }

    const result = installGitHooks()
    renderHooksResult({
      command,
      format: invocation.format,
      result,
    })
  } catch (error) {
    if (handleInvocationError(error)) return
    renderRuntimeError({
      command,
      format: invocation?.format ?? (process.argv.includes('--json') ? 'json' : 'text'),
      error,
    })
  }
}

if (isDirectExecution()) main()
