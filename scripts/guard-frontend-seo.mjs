#!/usr/bin/env node
import { main, isDirectExecution as isDirectExecutionImpl } from './guards/frontend-seo.mjs'

export {
  FRONTEND_LAYOUT_PATH,
  OPTIONAL_SEO_PATHS,
  formatFrontendSeoViolations,
  getFrontendSeoGuardExitCode,
  runFrontendSeoGuard,
  scanFrontendLayoutMetadata,
  scanOptionalSeoFile,
} from './guards/frontend-seo.mjs'

export function isDirectExecution() {
  return isDirectExecutionImpl(import.meta.url)
}

if (isDirectExecution()) main()
