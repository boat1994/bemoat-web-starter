import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

import { writeIssueBodyWithLease } from '../workflows/issue-body-cas.mjs'
import { parseMissionControlState } from '../domain/task-state.mjs'
import {
  selectNextCampaignAction,
  validateCampaignTransition,
} from '../domain/campaign-authority.mjs'
import { parseCampaign } from '../domain/campaign-parser.mjs'
import { replaceCampaignBlock } from '../domain/campaign-renderer.mjs'
import {
  createCampaignOwnershipAdmission,
} from '../domain/merge-campaign-admission.mjs'
import { parseProductionMergeReviewVerdict } from '../domain/merge-review-verdict.mjs'
import { normalizePaginatedCommitMessages } from '../domain/merge-commit-messages.mjs'
import { blockerResolutionCampaignPostconditions } from '../domain/merge-blocker-campaign-postconditions.mjs'
import { blockedExternal, stateConflict } from '../domain/merge-errors.mjs'
import { campaignParseFailure } from '../domain/merge-campaign-errors.mjs'
import { sameTerminalBinding } from '../domain/merge-terminal-binding.mjs'
import { stateBlockReplacement } from '../domain/merge-state-block-replacement.mjs'
import { deriveCampaignExpansionAuthority } from '../domain/merge-campaign-expansion-authority.mjs'
import {
  projectCampaignBlockerResolved,
  projectCampaignSliceDone,
} from '../domain/merge-campaign-state-projection.mjs'
import { projectTaskDoneState } from '../domain/merge-task-done-projection.mjs'
import { commentSupersedesId } from '../domain/merge-comment-supersession.mjs'
import { normalizeIssueNumber } from '../domain/merge-issue-references.mjs'
import { flattenGhPages } from '../domain/merge-gh-pages.mjs'
import {
  authorizationValidationFailure,
  parseFounderMergeAuthorization,
} from '../domain/merge-founder-authority.mjs'

const FULL_SHA_RE = /^[0-9a-f]{40}$/i

function runGhCommand(args, options = {}) {
  const result = spawnSync('gh', args, { encoding: 'utf8', input: options.input, env: options.env ?? process.env })
  if (result.error || result.status !== 0) {
    throw blockedExternal(result.stderr || result.stdout || result.error?.message || 'GitHub CLI failed')
  }
  return result.stdout.trim()
}

function runNode(args, env = process.env) {
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', env })
  if (result.error || result.status !== 0) {
    throw new Error(result.stderr || result.stdout || result.error?.message || 'Mission Control reconciler failed')
  }
  return result.stdout.trim()
}

