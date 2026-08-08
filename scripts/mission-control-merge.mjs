#!/usr/bin/env node

import { runProductionMerge } from './mission-control/workflows/merge.mjs'

export * from './mission-control/workflows/merge.mjs'

if (process.argv[1]?.endsWith('/mission-control-merge.mjs')) runProductionMerge()
