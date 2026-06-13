#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const HOOKS_DIR = '.githooks'
const PRE_PUSH_HOOK = `${HOOKS_DIR}/pre-push`

function main() {
  const root = process.cwd()
  const prePushPath = resolve(root, PRE_PUSH_HOOK)

  if (!existsSync(prePushPath)) {
    console.error(`Missing ${PRE_PUSH_HOOK}. Cannot install git hooks.`)
    process.exit(1)
  }

  try {
    chmodSync(prePushPath, 0o755)
  } catch {
    // Non-fatal on platforms that ignore chmod
  }

  execFileSync('git', ['config', 'core.hooksPath', HOOKS_DIR], {
    cwd: root,
    stdio: 'inherit',
  })

  console.log(`Installed git hooks from ${HOOKS_DIR}/`)
  console.log('pre-push runs: pnpm run guard:safety, typecheck, test:int')
  console.log('CI remains the final source of truth for pull requests.')
}

main()