export function createProductionMergeDeps({ runGh = runGhCommand } = {}) {
  const readManagedIssue = async (issueNumber, repo) => {
    const issue = JSON.parse(runGh(['issue', 'view', String(issueNumber), '--repo', repo, '--json', 'number,id,title,body,state,stateReason']))
    const parsed = parseMissionControlState(issue.body)
    if (!parsed.present || !parsed.valid) throw stateConflict(`Issue has invalid managed state: ${parsed.reason ?? 'missing state block'}`)
    return { ...issue, managedState: parsed.state }
  }
  const readPullRequest = async (prNumber, repo) => {
    const pr = JSON.parse(runGh([
      'pr', 'view', String(prNumber), '--repo', repo,
      '--json', 'number,id,state,isDraft,mergeable,headRefOid,baseRefName,baseRefOid,statusCheckRollup,mergeCommit,url,title,body,closingIssuesReferences',
    ]))
    const commitPages = JSON.parse(runGh([
      'api', '--paginate', '--slurp', `repos/${repo}/pulls/${prNumber}/commits?per_page=100`,
    ]))
    return { ...pr, commits: normalizePaginatedCommitMessages(commitPages) }
  }

  const readIssueComment = (repo, issueNumber, commentId) => {
    const comment = JSON.parse(runGh(['api', `repos/${repo}/issues/comments/${commentId}`]))
    const expectedIssueUrl = `https://api.github.com/repos/${repo}/issues/${issueNumber}`
    if (comment.issue_url !== expectedIssueUrl || !comment.user?.login) {
      throw stateConflict(`Issue comment ${commentId} is not bound to Issue #${issueNumber} and an authenticated author`)
    }
    return comment
  }

  const readIssueComments = (repo, issueNumber) => {
    const pages = JSON.parse(runGh([
      'api', '--paginate', '--slurp', `repos/${repo}/issues/${issueNumber}/comments?per_page=100`,
    ]))
    return flattenGhPages(pages)
  }

  const readTrustedFounderLogins = async (repo) => {
    const variable = JSON.parse(runGh(['api', `repos/${repo}/actions/variables/BEMOAT_FOUNDER_LOGINS`]))
    const value = String(variable.value ?? '').trim()
    const logins = value.split(',').map((login) => login.trim()).filter(Boolean)
    if (logins.length === 0 || logins.some((login) => !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(login))) {
      throw stateConflict('repository Actions variable BEMOAT_FOUNDER_LOGINS must contain a comma-separated list of GitHub logins')
    }
    return logins
  }

  const readCampaignAuthorityEvidence = async (repo, campaignIssue) => {
    const [comments, trustedFounderLogins, mainRef] = await Promise.all([
      Promise.resolve(readIssueComments(repo, campaignIssue)),
      readTrustedFounderLogins(repo),
      Promise.resolve(JSON.parse(runGh(['api', `repos/${repo}/git/ref/heads/main`]))),
    ])
    const currentProtectedBaseSha = mainRef?.object?.sha
    if (!FULL_SHA_RE.test(String(currentProtectedBaseSha ?? ''))) {
      throw blockedExternal('live protected main ref is unavailable while verifying campaign expansion authority')
    }
    return {
      campaignExpansionAuthority: {
        comments,
        trustedFounderLogins,
        currentProtectedBaseSha,
      },
    }
  }

  const readCampaignIssue = async (repo, campaignIssue) => {
    const issue = JSON.parse(runGh(['issue', 'view', String(campaignIssue), '--repo', repo, '--json', 'body']))
    const evidence = await readCampaignAuthorityEvidence(repo, campaignIssue)
    const parsed = parseCampaign(issue.body, { evidence })
    if (!parsed.present || !parsed.valid) {
      campaignParseFailure(parsed, `campaign Issue #${campaignIssue} has invalid blocker-resolution completion evidence`)
    }
    if (normalizeIssueNumber(parsed.campaign?.campaign_issue) !== campaignIssue) {
      throw stateConflict(`campaign completion evidence is not bound to Campaign Issue #${campaignIssue}`)
    }
    return parsed
  }

  const readCampaignOwnership = createCampaignOwnershipAdmission({ readCampaignIssue })

  const readNextCampaignAction = async ({ repo, campaignIssue }) => {
    const parsed = await readCampaignIssue(repo, campaignIssue)
    return selectNextCampaignAction(parsed.campaign)
  }

  const readCampaignBlockerResolutionPostconditions = async ({
    repo,
    campaignIssue,
    campaignBlockerId,
    taskIssue,
    prNumber,
    reviewedHead,
    mergeCommit,
    finalResultCommentId,
  }) => {
    const parsed = await readCampaignIssue(repo, campaignIssue)
    const durableNextAction = selectNextCampaignAction(parsed.campaign)
    return {
      task: {
        state: 'DONE',
        task_issue: `#${taskIssue}`,
        canonical_pr: `#${prNumber}`,
        reviewed_head: reviewedHead,
        merge_commit: mergeCommit,
        final_result_comment_id: String(finalResultCommentId),
        open_blockers: [],
        next_permitted_action: 'none on this task',
      },
      campaign: blockerResolutionCampaignPostconditions(
        parsed.campaign,
        campaignBlockerId,
        durableNextAction,
      ),
    }
  }

  return {
    readManagedIssue,
    readPullRequest,
    readIssueComments,
    readFounderAuthorization: async (repo, issueNumber, commentId) => {
      const comment = readIssueComment(repo, issueNumber, commentId)
      const parsed = parseFounderMergeAuthorization(comment.body)
      if (parsed.author_login !== comment.user.login) {
        throw authorizationValidationFailure('Founder authorization Markdown author does not match the authenticated live GitHub comment author')
      }
      const superseded = readIssueComments(repo, issueNumber).some((entry) => {
        return String(entry.id) !== String(comment.id) && commentSupersedesId(entry.body, comment.id)
      })
      return {
        ...parsed,
        comment_id: String(comment.id),
        immutable_comment_reference: true,
        comment_sha256: createHash('sha256').update(String(comment.body ?? ''), 'utf8').digest('hex'),
        non_superseded: parsed.non_superseded === true && !superseded,
        superseded_by: superseded ? 'live-issue-comment-evidence' : (parsed.superseded_by ?? null),
      }
    },
    readCampaignBlockerResolutionPostconditions,
    readCampaignOwnership,
    readNextCampaignAction,
    readReviewVerdict: async (repo, issueNumber, commentId) => {
      const comment = readIssueComment(repo, issueNumber, commentId)
      return parseProductionMergeReviewVerdict(comment.body, comment.id)
    },
    readTrustedFounderLogins,
    readCampaignAuthorityEvidence,
    markReadyForReview: async (prNumber, repo) => { runGh(['pr', 'ready', String(prNumber), '--repo', repo]) },
    mergePullRequest: async ({ prNumber, repo, expectedHead }) => {
      runGh(['pr', 'merge', String(prNumber), '--repo', repo, '--merge', '--match-head-commit', expectedHead])
      return {}
    },
    verifyCommitOnProtectedBase: async ({ repo, base, commit }) => {
      const comparison = JSON.parse(runGh(['api', `repos/${repo}/compare/${commit}...${base}`]))
      return comparison.status === 'ahead' || comparison.status === 'identical'
    },
    postFinalResult: async ({ repo, issueNumber, body }) => {
      return JSON.parse(runGh([
        'api', '-X', 'POST', `repos/${repo}/issues/${issueNumber}/comments`, '--input', '-',
      ], { input: JSON.stringify({ body }) }))
    },
    closeIssueCompleted: async (issueNumber, repo) => {
      runGh(['issue', 'close', String(issueNumber), '--repo', repo, '--reason', 'completed'])
    },
    writeTaskDone: async ({ repo, issueNumber, expectedState, mergeCommit, resultCommentId, prNumber, reviewedHead }) => {
      const live = await readManagedIssue(issueNumber, repo)
      if (live.managedState.state === 'DONE' && live.managedState.merged_commit_sha === mergeCommit) return { state: 'DONE' }
      if (!sameTerminalBinding(live.managedState, expectedState)) {
        throw stateConflict('Task DONE CAS/lease precondition changed before direct projection')
      }
      const nextState = projectTaskDoneState(live.managedState, { mergeCommit, resultCommentId })
      await writeIssueBodyWithLease({
        repo,
        issueNumber,
        expectedBody: live.body,
        nextBody: stateBlockReplacement(live.body, nextState),
        transitionIdentity: `merge-completion:${issueNumber}:${prNumber}:${reviewedHead}:${mergeCommit}`,
        holder: 'mission-control-merge',
        repoFlag: repo,
        deps: { runGh },
      })
      const verified = await readManagedIssue(issueNumber, repo)
      if (verified.managedState.state !== 'DONE' || verified.managedState.merged_commit_sha !== mergeCommit) {
        throw stateConflict('Task DONE direct projection did not survive postcondition verification')
      }
      return { state: 'DONE' }
    },
    projectCampaignSliceDone: async ({ repo, campaignIssue, campaignSlice, taskIssue, prNumber, reviewedHead, mergeCommit, authorizationCommentId }) => {
      const issue = JSON.parse(runGh(['issue', 'view', String(campaignIssue), '--repo', repo, '--json', 'body,state']))
      const hasExpansionAuthority = /campaign_expansion_authority\s*:/.test(String(issue.body ?? ''))
      const evidence = hasExpansionAuthority ? await readCampaignAuthorityEvidence(repo, campaignIssue) : undefined
      const parsed = parseCampaign(issue.body, { evidence })
      if (!parsed.present || !parsed.valid) campaignParseFailure(parsed, `campaign Issue #${campaignIssue} has invalid projection`)
      const key = String(campaignSlice)
      const nextCampaign = projectCampaignSliceDone(parsed.campaign, {
        campaignSlice,
        taskIssue,
        prNumber,
        reviewedHead,
        mergeCommit,
        authorizationCommentId,
      })
      const transition = validateCampaignTransition(parsed.campaign, nextCampaign, {
        mode: 'lifecycle',
        targetSlice: key,
        evidence,
      })
      if (!transition.valid) {
        throw stateConflict(`${transition.code ?? 'CAMPAIGN_TRANSITION_INVALID'}: ${transition.reason}`)
      }
      const replacement = replaceCampaignBlock(issue.body, nextCampaign, { evidence })
      if (!replacement.unchanged) {
        await writeIssueBodyWithLease({
          repo,
          issueNumber: campaignIssue,
          expectedBody: issue.body,
          nextBody: replacement.body,
          transitionIdentity: `merge-campaign:${campaignIssue}:${key}:${taskIssue}:${mergeCommit}`,
          holder: 'mission-control-merge',
          repoFlag: repo,
          deps: { runGh },
        })
      }
      const verified = JSON.parse(runGh(['issue', 'view', String(campaignIssue), '--repo', repo, '--json', 'body']))
      const verifiedEvidence = hasExpansionAuthority ? await readCampaignAuthorityEvidence(repo, campaignIssue) : undefined
      const verifiedCampaign = parseCampaign(verified.body, { evidence: verifiedEvidence })
      if (!verifiedCampaign.valid || verifiedCampaign.campaign?.slices?.[key]?.status !== 'DONE') {
        campaignParseFailure(verifiedCampaign, `campaign slice ${key} DONE projection did not survive postcondition verification`)
      }
      return { status: 'DONE', campaignIssue, campaignSlice }
    },
    projectCampaignBlockerResolved: async ({
      repo,
      campaignIssue,
      campaignBlockerId,
      taskIssue,
      prNumber: _prNumber,
      reviewedHead: _reviewedHead,
      mergeCommit,
      authorizationCommentId: _authorizationCommentId,
      nextAction,
    }) => {
      const issue = JSON.parse(runGh(['issue', 'view', String(campaignIssue), '--repo', repo, '--json', 'body,state']))
      const hasExpansionAuthority = /campaign_expansion_authority\s*:/.test(String(issue.body ?? ''))
      const evidence = await readCampaignAuthorityEvidence(repo, campaignIssue)
      const priorParsed = parseCampaign(issue.body, hasExpansionAuthority ? { evidence } : undefined)
      if (!priorParsed.present || !priorParsed.valid) campaignParseFailure(priorParsed, `campaign Issue #${campaignIssue} has invalid blocker-resolution projection`)

      const priorCampaign = structuredClone(priorParsed.campaign)
      const authority = priorCampaign.campaign_expansion_authority ?? deriveCampaignExpansionAuthority(repo, campaignIssue, evidence)
      const nextCampaign = projectCampaignBlockerResolved(priorCampaign, {
        campaignBlockerId,
        authority,
      })
      const transition = validateCampaignTransition(priorCampaign, nextCampaign, {
        mode: 'blocker-resolution',
        blockerId: campaignBlockerId,
        evidence,
      })
      if (!transition.valid) {
        throw stateConflict(`${transition.code ?? 'CAMPAIGN_TRANSITION_INVALID'}: ${transition.reason}`)
      }
      const replacement = replaceCampaignBlock(issue.body, nextCampaign, { evidence })
      if (!replacement.unchanged) {
        await writeIssueBodyWithLease({
          repo,
          issueNumber: campaignIssue,
          expectedBody: issue.body,
          nextBody: replacement.body,
          transitionIdentity: `merge-campaign-blocker:${campaignIssue}:${campaignBlockerId}:${taskIssue}:${mergeCommit}`,
          holder: 'mission-control-merge',
          repoFlag: repo,
          deps: { runGh },
        })
      }
      const verified = JSON.parse(runGh(['issue', 'view', String(campaignIssue), '--repo', repo, '--json', 'body']))
      const verifiedEvidence = await readCampaignAuthorityEvidence(repo, campaignIssue)
      const verifiedCampaign = parseCampaign(verified.body, { evidence: verifiedEvidence })
      if (!verifiedCampaign.valid || verifiedCampaign.campaign?.campaign_blockers?.some((blocker) => blocker.id === campaignBlockerId)) {
        campaignParseFailure(verifiedCampaign, `campaign blocker ${campaignBlockerId} resolution did not survive postcondition verification`)
      }
      const verifiedSlice = verifiedCampaign.campaign?.slices?.['5']
      if (verifiedSlice?.status !== 'NOT_STARTED' || verifiedSlice.blocker_ids.includes(campaignBlockerId)) {
        throw stateConflict('blocker-resolution changed or failed to preserve Slice 5 NOT_STARTED state')
      }
      return {
        status: 'RESOLVED',
        campaignIssue,
        campaignBlockerId,
        postconditions: {
          campaign: blockerResolutionCampaignPostconditions(
            verifiedCampaign.campaign,
            campaignBlockerId,
            nextAction,
          ),
        },
      }
    },
    selectNextCampaignAction: async ({ repo, campaignIssue }) => {
      const issue = JSON.parse(runGh(['issue', 'view', String(campaignIssue), '--repo', repo, '--json', 'body']))
      const hasExpansionAuthority = /campaign_expansion_authority\s*:/.test(String(issue.body ?? ''))
      const evidence = hasExpansionAuthority ? await readCampaignAuthorityEvidence(repo, campaignIssue) : undefined
      const parsed = parseCampaign(issue.body, { evidence })
      if (!parsed.valid) campaignParseFailure(parsed, 'campaign evidence is unavailable while selecting the next action')
      return selectNextCampaignAction(parsed.campaign)
    },
    reconcile: async (issueNumber, repo) => {
      const stdout = runNode(
        ['../../mission-control-reconcile.mjs', String(issueNumber), '--repo', repo],
        { ...process.env, GH_REPO: repo },
      )
      const finalOutcome = stdout.match(/Mission Control reconciliation\s+(\S+):/)?.[1] ?? null
      const issue = await readManagedIssue(issueNumber, repo)
      return { finalOutcome, state: issue.managedState }
    },
  }
}
