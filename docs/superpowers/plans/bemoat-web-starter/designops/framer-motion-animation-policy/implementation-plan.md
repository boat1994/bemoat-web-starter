# Framer Motion Animation Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add starter-owned agent instructions that make Framer Motion the default for non-trivial UI animation choreography while preserving CSS for simple micro-transitions.

**Architecture:** `AGENTS.md` becomes the canonical policy surface for native agents. `.agents/skills/ui-animation.md` becomes the portable fallback for agents without native `ui-animation`, and the existing `.agents` registry, development loop, and regression checklist point to it without duplicating the whole policy everywhere.

**Tech Stack:** Markdown agent instructions, Bemoat starter sync rails, GitHub issue workflow, `pnpm run guard:safety`.

---

## Required Inputs

- Spec: `docs/superpowers/specs/bemoat-web-starter/designops/framer-motion-animation-policy/product-spec.md`
- Source issue: `https://github.com/boat1994/bemoat-web-starter/issues/68`
- Canonical agent rules: `AGENTS.md`
- Portable fallback entrypoint: `.agents/README.md`
- Existing fallback skills:
  - `.agents/skills/development-agent.md`
  - `.agents/skills/regression.md`

## File Structure

- Modify: `AGENTS.md`
  - Add the canonical `UI Animation Development Policy` section for all agents that read root instructions.
- Modify: `.agents/README.md`
  - Register the new portable fallback skill so non-native agents can discover it.
- Create: `.agents/skills/ui-animation.md`
  - Provide the portable fallback policy and QA checklist for environments without native `ui-animation`.
- Modify: `.agents/skills/development-agent.md`
  - Add a short trigger rule that sends non-trivial animation work to `.agents/skills/ui-animation.md`.
- Modify: `.agents/skills/regression.md`
  - Add motion-specific verification checks so completion reports include slow-motion QA, reduced-motion behavior, and remaining motion risks.

## Harness Sync Impact

`AGENTS.md` and `.agents` are rails-managed starter paths documented in `docs/agent-loop/source-of-truth.md`. No sync script or manifest change is required because these paths are already synced as managed rails. The implementation PR should explicitly say child projects receive the policy after the starter PR is merged and child projects run `pnpm run boilerplate:sync`.

## Out of Scope

- Do not change app runtime code.
- Do not add or remove dependencies.
- Do not change Payload schema, generated types, migrations, or import maps.
- Do not edit Cloudflare config, secrets, D1 IDs, R2 bucket names, Worker names, or `.env` files.
- Do not rewrite existing animation systems outside this policy documentation task.

### Task 1: Add Canonical Root Agent Policy

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Verify the root policy is not already present**

Run:

```bash
rg -n "UI Animation Development Policy|For UI animation tasks, run the ui-animation skill" AGENTS.md
```

Expected: command exits `1` with no matches before implementation.

- [ ] **Step 2: Insert the canonical policy in `AGENTS.md`**

Add this section immediately after the existing `## GitHub workflow` section and before `## Issue-driven branch workflow`:

```markdown
## UI Animation Development Policy

For UI animation tasks, run the `ui-animation` skill before implementation and prefer Framer Motion for choreography unless the motion is a simple CSS-only micro transition.

Use Framer Motion by default when animation involves:

- multi-step UI animation
- component state transitions
- drawer, accordion, or expand-collapse choreography
- layout morphing
- enter or exit sequences
- same-object continuity
- timing, delay, sequencing, or visual perception
- slow-motion QA

CSS transitions are still allowed for:

- simple hover states
- color changes
- tiny opacity transitions
- static decorative micro-interactions
- non-sequenced one-property transitions

Trigger `ui-animation` before implementation when the task includes:

- drawer
- collapse or expand
- morph
- handoff
- travel
- transition
- choreography
- motion polish
- visual QA
- Framer Motion
- perceived continuity
- blink, pop, snap, or jank

Animation development rules:

1. Do not rely on passing unit tests as proof that motion is visually correct.
2. Add or use a slow-motion QA mode when motion perception is unclear.
3. Separate choreography into explicit phases before coding.
4. Preserve visual anchors such as header top, card top, and object identity.
5. Prefer local Framer Motion choreography over broad workflow or lifecycle changes.
6. Keep CSS responsible for base layout and static styling.
7. Use Framer Motion for sequencing, height reveal, enter/exit, and state choreography.
8. Respect `prefers-reduced-motion`.
9. Do not break existing state contracts or lifecycle timing unless the issue explicitly requires it.
10. Report the visual QA path, changed animation selectors/components, and remaining motion risks.

For drawer or expand-collapse animation, preserve a stable header or anchor, collapse previous compact content when needed, reveal container height downward, reveal inner content after container motion starts, and preserve same-object continuity. Avoid opacity-only replacement for structural changes, simultaneous hidden-to-open state jumps, and mount/unmount boundaries that create blink, pop, snap, or identity loss.
```

