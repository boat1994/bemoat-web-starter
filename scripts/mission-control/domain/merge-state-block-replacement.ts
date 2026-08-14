import { projectMissionControlStateBlock } from './task-state.ts'

export function stateBlockReplacement(body: unknown = '', state: unknown = {}): string {
  return Reflect.apply(projectMissionControlStateBlock, undefined, [body, state])
}
