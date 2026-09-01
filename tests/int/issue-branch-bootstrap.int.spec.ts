import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { readLocalGitEvidence } from '../../scripts/context/evidence.ts'
import type {
  ContextCommandResult,
  ContextCommandRunner,
} from '../../scripts/context/evidence.ts'
import type { NormalizedContextEvidence } from '../../scripts/context/model.ts'
import { routeContext } from '../../scripts/context/router.ts'

const root = process.cwd()
const baseSha = 'a'.repeat(40)
const implementationSha = 'b'.repeat(40)
const nonDurableStories: Array<[
  string,
  Partial<NormalizedContextEvidence['localGit']>,
]> = [
  ['actual unpushed implementation commit', {
    head: implementationSha,
    pushed: false,
    durable: false,
    reasons: ['LOCAL_STATE_NOT_DURABLE: current HEAD is not proven pushed to its live upstream'],
  }],
  ['dirty worktree', {
    clean: false,
    durable: false,
    reasons: ['LOCAL_STATE_NOT_DURABLE: working tree is dirty or has untracked files'],
  }],
  ['detached checkout', {
    branch: '<detached>',
    detached: true,
    durable: false,
    reasons: ['LOCAL_STATE_NOT_DURABLE: repository is detached'],
  }],
]

function response(stdout = ''): ContextCommandResult {
  return { status: 0, stdout, stderr: '', error: null }
}

function contextEvidence({
  protectedBranch,
  localGit = {},
  evidenceErrors = [],
}: {
  protectedBranch: 'main' | 'dev'
  localGit?: Partial<NormalizedContextEvidence['localGit']>
  evidenceErrors?: string[]
}): NormalizedContextEvidence {
  const branch = 'fix/465-durable-branch-bootstrap'
  return {
    repository: {
      owner: 'boat1994',
      name: protectedBranch === 'main' ? 'bemoat-web-starter' : 'child-project',
      nameWithOwner: `boat1994/${protectedBranch === 'main' ? 'bemoat-web-starter' : 'child-project'}`,
      url: `https://github.com/boat1994/${protectedBranch === 'main' ? 'bemoat-web-starter' : 'child-project'}`,
    },
    protectedBase: {
      branch: protectedBranch,
      sha: baseSha,
      source: 'live GitHub ref',
      url: `https://github.com/boat1994/${protectedBranch === 'main' ? 'bemoat-web-starter' : 'child-project'}/tree/${protectedBranch}`,
    },
    policy: {
      path: 'docs/mission-control/mission-control-guide.md',
      policyId: 'bemoat-mission-control',
      version: '1.3.0',
      sourceSha: 'c'.repeat(40),
      url: `https://github.com/boat1994/${protectedBranch === 'main' ? 'bemoat-web-starter' : 'child-project'}/blob/${baseSha}/docs/mission-control/mission-control-guide.md`,
    },
    issue: {
      number: '465',
      title: 'durable issue-branch bootstrap',
      state: 'OPEN',
      url: `https://github.com/boat1994/${protectedBranch === 'main' ? 'bemoat-web-starter' : 'child-project'}/issues/465`,
      objective: 'Make first-time issue-branch bootstrap deterministic.',
      scope: 'Branch bootstrap only.',
      acceptanceCriteria: [],
      dependencies: [],
      taskSize: 'core',
      missionControlMode: 'optional',
      workflowProfile: 'STANDARD',
    },
    localGit: {
      branch,
      head: baseSha,
      upstream: `origin/${branch}`,
      originRepository: `boat1994/${protectedBranch === 'main' ? 'bemoat-web-starter' : 'child-project'}`,
      clean: true,
      detached: false,
      pushed: true,
      durable: true,
      reasons: [],
      ...localGit,
    },
    activePr: null,
    currentHeadVerification: null,
    durableContext: { latestHandoff: null, historicalResults: [] },
    evidenceErrors,
  }
}

