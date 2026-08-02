import {
  LIVE_OVERRIDE_PATH,
  MC_MANAGED_PATHS,
  SYNC_SCRIPT_PATH,
} from './inventory.mjs'
import { violation } from './violation.mjs'

export function extractManagedPathsFromSyncScript(content) {
  return extractManagedPathsFromInventory(content)
}

export function extractManagedPathsFromInventory(content) {
  const match = content.match(/export const managedPaths = \[([\s\S]*?)\]/)
  if (!match) return []

  const constants = new Map(
    [...content.matchAll(/(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*'([^']+)'/g)].map(
      ([, name, value]) => [name, value],
    ),
  )
  const paths = []

  const inventoryEntries = match[1].replace(/\/\/.*$/gm, '')

  for (const [, literal, reference] of inventoryEntries.matchAll(/'([^']+)'|([A-Za-z_$][\w$]*)\s*(?=,|$)/gm)) {
    if (literal) {
      paths.push(literal)
      continue
    }

    const value = constants.get(reference)
    if (!value) return []
    paths.push(value)
  }

  return paths
}

export function extractManagedPaths({ inventory, legacySync }) {
  if (inventory !== null && inventory !== undefined) {
    return extractManagedPathsFromInventory(inventory)
  }

  return extractManagedPathsFromSyncScript(legacySync || '')
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
