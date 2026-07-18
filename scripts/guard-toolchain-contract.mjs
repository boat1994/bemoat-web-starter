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

function violation(rule, message, file = TOOLCHAIN_CONTRACT_PATH) {
  return { rule, message, file }
}

function parseEffectiveProject(configPath, readFile) {
  const host = {
    ...ts.sys,
    readFile: (path) => readFile(path),
  }
  const config = ts.readConfigFile(configPath, host.readFile)
  if (config.error) return { errors: [config.error], options: {}, fileNames: [] }
  return ts.parseJsonConfigFileContent(config.config, host, resolve(configPath), undefined, configPath)
}

function getImporterTypeScript(lockfile) {
  const importerSection = lockfile.slice(0, lockfile.indexOf('\npackages:') === -1 ? undefined : lockfile.indexOf('\npackages:'))
  const rootImporterStart = importerSection.search(/^  \.:\n/m)
  if (rootImporterStart === -1) return null
  const rootImporterBodyStart = rootImporterStart + '  .:\n'.length
  const nextImporter = importerSection.slice(rootImporterBodyStart).search(/^  [^ ].*:\n/m)
  const importer = importerSection.slice(
    rootImporterBodyStart,
    nextImporter === -1 ? undefined : rootImporterBodyStart + nextImporter,
  )
  const typeScript = importer?.match(/^      typescript:\n        specifier: ([^\n]+)\n        version: ([^\n]+)/m)
  return typeScript ? { specifier: typeScript[1], version: typeScript[2] } : null
}

export function getExpectedRootStrictNullChecks({ root, contractRoot, contract }) {
  return resolve(root) === resolve(contractRoot)
    ? contract.compiler.starterRootStrictNullChecks
    : contract.compiler.childStrictNullChecks
}

export function scanToolchainContract({ root = process.cwd(), contractRoot = root, readFile = readTextFile } = {}) {
  const contractPath = resolve(contractRoot, TOOLCHAIN_CONTRACT_PATH)
  if (!existsSync(contractPath)) return [violation('missing-contract', 'Managed toolchain contract is missing')]

  const contract = readJSON(contractPath, readFile)
  const packageJSON = readJSON(resolve(root, 'package.json'), readFile)
  const strictConfigPath = resolve(root, contract.compiler.harnessStrictConfig)
  const violations = []

  if (packageJSON.devDependencies?.typescript !== contract.typescript) {
    violations.push(violation('typescript-version', `package.json must pin typescript@${contract.typescript}`, 'package.json'))
  }
  if (packageJSON.engines?.node !== `>=${contract.node}`) {
    violations.push(violation('node-engine', `package.json must require Node >=${contract.node}`, 'package.json'))
  }

  const importerTypeScript = getImporterTypeScript(readFile(resolve(root, 'pnpm-lock.yaml'), 'utf8'))
  if (!importerTypeScript || importerTypeScript.specifier !== contract.typescript || importerTypeScript.version !== contract.typescript) {
    violations.push(violation('typescript-lockfile-importer', `Root pnpm importer must specify and resolve typescript@${contract.typescript}`, 'pnpm-lock.yaml'))
  }

  try {
    const installed = readJSON(resolve(root, 'node_modules/typescript/package.json'), readFile)
    if (installed.version !== contract.typescript) {
      violations.push(violation('typescript-installed', `Installed TypeScript must be ${contract.typescript}`, 'node_modules/typescript/package.json'))
    }
  } catch {
    violations.push(violation('typescript-installed', 'Installed TypeScript could not be proven', 'node_modules/typescript/package.json'))
  }

  const rootConfig = parseEffectiveProject(resolve(root, 'tsconfig.json'), readFile)
  if (rootConfig.errors.length > 0) {
    violations.push(violation('root-config', 'Root tsconfig must resolve without errors', 'tsconfig.json'))
  }
  if (rootConfig.options.strict !== contract.compiler.strict) {
    violations.push(violation('root-strict', 'Root tsconfig must preserve strict mode', 'tsconfig.json'))
  }
  const expectedRootStrictNullChecks = getExpectedRootStrictNullChecks({ root, contractRoot, contract })
  if (rootConfig.options.strictNullChecks !== expectedRootStrictNullChecks) {
    violations.push(violation(
      'root-strict-null-checks',
      expectedRootStrictNullChecks
        ? 'Child root tsconfig must preserve effective strictNullChecks: true'
        : 'Starter root tsconfig strictNullChecks must match the registered exception',
      'tsconfig.json',
    ))
  }
  if (!existsSync(strictConfigPath)) {
    violations.push(violation('missing-harness-config', 'Harness strict tsconfig is missing', contract.compiler.harnessStrictConfig))
    return violations
  }

  const strictConfig = parseEffectiveProject(strictConfigPath, readFile)
  if (strictConfig.errors.length > 0) {
    violations.push(violation('harness-config', 'Harness strict tsconfig must resolve without errors', contract.compiler.harnessStrictConfig))
  }
  if (strictConfig.options.strict !== true || strictConfig.options.strictNullChecks !== true) {
    violations.push(violation('harness-strict-null-checks', 'Harness strict tsconfig must force strict and strictNullChecks', contract.compiler.harnessStrictConfig))
  }
  const effectiveFiles = new Set(strictConfig.fileNames.map((file) => resolve(file)))
  const requiredInputs = [contract.compiler.ambientInput, ...contract.compiler.harnessRoots]
  for (const required of requiredInputs) {
    const requiredFiles = ts.sys.readDirectory(root, ['.ts', '.mts', '.cts'], undefined, [required])
    if (requiredFiles.length === 0) {
      violations.push(violation('missing-harness-root', `Managed harness root ${required} did not resolve to a file`, contract.compiler.harnessStrictConfig))
      continue
    }
    for (const file of requiredFiles) {
      if (!effectiveFiles.has(resolve(file))) {
        violations.push(violation('missing-harness-project-file', `Harness strict project excludes required input ${required}`, contract.compiler.harnessStrictConfig))
      }
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
