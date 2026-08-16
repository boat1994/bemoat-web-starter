import { verifyFinalTask as verifyFinalTaskImpl } from './task-bootstrap-final-readback.ts'

/** @returns {Promise<any>} */
export async function verifyFinalTask(...args) {
  return verifyFinalTaskImpl(args[0])
}
