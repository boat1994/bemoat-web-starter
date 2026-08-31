#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { isPlaceholderSecret } from './repo-safety.ts'
import type { GuardViolation, ReadTextFile } from './types.ts'

export const ENV_EXAMPLE_PATH = '.env.example'

const ENV_ASSIGNMENT_RE = /^(?:export\s+)?([A-Z][A-Z0-9_]*)[ \t]*=[ \t]*([^\n#]*)/gm

export function parseEnvAssignments(content: string): Array<{ key: string; value: string }> {
  const assignments: Array<{ key: string; value: string }> = []

  for (const match of content.matchAll(ENV_ASSIGNMENT_RE)) {
    const key = match[1]
    let value = match[2]?.trim() ?? ''

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    assignments.push({ key, value })
  }

  return assignments
}

export function scanEnvExampleContent(content: string, file = ENV_EXAMPLE_PATH): GuardViolation[] {
  const violations: GuardViolation[] = []
  const assignments = parseEnvAssignments(content)

  if (assignments.length === 0) {
    violations.push({
      type: 'env-placeholder',
      file,
      rule: 'empty-env-example',
      message: `${file} should document required env vars with empty or placeholder values`,
    })
    return violations
  }

  for (const { key, value } of assignments) {
    if (isPlaceholderSecret(value)) continue

    violations.push({
      type: 'env-placeholder',
      file,
      rule: 'non-placeholder-value',
      message: `${key} must be empty or a clear placeholder in ${file} — never commit example secrets`,
    })
  }

  return violations
}

export function runEnvPlaceholderGuard({
  root = process.cwd(),
  readFile = (filePath: string) => readFileSync(filePath, 'utf8'),
  envExamplePath = ENV_EXAMPLE_PATH,
}: {
  root?: string
  readFile?: ReadTextFile
  envExamplePath?: string
} = {}): GuardViolation[] {
  const violations: GuardViolation[] = []
  const absolutePath = resolve(root, envExamplePath)

  let content
  try {
    content = readFile(absolutePath)
  } catch {
    return [
      {
        type: 'env-placeholder',
        file: envExamplePath,
        rule: 'missing-env-example',
        message: `${envExamplePath} is required as the safe env template for agents and developers`,
      },
    ]
  }

  violations.push(...scanEnvExampleContent(content, envExamplePath))
  return violations
}

export function getEnvPlaceholderGuardExitCode(violations: readonly unknown[]): number {
  return violations.length > 0 ? 1 : 0
}

export function formatEnvPlaceholderViolations(violations: GuardViolation[]): string[] {
  if (violations.length === 0) {
    return ['Env placeholder guard passed.']
  }

  const lines = [
    'Env placeholder guard failed:',
    '',
    'Only .env.example may be tracked. Values must be empty or obvious placeholders.',
    'See docs/guard-pack.md and docs/agent-loop/security-and-migrations.md.',
    '',
  ]

  for (const violation of violations) {
    lines.push(`- [${violation.rule}] ${violation.file}: ${violation.message}`)
  }

  return lines
}

export function isDirectExecution(): boolean {
  const entrypoint = process.argv[1]
  if (!entrypoint) return false
  return import.meta.url === pathToFileURL(resolve(entrypoint)).href
}

export function main(): void {
  const violations = runEnvPlaceholderGuard()
  const lines = formatEnvPlaceholderViolations(violations)

  for (const line of lines) console.log(line)

  process.exit(getEnvPlaceholderGuardExitCode(violations))
}

if (isDirectExecution()) main()
