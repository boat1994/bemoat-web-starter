import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { acquireVitestProcessLock } from '../helpers/vitestProcessLock'

export const setup = (): (() => void) => {
  const checkoutKey = createHash('sha256').update(process.cwd()).digest('hex').slice(0, 16)
  const lockPath = join(tmpdir(), `bemoat-vitest-${checkoutKey}.lock`)

  return acquireVitestProcessLock(lockPath)
}
