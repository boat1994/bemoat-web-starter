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
