import {
  LIVE_OVERRIDE_PATH,
  MC_MANAGED_PATHS,
  SYNC_SCRIPT_PATH,
} from './inventory.mjs'
import { violation } from './violation.mjs'

export function extractManagedPathsFromSyncScript(content) {
  const match = content.match(/export const managedPaths = \[([\s\S]*?)\]/)
  if (!match) return []
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
}

export function scanManagedPathsContract(managedPaths) {
  const violations = []
  const paths = managedPaths ?? []

  for (const path of MC_MANAGED_PATHS) {
    if (!paths.includes(path)) {
      violations.push(
        violation('MC009', SYNC_SCRIPT_PATH, `Mission Control managed path missing from managedPaths: ${path}`),
      )
    }
  }

  if (paths.includes(LIVE_OVERRIDE_PATH)) {
    violations.push(
      violation('MC010', SYNC_SCRIPT_PATH, 'Live child override path must not be included in managedPaths'),
    )
  }

  return violations
}
