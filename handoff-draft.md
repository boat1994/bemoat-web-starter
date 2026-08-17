## HANDOFF

### Task log
- Timestamp: `2026-08-17T21:40:00+07:00`
- Task / Issue: #333
- Phase: Dev (implementation)
- Executing role: Mission Control
- Model / reasoning: Gemini 3.1 Pro (High)

**Target:** Dev (implementation)
**Objective:** Fix REVIEW_VERDICT validation mismatch so `bemoat:issue:comment --check` uses downstream canonical binding semantics and rejects legacy shapes.
**Links:** Issue #333
**State (verify live):** new or existing branch for Issue #333 · base `main`
**Delta scope:**
- Post-role-comment validation must enforce canonical REVIEW_VERDICT binding parser.
- Drop legacy REVIEW_VERDICT compatibility shapes rejected by downstream canonical binding.
- Ensure consistent field-shape validation and verdict extraction for bullet-prefixed fields.
- Valid verdict enum must not produce false enum errors due to formatting.
- Add focused regressions for: canonical PR URL exact head, slash-separated PR # / main@SHA / head, main@SHA in canonical base slot, legacy shapes, bullet handling, and valid verdict false enum error.
**Verify:** Parity-tested `--help` examples, `--check` validation, posting validation, and downstream consumption.
**Stop:** Do not expand into unrelated comment transport behavior.
**Founder gate:** Not required
**Next:** Dev posts `## RESULT`
