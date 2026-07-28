import { readFileSync } from 'node:fs'
import { analyzeReconciliation, findLatestRoleComment } from '../mission-control-reconcile.mjs'
import {
  formatPlanningContractViolations,
  parseTaskIdentityBlock,
  runPlanningContractGuard,
  verifyLiveTaskIdentity,
} from '../guard-planning-contract.mjs'
import { parseMissionControlState } from '../mission-control-state.mjs'
import { analyzeExactHeadCi } from './exact-head-ci.mjs'
import {
  deriveWorkflowProfile,
  parseDurableProgress,
  parseIssueDeclarations,
  stateRequiresPrEvidence,
  validatePlanPath,
} from './issue-declarations.mjs'
import { parseIssueReference, parsePrReference } from './issue-references.mjs'
import { getDefaultRepo } from './local-git-evidence.mjs'
import { fetchIssueByReference, fetchIssueComments, fetchPrByReference } from './github-evidence.mjs'
import { stripFencedCodeBlocks } from './pure-helpers.mjs'

export function normalizeSliceName(slice) {
  if (!slice) return ''
  return slice.split('—')[0].trim().toLowerCase()
}

export function checkPrerequisiteMilestone(mainProgress, declarations) {
  const incomplete = mainProgress.firstIncomplete
  if (!incomplete?.slice) return null

  const taskSlice = declarations.currentStage.current_slice
  if (!taskSlice) return null

  if (normalizeSliceName(taskSlice) !== normalizeSliceName(incomplete.slice)) {
    return `Main Issue prerequisite milestone remains incomplete in ${incomplete.slice}: ${incomplete.label}`
  }

  return null
}

export function detectBlockingFindings(currentStage = {}) {
  const findings = []
  const value = currentStage.blocking_findings?.trim() ?? ''
  if (value && !/^(none|n\/a|-)$/i.test(value)) {
    findings.push(value)
  }

  return findings
}

export function detectFounderGate(currentStage = {}, milestones = []) {
  const firstIncomplete = milestones.find((item) => !item.complete)
  const currentTask = currentStage.current_task_or_gate?.trim() ?? ''
  const founderGateOpen = Boolean(
    /founder/i.test(currentTask) || (firstIncomplete && /founder/i.test(firstIncomplete.label)),
  )
  const founderValue = currentStage.founder_gate?.trim() ?? ''
  const explicitOpen =
    founderValue.length > 0 && !/^(none|passed|approved|n\/a|-)$/i.test(founderValue)

  return {
    open: founderGateOpen || explicitOpen,
    value: founderValue || null,
  }
}