- [ ] **Step 3: Verify the root policy text is discoverable**

Run:

```bash
rg -n "UI Animation Development Policy|prefer Framer Motion for choreography|blink, pop, snap, or jank" AGENTS.md
```

Expected: output includes the new section heading and policy phrases from `AGENTS.md`.

### Task 2: Add Portable `ui-animation` Fallback Skill

**Files:**
- Create: `.agents/skills/ui-animation.md`

- [ ] **Step 1: Verify the fallback skill does not already exist**

Run:

```bash
test ! -e .agents/skills/ui-animation.md
```

Expected: command exits `0` before implementation.

- [ ] **Step 2: Create `.agents/skills/ui-animation.md`**

Create the file with this exact content:

```markdown
# UI Animation Skill

Use this when a UI task involves choreography, state transitions, layout perception, object continuity, or motion QA and native `ui-animation` skill loading is unavailable.

## Trigger When

Read this skill before implementation when the task includes:

- drawer
- collapse or expand
- morph
- handoff
- travel
- transition
- choreography
- motion polish
- visual QA
- Framer Motion
- perceived continuity
- blink, pop, snap, or jank

## Default Rule

Prefer Framer Motion for choreography unless the motion is a simple CSS-only micro transition.

Use Framer Motion by default for:

- multi-step UI animation
- component state transitions
- drawer, accordion, or expand-collapse choreography
- layout morphing
- enter or exit sequences
- same-object continuity
- animations where timing, delay, sequencing, or visual perception matters
- motion that needs slow-motion QA

CSS transitions are still allowed for:

- simple hover states
- color changes
- tiny opacity transitions
- static decorative micro-interactions
- non-sequenced one-property transitions

## Implementation Rules

1. Do not rely on passing unit tests as proof that motion is visually correct.
2. Add or use a slow-motion QA mode when motion perception is unclear.
3. Separate choreography into explicit phases before coding.
4. Preserve visual anchors such as header top, card top, and object identity.
5. Prefer local Framer Motion choreography over broad workflow or lifecycle changes.
6. Keep CSS responsible for base layout and static styling.
7. Use Framer Motion for sequencing, height reveal, enter/exit, and state choreography.
8. Respect `prefers-reduced-motion`.
9. Do not break existing state contracts or lifecycle timing unless the issue explicitly requires it.
10. Report the visual QA path, changed animation selectors/components, and remaining motion risks.

## Drawer / Expand-Collapse Model

For drawer or expand-collapse animation:

1. Keep the header or primary anchor stable.
2. Collapse previous compact content when needed.
3. Reveal container height downward.
4. Reveal inner content after container motion starts.
5. Preserve same-object continuity across states.

Avoid:

- opacity-only replacement for structural changes
- simultaneous hidden-to-open state jumps
- mount/unmount boundaries that create blink, pop, snap, or identity loss

## QA Expectations

Before reporting completion:

- Run the normal project validation tier.
- Inspect motion in normal speed.
- Inspect motion in slow-motion mode when timing or continuity is unclear.
- Confirm reduced-motion behavior.
- Report changed animation selectors or components.
- Report remaining motion risks, especially any perceived blink, pop, snap, jank, or identity loss.
```

- [ ] **Step 3: Verify the fallback skill contains the required policy**

Run:

```bash
rg -n "Prefer Framer Motion|slow-motion QA|Drawer / Expand-Collapse Model|prefers-reduced-motion" .agents/skills/ui-animation.md
```

Expected: output includes each required phrase from `.agents/skills/ui-animation.md`.

### Task 3: Register the Portable Skill

**Files:**
- Modify: `.agents/README.md`

- [ ] **Step 1: Verify the registry does not already list `ui-animation`**

Run:

```bash
rg -n "ui-animation.md" .agents/README.md
```

Expected: command exits `1` with no matches before implementation.

- [ ] **Step 2: Add the registry row**

In `.agents/README.md`, add this row inside the `## Project Skill Registry` table after `development-agent.md`:

