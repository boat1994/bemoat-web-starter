#!/usr/bin/env node

import { runProductionStandardMerge } from './mission-control/workflows/merge-standard.mjs'

export * from './mission-control/workflows/merge-standard.mjs'

if (process.argv[1]?.endsWith('/mission-control-merge-standard.mjs')) runProductionStandardMerge()
