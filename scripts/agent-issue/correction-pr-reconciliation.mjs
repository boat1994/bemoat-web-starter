import {
  collectKnownSourceThreads,
  extractVerdictPrBaseAndHead,
  parseCompleteGitHubPullUrl,
  resolveCanonicalVerdictPrIdentity,
} from '../pr-identity.mjs'
import { parseMissionControlState } from '../mission-control-state.mjs'
import { checkOpenPrsForIssueOrBranch, fetchPrByReference } from './github-evidence.mjs'
import { parsePrReference } from './issue-references.mjs'
import { getDefaultRepo } from './local-git-evidence.mjs'

/**
 * Reconcile the immutable contract reviewed_head against the visible verdict
 * head, then against uniquely identified live PR evidence, before granting
 * correction edit authorization. Fails closed for missing or mismatched PR
 * identity, head, base, state, or unavailable required evidence.
 * GitHub orchestration stays here — the correction-contract module remains pure.
 */
export function reconcileCorrectionPrEvidence({
  cwd,
  env,
  verdictBody,
  contractReviewedHead,
  mode = 'implementation_pr',
  branchName = null,
  issueNumber = null,
  contract = null,
  issueBody = null,
}) {
  const defaultRepo = getDefaultRepo(cwd)
  const knownSourceThreads = mode === 'planning_no_pr' ? collectKnownSourceThreads(contract) : null
  const identityResult = resolveCanonicalVerdictPrIdentity(
    verdictBody,
    defaultRepo,
    mode,
    knownSourceThreads,
    contract,
  )
  if (!identityResult.ok) {
    return { ok: false, errors: identityResult.errors }
  }

  const { base: verdictBase, head: verdictHead } = extractVerdictPrBaseAndHead(verdictBody)
  if (!verdictHead) {
    return {
      ok: false,
      errors: ['REVIEW_VERDICT is missing a `PR / base / head` line with an exact head SHA'],
    }
  }
  if (verdictHead !== contractReviewedHead) {
    return {
      ok: false,
      errors: ['REVIEW_VERDICT head contradicts the immutable contract reviewed_head'],
    }
  }

  if (mode === 'planning_no_pr') {
    const checkResult = checkOpenPrsForIssueOrBranch(cwd, env, branchName, issueNumber)
    if (!checkResult.ok) {
      return { ok: false, errors: [`live PR evidence is unavailable: ${checkResult.reason}`] }
    }
    if (checkResult.openPrs?.length > 0) {
      const pr = checkResult.openPrs[0]
      return {
        ok: false,
        errors: [
          `STATE CONFLICT: open PR #${pr.number} exists on GitHub for this planning issue under no-PR contract`,
        ],
      }
    }
    return { ok: true, errors: [], prNumber: null, prIdentity: null, livePr: null }
  }

  const { number: prNumber, key: prIdentity } = identityResult.identity

  const parsedManagedState = issueBody ? parseMissionControlState(issueBody) : null
  const managedState = parsedManagedState?.valid ? parsedManagedState.state : null
  if (managedState?.active_pr != null && prNumber != null) {
    const statePr = parsePrReference(String(managedState.active_pr))
    if (statePr?.number && String(statePr.number) !== String(prNumber)) {
      return {
        ok: false,
        errors: ['STATE CONFLICT: canonical REVIEW_VERDICT PR does not match managed-state active_pr'],
      }
    }
  }
  if (
    contractReviewedHead &&
    (!managedState?.last_reviewed_head || String(managedState.last_reviewed_head) !== String(contractReviewedHead))
  ) {
    return {
      ok: false,
      errors: ['STATE CONFLICT: canonical REVIEW_VERDICT reviewed_head does not match managed-state last_reviewed_head'],
    }
  }

  const prResult = fetchPrByReference(cwd, `${defaultRepo}#${prNumber}`, env)
  if (!prResult.ok) {
    return { ok: false, errors: [`live PR evidence is unavailable: ${prResult.reason}`] }
  }

  const livePr = prResult.pr
  if (!livePr?.headRefOid || !livePr?.baseRefName || !livePr?.state) {
    return {
      ok: false,
      errors: ['live PR evidence is missing required identity, head, base, or state fields'],
    }
  }

  const errors = []
  // Require authoritative, parseable repository-qualified live identity from the
  // fetched PR response. Do not infer identity solely from the requested PR number,
  // and do not skip reconciliation when url is absent or unparseable.
  if (livePr.url == null || String(livePr.url).length === 0) {
    errors.push('live PR evidence is missing required repository-qualified identity URL')
  } else {
    const liveUrlRaw = String(livePr.url)
    const parsedLive = parseCompleteGitHubPullUrl(liveUrlRaw)
    if (!parsedLive.ok) {
      errors.push(parsedLive.reason || 'live PR identity URL is present but unparseable')
    } else {
      const liveKey = parsedLive.identity.key
      if (liveKey !== prIdentity) {
        errors.push(`live PR identity ${liveKey} does not match REVIEW_VERDICT PR identity ${prIdentity}`)
      }

      // Alternate identity-like fields are never fallbacks; a conflict is ambiguous.
      if (Object.prototype.hasOwnProperty.call(livePr, 'number') && livePr.number != null) {
        const alternateNumber = String(livePr.number)
        if (alternateNumber !== parsedLive.identity.number) {
          errors.push(
            `live PR identity is ambiguous: url pull ${parsedLive.identity.number} conflicts with number field ${alternateNumber}`,
          )
        }
      }
      if (Object.prototype.hasOwnProperty.call(livePr, 'html_url') && livePr.html_url != null) {
        const alternateHtml = String(livePr.html_url)
        const parsedHtml = parseCompleteGitHubPullUrl(alternateHtml)
        if (!parsedHtml.ok || parsedHtml.identity.key !== liveKey) {
          errors.push('live PR identity is ambiguous: html_url conflicts with url')
        }
      }
    }
  }
  if (livePr.headRefOid !== contractReviewedHead) {
    errors.push('live PR head does not match the immutable contract reviewed_head')
  }
  if (verdictBase && livePr.baseRefName !== verdictBase) {
    errors.push('live PR base does not match the REVIEW_VERDICT approved base')
  }
  if (livePr.state !== 'OPEN') {
    errors.push(`live PR state is ${livePr.state}, not OPEN`)
  }

  return { ok: errors.length === 0, errors, prNumber, prIdentity, livePr }
}
