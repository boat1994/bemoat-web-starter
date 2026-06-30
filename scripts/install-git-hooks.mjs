#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const HOOKS_DIR = '.githooks'
const HOOKS = [`${HOOKS_DIR}/pre-commit`, `${HOOKS_DIR}/pre-push`]

function main() {
  const root = process.cwd()

  for (const hook of HOOKS) {
    const hookPath = resolve(root, hook)

    if (!existsSync(hookPath)) {
      console.error(`Missing ${hook}. Cannot install git hooks.`)
      process.exit(1)
    }

    try {
      chmodSync(hookPath, 0o755)
    } catch {
      // Non-fatal on platforms that ignore chmod
    }
  }

  execFileSync('git', ['config', 'core.hooksPath', HOOKS_DIR], {
    cwd: root,
    stdio: 'inherit',
  })

  console.log(`Installed git hooks from ${HOOKS_DIR}/`)
  console.log('pre-commit runs: bash scripts/check-branch-safety.sh')
  console.log('pre-push runs: branch safety, pnpm run bemoat:guard:safety, bemoat:test:int')
  console.log('pre-push does not run typecheck, lint, or build — add those scripts locally when ready')
  console.log('CI remains the final source of truth for pull requests.')
}

main()
