import { spawnSync } from 'node:child_process'

import { writeIssueBodyWithLease } from '../workflows/issue-body-cas.mjs'
import { normalizeSha } from '../domain/recover-state-evidence.mjs'

function blockedExternal(message) {
  const error = new Error(`BLOCKED_EXTERNAL: ${message}`)
  error.classification = 'BLOCKED_EXTERNAL'
  return error
}

function headDrift(message) {
  const error = new Error(`HEAD_DRIFT: ${message}`)
  error.classification = 'HEAD_DRIFT'
  return error
}

function runGhCommand(args, options = {}) {
  const result = spawnSync('gh', args, {
    encoding: 'utf8',
    input: options.input,
    env: options.env ?? process.env,
  })
  if (result.error || result.status !== 0) {
    throw blockedExternal(result.stderr || result.stdout || result.error?.message || 'GitHub CLI failed')
  }
  return result.stdout.trim()
}

export function createProductionRecoverStateDeps({ runGh = runGhCommand } = {}) {
  const invokeGh = (args, options = {}) => {
    try {
      return runGh(args, options)
    } catch (error) {
      if (error?.classification) throw error
      throw blockedExternal(error instanceof Error ? error.message : String(error))
    }
  }

  return {
    readManagedIssue: async (issueNumber, repo) => JSON.parse(invokeGh([
      'issue', 'view', String(issueNumber), '--repo', repo, '--json', 'number,id,title,body,state',
    ])),
    readPullRequest: async (prNumber, repo) => JSON.parse(invokeGh([
      'pr', 'view', String(prNumber), '--repo', repo,
      '--json', 'number,state,isDraft,headRefName,headRefOid,baseRefName,baseRefOid',
    ])),
    readComment: async (repo, commentId) => JSON.parse(invokeGh([
      'api', `repos/${repo}/issues/comments/${commentId}`,
    ])),
    readIssueComments: async (repo, issueNumber) => {
      const pages = JSON.parse(invokeGh([
        'api', '--paginate', '--slurp',
        `repos/${repo}/issues/${issueNumber}/comments?per_page=100`,
      ]))
      if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
        throw blockedExternal('live Issue comment pagination is incomplete')
      }
      return pages.flat()
    },
    readTrustedFounderLogins: async (repo) => {
      const variable = JSON.parse(invokeGh(['api', `repos/${repo}/actions/variables/BEMOAT_FOUNDER_LOGINS`]))
      const logins = String(variable.value ?? '').split(',').map((login) => login.trim()).filter(Boolean)
      if (logins.length === 0) throw blockedExternal('Founder identity configuration is unavailable')
      return logins
    },
    readProtectedPolicy: async (repo, ref, expectedSha) => {
      const commit = JSON.parse(invokeGh([
        'api', `repos/${repo}/commits/${expectedSha}`,
      ]))
      if (normalizeSha(commit.sha) !== normalizeSha(expectedSha)) {
        throw headDrift('protected Mission Control policy commit does not match the requested base SHA')
      }
      const file = JSON.parse(invokeGh([
        'api', `repos/${repo}/contents/docs/mission-control/mission-control-guide.md?ref=${expectedSha}`,
      ]))
      const body = Buffer.from(String(file.content ?? '').replace(/\s+/g, ''), 'base64').toString('utf8')
      const version = body.match(/(?:version|Guide version)\s*[`:]\s*([0-9]+\.[0-9]+\.[0-9]+)/i)?.[1] ?? null
      if (!normalizeSha(file.sha)) throw blockedExternal('protected Mission Control guide blob identity is unavailable')
      return { ref, commitSha: expectedSha, sha: file.sha, guideVersion: version }
    },
    verifyCommitAncestry: async ({ repository, base, baseSha, ancestor, descendant }) => {
      const result = spawnSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { encoding: 'utf8' })
      if (result.status === 0) return true
      if (result.status === 1) return false
      throw blockedExternal(result.stderr || result.stdout || result.error?.message || `trusted Git ancestry verification failed for ${repository} ${base}@${baseSha}`)
    },
    writeIssueBody: async ({ repo, issueNumber, expectedBody, nextBody, transitionIdentity }) =>
      writeIssueBodyWithLease({
        repo,
        issueNumber,
        expectedBody,
        nextBody,
        transitionIdentity,
        holder: 'mission-control-recover-state',
        repoFlag: repo,
        deps: { runGh: invokeGh },
      }),
  }
}
