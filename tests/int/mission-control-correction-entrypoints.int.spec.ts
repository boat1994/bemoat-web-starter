import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

/* eslint-disable @typescript-eslint/no-explicit-any -- executable .mjs boundary */
import * as stateModule from '../../scripts/mission-control-state.mjs'

const { renderMissionControlState, parseMissionControlState } = stateModule as unknown as Record<string, (...args: any[]) => any>
const reconcileScript = resolve(process.cwd(), 'scripts/mission-control-reconcile.mjs')
const dispatchScript = resolve(process.cwd(), 'scripts/mission-control-dispatch.mjs')
const tempPaths: string[] = []

function writeExecutable(path: string, body: string) {
  writeFileSync(path, body)
  chmodSync(path, 0o755)
}

function legacyState(): any {
  return {
    schema_version: 1, state: 'STATE_MIGRATION_REQUIRED', review_cycle: 3, full_review_count: 1,
    approved_base: 'main', active_task_issue: '#171', active_pr: '#172',
    current_head: '1f05427a8fbb893e726dd0e317ff30a90d7b3570',
    last_reviewed_head: '1f05427a8fbb893e726dd0e317ff30a90d7b3570', post_budget_reviews: [],
    founder_decision: {
      status: 'approved', authority: 'Founder', scope: 'correction', for_review_number: 3,
      reviewed_head: '1f05427a8fbb893e726dd0e317ff30a90d7b3570', finding_ids: ['MC-R1-171-001'],
      action: 'Authorize one bounded correction; Review 4 remains unauthorized', authorized_at: '2026-07-26T01:30:29+07:00',
    },
    guide_version: '1.2.0', guide_source_ref: 'main', guide_source_sha: null,
    open_blockers: ['MC-R1-171-001'], follow_up_issues: [], next_permitted_action: 'Migrate exact state',
    material_change_status: 'founder_approved_post_budget_correction_pending_state_schema_support',
    updated_at: '2026-07-26T01:30:29+07:00', updated_by: 'Mission Control',
    finding_lineage: [{
      finding_id: 'MC-R1-171-001', severity: 'Critical', disposition: 'open', summary: 'Lineage defect',
      source_thread: 'https://github.com/boat1994/bemoat-web-starter/pull/172#discussion_r1',
      evidence: 'Exact durable Founder decision evidence', required_correction_evidence: ['Bind exact lineage'],
    }],
  }
}

function createGhHarness(initialBody: string) {
  const root = mkdtempSync(join(tmpdir(), 'bemoat-correction-entrypoints-'))
  tempPaths.push(root)
  const issueBody = join(root, 'issue.md')
  const commentMarker = join(root, 'comment-count')
  const reservation = join(root, 'reservation')
  writeFileSync(issueBody, initialBody)
  writeFileSync(commentMarker, '0')
  const gh = join(root, 'gh')
  writeExecutable(gh, `#!/bin/sh
case "$*" in
  "repo view --json nameWithOwner --jq .nameWithOwner") printf '%s' 'boat1994/bemoat-web-starter'; exit 0 ;;
esac
if [ "$1" = "issue" ] && [ "$2" = "view" ]; then
  if echo "$*" | grep -q comments; then printf '%s' '{"comments":[]}' ; exit 0; fi
  "${process.execPath}" -e 'const fs=require("fs"); const body=fs.readFileSync(process.argv[1],"utf8"); process.stdout.write(JSON.stringify({title:"Issue",url:"https://github.com/boat1994/bemoat-web-starter/issues/171",body,state:"OPEN",labels:[]}))' "${issueBody}"
  exit 0
fi
if [ "$1" = "issue" ] && [ "$2" = "edit" ]; then
  while [ "$#" -gt 0 ]; do
    if [ "$1" = "--body-file" ]; then cp "$2" "${issueBody}"; exit 0; fi
    shift
  done
fi
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  printf '%s' '{"number":172,"title":"Correction PR","url":"https://github.com/boat1994/bemoat-web-starter/pull/172","headRefName":"fix/171","baseRefName":"main","headRefOid":"1f05427a8fbb893e726dd0e317ff30a90d7b3570","state":"OPEN","statusCheckRollup":[],"commits":[]}'
  exit 0
fi
if [ "$1" = "api" ] && echo "$*" | grep -q 'git/refs'; then
  if [ "$3" = "POST" ]; then
    if [ -f "${reservation}" ]; then echo 'duplicate reservation' >&2; exit 1; fi
    touch "${reservation}"; printf '%s' '{"ref":"reservation"}'; exit 0
  fi
  rm -f "${reservation}"; exit 0
fi
if [ "$1" = "api" ] && echo "$*" | grep -q '/comments'; then
  if [ "$3" = "POST" ]; then
    count=$(cat "${commentMarker}"); count=$((count + 1)); printf '%s' "$count" > "${commentMarker}"
    printf '%s' '{"id":501,"html_url":"https://github.com/boat1994/bemoat-web-starter/issues/171#issuecomment-501","created_at":"2026-07-26T02:00:00Z","updated_at":"2026-07-26T02:00:00Z"}'
    exit 0
  fi
  exit 0
fi
echo "unexpected gh call: $*" >&2
exit 1
`)
  return { root, issueBody, commentMarker, reservation, env: { ...process.env, PATH: `${root}:${process.env.PATH ?? ''}` } }
}

