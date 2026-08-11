export function fetchIssueComments({ repository, issueNumber, runGh }) {
  return runGh('gh', ['api', '--paginate', `repos/${repository}/issues/${issueNumber}/comments`])
}

export function postIssueComment({ repository, issueNumber, payloadPath, runGh }) {
  return runGh('gh', ['api', '--method', 'POST', `repos/${repository}/issues/${issueNumber}/comments`, '--input', payloadPath])
}
