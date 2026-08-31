import type { CommandMetadataDependencies } from './mission-control-command-metadata-deps.ts'

/** No recovery-family commands remain in the public registry. */
export function missionControlRecoveryCommands(_dependencies: CommandMetadataDependencies) {
  return {}
}
