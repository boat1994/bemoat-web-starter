#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

export const TOOLCHAIN_CONTRACT_PATH = '.bemoat/toolchain-contract.json'

const readTextFile = (path) => readFileSync(path, 'utf8')

function readJSON(path, readFile = readTextFile) {
  return JSON.parse(readFile(path, 'utf8'))
}

function readJsonc(path, readFile = readTextFile) {
  const parsed = ts.parseConfigFileTextToJson(path, readFile(path, 'utf8'))
  if (parsed.error) throw new Error(ts.flattenDiagnosticMessageText(parsed.error.messageText, '\\n'))
  return parsed.config
}

function violation(rule, message, file = TOOLCHAIN_CONTRACT_PATH) {
  return { rule, message, file }
}

export function scanToolchainContract({ root = process.cwd(), readFile = readTextFile } = {}) {
  const contractPath = resolve(root, TOOLCHAIN_CONTRACT_PATH)
  if (!existsSync(contractPath)) return [violation('missing-contract', 'Managed toolchain contract is missing')]

  const contract = readJSON(contractPath, readFile)
  const packageJSON = readJSON(resolve(root, 'package.json'), readFile)
  const rootConfig = readJsonc(resolve(root, 'tsconfig.json'), readFile)
  const strictConfigPath = resolve(root, contract.compiler.harnessStrictConfig)
  const violations = []

  if (packageJSON.devDependencies?.typescript !== contract.typescript) {
    violations.push(violation('typescript-version', `package.json must pin typescript@${contract.typescript}`, 'package.json'))
  }
  if (packageJSON.engines?.node !== `>=${contract.node}`) {
    violations.push(violation('node-engine', `package.json must require Node >=${contract.node}`, 'package.json'))
  }

  const lockfile = readFile(resolve(root, 'pnpm-lock.yaml'), 'utf8')
  if (!lockfile.includes(`typescript@${contract.typescript}`)) {
    violations.push(violation('typescript-lockfile', `pnpm-lock.yaml must resolve typescript@${contract.typescript}`, 'pnpm-lock.yaml'))
  }

  try {
    const installed = readJSON(resolve(root, 'node_modules/typescript/package.json'), readFile)
    if (installed.version !== contract.typescript) {
      violations.push(violation('typescript-installed', `Installed TypeScript must be ${contract.typescript}`, 'node_modules/typescript/package.json'))
    }
  } catch {
    violations.push(violation('typescript-installed', 'Installed TypeScript could not be proven', 'node_modules/typescript/package.json'))
  }

  if (rootConfig.compilerOptions?.strict !== contract.compiler.strict) {
    violations.push(violation('root-strict', 'Root tsconfig must preserve strict mode', 'tsconfig.json'))
  }
  if (rootConfig.compilerOptions?.strictNullChecks !== contract.compiler.starterRootStrictNullChecks) {
    violations.push(violation('root-strict-null-checks', 'Root tsconfig strictNullChecks must match the registered starter exception', 'tsconfig.json'))
  }
  if (!existsSync(strictConfigPath)) {
    violations.push(violation('missing-harness-config', 'Harness strict tsconfig is missing', contract.compiler.harnessStrictConfig))
    return violations
  }

  const strictConfig = readJSON(strictConfigPath, readFile)
  if (strictConfig.compilerOptions?.strict !== true || strictConfig.compilerOptions?.strictNullChecks !== true) {
    violations.push(violation('harness-strict-null-checks', 'Harness strict tsconfig must force strict and strictNullChecks', contract.compiler.harnessStrictConfig))
  }
  const includes = strictConfig.include ?? []
  for (const required of [contract.compiler.ambientInput, ...contract.compiler.harnessRoots]) {
    if (!includes.includes(required)) {
      violations.push(violation('missing-harness-root', `Harness strict tsconfig must include ${required}`, contract.compiler.harnessStrictConfig))
    }
  }

  return violations
}

export function getToolchainContractExitCode(violations) {
  return violations.length === 0 ? 0 : 1
}

export function formatToolchainContractViolations(violations) {
  if (violations.length === 0) return ['Toolchain contract guard passed.']
  return ['Toolchain contract guard failed:', '', ...violations.map((item) => `- [${item.rule}] ${item.file}: ${item.message}`)]
}

export function isDirectExecution() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
}

if (isDirectExecution()) {
  const violations = scanToolchainContract()
  for (const line of formatToolchainContractViolations(violations)) console.log(line)
  process.exit(getToolchainContractExitCode(violations))
}
