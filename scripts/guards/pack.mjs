import {
  formatBuildScriptContractViolations,
  runBuildScriptContractGuard,
} from './build-script-contract.mjs'
import {
  formatCloudflareDeployGuardViolations,
  runCloudflareDeployGuard,
} from './cloudflare-env.mjs'
import {
  formatEnvPlaceholderViolations,
  runEnvPlaceholderGuard,
} from './env-placeholder.mjs'
import {
  formatFrontendSeoViolations,
  runFrontendSeoGuard,
} from './frontend-seo.mjs'
import {
  formatHarnessContractViolations,
  runHarnessContractGuard,
} from '../guard-harness-contract.mjs'
import {
  validateArchitectureContract,
} from './scripts-architecture.mjs'
import {
  formatPlanningContractViolations,
  runPlanningContractGuard,
} from './planning-contract-runtime.mjs'
import {
  formatPackageManagerViolations,
  runPackageManagerGuard,
} from './package-manager.mjs'
import {
  formatToolchainContractViolations,
  scanToolchainContract,
} from './toolchain-contract.mjs'
import { formatViolations, runRepoSafetyGuard } from './repo-safety.mjs'
import { formatStructuralProtectionViolations, runStructuralProtectionGuard } from './structural-protection.mjs'

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
    id: 'planning-contract',
    summary: 'Planning task-identity and execution-base contract across paired spec/plan files',
    run: runPlanningContractGuard,
    format: formatPlanningContractViolations,
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
