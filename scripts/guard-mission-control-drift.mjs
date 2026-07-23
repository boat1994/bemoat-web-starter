#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const RECONCILE_SCRIPT_PATH = 'scripts/mission-control-reconcile.mjs'

export function runMissionControlDriftGuard({
  root = process.cwd(),
  readFile = (filePath) => readFileSync(filePath, 'utf8'),
} = {}) {
  const violations = []
  
  try {
    const content = readFile(resolve(root, RECONCILE_SCRIPT_PATH))
    if (content.includes('CORRECTION_REQUIRED_3')) {
      violations.push({
        type: 'mission-control-drift',
        rule: 'MC-DRIFT-001',
        file: RECONCILE_SCRIPT_PATH,
        message: 'Must not emit or contain CORRECTION_REQUIRED_3',
      })
    }
  } catch (_err) {
    violations.push({
      type: 'mission-control-drift',
      rule: 'MC-DRIFT-000',
      file: RECONCILE_SCRIPT_PATH,
      message: 'Could not read reconcile script',
    })
  }

  return violations
}

export function formatMissionControlDriftViolations(violations) {
  if (violations.length === 0) {
    return ['Mission Control drift guard passed.']
  }

  const lines = [
    'Mission Control drift guard failed:',
    '',
    'Fix the violations below, then rerun `pnpm run bemoat:guard:safety`.',
    '',
  ]

  for (const item of violations) {
    lines.push(`- [${item.rule}] ${item.file}: ${item.message}`)
  }

  return lines
}

export function isDirectExecution() {
  const entrypoint = process.argv[1]
  if (!entrypoint) return false
  return import.meta.url === pathToFileURL(resolve(entrypoint)).href
}

function main() {
  const violations = runMissionControlDriftGuard()
  const lines = formatMissionControlDriftViolations(violations)

  for (const line of lines) console.log(line)

  process.exit(violations.length > 0 ? 1 : 0)
}

if (isDirectExecution()) main()
