#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { isPlaceholderSecret } from './guard-repo-safety.mjs'

export const ENV_EXAMPLE_PATH = '.env.example'

const ENV_ASSIGNMENT_RE = /^(?:export\s+)?([A-Z][A-Z0-9_]*)[ \t]*=[ \t]*([^\n#]*)/gm

export function parseEnvAssignments(content) {
  const assignments = []

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

export function scanEnvExampleContent(content, file = ENV_EXAMPLE_PATH) {
  const violations = []
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
  readFile = (filePath) => readFileSync(filePath, 'utf8'),
  envExamplePath = ENV_EXAMPLE_PATH,
} = {}) {
  const violations = []
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

export function getEnvPlaceholderGuardExitCode(violations) {
  return violations.length > 0 ? 1 : 0
}

export function formatEnvPlaceholderViolations(violations) {
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

export function isDirectExecution() {
  const entrypoint = process.argv[1]
  if (!entrypoint) return false
  return import.meta.url === pathToFileURL(resolve(entrypoint)).href
}

function main() {
  const violations = runEnvPlaceholderGuard()
  const lines = formatEnvPlaceholderViolations(violations)

  for (const line of lines) console.log(line)

  process.exit(getEnvPlaceholderGuardExitCode(violations))
}

if (isDirectExecution()) main()
