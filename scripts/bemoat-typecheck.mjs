#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { getToolchainContractExitCode, scanToolchainContract } from './guards/toolchain-contract.mjs'

const root = process.cwd()
const violations = scanToolchainContract({ root })
if (getToolchainContractExitCode(violations) !== 0) {
  for (const violation of violations) console.error(`[${violation.rule}] ${violation.file}: ${violation.message}`)
  process.exit(1)
}

for (const config of ['tsconfig.json', 'tsconfig.harness-strict.json']) {
  execFileSync('pnpm', ['exec', 'tsc', '--noEmit', '-p', config], { cwd: resolve(root), stdio: 'inherit' })
}
