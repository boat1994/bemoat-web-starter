export const GUIDE_PATH = 'docs/mission-control/mission-control-guide.md'
export const LOADER_PATH = 'prompts/mission-control/chatgpt-project-loader.md'
export const HANDOFF_PATH = 'docs/mission-control/handoff-template.md'
export const RESULT_PATH = 'docs/mission-control/result-template.md'
export const ROLE_HANDOFF_PATH = 'docs/agent-loop/role-handoff-contract.md'
export const README_PATH = 'docs/mission-control/README.md'
export const COMMAND_REFERENCE_PATH = 'docs/mission-control/command-reference.md'
export const OVERRIDE_EXAMPLE_PATH = 'docs/mission-control/project-overrides.example.md'
export const LIVE_OVERRIDE_PATH = '.bemoat/mission-control-overrides.md'
export const AGENTS_PATH = 'AGENTS.md'
export const MANIFEST_PATH = '.bemoat/boilerplate-sync-manifest.json'
export const SYNC_SCRIPT_PATH = 'scripts/sync-boilerplate.mjs'
export const BOILERPLATE_INVENTORY_PATH = 'scripts/boilerplate/inventory.mjs'
export const RECONCILE_SCRIPT_PATH = 'scripts/mission-control-reconcile.mjs'
export const RECONCILE_TEST_PATH = 'tests/int/mission-control-reconcile.int.spec.ts'
export const GUARD_SCRIPT_PATH = 'scripts/guard-mission-control-contract.mjs'
export const INT_TEST_PATH = 'tests/int/mission-control-contract.int.spec.ts'
export const FIXTURES_PATH = 'tests/fixtures/mission-control'

export const MODULE_PROCEDURES_PATH = 'docs/mission-control/modules/procedures.md'
export const MODULE_CHECKLISTS_PATH = 'docs/mission-control/modules/checklists.md'
export const MODULE_TEMPLATES_PATH = 'docs/mission-control/modules/templates-examples.md'
export const MODULE_TROUBLESHOOTING_PATH = 'docs/mission-control/modules/troubleshooting.md'
export const MODULE_MIGRATION_PATH = 'docs/mission-control/modules/migration-guidance.md'
export const MODULE_CHILD_SYNC_PATH = 'docs/mission-control/modules/child-sync-operations.md'

export const MC_MANAGED_MODULES = [
  MODULE_PROCEDURES_PATH,
  MODULE_CHECKLISTS_PATH,
  MODULE_TEMPLATES_PATH,
  MODULE_TROUBLESHOOTING_PATH,
  MODULE_MIGRATION_PATH,
  MODULE_CHILD_SYNC_PATH,
]

export const MC_MANAGED_PATHS = [
  README_PATH,
  COMMAND_REFERENCE_PATH,
  GUIDE_PATH,
  HANDOFF_PATH,
  RESULT_PATH,
  COMMAND_REFERENCE_PATH,
  OVERRIDE_EXAMPLE_PATH,
  LOADER_PATH,
  GUARD_SCRIPT_PATH,
  RECONCILE_SCRIPT_PATH,
  INT_TEST_PATH,
  RECONCILE_TEST_PATH,
  FIXTURES_PATH,
  MODULE_PROCEDURES_PATH,
  MODULE_CHECKLISTS_PATH,
  MODULE_TEMPLATES_PATH,
  MODULE_TROUBLESHOOTING_PATH,
  MODULE_MIGRATION_PATH,
  MODULE_CHILD_SYNC_PATH,
]

