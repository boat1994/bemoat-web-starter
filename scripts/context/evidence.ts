import { parseRoleEvidence } from './issue-parser.ts'
import { readGithubEvidence } from './github.ts'
import { readLocalGitEvidence } from './local-git.ts'
import { readProtectedPolicy } from './policy.ts'
import { repositoryEvidence, runContextCommand } from './runtime.ts'
import type { ContextCommandResult, ContextCommandRunner } from './runtime.ts'
import { normalizeContextEvidence, type NormalizedContextEvidence } from './model.ts'

export { readGithubEvidence, readLocalGitEvidence, readProtectedPolicy, runContextCommand }
export type { ContextCommandResult, ContextCommandRunner }

export function collectContextEvidence({
  cwd = process.cwd(),
  env = process.env,
  issueNumber,
  run = runContextCommand,
}: {
  cwd?: string
  env?: NodeJS.ProcessEnv
  issueNumber: string
  run?: ContextCommandRunner
}): NormalizedContextEvidence {
  const localGit = readLocalGitEvidence({ cwd, run })
  const configuredRepo = env.GH_REPO && /^[^/\s]+\/[^/\s]+$/.test(env.GH_REPO) ? env.GH_REPO : null
  const repo = configuredRepo ?? localGit.originRepository
  const errors: string[] = []
  if (!/^[1-9]\d*$/.test(issueNumber)) errors.push('EVIDENCE_CONFLICT: Issue identity is missing or malformed')
  if (!repo) errors.push('EVIDENCE_CONFLICT: canonical repository identity is unavailable')
  if (configuredRepo && localGit.originRepository && configuredRepo !== localGit.originRepository) {
    errors.push(`EVIDENCE_CONFLICT: configured repository ${configuredRepo} differs from origin ${localGit.originRepository}`)
  }

  const repository = repositoryEvidence(repo ?? 'unknown/unknown')
  const policyResult = repo
    ? readProtectedPolicy({ repo, baseBranch: 'main', run, cwd, env })
    : { branch: 'main', sha: null, policy: null, errors: ['EVIDENCE_CONFLICT: policy cannot be bound without repository identity'] }
  const github = repo
    ? readGithubEvidence({
      cwd,
      env,
      repo,
      issueNumber,
      branch: localGit.branch === '<detached>' ? null : localGit.branch,
      protectedBaseSha: policyResult.sha,
      run,
    })
    : {
      repository,
      issue: null,
      comments: [],
      activePrs: [],
      exactHead: null,
      protection: { available: false, source: 'unavailable' as const, requiredChecks: [], requiredApprovals: 0 },
      errors: ['EVIDENCE_CONFLICT: GitHub evidence cannot be read without repository identity'],
    }
  const roleEvidence = parseRoleEvidence(github.comments)
  const activePr = github.activePrs.length === 0 ? null : github.activePrs.length === 1 ? github.activePrs[0] : github.activePrs
  const issue = github.issue ?? {
    number: issueNumber,
    title: '',
    state: '',
    url: `https://github.com/${repo ?? 'unknown/unknown'}/issues/${issueNumber}`,
    objective: null,
    scope: null,
    acceptanceCriteria: [],
    dependencies: [],
    taskSize: null,
    missionControlMode: null,
    workflowProfile: null,
  }
  const policy = policyResult.policy ?? {
    path: 'docs/mission-control/mission-control-guide.md',
    policyId: '',
    version: '',
    sourceSha: '',
    url: `https://github.com/${repo ?? 'unknown/unknown'}/blob/main/docs/mission-control/mission-control-guide.md`,
  }

  return normalizeContextEvidence({
    repository,
    protectedBase: { branch: 'main', sha: policyResult.sha ?? '', source: 'live GitHub ref', url: `https://github.com/${repo ?? 'unknown/unknown'}/tree/main` },
    policy,
    issue,
    localGit,
    activePr,
    currentHeadVerification: github.activePrs.length === 1 ? github.exactHead : null,
    durableContext: { latestHandoff: roleEvidence.latestHandoff, historicalResults: roleEvidence.historicalResults },
    evidenceErrors: [...new Set([
      ...errors,
      ...policyResult.errors,
      ...github.errors,
      ...roleEvidence.invalid.map((comment) => `EVIDENCE_CONFLICT: malformed role comment ${comment.id}`),
      ...(github.issue || github.errors.some((error) => error.startsWith('EVIDENCE_CONFLICT: Issue identity'))
        ? []
        : ['BLOCKED_EXTERNAL: Issue evidence is unavailable']),
    ])],
  })
}
