import {
  buildCorrectionCapsule,
  derivePlanningArtifactAllowlist,
  parseCorrectionContract,
  validateCorrectionScope,
} from '../mission-control/domain/correction-contract.ts'
import {
  resolveAuthoritativeCorrectionContract,
} from '../mission-control/domain/active-correction-contract.ts'
import { findLatestRoleComment } from '../mission-control-reconcile.mjs'
import {
  extractVerdictPrBaseAndHead,
} from '../mission-control/domain/pr-identity.ts'
import { recoverCurrentAuthority as recoverCurrentAuthorityGrant } from './current-post-budget-authority.mjs'
import { analyzeExactHeadCi } from './exact-head-ci.mjs'
import {
  fetchIssueCommentById,
  fetchIssueComments,
  fetchPrByReference,
  fetchPullReviewCommentById,
} from './github-evidence.mjs'
import { verifyReviewThreeCorrectionAuthorization } from './historical-review3-authority.mjs'
import { getCorrectionDiffFiles, getDefaultRepo } from './local-git-evidence.mjs'
import { reconcileCorrectionPrEvidence } from './correction-pr-reconciliation.mjs'
import { verifyPlanningNoPrDurableProofs } from './planning-no-pr-lineage.mjs'

function recoverCurrentAuthority({ cwd, env, issueNumber, issueBody, comments }) {
  return recoverCurrentAuthorityGrant({
    cwd,
    env,
    issueNumber,
    issueBody,
    comments,
    getDefaultRepo,
    fetchIssueCommentById,
    fetchPullReviewCommentById,
    fetchPrByReference,
    analyzeExactHeadCi,
  })
}

