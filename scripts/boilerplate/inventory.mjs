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
  'docs/mission-control/handoff-template.md', 'docs/mission-control/result-template.md',
  'docs/mission-control/project-overrides.example.md', 'prompts/mission-control/chatgpt-project-loader.md',
  // Superpowers planning harness (starter-only except these subpaths)
  'docs/superpowers/README.md', 'docs/superpowers/specs/README.md', 'docs/superpowers/plans/README.md',
  'docs/superpowers/plans/_templates', 'docs/superpowers/specs/_templates',
  // GitHub workflow rails
  '.github/workflows/ci.yml', '.github/workflows/mission-control-task-bootstrap.yml', '.github/pull_request_template.md', '.github/ISSUE_TEMPLATE/agent-task.yml',
  // Harness scripts (sync, drift, guard, hooks, smoke)
  'scripts/sync-boilerplate.mjs', 'scripts/boilerplate', 'scripts/check-boilerplate-drift.mjs',
  'scripts/deploy-smoke-test.mjs', 'scripts/guard-repo-safety.mjs',
  'scripts/guard-harness-contract.mjs', 'scripts/harness-contract',
  'scripts/guard-mission-control-contract.mjs', 'scripts/guards/mission-control-contract',
  'scripts/guard-build-script-contract.mjs', 'scripts/build.mjs', 'scripts/agent-issue.mjs',
  'scripts/agent-issue', 'scripts/agent-delivery.mjs', 'scripts/correction-contract.mjs',
  'scripts/mission-control-reconcile.mjs', 'scripts/mission-control-task-create.mjs', 'scripts/command-runner.mjs',
  'scripts/adapters/command-runner.mjs', 'scripts/mission-control-review.mjs',
  'scripts/mission-control-merge.mjs', 'scripts/mission-control-dispatch.mjs',
  'scripts/mission-control-issue-body-cas.mjs', 'scripts/post-role-comment.mjs',
  'scripts/guard-cloudflare-env.mjs', 'scripts/guard-pack.mjs', 'scripts/guard-planning-contract.mjs',
  'scripts/guard-mission-control-drift.mjs', 'scripts/guard-scripts-architecture.mjs',
  'scripts/architecture-contract.json', 'scripts/AGENTS.md', 'scripts/ARCHITECTURE.md',
  'scripts/mission-control', 'scripts/mission-control-state.mjs',
  'scripts/mission-control-brainstorming.mjs', 'scripts/guard-package-manager.mjs',
  'scripts/guard-toolchain-contract.mjs', 'scripts/bemoat-typecheck.mjs',
  'tsconfig.harness-strict.json', '.bemoat/toolchain-contract.json',
  'scripts/guard-env-placeholder.mjs', 'scripts/guard-frontend-seo.mjs',
  'scripts/github-comment-projection.mjs', 'scripts/pr-identity.mjs',
  'scripts/check-branch-safety.sh', 'scripts/install-git-hooks.mjs',
  // Local harness hooks and integration tests
  '.githooks', 'vitest.config.mts', 'vitest.setup.ts', 'tests/helpers/vitestProcessLock.ts',
  'tests/setup/vitestGlobalSetup.ts', 'tests/int/api.int.spec.ts',
  'tests/int/repo-safety-guard.int.spec.ts', 'tests/int/cloudflare-env-guard.int.spec.ts',
  'tests/int/boilerplate-sync.int.spec.ts', 'tests/int/boilerplate-sync-filesystem.int.spec.ts',
  'tests/int/boilerplate-sync-git.int.spec.ts', 'tests/int/boilerplate-sync-workflow.int.spec.ts',
  'tests/int/harness-contract-guard.int.spec.ts',
  'tests/int/harness-contract/child-script-policy.int.spec.ts',
  'tests/int/harness-contract/runtime-import-parser.int.spec.ts',
  'tests/int/harness-contract/managed-runtime-closure.int.spec.ts',
  'tests/int/harness-contract/facade-exports.int.spec.ts',
  'tests/int/build-script-contract-guard.int.spec.ts', 'tests/int/build-wrapper.int.spec.ts',
  'tests/int/branch-safety.int.spec.ts', 'tests/int/agent-issue.int.spec.ts',
  'tests/int/planning-no-pr-lineage.int.spec.ts', 'tests/fixtures/agent-issue',
  'tests/int/github-comment-projection.int.spec.ts', 'tests/int/agent-delivery.int.spec.ts',
  'tests/int/post-role-comment.int.spec.ts', 'tests/int/correction-contract.int.spec.ts',
  'tests/int/guard-pack.int.spec.ts', 'tests/int/guard-planning-contract.int.spec.ts',
  'tests/int/guard-planning-contract-child-dev-base.int.spec.ts',
  'tests/int/guard-planning-contract-starter-main-base.int.spec.ts',
  'tests/int/mission-control-contract.int.spec.ts',
  'tests/int/mission-control-contract-inventory.int.spec.ts',
  'tests/int/mission-control-contract-scanners.int.spec.ts',
  'tests/int/mission-control-contract-managed-paths.int.spec.ts',
  'tests/int/mission-control-reconcile.int.spec.ts', 'tests/int/command-runner.int.spec.ts',
  'tests/int/scripts-architecture.int.spec.ts', 'tests/int/campaign-schema.int.spec.ts',
  'tests/int/scripts-entrypoints-contract.int.spec.ts', 'tests/int/mission-control-review.int.spec.ts',
  'tests/int/mission-control-merge.int.spec.ts', 'tests/int/mission-control-issue-body-cas.int.spec.ts',
  'tests/int/mission-control-correction-entrypoints.int.spec.ts',
  'tests/int/mission-control-characterization.int.spec.ts', 'tests/int/mission-control-task-bootstrap-contract.int.spec.ts', 'tests/int/mission-control-task-initialization.int.spec.ts',
  'tests/int/mission-control-child-portability.int.spec.ts',
  'tests/int/mission-control-brainstorming.int.spec.ts', 'tests/int/toolchain-contract.int.spec.ts',
  'tests/int/vitest-process-lock.int.spec.ts', 'tests/int/starter-acceptance.int.spec.ts',
  'tests/int/open-next-config.int.spec.ts', 'tests/int/payload-build-context.int.spec.ts',
  'tests/fixtures/guard', 'tests/fixtures/planning', 'tests/fixtures/acceptance',
  'tests/fixtures/boilerplate-sync', 'tests/fixtures/mission-control',
  'tests/fixtures/mission-control-child-shape', 'docs/mission-control/modules/procedures.md',
  'docs/mission-control/modules/checklists.md', 'docs/mission-control/modules/templates-examples.md',
  'docs/mission-control/modules/troubleshooting.md', 'docs/mission-control/modules/migration-guidance.md',
  'docs/mission-control/modules/child-sync-operations.md',
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
  'bemoat:agent:issue', 'bemoat:mission-control:dispatch', 'bemoat:mission-control:review', 'bemoat:mission-control:task-bootstrap',
  'bemoat:mission-control:merge', 'bemoat:agent:delivery', 'bemoat:issue:comment',
  'bemoat:branch:check', 'bemoat:guard:safety', 'bemoat:guard:pack',
  'bemoat:guard:harness-contract', 'bemoat:guard:mission-control-contract',
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

export function listPathFiles(root, relativePath = '') {
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

export function expandSeedOnlyFiles(root, paths = seedOnlyPaths) {
  const files = new Set()
  for (const relativePath of paths) {
    for (const filePath of listPathFiles(root, relativePath)) files.add(filePath)
  }
  return [...files].sort()
}
