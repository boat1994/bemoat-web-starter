import { spawnSync } from 'node:child_process'

/**
 * Collect changed paths from the immutable reviewed head to the current head.
 * @param {string} reviewedHead
 * @param {typeof spawnSync} [spawn]
 */
export function collectGitDiffFiles(reviewedHead, spawn = spawnSync) {
  const result = spawn('git', ['diff', '--name-only', reviewedHead, 'HEAD'], { encoding: 'utf8' })
  if (result.error || result.status !== 0) {
    return {
      ok: false,
      errors: [result.stderr?.trim() || result.error?.message || 'git diff failed'],
    }
  }
  const files = result.stdout.split('\n').map((line) => line.trim()).filter(Boolean)
  return { ok: true, files }
}
