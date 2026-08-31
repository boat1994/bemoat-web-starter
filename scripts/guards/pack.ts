import {
  formatBuildScriptContractViolations,
  runBuildScriptContractGuard,
} from './build-script-contract.ts'
import {
  formatCloudflareDeployGuardViolations,
  runCloudflareDeployGuard,
} from './cloudflare-env.ts'
import {
  formatEnvPlaceholderViolations,
  runEnvPlaceholderGuard,
} from './env-placeholder.ts'
import {
  formatFrontendSeoViolations,
  runFrontendSeoGuard,
} from './frontend-seo.ts'
import {
  formatHarnessContractViolations,
  runHarnessContractGuard,
} from '../guard-harness-contract.ts'
import {
  validateArchitectureContract,
} from './scripts-architecture.ts'
import {
  formatPlanningContractViolations,
  runPlanningContractGuard,
} from './planning-contract-runtime.ts'
import {
  formatPackageManagerViolations,
  runPackageManagerGuard,
} from './package-manager.ts'
import {
  formatToolchainContractViolations,
  scanToolchainContract,
} from './toolchain-contract.ts'
import { formatViolations, runRepoSafetyGuard } from './repo-safety.ts'
import {
  formatStructuralProtectionViolations,
  runStructuralProtectionGuard,
  type StructuralViolation,
} from './structural-protection.ts'
import type { HarnessContractViolation } from '../harness-contract/child-script-policy.ts'
import type { PlanningViolation } from './planning-contract.ts'
import type { ToolchainViolation } from './toolchain-contract.ts'
import type { GuardViolation } from './types.ts'

interface GuardOptions {
  root?: string
  files?: string[]
}

type GuardPackViolation =
  | GuardViolation
  | HarnessContractViolation
  | PlanningViolation
  | StructuralViolation
  | ToolchainViolation
  | string

interface GuardResult {
  id: string
  summary: string
  violations: GuardPackViolation[]
}

interface FlattenedGuardViolation {
  guard: string
  message: string
  file?: string
  rule?: string
  [key: string]: unknown
}

interface GuardPackEntry<TId extends string, TViolation extends GuardPackViolation> {
  id: TId
  summary: string
  run: (options: GuardOptions) => TViolation[]
  format: (violations: TViolation[]) => string[]
}

type GuardPackEntryUnion =
  | GuardPackEntry<'repo-safety', GuardViolation>
  | GuardPackEntry<'harness-contract', HarnessContractViolation>
  | GuardPackEntry<'build-script-contract', GuardViolation>
  | GuardPackEntry<'package-manager', GuardViolation>
  | GuardPackEntry<'toolchain-contract', ToolchainViolation>
  | GuardPackEntry<'env-placeholder', GuardViolation>
  | GuardPackEntry<'cloudflare-config', GuardViolation>
  | GuardPackEntry<'frontend-seo', GuardViolation>
  | GuardPackEntry<'planning-contract', PlanningViolation>
  | GuardPackEntry<'structural-protection', StructuralViolation>
  | GuardPackEntry<'scripts-architecture', string>

function isGuardViolation(value: GuardPackViolation): value is GuardViolation {
  return value !== null && typeof value === 'object' &&
    typeof value.file === 'string' && typeof value.rule === 'string' && typeof value.message === 'string'
}

function isHarnessContractViolation(value: GuardPackViolation): value is HarnessContractViolation {
  return isGuardViolation(value) &&
    (value.type === 'forbidden-raw-script' || value.type === 'missing-child-facing-file')
}

function isPlanningViolation(value: GuardPackViolation): value is PlanningViolation {
  return isGuardViolation(value) && value.type === 'planning-contract' &&
    Object.hasOwn(value, 'found') && Object.hasOwn(value, 'reason') && Object.hasOwn(value, 'correctiveAction')
}

function isStructuralViolation(value: GuardPackViolation): value is StructuralViolation {
  return isGuardViolation(value)
}

function isToolchainViolation(value: GuardPackViolation): value is ToolchainViolation {
  return isGuardViolation(value)
}

function isStringViolation(value: GuardPackViolation): value is string {
  return typeof value === 'string'
}

/** Ordered central guard pack — each entry is a reusable, deterministic check. */
export const GUARD_PACK: readonly GuardPackEntryUnion[] = [
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
    run: (options: GuardOptions = {}) => runStructuralProtectionGuard(options.root || process.cwd()),
    format: formatStructuralProtectionViolations,
  },
  {
    id: 'scripts-architecture',
    summary: 'Scripts architecture contract (allowed cycles and edges)',
      run: (options: GuardOptions = {}) => validateArchitectureContract(options.root || process.cwd()),
    format: (violations) => {
      const architectureViolations = violations.filter((violation): violation is string => typeof violation === 'string')
      if (architectureViolations.length === 0) return ['Architecture contract guard passed.']
      return [
        'Architecture contract guard failed:',
        '',
        'Scripts architecture graph must match scripts/architecture-contract.json.',
        '',
        ...architectureViolations.map(v => `- ${v}`)
      ]
    },
  },
]

export function runGuardPack(options: GuardOptions = {}): GuardResult[] {
  const results: GuardResult[] = []

  for (const guard of GUARD_PACK) {
    const violations = guard.run(options)
    results.push({ id: guard.id, summary: guard.summary, violations })
  }

  return results
}

function formatGuardResult(entry: GuardPackEntryUnion, violations: GuardPackViolation[]): string[] {
  switch (entry.id) {
    case 'repo-safety':
    case 'build-script-contract':
    case 'package-manager':
    case 'env-placeholder':
    case 'cloudflare-config':
    case 'frontend-seo':
      return entry.format(violations.filter(isGuardViolation))
    case 'harness-contract':
      return entry.format(violations.filter(isHarnessContractViolation))
    case 'toolchain-contract':
      return entry.format(violations.filter(isToolchainViolation))
    case 'planning-contract':
      return entry.format(violations.filter(isPlanningViolation))
    case 'structural-protection':
      return entry.format(violations.filter(isStructuralViolation))
    case 'scripts-architecture':
      return entry.format(violations.filter(isStringViolation))
  }
}

export function flattenGuardPackViolations(results: readonly GuardResult[]): FlattenedGuardViolation[] {
  return results.flatMap((result) => result.violations.map((violation) => {
    if (typeof violation === 'string') return { message: violation, guard: result.id }
    return { ...violation, guard: result.id }
  }))
}

export function getGuardPackExitCode(results: GuardResult[]): number {
  return flattenGuardPackViolations(results).length > 0 ? 1 : 0
}

export function formatGuardPackResults(results: readonly GuardResult[]): string[] {
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

    if (guard) {
      for (const line of formatGuardResult(guard, result.violations)) {
        if (line.endsWith('passed.')) continue
        lines.push(`- ${line}`)
      }
    } else {
      for (const violation of result.violations) {
        const location = typeof violation === 'string' ? 'unknown' : violation.file
        const rule = typeof violation === 'string' ? 'unknown' : violation.rule
        const message = typeof violation === 'string' ? violation : violation.message
        lines.push(`- [${rule}] ${location}: ${message}`)
      }
    }

    lines.push('')
  }

  return lines
}
