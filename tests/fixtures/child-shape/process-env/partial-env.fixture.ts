type EnvironmentInput = { env: NodeJS.ProcessEnv }

declare function resolveProductionCommentTrust(input: EnvironmentInput): unknown

// Safe only at the test boundary: partial fixture → unknown → ProcessEnv.
resolveProductionCommentTrust({
  env: {
    NODE_ENV: 'test',
    PAYLOAD_SECRET: 'test',
  } as unknown as NodeJS.ProcessEnv,
})

declare function enforceChildSyncGate(input: { argv: string[], env: NodeJS.ProcessEnv }): unknown

enforceChildSyncGate({
  argv: [],
  env: {} as unknown as NodeJS.ProcessEnv,
})

enforceChildSyncGate({
  argv: ['--harness-only'],
  env: {} as unknown as NodeJS.ProcessEnv,
})
