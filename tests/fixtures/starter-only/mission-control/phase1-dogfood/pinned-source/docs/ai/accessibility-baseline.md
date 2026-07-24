# Accessibility Baseline

Use this checklist for UI work before review. It is a baseline, not a replacement for deeper accessibility testing.

## Keyboard

- [ ] All interactive controls are reachable by keyboard.
- [ ] Focus order follows the visual and reading order.
- [ ] Focus is visible on every interactive element.
- [ ] Modals, popovers, menus, and drawers manage focus correctly.
- [ ] Escape closes dismissible overlays when appropriate.

## Semantics

- [ ] Use real buttons for actions.
- [ ] Use real links for navigation.
- [ ] Use headings in a logical order.
- [ ] Use lists, tables, labels, and fieldsets when they match the content.
- [ ] Avoid clickable `div` or `span` elements.

## Names, Roles, and Descriptions

- [ ] Icon-only controls have an accessible name.
- [ ] Form inputs have labels.
- [ ] Error messages are associated with the relevant fields.
- [ ] Dynamic status messages use accessible announcement patterns when needed.
- [ ] Images have useful alt text or are marked decorative.

## Color and Contrast

- [ ] Text contrast is readable in normal, hover, selected, disabled, and error states.
- [ ] Information is not communicated by color alone.
- [ ] Focus rings have enough contrast against the background.
- [ ] Disabled controls remain understandable without looking active.

## Forms

- [ ] Required fields are identified.
- [ ] Validation errors explain what to fix.
- [ ] Form submission success and failure states are clear.
- [ ] Inputs support autofill and expected keyboard types when relevant.

## Targets and Layout

- [ ] Tap targets are large enough for touch.
- [ ] Controls do not overlap at small widths.
- [ ] Zoomed text does not hide critical controls.
- [ ] Sticky elements do not block form fields or primary actions.

## Motion

- [ ] Motion has a clear purpose.
- [ ] Reduced-motion fallback is available when animation is meaningful.
- [ ] No flashing or rapid motion is introduced.

## Review Notes

When reporting accessibility results, include:

- Keyboard path checked.
- Screen sizes checked.
- Form or state coverage checked.
- Known gaps or follow-up testing needed.