export function runCorrectionPhasePreflight({
  cwd,
  env,
  issueNumber,
  branchName,
  statusShort,
  dirty,
  branchSafety,
  issueMetadata,
  fallbackIssueUrl,
}) {
  const output = [
    'Bemoat correction-mode preflight',
    `Issue number: ${issueNumber}`,
    `Current branch: ${branchName}`,
    `Working tree: ${dirty ? 'not clean' : 'clean'}`,
  ]

  if (!branchSafety.ok) {
    output.push('Stop: branch safety failed before correction edit authorization.')
    output.push(...(branchSafety.lines.length > 0 ? branchSafety.lines : ['<no branch safety output>']))
    return { ok: false, exitCode: 1, usageError: false, output, issueNumber, branchName, statusShort, issueMetadata }
  }

  if (dirty) {
    output.push('Stop: dirty working tree blocks correction edit authorization.')
    return { ok: false, exitCode: 1, usageError: false, output, issueNumber, branchName, statusShort, issueMetadata }
  }

  const commentResult = fetchIssueComments(cwd, issueNumber, env)
  if (!commentResult.ok) {
    output.push(`Stop: cannot reconstruct canonical findings (${commentResult.reason}).`)
    return { ok: false, exitCode: 1, usageError: false, output, issueNumber, branchName, statusShort, issueMetadata }
  }

  const currentAuthority = recoverCurrentAuthority({
    cwd,
    env,
    issueNumber,
    issueBody: issueMetadata.body ?? '',
    comments: commentResult.comments,
  })
  if (currentAuthority) {
    if (!currentAuthority.ok) {
      output.push('Stop: pinned current authority sources failed before correction edit authorization.')
      for (const error of currentAuthority.errors) output.push(`- ${error}`)
      return { ok: false, exitCode: 1, usageError: false, output, issueNumber, branchName, statusShort, issueMetadata }
    }
    const capsule = buildCorrectionCapsule(currentAuthority.contract, {
      issueNumber,
      prUrl: currentAuthority.livePr.url,
      mode: 'implementation_pr',
    })
    return {
      ok: true,
      exitCode: 0,
      usageError: false,
      output: [
        'Bemoat correction-mode preflight',
        `Issue: ${issueMetadata.url ?? fallbackIssueUrl ?? `#${issueNumber}`}`,
        ...capsule.lines,
        'Edit authorization: granted for the immutable finding set only.',
      ],
      issueNumber,
      branchName,
      statusShort,
      issueMetadata,
      correctionContract: currentAuthority.contract,
    }
  }

  const latestVerdict = findLatestRoleComment(commentResult.comments, 'REVIEW_VERDICT')
  const activeResolved = resolveAuthoritativeCorrectionContract({
    issueBody: issueMetadata.body ?? '',
    latestCorrectionVerdictBody:
      latestVerdict?.parsed?.verdict === 'CORRECTION REQUIRED'
        ? latestVerdict.comment?.body ?? null
        : null,
  })
  if (activeResolved.ok && activeResolved.source === 'active_correction_contract_identity') {
    const parsedContract = { ok: true, contract: activeResolved.contract }
    const defaultRepo = getDefaultRepo(cwd)
    const reviewThreeAuthorization = verifyReviewThreeCorrectionAuthorization({
      issueBody: issueMetadata.body ?? '',
      contract: parsedContract.contract,
      comments: commentResult.comments,
      issueNumber,
      defaultRepo,
      cwd,
      env,
      fetchIssueCommentById,
    })
    if (!reviewThreeAuthorization.ok) {
      output.push('Stop: Review 3 Founder correction authorization failed before correction edit authorization.')
      for (const error of reviewThreeAuthorization.errors) output.push(`- ${error}`)
      return { ok: false, exitCode: 1, usageError: false, output, issueNumber, branchName, statusShort, issueMetadata }
    }

    if (parsedContract.contract.mode === 'planning_no_pr') {
      const { base: verdictBase } = extractVerdictPrBaseAndHead(latestVerdict?.comment?.body ?? '')
      const durableProofs = verifyPlanningNoPrDurableProofs({
        cwd,
        env,
        issueBody: issueMetadata.body ?? '',
        issueNumber,
        contractReviewedHead: parsedContract.contract.reviewed_head,
        branchName,
        verdictBase,
      })
      if (!durableProofs.ok) {
        output.push('Stop: planning_no_pr durable authorization proofs failed before correction edit authorization.')
        for (const error of durableProofs.errors) output.push(`- ${error}`)
        return { ok: false, exitCode: 1, usageError: false, output, issueNumber, branchName, statusShort, issueMetadata }
      }
    }

    const reconciliation = reconcileCorrectionPrEvidence({
      cwd,
      env,
      verdictBody: latestVerdict?.comment?.body ?? '',
      contractReviewedHead: parsedContract.contract.reviewed_head,
      mode: parsedContract.contract.mode,
      branchName,
      issueNumber,
      contract: parsedContract.contract,
      issueBody: issueMetadata.body ?? '',
    })
    if (!reconciliation.ok) {
      output.push('Stop: live PR evidence does not reconcile with the immutable contract head before correction edit authorization.')
      for (const error of reconciliation.errors) output.push(`- ${error}`)
      return { ok: false, exitCode: 1, usageError: false, output, issueNumber, branchName, statusShort, issueMetadata }
    }
    if (reviewThreeAuthorization.reviewThree) {
      const ci = analyzeExactHeadCi(reconciliation.livePr)
      if (!ci.exactHeadVerified) {
        output.push(`Stop: Review 3 correction requires successful exact-head CI (${ci.summary}).`)
        return { ok: false, exitCode: 1, usageError: false, output, issueNumber, branchName, statusShort, issueMetadata }
      }
    }

    const diffResult = getCorrectionDiffFiles(cwd, parsedContract.contract.reviewed_head, env)
    if (diffResult.ok && diffResult.files.length > 0) {
      const scopeCheck = validateCorrectionScope(parsedContract.contract, diffResult.files, { mode: parsedContract.contract.mode })
      if (!scopeCheck.ok) {
        output.push('Stop: correction diff touches prohibited scope.')
        for (const error of scopeCheck.errors) output.push(`- ${error}`)
        return { ok: false, exitCode: 1, usageError: false, output, issueNumber, branchName, statusShort, issueMetadata }
      }
    }

    const prUrl =
      reconciliation.livePr?.url ||
      null
    const capsule = buildCorrectionCapsule(parsedContract.contract, {
      issueNumber,
      prUrl,
      mode: parsedContract.contract.mode,
    })
    return {
      ok: true,
      exitCode: 0,
      usageError: false,
      output: [
        'Bemoat correction-mode preflight',
        `Issue: ${issueMetadata.url ?? fallbackIssueUrl ?? `#${issueNumber}`}`,
        ...capsule.lines,
        'Edit authorization: granted for the immutable finding set only.',
        'Authoritative source: active_correction_contract_identity (reconciled union).',
      ],
      issueNumber,
      branchName,
      statusShort,
      issueMetadata,
      correctionContract: parsedContract.contract,
    }
  }

  if (!activeResolved.ok) {
    output.push('Stop: authoritative correction contract resolution failed before correction edit authorization.')
    for (const error of activeResolved.errors) output.push(`- ${error}`)
    return { ok: false, exitCode: 1, usageError: false, output, issueNumber, branchName, statusShort, issueMetadata }
  }

  if (activeResolved.source !== 'review_verdict') {
    output.push('Stop: correction fallback requires an explicit successful REVIEW_VERDICT authority source.')
    return { ok: false, exitCode: 1, usageError: false, output, issueNumber, branchName, statusShort, issueMetadata }
  }

  if (!latestVerdict?.comment?.body) {
    output.push('Stop: missing correction-eligible REVIEW_VERDICT with immutable findings.')
    return { ok: false, exitCode: 1, usageError: false, output, issueNumber, branchName, statusShort, issueMetadata }
  }

  if (latestVerdict.parsed?.verdict !== 'CORRECTION REQUIRED') {
    output.push(
      `Stop: latest REVIEW_VERDICT is ${latestVerdict.parsed?.verdict ?? 'unknown'}, not CORRECTION REQUIRED.`,
    )
    return { ok: false, exitCode: 1, usageError: false, output, issueNumber, branchName, statusShort, issueMetadata }
  }

  const parsedContract = parseCorrectionContract(latestVerdict.comment.body)
  if (!parsedContract.ok) {
    output.push('Stop: canonical finding evidence is missing, malformed, or inconsistent.')
    for (const error of parsedContract.errors) output.push(`- ${error}`)
    return { ok: false, exitCode: 1, usageError: false, output, issueNumber, branchName, statusShort, issueMetadata }
  }

  const defaultRepo = getDefaultRepo(cwd)
  const reviewThreeAuthorization = verifyReviewThreeCorrectionAuthorization({
    issueBody: issueMetadata.body ?? '',
    contract: parsedContract.contract,
    comments: commentResult.comments,
    issueNumber,
    defaultRepo,
    cwd,
    env,
    fetchIssueCommentById,
  })
  if (!reviewThreeAuthorization.ok) {
    output.push('Stop: Review 3 Founder correction authorization failed before correction edit authorization.')
    for (const error of reviewThreeAuthorization.errors) output.push(`- ${error}`)
    return { ok: false, exitCode: 1, usageError: false, output, issueNumber, branchName, statusShort, issueMetadata }
  }

  if (parsedContract.contract.mode === 'planning_no_pr') {
    const { base: verdictBase } = extractVerdictPrBaseAndHead(latestVerdict.comment.body)
    const durableProofs = verifyPlanningNoPrDurableProofs({
      cwd,
      env,
      issueBody: issueMetadata.body ?? '',
      issueNumber,
      contractReviewedHead: parsedContract.contract.reviewed_head,
      branchName,
      verdictBase,
    })
    if (!durableProofs.ok) {
      output.push('Stop: planning_no_pr durable authorization proofs failed before correction edit authorization.')
      for (const error of durableProofs.errors) output.push(`- ${error}`)
      return { ok: false, exitCode: 1, usageError: false, output, issueNumber, branchName, statusShort, issueMetadata }
    }
  }

  const reconciliation = reconcileCorrectionPrEvidence({
    cwd,
    env,
    verdictBody: latestVerdict.comment.body,
    contractReviewedHead: parsedContract.contract.reviewed_head,
    mode: parsedContract.contract.mode,
    branchName,
    issueNumber,
    contract: parsedContract.contract,
    issueBody: issueMetadata.body ?? '',
  })
  if (!reconciliation.ok) {
    output.push('Stop: live PR evidence does not reconcile with the immutable contract head before correction edit authorization.')
    for (const error of reconciliation.errors) output.push(`- ${error}`)
    return { ok: false, exitCode: 1, usageError: false, output, issueNumber, branchName, statusShort, issueMetadata }
  }
  if (reviewThreeAuthorization.reviewThree) {
    const ci = analyzeExactHeadCi(reconciliation.livePr)
    if (!ci.exactHeadVerified) {
      output.push(`Stop: Review 3 correction requires successful exact-head CI (${ci.summary}).`)
      return { ok: false, exitCode: 1, usageError: false, output, issueNumber, branchName, statusShort, issueMetadata }
    }
  }

  const diffResult = getCorrectionDiffFiles(cwd, parsedContract.contract.reviewed_head, env)
  if (diffResult.ok && diffResult.files.length > 0) {
    const scopeCheck = validateCorrectionScope(parsedContract.contract, diffResult.files, { mode: parsedContract.contract.mode })
    if (!scopeCheck.ok) {
      output.push('Stop: correction diff touches prohibited scope.')
      for (const error of scopeCheck.errors) output.push(`- ${error}`)
      return { ok: false, exitCode: 1, usageError: false, output, issueNumber, branchName, statusShort, issueMetadata }
    }
  }

  const prUrl =
    reconciliation.livePr?.url ||
    (reconciliation.prIdentity
      ? `https://github.com/${reconciliation.prIdentity.replace('#', '/pull/')}`
      : reconciliation.prNumber
        ? `PR #${reconciliation.prNumber}`
        : null)
  const issueRef =
    issueMetadata.available && issueMetadata.url
      ? issueMetadata.url
      : fallbackIssueUrl || `#${issueNumber}`

  const capsule = buildCorrectionCapsule(parsedContract.contract, {
    issueNumber,
    prUrl: prUrl || (parsedContract.contract.mode === 'planning_no_pr' ? 'none' : '(not provided)'),
    mode: parsedContract.contract.mode,
  })

  return {
    ok: true,
    exitCode: 0,
    usageError: false,
    output: [
      'Bemoat correction-mode preflight',
      `Issue: ${issueRef}`,
      ...capsule.lines,
      parsedContract.contract.mode === 'planning_no_pr'
        ? `Edit authorization: granted for the immutable finding set only across canonical planning artifacts (${derivePlanningArtifactAllowlist(parsedContract.contract).join('; ') || 'expected_areas required'}).`
        : 'Edit authorization: granted for the immutable finding set only.',
    ],
    issueNumber,
    branchName,
    statusShort,
    issueMetadata,
    correctionContract: parsedContract.contract,
  }
}
