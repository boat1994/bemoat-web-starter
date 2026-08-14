import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

const managedPathsManifestSchema = z.looseObject({
  managedPaths: z.array(z.unknown()),
})

export function loadManagedPathsFromManifest(root: string = process.cwd()): unknown[] | null {
  const manifestPath = join(root, '.bemoat/boilerplate-sync-manifest.json')
  if (!existsSync(manifestPath)) return null

  const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))

  if (parsed === null) {
    return (null as unknown as { managedPaths: unknown }).managedPaths as never
  }

  const result = managedPathsManifestSchema.safeParse(parsed)
  if (!result.success) return null

  return result.data.managedPaths
}
