import type { ContextCommandRunner } from './runtime.ts'

export interface ApprovedBaseResolution {
  branch: string | null
  sha: string | null
  source: 'live GitHub ref'
  url: string
  errors: string[]
}

type RefQueryRunner = (
  command: string,
  args: readonly string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv },
) => { status: number | null; stdout: string; stderr: string; error: Error | null }

function readRefJson<T>(
  run: RefQueryRunner,
  args: readonly string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv },
): { value: T | null; error: string | null } {
  const result = run('gh', args, options)
  if ((result.status ?? 1) !== 0 || result.error) {
    const message = result.error?.message || result.stderr.trim() || result.stdout.trim() || 'gh returned no evidence'
    return { value: null, error: message }
  }
  const text = result.stdout.trim()
  if (!text) return { value: null, error: 'gh returned no evidence' }
  try {
    return { value: JSON.parse(text) as T, error: null }
  } catch (error) {
    return { value: null, error: `gh returned invalid JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
}

function refMissing(error: string | null): boolean {
  if (!error) return false
  const normalized = error.toLowerCase()
  return normalized.includes('not found') || normalized.includes('404')
}

function readRemoteRefHead({
  repo,
  branch,
  run,
  cwd = process.cwd(),
  env = process.env,
}: {
  repo: string
  branch: string
  run: RefQueryRunner
  cwd?: string
  env?: NodeJS.ProcessEnv
}): { sha: string | null; missing: boolean; error: string | null } {
  const ref = readRefJson<{ object?: { sha?: string } }>(
    run,
    ['api', `repos/${repo}/git/ref/heads/${branch}`],
    { cwd, env },
  )
  const sha = ref.value?.object?.sha ?? null
  if (sha) return { sha, missing: false, error: null }
  if (refMissing(ref.error)) return { sha: null, missing: true, error: null }
  return {
    sha: null,
    missing: false,
    error: ref.error ?? `live remote ref heads/${branch} is unavailable`,
  }
}

export function resolveApprovedBase({
  repo,
  run,
  cwd = process.cwd(),
  env = process.env,
}: {
  repo: string
  run: ContextCommandRunner | RefQueryRunner
  cwd?: string
  env?: NodeJS.ProcessEnv
}): ApprovedBaseResolution {
  const errors: string[] = []
  const dev = readRemoteRefHead({ repo, branch: 'dev', run, cwd, env })
  if (dev.error) {
    errors.push(`BLOCKED_EXTERNAL: live remote ref heads/dev is unavailable (${dev.error})`)
    return { branch: null, sha: null, source: 'live GitHub ref', url: '', errors }
  }
  if (dev.sha) {
    return {
      branch: 'dev',
      sha: dev.sha,
      source: 'live GitHub ref',
      url: `https://github.com/${repo}/tree/dev`,
      errors,
    }
  }

  const main = readRemoteRefHead({ repo, branch: 'main', run, cwd, env })
  if (main.error) {
    errors.push(`BLOCKED_EXTERNAL: live remote ref heads/main is unavailable (${main.error})`)
    return { branch: null, sha: null, source: 'live GitHub ref', url: '', errors }
  }
  if (main.sha) {
    return {
      branch: 'main',
      sha: main.sha,
      source: 'live GitHub ref',
      url: `https://github.com/${repo}/tree/main`,
      errors,
    }
  }

  if (dev.missing && main.missing) {
    errors.push('EVIDENCE_CONFLICT: approved-base-unresolved')
    return { branch: null, sha: null, source: 'live GitHub ref', url: '', errors }
  }

  errors.push('EVIDENCE_CONFLICT: approved-base-unresolved')
  return { branch: null, sha: null, source: 'live GitHub ref', url: '', errors }
}
