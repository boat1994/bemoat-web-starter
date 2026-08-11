#!/usr/bin/env node
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { createHelpEnvelopeV1, formatTextHelp } from './cli/command-help.mjs'
import {
  CliInvocationError,
  parseCommandInvocation,
  resolveCommandIdentity,
} from './cli/command-invocation.mjs'
import {
  formatBuildScriptContractViolations,
  runBuildScriptContractGuard,
} from './guards/build-script-contract.mjs'
import {
  formatCloudflareDeployGuardViolations,
  runCloudflareDeployGuard,
} from './guards/cloudflare-env.mjs'
import {
  formatEnvPlaceholderViolations,
  runEnvPlaceholderGuard,
} from './guards/env-placeholder.mjs'
import {
  formatFrontendSeoViolations,
  runFrontendSeoGuard,
} from './guards/frontend-seo.mjs'
import {
  formatHarnessContractViolations,
  runHarnessContractGuard,
} from './guard-harness-contract.mjs'
import {
  validateArchitectureContract,
} from './guard-scripts-architecture.mjs'
import {
  formatMissionControlContractViolations,
  runMissionControlContractGuard,
} from './guard-mission-control-contract.mjs'
import {
  formatPlanningContractViolations,
  runPlanningContractGuard,
} from './guard-planning-contract.mjs'
import {
  formatMissionControlDriftViolations,
  runMissionControlDriftGuard,
} from './guard-mission-control-drift.mjs'
import {
  formatPackageManagerViolations,
  runPackageManagerGuard,
} from './guards/package-manager.mjs'
import {
  formatToolchainContractViolations,
  scanToolchainContract,
} from './guard-toolchain-contract.mjs'
import { formatViolations, runRepoSafetyGuard } from './guard-repo-safety.mjs'
import { formatStructuralProtectionViolations, runStructuralProtectionGuard } from './guards/structural-protection.mjs'

/** Ordered central guard pack — each entry is a reusable, deterministic check. */
export const GUARD_PACK = [
  {
    id: 'repo-safety',
    summary: 'Secret leak, tracked env files, Cloudflare resource IDs, destructive SQL',
    run: runRepoSafetyGuard,
    format: formatViolations,
  },
  {
    id: 'harness-contract',
    summary: 'Direct non-namespaced script calls in child-facing harness automation',
    run: runHarnessContractGuard,
    format: formatHarnessContractViolations,
  },
  {
    id: 'build-script-contract',
    summary: 'Next.js build vs Cloudflare OpenNext build script separation',
    run: runBuildScriptContractGuard,
    format: formatBuildScriptContractViolations,
  },
  {
    id: 'package-manager',
    summary: 'Package manager drift (lockfiles and non-pnpm automation commands)',
    run: runPackageManagerGuard,
    format: formatPackageManagerViolations,
  },
  {
    id: 'toolchain-contract',
    summary: 'Managed TypeScript, Node, lockfile, and strict-harness compiler contract',
    run: scanToolchainContract,
    format: formatToolchainContractViolations,
  },
  {
    id: 'env-placeholder',
    summary: 'Safe .env.example placeholder template',
    run: runEnvPlaceholderGuard,
    format: formatEnvPlaceholderViolations,
  },
  {
    id: 'cloudflare-config',
    summary: 'Cloudflare deploy config sanity (wrangler.jsonc isolation, no env.production)',
    run: runCloudflareDeployGuard,
    format: formatCloudflareDeployGuardViolations,
  },
  {
    id: 'frontend-seo',
    summary: 'Frontend metadata and optional sitemap/robots route files',
    run: runFrontendSeoGuard,
    format: formatFrontendSeoViolations,
  },
  {
    id: 'mission-control-contract',
    summary: 'Mission Control guide, loader, templates, sync ownership, and review invariants',
    run: runMissionControlContractGuard,
    format: formatMissionControlContractViolations,
  },
  {
    id: 'planning-contract',
    summary: 'Planning task-identity and execution-base contract across paired spec/plan files',
    run: runPlanningContractGuard,
    format: formatPlanningContractViolations,
  },
  {
    id: 'mission-control-drift',
    summary: 'Mission Control contract drift (e.g. strict review budget limits)',
    run: runMissionControlDriftGuard,
    format: formatMissionControlDriftViolations,
  },
  {
    id: 'structural-protection',
    summary: 'Production script no-growth limits and protected test oracle fingerprints',
    run: (options) => runStructuralProtectionGuard(options?.root || process.cwd()),
    format: formatStructuralProtectionViolations,
  },
  {
    id: 'scripts-architecture',
    summary: 'Scripts architecture contract (allowed cycles and edges)',
    run: (options) => validateArchitectureContract(options?.root || process.cwd()),
    format: (violations) => {
      if (violations.length === 0) return ['Architecture contract guard passed.']
      return [
        'Architecture contract guard failed:',
        '',
        'Scripts architecture graph must match scripts/architecture-contract.json.',
        '',
        ...violations.map(v => `- ${v}`)
      ]
    },
  },
]

export function runGuardPack(options = {}) {
  const results = []

  for (const guard of GUARD_PACK) {
    const violations = guard.run(options)
    results.push({ id: guard.id, summary: guard.summary, violations })
  }

  return results
}

export function flattenGuardPackViolations(results) {
  return results.flatMap((result) =>
    result.violations.map((violation) => ({
      ...violation,
      guard: result.id,
    })),
  )
}

export function getGuardPackExitCode(results) {
  return flattenGuardPackViolations(results).length > 0 ? 1 : 0
}

export function formatGuardPackResults(results) {
  const allViolations = flattenGuardPackViolations(results)

  if (allViolations.length === 0) {
    return ['Central guard pack passed.', '', ...GUARD_PACK.map((guard) => `  ✓ ${guard.id}`)]
  }

  const lines = [
    'Central guard pack failed:',
    '',
    'Fix the violations below, then rerun `pnpm run bemoat:guard:pack` or `pnpm run bemoat:guard:safety`.',
    'See docs/guard-pack.md for guard coverage and false-positive notes.',
    '',
  ]

  for (const result of results) {
    if (result.violations.length === 0) continue

    const guard = GUARD_PACK.find((entry) => entry.id === result.id)

    lines.push(`## ${result.id}`)
    lines.push(result.summary)
    lines.push('')

    if (guard?.format) {
      for (const line of guard.format(result.violations)) {
        if (line.endsWith('passed.')) continue
        lines.push(`- ${line}`)
      }
    } else {
      for (const violation of result.violations) {
        const location = violation.file ?? 'unknown'
        lines.push(`- [${violation.rule}] ${location}: ${violation.message}`)
      }
    }

    lines.push('')
  }

  return lines
}

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

function resolveGuardPackCommand() {
  const lifecycleAliases = {
    'guard:pack': 'bemoat:guard:pack',
    'guard:safety': 'bemoat:guard:safety',
  }
  const lifecycleEvent = process.env.npm_lifecycle_event
  const fallback = lifecycleAliases[lifecycleEvent] ?? 'bemoat:guard:pack'
  const isUnrelatedLifecycle =
    lifecycleEvent &&
    !lifecycleEvent.startsWith('bemoat:') &&
    !lifecycleAliases[lifecycleEvent]
  const env = lifecycleAliases[lifecycleEvent] || isUnrelatedLifecycle
    ? { ...process.env, npm_lifecycle_event: undefined }
    : process.env

  return resolveCommandIdentity({
    fallback,
    env,
    entrypoint: 'scripts/guard-pack.mjs',
  })
}

function main() {
  let invocation

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
