import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const syncManifestPath = '.bemoat/boilerplate-sync-manifest.json'

export const managedPaths = [
  // Agent and workflow rails
  'AGENTS.md', 'ANTIGRAVITY.md', '.agents', syncManifestPath, '.cursor/rules', 'docs/agent-loop',
  'docs/ai/ui-skills.md', 'docs/ai/ui-execution-workflow.md', 'docs/ai/visual-qa-checklist.md',
  'docs/ai/accessibility-baseline.md', 'prompts/ui', 'docs/workflow', 'docs/hardening.md',
  'docs/releases.md', 'docs/deploy-smoke-test.md', 'docs/cloudflare-environments.md',
  'docs/schema-evolution.md', 'docs/dev-boilerplate.md', 'docs/boilerplate-sync-command.md',
  'docs/harness-sync-contract.md', 'docs/guard-pack.md', 'docs/starter-acceptance-tests.md',
  'docs/mission-control/README.md', 'docs/mission-control/command-reference.md', 'docs/mission-control/mission-control-guide.md',
  'docs/mission-control/handoff-template.md', 'prompts/mission-control/chatgpt-project-loader.md',
  // Superpowers planning harness (starter-only except these subpaths)
  'docs/superpowers/README.md', 'docs/superpowers/specs/README.md', 'docs/superpowers/plans/README.md',
  'docs/superpowers/plans/_templates', 'docs/superpowers/specs/_templates',
  // GitHub workflow rails
  '.github/workflows/ci.yml', '.github/pull_request_template.md', '.github/ISSUE_TEMPLATE/agent-task.yml',
  // Harness scripts (sync, drift, guard, hooks, smoke)
  'scripts/sync-boilerplate.ts', 'scripts/boilerplate', 'scripts/boilerplate/workflows/check-boilerplate-drift.ts', 'scripts/check-boilerplate-drift.ts',
  'scripts/deploy-smoke-test.ts', 'scripts/guards/repo-safety.ts', 'scripts/guards/types.ts',
  'scripts/guard-harness-contract.ts', 'scripts/harness-contract',
  'scripts/guards/build-script-contract.ts', 'scripts/build.ts',
  'scripts/agent-context.ts', 'scripts/agent-context-sync-base.ts', 'scripts/context', 'scripts/agent-handoff.ts', 'scripts/handoff',
  'scripts/adapters/command-runner.ts',
  'scripts/cli',
  'scripts/guard-cloudflare-env.ts', 'scripts/guards/cloudflare-env.ts', 'scripts/guard-pack.ts', 'scripts/guards/pack.ts', 'scripts/guards/planning-contract-runtime.ts', 'scripts/guards/planning-contract-live.ts', 'scripts/guards/legacy-managed-state.ts',
  'scripts/guards/planning-contract.ts',
  'scripts/guards/structural-protection.ts', 'scripts/structural-protection-manifest.json',
  'scripts/guards/scripts-architecture.ts',
  'scripts/architecture-contract.json', 'scripts/AGENTS.md', 'scripts/ARCHITECTURE.md',
  'scripts/guards/package-manager.ts',
  'scripts/guards/toolchain-contract.ts', 'scripts/bemoat-typecheck.ts',
  'tsconfig.harness-strict.json', '.bemoat/toolchain-contract.json',
  'scripts/guards/env-placeholder.ts', 'scripts/guards/frontend-seo.ts',
  'scripts/check-branch-safety.sh', 'scripts/install-git-hooks.ts',
  // Local harness hooks and integration tests
  '.githooks', 'vitest.config.mts', 'vitest.setup.ts', 'tests/helpers/vitestProcessLock.ts', 'tests/helpers/cli-boundary-harness.ts',
  'tests/setup/vitestGlobalSetup.ts', 'tests/int/api.int.spec.ts',
  'tests/int/repo-safety-guard.int.spec.ts', 'tests/int/cloudflare-env-guard.int.spec.ts',
  'tests/int/boilerplate-sync.int.spec.ts', 'tests/int/boilerplate-sync-filesystem.int.spec.ts',
  'tests/int/boilerplate-sync-git.int.spec.ts', 'tests/int/boilerplate-sync-workflow.int.spec.ts',
  'tests/int/boilerplate-sync-bootstrap.int.spec.ts',
  'tests/int/harness-contract-guard.int.spec.ts',
  'tests/int/harness-contract/child-script-policy.int.spec.ts',
  'tests/int/harness-contract/runtime-import-parser.int.spec.ts',
  'tests/int/harness-contract/managed-runtime-closure.int.spec.ts',
  'tests/int/harness-contract/facade-exports.int.spec.ts',
  'tests/int/build-script-contract-guard.int.spec.ts', 'tests/int/build-wrapper.int.spec.ts',
  'tests/int/branch-safety.int.spec.ts',
  'tests/int/context-parser.int.spec.ts', 'tests/int/context-router.int.spec.ts', 'tests/int/context-evidence.int.spec.ts', 'tests/int/context-cli.int.spec.ts', 'tests/int/context-skill.int.spec.ts', 'tests/int/context-sync.int.spec.ts', 'tests/int/context-corrections.int.spec.ts',
  'tests/int/handoff-schema.int.spec.ts', 'tests/int/handoff-transport.int.spec.ts', 'tests/int/handoff-cli.int.spec.ts', 'tests/int/handoff-skill.int.spec.ts',
  'tests/int/guard-pack.int.spec.ts', 'tests/int/guard-planning-contract.int.spec.ts',
  'tests/int/env-placeholder-guard-boundary.int.spec.ts',
  'tests/int/guard-planning-contract-boundary.int.spec.ts',
  'tests/int/frontend-seo-guard-boundary.int.spec.ts',
  'tests/int/structural-protection.int.spec.ts',
  'tests/int/guard-planning-contract-child-dev-base.int.spec.ts',
  'tests/int/guard-planning-contract-starter-main-base.int.spec.ts',
  'tests/int/cli-command-registry.int.spec.ts',
  'tests/int/cli-discovery-guidance.int.spec.ts',
  'tests/int/stateless-public-contract.int.spec.ts',
  'tests/int/cli-invocation-contract.int.spec.ts',
  'tests/int/cli-envelope-runtime.int.spec.ts',
  'tests/int/cli-tier-b-boundaries.int.spec.ts',
  'tests/int/cli-tier-a-boundaries.int.spec.ts',
  'tests/int/command-runner.int.spec.ts',
  'tests/int/scripts-architecture.int.spec.ts',
  'tests/int/scripts-entrypoints-contract.int.spec.ts',
  'tests/int/legacy-managed-state-boundary.int.spec.ts',
  'tests/int/child-portability.int.spec.ts',
  'tests/int/toolchain-contract.int.spec.ts',
  'tests/int/vitest-process-lock.int.spec.ts', 'tests/int/starter-acceptance.int.spec.ts',
  'tests/int/open-next-config.int.spec.ts', 'tests/int/payload-build-context.int.spec.ts',
  'tests/fixtures/guard', 'tests/fixtures/planning', 'tests/fixtures/acceptance',
  'tests/fixtures/boilerplate-sync', 'tests/fixtures/child-shape',
]