export const MODULE_SECTION_MAP = {
  [GUIDE_PATH]: [
    '## Purpose',
    '## Applicability and preflight outcomes',
    '## Workflow profiles',
    '## Operational-stage minimization and state necessity',
    '## Safe execution bundles',
    '## Allowed bundled flows',
    '## Prohibited cross-gate bundles',
    '## Reconciliation only on failure',
    '## Merge completion bundle',
    '## Roles and authority boundaries',
    '## Responsibility/source-of-truth model',
    '## Protocol compression',
    '## Brainstorming Response Profile',
    '## Integration boundaries',
    '## Durable Mission Control state schema',
    '## State machine and allowed transitions',
    '## Review-cycle budget',
    '## Cost-aware review routing',
    '## Full-review rules',
    '## Delta-review rules',
    '## Blocker-verification rules',
    '## Finding severity and evidence requirements',
    '## Material-change rules',
    '## Lean Founder Decision',
    '## Reopening rules',
    '## Handoff contract',
    '## RESULT contract',
    '## Follow-up issue policy',
    '## Scope-control rules',
    '## Stop conditions',
  ],
  [MODULE_PROCEDURES_PATH]: [
    '## Double-Loop Review Gate',
    '## Execution roles and atomic completions',
    '## Role-owned durable state updates',
    '## Deterministic reconciliation',
    '## Reconciliation only on failure',
    '## Bootstrap and state reconstruction',
  ],
  [MODULE_CHECKLISTS_PATH]: ['## Completion gate'],
  [MODULE_TEMPLATES_PATH]: ['## Compact transition examples', '## Worked examples'],
  [MODULE_TROUBLESHOOTING_PATH]: ['## Conflict behavior'],
  [MODULE_MIGRATION_PATH]: ['## Existing-task migration behavior'],
  [MODULE_CHILD_SYNC_PATH]: ['## Repository-specific override behavior'],
}

export const REQUIRED_HANDOFF_FIELDS = [
  'Repository:',
  'Approved base:',
  'Active Task Issue:',
  'Active PR:',
  'Current head SHA:',
  'Guide version/ref/SHA:',
  'Assigned role:',
  'Execution role:',
  'Review type:',
  'Review cycle:',
  'Model/reasoning guidance:',
  'Exact scope:',
  'Out of scope:',
  'Acceptance Criteria:',
  'Open findings:',
  'Required checks:',
  'Required manual QA:',
  'Stop condition:',
  'Expected RESULT format:',
]

export const REQUIRED_RESULT_FIELDS = [
  'Role:',
  'Action completed:',
  'Repository/branch:',
  'Previous head:',
  'Current exact head:',
  'Files changed or reviewed:',
  'Acceptance Criteria audit:',
  'Commands/checks and outcomes:',
  'Manual QA evidence:',
  'Findings and dispositions:',
  'Review cycle/verdict:',
  'Durable GitHub state updated:',
  'Blockers:',
  'Follow-up Issues created:',
  'Next permitted action:',
  'Stop confirmation:',
]

export const REQUIRED_VERDICTS = [
  'CORRECTION REQUIRED',
  'ELIGIBLE FOR FOUNDER REVIEW',
  'BLOCKED FOR FOUNDER DECISION',
  'BLOCKED EXTERNAL',
  'STATE CONFLICT',
]

export const DOUBLE_LOOP_FAILURE_CLASSES = [
  'IMPLEMENTATION',
  'SPECIFICATION',
  'VALIDATION',
  'DECOMPOSITION',
  'TOOL_OR_MODEL',
  'ENVIRONMENT',
  'UNKNOWN',
]

export const DOUBLE_LOOP_ALLOWED_DECISIONS = [
  'CONTINUE_IMPLEMENTATION',
  'REVISE_SPECIFICATION',
  'REVISE_VALIDATION',
  'SPLIT_OR_REDECOMPOSE_TASK',
  'CHANGE_TOOL_OR_MODEL',
  'REPAIR_ENVIRONMENT',
  'BLOCKED_EXTERNAL',
  'BLOCKED_FOR_FOUNDER_DECISION',
  'CREATE_FOLLOW_UP_ISSUE',
]

export const REQUIRED_DOUBLE_LOOP_TRANSPORT_FIELDS = [
  '**Loop gate:**',
  '**Failure class:**',
  '**Invalidated assumptions:**',
  '**Decision:**',
  '**Next experiment:**',
  '**Material difference:**',
  '**Allowed / prohibited:**',
  '**Verify / stop:**',
]

