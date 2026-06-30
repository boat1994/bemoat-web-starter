# Visual QA Checklist

Use this after UI implementation or polish. The goal is to catch visible quality problems before review, not to invent new scope.

## Reference Alignment

- [ ] The output matches the issue, design brief, or supplied reference intent.
- [ ] Project-specific references stay in the child project or Design Ref CMS.
- [ ] The starter contains only reusable rules and generic examples.
- [ ] The UI does not copy copyrighted reference material.

## Hierarchy and Scan Path

- [ ] The primary user action is visually clear.
- [ ] Headings, supporting copy, and controls form a readable order.
- [ ] Important information is not buried in equal-weight cards.
- [ ] Dense operational UI remains scannable.
- [ ] Marketing-style composition is used only when the task calls for it.

## Layout and Spacing

- [ ] Alignment is intentional across columns, cards, controls, and media.
- [ ] Spacing is consistent within each section.
- [ ] Similar elements share stable dimensions.
- [ ] No text or UI element overlaps at mobile or desktop widths.
- [ ] Fixed-format elements use responsive constraints such as grid tracks, `aspect-ratio`, `minmax`, or explicit min/max sizes.

## Typography

- [ ] Text fits inside its parent container.
- [ ] Compact panels use compact type, not hero-scale headings.
- [ ] Line length remains readable.
- [ ] Letter spacing is not negative.
- [ ] Font size does not scale directly with viewport width.

## Responsive Behavior

- [ ] Mobile layout preserves the main action and reading order.
- [ ] Desktop layout uses space without creating sparse filler.
- [ ] Navigation, filters, forms, and toolbars remain usable on small screens.
- [ ] Important media is not cropped so heavily that the object or state becomes unclear.

## States

Review relevant states:

- [ ] Loading.
- [ ] Empty.
- [ ] Error.
- [ ] Success.
- [ ] Disabled.
- [ ] Permission or signed-out.
- [ ] Long content.
- [ ] Missing optional media.

## Interaction

- [ ] Buttons and links look interactive.
- [ ] Hover, active, selected, and disabled states are distinct.
- [ ] Icon-only controls have accessible names and tooltips when meaning is not obvious.
- [ ] Motion has a clear purpose.
- [ ] Reduced-motion behavior is available when motion is present.

## Anti-Generic Review

- [ ] Remove generic badges, empty gradients, and decorative cards that do not support the job.
- [ ] Remove placeholder stats, testimonials, logos, and screenshots.
- [ ] Replace vague copy with issue-backed or CMS-backed content.
- [ ] Avoid repeating the same section rhythm unless repetition helps comparison.
- [ ] Confirm the result feels specific to the product category.

## Delta Notes

Record:

- What changed.
- What stayed intentionally unchanged.
- Which breakpoints were checked.
- Which accessibility checks were run.
- Any taste decisions that need human review.
