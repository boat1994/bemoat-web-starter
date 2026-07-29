type TrustInput = { env: NodeJS.ProcessEnv }

declare function resolveProductionCommentTrust(input: TrustInput): unknown

// Mirrors mission-control-reconcile.int.spec.ts partial env fixtures.
resolveProductionCommentTrust({
  env: {
    NODE_ENV: 'test',
    PAYLOAD_SECRET: 'test',
    BEMOAT_MC_TRUSTED_AUTHORS: 'boat1994',
  } as NodeJS.ProcessEnv,
})

declare function enforceMcTransitionChildSyncGate(input: { argv: string[], env: NodeJS.ProcessEnv }): unknown

enforceMcTransitionChildSyncGate({
  argv: [],
  env: {} as NodeJS.ProcessEnv,
})

enforceMcTransitionChildSyncGate({
  argv: ['--harness-only'],
  env: {} as NodeJS.ProcessEnv,
})
