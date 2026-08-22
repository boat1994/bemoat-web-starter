import { describe, expect, it } from 'vitest'

import { classifyStandardNonManagedEligibility } from '../../scripts/mission-control/domain/standard-non-managed-eligibility.ts'

const repository = 'boat1994/bemoat-web-starter'
const policy = {
  path: 'docs/mission-control/mission-control-guide.md',
  version: '1.3.0',
  blobSha: 'b'.repeat(40),
  sourceCommit: 'a'.repeat(40),
  content: `---
policy_id: bemoat-mission-control
version: 1.3.0
canonical_repository: ${repository}
---

| Medium/Core | STANDARD |
Mission Control mode: required
Mission Control mode: optional
`,
}

const standardBody = `## Founder direction

Task size: Core
Mission Control mode: optional
`

describe('STANDARD/non-managed eligibility', () => {
  it('accepts an explicit policy-compatible Core optional Issue without managed state', () => {
    expect(classifyStandardNonManagedEligibility({ repository, issueBody: standardBody, policy, protectedBaseSha: 'a'.repeat(40) })).toEqual({
      eligible: true,
      profile: 'STANDARD',
      managed: false,
    })
  })

  it('accepts the established live Task tier Core declaration for STANDARD/non-managed routing', () => {
    expect(classifyStandardNonManagedEligibility({
      repository,
      issueBody: `Task tier: Core\nMission Control mode: optional\nExpected profile: STANDARD`,
      policy,
      protectedBaseSha: 'a'.repeat(40),
    })).toEqual({
      eligible: true,
      profile: 'STANDARD',
      managed: false,
    })
  })

  it('rejects a managed target instead of synthesizing a non-managed profile', () => {
    expect(() => classifyStandardNonManagedEligibility({
      repository,
      issueBody: `${standardBody}\n<!-- bemoat-mission-control-state:start -->\nstate: READY\n<!-- bemoat-mission-control-state:end -->`,
      policy,
      protectedBaseSha: 'a'.repeat(40),
    })).toThrow(/managed state/i)
  })

  it('rejects an ambiguous or non-standard declaration fail-closed', () => {
    expect(() => classifyStandardNonManagedEligibility({
      repository,
      issueBody: 'Task size: Core\nMission Control mode: unsure',
      policy,
      protectedBaseSha: 'a'.repeat(40),
    })).toThrow(/ambiguous|STANDARD/i)
    expect(() => classifyStandardNonManagedEligibility({
      repository,
      issueBody: 'Task size: Small\nMission Control mode: optional',
      policy,
      protectedBaseSha: 'a'.repeat(40),
    })).toThrow(/STANDARD/i)
  })

  it('rejects stale or wrong-repository policy identity', () => {
    expect(() => classifyStandardNonManagedEligibility({
      repository,
      issueBody: standardBody,
      policy: { ...policy, sourceCommit: 'c'.repeat(40) },
      protectedBaseSha: 'a'.repeat(40),
    })).toThrow(/policy/i)
    expect(() => classifyStandardNonManagedEligibility({
      repository,
      issueBody: standardBody,
      policy: { ...policy, path: 'docs/mission-control/other-guide.md' },
      protectedBaseSha: 'a'.repeat(40),
    })).toThrow(/policy/i)
    expect(() => classifyStandardNonManagedEligibility({
      repository,
      issueBody: standardBody,
      policy: { ...policy, content: policy.content.replace(repository, 'other/repository') },
      protectedBaseSha: 'a'.repeat(40),
    })).toThrow(/policy/i)
  })

  it('preserves the legacy Core Main Issue and Implementation Plan managed rule', () => {
    expect(() => classifyStandardNonManagedEligibility({
      repository,
      issueBody: `${standardBody}\nMain Issue: #379\nImplementation Plan: docs/plan.md`,
      policy,
      protectedBaseSha: 'a'.repeat(40),
    })).toThrow(/managed/i)
  })
})
