import type { PolicyEvidence } from './model.ts'
import { json, type ContextCommandRunner } from './runtime.ts'

export interface ProtectedPolicyResult {
  branch: string
  sha: string | null
  policy: PolicyEvidence | null
  errors: string[]
}

function frontmatterValue(content: string, key: string): string | null {
  return content.match(new RegExp(`^${key}:\\s*([^\\n]+)\\s*$`, 'mi'))?.[1]?.trim() ?? null
}

export function readProtectedPolicy({ repo, baseBranch, run, cwd = process.cwd(), env = process.env }: {
  repo: string
  baseBranch: string
  run: ContextCommandRunner
  cwd?: string
  env?: NodeJS.ProcessEnv
}): ProtectedPolicyResult {
  const errors: string[] = []
  const ref = json<{ object?: { sha?: string } }>(run, 'gh', ['api', `repos/${repo}/git/ref/heads/${baseBranch}`], { cwd, env })
  const sha = ref.value?.object?.sha ?? null
  if (!sha) errors.push(`BLOCKED_EXTERNAL: protected ${baseBranch} SHA is unavailable${ref.error ? ` (${ref.error})` : ''}`)
  const content = sha
    ? json<{ sha?: string; content?: string; encoding?: string }>(run, 'gh', ['api', `repos/${repo}/contents/docs/mission-control/mission-control-guide.md?ref=${sha}`], { cwd, env })
    : { value: null, error: 'protected base SHA is unavailable' }
  let policy: PolicyEvidence | null = null
  if (!content.value?.content || content.value.encoding !== 'base64' || !content.value.sha) {
    errors.push(`BLOCKED_EXTERNAL: canonical policy source is unavailable${content.error ? ` (${content.error})` : ''}`)
  } else {
    const decoded = Buffer.from(content.value.content.replace(/\s/g, ''), 'base64').toString('utf8')
    const frontmatter = decoded.match(/^---\s*\n([\s\S]*?)\n---/)
    const policyId = frontmatter ? frontmatterValue(frontmatter[1], 'policy_id') : null
    const version = frontmatter ? frontmatterValue(frontmatter[1], 'version') : null
    if (!policyId || !version) errors.push('EVIDENCE_CONFLICT: canonical policy frontmatter is missing policy_id or version')
    else policy = {
      path: 'docs/mission-control/mission-control-guide.md',
      policyId,
      version,
      sourceSha: content.value.sha,
      url: `https://github.com/${repo}/blob/${sha}/docs/mission-control/mission-control-guide.md`,
    }
  }
  return { branch: baseBranch, sha, policy, errors }
}
