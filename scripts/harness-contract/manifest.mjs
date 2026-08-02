import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export function loadManagedPathsFromManifest(root = process.cwd()) {
  const manifestPath = join(root, '.bemoat/boilerplate-sync-manifest.json')
  if (!existsSync(manifestPath)) return null

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  return Array.isArray(manifest.managedPaths) ? manifest.managedPaths : null
}
