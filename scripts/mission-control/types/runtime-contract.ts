/**
 * Phase 0 runtime contract for future Mission Control TypeScript modules.
 *
 * This is a compatibility boundary only. It does not replace or wrap any
 * existing .mjs implementation.
 */
export const MISSION_CONTROL_TYPESCRIPT_RUNTIME = {
  execution: 'node-native-type-stripping',
  moduleSystem: 'esm',
  relativeImportExtensions: 'required',
  sourceMaps: 'not-generated-for-type-stripping',
  syntax: 'erasable-typescript-only',
} as const

export type MissionControlTypeScriptRuntime = typeof MISSION_CONTROL_TYPESCRIPT_RUNTIME
