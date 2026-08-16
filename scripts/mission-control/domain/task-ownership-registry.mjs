import {
  TASK_REGISTRY_SCHEMA,
  TASK_REGISTRY_OPERATION,
  TASK_REGISTRY_START,
  TASK_REGISTRY_END,
  buildTaskOwnershipPayload,
  createTaskOwnershipRecord as createTaskOwnershipRecordImpl,
  renderTaskOwnershipRecord,
  parseTaskOwnershipRecord,
  verifyTaskOwnershipRecord,
  classifyTaskOwnershipRecords,
} from './task-ownership-registry.ts'

export {
  TASK_REGISTRY_SCHEMA,
  TASK_REGISTRY_OPERATION,
  TASK_REGISTRY_START,
  TASK_REGISTRY_END,
  buildTaskOwnershipPayload,
  renderTaskOwnershipRecord,
  parseTaskOwnershipRecord,
  verifyTaskOwnershipRecord,
  classifyTaskOwnershipRecords,
}

/** @returns {any} */
export function createTaskOwnershipRecord(...args) {
  return createTaskOwnershipRecordImpl(args[0])
}