describe('Issue #465 durable zero-delta branch bootstrap stories', () => {
  it.each(['main', 'dev'] as const)(
    'routes a clean zero-delta topic branch published from %s to IMPLEMENT',
    (protectedBranch) => {
      expect(routeContext(contextEvidence({ protectedBranch }))).toMatchObject({
        route: 'IMPLEMENT',
        reasons: ['No active PR is present and the local topic branch is durable.'],
      })
    },
  )

  it.each(nonDurableStories)('keeps %s fail-closed', (_story, localGit) => {
    const decision = routeContext(contextEvidence({ protectedBranch: 'main', localGit }))

    expect(decision.route).toBe('STOP')
    expect(decision.reasons.join(' ')).toMatch(/LOCAL_STATE_NOT_DURABLE/)
  })

  it.each([
    'EVIDENCE_CONFLICT: configured repository boat1994/bemoat-web-starter differs from origin boat1994/wrong-repository',
    'EVIDENCE_CONFLICT: active PR base does not match the live protected base',
  ])('keeps identity ambiguity fail-closed: %s', (error) => {
    expect(routeContext(contextEvidence({
      protectedBranch: 'main',
      evidenceErrors: [error],
    })).route).toBe('STOP')
  })

  it.each([
    ['absent remote branch', ''],
    ['conflicting remote branch head', `${implementationSha}\trefs/heads/fix/465-durable-branch-bootstrap\n`],
  ])('does not accept %s as durable readback', (_story, remoteReadback) => {
    const calls: string[] = []
    const run: ContextCommandRunner = (command, args) => {
      const key = `${command} ${args.join(' ')}`
      calls.push(key)
      const values: Record<string, string> = {
        'git branch --show-current': 'fix/465-durable-branch-bootstrap\n',
        'git rev-parse HEAD': `${baseSha}\n`,
        'git status --short': '',
        'git rev-parse --abbrev-ref --symbolic-full-name @{upstream}': 'origin/fix/465-durable-branch-bootstrap\n',
        'git remote get-url origin': 'git@github.com:boat1994/bemoat-web-starter.git\n',
        'git ls-remote --heads origin fix/465-durable-branch-bootstrap': remoteReadback,
      }
      return response(values[key])
    }

    const evidence = readLocalGitEvidence({ cwd: '/repo', run })

    expect(evidence).toMatchObject({ pushed: false, durable: false })
    expect(evidence.reasons.join(' ')).toMatch(/LOCAL_STATE_NOT_DURABLE/)
    expect(calls.some((call) => /\bgit (?:push|switch|checkout|commit|reset|stash)\b/.test(call))).toBe(false)
  })

  it('documents one explicit zero-delta push boundary and exact post-push readback', () => {
    const workflow = readFileSync(resolve(root, 'docs/agent-loop/issue-driven-branch-workflow.md'), 'utf8')
    const agents = readFileSync(resolve(root, 'AGENTS.md'), 'utf8')
    const normalized = workflow.replace(/\s+/g, ' ')

    expect(workflow).toContain('## Durable zero-delta branch bootstrap')
    expect(normalized).toMatch(/No registered `bemoat:\*` command.*native Git mutation boundary/i)
    expect(normalized).toMatch(/remote topic branch must be absent.*do not guess.*overwrite/i)
    expect(workflow).toContain('git switch -c <topic-branch> <exact-base-sha>')
    expect(workflow).toContain('git push -u origin HEAD:refs/heads/<topic-branch>')
    expect(normalized).toMatch(/base line.*match.*local HEAD/i)
    expect(normalized).toMatch(/topic line.*absent/i)
    expect(normalized).toMatch(/local topic branch.*must be absent/i)
    expect(workflow).toContain('git ls-remote --heads origin refs/heads/<base-branch> refs/heads/<topic-branch>')
    expect(normalized).toMatch(/immediately read back.*base.*topic/i)
    expect(normalized).toMatch(/Do not force-push.*read back.*local HEAD.*upstream.*live remote (?:topic )?branch/i)
    expect(normalized).toMatch(/local HEAD.*live remote (?:topic )?branch.*exact protected.*integration.*base SHA/i)
    expect(normalized).toMatch(/failure.*ambiguity.*STOP.*no file edit/i)
    expect(agents).toMatch(/durable zero-delta branch bootstrap/i)
  })
})
