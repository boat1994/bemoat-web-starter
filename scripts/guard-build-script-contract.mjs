#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const PACKAGE_JSON_PATH = 'package.json'
export const OPENNEXT_BUILD_PATTERN = 'opennextjs-cloudflare build'
export const NEXT_BUILD_PATTERN = 'next build'

export function scanBuildScriptContract(scripts = {}, file = PACKAGE_JSON_PATH) {
  const violations = []
  const build = scripts.build ?? ''
  const cfBuild = scripts['cf:build'] ?? ''

  if (build.includes(OPENNEXT_BUILD_PATTERN)) {
    violations.push({
      type: 'build-script-contract',
      file,
      rule: 'build-must-not-call-opennext',
      message:
        'scripts.build must run the normal Next.js build — use scripts["cf:build"] for opennextjs-cloudflare build',
    })
  }

  if (!build.includes(NEXT_BUILD_PATTERN)) {
    violations.push({
      type: 'build-script-contract',
      file,
      rule: 'build-must-call-next-build',
      message:
        'scripts.build must include "next build" so OpenNext can build the app without recursing',
    })
  }

  if (!cfBuild) {
    violations.push({
      type: 'build-script-contract',
      file,
      rule: 'missing-cf-build',
      message: 'scripts["cf:build"] is required for the Cloudflare OpenNext production build',
    })
  } else if (!cfBuild.includes(OPENNEXT_BUILD_PATTERN)) {
    violations.push({
      type: 'build-script-contract',
      file,
      rule: 'cf-build-must-call-opennext',
      message: 'scripts["cf:build"] must run opennextjs-cloudflare build',
    })
  }

  return violations
}

export function runBuildScriptContractGuard({
  root = process.cwd(),
  packageJsonPath = PACKAGE_JSON_PATH,
  readFile = (filePath) => readFileSync(filePath, 'utf8'),
} = {}) {
  const absolutePath = resolve(root, packageJsonPath)

  let content
  try {
    content = readFile(absolutePath)
  } catch {
    return [
      {
        type: 'build-script-contract',
        file: packageJsonPath,
        rule: 'missing-package-json',
        message: 'package.json is required to validate the build script contract',
      },
    ]
  }

  let pkg
  try {
    pkg = JSON.parse(content)
  } catch (error) {
    return [
      {
        type: 'build-script-contract',
        file: packageJsonPath,
        rule: 'invalid-package-json',
        message: `Could not parse package.json: ${error instanceof Error ? error.message : String(error)}`,
      },
    ]
  }

  return scanBuildScriptContract(pkg.scripts, packageJsonPath)
}

export function getBuildScriptContractExitCode(violations) {
  return violations.length > 0 ? 1 : 0
}

export function formatBuildScriptContractViolations(violations) {
  if (violations.length === 0) {
    return ['Build script contract guard passed.']
  }

  const lines = [
    'Build script contract guard failed:',
    '',
    'scripts.build must run next build only.',
    'scripts["cf:build"] must run opennextjs-cloudflare build.',
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
  const violations = runBuildScriptContractGuard()
  const lines = formatBuildScriptContractViolations(violations)

  for (const line of lines) console.log(line)

  process.exit(getBuildScriptContractExitCode(violations))
}

if (isDirectExecution()) main()