export const seedOnlyPaths = [
  'src/app/(frontend)', 'src/components', 'src/collections', 'src/globals', 'src/hooks', 'src/access',
  'src/lib', 'src/payload.config.ts',
]

/** Paths merged during sync: child content is kept and missing starter entries are appended. */
export const mergeKeepPaths = ['.gitignore']
export const packageSyncProposalPath = '.bemoat/package-sync-proposal.md'

/** Namespaced scripts safe to add when missing during sync. Never overwrite existing entries. */
export const managedPackageScripts = [
  'bemoat:context', 'bemoat:context:sync-base', 'bemoat:handoff',
  'bemoat:branch:check', 'bemoat:guard:safety', 'bemoat:guard:pack',
  'bemoat:guard:harness-contract',
  'bemoat:guard:cloudflare-env', 'bemoat:test:int', 'bemoat:typecheck', 'bemoat:check',
  'bemoat:boilerplate:sync', 'bemoat:boilerplate:check', 'bemoat:hooks:install',
]

export const exactManagedPackageScripts = ['bemoat:typecheck']

/** Non-namespaced scripts surfaced in the package sync proposal only — never auto-applied. */
export const suggestedPackageScripts = [
  'branch:check', 'build', 'build:next', 'build:cloudflare', 'cf:build', 'deploy', 'deploy:app',
  'deploy:database', 'deploy:dev', 'preview', 'check', 'check:full', 'lint', 'typecheck', 'test',
  'test:int', 'dev', 'start',
]

/** Build/deploy scripts applied only when sync runs with --apply-build-contract. */
export const buildContractPackageScripts = [
  'build', 'build:next', 'build:cloudflare', 'cf:build', 'deploy', 'deploy:app',
  'deploy:database', 'deploy:dev', 'preview',
]

/** Project-owned files applied only when sync runs with --apply-build-contract. */
export const buildContractFilePaths = ['open-next.config.ts']
/** Recommended package.json sections surfaced in the proposal only. */
export const suggestedPackageSections = ['dependencies', 'devDependencies']

export function listPathFiles(root: string, relativePath = ''): string[] {
  const fullPath = join(root, relativePath)
  if (!existsSync(fullPath)) return []
  const stat = statSync(fullPath)
  if (!stat.isDirectory()) return [relativePath]
  const files = []
  for (const entry of readdirSync(fullPath, { withFileTypes: true })) {
    const childPath = relativePath ? `${relativePath}/${entry.name}` : entry.name
    if (entry.isDirectory()) files.push(...listPathFiles(root, childPath))
    else files.push(childPath)
  }
  return files.sort()
}

export function expandSeedOnlyFiles(root: string, paths: string[] = seedOnlyPaths): string[] {
  const files = new Set()
  for (const relativePath of paths) {
    for (const filePath of listPathFiles(root, relativePath)) files.add(filePath)
  }
  return [...files].sort().filter((filePath): filePath is string => typeof filePath === 'string')
}
