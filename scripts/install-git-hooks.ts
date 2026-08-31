#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { createHelpEnvelopeV1, formatTextHelp } from './cli/command-help.ts'
import {
  CliInvocationError,
  parseCommandInvocation,
  resolveCommandIdentity,
} from './cli/command-invocation.ts'
import {
  CLI_EXIT_CODES,
  classificationExitCode,
  createResultEnvelopeV1,
} from './cli/command-result.ts'
import type { ParsedInvocation } from './cli/command-invocation.ts'
import type { CliClassification } from './cli/command-result.ts'

const HOOKS_DIR = '.githooks'
const HOOKS = [`${HOOKS_DIR}/pre-commit`, `${HOOKS_DIR}/pre-push`]

interface HookInstallResult {
  hooks: string[]
  hookModes: Array<{ path: string; mode: '755' }>
  hooksPath: string
  mutationPerformed: true
  legacyClassification: 'INSTALLED'
  legacyOutput: string[]
}

interface RuntimeDetails {
  argument: string | null
  reason: string
  legacy_output?: string[]
  cleanup_error?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isCliClassification(value: unknown): value is CliClassification {
  return typeof value === 'string' && Object.hasOwn(CLI_EXIT_CODES, value)
}

function createAmbiguousInstallError(error: unknown): Error & {
  classification: 'AMBIGUOUS_RESULT'
  mutationPerformed: true
} {
  const reason = error instanceof Error ? error.message : String(error)
  const partialError = new Error(
    `Hook modes changed, but core.hooksPath could not be configured: ${reason}`,
  )
  return Object.assign(partialError, {
    classification: 'AMBIGUOUS_RESULT' as const,
    mutationPerformed: true as const,
  })
}

function writeCapturedGitStdout(output: unknown): void {
  if (!output) return
  const text = Buffer.isBuffer(output) ? output.toString('utf8') : String(output)
  if (text) process.stderr.write(text)
}

export function isDirectExecution(): boolean {
  const entrypoint = process.argv[1]

  if (!entrypoint) return false

  return import.meta.url === pathToFileURL(resolve(entrypoint)).href
}

export function installGitHooks({
  root = process.cwd(),
  captureGitStdout = false,
}: { root?: string; captureGitStdout?: boolean } = {}): HookInstallResult {
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
    const gitStdout = execFileSync(
      'git',
      ['config', 'core.hooksPath', HOOKS_DIR],
      captureGitStdout
        ? {
          cwd: root,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'inherit'],
        }
        : {
          cwd: root,
          stdio: 'inherit',
        },
    )
    if (captureGitStdout) writeCapturedGitStdout(gitStdout)
  } catch (error) {
    if (captureGitStdout && isRecord(error)) {
      writeCapturedGitStdout(error['stdout'])
    }
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

function renderHelp(invocation: Extract<ParsedInvocation, { mode: 'help' }>): void {
  if (invocation.format === 'json') {
    process.stdout.write(`${JSON.stringify(createHelpEnvelopeV1(invocation.contract))}\n`)
    return
  }

  process.stdout.write(formatTextHelp(invocation.contract))
}

function handleInvocationError(
  error: unknown,
  { command, format }: { command: string; format: 'text' | 'json' },
): boolean {
  if (!(error instanceof CliInvocationError)) return false

  renderRuntimeError({ command, format, error })
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
    entrypoint: 'scripts/install-git-hooks.ts',
  })
}

function runtimeClassification(error: unknown): CliClassification | 'INTERNAL_ERROR' {
  if (
    isRecord(error) &&
    isCliClassification(error.classification)
  ) {
    return error.classification
  }

  const reason = error instanceof Error ? error.message : String(error)
  const prefix = reason.match(/^([A-Z_]+):/)
  if (prefix && isCliClassification(prefix[1])) return prefix[1]

  return 'INTERNAL_ERROR'
}

function runtimeDetails(error: unknown): RuntimeDetails {
  const details: RuntimeDetails = error instanceof CliInvocationError
    ? {
      argument: error.details.argument,
      reason: error.details.reason,
    }
    : {
      argument: null,
      reason: error instanceof Error ? error.message : String(error),
  }

  if (isRecord(error)) {
    if (Array.isArray(error['legacyOutput'])) {
      details.legacy_output = error['legacyOutput'].filter((line): line is string => typeof line === 'string')
    }
    if (typeof error['cleanupError'] === 'string') {
      details.cleanup_error = error['cleanupError']
    }
  }

  return details
}

function renderRuntimeError({
  command,
  format,
  error,
}: {
  command: string
  format: 'text' | 'json'
  error: unknown
}): void {
  const classification = runtimeClassification(error)
  const details = runtimeDetails(error)
  const mutationPerformed = Boolean(
    isRecord(error) &&
    error['mutationPerformed'] === true,
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
    for (const line of details.legacy_output ?? []) {
      process.stderr.write(`${line}\n`)
    }
  }

  process.exitCode = classificationExitCode(classification)
}

function renderHooksResult({
  command,
  format,
  result,
}: {
  command: string
  format: 'text' | 'json'
  result: HookInstallResult
}): void {
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
  let command: string | undefined
  let invocation: ParsedInvocation | undefined

  try {
    command = resolveHooksCommand()
    invocation = parseCommandInvocation(command, process.argv.slice(2))

    if (invocation.mode === 'help') {
      renderHelp(invocation)
      return
    }

    const result = installGitHooks({
      captureGitStdout: invocation.format === 'json',
    })
    renderHooksResult({
      command,
      format: invocation.format,
      result,
    })
  } catch (error) {
    const format = invocation?.format ?? (process.argv.includes('--json') ? 'json' : 'text')
    const outputCommand = command ?? 'bemoat:hooks:install'
    if (handleInvocationError(error, { command: outputCommand, format })) return
    renderRuntimeError({
      command: outputCommand,
      format,
      error,
    })
  }
}

if (isDirectExecution()) main()