afterEach(() => {
  for (const path of tempPaths.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('Founder-authorized correction executable entrypoints', () => {
  it('runs the real migration entrypoint against the exact Issue #171 representation', () => {
    const harness = createGhHarness(`Mission Control mode: required\n\n${renderMissionControlState(legacyState())}`)
    const result = spawnSync(process.execPath, [reconcileScript, '171', '--repo', 'boat1994/bemoat-web-starter'], {
      cwd: process.cwd(), env: harness.env, encoding: 'utf8',
    })
    expect(result.status, `${result.stderr || result.stdout}\n${readFileSync(harness.issueBody, 'utf8')}`).toBe(0)
    const parsed = parseMissionControlState(readFileSync(harness.issueBody, 'utf8'))
    expect(parsed.valid).toBe(true)
    expect(parsed.state).toMatchObject({
      state: 'FOUNDER_AUTHORIZED_CORRECTION', review_cycle: 3, full_review_count: 1,
      founder_correction_authorization: { schema_version: 2, status: 'authorized', finding_ids: ['MC-R1-171-001'] },
    })
  }, 10000)

  it('runs the real reserved dispatch entrypoint once and rejects replay', () => {
    const canonical = legacyState()
    canonical.state = 'FOUNDER_AUTHORIZED_CORRECTION'
    delete canonical.founder_decision
    ;(canonical as any).founder_correction_authorization = {
      schema_version: 2, authorization_id: 'founder-r3-171', status: 'authorized', authority: 'Founder',
      scope: 'correction', for_review_number: 3, reviewed_head: canonical.last_reviewed_head,
      finding_ids: ['MC-R1-171-001'], action: 'Authorize one bounded correction', authorized_at: '2026-07-26T01:30:29+07:00',
    }
    const harness = createGhHarness(`Mission Control mode: required\n\n${renderMissionControlState(canonical)}`)
    const handoff = join(harness.root, 'handoff.md')
    writeFileSync(handoff, `## HANDOFF

### Task log
- Timestamp: 2026-07-26T02:00:00+07:00
- Task / Issue: #171
- Phase: Dev (correction)
- Executing role: Mission Control

**Target:** Dev / Integration Builder
**Objective:** Execute the bounded correction.
**Links:** Issue #171 · PR https://github.com/boat1994/bemoat-web-starter/pull/172
**State (verify live):** branch \`fix/171\` · base \`main\` · head \`1f05427a8fbb893e726dd0e317ff30a90d7b3570\`
**Delta scope:** MC-R1-171-001 only
**Verify:** correction preflight and exact-head CI
**Stop:** any authority drift
**Founder gate:** Required for Review 4
**Founder correction authorization:** \`founder-r3-171\`
**Next:** Dev posts correction RESULT
`)
    const args = [dispatchScript, '171', '--repo', 'boat1994/bemoat-web-starter', '--founder-correction', '--body-file', handoff]
    const first = spawnSync(process.execPath, args, { cwd: process.cwd(), env: harness.env, encoding: 'utf8' })
    expect(first.status, `${first.stderr || first.stdout}\n${readFileSync(harness.issueBody, 'utf8')}`).toBe(0)
    expect(readFileSync(harness.commentMarker, 'utf8')).toBe('1')
    expect(() => readFileSync(harness.reservation, 'utf8')).toThrow()
    const parsed = parseMissionControlState(readFileSync(harness.issueBody, 'utf8'))
    expect(parsed.state.founder_correction_authorization).toMatchObject({
      schema_version: 2, status: 'consumed', handoff_comment_id: '501',
      handoff_binding: { content_sha256: expect.stringMatching(/^[0-9a-f]{64}$/), binding_sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
    })
    expect(parsed.state).toMatchObject({
      updated_by: 'Mission Control',
      updated_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    })

    const replay = spawnSync(process.execPath, args, { cwd: process.cwd(), env: harness.env, encoding: 'utf8' })
    expect(replay.status).toBe(1)
    expect(replay.stderr).toMatch(/unconsumed Founder correction authorization/)
    expect(readFileSync(harness.commentMarker, 'utf8')).toBe('1')
  }, 10000)
})