```markdown
| [`ui-animation.md`](./skills/ui-animation.md) | UI animation choreography, Framer Motion defaults, expand/collapse motion, perceived continuity, or visual motion QA when native `ui-animation` is unavailable. |
```

- [ ] **Step 3: Verify the registry links to the fallback skill**

Run:

```bash
rg -n "ui-animation.md|Framer Motion defaults" .agents/README.md
```

Expected: output includes the new registry row.

### Task 4: Wire the Development Fallback Loop

**Files:**
- Modify: `.agents/skills/development-agent.md`

- [ ] **Step 1: Verify development fallback has no animation trigger**

Run:

```bash
rg -n "UI Animation|ui-animation|Framer Motion|motion polish" .agents/skills/development-agent.md
```

Expected: command exits `1` with no matches before implementation.

- [ ] **Step 2: Add the animation trigger section**

In `.agents/skills/development-agent.md`, add this section after `## Required Loop` and before `## Validation Defaults`:

```markdown
## UI Animation Tasks

Before implementing non-trivial UI animation, read `.agents/skills/ui-animation.md` when native `ui-animation` skill loading is unavailable.

Trigger it when the task includes drawer, collapse, expand, morph, handoff, travel, transition, choreography, motion polish, visual QA, Framer Motion, perceived continuity, blink, pop, snap, or jank.

Keep CSS responsible for base layout, static styling, and simple one-property micro-transitions. Prefer Framer Motion for sequencing, height reveal, enter/exit, layout perception, same-object continuity, and state choreography.
```

- [ ] **Step 3: Verify development fallback routes animation work**

Run:

```bash
rg -n "UI Animation Tasks|\\.agents/skills/ui-animation.md|Prefer Framer Motion" .agents/skills/development-agent.md
```

Expected: output includes the new section and the fallback skill path.

### Task 5: Add Motion QA to Regression Fallback

**Files:**
- Modify: `.agents/skills/regression.md`

- [ ] **Step 1: Verify regression fallback has no motion QA checklist**

Run:

```bash
rg -n "slow-motion|reduced motion|motion risks|animation selectors" .agents/skills/regression.md
```

Expected: command exits `1` with no matches before implementation.

- [ ] **Step 2: Extend the regression checklist**

In `.agents/skills/regression.md`, add this item to the `## Checklist` list after `Agent rules, fallback skills, or editor behavior.`:

```markdown
- UI animation, Framer Motion choreography, slow-motion QA, reduced-motion behavior, or perceived continuity.
```

- [ ] **Step 3: Add motion-specific report requirements**

In `.agents/skills/regression.md`, add this section after `## Validation Selection` and before `## Report Format`:

```markdown
## Motion QA Reporting

For non-trivial UI animation work, report:

- Normal-speed visual QA result.
- Slow-motion QA result when timing or continuity is unclear.
- Reduced-motion behavior.
- Changed animation selectors or components.
- Remaining motion risks, especially blink, pop, snap, jank, or same-object identity loss.
```

- [ ] **Step 4: Verify regression fallback includes motion QA**

Run:

```bash
rg -n "Motion QA Reporting|Slow-motion QA result|Changed animation selectors|same-object identity loss" .agents/skills/regression.md
```

Expected: output includes the new motion QA section.

### Task 6: Validate, Review Diff, Commit, Push, and Update PR

**Files:**
- Verify: `AGENTS.md`
- Verify: `.agents/README.md`
- Verify: `.agents/skills/development-agent.md`
- Verify: `.agents/skills/regression.md`
- Verify: `.agents/skills/ui-animation.md`
- Verify: `docs/superpowers/specs/bemoat-web-starter/designops/framer-motion-animation-policy/product-spec.md`

- [ ] **Step 1: Run the docs-only safety guard**

Run:

```bash
pnpm run guard:safety
```

Expected:

```text
Central guard pack passed.
```

- [ ] **Step 2: Check starter-source boilerplate drift behavior**

Run:

```bash
pnpm run bemoat:boilerplate:check
```

Expected:

```text
Skipping boilerplate drift check in bemoat-web-starter (source repository).
This command compares child projects against upstream boilerplate.
In the starter repo, use git diff and CI instead of boilerplate:check.
```

If the command also prints an unsupported Node engine warning, keep it in the PR validation notes because it reflects the local runtime, not a policy-doc failure.

- [ ] **Step 3: Review changed files**

