# Product Spec

- Title: Default to Framer Motion for UI animation choreography
- Date: 2026-06-30
- Project: Bemoat Web Starter
- Initiative: Agent policy and UI execution rails
- Feature: Framer Motion animation policy
- Related Issue / PR: https://github.com/boat1994/bemoat-web-starter/issues/68
- Status: Ready for implementation

## Purpose

Capture a reusable agent policy for UI animation work so future Bemoat projects do not treat choreography, perceived continuity, or visual motion polish as CSS duration problems.

## Goal

Update starter-owned agent instructions so agents prefer Framer Motion for non-trivial UI animation choreography, trigger `ui-animation` before implementation, and report a visual QA path for motion work.

## Target User / Buyer

- Primary user: coding agents implementing or reviewing Bemoat UI animation work.
- Secondary user: humans reviewing animation PRs and deciding whether the visual QA path is sufficient.
- Downstream user: child Bemoat projects that receive starter agent rails through `pnpm run boilerplate:sync`.

## Problem

The HeroWorkflow drawer polish work in `bemoat` showed that CSS-only animation becomes hard to reason about when motion depends on choreography, state transitions, layout perception, object continuity, or slow-motion visual inspection. Agents need a clear rule that distinguishes simple CSS micro-transitions from motion that should be modeled with Framer Motion.

## Primary Offer / Primary User Value

Agents get an explicit policy:

- CSS remains responsible for base layout, static styling, and simple one-property micro-transitions.
- Framer Motion is the default for choreographed UI animation.
- `ui-animation` is triggered before non-trivial animation implementation.
- Visual QA must cover slow-motion review, reduced-motion behavior, and remaining motion risks.

## Secondary Path

When the requested animation is clearly a simple CSS-only micro-interaction, agents may keep it in CSS and should avoid adding Framer Motion or broader lifecycle changes.

Examples that may stay CSS-only:

- simple hover states
- color changes
- tiny opacity transitions
- static decorative micro-interactions
- non-sequenced one-property transitions

## Out of Scope

- Do not force Framer Motion for every hover, color, or tiny opacity transition.
- Do not rewrite existing animation systems without a concrete animation task.
- Do not remove CSS transitions globally.
- Do not change app behavior, Payload schema, migrations, Cloudflare resources, or package dependencies as part of the spec.

## Source of Truth

- Primary source: Issue 68, `[Agent Policy] Default to Framer Motion for UI animation choreography`.
- Supporting sources:
  - `AGENTS.md`
  - `.agents/README.md`
  - `.agents/skills/development-agent.md`
  - `.agents/skills/issue-workflow.md`
  - `.agents/skills/regression.md`
  - `docs/agent-loop/source-of-truth.md`
  - `docs/superpowers/specs/README.md`

## Safe Claims

- Framer Motion should be the default for multi-step or choreographed UI animation work.
- CSS transitions remain appropriate for simple, static, non-sequenced micro-interactions.
- Non-trivial UI animation work should trigger `ui-animation` before implementation.
- Visual QA for motion cannot be proven by unit tests alone.
- Reduced-motion handling is part of the expected implementation contract.
- Because `AGENTS.md` and `.agents/*` are rails-managed starter paths, accepted policy changes should sync downstream through `pnpm run boilerplate:sync`.

## Blocked Claims

- Do not claim every animation must use Framer Motion.
- Do not claim automated tests alone prove animation quality.
- Do not claim the policy has been applied to child projects until starter changes have merged and child sync has run or been tracked as follow-up.
- Do not claim existing app animation systems need immediate rewrites unless a concrete issue requires that work.

## Required Policy

Add agent guidance equivalent to:

```text
For UI animation tasks, run the ui-animation skill before implementation and prefer Framer Motion for choreography unless the motion is a simple CSS-only micro transition.
```

The implementation should define choreographed UI animation as motion involving one or more of:

- multi-step UI animation
- component state transitions
- drawer, accordion, or expand-collapse choreography
- layout morphing
- enter or exit sequences
- same-object continuity
- timing, delay, sequencing, or visual perception
- slow-motion QA

## Skill Trigger Conditions

Agents should trigger `ui-animation` before implementation when a task includes any of these signals:

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

## Animation Development Rules

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

For drawer or expand-collapse animation, expected implementation should preserve:

- stable header or anchor
- previous compact content collapse when needed
- downward container-height reveal
- inner content reveal after container motion starts
- same-object continuity across states

Implementations should avoid:

- opacity-only replacement for structural changes
- simultaneous hidden-to-open state jumps
- mount/unmount boundaries that create blink, pop, snap, or identity loss

## Acceptance Criteria

- [ ] Starter-owned agent instructions are updated in `AGENTS.md`.
- [ ] Portable fallback agent instructions are updated where relevant under `.agents/*`.
- [ ] Policy clearly distinguishes Framer Motion choreography from simple CSS micro-transitions.
- [ ] `ui-animation` trigger conditions are documented.
- [ ] Motion QA expectations include slow-mode visual QA and reduced-motion handling.
- [ ] The implementation PR notes child-project sync impact because agent rails are synced from `bemoat-web-starter`.
- [ ] No Payload schema, migration, Cloudflare resource, secret, or child-project infrastructure changes are included.

## Handoff Notes

- Treat this as a docs and agent-policy task.
- Validate the implementation with the docs-only tier from `AGENTS.md`: `pnpm run guard:safety`.
- If implementation touches only docs and synced agent rails, do not run Payload type generation or import map generation.
- The follow-up implementation should include `Closes #68` in the PR body and comment on issue 68 with the implementation report.