/** Stable capability/risk routing invariants; runtime model names stay replaceable. */
export const REQUIRED_COST_AWARE_GUIDE_PHRASES = [
  'A durable state transition does not itself require or authorize a separate model run.',
  'Keep a distinct durable state only when it changes execution authority or owner, next permitted action, required evidence, failure-handling path, or a Founder/human approval requirement.',
  'Mechanical verification uses deterministic scripts, or a low-reasoning coordinator when automation is unavailable; it is not a high-reasoning semantic review.',
  'A changed commit or head alone is not a trigger for another Full Semantic Review.',
  'Review routing depends on capability and proven risk; runtime model names remain replaceable configuration.',
  'Delta Review uses the lowest reasoning level that can reliably verify the bounded change.',
  'FAST defaults to focused verification without independent high-reasoning review.',
  'STANDARD defaults to one risk-adjusted semantic review: Medium for bounded normal-risk work and High only for material ambiguity or significant connected risk.',
  'MANAGED defaults to one independent High Full Semantic Review, followed by bounded Delta Review.',
  'A Full Semantic Review escalation requires at least one explicit proven trigger.',
]

/** Lean Founder Decision UX invariants for BLOCKED_FOR_FOUNDER_DECISION stops. */
export const REQUIRED_LEAN_FOUNDER_DECISION_PHRASES = [
  'Founder Decision stops stay lean by default',
  'the two available actions: **Approve** or **Decline**',
  'Do not include Suggested model, Ready-to-paste prompts',
  '`ELIGIBLE_FOR_FOUNDER_REVIEW` merge authorization stays on the existing',
  'BLOCKED_FOR_FOUNDER_DECISION -> IN_PROGRESS',
  'BLOCKED_FOR_FOUNDER_DECISION -> DONE',
]

/** Immutable correction finding / capsule invariants (Minimal Hybrid). */
export const REQUIRED_CORRECTION_GUIDE_PHRASES = [
  'Reviewers own immutable finding identity',
  'Correction agents may not rename, reinterpret, regroup, substitute, add, or omit findings',
  'Correction delivery does not resolve original PR review threads',
  'File names, test names, and green CI alone never prove semantic completion',
]

/** Brainstorming Response Profile invariants (#144). */
export const REQUIRED_BRAINSTORMING_GUIDE_PHRASES = [
  'formatting and routing guidance only',
  'not a durable Mission Control state, GitHub comment type, review counter, or authorization channel',
  'Use exactly one profile marker heading: `## BRAINSTORMING` or `## DESIGN RESULT`',
  'It **does not** authorize implementation, branch creation, commits, PR',
  'remain in brainstorming/design mode and ask exactly one clarification question',
  'brainstorming output must not mutate managed state',
  'normal Mission Control response contract resumes on the next agent invocation',
]

export const REQUIRED_CORRECTION_HANDOFF_PHRASES = [
  '### Immutable correction finding contract',
  '### Correction RESULT evidence map',
  'pnpm run bemoat:agent:issue -- <issue-number> --phase correction',
  'Playback verified:',
  '"status": "CLAIMED_RESOLVED"',
  '"status": "UNPROVEN"',
]

export const REQUIRED_LEAN_FOUNDER_LOADER_PHRASES = [
  'Lean Founder Decision when state is `BLOCKED_FOR_FOUNDER_DECISION`',
  'Actions: **Approve** | **Decline**',
  'Do not include Suggested model, Ready-to-paste',
  'After **Approve** only: durable GitHub authorization + compact HANDOFF',
  'After **Decline**: minimal stop/closure only',
  'Keep `ELIGIBLE_FOR_FOUNDER_REVIEW` on the default merge path',
  'Founder Decision stops stay lean',
]

