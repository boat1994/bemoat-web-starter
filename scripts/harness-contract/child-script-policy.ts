import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Synced harness files that execute pnpm scripts in CI or git hooks.
 * Human-facing templates (PR/issue checklists) are intentionally excluded.
 */
export const CHILD_FACING_HARNESS_PATHS = [
  '.github/workflows/ci.yml',
  '.githooks/pre-commit',
  '.githooks/pre-push',
] as const

/**
 * Non-namespaced scripts that synced CI and pre-push must not call directly.
 * Child projects add these locally when ready; harness automation uses bemoat:* only.
 */
export const FORBIDDEN_RAW_SCRIPTS = [
  'guard:safety',
  'guard:cloudflare-env',
  'check',
  'check:full',
  'typecheck',
  'lint',
  'build',
  'deploy',
  'deploy:app',
  'deploy:database',
  'deploy:dev',
  'preview',
  'test:int',
  'test',
  'generate:importmap',
  'generate:types',
] as const

type ForbiddenRawScriptViolation = {
  type: 'forbidden-raw-script'
  file: string
  rule: string
  message: string
}

type MissingChildFacingFileViolation = {
  type: 'missing-child-facing-file'
  file: string
  rule: 'required-path'
  message: string
}

export type HarnessContractViolation =
  | ForbiddenRawScriptViolation
  | MissingChildFacingFileViolation

const PNPM_RUN_RE = /pnpm run ([a-zA-Z0-9:_-]+)/g

export function extractPnpmRunScripts(content: string): string[] {
  return [...content.matchAll(PNPM_RUN_RE)].map((match) => match[1])
}

export function findForbiddenRawScriptCalls(
  content: string,
  forbidden: readonly string[] = FORBIDDEN_RAW_SCRIPTS,
): string[] {
  const forbiddenSet = new Set(forbidden)
  return extractPnpmRunScripts(content).filter((script) => forbiddenSet.has(script))
}

export function scanChildFacingHarnessFile(
  relativePath: string,
  content: string,
): ForbiddenRawScriptViolation[] {
  const forbidden = findForbiddenRawScriptCalls(content)

  return forbidden.map((script) => ({
    type: 'forbidden-raw-script',
    file: relativePath,
    rule: script,
    message: `Child-facing harness must not call non-namespaced script "${script}" — use bemoat:* instead`,
  }))
}

type RunHarnessContractGuardOptions = {
  root?: string
  paths?: readonly string[]
  readFile?: (filePath: string) => string
}

export function runHarnessContractGuard({
  root = process.cwd(),
  paths = CHILD_FACING_HARNESS_PATHS,
  readFile = (filePath) => readFileSync(filePath, 'utf8'),
}: RunHarnessContractGuardOptions = {}): HarnessContractViolation[] {
  const violations: HarnessContractViolation[] = []

  for (const relativePath of paths) {
    const absolutePath = resolve(root, relativePath)
    let content: string

    try {
      content = readFile(absolutePath)
    } catch {
      violations.push({
        type: 'missing-child-facing-file',
        file: relativePath,
        rule: 'required-path',
        message: 'Child-facing harness file is missing',
      })
      continue
    }

    violations.push(...scanChildFacingHarnessFile(relativePath, content))
  }

  return violations
}

export function getHarnessContractExitCode(violations: readonly { type: string }[]): number {
  return violations.length > 0 ? 1 : 0
}

export function formatHarnessContractViolations(violations: HarnessContractViolation[]): string[] {
  if (violations.length === 0) {
    return ['Harness contract guard passed.']
  }

  const lines = [
    'Harness contract guard failed:',
    '',
    'Synced CI and pre-push must call only bemoat:* scripts.',
    'See docs/harness-sync-contract.md.',
    '',
  ]

  for (const violation of violations) {
    lines.push(`- [${violation.type}] ${violation.file}: ${violation.message}`)
  }

  return lines
}
