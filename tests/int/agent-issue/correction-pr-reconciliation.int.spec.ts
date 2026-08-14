import { describe, expect, it, vi } from 'vitest'

const { fetchPrByReferenceMock, checkOpenPrsMock } = vi.hoisted(() => ({
  fetchPrByReferenceMock: vi.fn(),
  checkOpenPrsMock: vi.fn(),
}))

vi.mock('../../../scripts/agent-issue/github-evidence.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../scripts/agent-issue/github-evidence.ts')>()
  return {
    ...actual,
    fetchPrByReference: fetchPrByReferenceMock,
    checkOpenPrsForIssueOrBranch: checkOpenPrsMock,
  }
})

vi.mock('../../../scripts/agent-issue/local-git-evidence.ts', () => ({
  getDefaultRepo: () => 'boat1994/bemoat-web-starter',
}))

const contractHead = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

const verdictBody = `## REVIEW_VERDICT

**PR / base / head:** PR #42 · \`main\` · \`${contractHead}\`
**Verdict:** CORRECTION REQUIRED
`

const planningVerdictBody = `## REVIEW_VERDICT

**PR / base / head:** none · \`main\` · \`${contractHead}\`
**Verdict:** CORRECTION REQUIRED
`

async function loadModule() {
  return import('../../../scripts/agent-issue/correction-pr-reconciliation.mjs')
}

describe('Cluster E characterization (issue #333) — correction-pr-reconciliation', () => {
  const cwd = '/tmp/repo'
  const env = process.env

  it('defaults mode to implementation_pr and returns identity errors unchanged', async () => {
    const { reconcileCorrectionPrEvidence } = await loadModule()
    const result = reconcileCorrectionPrEvidence({
      cwd,
      env,
      verdictBody: '## REVIEW_VERDICT\nNo PR identity here\n',
      contractReviewedHead: contractHead,
    })
    expect(result.ok).toBe(false)
    expect(result.errors?.length).toBeGreaterThan(0)
  })

  it('uses different error strings for missing verdict head vs head mismatch', async () => {
    const { reconcileCorrectionPrEvidence } = await loadModule()
    const missingHead = reconcileCorrectionPrEvidence({
      cwd,
      env,
      verdictBody: '## REVIEW_VERDICT\n**Verdict:** CORRECTION REQUIRED\n',
      contractReviewedHead: contractHead,
    })
    const mismatchHead = reconcileCorrectionPrEvidence({
      cwd,
      env,
      verdictBody: `## REVIEW_VERDICT\n**PR / base / head:** PR #42 · \`main\` · \`bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\`\n`,
      contractReviewedHead: contractHead,
    })
    expect(missingHead.errors).toEqual([
      'REVIEW_VERDICT is missing a `PR / base / head` line with an exact head SHA',
    ])
    expect(mismatchHead.errors).toEqual([
      'REVIEW_VERDICT head contradicts the immutable contract reviewed_head',
    ])
  })

  it('planning_no_pr surfaces unavailable live PR evidence and only openPrs[0].number', async () => {
    checkOpenPrsMock.mockReset()
    const { reconcileCorrectionPrEvidence } = await loadModule()
    checkOpenPrsMock.mockReturnValueOnce({ ok: false, reason: 'gh down' })
    const unavailable = reconcileCorrectionPrEvidence({
      cwd,
      env,
      verdictBody: planningVerdictBody,
      contractReviewedHead: contractHead,
      mode: 'planning_no_pr',
      branchName: 'docs/92-planning',
      issueNumber: 92,
      contract: { findings: [] },
    })
    expect(unavailable.errors).toEqual(['live PR evidence is unavailable: gh down'])

    checkOpenPrsMock.mockReturnValueOnce({
      ok: true,
      openPrs: [{ number: 99 }, { number: 100 }],
    })
    const openPr = reconcileCorrectionPrEvidence({
      cwd,
      env,
      verdictBody: planningVerdictBody,
      contractReviewedHead: contractHead,
      mode: 'planning_no_pr',
      branchName: 'docs/92-planning',
      issueNumber: 92,
      contract: { findings: [] },
    })
    expect(openPr.errors).toEqual([
      'STATE CONFLICT: open PR #99 exists on GitHub for this planning issue under no-PR contract',
    ])
  })

  it('does not infer identity from requested number when url is empty', async () => {
    fetchPrByReferenceMock.mockReset()
    fetchPrByReferenceMock.mockReturnValue({
      ok: true,
      reference: { number: '42', repo: 'boat1994/bemoat-web-starter', key: 'boat1994/bemoat-web-starter#42' },
      pr: {
        number: 42,
        headRefOid: contractHead,
        baseRefName: 'main',
        state: 'OPEN',
        url: '',
      },
    })
    const { reconcileCorrectionPrEvidence } = await loadModule()
    const result = reconcileCorrectionPrEvidence({
      cwd,
      env,
      verdictBody,
      contractReviewedHead: contractHead,
    })
    expect(result.ok).toBe(false)
    expect(result.errors).toContain('live PR evidence is missing required repository-qualified identity URL')
  })
})
