#!/usr/bin/env node
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  formatCloudflareDeployGuardViolations,
  runCloudflareDeployGuard,
} from './guard-cloudflare-env.mjs'
import {
  formatEnvPlaceholderViolations,
  runEnvPlaceholderGuard,
} from './guard-env-placeholder.mjs'
import {
  formatFrontendSeoViolations,
  runFrontendSeoGuard,
} from './guard-frontend-seo.mjs'
import {
  formatHarnessContractViolations,
  runHarnessContractGuard,
} from './guard-harness-contract.mjs'
import {
  formatPackageManagerViolations,
  runPackageManagerGuard,
} from './guard-package-manager.mjs'
import { formatViolations, runRepoSafetyGuard } from './guard-repo-safety.mjs'

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
    id: 'package-manager',
    summary: 'Package manager drift (lockfiles and non-pnpm automation commands)',
    run: runPackageManagerGuard,
    format: formatPackageManagerViolations,
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

    lines.push(`## ${result.id}`)
    lines.push(result.summary)
    lines.push('')

    for (const violation of result.violations) {
      const location = violation.file ?? 'unknown'
      lines.push(`- [${violation.rule}] ${location}: ${violation.message}`)
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

function main() {
  const results = runGuardPack()
  const lines = formatGuardPackResults(results)

  for (const line of lines) console.log(line)

  process.exit(getGuardPackExitCode(results))
}

if (isDirectExecution()) main()
