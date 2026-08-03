import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  AGENTS_PATH,
  BOILERPLATE_INVENTORY_PATH,
  GUIDE_PATH,
  HANDOFF_PATH,
  LOADER_PATH,
  MANIFEST_PATH,
  MC_MANAGED_MODULES,
  MC_MANAGED_PATHS,
  RESULT_PATH,
  COMMAND_REFERENCE_PATH,
  ROLE_HANDOFF_PATH,
  SYNC_SCRIPT_PATH,
} from './inventory.mjs'
import { scanGuideContent } from './scan-guide.mjs'
import { scanLoaderContent, scanAgentsPointer } from './scan-loader.mjs'
import { scanCommandReferenceContent } from './scan-command-reference.mjs'
import { scanManagedPathsContract, extractManagedPaths } from './managed-paths.mjs'
import { scanModuleContent } from './scan-modules.mjs'
import { scanHandoffTemplate, scanResultTemplate, scanRoleHandoffContract } from './scan-transport.mjs'
import { violation } from './violation.mjs'

function readOptional(root, relativePath, readFile) {
  const absolutePath = resolve(root, relativePath)
  if (!existsSync(absolutePath)) return null
  return readFile(absolutePath)
}

export function runMissionControlContractGuard({
  root = process.cwd(),
  readFile = (filePath) => readFileSync(filePath, 'utf8'),
  managedPaths,
} = {}) {
  const violations = []

  let guide = readOptional(root, GUIDE_PATH, readFile) || ''

  for (const modPath of MC_MANAGED_MODULES) {
    const modContent = readOptional(root, modPath, readFile)
    if (!modContent) {
      violations.push(violation('MC013', modPath, 'Required module is missing'))
    } else {
      violations.push(...scanModuleContent(modPath, modContent))
    }
  }

  violations.push(...scanGuideContent(GUIDE_PATH, guide))

  const loader = readOptional(root, LOADER_PATH, readFile)
  violations.push(...scanLoaderContent(LOADER_PATH, loader))

  const agents = readOptional(root, AGENTS_PATH, readFile)
  violations.push(...scanAgentsPointer(AGENTS_PATH, agents))

  const handoff = readOptional(root, HANDOFF_PATH, readFile)
  violations.push(...scanHandoffTemplate(HANDOFF_PATH, handoff))

  const result = readOptional(root, RESULT_PATH, readFile)
  violations.push(...scanResultTemplate(RESULT_PATH, result))

  const roleHandoff = readOptional(root, ROLE_HANDOFF_PATH, readFile)
  violations.push(...scanRoleHandoffContract(ROLE_HANDOFF_PATH, roleHandoff))

  const commandReference = readOptional(root, COMMAND_REFERENCE_PATH, readFile)
  violations.push(...scanCommandReferenceContent(COMMAND_REFERENCE_PATH, commandReference))

  let paths = managedPaths
  if (!paths) {
    const inventorySource = readOptional(root, BOILERPLATE_INVENTORY_PATH, readFile)
    const syncSource = readOptional(root, SYNC_SCRIPT_PATH, readFile)
    paths = extractManagedPaths({ inventory: inventorySource, legacySync: syncSource })

    const manifestRaw = readOptional(root, MANIFEST_PATH, readFile)
    if (manifestRaw) {
      try {
        const manifest = JSON.parse(manifestRaw)
        const manifestPaths = Array.isArray(manifest.managedPaths) ? manifest.managedPaths : []
        const syncSet = new Set(paths)
        const manifestSet = new Set(manifestPaths)
        for (const path of MC_MANAGED_PATHS) {
          if (syncSet.has(path) !== manifestSet.has(path)) {
            violations.push(violation('MC009', MANIFEST_PATH, `Mission Control path parity mismatch for ${path}`))
          }
        }
      } catch {
        violations.push(violation('MC009', MANIFEST_PATH, 'Could not parse boilerplate sync manifest'))
      }
    }
  }

  violations.push(...scanManagedPathsContract(paths))

  return violations
}
