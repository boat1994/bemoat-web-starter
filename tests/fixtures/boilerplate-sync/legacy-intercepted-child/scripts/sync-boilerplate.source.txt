#!/usr/bin/env node
import { writeFileSync } from 'node:fs'

function enforceRetiredMissionControlGate() {
  throw new Error(
    'legacy Mission Control gate requires historical Issue and HANDOFF state',
  )
}

enforceRetiredMissionControlGate()

// This represents the mutation that legacy discovery must never reach.
writeFileSync('.legacy-sync-mutated', 'unexpected mutation\n')
