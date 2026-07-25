#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { CHILD_FACING_HARNESS_PATHS } from './guard-harness-contract.mjs'
import { listProjectFiles } from './guard-repo-safety.mjs'

/** Alternate lockfiles that indicate package-manager drift from pnpm. */
export const FORBIDDEN_LOCKFILES = [
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'bun.lockb',
]

/**
 * Harness and workflow paths scanned for non-pnpm install/run commands.
 * Includes starter-only CI in addition to synced child-facing paths.
 */
export const PACKAGE_MANAGER_SCAN_PATHS = [
  ...CHILD_FACING_HARNESS_PATHS,
  '.github/workflows/ci-starter.yml',
]

const NON_PNPM_COMMAND_RE =
  /\b(?:npm\s+(?:install|ci|run|exec)|yarn\s+(?:install|run|add)|bun\s+(?:install|run|add))\b/g

export function findNonPnpmCommands(content) {
  return [...content.matchAll(NON_PNPM_COMMAND_RE)].map((match) => match[0])
}

export function scanPackageManagerFile(relativePath, content) {
  const commands = findNonPnpmCommands(content)

  return commands.map((command) => ({
    type: 'package-manager-drift',
    file: relativePath,
    rule: 'non-pnpm-command',
    message: `Use pnpm instead of "${command}" in automation — see docs/guard-pack.md`,
  }))
}

export function scanTrackedLockfiles(files = []) {
  const violations = []

  for (const lockfile of FORBIDDEN_LOCKFILES) {
    if (files.includes(lockfile)) {
      violations.push({
        type: 'package-manager-drift',
        file: lockfile,
        rule: 'forbidden-lockfile',
        message: `Tracked ${lockfile} is not allowed — this project uses pnpm and pnpm-lock.yaml only`,
      })
    }
  }

  return violations
}

export function scanPackageJsonEngines(content, file = 'package.json') {
  const violations = []

  let pkg
  try {
    pkg = JSON.parse(content)
  } catch (error) {
    return [
      {
        type: 'package-manager-drift',
        file,
        rule: 'invalid-package-json',
        message: `Could not parse package.json: ${error instanceof Error ? error.message : String(error)}`,
      },
    ]
  }

  const pnpmEngine = pkg.engines?.pnpm
  if (!pnpmEngine) {
    violations.push({
      type: 'package-manager-drift',
      file,
      rule: 'missing-pnpm-engine',
      message: 'package.json must declare engines.pnpm so agents and CI stay on pnpm',
    })
  }

  return violations
}

export function runPackageManagerGuard({
  root = process.cwd(),
  readFile = (filePath) => readFileSync(filePath, 'utf8'),
  execFile = execFileSync,
  files = null,
} = {}) {
  const trackedFiles = files ?? listProjectFiles({ root, execFile })
  const violations = [...scanTrackedLockfiles(trackedFiles)]

  const packageJsonPath = 'package.json'
  if (trackedFiles.includes(packageJsonPath)) {
    try {
      violations.push(...scanPackageJsonEngines(readFile(resolve(root, packageJsonPath)), packageJsonPath))
    } catch {
      // Missing package.json is allowed in partial test fixtures.
    }
  }

  for (const relativePath of PACKAGE_MANAGER_SCAN_PATHS) {
    try {
      const content = readFile(resolve(root, relativePath))
      violations.push(...scanPackageManagerFile(relativePath, content))
    } catch {
      // Optional paths (for example ci-starter.yml) may be absent in child projects.
    }
  }

  return violations
}

export function getPackageManagerGuardExitCode(violations) {
  return violations.length > 0 ? 1 : 0
}

export function formatPackageManagerViolations(violations) {
  if (violations.length === 0) {
    return ['Package manager guard passed.']
  }

  const lines = [
    'Package manager guard failed:',
    '',
    'This harness expects pnpm with pnpm-lock.yaml only.',
    'See docs/guard-pack.md.',
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
  const violations = runPackageManagerGuard()
  const lines = formatPackageManagerViolations(violations)

  for (const line of lines) console.log(line)

  process.exit(getPackageManagerGuardExitCode(violations))
}

if (isDirectExecution()) main()
