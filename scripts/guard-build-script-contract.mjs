#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  BUILD_CONTEXT_ENV,
  BUILD_WRAPPER_PATH,
  OPENNEXT_NEXT_BUILD_CONTEXT,
} from './build.mjs'

export const PACKAGE_JSON_PATH = 'package.json'
export const OPENNEXT_CONFIG_PATH = 'open-next.config.ts'
export const BUILD_WRAPPER_INVOCATION = `node ${BUILD_WRAPPER_PATH}`
export const OPENNEXT_BUILD_PATTERN = 'opennextjs-cloudflare build'
export const NEXT_BUILD_PATTERN = 'next build'
export const OPENNEXT_REENTRY_BUILD_COMMAND = 'pnpm run build'
export const OPENNEXT_REENTRY_CONTEXT_MARKER = `${BUILD_CONTEXT_ENV}=${OPENNEXT_NEXT_BUILD_CONTEXT}`
export const OPENNEXT_REENTRY_BUILD_COMMAND_PATTERN = /\bpnpm run build\b(?!:)/

export function scanBuildScriptContract(scripts = {}, file = PACKAGE_JSON_PATH) {
  const violations = []
  const build = scripts.build ?? ''
  const buildNext = scripts['build:next'] ?? ''
  const buildCloudflare = scripts['build:cloudflare'] ?? ''
  const cfBuild = scripts['cf:build'] ?? ''

  if (!build.includes(BUILD_WRAPPER_PATH)) {
    violations.push({
      type: 'build-script-contract',
      file,
      rule: 'build-must-call-wrapper',
      message: `scripts.build must invoke ${BUILD_WRAPPER_INVOCATION}`,
    })
  }

  if (build.includes(OPENNEXT_BUILD_PATTERN)) {
    violations.push({
      type: 'build-script-contract',
      file,
      rule: 'build-must-not-call-opennext',
      message:
        'scripts.build must not call opennextjs-cloudflare build directly — use scripts["build:cloudflare"]',
    })
  }

  if (!buildNext.includes(NEXT_BUILD_PATTERN)) {
    violations.push({
      type: 'build-script-contract',
      file,
      rule: 'build-next-must-call-next-build',
      message: 'scripts["build:next"] must include "next build"',
    })
  }

  if (!buildCloudflare.includes(OPENNEXT_BUILD_PATTERN)) {
    violations.push({
      type: 'build-script-contract',
      file,
      rule: 'build-cloudflare-must-call-opennext',
      message: 'scripts["build:cloudflare"] must run opennextjs-cloudflare build',
    })
  }

  if (!cfBuild) {
    violations.push({
      type: 'build-script-contract',
      file,
      rule: 'missing-cf-build',
      message: 'scripts["cf:build"] is required as a compatibility alias for the production build',
    })
  } else if (!cfBuild.includes('pnpm run build')) {
    violations.push({
      type: 'build-script-contract',
      file,
      rule: 'cf-build-must-alias-build',
      message: 'scripts["cf:build"] must alias scripts.build via "pnpm run build"',
    })
  }

  return violations
}

export function scanBuildWrapperContract({
  root = process.cwd(),
  wrapperPath = BUILD_WRAPPER_PATH,
  readFile = (filePath) => readFileSync(filePath, 'utf8'),
  fileExists = (filePath) => existsSync(filePath),
} = {}) {
  const violations = []
  const absolutePath = resolve(root, wrapperPath)

  if (!fileExists(absolutePath)) {
    violations.push({
      type: 'build-script-contract',
      file: wrapperPath,
      rule: 'missing-build-wrapper',
      message: `${BUILD_WRAPPER_PATH} is required for the context-aware build entrypoint`,
    })
    return violations
  }

  const content = readFile(absolutePath)

  if (!content.includes(BUILD_CONTEXT_ENV) || !content.includes(OPENNEXT_NEXT_BUILD_CONTEXT)) {
    violations.push({
      type: 'build-script-contract',
      file: wrapperPath,
      rule: 'build-wrapper-missing-context-marker',
      message: `${BUILD_WRAPPER_PATH} must define ${BUILD_CONTEXT_ENV}=${OPENNEXT_NEXT_BUILD_CONTEXT} for OpenNext re-entry`,
    })
  }

  return violations
}

export function scanOpenNextConfigContract({
  root = process.cwd(),
  configPath = OPENNEXT_CONFIG_PATH,
  readFile = (filePath) => readFileSync(filePath, 'utf8'),
  fileExists = (filePath) => existsSync(filePath),
} = {}) {
  const violations = []
  const absolutePath = resolve(root, configPath)

  if (!fileExists(absolutePath)) {
    violations.push({
      type: 'build-script-contract',
      file: configPath,
      rule: 'missing-open-next-config',
      message: `${OPENNEXT_CONFIG_PATH} is required for OpenNext re-entry into the universal build wrapper`,
    })
    return violations
  }

  const content = readFile(absolutePath)

  if (!content.includes(OPENNEXT_REENTRY_CONTEXT_MARKER)) {
    violations.push({
      type: 'build-script-contract',
      file: configPath,
      rule: 'open-next-missing-reentry-context',
      message: `${OPENNEXT_CONFIG_PATH} buildCommand must set ${OPENNEXT_REENTRY_CONTEXT_MARKER}`,
    })
  }

  if (!OPENNEXT_REENTRY_BUILD_COMMAND_PATTERN.test(content)) {
    violations.push({
      type: 'build-script-contract',
      file: configPath,
      rule: 'open-next-missing-universal-build',
      message: `${OPENNEXT_CONFIG_PATH} buildCommand must call ${OPENNEXT_REENTRY_BUILD_COMMAND}`,
    })
  }

  if (content.includes(OPENNEXT_BUILD_PATTERN)) {
    violations.push({
      type: 'build-script-contract',
      file: configPath,
      rule: 'open-next-must-not-call-opennext-build',
      message: `${OPENNEXT_CONFIG_PATH} buildCommand must not call opennextjs-cloudflare build directly`,
    })
  }

  return violations
}

export function runBuildScriptContractGuard({
  root = process.cwd(),
  packageJsonPath = PACKAGE_JSON_PATH,
  readFile = (filePath) => readFileSync(filePath, 'utf8'),
  fileExists = (filePath) => existsSync(filePath),
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

  return [
    ...scanBuildScriptContract(pkg.scripts, packageJsonPath),
    ...scanBuildWrapperContract({ root, readFile, fileExists }),
    ...scanOpenNextConfigContract({ root, readFile, fileExists }),
  ]
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
    'scripts.build must invoke scripts/build.mjs.',
    'scripts["build:next"] must run next build.',
    'scripts["build:cloudflare"] must run opennextjs-cloudflare build.',
    'scripts["cf:build"] must alias scripts.build.',
    `${OPENNEXT_CONFIG_PATH} buildCommand must re-enter via ${OPENNEXT_REENTRY_CONTEXT_MARKER} ${OPENNEXT_REENTRY_BUILD_COMMAND}.`,
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