export function analyzeProgressTracking({
  cwd = process.cwd(),
  activeIssueBody = '',
  activeIssueNumber = null,
  activeIssueState = null,
  env = process.env,
} = {}) {
  const blockers = []
  const warnings = []
  const declarations = parseIssueDeclarations(activeIssueBody)
  const report = {
    declarations,
    workflowProfile: deriveWorkflowProfile(declarations),
    durableProgress: declarations.declaresMainIssue
      ? { hasChecklist: false, milestones: [], firstIncomplete: null, malformed: false }
      : parseDurableProgress(activeIssueBody),
    mainIssue: null,
    plan: null,
    pr: null,
    exactHeadCi: null,
    firstIncompleteMilestone: null,
    nextPermittedAction: null,
    currentStageSummary: null,
    relevantPlanSection: null,
    reconciliation: null,
  }

  const durableProgress = report.durableProgress
  const taskSize = declarations.taskSize
  const isSmallTask = taskSize === 'small'
  const activeIssueSource = stripFencedCodeBlocks(activeIssueBody)
  const stateAnalysis = parseMissionControlState(activeIssueBody)
  const stateRequired =
    declarations.missionControlMode === 'required' ||
    (taskSize === 'core' && declarations.declaresMainIssue && declarations.declaresImplementationPlan)
  const state = stateAnalysis.state
  let resolvedActiveIssueState = activeIssueState
  const stateNeedsPrEvidence = stateAnalysis.valid && stateRequiresPrEvidence(state.state)

  report.missionControlState = stateAnalysis
  if (!stateAnalysis.present) {
    if (stateRequired) {
      blockers.push('STATE_MIGRATION_REQUIRED: managed Mission Control state is required but absent.')
    } else {
      warnings.push('Mission Control state is absent — normal for standalone tasks not opted into managed state.')
    }
  } else if (!stateAnalysis.valid) {
    blockers.push(`STATE_MIGRATION_REQUIRED: ${stateAnalysis.reason}.`)
  } else if (activeIssueNumber) {
    const defaultRepo = getDefaultRepo(cwd)
    const stateTaskIssue = parseIssueReference(String(state.active_task_issue ?? ''), defaultRepo)
    if (
      !stateTaskIssue ||
      stateTaskIssue.number !== String(activeIssueNumber) ||
      (stateTaskIssue.repo && defaultRepo && stateTaskIssue.repo !== defaultRepo)
    ) {
      blockers.push('STATE_CONFLICT: state active_task_issue does not match the live task Issue.')
    }
  }
  const repairableRecordedLegacyState =
    stateAnalysis.valid &&
    state.state === 'STATE_CONFLICT' &&
    ['post_budget_review_history', 'founder_authorization', 'founder_correction_authorization']
      .some((key) => Object.hasOwn(state, key))
  if (stateAnalysis.valid && ['STATE_CONFLICT', 'STATE_MIGRATION_REQUIRED', 'BLOCKED_EXTERNAL'].includes(state.state) && !repairableRecordedLegacyState) {
    blockers.push(`${state.state}: recorded Mission Control state requires reconciliation before continuing.`)
  }

  if (declarations.declaresMainIssue) {
    const mainIssueResult = fetchIssueByReference(cwd, declarations.mainIssueRef, env)
    if (!mainIssueResult.ok) {
      blockers.push(`Declared Main Issue could not be found: ${declarations.mainIssueRef}`)
    } else {
      report.mainIssue = mainIssueResult.issue
      const mainProgress = parseDurableProgress(mainIssueResult.issue.body ?? '')
      const mainDeclarations = parseIssueDeclarations(mainIssueResult.issue.body ?? '')
      report.durableProgress = mainProgress
      report.firstIncompleteMilestone = mainProgress.firstIncomplete
      if (mainProgress.malformed) {
        blockers.push('Declared Main Issue progress checklist is malformed or unreadable.')
      }
      if (!mainProgress.hasChecklist) {
        warnings.push('Declared Main Issue has no supported Durable Progress checklist yet.')
      }

      const prerequisiteBlocker = checkPrerequisiteMilestone(mainProgress, declarations)
      if (prerequisiteBlocker) {
        blockers.push(prerequisiteBlocker)
      }

      const mainBlockingFindings = detectBlockingFindings(mainDeclarations.currentStage)
      if (mainBlockingFindings.length > 0) {
        blockers.push(
          `Unresolved Critical or Important findings on Main Issue block dependent work: ${mainBlockingFindings.join('; ')}`,
        )
      }
    }
  } else if (
    !isSmallTask &&
    taskSize === 'core' &&
    /##\s*Current\s+Stage/i.test(activeIssueSource)
  ) {
    warnings.push('Core task has a Current Stage section but no Main Issue is declared.')
  } else if (!declarations.declaresMainIssue) {
    warnings.push('No Main Issue declared — expected for valid Small or standalone tasks.')
  }

  if (declarations.declaresImplementationPlan) {
    const relevantSection =
      declarations.relevantPlanSection ||
      declarations.currentStage.relevant_plan_section ||
      null
    const planValidation = validatePlanPath(cwd, declarations.implementationPlanPath, relevantSection)
    report.plan = planValidation
    report.relevantPlanSection = relevantSection
    if (!planValidation.ok) {
      blockers.push(planValidation.reason)
    } else {
      const planContent = readFileSync(planValidation.absolutePath, 'utf8')
      const parseResult = parseTaskIdentityBlock(planContent, declarations.implementationPlanPath)
      const guardViolations = runPlanningContractGuard({
        root: cwd,
        files: [declarations.implementationPlanPath],
      })

      for (const line of formatPlanningContractViolations(guardViolations)) {
        if (line !== 'Planning contract guard passed.') {
          blockers.push(line)
        }
      }

      if (parseResult.contract) {
        if (
          parseResult.contract.task_issue_strategy === 'create_before_execution' &&
          !parseResult.contract.active_task_issue
        ) {
          blockers.push(
            'PLAN005: Create dedicated task issue before launching implementation. Create the GitHub issue, set active_task_issue to its reference, and switch task_issue_strategy to existing_dedicated_issue before continuing.',
          )
        }

        if (
          parseResult.contract.task_issue_strategy === 'existing_dedicated_issue' &&
          parseResult.contract.active_task_issue
        ) {
          const liveResult = verifyLiveTaskIdentity({
            cwd,
            filePath: declarations.implementationPlanPath,
            contract: parseResult.contract,
            env,
            offline: false,
          })

          if (liveResult.degradedOffline) {
            blockers.push(
              'Live task identity verification unavailable — authenticate GitHub CLI before launching implementation on an existing dedicated task issue. Run `gh auth login` and retry preflight.',
            )
          } else {
            for (const line of formatPlanningContractViolations(liveResult.violations)) {
              if (line !== 'Planning contract guard passed.') {
                blockers.push(line)
              }
            }
          }
        }
      }
    }
  } else if (!isSmallTask && taskSize === 'core') {
    warnings.push('Core task has no declared Implementation Plan path.')
  } else if (!declarations.declaresImplementationPlan) {
    warnings.push('No Implementation Plan declared — expected for valid Small or Medium tasks.')
  }

  const declaredActivePrRef = declarations.activePrRef || declarations.currentStage.active_pr || null
  const stateActivePrRef =
    state?.active_pr === null || state?.active_pr === undefined ? null : String(state.active_pr)
  let activePrRef = declaredActivePrRef || stateActivePrRef

  const preDeliveryLag =
    stateAnalysis.valid &&
    state &&
    ['READY', 'IN_PROGRESS'].includes(state.state) &&
    (!state.active_pr || !state.current_head || state.state !== 'AWAITING_REVIEW_1')
  const postReviewLag =
    stateAnalysis.valid && state && /^(AWAITING_REVIEW_|CORRECTION_REQUIRED_)/.test(state.state)

  let latestResult = null
  let latestVerdict = null
  if (stateRequired && activeIssueNumber && (preDeliveryLag || postReviewLag)) {
    const commentResult = fetchIssueComments(cwd, activeIssueNumber, env)
    if (commentResult.ok) {
      latestResult = findLatestRoleComment(commentResult.comments, 'RESULT')
      latestVerdict = findLatestRoleComment(commentResult.comments, 'REVIEW_VERDICT')
      if (latestResult && state?.updated_at) {
        const commentTime = Date.parse(latestResult.comment.createdAt ?? '')
        const stateTime = Date.parse(state.updated_at ?? '')
        if (!Number.isNaN(commentTime) && !Number.isNaN(stateTime) && commentTime < stateTime) {
          latestResult = null
        }
      }
      if (latestVerdict && state?.updated_at) {
        const commentTime = Date.parse(latestVerdict.comment.createdAt ?? '')
        const stateTime = Date.parse(state.updated_at ?? '')
        if (!Number.isNaN(commentTime) && !Number.isNaN(stateTime) && commentTime < stateTime) {
          latestVerdict = null
        }
      }
      if (!activePrRef && latestResult?.parsed?.prNumber) {
        activePrRef = `#${latestResult.parsed.prNumber}`
      }
    }
  }

  if (stateAnalysis.valid && declaredActivePrRef && stateActivePrRef) {
    const declaredPr = parsePrReference(declaredActivePrRef)
    const recordedPr = parsePrReference(stateActivePrRef)
    if (
      !declaredPr ||
      !recordedPr ||
      declaredPr.number !== recordedPr.number ||
      (declaredPr.repo && recordedPr.repo && declaredPr.repo !== recordedPr.repo)
    ) {
      blockers.push('STATE_CONFLICT: state active_pr does not match the declared Active PR.')
    }
  }
  if (stateNeedsPrEvidence && (!state.active_pr || !state.current_head)) {
    blockers.push('STATE_MIGRATION_REQUIRED: review or eligibility state requires active_pr and current_head.')
  }
  if (activePrRef) {
    const prResult = fetchPrByReference(cwd, activePrRef, env)
    if (!prResult.ok) {
      if (stateRequired || stateNeedsPrEvidence) {
        blockers.push(`BLOCKED_EXTERNAL: required Active PR evidence is unavailable: ${activePrRef}`)
      } else {
        blockers.push(`Declared Active PR could not be identified: ${activePrRef}`)
      }
    } else {
      report.pr = prResult.pr
      report.exactHeadCi = analyzeExactHeadCi(prResult.pr)
      if (stateAnalysis.valid) {
        const expectedPr = parsePrReference(String(state.active_pr ?? ''))
        if (expectedPr?.number && expectedPr.number !== String(prResult.reference.number)) {
          blockers.push('STATE_CONFLICT: state active_pr does not match the live PR reference.')
        }
        if (state.approved_base !== prResult.pr.baseRefName) {
          blockers.push('STATE_CONFLICT: state approved_base does not match the live PR base.')
        }
        const terminalHeadIsPreserved =
          prResult.pr.state === 'MERGED' &&
          state.state === 'DONE' &&
          state.last_reviewed_head === prResult.pr.headRefOid
        if (state.current_head && state.current_head !== prResult.pr.headRefOid && !terminalHeadIsPreserved) {
          blockers.push('STATE_CONFLICT: state current_head does not match the live PR head.')
        }
        if (prResult.pr.state === 'MERGED' && !resolvedActiveIssueState && activeIssueNumber) {
          const liveIssue = fetchIssueByReference(cwd, `#${activeIssueNumber}`, env)
          if (liveIssue.ok) resolvedActiveIssueState = liveIssue.issue.state
        }
        const terminalRepairCandidate =
          prResult.pr.state === 'MERGED' &&
          String(resolvedActiveIssueState ?? '').toLowerCase() === 'closed' &&
          state.last_reviewed_head === prResult.pr.headRefOid
        if (prResult.pr.state === 'MERGED' && state.state !== 'DONE' && !terminalRepairCandidate) {
          blockers.push('STATE_CONFLICT: merged PR completion must reconcile to DONE.')
        }
        if (prResult.pr.state === 'CLOSED' && state.state !== 'DONE') {
          blockers.push('STATE_CONFLICT: closed PR conflicts with the recorded non-terminal state.')
        }
        if (state.state === 'DONE' && prResult.pr.state !== 'MERGED') {
          blockers.push('STATE_CONFLICT: DONE requires a merged active PR.')
        }
      }
      if (report.exactHeadCi.olderShaSuccess) {
        warnings.push(
          'Successful CI exists for an older SHA — exact-head CI is required for current evidence.',
        )
      }
      if (
        durableProgress.milestones.some((item) => /exact-head ci passed/i.test(item.label)) &&
        !durableProgress.milestones.find((item) => /exact-head ci passed/i.test(item.label))?.complete &&
        !report.exactHeadCi.exactHeadVerified
      ) {
        warnings.push('Exact-head CI gate is incomplete for the current PR head.')
      }
    }
  }
  if (stateNeedsPrEvidence && !activePrRef) {
    blockers.push('BLOCKED_EXTERNAL: required Active PR evidence is unavailable.')
  }

  const blockingFindings = detectBlockingFindings(declarations.currentStage)
  if (blockingFindings.length > 0) {
    blockers.push(
      `Unresolved Critical or Important findings block dependent work: ${blockingFindings.join('; ')}`,
    )
  }

  const founderGate = detectFounderGate(declarations.currentStage, durableProgress.milestones)
  if (founderGate.open) {
    blockers.push('Founder gate remains open — do not infer approval from technical readiness or green CI.')
  }

  report.nextPermittedAction =
    (stateAnalysis.valid && state?.next_permitted_action ? String(state.next_permitted_action) : null) ||
    declarations.nextPermittedAction ||
    (report.firstIncompleteMilestone
      ? `Complete durable milestone: ${report.firstIncompleteMilestone.label}`
      : null)

  report.currentStageSummary = {
    slice: declarations.currentStage.current_slice ?? null,
    taskOrGate: declarations.currentStage.current_task_or_gate ?? null,
    activeTaskIssue:
      declarations.activeTaskIssueRef || declarations.currentStage.active_task_issue || null,
    activePr: activePrRef,
    relevantPlanSection:
      declarations.relevantPlanSection || declarations.currentStage.relevant_plan_section || null,
    approvedBase: declarations.approvedBase || declarations.currentStage.approved_base || null,
    founderGate: founderGate.value,
  }

  report.reconciliation = null
  if (stateRequired && stateAnalysis.valid && state) {
    const livePr =
      report.pr && report.pr.headRefOid
        ? {
            number: report.pr.reference?.number ?? parsePrReference(activePrRef)?.number,
            headRefOid: report.pr.headRefOid,
            baseRefName: report.pr.baseRefName,
          }
        : null

    const reconciliation = analyzeReconciliation({
      managedState: state,
      livePr,
      exactHeadCi: report.exactHeadCi,
      latestResult,
      latestVerdict,
      activeTaskIssue: activeIssueNumber,
      stateConflictBlockers: blockers.filter((blocker) => blocker.includes('STATE_CONFLICT')),
      requiredEvidenceUnavailable: blockers.some((blocker) => blocker.includes('BLOCKED_EXTERNAL')),
      terminal: report.pr?.state === 'MERGED'
        ? {
            issueClosed: String(resolvedActiveIssueState ?? '').toLowerCase() === 'closed',
            prMerged: true,
            reviewedHeadMatches: state.last_reviewed_head === report.pr.headRefOid,
            mergeCommit: report.pr.mergeCommit?.oid ?? report.pr.mergeCommitOid ?? null,
            exactHeadCi: report.exactHeadCi?.exactHeadVerified === true,
            currentHeadMatches:
              state.current_head === report.pr.headRefOid ||
              (state.state === 'DONE' && state.current_head === (report.pr.mergeCommit?.oid ?? report.pr.mergeCommitOid ?? null)),
          }
        : null,
    })
    report.reconciliation = reconciliation

    if (reconciliation.delivery?.kind === 'STATE_CONFLICT') {
      blockers.push(`STATE_CONFLICT: ${reconciliation.delivery.reason}.`)
    } else if (reconciliation.review?.kind === 'STATE_CONFLICT') {
      blockers.push(`STATE_CONFLICT: ${reconciliation.review.reason}.`)
    } else if (reconciliation.proposal?.type === 'delivery' && preDeliveryLag) {
      warnings.push(
        `Deterministic delivery reconciliation available: set state to ${reconciliation.proposal.fields.state} with PR ${reconciliation.proposal.fields.active_pr}.`,
      )
    } else if (reconciliation.proposal?.type === 'review' && postReviewLag) {
      warnings.push(
        `Deterministic review reconciliation available: set state to ${reconciliation.proposal.fields.state}.`,
      )
    } else if (reconciliation.delivery?.kind === 'INCOMPLETE_DELIVERY' && preDeliveryLag) {
      warnings.push(`Incomplete delivery: ${reconciliation.delivery.reason}.`)
    }
  }

  return { blockers, warnings, report }
}