Run:

```bash
git status --short --branch
git diff --stat
git diff -- AGENTS.md .agents/README.md .agents/skills/development-agent.md .agents/skills/regression.md .agents/skills/ui-animation.md
```

Expected:

```text
AGENTS.md
.agents/README.md
.agents/skills/development-agent.md
.agents/skills/regression.md
.agents/skills/ui-animation.md
```

No app code, Payload schema, migrations, Cloudflare config, secrets, resource IDs, or unrelated files should appear.

- [ ] **Step 4: Commit the implementation**

Run:

```bash
git add AGENTS.md .agents/README.md .agents/skills/development-agent.md .agents/skills/regression.md .agents/skills/ui-animation.md
git commit -m "docs: add UI animation agent policy"
```

Expected: one focused commit with only the five agent-instruction files.

- [ ] **Step 5: Push the branch**

Run:

```bash
git push
```

Expected: branch `docs/68-framer-motion-animation-policy` updates the existing PR.

- [ ] **Step 6: Update PR 73**

Create the PR body file:

```bash
cat > /tmp/pr-73-animation-policy-body.md <<'EOF'
## Summary
- Adds a Superpowers spec and implementation plan for issue 68.
- Adds root agent policy that defaults non-trivial UI animation choreography to Framer Motion.
- Adds portable `.agents` fallback guidance for `ui-animation` trigger conditions, drawer/expand-collapse motion, slow-motion QA, reduced-motion behavior, and remaining motion risks.

## Files changed
- `docs/superpowers/specs/bemoat-web-starter/designops/framer-motion-animation-policy/product-spec.md`
- `docs/superpowers/plans/bemoat-web-starter/designops/framer-motion-animation-policy/implementation-plan.md`
- `AGENTS.md`
- `.agents/README.md`
- `.agents/skills/development-agent.md`
- `.agents/skills/regression.md`
- `.agents/skills/ui-animation.md`

## Validation
- `pnpm run guard:safety`: passed
- `pnpm run bemoat:boilerplate:check`: skipped by script because this is the starter source repository

## Risks
- Child projects will not receive the updated policy until this starter PR merges and child projects run or track `pnpm run boilerplate:sync`.
- Branch workflow docs prefer `develop` as PR base, but this repository currently exposes `main` as its default branch and has no remote `develop` branch.

## Human review needed
- Confirm the Framer Motion default and CSS micro-transition boundary.
- Confirm the portable `.agents/skills/ui-animation.md` fallback is useful without overloading native skill behavior.

Closes #68
EOF
```

Update the PR:

```bash
gh pr edit 73 --repo boat1994/bemoat-web-starter --body-file /tmp/pr-73-animation-policy-body.md
```

Expected: `gh` prints `https://github.com/boat1994/bemoat-web-starter/pull/73`.

- [ ] **Step 7: Comment on issue 68**

Create the issue comment body file:

```bash
cat > /tmp/issue-68-animation-policy-report.md <<'EOF'
## Implementation PR updated

PR: https://github.com/boat1994/bemoat-web-starter/pull/73
Branch: `docs/68-framer-motion-animation-policy`

### Summary
- Added the Superpowers implementation plan for the Framer Motion UI animation policy.
- Implemented root and portable fallback agent instructions so non-trivial UI animation triggers `ui-animation` and defaults choreography to Framer Motion.
- Documented slow-motion QA, reduced-motion behavior, drawer/expand-collapse expectations, and child sync impact.

### Files changed
- `docs/superpowers/specs/bemoat-web-starter/designops/framer-motion-animation-policy/product-spec.md`
- `docs/superpowers/plans/bemoat-web-starter/designops/framer-motion-animation-policy/implementation-plan.md`
- `AGENTS.md`
- `.agents/README.md`
- `.agents/skills/development-agent.md`
- `.agents/skills/regression.md`
- `.agents/skills/ui-animation.md`

### Commands run
- `pnpm run guard:safety`
- `pnpm run bemoat:boilerplate:check`
- `git status --short --branch`
- `git diff --stat`
- `git commit -m "docs: add UI animation agent policy"`
- `git push`

### Test results
- `pnpm run guard:safety`: passed.
- `pnpm run bemoat:boilerplate:check`: skipped by script because this is the starter source repository.

### Remaining risks
- Child projects need a follow-up sync after this starter PR merges.
- Motion policy is documentation and agent guidance; existing app animation systems are unchanged.

### Human review needed
- Confirm policy wording and portable fallback scope.
- Confirm child sync follow-up after merge.

### Next suggested step
Review PR, wait for CI, then merge if green.

Closes when PR is merged.
EOF
```

