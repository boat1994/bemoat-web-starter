import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

export function fetchIssueComments({ repository, issueNumber, runGh }) {
  return runGh('gh', ['api', '--paginate', `repos/${repository}/issues/${issueNumber}/comments`])
}

export function postIssueComment({ repository, issueNumber, payloadPath, runGh }) {
  return runGh('gh', ['api', '--method', 'POST', `repos/${repository}/issues/${issueNumber}/comments`, '--input', payloadPath])
}

export function readRoleCommentIssue({ issue, repo, fields }) {
  const args = ['issue', 'view', issue, '--json', fields]
  if (repo) args.push('--repo', repo)
  return spawnSync('gh', args, { encoding: 'utf8' })
}

export function postRoleComment({ issue, repo, body }) {
  const directory = mkdtempSync(join(tmpdir(), 'bemoat-role-comment-'))
  const bodyPath = join(directory, 'comment.md')
  writeFileSync(bodyPath, body, 'utf8')
  const args = ['issue', 'comment', issue]
  if (repo) args.push('--repo', repo)
  args.push('--body-file', bodyPath)
  try {
    return spawnSync('gh', args, { encoding: 'utf8' })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
