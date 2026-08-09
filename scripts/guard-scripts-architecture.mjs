#!/usr/bin/env node
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export {
  ArchitectureContractError,
  assertArchitectureContract,
  buildScriptImportGraph,
  collectInternalEdges,
  findStronglyConnectedComponents,
  listRootScripts,
  validateArchitectureContract,
  validateRootScriptMap,
} from './guards/scripts-architecture.mjs'

import { validateArchitectureContract } from './guards/scripts-architecture.mjs'

export function isDirectExecution() {
  const entrypoint = process.argv[1]
  if (!entrypoint) return false
  return import.meta.url === pathToFileURL(resolve(entrypoint)).href
}

function main() {
  const root = process.cwd()
  const violations = validateArchitectureContract(root)

  if (violations.length > 0) {
    console.error('Scripts architecture contract validation failed:')
    for (const violation of violations) {
      console.error(`- ${violation}`)
    }
    process.exit(1)
  } else {
    console.log('Scripts architecture contract validation passed.')
    process.exit(0)
  }
}

if (isDirectExecution()) main()