Post the issue comment:

```bash
gh issue comment 68 --repo boat1994/bemoat-web-starter --body-file /tmp/issue-68-animation-policy-report.md
```

Expected: `gh` prints the new issue comment URL.

- [ ] **Step 8: Check CI status**

Run:

```bash
gh pr checks 73 --repo boat1994/bemoat-web-starter
```

Expected: report each check as `pass` or `pending`. If any check fails, inspect logs before proposing fixes.

## Reference PR Body

```markdown
## Summary
- Adds a Superpowers spec and implementation plan for issue 68.
- Adds root agent policy that defaults non-trivial UI animation choreography to Framer Motion.
- Adds portable `.agents` fallback guidance for `ui-animation` trigger conditions, drawer/expand-collapse motion, slow-motion QA, reduced-motion behavior, and remaining motion risks.

## Files changed
- `docs/superpowers/specs/bemoat-web-starter/designops/framer-motion-animation-policy/product-spec.md`
- `docs/superpowers/plans/bemoat-web-starter/designops/framer-motion-animation-policy/implementation-plan.md`
- `AGENTS.md`
- `.agents/README.md`
- `.agents/skills/development-agent.md`
- `.agents/skills/regression.md`
- `.agents/skills/ui-animation.md`

## Validation
- `pnpm run guard:safety`: passed
- `pnpm run bemoat:boilerplate:check`: skipped by script because this is the starter source repository

## Risks
- Child projects will not receive the updated policy until this starter PR merges and child projects run or track `pnpm run boilerplate:sync`.
- Branch workflow docs prefer `develop` as PR base, but this repository currently exposes `main` as its default branch and has no remote `develop` branch.

## Human review needed
- Confirm the Framer Motion default and CSS micro-transition boundary.
- Confirm the portable `.agents/skills/ui-animation.md` fallback is useful without overloading native skill behavior.

Closes #68
```

## Reference Issue Comment

```markdown
## Implementation PR updated

PR: https://github.com/boat1994/bemoat-web-starter/pull/73
Branch: `docs/68-framer-motion-animation-policy`

### Summary
- Added the Superpowers implementation plan for the Framer Motion UI animation policy.
- Implemented root and portable fallback agent instructions so non-trivial UI animation triggers `ui-animation` and defaults choreography to Framer Motion.
- Documented slow-motion QA, reduced-motion behavior, drawer/expand-collapse expectations, and child sync impact.

### Files changed
- `docs/superpowers/specs/bemoat-web-starter/designops/framer-motion-animation-policy/product-spec.md`
- `docs/superpowers/plans/bemoat-web-starter/designops/framer-motion-animation-policy/implementation-plan.md`
- `AGENTS.md`
- `.agents/README.md`
- `.agents/skills/development-agent.md`
- `.agents/skills/regression.md`
- `.agents/skills/ui-animation.md`

### Commands run
- `pnpm run guard:safety`
- `pnpm run bemoat:boilerplate:check`
- `git status --short --branch`
- `git diff --stat`
- `git commit -m "docs: add UI animation agent policy"`
- `git push`

### Test results
- `pnpm run guard:safety`: passed.
- `pnpm run bemoat:boilerplate:check`: skipped by script because this is the starter source repository.

### Remaining risks
- Child projects need a follow-up sync after this starter PR merges.
- Motion policy is documentation and agent guidance; existing app animation systems are unchanged.

### Human review needed
- Confirm policy wording and portable fallback scope.
- Confirm child sync follow-up after merge.

### Next suggested step
Review PR, wait for CI, then merge if green.

Closes when PR is merged.
```

## Self-Review Checklist

- Spec coverage: Tasks 1 through 5 cover `AGENTS.md`, `.agents/*`, Framer Motion default criteria, CSS exceptions, `ui-animation` triggers, slow-motion QA, reduced-motion behavior, and child sync impact.
- Placeholder scan: The plan contains no unfinished placeholder markers or unspecified implementation steps.
- Scope check: The plan is one docs and agent-policy subsystem; it does not include app code, schema, Cloudflare, migration, dependency, or existing animation rewrites.
- Delivery check: Task 6 carries the issue branch through validation, commit, push, PR update, issue comment, and CI status reporting.