export const REQUIRED_SAFE_BUNDLE_GUIDE_PHRASES = [
  'one bounded objective with one authority scope',
  'Successful bundles write their deterministic durable projection directly.',
  'After Founder merge approval, the merge completion bundle may verify',
  '### Generic Founder authorization record',
  'trusted Founder identity',
  'immutable decision comment/reference',
  'non-supersession verification',
  'exact scope/action',
  'Separate reconciliation is permitted only when a projection fails',
  'Hard gates remain unchanged',
  'No autonomous Review 4 or',
]

export const REQUIRED_SAFE_BUNDLE_LOADER_PHRASES = [
  'one bounded objective or explicitly authorized safe execution',
  'Compact bundle prompts must name',
  'exact Task Issue/PR',
  'authority comment and authenticated author',
  'exact scope and action',
  'exact policy/base/head',
  'merged-policy source commit SHA',
  'protected-base commit SHA',
  'exact-head CI evidence',
  'review verdict',
  'stop conditions for authority/head/CI/verdict/mergeability/CAS/lease drift',
  'prohibited actions',
  'Do not bundle across implementation, review,',
]

export const REQUIRED_CLI_PROMPT_GUIDE_PHRASES = [
  '### Ready-to-paste prompt public CLI routing',
  'pnpm run <command> -- --help --json',
  'accepted pre-state, required evidence, mutation',
  'retry contract, and next-action rules',
  'Direct internal workflow imports are prohibited',
  'Raw GitHub reads remain permitted',
  'Raw GitHub mutation is prohibited when a',
  'precise reason for every raw mutation exception',
  'CLI_DISCOVERY_DEFECT',
  'Purely conversational Founder decisions',
  'bemoat:mission-control:dispatch',
  'bemoat:agent:delivery',
  'bemoat:mission-control:review',
  'bemoat:mission-control:reconcile',
  'bemoat:mission-control:recover-review',
  'bemoat:mission-control:recover-state',
  'bemoat:mission-control:reopen',
  'bemoat:mission-control:adopt-finding',
  'bemoat:mission-control:merge',
  'bemoat:issue:comment',
]

export const REQUIRED_CLI_PROMPT_LOADER_PHRASES = [
  'public CLI routing section',
  'canonical command or bounded candidate set',
  'pnpm run <command> -- --help --json',
  'CLI_DISCOVERY_DEFECT',
  'inside the productive HANDOFF/correction prompt',
  'Purely conversational Founder decisions',
]

export const REQUIRED_SAFE_BUNDLE_PROCEDURE_PHRASES = [
  'verify exact Founder authorization/verdict/head/base/CI/mergeability',
  'merge the expected head',
  'project campaign slice DONE',
  'select, but do not start, the next campaign action',
  'not merge authority',
  'State Reconciler only after projection failure',
]

export const REQUIRED_SAFE_BUNDLE_TEMPLATE_PHRASES = [
  'Repository: owner/repository',
  'Task Issue: #N · PR: #N',
  'Authority: comment <immutable-comment-id> · author @founder · scope `merge` · action `merge` · bundle `merge-completion`',
  'merged-policy source `<exact-merged-policy-source-sha>`',
  'protected base `main@<exact-protected-base-sha>`',
  'full 40-hex',
  'Exact-head CI:',
  'Review verdict: `ELIGIBLE FOR FOUNDER REVIEW`',
  'Stop before mutation on:',
  'CAS, or lease drift',
  'Prohibited:',
  '`started: false`',
  'Reconcile separately only after projection failure',
]

export const REQUIRED_PLANNING_MIGRATION_PHRASES = [
  'RESULT comment `5156067541`',
  '`main@fbb587f883e10a4b7f2c21d2af80da84b2f95084`',
  '`planning_no_pr` mode',
  'counters `review_cycle: 0` and `full_review_count: 0`',
  'separate Founder implementation authorization',
]

export const LOADER_MAX_LINES = 80
export const LOADER_FORBIDDEN_TITLES = ['## Review-cycle budget', '## Finding severity']

/** Bare legacy Core verdict option list — must not appear as an allowed enum. */
export const LEGACY_BARE_CORE_VERDICT_RE = /\bPASS\s*\|\s*BLOCKED\b/
